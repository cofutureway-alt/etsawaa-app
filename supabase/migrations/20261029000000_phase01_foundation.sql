-- ============================================================================
-- Etsawaa — Phase 01 Foundation (F-05, F-06, F-08, F-17, F-18 schema)
-- Tables: roles, profiles, user_addresses, governorates, areas, settings,
--         audit_logs, notifications, email_logs, email_templates
-- + RLS policies, grants, audit triggers, RPCs, realtime publication.
-- Idempotency: written for a fresh phase-01 database (Supabase project).
-- Apply: supabase db push   (or psql -f this file against the project)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ROLES (before profiles: FK target)
-- ----------------------------------------------------------------------------
create table if not exists public.roles (
  slug        text primary key,
  name_ar     text not null,
  name_en     text not null,
  permissions jsonb not null default '[]'::jsonb,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.roles is 'RBAC source of truth: permissions jsonb drives has_permission(); no permission literals in app code.';

-- ----------------------------------------------------------------------------
-- 2) PROFILES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text not null default '',
  phone      text unique,
  avatar_url text,
  locale     text not null default 'ar' check (locale in ('ar', 'en')),
  role       text not null default 'customer' references public.roles(slug) on update cascade,
  status     text not null default 'active' check (status in ('active', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx     on public.profiles (role);
create index if not exists profiles_email_idx    on public.profiles (lower(email));
create index if not exists profiles_phone_idx    on public.profiles (phone);
create index if not exists profiles_created_idx  on public.profiles (created_at desc);

-- Phone normalization rule (+20 E.164) enforced at the database level too.
alter table public.profiles
  drop constraint if exists profiles_phone_e164_check;
alter table public.profiles
  add constraint profiles_phone_e164_check check (phone is null or phone ~ '^\+[0-9]{10,15}$');

-- ----------------------------------------------------------------------------
-- 3) GOVERNORATES + AREAS (27 governorates; fees in integer piastres)
-- ----------------------------------------------------------------------------
create table if not exists public.governorates (
  id                    smallint primary key,
  name_ar               text not null,
  name_en               text not null,
  shipping_fee_piastres integer not null default 0 check (shipping_fee_piastres >= 0),
  is_active             boolean not null default true,
  sort                  integer not null default 0
);

create table if not exists public.areas (
  id                  bigint generated always as identity primary key,
  governorate_id      smallint not null references public.governorates(id) on delete restrict,
  name_ar             text not null,
  name_en             text not null,
  pickup_fee_piastres integer not null default 0 check (pickup_fee_piastres >= 0),
  is_active           boolean not null default true,
  sort                integer not null default 0,
  -- composite uniqueness lets user_addresses guarantee area∈governorate
  constraint areas_id_governorate_key unique (id, governorate_id)
);

create index if not exists areas_governorate_idx on public.areas (governorate_id);

-- ----------------------------------------------------------------------------
-- 4) USER ADDRESSES
-- ----------------------------------------------------------------------------
create table if not exists public.user_addresses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,
  full_name      text not null,
  phone          text not null,
  governorate_id smallint not null references public.governorates(id) on delete restrict,
  area_id        bigint not null,
  address1       text not null,
  address2       text,
  postal_code    text,
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- an area must belong to the chosen governorate (enforced, not just UI)
  constraint user_addresses_area_in_governorate
    foreign key (area_id, governorate_id) references public.areas(id, governorate_id) on delete restrict
);

create index if not exists user_addresses_user_idx on public.user_addresses (user_id);

-- ----------------------------------------------------------------------------
-- 5) SETTINGS (key/value jsonb; public allowlist enforced by RLS)
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6) AUDIT LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx on public.audit_logs (entity, created_at desc);
create index if not exists audit_logs_actor_idx  on public.audit_logs (actor, created_at desc);

-- ----------------------------------------------------------------------------
-- 7) NOTIFICATIONS (F-17) — bilingual payload jsonb
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ----------------------------------------------------------------------------
-- 8) EMAIL LOGS + TEMPLATES (F-18)
-- ----------------------------------------------------------------------------
create table if not exists public.email_logs (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  template   text not null,
  provider   text not null default 'resend',
  status     text not null check (status in ('sent', 'failed', 'queued')),
  error      text,
  message_id text,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_created_idx on public.email_logs (created_at desc);

create table if not exists public.email_templates (
  key         text primary key,
  subject_ar  text not null,
  subject_en  text not null,
  html_ar     text not null,
  html_en     text not null,
  variables   jsonb not null default '[]'::jsonb,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER, pinned search_path)
-- ============================================================================

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists user_addresses_touch_updated_at on public.user_addresses;
create trigger user_addresses_touch_updated_at before update on public.user_addresses
  for each row execute function public.touch_updated_at();

-- The caller's stored role (reads the row, never the new values in a check).
create or replace function public.current_role_slug() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- RBAC from roles.permissions jsonb (admin bypasses; staff limited to matrix).
create or replace function public.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.permissions ? '*' or r.permissions ? p_permission
       from public.profiles p
       join public.roles r on r.slug = p.role
      where p.id = auth.uid()),
    false
  );
$$;

-- Explicit public-key allowlist (PLAN.md §8 risks: "explicit public-key allowlist").
-- 'media' (upload limits) joined in phase 02 — public config, no secrets.
create or replace function public.is_public_setting(p_key text) returns boolean
language sql stable as $$
  select p_key in ('site.general', 'settings.design', 'media');
$$;

-- ============================================================================
-- AUTH TRIGGER: profile bootstrap + OAuth merge (F-12: no duplicate profiles)
-- ============================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, locale, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone_e164', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'ar'),
    'customer'
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        phone     = coalesce(public.profiles.phone, excluded.phone);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RPCs
-- ============================================================================

-- F-10: phone → email resolution for login (anon-callable, read-only).
create or replace function public.fn_resolve_email_from_phone(p_phone_e164 text)
returns text
language sql stable security definer set search_path = public as $$
  select email from public.profiles where phone = p_phone_e164 limit 1;
$$;

revoke all on function public.fn_resolve_email_from_phone(text) from public;
grant execute on function public.fn_resolve_email_from_phone(text) to anon, authenticated;

-- Self-bootstrap: guarantee the caller has a profile row, return it.
create or replace function public.fn_bootstrap_profile()
returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_email   text;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    select email into v_email from auth.users where id = auth.uid();
    insert into public.profiles (id, email) values (auth.uid(), v_email)
      on conflict (id) do nothing
      returning * into v_profile;
  end if;
  return v_profile;
end $$;

revoke all on function public.fn_bootstrap_profile() from public;
grant execute on function public.fn_bootstrap_profile() to authenticated;

-- US-06: admin role change — authorized, last-admin-safe, audited.
create or replace function public.fn_admin_set_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.has_permission('users.manage') then
    raise exception 'not allowed: caller cannot change roles' using errcode = '42501';
  end if;
  if p_new_role not in ('admin', 'staff', 'vendor', 'customer') then
    raise exception 'invalid role %', p_new_role;
  end if;

  select role into v_old from public.profiles where id = p_user_id;
  if not found then
    raise exception 'target profile not found';
  end if;

  -- Guard: cannot demote the last admin (US-06 edge).
  if v_old = 'admin' and p_new_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot demote the last admin';
  end if;

  update public.profiles set role = p_new_role, updated_at = now() where id = p_user_id;

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    'role.change',
    'profiles',
    p_user_id::text,
    jsonb_build_object('role', v_old),
    jsonb_build_object('role', p_new_role)
  );
end $$;

revoke all on function public.fn_admin_set_role(uuid, text) from public, anon;
grant execute on function public.fn_admin_set_role(uuid, text) to authenticated;

-- ============================================================================
-- AUDIT TRIGGERS (F-08): every settings/roles change recorded with before/after
-- ============================================================================
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entity text := tg_table_name;
begin
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    lower(v_entity) || '.' || lower(tg_op),
    v_entity,
    coalesce(
      (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'key'),
      (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'slug')
    ),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists settings_audit on public.settings;
create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_row_change();

drop trigger if exists roles_audit on public.roles;
create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function public.audit_row_change();

-- settings.updated_by/updated_at maintenance
create or replace function public.settings_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists settings_before_write on public.settings;
create trigger settings_before_write before insert or update on public.settings
  for each row execute function public.settings_before_write();

-- ============================================================================
-- RLS (F-06): enable everywhere, explicit grants, one policy set per table
-- ============================================================================

alter table public.roles          enable row level security;
alter table public.profiles       enable row level security;
alter table public.user_addresses enable row level security;
alter table public.governorates   enable row level security;
alter table public.areas          enable row level security;
alter table public.settings       enable row level security;
alter table public.audit_logs     enable row level security;
alter table public.notifications  enable row level security;
alter table public.email_logs     enable row level security;
alter table public.email_templates enable row level security;

-- Default grants: nothing for anon/authenticated unless explicitly granted below.
revoke all on public.roles           from anon, authenticated;
revoke all on public.profiles        from anon, authenticated;
revoke all on public.user_addresses  from anon, authenticated;
revoke all on public.governorates    from anon, authenticated;
revoke all on public.areas           from anon, authenticated;
revoke all on public.settings        from anon, authenticated;
revoke all on public.audit_logs      from anon, authenticated;
revoke all on public.notifications   from anon, authenticated;
revoke all on public.email_logs      from anon, authenticated;
revoke all on public.email_templates from anon, authenticated;

-- roles: service_role only (definer functions read it server-side).
-- profiles: own row + permissioned staff/admin read.
-- Column-level grant: users can never write role/status themselves.
grant select on public.profiles to authenticated;
grant update (full_name, phone, avatar_url, locale) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.has_permission('users.read'));
-- Defense in depth: own-row update, role immutable even if grants change.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_slug());

-- user_addresses: strictly own rows.
grant select, insert, update, delete on public.user_addresses to authenticated;
create policy addresses_own_all on public.user_addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- governorates/areas: public read of active rows; authenticated read all.
grant select on public.governorates to anon, authenticated;
grant select on public.areas to anon, authenticated;
create policy governorates_read_active on public.governorates
  for select to anon using (is_active);
create policy governorates_read_all on public.governorates
  for select to authenticated using (true);
create policy areas_read_active on public.areas
  for select to anon using (is_active);
create policy areas_read_all on public.areas
  for select to authenticated using (true);

-- settings: explicit public allowlist + permissioned read/write.
grant select on public.settings to anon, authenticated;
grant insert, update, delete on public.settings to authenticated;
create policy settings_read_public on public.settings
  for select to anon, authenticated using (public.is_public_setting(key));
create policy settings_read_permissioned on public.settings
  for select to authenticated using (public.has_permission('settings.read'));
create policy settings_write_permissioned on public.settings
  for insert to authenticated with check (public.has_permission('settings.write'));
create policy settings_update_permissioned on public.settings
  for update to authenticated using (public.has_permission('settings.write'))
  with check (public.has_permission('settings.write'));
create policy settings_delete_permissioned on public.settings
  for delete to authenticated using (public.has_permission('settings.write'));

-- audit_logs: admin read-only; inserts happen via definer functions only.
grant select on public.audit_logs to authenticated;
create policy audit_read_admin on public.audit_logs
  for select to authenticated using (public.is_admin());

-- notifications: own rows; users may only flip read_at (column grant).
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- email_logs / email_templates: service_role only at this phase.

-- ============================================================================
-- REALTIME (F-17): broadcast notifications inserts to subscribed clients
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
