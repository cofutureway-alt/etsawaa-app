-- ============================================================================
-- Packaging — sellers buy packaging materials from the platform
--
-- Catalog (admin): packaging_items with price, optional per-metre price for
-- rolls, image, stock in BASE units (pieces, or metres for rolls).
-- Orders (seller): two plans
--   full   → card (Kashier) or cash on delivery, normal shipping fee
--   split  → 50% deposit by card now; the other 50% becomes an OPEN balance
--            on the seller's account, collected from the wallet when the
--            seller's next customer order is delivered (fn_post_earnings).
--            One balance row per order + row lock + unique ledger reference
--            ⇒ it can never be collected twice.
-- Payments: packaging_payments (one row per attempt; (provider, ref) unique
-- ⇒ webhook retries are no-ops; failures stay visible; the seller retries).
-- Returns: seller requests (or admin creates) → approve → receive (restock)
-- → refund (to wallet, or recorded against the original payment); an open
-- balance is reduced first so the seller never pays for what came back.
-- Every transition writes packaging_events + audit_logs.
-- ============================================================================
begin;

insert into public.settings (key, value)
values ('packaging', jsonb_build_object('split_enabled', true, 'split_percent', 50, 'max_open_balances', 1,
                                        'return_window_days', 14, 'cod_enabled', true))
on conflict (key) do nothing;

-- catalog ----------------------------------------------------------------------
create table if not exists public.packaging_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  category text not null default 'other' check (category in ('envelope', 'bubble_wrap', 'box', 'tape', 'other')),
  name_ar text not null check (length(trim(name_ar)) between 1 and 160),
  name_en text not null check (length(trim(name_en)) between 1 and 160),
  description_ar text not null default '',
  description_en text not null default '',
  unit text not null default 'piece' check (unit in ('piece', 'roll')),
  roll_length_m integer check (roll_length_m is null or roll_length_m > 0),
  spec_ar text not null default '',
  spec_en text not null default '',
  price_piastres integer not null check (price_piastres > 0),
  meter_price_piastres integer check (meter_price_piastres is null or meter_price_piastres > 0),
  stock_base integer not null default 0 check (stock_base >= 0),
  min_qty integer not null default 1 check (min_qty >= 1),
  max_qty integer check (max_qty is null or max_qty >= 1),
  image_path text,
  is_active boolean not null default true,
  sort integer not null default 0,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_roll_length check (unit <> 'roll' or roll_length_m is not null),
  constraint packaging_meter_needs_roll check (meter_price_piastres is null or unit = 'roll')
);

-- orders -----------------------------------------------------------------------
create sequence if not exists public.packaging_order_seq;
create table if not exists public.packaging_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  attempt_key uuid not null unique,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  status text not null check (status in ('pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_plan text not null check (payment_plan in ('full', 'split')),
  payment_method text not null check (payment_method in ('card', 'cod')),
  payment_status text not null check (payment_status in ('unpaid', 'deposit_paid', 'paid', 'cod_pending', 'refunded', 'partially_refunded')),
  subtotal_piastres integer not null check (subtotal_piastres > 0),
  shipping_fee_piastres integer not null default 0 check (shipping_fee_piastres >= 0),
  total_piastres integer not null check (total_piastres > 0),
  deposit_piastres integer not null default 0 check (deposit_piastres >= 0),
  paid_piastres integer not null default 0 check (paid_piastres >= 0),
  refunded_piastres integer not null default 0 check (refunded_piastres >= 0),
  ship_name text not null default '',
  ship_phone text,
  ship_address text not null default '',
  governorate_id smallint references public.governorates(id),
  area_id bigint references public.areas(id),
  carrier text,
  tracking_number text,
  notes text not null default '',
  cancel_reason text,
  confirmed_at timestamptz, shipped_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_total_consistent check (total_piastres = subtotal_piastres + shipping_fee_piastres),
  constraint packaging_split_card check (payment_plan = 'full' or payment_method = 'card')
);
create index if not exists packaging_orders_vendor_idx on public.packaging_orders (vendor_id, created_at desc);
create index if not exists packaging_orders_status_idx on public.packaging_orders (status, created_at desc);

create table if not exists public.packaging_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.packaging_orders(id) on delete cascade,
  item_id uuid not null references public.packaging_items(id) on delete restrict,
  sku text not null,
  name_ar text not null,
  name_en text not null,
  unit text not null check (unit in ('piece', 'roll', 'meter')),
  qty integer not null check (qty > 0),
  base_qty integer not null check (base_qty > 0),
  unit_price_piastres integer not null check (unit_price_piastres > 0),
  line_total_piastres integer not null check (line_total_piastres > 0),
  unique (order_id, item_id, unit)
);
create index if not exists packaging_order_items_order_idx on public.packaging_order_items (order_id);

create table if not exists public.packaging_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.packaging_orders(id) on delete cascade,
  kind text not null check (kind in ('full', 'deposit', 'balance', 'cod', 'refund', 'overpayment')),
  method text not null check (method in ('card', 'cod', 'wallet', 'manual')),
  provider text not null default 'kashier',
  provider_ref text not null,
  amount_piastres integer not null check (amount_piastres >= 0),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  failure_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index if not exists packaging_payments_order_idx on public.packaging_payments (order_id, created_at);

create table if not exists public.packaging_balances (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  order_id uuid not null unique references public.packaging_orders(id) on delete restrict,
  amount_piastres integer not null check (amount_piastres >= 0),
  original_piastres integer not null check (original_piastres >= 0),
  status text not null default 'open' check (status in ('open', 'collected', 'cancelled', 'settled_by_return')),
  collected_at timestamptz,
  collected_order_id uuid references public.orders(id) on delete set null,
  collected_group_id uuid references public.order_vendor_groups(id) on delete set null,
  wallet_tx_id uuid references public.wallet_transactions(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists packaging_balances_open_idx on public.packaging_balances (vendor_id) where status = 'open';

create table if not exists public.packaging_returns (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  order_id uuid not null references public.packaging_orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  source text not null default 'vendor' check (source in ('vendor', 'admin')),
  status text not null check (status in ('requested', 'approved', 'received', 'refunded', 'rejected')),
  reason text not null default '',
  admin_note text,
  refund_piastres integer not null default 0 check (refund_piastres >= 0),
  refund_method text check (refund_method is null or refund_method in ('wallet', 'original')),
  refund_reference text,
  balance_offset_piastres integer not null default 0 check (balance_offset_piastres >= 0),
  restocked boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz, received_at timestamptz, refunded_at timestamptz
);
create index if not exists packaging_returns_order_idx on public.packaging_returns (order_id);
create table if not exists public.packaging_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.packaging_returns(id) on delete cascade,
  order_item_id uuid not null references public.packaging_order_items(id) on delete cascade,
  qty integer not null check (qty > 0),
  unique (return_id, order_item_id)
);

create table if not exists public.packaging_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.packaging_orders(id) on delete cascade,
  return_id uuid references public.packaging_returns(id) on delete cascade,
  event text not null,
  note text,
  meta jsonb not null default '{}'::jsonb,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists packaging_events_order_idx on public.packaging_events (order_id, created_at);

-- RLS: sellers read their own; admins read all; writes go through functions,
-- except the admin catalog (policies below)
alter table public.packaging_items enable row level security;
alter table public.packaging_orders enable row level security;
alter table public.packaging_order_items enable row level security;
alter table public.packaging_payments enable row level security;
alter table public.packaging_balances enable row level security;
alter table public.packaging_returns enable row level security;
alter table public.packaging_return_items enable row level security;
alter table public.packaging_events enable row level security;

drop policy if exists packaging_items_read on public.packaging_items;
create policy packaging_items_read on public.packaging_items for select
  using (public.is_admin() or (is_active and deleted_at is null and public.own_vendor_id() is not null));
drop policy if exists packaging_items_admin_insert on public.packaging_items;
create policy packaging_items_admin_insert on public.packaging_items for insert with check (public.is_admin());
drop policy if exists packaging_items_admin_update on public.packaging_items;
create policy packaging_items_admin_update on public.packaging_items for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists packaging_orders_read on public.packaging_orders;
create policy packaging_orders_read on public.packaging_orders for select
  using (public.is_admin() or vendor_id = public.own_vendor_id());
drop policy if exists packaging_order_items_read on public.packaging_order_items;
create policy packaging_order_items_read on public.packaging_order_items for select
  using (exists (select 1 from public.packaging_orders o where o.id = order_id
                  and (public.is_admin() or o.vendor_id = public.own_vendor_id())));
drop policy if exists packaging_payments_read on public.packaging_payments;
create policy packaging_payments_read on public.packaging_payments for select
  using (exists (select 1 from public.packaging_orders o where o.id = order_id
                  and (public.is_admin() or o.vendor_id = public.own_vendor_id())));
drop policy if exists packaging_balances_read on public.packaging_balances;
create policy packaging_balances_read on public.packaging_balances for select
  using (public.is_admin() or vendor_id = public.own_vendor_id());
drop policy if exists packaging_returns_read on public.packaging_returns;
create policy packaging_returns_read on public.packaging_returns for select
  using (public.is_admin() or vendor_id = public.own_vendor_id());
drop policy if exists packaging_return_items_read on public.packaging_return_items;
create policy packaging_return_items_read on public.packaging_return_items for select
  using (exists (select 1 from public.packaging_returns r where r.id = return_id
                  and (public.is_admin() or r.vendor_id = public.own_vendor_id())));
drop policy if exists packaging_events_read on public.packaging_events;
create policy packaging_events_read on public.packaging_events for select
  using (exists (select 1 from public.packaging_orders o where o.id = order_id
                  and (public.is_admin() or o.vendor_id = public.own_vendor_id())));

grant select, insert, update on public.packaging_items to authenticated;
grant select on public.packaging_orders, public.packaging_order_items, public.packaging_payments,
  public.packaging_balances, public.packaging_returns, public.packaging_return_items, public.packaging_events to authenticated;

-- helpers ----------------------------------------------------------------------
create or replace function public.fn_packaging_settings()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'split_enabled', coalesce((s.value->>'split_enabled')::boolean, true),
    'split_percent', least(greatest(coalesce((s.value->>'split_percent')::int, 50), 1), 99),
    'max_open_balances', greatest(coalesce((s.value->>'max_open_balances')::int, 1), 0),
    'return_window_days', greatest(coalesce((s.value->>'return_window_days')::int, 14), 0),
    'cod_enabled', coalesce((s.value->>'cod_enabled')::boolean, true))
  from (select (select value from public.settings where key = 'packaging') as value) s;
$$;

create or replace function public.fn_packaging_event(p_order uuid, p_return uuid, p_event text, p_note text, p_meta jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.packaging_events (order_id, return_id, event, note, meta, actor)
  values (p_order, p_return, p_event, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_meta, '{}'::jsonb), auth.uid());
$$;

create or replace function public.fn_packaging_notify_admins(p_type text, p_ar text, p_en text, p_link text)
returns void
language sql security definer set search_path = public as $$
  select public.fn_notify(p.id, p_type, jsonb_build_object(
    'ar', jsonb_build_object('title', p_ar, 'body', ''), 'en', jsonb_build_object('title', p_en, 'body', ''), 'link', p_link))
  from public.profiles p where p.role = 'admin';
$$;

-- what the seller must pay now for an awaiting-payment order
create or replace function public.fn_packaging_due_now(p_order public.packaging_orders)
returns integer
language sql immutable as $$
  select case when p_order.status <> 'pending_payment' then 0
              when p_order.payment_plan = 'split' then p_order.deposit_piastres
              else p_order.total_piastres end;
$$;

-- place an order (seller) ---------------------------------------------------------
create or replace function public.fn_vendor_place_packaging_order(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
  v_cfg jsonb := public.fn_packaging_settings();
  v_key uuid := nullif(p_payload->>'attempt_key', '')::uuid;
  v_plan text := coalesce(p_payload->>'plan', 'full');
  v_method text := coalesce(p_payload->>'method', 'card');
  v_existing public.packaging_orders%rowtype;
  v_line record; v_item public.packaging_items%rowtype;
  v_base int; v_price int; v_sub int := 0; v_ship int; v_total int; v_deposit int := 0;
  v_order public.packaging_orders%rowtype;
  v_gov text; v_area text;
begin
  perform public.fn_assert_my_store_operational();
  select * into v_vendor from public.vendors where id = public.own_vendor_id();
  if v_vendor.id is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_vendor.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'store_not_active'); end if;
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'attempt_key_required'); end if;
  select * into v_existing from public.packaging_orders where attempt_key = v_key;
  if found then
    if v_existing.vendor_id <> v_vendor.id then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'number', v_existing.number,
      'status', v_existing.status, 'due_now_piastres', public.fn_packaging_due_now(v_existing));
  end if;
  if v_plan not in ('full', 'split') or v_method not in ('card', 'cod') then
    return jsonb_build_object('ok', false, 'reason', 'bad_plan');
  end if;
  if v_plan = 'split' and v_method <> 'card' then return jsonb_build_object('ok', false, 'reason', 'split_requires_card'); end if;
  if v_plan = 'split' and not (v_cfg->>'split_enabled')::boolean then return jsonb_build_object('ok', false, 'reason', 'split_disabled'); end if;
  if v_method = 'cod' and not (v_cfg->>'cod_enabled')::boolean then return jsonb_build_object('ok', false, 'reason', 'cod_disabled'); end if;
  if v_plan = 'split' and (select count(*) from public.packaging_balances b
                            where b.vendor_id = v_vendor.id and b.status = 'open')
                          + (select count(*) from public.packaging_orders o
                              where o.vendor_id = v_vendor.id and o.payment_plan = 'split' and o.status = 'pending_payment')
                          >= (v_cfg->>'max_open_balances')::int then
    return jsonb_build_object('ok', false, 'reason', 'open_balance_exists');
  end if;
  if jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_items');
  end if;

  select g.name_ar, a.name_ar into v_gov, v_area from public.governorates g
    left join public.areas a on a.id = v_vendor.area_id where g.id = v_vendor.governorate_id;
  select coalesce(shipping_fee_piastres, 0) into v_ship from public.governorates where id = v_vendor.governorate_id;
  v_ship := coalesce(v_ship, 0);

  insert into public.packaging_orders (number, attempt_key, vendor_id, created_by, status, payment_plan, payment_method,
      payment_status, subtotal_piastres, shipping_fee_piastres, total_piastres, ship_name, ship_phone, ship_address,
      governorate_id, area_id, notes)
  values ('PKG-' || to_char(now(), 'YY') || lpad(nextval('public.packaging_order_seq')::text, 6, '0'), v_key, v_vendor.id,
      auth.uid(), 'pending_payment', v_plan, v_method, 'unpaid', 1, v_ship, 1 + v_ship,
      trim(coalesce(v_vendor.first_name, '') || ' ' || coalesce(v_vendor.last_name, '')) || ' — ' || v_vendor.store_name_ar,
      v_vendor.phone, concat_ws('، ', nullif(v_vendor.address1, ''), nullif(v_vendor.address2, ''), v_area, v_gov),
      v_vendor.governorate_id, v_vendor.area_id, left(coalesce(p_payload->>'notes', ''), 500))
  returning * into v_order;

  for v_line in
    select (e->>'item_id')::uuid as item_id, coalesce(e->>'unit', 'piece') as unit, sum((e->>'qty')::int)::int as qty
      from jsonb_array_elements(p_payload->'items') e group by 1, 2 order by 1
  loop
    select * into v_item from public.packaging_items where id = v_line.item_id for update;
    if not found or not v_item.is_active or v_item.deleted_at is not null then
      raise exception 'item_unavailable' using errcode = 'P0001';
    end if;
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'bad_qty' using errcode = 'P0001'; end if;
    if v_line.unit = 'meter' then
      if v_item.meter_price_piastres is null then raise exception 'bad_unit' using errcode = 'P0001'; end if;
      v_base := v_line.qty; v_price := v_item.meter_price_piastres;
    elsif v_line.unit = 'roll' and v_item.unit = 'roll' then
      if v_line.qty < v_item.min_qty or (v_item.max_qty is not null and v_line.qty > v_item.max_qty) then
        raise exception 'qty_out_of_range' using errcode = 'P0001';
      end if;
      v_base := v_line.qty * v_item.roll_length_m; v_price := v_item.price_piastres;
    elsif v_line.unit = 'piece' and v_item.unit = 'piece' then
      if v_line.qty < v_item.min_qty or (v_item.max_qty is not null and v_line.qty > v_item.max_qty) then
        raise exception 'qty_out_of_range' using errcode = 'P0001';
      end if;
      v_base := v_line.qty; v_price := v_item.price_piastres;
    else
      raise exception 'bad_unit' using errcode = 'P0001';
    end if;
    if v_base > v_item.stock_base then raise exception 'out_of_stock' using errcode = 'P0001'; end if;
    update public.packaging_items set stock_base = stock_base - v_base, updated_at = now() where id = v_item.id;
    insert into public.packaging_order_items (order_id, item_id, sku, name_ar, name_en, unit, qty, base_qty,
        unit_price_piastres, line_total_piastres)
    values (v_order.id, v_item.id, v_item.sku, v_item.name_ar, v_item.name_en, v_line.unit, v_line.qty, v_base,
        v_price, v_price * v_line.qty);
    v_sub := v_sub + v_price * v_line.qty;
  end loop;

  v_total := v_sub + v_ship;
  if v_plan = 'split' then v_deposit := ceil(v_total * (v_cfg->>'split_percent')::numeric / 100)::int; end if;
  update public.packaging_orders set subtotal_piastres = v_sub, total_piastres = v_total, deposit_piastres = v_deposit,
         status = case when v_method = 'cod' then 'confirmed' else 'pending_payment' end,
         payment_status = case when v_method = 'cod' then 'cod_pending' else 'unpaid' end,
         confirmed_at = case when v_method = 'cod' then now() else null end
   where id = v_order.id
  returning * into v_order;

  perform public.fn_packaging_event(v_order.id, null, 'placed', null,
    jsonb_build_object('plan', v_plan, 'method', v_method, 'total_piastres', v_total, 'deposit_piastres', v_deposit));
  perform public.fn_audit('packaging.order_placed', 'packaging_orders', v_order.id::text, null,
    jsonb_build_object('number', v_order.number, 'total_piastres', v_total, 'plan', v_plan, 'method', v_method));
  perform public.fn_packaging_notify_admins('packaging_order_admin', 'طلب تغليف جديد ' || v_order.number,
    'New packaging order ' || v_order.number, '/admin/packaging/orders/' || v_order.number);
  return jsonb_build_object('ok', true, 'id', v_order.id, 'number', v_order.number, 'status', v_order.status,
    'total_piastres', v_total, 'deposit_piastres', v_deposit, 'due_now_piastres', public.fn_packaging_due_now(v_order));
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;

-- payment result (card webhook or admin-recorded) — one engine, idempotent on
-- (provider, ref). Internal; the webhook (service role) and the admin wrapper call it.
create or replace function public.fn_packaging_apply_payment(p_number text, p_provider text, p_ref text,
  p_status text, p_amount integer, p_raw jsonb, p_method text default 'card')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.packaging_orders%rowtype;
  v_due integer;
  v_kind text;
  v_owner uuid;
begin
  select * into v_order from public.packaging_orders where number = p_number for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if exists (select 1 from public.packaging_payments where provider = p_provider and provider_ref = p_ref) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if p_status not in ('succeeded', 'failed') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  v_due := public.fn_packaging_due_now(v_order);
  v_kind := case when v_order.payment_plan = 'split' then 'deposit' else 'full' end;

  if p_status = 'failed' then
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload, created_by)
    values (v_order.id, v_kind, p_method, p_provider, p_ref, coalesce(p_amount, 0), 'failed', 'declined', coalesce(p_raw, '{}'::jsonb), auth.uid());
    perform public.fn_packaging_event(v_order.id, null, 'payment_failed', null, jsonb_build_object('ref', p_ref));
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  -- a success for an order that no longer awaits payment = double charge → flag it
  if v_due = 0 then
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload, created_by)
    values (v_order.id, 'overpayment', p_method, p_provider, p_ref, coalesce(p_amount, 0), 'succeeded', 'order_not_awaiting_payment', coalesce(p_raw, '{}'::jsonb), auth.uid());
    perform public.fn_packaging_event(v_order.id, null, 'overpayment', 'Payment received for an order that was not awaiting payment', jsonb_build_object('ref', p_ref));
    return jsonb_build_object('ok', false, 'reason', 'not_awaiting_payment');
  end if;
  if p_amount is distinct from v_due then
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload, created_by)
    values (v_order.id, v_kind, p_method, p_provider, p_ref, coalesce(p_amount, 0), 'failed', 'amount_mismatch', coalesce(p_raw, '{}'::jsonb) || jsonb_build_object('expected', v_due), auth.uid());
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'expected', v_due);
  end if;

  insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, raw_payload, created_by)
  values (v_order.id, v_kind, p_method, p_provider, p_ref, p_amount, 'succeeded', coalesce(p_raw, '{}'::jsonb), auth.uid());
  update public.packaging_orders set status = 'confirmed', confirmed_at = now(), paid_piastres = paid_piastres + p_amount,
         payment_status = case when payment_plan = 'split' then 'deposit_paid' else 'paid' end, updated_at = now()
   where id = v_order.id;
  if v_order.payment_plan = 'split' then
    insert into public.packaging_balances (vendor_id, order_id, amount_piastres, original_piastres)
    values (v_order.vendor_id, v_order.id, v_order.total_piastres - p_amount, v_order.total_piastres - p_amount)
    on conflict (order_id) do nothing;
  end if;
  perform public.fn_packaging_event(v_order.id, null, 'payment_succeeded', null,
    jsonb_build_object('ref', p_ref, 'amount_piastres', p_amount, 'kind', v_kind));
  perform public.fn_audit('packaging.payment', 'packaging_orders', v_order.id::text, null,
    jsonb_build_object('ref', p_ref, 'amount_piastres', p_amount, 'kind', v_kind, 'provider', p_provider));
  select owner_id into v_owner from public.vendors where id = v_order.vendor_id;
  perform public.fn_notify(v_owner, 'packaging_paid', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم تأكيد طلب التغليف ' || v_order.number, 'body',
          case when v_order.payment_plan = 'split' then 'تم دفع 50% — يُحصَّل الباقي مع أول طلب يتم تسليمه' else 'تم الدفع بالكامل' end),
    'en', jsonb_build_object('title', 'Packaging order ' || v_order.number || ' confirmed', 'body',
          case when v_order.payment_plan = 'split' then '50% paid — the rest is collected with your next delivered order' else 'Paid in full' end),
    'link', '/vendor/packaging/orders/' || v_order.number));
  return jsonb_build_object('ok', true, 'status', 'succeeded');
end $$;

-- Kashier webhook entry (service role only)
create or replace function public.fn_confirm_packaging_payment(p_number text, p_provider_ref text, p_status text,
  p_amount_piastres integer, p_raw jsonb)
returns jsonb
language sql security definer set search_path = public as $$
  select public.fn_packaging_apply_payment(p_number, 'kashier', coalesce(nullif(trim(p_provider_ref), ''), 'missing'),
    p_status, p_amount_piastres, p_raw, 'card');
$$;

-- admin records a payment received outside the gateway (bank transfer, manual card capture …)
create or replace function public.fn_admin_packaging_record_payment(p_order_id uuid, p_amount integer, p_reference text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_number text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(trim(p_reference), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reference_required'); end if;
  select number into v_number from public.packaging_orders where id = p_order_id;
  if v_number is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return public.fn_packaging_apply_payment(v_number, 'manual', trim(p_reference), 'succeeded', p_amount,
    jsonb_build_object('note', p_note), 'manual');
end $$;

-- seller cancels an unpaid order (stock comes back)
create or replace function public.fn_packaging_restock(p_order uuid)
returns void
language sql security definer set search_path = public as $$
  update public.packaging_items i set stock_base = i.stock_base + x.base, updated_at = now()
    from (select item_id, sum(base_qty) as base from public.packaging_order_items where order_id = p_order group by item_id) x
   where i.id = x.item_id;
$$;

create or replace function public.fn_vendor_cancel_packaging_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_order public.packaging_orders%rowtype;
begin
  select * into v_order from public.packaging_orders where id = p_order_id for update;
  if not found or v_order.vendor_id is distinct from public.own_vendor_id() then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_order.status <> 'pending_payment' or v_order.paid_piastres > 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;
  update public.packaging_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cancelled_by_seller', updated_at = now()
   where id = p_order_id;
  perform public.fn_packaging_restock(p_order_id);
  perform public.fn_packaging_event(p_order_id, null, 'cancelled', 'Cancelled by the seller before payment');
  return jsonb_build_object('ok', true);
end $$;

-- money back to the seller: wallet credit, or recorded against the original payment
create or replace function public.fn_packaging_refund_money(p_order public.packaging_orders, p_amount integer,
  p_method text, p_reference text, p_ref_key text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  if p_method = 'wallet' then
    perform public.fn_post_transaction(p_order.vendor_id, 'packaging_refund', p_amount, p_ref_key,
      p_reason || ' — ' || p_order.number, null, null,
      jsonb_build_object('packaging_order', p_order.number, 'packaging_order_id', p_order.id));
  end if;
  insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, raw_payload, created_by)
  values (p_order.id, 'refund', case when p_method = 'wallet' then 'wallet' else 'manual' end,
          case when p_method = 'wallet' then 'wallet' else 'refund' end,
          p_ref_key, p_amount, 'succeeded', jsonb_build_object('reference', p_reference, 'reason', p_reason), auth.uid())
  on conflict (provider, provider_ref) do nothing;
  update public.packaging_orders set refunded_piastres = refunded_piastres + p_amount,
         payment_status = case when refunded_piastres + p_amount >= paid_piastres then 'refunded' else 'partially_refunded' end,
         updated_at = now()
   where id = p_order.id;
end $$;

-- admin operations on an order: process → ship → deliver, or cancel (refund)
create or replace function public.fn_admin_packaging_order_action(p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.packaging_orders%rowtype;
  v_bal public.packaging_balances%rowtype;
  v_refund integer;
  v_method text := coalesce(nullif(p_payload->>'refund_method', ''), 'wallet');
  v_owner uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_order from public.packaging_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if p_action = 'process' then
    if v_order.status <> 'confirmed' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    update public.packaging_orders set status = 'processing', updated_at = now() where id = p_order_id;
  elsif p_action = 'ship' then
    if v_order.status not in ('confirmed', 'processing') then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    update public.packaging_orders set status = 'shipped', shipped_at = now(), updated_at = now(),
           carrier = nullif(trim(coalesce(p_payload->>'carrier', '')), ''),
           tracking_number = nullif(trim(coalesce(p_payload->>'tracking_number', '')), '')
     where id = p_order_id;
  elsif p_action = 'deliver' then
    if v_order.status <> 'shipped' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    update public.packaging_orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = p_order_id;
    -- cash on delivery: the courier collected the full amount
    if v_order.payment_method = 'cod' and v_order.payment_status = 'cod_pending' then
      insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, created_by)
      values (p_order_id, 'cod', 'cod', 'cod', 'cod:' || p_order_id::text, v_order.total_piastres, 'succeeded', auth.uid())
      on conflict (provider, provider_ref) do nothing;
      update public.packaging_orders set paid_piastres = total_piastres, payment_status = 'paid' where id = p_order_id;
    end if;
  elsif p_action = 'cancel' then
    if v_order.status in ('delivered', 'cancelled') then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if coalesce(trim(p_payload->>'reason'), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    if v_method not in ('wallet', 'original') then return jsonb_build_object('ok', false, 'reason', 'bad_method'); end if;
    update public.packaging_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_payload->>'reason'),
           payment_status = case when paid_piastres = 0 then 'unpaid' else payment_status end, updated_at = now()
     where id = p_order_id returning * into v_order;
    perform public.fn_packaging_restock(p_order_id);
    -- the open balance dies with the order; whatever was paid goes back
    update public.packaging_balances set status = 'cancelled', amount_piastres = 0, updated_at = now(),
           note = 'Order cancelled'
     where order_id = p_order_id and status = 'open';
    v_refund := v_order.paid_piastres - v_order.refunded_piastres;
    -- a balance already collected from the wallet always returns to the wallet
    select * into v_bal from public.packaging_balances where order_id = p_order_id and status = 'collected';
    if v_bal.id is not null and v_refund > 0 then
      perform public.fn_packaging_refund_money(v_order, least(v_bal.original_piastres, v_refund), 'wallet', null,
        'pkgcancel-bal:' || p_order_id::text, 'Packaging order cancelled — collected balance returned');
      v_refund := v_refund - least(v_bal.original_piastres, v_refund);
      select * into v_order from public.packaging_orders where id = p_order_id;
    end if;
    if v_refund > 0 then
      perform public.fn_packaging_refund_money(v_order, v_refund, v_method, p_payload->>'reference',
        'pkgcancel:' || p_order_id::text, 'Packaging order cancelled');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_action');
  end if;

  perform public.fn_packaging_event(p_order_id, null, p_action, p_payload->>'reason', p_payload);
  perform public.fn_audit('packaging.order_' || p_action, 'packaging_orders', p_order_id::text,
    jsonb_build_object('status', v_order.status), p_payload);
  select owner_id into v_owner from public.vendors where id = v_order.vendor_id;
  perform public.fn_notify(v_owner, 'packaging_status', jsonb_build_object(
    'ar', jsonb_build_object('title', 'طلب التغليف ' || v_order.number, 'body', case p_action
      when 'process' then 'جارٍ التجهيز' when 'ship' then 'تم الشحن' when 'deliver' then 'تم التسليم' else 'تم الإلغاء' end),
    'en', jsonb_build_object('title', 'Packaging order ' || v_order.number, 'body', case p_action
      when 'process' then 'Being prepared' when 'ship' then 'Shipped' when 'deliver' then 'Delivered' else 'Cancelled' end),
    'link', '/vendor/packaging/orders/' || v_order.number));
  return jsonb_build_object('ok', true);
end $$;

-- collect open balances when the seller's customer order is delivered --------------
create or replace function public.fn_collect_packaging_balances(p_vendor uuid, p_order uuid, p_group uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  b record; v_tx jsonb; v_n int := 0; v_owner uuid;
begin
  for b in select bl.*, o.number from public.packaging_balances bl join public.packaging_orders o on o.id = bl.order_id
            where bl.vendor_id = p_vendor and bl.status = 'open' and bl.amount_piastres > 0
              and o.status <> 'cancelled'
            order by bl.created_at for update of bl
  loop
    v_tx := public.fn_post_transaction(p_vendor, 'packaging_balance', -b.amount_piastres, 'pkgbal:' || b.id::text,
      'Packaging balance (remaining ' || 100 - (public.fn_packaging_settings()->>'split_percent')::int
        || '%) — packaging order ' || b.number, p_order, p_group,
      jsonb_build_object('packaging_order', b.number, 'packaging_order_id', b.order_id, 'balance_id', b.id));
    update public.packaging_balances set status = 'collected', collected_at = now(), collected_order_id = p_order,
           collected_group_id = p_group, wallet_tx_id = (v_tx->>'tx_id')::uuid, updated_at = now()
     where id = b.id;
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status)
    values (b.order_id, 'balance', 'wallet', 'wallet', 'pkgbal:' || b.id::text, b.amount_piastres, 'succeeded')
    on conflict (provider, provider_ref) do nothing;
    update public.packaging_orders set paid_piastres = paid_piastres + b.amount_piastres,
           payment_status = case when paid_piastres + b.amount_piastres >= total_piastres then 'paid' else payment_status end,
           updated_at = now()
     where id = b.order_id;
    perform public.fn_packaging_event(b.order_id, null, 'balance_collected', null,
      jsonb_build_object('amount_piastres', b.amount_piastres, 'group_id', p_group));
    select owner_id into v_owner from public.vendors where id = p_vendor;
    perform public.fn_notify(v_owner, 'packaging_balance_collected', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم تحصيل باقي طلب التغليف ' || b.number, 'body', 'خُصم من محفظتك مع طلب تم تسليمه'),
      'en', jsonb_build_object('title', 'Packaging balance collected — ' || b.number, 'body', 'Deducted from your wallet with a delivered order'),
      'link', '/vendor/wallet'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- earnings + balance collection on delivery (supersedes migration 16's body)
create or replace function public.fn_post_earnings(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_number text;
  v_commission integer;
  v_gross integer;
  v_platform_coupon boolean;
  v_collected integer;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.status <> 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  select number into v_number from public.orders where id = v_group.order_id;
  select exists (
    select 1 from public.orders o join public.coupons c on c.id = o.coupon_id
     where o.id = v_group.order_id and c.type = 'commission_percent') into v_platform_coupon;
  if v_platform_coupon then
    v_gross := v_group.items_subtotal_piastres;
    v_commission := greatest(v_group.commission_piastres - v_group.discount_piastres, 0);
  else
    v_gross := v_group.items_subtotal_piastres - v_group.discount_piastres;
    v_commission := v_group.commission_piastres;
  end if;
  perform public.fn_post_transaction(v_group.vendor_id, 'earning', v_gross,
    'earning:' || p_group_id::text, 'Order earning (items total)', v_group.order_id, p_group_id,
    jsonb_build_object('order_number', v_number, 'items_piastres', v_group.items_subtotal_piastres,
                       'discount_piastres', v_group.discount_piastres));
  perform public.fn_post_transaction(v_group.vendor_id, 'commission', -v_commission,
    'commission:' || p_group_id::text, 'Platform commission', v_group.order_id, p_group_id,
    jsonb_build_object('order_number', v_number));
  -- the 50% packaging balance is due with the first delivered order
  v_collected := public.fn_collect_packaging_balances(v_group.vendor_id, v_group.order_id, p_group_id);
  return jsonb_build_object('ok', true, 'gross_piastres', v_gross, 'commission_piastres', v_commission,
                            'net_piastres', v_gross - v_commission, 'packaging_balances_collected', v_collected);
end $$;

-- returns --------------------------------------------------------------------------
create sequence if not exists public.packaging_return_seq;

create or replace function public.fn_packaging_create_return(p_order_id uuid, p_items jsonb, p_reason text, p_source text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.packaging_orders%rowtype;
  v_cfg jsonb := public.fn_packaging_settings();
  v_ret uuid; v_number text;
  e jsonb; v_oi public.packaging_order_items%rowtype; v_used int;
begin
  select * into v_order from public.packaging_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_source = 'vendor' and v_order.vendor_id is distinct from public.own_vendor_id() then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_order.status <> 'delivered' then return jsonb_build_object('ok', false, 'reason', 'not_delivered'); end if;
  if p_source = 'vendor' and v_order.delivered_at + make_interval(days => (v_cfg->>'return_window_days')::int) < now() then
    return jsonb_build_object('ok', false, 'reason', 'window_expired');
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then return jsonb_build_object('ok', false, 'reason', 'no_items'); end if;
  if p_source = 'vendor' and coalesce(trim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  v_number := 'PKR-' || to_char(now(), 'YY') || lpad(nextval('public.packaging_return_seq')::text, 5, '0');
  insert into public.packaging_returns (number, order_id, vendor_id, source, status, reason, created_by)
  values (v_number, p_order_id, v_order.vendor_id, p_source, 'requested', left(coalesce(p_reason, ''), 1000), auth.uid())
  returning id into v_ret;
  for e in select * from jsonb_array_elements(p_items) loop
    select * into v_oi from public.packaging_order_items where id = (e->>'order_item_id')::uuid and order_id = p_order_id;
    if not found then raise exception 'item_not_in_order' using errcode = 'P0001'; end if;
    select coalesce(sum(ri.qty), 0) into v_used from public.packaging_return_items ri
      join public.packaging_returns r on r.id = ri.return_id
     where ri.order_item_id = v_oi.id and r.status <> 'rejected';
    if coalesce((e->>'qty')::int, 0) <= 0 or v_used + (e->>'qty')::int > v_oi.qty then
      raise exception 'qty_exceeded' using errcode = 'P0001';
    end if;
    insert into public.packaging_return_items (return_id, order_item_id, qty) values (v_ret, v_oi.id, (e->>'qty')::int);
  end loop;
  perform public.fn_packaging_event(p_order_id, v_ret, 'return_requested', p_reason, jsonb_build_object('source', p_source, 'items', p_items));
  if p_source = 'vendor' then
    perform public.fn_packaging_notify_admins('packaging_return_admin', 'طلب إرجاع تغليف ' || v_number,
      'Packaging return request ' || v_number, '/admin/packaging/orders/' || v_order.number);
  end if;
  return jsonb_build_object('ok', true, 'id', v_ret, 'number', v_number);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'duplicate_item');
end $$;

create or replace function public.fn_vendor_request_packaging_return(p_order_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_assert_my_store_operational();
  return public.fn_packaging_create_return(p_order_id, p_items, p_reason, 'vendor');
end $$;

create or replace function public.fn_admin_packaging_return_action(p_return_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ret public.packaging_returns%rowtype;
  v_order public.packaging_orders%rowtype;
  v_bal public.packaging_balances%rowtype;
  v_value integer; v_amount integer; v_offset integer := 0; v_cash integer;
  v_method text := coalesce(nullif(p_payload->>'refund_method', ''), 'wallet');
  v_owner uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_ret from public.packaging_returns where id = p_return_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_order from public.packaging_orders where id = v_ret.order_id for update;
  select coalesce(sum(round(oi.line_total_piastres::numeric * ri.qty / oi.qty)), 0)::int into v_value
    from public.packaging_return_items ri join public.packaging_order_items oi on oi.id = ri.order_item_id
   where ri.return_id = p_return_id;

  if p_action = 'approve' then
    if v_ret.status <> 'requested' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    v_amount := coalesce(nullif(p_payload->>'amount_piastres', '')::int, v_value);
    v_amount := least(greatest(v_amount, 0), v_value, v_order.paid_piastres + coalesce(
      (select amount_piastres from public.packaging_balances where order_id = v_order.id and status = 'open'), 0) - v_order.refunded_piastres);
    update public.packaging_returns set status = 'approved', refund_piastres = v_amount, decided_at = now(),
           admin_note = nullif(trim(coalesce(p_payload->>'note', '')), '') where id = p_return_id;
  elsif p_action = 'reject' then
    if v_ret.status <> 'requested' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if coalesce(trim(p_payload->>'note'), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    update public.packaging_returns set status = 'rejected', decided_at = now(), admin_note = trim(p_payload->>'note') where id = p_return_id;
  elsif p_action = 'receive' then
    if v_ret.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if not v_ret.restocked then
      update public.packaging_items i set stock_base = i.stock_base + x.base, updated_at = now()
        from (select oi.item_id, sum(round(oi.base_qty::numeric * ri.qty / oi.qty))::int as base
                from public.packaging_return_items ri join public.packaging_order_items oi on oi.id = ri.order_item_id
               where ri.return_id = p_return_id group by oi.item_id) x
       where i.id = x.item_id;
    end if;
    update public.packaging_returns set status = 'received', received_at = now(), restocked = true where id = p_return_id;
  elsif p_action = 'refund' then
    if v_ret.status <> 'received' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if v_method not in ('wallet', 'original') then return jsonb_build_object('ok', false, 'reason', 'bad_method'); end if;
    -- an unpaid balance is reduced first: the seller never pays for what came back
    select * into v_bal from public.packaging_balances where order_id = v_order.id and status = 'open' for update;
    if v_bal.id is not null then
      v_offset := least(v_bal.amount_piastres, v_ret.refund_piastres);
      update public.packaging_balances set amount_piastres = amount_piastres - v_offset,
             status = case when amount_piastres - v_offset = 0 then 'settled_by_return' else 'open' end,
             note = 'Reduced by return ' || v_ret.number, updated_at = now()
       where id = v_bal.id;
    end if;
    v_cash := v_ret.refund_piastres - v_offset;
    if v_cash > 0 then
      perform public.fn_packaging_refund_money(v_order, v_cash, v_method, p_payload->>'reference',
        'pkgret:' || p_return_id::text, 'Packaging return ' || v_ret.number);
    end if;
    update public.packaging_returns set status = 'refunded', refunded_at = now(), balance_offset_piastres = v_offset,
           refund_method = v_method, refund_reference = nullif(trim(coalesce(p_payload->>'reference', '')), '')
     where id = p_return_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_action');
  end if;

  perform public.fn_packaging_event(v_ret.order_id, p_return_id, 'return_' || p_action, p_payload->>'note', p_payload);
  perform public.fn_audit('packaging.return_' || p_action, 'packaging_returns', p_return_id::text,
    jsonb_build_object('status', v_ret.status), p_payload);
  select owner_id into v_owner from public.vendors where id = v_ret.vendor_id;
  perform public.fn_notify(v_owner, 'packaging_return', jsonb_build_object(
    'ar', jsonb_build_object('title', 'مرتجع التغليف ' || v_ret.number, 'body', case p_action
      when 'approve' then 'تمت الموافقة' when 'reject' then 'تم الرفض' when 'receive' then 'تم الاستلام' else 'تم رد المبلغ' end),
    'en', jsonb_build_object('title', 'Packaging return ' || v_ret.number, 'body', case p_action
      when 'approve' then 'Approved' when 'reject' then 'Rejected' when 'receive' then 'Received' else 'Refunded' end),
    'link', '/vendor/packaging/orders/' || v_order.number));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_admin_create_packaging_return(p_order_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_res := public.fn_packaging_create_return(p_order_id, p_items, p_reason, 'admin');
  if not (v_res->>'ok')::boolean then return v_res; end if;
  perform public.fn_admin_packaging_return_action((v_res->>'id')::uuid, 'approve', '{}'::jsonb);
  return v_res;
end $$;

-- delete a catalog item: archive if it was ever ordered, else remove
create or replace function public.fn_admin_delete_packaging_item(p_item_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_item public.packaging_items%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_item from public.packaging_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.packaging_order_items where item_id = p_item_id) then
    update public.packaging_items set is_active = false, deleted_at = now(), updated_at = now() where id = p_item_id;
    perform public.fn_audit('packaging.item_archived', 'packaging_items', p_item_id::text, to_jsonb(v_item), null);
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from public.packaging_items where id = p_item_id;
  perform public.fn_audit('packaging.item_deleted', 'packaging_items', p_item_id::text, to_jsonb(v_item), null);
  return jsonb_build_object('ok', true, 'archived', false);
end $$;

-- grants -------------------------------------------------------------------------
revoke all on function public.fn_packaging_apply_payment(text, text, text, text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.fn_confirm_packaging_payment(text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fn_collect_packaging_balances(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_packaging_refund_money(public.packaging_orders, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_packaging_create_return(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.fn_packaging_restock(uuid) from public, anon, authenticated;
revoke all on function public.fn_packaging_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fn_packaging_notify_admins(text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_post_earnings(uuid) from public, anon, authenticated;
grant execute on function public.fn_confirm_packaging_payment(text, text, text, integer, jsonb) to service_role;
grant execute on function public.fn_packaging_settings() to authenticated;
grant execute on function public.fn_packaging_due_now(public.packaging_orders) to authenticated;
-- user-facing entry points: signed-in users only (each checks its own role)
revoke all on function public.fn_vendor_place_packaging_order(jsonb) from public, anon;
grant execute on function public.fn_vendor_place_packaging_order(jsonb) to authenticated;
revoke all on function public.fn_vendor_cancel_packaging_order(uuid) from public, anon;
grant execute on function public.fn_vendor_cancel_packaging_order(uuid) to authenticated;
revoke all on function public.fn_vendor_request_packaging_return(uuid, jsonb, text) from public, anon;
grant execute on function public.fn_vendor_request_packaging_return(uuid, jsonb, text) to authenticated;
revoke all on function public.fn_admin_packaging_record_payment(uuid, integer, text, text) from public, anon;
grant execute on function public.fn_admin_packaging_record_payment(uuid, integer, text, text) to authenticated;
revoke all on function public.fn_admin_packaging_order_action(uuid, text, jsonb) from public, anon;
grant execute on function public.fn_admin_packaging_order_action(uuid, text, jsonb) to authenticated;
revoke all on function public.fn_admin_packaging_return_action(uuid, text, jsonb) from public, anon;
grant execute on function public.fn_admin_packaging_return_action(uuid, text, jsonb) to authenticated;
revoke all on function public.fn_admin_create_packaging_return(uuid, jsonb, text) from public, anon;
grant execute on function public.fn_admin_create_packaging_return(uuid, jsonb, text) to authenticated;
revoke all on function public.fn_admin_delete_packaging_item(uuid) from public, anon;
grant execute on function public.fn_admin_delete_packaging_item(uuid) to authenticated;
revoke all on function public.fn_admin_decide_refund(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.fn_admin_decide_refund(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function public.fn_admin_create_return(uuid, jsonb) from public, anon;
grant execute on function public.fn_admin_create_return(uuid, jsonb) to authenticated;
revoke all on function public.fn_admin_return_received(uuid, text) from public, anon;
grant execute on function public.fn_admin_return_received(uuid, text) to authenticated;
revoke all on function public.fn_admin_execute_refund(uuid, text, text, text) from public, anon;
grant execute on function public.fn_admin_execute_refund(uuid, text, text, text) to authenticated;
revoke all on function public.fn_admin_order_refundables(uuid) from public, anon;
grant execute on function public.fn_admin_order_refundables(uuid) to authenticated;

-- seed: the platform's packaging price list (Excel "جدول الباكينج والتغليف")
-- prices in piastres; stock starts at 0 until the admin enters real stock
insert into public.packaging_items (sku, category, name_ar, name_en, unit, roll_length_m, spec_ar, spec_en, price_piastres, meter_price_piastres, sort)
values
 ('ENV-S-01',   'envelope', 'ظرف صغير حتى 0.1 كجم',      'Small envelope ≤ 0.1 kg',     'piece', null, '', '', 1000, null, 10),
 ('ENV-M-05',   'envelope', 'ظرف عادي حتى 0.5 كجم',      'Standard envelope ≤ 0.5 kg',  'piece', null, '', '', 1000, null, 20),
 ('ENV-L-1',    'envelope', 'ظرف كبير حتى 1 كجم',        'Large envelope ≤ 1 kg',       'piece', null, '', '', 1500, null, 30),
 ('ENV-L-5',    'envelope', 'ظرف كبير حتى 5 كجم',        'Standard parcel ≤ 5 kg',      'piece', null, '', '', 2500, null, 40),
 ('ENV-XL-12',  'envelope', 'ظرف كبير جداً حتى 12 كجم',   'Extra-large envelope ≤ 12 kg',     'piece', null, '', '', 4000, null, 50),
 ('BUB-50-50',  'bubble_wrap', 'بابل راب 50 سم × 50 م',   'Bubble wrap 50 cm × 50 m',    'roll', 50,  'فقاعة صغيرة', 'Small bubble', 7000, 200, 110),
 ('BUB-75-50',  'bubble_wrap', 'بابل راب 75 سم × 50 م',   'Bubble wrap 75 cm × 50 m',    'roll', 50,  'فقاعة متوسطة', 'Medium bubble', 12000, 250, 120),
 ('BUB-100-50', 'bubble_wrap', 'بابل راب 100 سم × 50 م',  'Bubble wrap 100 cm × 50 m',   'roll', 50,  'فقاعة متوسطة / كبيرة', 'Medium / Large bubble', 15000, 300, 130),
 ('BUB-120-50', 'bubble_wrap', 'بابل راب 120 سم × 50 م',  'Bubble wrap 120 cm × 50 m',   'roll', 50,  'فقاعة كبيرة', 'Large bubble', 20000, 400, 140),
 ('BUB-50-100', 'bubble_wrap', 'بابل راب 50 سم × 100 م',  'Bubble wrap 50 cm × 100 m',   'roll', 100, 'فقاعة صغيرة', 'Small bubble', 10000, 250, 150),
 ('BUB-75-100', 'bubble_wrap', 'بابل راب 75 سم × 100 م',  'Bubble wrap 75 cm × 100 m',   'roll', 100, 'فقاعة متوسطة', 'Medium bubble', 17000, 300, 160),
 ('BUB-100-100','bubble_wrap', 'بابل راب 100 سم × 100 م', 'Bubble wrap 100 cm × 100 m',  'roll', 100, 'فقاعة متوسطة / كبيرة', 'Medium / Large bubble', 25000, 350, 170),
 ('BUB-120-100','bubble_wrap', 'بابل راب 120 سم × 100 م', 'Bubble wrap 120 cm × 100 m',  'roll', 100, 'فقاعة كبيرة', 'Large bubble', 34000, 400, 180),
 ('BUB-75-30-D','bubble_wrap', 'بابل راب 75 سم × 30 م (مزدوج الطبقات)', 'Bubble wrap 75 cm × 30 m (double layer)', 'roll', 30, 'مزدوج الطبقات', 'Double layer', 13000, 500, 190)
on conflict (sku) do nothing;

commit;
