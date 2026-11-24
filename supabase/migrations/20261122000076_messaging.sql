-- 2026-11-22 (owner request): messages and notifications over email, SMS and
-- WhatsApp (Rasvio). One admin page decides, per audience and event, which
-- channels send and from which WhatsApp number. Phone numbers are verified
-- once by a code (sign-up, checkout, password reset).
--
-- Every table here is server-only: the app reads and writes them with the
-- service role after its own permission check, so RLS is on with no policy.

-- ── 1. WhatsApp numbers linked in Rasvio (each one is a session / instance)
create table if not exists public.wa_senders (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique check (session_id ~ '^ses_[A-Za-z0-9]{4,64}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  is_default boolean not null default false,
  is_active boolean not null default true,
  status text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create unique index if not exists wa_senders_one_default on public.wa_senders (is_default) where is_default;
alter table public.wa_senders enable row level security;

-- ── 2. which channels send each event, per audience
create table if not exists public.message_routes (
  event_key text not null check (char_length(event_key) between 1 and 80),
  audience text not null check (audience in ('customer', 'vendor', 'staff', 'admin', 'account')),
  enabled boolean not null default true,
  email boolean not null default false,
  sms boolean not null default false,
  whatsapp boolean not null default false,
  wa_sender_id uuid references public.wa_senders(id) on delete set null,
  -- staff only: who on the team receives it (a permission key)
  staff_permission text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (event_key, audience)
);
alter table public.message_routes enable row level security;

-- ── 3. SMS / WhatsApp wording (email keeps its own templates)
create table if not exists public.message_texts (
  event_key text not null check (char_length(event_key) between 1 and 80),
  channel text not null check (channel in ('sms', 'whatsapp')),
  body_ar text not null check (char_length(body_ar) between 1 and 1600),
  body_en text not null check (char_length(body_en) between 1 and 1600),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (event_key, channel)
);
alter table public.message_texts enable row level security;

-- ── 4. one row per message sent on any channel
create table if not exists public.message_deliveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  event_key text not null,
  audience text,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  user_id uuid references auth.users(id) on delete set null,
  to_address text not null,
  status text not null default 'queued',
  provider_id text,
  wa_sender_id uuid references public.wa_senders(id) on delete set null,
  error text,
  segments int,
  reference text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
);
create index if not exists message_deliveries_created on public.message_deliveries (created_at desc);
create index if not exists message_deliveries_provider on public.message_deliveries (provider_id) where provider_id is not null;
alter table public.message_deliveries enable row level security;

-- ── 5. phone codes (only the hash is kept)
create table if not exists public.phone_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null check (purpose in ('verify', 'checkout', 'reset')),
  user_id uuid references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  channel text,
  ip text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists phone_codes_phone on public.phone_codes (phone, created_at desc);
alter table public.phone_codes enable row level security;

alter table public.profiles add column if not exists phone_verified_at timestamptz;

create table if not exists public.user_verified_phones (
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at timestamptz not null default now(),
  primary key (user_id, phone)
);
alter table public.user_verified_phones enable row level security;
drop policy if exists user_verified_phones_own on public.user_verified_phones;
create policy user_verified_phones_own on public.user_verified_phones for select to authenticated using (user_id = auth.uid());

-- a number changed on the profile is no longer the verified one
create or replace function public.fn_profiles_phone_unverify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.phone is distinct from old.phone then
    new.phone_verified_at := case
      when new.phone is not null and exists (select 1 from public.user_verified_phones v where v.user_id = new.id and v.phone = new.phone)
      then now() else null end;
  end if;
  return new;
end $$;
drop trigger if exists profiles_phone_unverify on public.profiles;
create trigger profiles_phone_unverify before update of phone on public.profiles
  for each row execute function public.fn_profiles_phone_unverify();

-- ── 6. channel settings (no secrets here)
insert into public.settings (key, value)
values ('messaging', jsonb_build_object(
  'api_base', 'https://vjbzpwcbqtbqkwpxbkug.supabase.co/functions/v1/api',
  'otp_channels', jsonb_build_array('whatsapp', 'sms'),
  'otp_wa_sender', null,
  'sms_low_balance', 200))
on conflict (key) do nothing;

-- ── 7. Rasvio key and webhook secret in Supabase Vault (encrypted).
-- Written once from the admin page, never read back to a browser: the page
-- only learns whether each one is set and its last four characters.
create or replace function public.fn_admin_set_messaging_secret(p_name text, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_val text := btrim(coalesce(p_value, '')); v_full text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_name not in ('rasvio_api_key', 'rasvio_webhook_secret') then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  v_full := 'messaging.' || p_name;
  select id into v_id from vault.secrets where name = v_full;
  if v_val = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  if char_length(v_val) < 12 or char_length(v_val) > 512 or v_val ~ '\s' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_id is null then
    perform vault.create_secret(v_val, v_full, right(v_val, 4));
  else
    perform vault.update_secret(v_id, v_val, v_full, right(v_val, 4));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fn_admin_set_messaging_secret(text, text) from public, anon;
grant execute on function public.fn_admin_set_messaging_secret(text, text) to authenticated;

create or replace function public.fn_admin_messaging_secrets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'secrets', coalesce((
    select jsonb_object_agg(replace(s.name, 'messaging.', ''), jsonb_build_object('last4', s.description, 'updated_at', s.updated_at))
      from vault.secrets s where s.name like 'messaging.%'), '{}'::jsonb));
end $$;
revoke all on function public.fn_admin_messaging_secrets() from public, anon;
grant execute on function public.fn_admin_messaging_secrets() to authenticated;

-- the server (service role) reads the plain value; nobody else can
create or replace function public.fn_messaging_secret(p_name text)
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'messaging.' || p_name limit 1;
$$;
revoke all on function public.fn_messaging_secret(text) from public, anon, authenticated;
grant execute on function public.fn_messaging_secret(text) to service_role;

-- ── 8. team alerts reach staff who hold the matching permission
create or replace function public.fn_user_has_permission(p_user uuid, p_permission text)
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
    from public.profiles p
    left join public.roles r on r.slug = case when p.role = 'staff' then coalesce(p.staff_role, 'staff') else p.role end
    where p.id = p_user), false);
$$;
revoke all on function public.fn_user_has_permission(uuid, text) from public, anon, authenticated;

-- Admin alerts are written once per admin. The copy for the first admin
-- (a stable choice) also fans out to staff when the owner switched the
-- event on in the staff tab; staff copies carry "fanout" so they never
-- fan out again.
create or replace function public.fn_notifications_staff_fanout() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first uuid; v_perm text;
begin
  if coalesce(new.payload->>'fanout', '') = '1' then return new; end if;
  select r.staff_permission into v_perm from public.message_routes r
   where r.event_key = new.type and r.audience = 'staff' and r.enabled and r.staff_permission is not null;
  if v_perm is null then return new; end if;
  select p.id into v_first from public.profiles p where p.role = 'admin' and p.status <> 'blocked' order by p.created_at, p.id limit 1;
  if new.user_id is distinct from v_first then return new; end if;
  insert into public.notifications (user_id, type, payload)
    select p.id, new.type, coalesce(new.payload, '{}'::jsonb) || jsonb_build_object('fanout', '1')
      from public.profiles p
     where p.role = 'staff' and p.status <> 'blocked' and public.fn_user_has_permission(p.id, v_perm);
  return new;
end $$;
drop trigger if exists notifications_staff_fanout on public.notifications;
create trigger notifications_staff_fanout after insert on public.notifications
  for each row execute function public.fn_notifications_staff_fanout();

-- ── 9. new events: a seller's new order, and "shipped" for the shopper
create or replace function public.fn_notify_vendor_new_order(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select g2.id, g2.vendor_id, o.number, o.status, v.owner_id,
         g2.items_subtotal_piastres - g2.discount_piastres as amount
    into g
    from public.order_vendor_groups g2 join public.orders o on o.id = g2.order_id join public.vendors v on v.id = g2.vendor_id
   where g2.id = p_group;
  if g.owner_id is null or g.status = 'pending_payment' or g.status = 'cancelled' then return; end if;
  perform public.fn_notify(g.owner_id, 'vendor.new_order', jsonb_build_object(
    'ar', jsonb_build_object('title', 'طلب جديد رقم ' || g.number, 'body', 'وصل طلب جديد لمتجرك. جهّزه من صفحة الطلبات.'),
    'en', jsonb_build_object('title', 'New order ' || g.number, 'body', 'A new order arrived for your store. Prepare it from your orders page.'),
    'link', '/vendor/orders', 'order_number', g.number, 'group_id', g.id));
end $$;

create or replace function public.fn_ovg_new_order_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_notify_vendor_new_order(new.id);
  return new;
end $$;
drop trigger if exists ovg_new_order_notify on public.order_vendor_groups;
create trigger ovg_new_order_notify after insert on public.order_vendor_groups
  for each row execute function public.fn_ovg_new_order_notify();

-- a card order reaches the seller once it is paid
create or replace function public.fn_orders_paid_notify_vendors() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if old.status = 'pending_payment' and new.status = 'processing' then
    for r in select id from public.order_vendor_groups where order_id = new.id loop
      perform public.fn_notify_vendor_new_order(r.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists orders_paid_notify_vendors on public.orders;
create trigger orders_paid_notify_vendors after update of status on public.orders
  for each row execute function public.fn_orders_paid_notify_vendors();

create or replace function public.fn_ovg_shipped_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if new.status = 'handed_to_carrier' and old.status is distinct from 'handed_to_carrier' then
    select id, number, user_id into o from public.orders where id = new.order_id;
    if o.user_id is not null then
      perform public.fn_notify(o.user_id, 'order_shipped', jsonb_build_object(
        'ar', jsonb_build_object('title', 'طلبك ' || o.number || ' تم شحنه', 'body', 'طلبك في الطريق إليك. تابع حالته من صفحة الطلب.'),
        'en', jsonb_build_object('title', 'Order ' || o.number || ' has shipped', 'body', 'Your order is on its way. Follow it from the order page.'),
        'link', '/account/orders/' || o.number, 'order_number', o.number));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ovg_shipped_notify on public.order_vendor_groups;
create trigger ovg_shipped_notify after update of status on public.order_vendor_groups
  for each row execute function public.fn_ovg_shipped_notify();
