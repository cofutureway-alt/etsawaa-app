-- Permissions v2: a real permission catalog for staff.
--   * user_permissions: per-person grant (granted=true) / removal (granted=false)
--     on top of the role's list — only meaningful for role 'staff'.
--   * has_permission(): admin → all, blocked → none, else role ∪ grants − removals.
--   * fn_my_permissions(): effective list for the app (menu + route guards).
--   * fn_admin_set_user_permissions(): staff.manage only.
--   * fn_admin_set_role / fn_admin_set_user_status / fn_admin_user_counts moved
--     from is_admin()/legacy keys to users.edit / users.block / users.view;
--     only an admin can grant or remove the admin/staff roles.
--   * fn_admin_finalize_new_user(): role + overrides + terms for admin-created accounts.
-- Keys live in app/lib/permissions.ts (PERMISSION_GROUPS) — keep in sync.

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  granted boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, permission)
);
alter table public.user_permissions enable row level security;
revoke all on public.user_permissions from anon, authenticated;
grant select on public.user_permissions to authenticated;

create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status = 'blocked' then false
      when p.role = 'admin' then true
      when p.role = 'staff' and exists (select 1 from public.user_permissions u
             where u.user_id = p.id and u.permission = p_permission and not u.granted) then false
      when p.role = 'staff' and exists (select 1 from public.user_permissions u
             where u.user_id = p.id and u.permission = p_permission and u.granted) then true
      else coalesce(r.permissions ? '*' or r.permissions ? p_permission, false)
    end
    from public.profiles p left join public.roles r on r.slug = p.role
    where p.id = auth.uid()), false);
$$;

drop policy if exists user_permissions_read on public.user_permissions;
create policy user_permissions_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('staff.manage'));

-- legacy keys → v2 keys; staff role gets the new defaults
update public.roles set permissions = '["dashboard.view","orders.view","orders.create","orders.edit","orders.approve","vendors.view","vendors.create","vendors.edit","vendors.review","users.view","users.create","users.edit","users.block","products.view"]'::jsonb
 where slug = 'staff';

-- settings policies: legacy settings.read/write → settings.manage
alter policy settings_read_permissioned on public.settings using (public.has_permission('settings.manage'));
alter policy settings_update_permissioned on public.settings using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
alter policy settings_delete_permissioned on public.settings using (public.has_permission('settings.manage'));
alter policy settings_write_permissioned on public.settings with check (public.has_permission('settings.manage'));
-- profiles: anyone handling users, sellers or orders needs names/emails
alter policy profiles_select_admin on public.profiles
  using (public.has_permission('users.view') or public.has_permission('vendors.view') or public.has_permission('orders.view'));

create or replace function public.fn_my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('role', p.role, 'permissions',
      case
        when p.status = 'blocked' then '[]'::jsonb
        when p.role = 'admin' then '["*"]'::jsonb
        when p.role <> 'staff' then coalesce(r.permissions, '[]'::jsonb)
        else coalesce((
          select jsonb_agg(k order by k) from (
            select jsonb_array_elements_text(coalesce(r.permissions, '[]'::jsonb)) k
            union
            select permission from public.user_permissions where user_id = p.id and granted
            except
            select permission from public.user_permissions where user_id = p.id and not granted
          ) s), '[]'::jsonb)
      end)
    from public.profiles p left join public.roles r on r.slug = p.role
    where p.id = auth.uid()), jsonb_build_object('role', null, 'permissions', '[]'::jsonb));
$$;

create or replace function public.fn_admin_set_user_permissions(p_user uuid, p_grants text[], p_revokes text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_before jsonb;
begin
  if not public.has_permission('staff.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select role into v_role from public.profiles where id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_role <> 'staff' then return jsonb_build_object('ok', false, 'reason', 'not_staff'); end if;
  -- nobody widens their own access; only an admin edits staff they are not
  if p_user = auth.uid() and not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from unnest(coalesce(p_grants, '{}') || coalesce(p_revokes, '{}')) k where k !~ '^[a-z_]+\.[a-z_]+$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_key');
  end if;
  select coalesce(jsonb_object_agg(permission, granted), '{}'::jsonb) into v_before from public.user_permissions where user_id = p_user;
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, permission, granted)
    select p_user, k, true from unnest(coalesce(p_grants, '{}')) k
    union select p_user, k, false from unnest(coalesce(p_revokes, '{}')) k
          where k <> all (coalesce(p_grants, '{}'))
  on conflict do nothing;
  perform public.fn_audit('staff.permissions', 'profiles', p_user::text, v_before,
    (select coalesce(jsonb_object_agg(permission, granted), '{}'::jsonb) from public.user_permissions where user_id = p_user));
  return jsonb_build_object('ok', true);
end $$;

-- role change: users.edit; admin/staff roles are admin-only both ways
create or replace function public.fn_admin_set_role(p_user_id uuid, p_new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.has_permission('users.edit') then
    raise exception 'not allowed: caller cannot change roles' using errcode = '42501';
  end if;
  if p_new_role not in ('admin', 'staff', 'vendor', 'customer') then
    raise exception 'invalid role %', p_new_role;
  end if;
  select role into v_old from public.profiles where id = p_user_id;
  if not found then raise exception 'target profile not found'; end if;
  if (v_old in ('admin', 'staff') or p_new_role in ('admin', 'staff')) and not public.is_admin() then
    raise exception 'not allowed: only an admin can change admin or staff roles' using errcode = '42501';
  end if;
  if v_old = 'admin' and p_new_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot demote the last admin';
  end if;
  update public.profiles set role = p_new_role, updated_at = now() where id = p_user_id;
  if p_new_role <> 'staff' then delete from public.user_permissions where user_id = p_user_id; end if;
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'role.change', 'profiles', p_user_id::text,
          jsonb_build_object('role', v_old), jsonb_build_object('role', p_new_role));
end $$;

create or replace function public.fn_admin_set_user_status(p_user uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_before text;
begin
  if not public.has_permission('users.block') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('active', 'blocked') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  if p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  select role, status into v_role, v_before from public.profiles where id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_role in ('admin', 'staff') and not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_status = 'blocked' and v_role = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active' and id <> p_user) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'last_admin');
  end if;
  update public.profiles set status = p_status, updated_at = now() where id = p_user;
  update auth.users set banned_until = case when p_status = 'blocked' then 'infinity'::timestamptz else null end where id = p_user;
  if p_status = 'blocked' then delete from auth.sessions where user_id = p_user; end if;
  perform public.fn_audit('user.' || case when p_status = 'blocked' then 'banned' else 'unbanned' end, 'profiles', p_user::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_admin_user_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('users.view') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object(
    'ok', true,
    'total', (select count(*) from public.profiles),
    'vendor', (select count(*) from public.profiles where role = 'vendor'),
    'customer', (select count(*) from public.profiles where role = 'customer'),
    'admin', (select count(*) from public.profiles where role = 'admin'),
    'staff', (select count(*) from public.profiles where role = 'staff'),
    'blocked', (select count(*) from public.profiles where status = 'blocked'));
end $$;

-- legal acceptance context for accounts an admin creates
alter table public.legal_acceptances drop constraint if exists legal_acceptances_context_check;
alter table public.legal_acceptances add constraint legal_acceptances_context_check
  check (context in ('signup', 'gate', 'vendor_onboarding', 'backfill', 'admin_created'));

-- Called right after auth.admin.createUser/generateLink (the trigger already
-- made a 'customer' profile). Runs as the creating admin/staff (auth.uid()).
create or replace function public.fn_admin_finalize_new_user(
  p_user uuid, p_role text, p_full_name text, p_phone text, p_locale text,
  p_grants text[] default '{}', p_revokes text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_doc public.legal_documents%rowtype;
begin
  if p_role not in ('admin', 'staff', 'vendor', 'customer') then return jsonb_build_object('ok', false, 'reason', 'bad_role'); end if;
  if p_role in ('admin', 'staff') and not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_role = 'vendor' and not (public.has_permission('users.create') or public.has_permission('vendors.create')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_role = 'customer' and not public.has_permission('users.create') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  update public.profiles
     set role = p_role,
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
         locale = case when p_locale in ('ar', 'en') then p_locale else locale end,
         updated_at = now()
   where id = p_user;

  if p_role = 'staff' and (cardinality(coalesce(p_grants, '{}')) > 0 or cardinality(coalesce(p_revokes, '{}')) > 0) then
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
    jsonb_build_object('role', p_role, 'grants', to_jsonb(coalesce(p_grants, '{}')), 'revokes', to_jsonb(coalesce(p_revokes, '{}'))));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_my_permissions() from public, anon;
revoke all on function public.fn_admin_set_user_permissions(uuid, text[], text[]) from public, anon;
revoke all on function public.fn_admin_finalize_new_user(uuid, text, text, text, text, text[], text[]) from public, anon;
grant execute on function public.fn_my_permissions() to authenticated;
grant execute on function public.fn_admin_set_user_permissions(uuid, text[], text[]) to authenticated;
grant execute on function public.fn_admin_finalize_new_user(uuid, text, text, text, text, text[], text[]) to authenticated;
