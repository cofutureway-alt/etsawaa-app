-- Vendor services (owner brief 2026-11-16 + "دليل الإعلانات للتجار"):
-- photography, video, editing / background removal, campaign management and
-- any other service the admin adds. A catalogue grouped by section; each
-- service is a fixed bundle, a per-unit price (photo, video …) or "on quote".
-- A vendor orders with a quantity, the products to work on, a brief and
-- reference images, pays by card (Kashier, "SV-" numbers) or from the
-- wallet, then follows the order: paid → scheduled → in progress → delivered
-- (files / links) → completed, with a timeline of every step. The admin can
-- price a quote, schedule, deliver, reject (refund to the wallet).

-- ── 1. catalogue
create table if not exists public.service_groups (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name_ar text not null,
  name_en text not null,
  desc_ar text not null default '',
  desc_en text not null default '',
  icon text not null default 'sparkles',
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.service_groups(id) on delete set null,
  code text unique,
  name_ar text not null,
  name_en text not null,
  desc_ar text not null default '',
  desc_en text not null default '',
  pricing text not null default 'fixed' check (pricing in ('fixed', 'per_unit', 'quote')),
  price_piastres integer not null default 0 check (price_piastres >= 0),
  unit_ar text not null default '',
  unit_en text not null default '',
  min_qty integer not null default 1 check (min_qty >= 1),
  max_qty integer not null default 1000 check (max_qty >= 1),
  -- what the vendor gets: [{ "ar": "...", "en": "..." }]
  includes jsonb not null default '[]'::jsonb,
  badge_ar text not null default '',
  badge_en text not null default '',
  delivery_days integer check (delivery_days is null or delivery_days > 0),
  cover_path text,
  needs_products boolean not null default false,
  sort integer not null default 0,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_qty >= min_qty)
);
create index if not exists services_group_idx on public.services (group_id, sort) where deleted_at is null;

alter table public.service_groups enable row level security;
alter table public.services enable row level security;
drop policy if exists service_groups_read on public.service_groups;
create policy service_groups_read on public.service_groups for select to authenticated
  using (is_active or public.has_permission('services.manage'));
drop policy if exists service_groups_admin on public.service_groups;
create policy service_groups_admin on public.service_groups for all to authenticated
  using (public.has_permission('services.manage')) with check (public.has_permission('services.manage'));
drop policy if exists services_read on public.services;
create policy services_read on public.services for select to authenticated
  using ((is_active and deleted_at is null) or public.has_permission('services.manage'));
drop policy if exists services_admin on public.services;
create policy services_admin on public.services for all to authenticated
  using (public.has_permission('services.manage')) with check (public.has_permission('services.manage'));
grant select, insert, update, delete on public.service_groups, public.services to authenticated;

-- ── 2. orders
create sequence if not exists public.service_order_seq;
create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  attempt_key uuid not null unique,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_snapshot jsonb not null,
  quantity integer not null default 1 check (quantity >= 1),
  amount_piastres integer not null default 0 check (amount_piastres >= 0),
  payment_method text check (payment_method is null or payment_method in ('card', 'wallet')),
  payment_mode text not null default 'live',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  kashier_session_id text,
  status text not null default 'pending_payment' check (status in
    ('awaiting_quote', 'pending_payment', 'new', 'scheduled', 'in_progress', 'delivered', 'completed', 'cancelled', 'rejected')),
  brief text not null default '',
  product_ids uuid[] not null default '{}',
  attachments text[] not null default '{}',
  preferred_date date,
  scheduled_at timestamptz,
  delivery_note text,
  delivered_files text[] not null default '{}',
  delivered_links text[] not null default '{}',
  quote_note text,
  reject_reason text,
  refund_method text check (refund_method is null or refund_method = 'wallet'),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz
);
create index if not exists service_orders_vendor_idx on public.service_orders (vendor_id, created_at desc);
create index if not exists service_orders_status_idx on public.service_orders (status, created_at);
alter table public.service_orders enable row level security;
drop policy if exists service_orders_read on public.service_orders;
create policy service_orders_read on public.service_orders for select to authenticated
  using (vendor_id = public.own_vendor_id() or public.has_permission('services.manage'));
grant select on public.service_orders to authenticated;

-- the order's timeline (status changes, notes, files)
create table if not exists public.service_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  kind text not null,
  note text,
  data jsonb not null default '{}'::jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index if not exists service_order_events_order_idx on public.service_order_events (order_id, created_at);
alter table public.service_order_events enable row level security;
drop policy if exists service_order_events_read on public.service_order_events;
create policy service_order_events_read on public.service_order_events for select to authenticated
  using (public.has_permission('services.manage')
         or exists (select 1 from public.service_orders o where o.id = order_id and o.vendor_id = public.own_vendor_id()));
grant select on public.service_order_events to authenticated;

create table if not exists public.service_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  amount_piastres integer not null,
  status text not null check (status in ('succeeded', 'failed')),
  failure_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
alter table public.service_order_payments enable row level security;
drop policy if exists service_order_payments_read on public.service_order_payments;
create policy service_order_payments_read on public.service_order_payments for select to authenticated
  using (public.has_permission('services.manage')
         or exists (select 1 from public.service_orders o where o.id = order_id and o.vendor_id = public.own_vendor_id()));
grant select on public.service_order_payments to authenticated;

-- wallet: service purchase / refund
alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type = any (array['earning', 'commission', 'pickup_fee',
  'shipping_revenue', 'penalty', 'ad_purchase', 'withdrawal', 'withdrawal_refund', 'refund_clawback', 'admin_adjustment',
  'packaging_balance', 'packaging_refund', 'ad_refund', 'service_purchase', 'service_refund']));

-- ── 3. helpers
create or replace function public.fn_service_event(p_order uuid, p_kind text, p_note text default null, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.service_order_events (order_id, kind, note, data, actor)
  values (p_order, p_kind, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_data, '{}'::jsonb), auth.uid());
$$;
revoke all on function public.fn_service_event(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.fn_service_notify_vendor(p_order public.service_orders, p_kind text, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.vendors where id = p_order.vendor_id;
  perform public.fn_notify(v_owner, p_kind, jsonb_build_object(
    'ar', jsonb_build_object('title', p_ar, 'body', coalesce(p_order.service_snapshot->>'name_ar', '') || ' · ' || p_order.number),
    'en', jsonb_build_object('title', p_en, 'body', coalesce(p_order.service_snapshot->>'name_en', '') || ' · ' || p_order.number),
    'link', '/vendor/services?tab=orders&order=' || p_order.number));
end $$;
revoke all on function public.fn_service_notify_vendor(public.service_orders, text, text, text) from public, anon, authenticated;

create or replace function public.fn_service_notify_admins(p_order public.service_orders, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' loop
    perform public.fn_notify(r.id, 'service_order', jsonb_build_object(
      'ar', jsonb_build_object('title', p_ar || ' ' || p_order.number, 'body', coalesce(p_order.service_snapshot->>'name_ar', '')),
      'en', jsonb_build_object('title', p_en || ' ' || p_order.number, 'body', coalesce(p_order.service_snapshot->>'name_en', '')),
      'link', '/admin/services?order=' || p_order.number));
  end loop;
end $$;
revoke all on function public.fn_service_notify_admins(public.service_orders, text, text) from public, anon, authenticated;

-- pay a priced order from the wallet (inside the caller's transaction)
create or replace function public.fn_service_take_wallet(p_order public.service_orders)
returns public.service_orders language plpgsql security definer set search_path = public as $$
declare v_wallet public.wallets%rowtype; v_out public.service_orders%rowtype;
begin
  if p_order.amount_piastres > 0 then
    select * into v_wallet from public.wallets where vendor_id = p_order.vendor_id for update;
    if coalesce(v_wallet.available_piastres, 0) < p_order.amount_piastres then
      raise exception 'insufficient_balance' using errcode = 'P0001';
    end if;
    perform public.fn_post_transaction(p_order.vendor_id, 'service_purchase', -p_order.amount_piastres, 'service:' || p_order.number,
      'Service ' || coalesce(p_order.service_snapshot->>'name_en', '') || ' (' || p_order.number || ')', null, null,
      jsonb_build_object('service_order', p_order.id));
  end if;
  update public.service_orders set status = 'new', payment_status = 'paid', payment_method = 'wallet', paid_at = now(), updated_at = now()
   where id = p_order.id returning * into v_out;
  perform public.fn_service_event(v_out.id, 'paid', null, jsonb_build_object('method', 'wallet', 'amount_piastres', v_out.amount_piastres));
  perform public.fn_service_notify_admins(v_out, 'طلب خدمة جديد', 'New service order');
  return v_out;
end $$;
revoke all on function public.fn_service_take_wallet(public.service_orders) from public, anon, authenticated;

-- ── 4. vendor places an order
create or replace function public.fn_vendor_place_service_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
  v_key uuid := nullif(p_payload->>'attempt_key', '')::uuid;
  v_method text := coalesce(nullif(p_payload->>'method', ''), 'card');
  v_svc public.services%rowtype;
  v_existing public.service_orders%rowtype;
  v_qty int; v_amount int; v_products uuid[]; v_files text[]; v_order public.service_orders%rowtype;
  v_date date;
begin
  perform public.fn_assert_my_store_operational();
  select * into v_vendor from public.vendors where id = public.own_vendor_id();
  if v_vendor.id is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_vendor.status in ('rejected', 'suspended') then return jsonb_build_object('ok', false, 'reason', 'store_not_active'); end if;
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'attempt_key_required'); end if;
  select * into v_existing from public.service_orders where attempt_key = v_key;
  if found then
    if v_existing.vendor_id <> v_vendor.id then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'number', v_existing.number, 'status', v_existing.status,
      'amount_piastres', v_existing.amount_piastres, 'method', v_existing.payment_method);
  end if;
  select * into v_svc from public.services where id = nullif(p_payload->>'service_id', '')::uuid;
  if not found or not v_svc.is_active or v_svc.deleted_at is not null then return jsonb_build_object('ok', false, 'reason', 'service_unavailable'); end if;
  if v_svc.pricing <> 'quote' and v_method not in ('card', 'wallet') then return jsonb_build_object('ok', false, 'reason', 'bad_method'); end if;

  v_qty := case when v_svc.pricing = 'fixed' then 1 else coalesce(nullif(p_payload->>'quantity', '')::int, v_svc.min_qty) end;
  if v_qty < v_svc.min_qty or v_qty > v_svc.max_qty then return jsonb_build_object('ok', false, 'reason', 'bad_quantity'); end if;

  -- only the vendor's own products; reference images only from their own folder
  select coalesce(array_agg(p.id), '{}') into v_products from public.products p
   where p.id = any (coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)) x), '{}'))
     and p.vendor_id = v_vendor.id and p.deleted_at is null;
  select coalesce(array_agg(x), '{}') into v_files from jsonb_array_elements_text(coalesce(p_payload->'attachments', '[]'::jsonb)) x
   where x ~ ('^u/' || auth.uid()::text || '/[A-Za-z0-9._-]+$');
  if array_length(v_files, 1) > 20 then return jsonb_build_object('ok', false, 'reason', 'too_many_files'); end if;
  begin v_date := nullif(p_payload->>'preferred_date', '')::date; exception when others then v_date := null; end;
  if v_date is not null and v_date < current_date then v_date := null; end if;

  v_amount := case v_svc.pricing when 'fixed' then v_svc.price_piastres when 'per_unit' then v_svc.price_piastres * v_qty else 0 end;
  insert into public.service_orders (number, attempt_key, vendor_id, service_id, service_snapshot, quantity, amount_piastres,
      payment_method, status, brief, product_ids, attachments, preferred_date, created_by)
  values ('SV-' || to_char(now(), 'YY') || lpad(nextval('public.service_order_seq')::text, 6, '0'), v_key, v_vendor.id, v_svc.id,
      to_jsonb(v_svc) - 'deleted_at' - 'created_at' - 'updated_at', v_qty, v_amount,
      case when v_svc.pricing = 'quote' then null else v_method end,
      case when v_svc.pricing = 'quote' then 'awaiting_quote' else 'pending_payment' end,
      left(coalesce(p_payload->>'brief', ''), 3000), v_products, v_files, v_date, auth.uid())
  returning * into v_order;
  perform public.fn_service_event(v_order.id, 'placed', null, jsonb_build_object('quantity', v_qty, 'amount_piastres', v_amount));

  if v_svc.pricing = 'quote' then
    perform public.fn_service_notify_admins(v_order, 'طلب عرض سعر لخدمة', 'Service quote request');
  elsif v_method = 'wallet' or v_amount = 0 then
    v_order := public.fn_service_take_wallet(v_order);
  end if;
  perform public.fn_audit('services.order_placed', 'service_orders', v_order.id::text, null,
    jsonb_build_object('number', v_order.number, 'amount_piastres', v_amount, 'method', v_order.payment_method));
  return jsonb_build_object('ok', true, 'number', v_order.number, 'status', v_order.status, 'amount_piastres', v_order.amount_piastres,
    'method', v_order.payment_method);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;
revoke all on function public.fn_vendor_place_service_order(jsonb) from public, anon;
grant execute on function public.fn_vendor_place_service_order(jsonb) to authenticated;

-- pay an order that waits for payment (a priced quote, or a card attempt
-- the vendor now settles from the wallet)
create or replace function public.fn_vendor_pay_service_wallet(p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.service_orders%rowtype;
begin
  perform public.fn_assert_my_store_operational();
  select * into v_order from public.service_orders where number = p_number and vendor_id = public.own_vendor_id() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_order.status <> 'pending_payment' then return jsonb_build_object('ok', false, 'reason', 'not_awaiting_payment'); end if;
  v_order := public.fn_service_take_wallet(v_order);
  return jsonb_build_object('ok', true, 'number', v_order.number, 'status', v_order.status);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;
grant execute on function public.fn_vendor_pay_service_wallet(text) to authenticated;

-- the card method is remembered when a Kashier session starts
create or replace function public.fn_vendor_mark_service_card(p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.service_orders set payment_method = 'card', updated_at = now()
   where number = p_number and vendor_id = public.own_vendor_id() and status = 'pending_payment';
  return jsonb_build_object('ok', found);
end $$;
grant execute on function public.fn_vendor_mark_service_card(text) to authenticated;

create or replace function public.fn_vendor_cancel_service_order(p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.service_orders%rowtype;
begin
  update public.service_orders set status = 'cancelled', updated_at = now()
   where number = p_number and vendor_id = public.own_vendor_id() and status in ('pending_payment', 'awaiting_quote')
  returning * into v_order;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_cancellable'); end if;
  perform public.fn_service_event(v_order.id, 'cancelled');
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_vendor_cancel_service_order(text) to authenticated;

-- delivered work: the vendor confirms it, or asks for changes
create or replace function public.fn_vendor_service_feedback(p_number text, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.service_orders%rowtype;
begin
  select * into v_order from public.service_orders where number = p_number and vendor_id = public.own_vendor_id() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_order.status <> 'delivered' then return jsonb_build_object('ok', false, 'reason', 'not_delivered'); end if;
  if p_action = 'accept' then
    update public.service_orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'completed', p_note);
  elsif p_action = 'revision' then
    if coalesce(trim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
    update public.service_orders set status = 'in_progress', updated_at = now() where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'revision', p_note);
    perform public.fn_service_notify_admins(v_order, 'طلب تعديل على خدمة', 'Revision requested');
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_vendor_service_feedback(text, text, text) to authenticated;

-- ── 5. card payment result (Kashier webhook / session read; service role)
create or replace function public.fn_confirm_service_payment(p_number text, p_provider_ref text, p_status text,
  p_amount_piastres integer, p_raw jsonb, p_mode text default 'live')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.service_orders%rowtype; v_ref text := coalesce(nullif(trim(p_provider_ref), ''), 'missing');
begin
  select * into v_order from public.service_orders where number = p_number for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if v_order.payment_mode is distinct from coalesce(p_mode, 'live') then return jsonb_build_object('ok', false, 'reason', 'mode_mismatch'); end if;
  if exists (select 1 from public.service_order_payments where provider = 'kashier' and provider_ref = v_ref) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if p_status = 'failed' then
    insert into public.service_order_payments (order_id, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload)
    values (v_order.id, 'kashier', v_ref, coalesce(p_amount_piastres, 0), 'failed', 'declined', coalesce(p_raw, '{}'::jsonb));
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  if v_order.status <> 'pending_payment' then
    insert into public.service_order_payments (order_id, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload)
    values (v_order.id, 'kashier', v_ref, coalesce(p_amount_piastres, 0), 'succeeded', 'order_not_awaiting_payment', coalesce(p_raw, '{}'::jsonb));
    return jsonb_build_object('ok', false, 'reason', 'not_awaiting_payment');
  end if;
  if p_amount_piastres is distinct from v_order.amount_piastres then
    insert into public.service_order_payments (order_id, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload)
    values (v_order.id, 'kashier', v_ref, coalesce(p_amount_piastres, 0), 'failed', 'amount_mismatch', coalesce(p_raw, '{}'::jsonb));
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  insert into public.service_order_payments (order_id, provider, provider_ref, amount_piastres, status, raw_payload)
  values (v_order.id, 'kashier', v_ref, p_amount_piastres, 'succeeded', coalesce(p_raw, '{}'::jsonb));
  update public.service_orders set status = 'new', payment_status = 'paid', payment_method = 'card', paid_at = now(), updated_at = now()
   where id = v_order.id returning * into v_order;
  perform public.fn_service_event(v_order.id, 'paid', null, jsonb_build_object('method', 'card', 'amount_piastres', v_order.amount_piastres));
  perform public.fn_service_notify_admins(v_order, 'طلب خدمة جديد', 'New service order');
  perform public.fn_service_notify_vendor(v_order, 'service_paid', 'تم استلام طلب الخدمة', 'Service order received');
  return jsonb_build_object('ok', true, 'status', 'succeeded');
end $$;
revoke all on function public.fn_confirm_service_payment(text, text, text, integer, jsonb, text) from public, anon, authenticated;

-- ── 6. the team works the order
-- actions: quote {amount_piastres, note} · schedule {scheduled_at, note} · start · deliver {files[], links[], note}
--          complete · note {note} · reject {reason}
create or replace function public.fn_admin_service_order(p_order uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.service_orders%rowtype; v_note text := nullif(trim(coalesce(p_payload->>'note', '')), '');
  v_amount int; v_when timestamptz; v_files text[]; v_links text[];
begin
  if not public.has_permission('services.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_order from public.service_orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if p_action = 'quote' then
    if v_order.status not in ('awaiting_quote', 'pending_payment') then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
    v_amount := nullif(p_payload->>'amount_piastres', '')::int;
    if v_amount is null or v_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
    update public.service_orders set amount_piastres = v_amount, status = 'pending_payment', quote_note = v_note, updated_at = now()
     where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'quoted', v_note, jsonb_build_object('amount_piastres', v_amount));
    perform public.fn_service_notify_vendor(v_order, 'service_quoted', 'وصلك عرض سعر للخدمة', 'Your service quote is ready');
  elsif p_action = 'schedule' then
    if v_order.status not in ('new', 'scheduled') then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
    begin v_when := (p_payload->>'scheduled_at')::timestamptz; exception when others then v_when := null; end;
    if v_when is null then return jsonb_build_object('ok', false, 'reason', 'date_required'); end if;
    update public.service_orders set status = 'scheduled', scheduled_at = v_when, updated_at = now() where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'scheduled', v_note, jsonb_build_object('scheduled_at', v_when));
    perform public.fn_service_notify_vendor(v_order, 'service_scheduled', 'تم تحديد موعد الخدمة', 'Your service is scheduled');
  elsif p_action = 'start' then
    if v_order.status not in ('new', 'scheduled') then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
    update public.service_orders set status = 'in_progress', updated_at = now() where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'started', v_note);
    perform public.fn_service_notify_vendor(v_order, 'service_started', 'بدأ تنفيذ خدمتك', 'Work on your service has started');
  elsif p_action = 'deliver' then
    if v_order.status not in ('new', 'scheduled', 'in_progress', 'delivered') then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
    select coalesce(array_agg(x), '{}') into v_files from jsonb_array_elements_text(coalesce(p_payload->'files', '[]'::jsonb)) x
     where x ~ '^u/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$';
    select coalesce(array_agg(trim(x)), '{}') into v_links from jsonb_array_elements_text(coalesce(p_payload->'links', '[]'::jsonb)) x
     where trim(x) ~ '^https://[^\s]+$';
    if coalesce(array_length(v_files, 1), 0) + coalesce(array_length(v_links, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'files_required');
    end if;
    update public.service_orders set status = 'delivered', delivered_files = v_files, delivered_links = v_links,
           delivery_note = v_note, delivered_at = now(), updated_at = now()
     where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'delivered', v_note,
      jsonb_build_object('files', coalesce(array_length(v_files, 1), 0), 'links', coalesce(array_length(v_links, 1), 0)));
    perform public.fn_service_notify_vendor(v_order, 'service_delivered', 'تم تسليم خدمتك', 'Your service is delivered');
  elsif p_action = 'complete' then
    if v_order.status not in ('delivered', 'in_progress') then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
    update public.service_orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_order.id returning * into v_order;
    perform public.fn_service_event(v_order.id, 'completed', v_note);
  elsif p_action = 'note' then
    if v_note is null then return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
    perform public.fn_service_event(v_order.id, 'note', v_note);
    if coalesce((p_payload->>'notify')::boolean, false) then
      perform public.fn_service_notify_vendor(v_order, 'service_note', 'رسالة جديدة على طلب الخدمة', 'New message on your service order');
    end if;
  elsif p_action = 'reject' then
    if v_order.status in ('completed', 'cancelled', 'rejected') then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
    if v_note is null then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    update public.service_orders set status = 'rejected', reject_reason = v_note, updated_at = now() where id = v_order.id returning * into v_order;
    if v_order.payment_status = 'paid' and v_order.amount_piastres > 0 then
      perform public.fn_post_transaction(v_order.vendor_id, 'service_refund', v_order.amount_piastres, 'service-refund:' || v_order.number,
        'Refund of service order ' || v_order.number, null, null, jsonb_build_object('service_order', v_order.id));
      update public.service_orders set payment_status = 'refunded', refund_method = 'wallet', refunded_at = now() where id = v_order.id returning * into v_order;
    end if;
    perform public.fn_service_event(v_order.id, 'rejected', v_note, jsonb_build_object('refunded', v_order.payment_status = 'refunded'));
    perform public.fn_service_notify_vendor(v_order, 'service_rejected', 'تم إلغاء طلب الخدمة', 'Your service order was cancelled');
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_action');
  end if;
  perform public.fn_audit('services.order_' || p_action, 'service_orders', v_order.id::text, null,
    jsonb_build_object('number', v_order.number, 'status', v_order.status));
  return jsonb_build_object('ok', true, 'status', v_order.status);
end $$;
revoke all on function public.fn_admin_service_order(uuid, text, jsonb) from public, anon;
grant execute on function public.fn_admin_service_order(uuid, text, jsonb) to authenticated;

-- ── 7. sidebar badge: orders waiting for the team
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_admin_nav_counts'::regproc) into v_src;
  if position('service_orders' in v_src) > 0 then return; end if;
  v_new := replace(v_src, '  return r;
end',
'  if public.has_permission(''services.manage'') then
    r := r || jsonb_build_object(''services'', (select count(*) from public.service_orders where status in (''new'', ''awaiting_quote'')));
  end if;
  return r;
end');
  if v_new = v_src then raise exception 'fn_admin_nav_counts changed shape; patch not applied'; end if;
  execute v_new;
end $$;

-- photography / campaign management now live in the services catalogue
update public.ad_placements set is_active = false where code in ('photography', 'campaign_management');

-- ── 8. the catalogue from "دليل الإعلانات للتجار" (prices as published)
insert into public.service_groups (code, name_ar, name_en, desc_ar, desc_en, icon, sort) values
  ('photography', 'تصوير المنتجات', 'Product photography',
   'مصور محترف وكاميرا عالية الجودة، على خلفية بيضاء ومن غير رقم تليفون أو علامة مائية أو إشارات دعائية.',
   'A professional photographer and a high-end camera, on a white background with no phone number, watermark or promo marks.', 'camera', 1),
  ('video', 'فيديو المنتجات', 'Product video',
   'فيديوهات قصيرة تعرض منتجك بنفس معايير الجودة — من لقطة سريعة لحد فيديو باستوديو وموديل واسكريبت.',
   'Short videos that show your product to the same quality standard — from a quick clip to a studio video with a model and a script.', 'video', 2),
  ('editing', 'المونتاج وتعديل الصور', 'Editing & retouching',
   'إزالة الخلفية وتجهيز صورك الحالية ومونتاج الفيديوهات.',
   'Background removal, retouching your existing photos and video editing.', 'wand', 3),
  ('starter', 'باقات البائع الجديد', 'New vendor bundles',
   'كل اللي محتاجه عشان تبدأ بصور وفيديو احترافي من أول يوم.',
   'Everything you need to start with professional photos and video from day one.', 'rocket', 4),
  ('marketing', 'إدارة الحملات', 'Campaign management',
   'فريق المنصة يكتب محتوى إعلانك ويصمم صوره.',
   'The platform team writes your ad copy and designs its images.', 'megaphone', 5)
on conflict (code) do nothing;

with g as (select code, id from public.service_groups)
insert into public.services (group_id, code, name_ar, name_en, desc_ar, desc_en, pricing, price_piastres, unit_ar, unit_en,
                             min_qty, max_qty, includes, badge_ar, badge_en, needs_products, sort)
select g.id, s.code, s.name_ar, s.name_en, s.desc_ar, s.desc_en, s.pricing, s.price, s.unit_ar, s.unit_en, s.min_q, s.max_q,
       s.includes::jsonb, s.badge_ar, s.badge_en, s.needs_products, s.sort
  from (values
    ('photography', 'photo_100', 'تصوير 100 صورة', '100 product photos', 'باقة تصوير لـ 100 صورة احترافية لمنتجاتك.', 'A shoot of 100 professional photos of your products.',
     'fixed', 100000, '', '', 1, 1,
     '[{"ar":"100 صورة احترافية","en":"100 professional photos"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"},{"ar":"بدون رقم تليفون أو علامة مائية","en":"No phone number or watermark"},{"ar":"يعني 10 جنيه للصورة","en":"That is EGP 10 per photo"}]',
     '', '', true, 1),
    ('photography', 'photo_200', 'تصوير 200 صورة', '200 product photos', 'باقة تصوير لـ 200 صورة احترافية لمنتجاتك.', 'A shoot of 200 professional photos of your products.',
     'fixed', 150000, '', '', 1, 1,
     '[{"ar":"200 صورة احترافية","en":"200 professional photos"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"},{"ar":"بدون رقم تليفون أو علامة مائية","en":"No phone number or watermark"},{"ar":"يعني 7.50 جنيه للصورة","en":"That is EGP 7.50 per photo"}]',
     '', '', true, 2),
    ('photography', 'photo_500', 'تصوير 500 صورة', '500 product photos', 'باقة تصوير لـ 500 صورة احترافية — الأوفر لو عندك منتجات كتير.', 'A shoot of 500 professional photos — the best value for a large catalogue.',
     'fixed', 250000, '', '', 1, 1,
     '[{"ar":"500 صورة احترافية","en":"500 professional photos"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"},{"ar":"بدون رقم تليفون أو علامة مائية","en":"No phone number or watermark"},{"ar":"يعني 5 جنيه للصورة","en":"That is EGP 5 per photo"}]',
     '', '', true, 3),
    ('photography', 'photo_extra', 'صورة إضافية خارج الباقات', 'Extra photo', 'صور زيادة بالعدد اللي تحتاجه، بنفس الجودة.', 'As many extra photos as you need, at the same quality.',
     'per_unit', 1500, 'صورة', 'photo', 1, 1000,
     '[{"ar":"اختار العدد اللي تحتاجه","en":"Choose the number you need"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"}]',
     '', '', true, 4),
    ('photography', 'photo_lifestyle', 'صورة لايف ستايل / بموديل', 'Lifestyle / model photo', 'صور لمنتجك وهو مستخدم في الحياة الطبيعية أو مع موديل.', 'Photos of your product in use, in a real setting or with a model.',
     'per_unit', 5000, 'صورة', 'photo', 1, 500,
     '[{"ar":"تصوير في مكان طبيعي أو مع موديل","en":"Shot in a real setting or with a model"},{"ar":"اختار العدد اللي تحتاجه","en":"Choose the number you need"}]',
     '', '', true, 5),
    ('video', 'video_30', 'فيديو منتج 15 – 30 ثانية', 'Product video, 15–30 seconds', 'فيديو قصير يعرض منتجك.', 'A short video showing your product.',
     'per_unit', 30000, 'فيديو', 'video', 1, 100,
     '[{"ar":"مدة 15 – 30 ثانية","en":"15–30 seconds long"},{"ar":"بدون رقم تليفون أو علامة مائية","en":"No phone number or watermark"}]',
     '', '', true, 1),
    ('video', 'video_60', 'فيديو منتج 30 – 60 ثانية', 'Product video, 30–60 seconds', 'فيديو يعرض منتجك بتفاصيل أكتر.', 'A video showing your product in more detail.',
     'per_unit', 50000, 'فيديو', 'video', 1, 100,
     '[{"ar":"مدة 30 – 60 ثانية","en":"30–60 seconds long"},{"ar":"بدون رقم تليفون أو علامة مائية","en":"No phone number or watermark"}]',
     '', '', true, 2),
    ('video', 'video_60_studio', 'فيديو 60 ثانية + موديل + اسكريبت + استوديو', '60-second video + model + script + studio', 'فيديو احترافي كامل: اسكريبت وموديل وتصوير في استوديو.', 'A complete professional video: script, model and a studio shoot.',
     'per_unit', 75000, 'فيديو', 'video', 1, 50,
     '[{"ar":"مدة 60 ثانية","en":"60 seconds long"},{"ar":"موديل","en":"Model"},{"ar":"كتابة الاسكريبت","en":"Script writing"},{"ar":"تصوير في استوديو","en":"Studio shoot"}]',
     '', '', true, 3),
    ('video', 'video_120_studio', 'فيديو دقيقتين + موديل + اسكريبت + استوديو', '2-minute video + model + script + studio', 'فيديو احترافي طويل لعرض منتجك بالتفصيل.', 'A long professional video that presents your product in detail.',
     'per_unit', 100000, 'فيديو', 'video', 1, 50,
     '[{"ar":"مدة دقيقتين","en":"2 minutes long"},{"ar":"موديل","en":"Model"},{"ar":"كتابة الاسكريبت","en":"Script writing"},{"ar":"تصوير في استوديو","en":"Studio shoot"}]',
     '', '', true, 4),
    ('editing', 'bg_removal', 'إزالة الخلفية (خلفية بيضاء)', 'Background removal (white background)', 'نقص منتجك من صورتك الحالية ونحطه على خلفية بيضاء نظيفة.', 'We cut your product out of your existing photo and place it on a clean white background.',
     'per_unit', 500, 'صورة', 'photo', 1, 5000,
     '[{"ar":"قص دقيق لحواف المنتج","en":"Precise cut-out of the product edges"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"},{"ar":"ارفع صورك أو اختار منتجاتك","en":"Upload your photos or pick your products"}]',
     '', '', true, 1),
    ('editing', 'video_editing', 'مونتاج فيديو', 'Video editing', 'مونتاج فيديوهاتك الحالية: قص وترتيب ونصوص وموسيقى — السعر حسب المطلوب.', 'Editing your existing videos: cuts, order, text and music — priced to the job.',
     'quote', 0, '', '', 1, 1,
     '[{"ar":"ابعت تفاصيل المطلوب","en":"Send the details of what you need"},{"ar":"يوصلك عرض سعر وتدفع بعد الموافقة","en":"You get a quote and pay once you accept it"}]',
     '', '', false, 2),
    ('starter', 'starter_pack', 'باقة انطلاق: 30 صورة + فيديو 30 ثانية', 'Starter pack: 30 photos + a 30-second video', 'ابدأ متجرك بصور وفيديو احترافي بسعر خاص.', 'Launch your store with professional photos and video at a special price.',
     'fixed', 70000, '', '', 1, 1,
     '[{"ar":"30 صورة احترافية","en":"30 professional photos"},{"ar":"فيديو 30 ثانية","en":"A 30-second video"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"}]',
     'للبائع الجديد', 'For new vendors', true, 1),
    ('marketing', 'campaign_mgmt', 'إدارة الحملة', 'Campaign management', 'فريق المنصة يكتب لك المحتوى ويصمم لك صور الإعلان.', 'The platform team writes your copy and designs your ad images.',
     'fixed', 50000, '', '', 1, 1,
     '[{"ar":"كتابة محتوى الإعلان","en":"Ad copy writing"},{"ar":"تصميم صور الإعلان","en":"Ad image design"},{"ar":"500 جنيه للحملة أو 15% من الإنفاق للحملات الكبيرة","en":"EGP 500 per campaign, or 15% of spend for large campaigns"}]',
     '', '', false, 1)
  ) as s(grp, code, name_ar, name_en, desc_ar, desc_en, pricing, price, unit_ar, unit_en, min_q, max_q, includes, badge_ar, badge_en, needs_products, sort)
  join g on g.code = s.grp
on conflict (code) do nothing;

notify pgrst, 'reload schema';
