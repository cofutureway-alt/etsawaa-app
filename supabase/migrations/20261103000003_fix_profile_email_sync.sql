-- ============================================================================
-- Fix 03 — keep profiles.email in sync with auth.users.email
--
-- handle_new_user() only runs on INSERT, so after a user changes their email
-- (profile.tsx → updateUser({email}) → OTP confirm) profiles.email kept the
-- OLD address. fn_resolve_email_from_phone reads profiles.email directly, so
-- signing in by phone returned the stale address and failed.
--
-- Trigger fires only on the email column to stay out of every other auth
-- write (last_sign_in_at etc.).
-- ============================================================================
begin;

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = 'public' as $function$
begin
  update public.profiles
     set email = new.email,
         updated_at = now()
   where id = new.id
     and coalesce(email, '') <> coalesce(new.email, '');
  return new;
end $function$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

commit;
