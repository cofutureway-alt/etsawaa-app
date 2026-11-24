-- Sign-up with a phone number already on another profile failed with a bare 500
-- (profiles_phone_key) and the page could only say "something went wrong".
-- 1) A number held by an account that NEVER confirmed its email has no real
--    owner: a new sign-up takes it over (the unconfirmed profile loses it).
-- 2) fn_signup_phone_taken lets the register page tell the customer up front
--    that the number belongs to a confirmed account.

create or replace function public.fn_signup_phone_taken(p_phone text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.phone = p_phone and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.fn_signup_phone_taken(text) from public;
grant execute on function public.fn_signup_phone_taken(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_doc public.legal_documents%rowtype;
  v_phone text := nullif(new.raw_user_meta_data ->> 'phone_e164', '');
begin
  if v_phone is not null then
    -- release the number from accounts that never confirmed their email
    update public.profiles p set phone = null, updated_at = now()
     where p.phone = v_phone and p.id <> new.id
       and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is null);
    -- still held by a confirmed account: create the user without it rather than fail
    if exists (select 1 from public.profiles p where p.phone = v_phone and p.id <> new.id) then
      v_phone := null;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, phone, locale, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_phone,
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'ar'),
    'customer'
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        phone     = coalesce(public.profiles.phone, excluded.phone);
  select * into v_doc from public.legal_documents where kind = 'terms' and is_current;
  if v_doc.id is not null and new.raw_user_meta_data ->> 'terms_version' = v_doc.version then
    insert into public.legal_acceptances (user_id, document_id, kind, version, context, ip, user_agent, accepted_at)
    values (new.id, v_doc.id, 'terms', v_doc.version, 'signup',
            left(new.raw_user_meta_data ->> 'terms_ip', 64), left(new.raw_user_meta_data ->> 'terms_ua', 300),
            coalesce((new.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz, now()))
    on conflict (user_id, document_id) do nothing;
  end if;
  return new;
end $function$;
