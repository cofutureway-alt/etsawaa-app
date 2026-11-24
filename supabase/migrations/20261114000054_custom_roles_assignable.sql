-- Custom roles (roles.is_system = false, created in admin → Roles) are staff
-- sub-roles: profiles.role = 'staff' + profiles.staff_role = <slug>.
-- Creating a user or changing a role now accepts a custom role slug directly
-- (resolved to staff + staff_role atomically); leaving staff clears staff_role.

create or replace function public.fn_resolve_role(p_role text)
returns table (base text, staff_role text)
language sql stable security definer set search_path to 'public' as $$
  select case when p_role in ('admin', 'staff', 'vendor', 'customer') then p_role
              when exists (select 1 from public.roles r where r.slug = p_role and not r.is_system) then 'staff' end,
         case when p_role not in ('admin', 'staff', 'vendor', 'customer')
               and exists (select 1 from public.roles r where r.slug = p_role and not r.is_system) then p_role end;
$$;
revoke all on function public.fn_resolve_role(text) from public;
grant execute on function public.fn_resolve_role(text) to authenticated, service_role;

create or replace function public.fn_admin_finalize_new_user(p_user uuid, p_role text, p_full_name text, p_phone text, p_locale text, p_grants text[] default '{}'::text[], p_revokes text[] default '{}'::text[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_doc public.legal_documents%rowtype; v_base text; v_staff text;
begin
  select base, staff_role into v_base, v_staff from public.fn_resolve_role(p_role);
  if v_base is null then return jsonb_build_object('ok', false, 'reason', 'bad_role'); end if;
  if v_base in ('admin', 'staff') and not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_base = 'vendor' and not (public.has_permission('users.create') or public.has_permission('vendors.create')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_base = 'customer' and not public.has_permission('users.create') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  update public.profiles
     set role = v_base,
         staff_role = v_staff,
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
         locale = case when p_locale in ('ar', 'en') then p_locale else locale end,
         updated_at = now()
   where id = p_user;

  if v_base = 'staff' and (cardinality(coalesce(p_grants, '{}')) > 0 or cardinality(coalesce(p_revokes, '{}')) > 0) then
    insert into public.user_permissions (user_id, permission, granted)
      select p_user, k, true from unnest(p_grants) k where k ~ '^[a-z_]+\.[a-z_]+$'
      union select p_user, k, false from unnest(p_revokes) k where k ~ '^[a-z_]+\.[a-z_]+$' and k <> all (coalesce(p_grants, '{}'))
    on conflict do nothing;
  end if;

  select * into v_doc from public.legal_documents where kind = 'terms' and is_current;
  if v_doc.id is not null then
    insert into public.legal_acceptances (user_id, document_id, kind, version, context, accepted_at)
    values (p_user, v_doc.id, 'terms', v_doc.version, 'admin_created', now())
    on conflict (user_id, document_id) do nothing;
  end if;

  perform public.fn_audit('user.created', 'profiles', p_user::text, null,
    jsonb_build_object('role', v_base, 'staff_role', v_staff, 'grants', to_jsonb(coalesce(p_grants, '{}')), 'revokes', to_jsonb(coalesce(p_revokes, '{}'))));
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.fn_admin_set_role(p_user_id uuid, p_new_role text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_old text; v_old_staff text; v_base text; v_staff text;
begin
  if not public.has_permission('users.edit') then
    raise exception 'not allowed: caller cannot change roles' using errcode = '42501';
  end if;
  select base, staff_role into v_base, v_staff from public.fn_resolve_role(p_new_role);
  if v_base is null then
    raise exception 'invalid role %', p_new_role;
  end if;
  select role, staff_role into v_old, v_old_staff from public.profiles where id = p_user_id;
  if not found then raise exception 'target profile not found'; end if;
  if (v_old in ('admin', 'staff') or v_base in ('admin', 'staff')) and not public.is_admin() then
    raise exception 'not allowed: only an admin can change admin or staff roles' using errcode = '42501';
  end if;
  if v_old = 'admin' and v_base <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot demote the last admin';
  end if;
  update public.profiles set role = v_base, staff_role = v_staff, updated_at = now() where id = p_user_id;
  if v_base <> 'staff' then delete from public.user_permissions where user_id = p_user_id; end if;
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'role.change', 'profiles', p_user_id::text,
          jsonb_build_object('role', v_old, 'staff_role', v_old_staff), jsonb_build_object('role', v_base, 'staff_role', v_staff));
end $function$;

-- anyone who left staff earlier keeps no dangling sub-role
update public.profiles set staff_role = null where role <> 'staff' and staff_role is not null;
