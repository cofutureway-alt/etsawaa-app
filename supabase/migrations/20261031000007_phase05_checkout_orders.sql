-- ============================================================================
-- PHASE 05 — CHECKOUT & ORDERS
-- orders / vendor groups / items (snapshots + commission) / status history /
-- notes / payments / refunds / documents log + shipment numbers + RPCs + RLS.
-- Rules: money in integer piastres; commission on price AFTER discounts;
-- one shipping fee per order by governorate; COD gated server-side
-- (settings.checkout.cod_max_total_piastres, vendor-shipped items);
-- ONE shipment number per order ETS-YY-### (= the order number);
-- no tax columns anywhere (AGENT §28).
-- ============================================================================

create table if not exists public.order_sequences (
  year     smallint primary key,
  last_seq integer not null default 0
);
revoke all on public.order_sequences from anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- 1) ORDERS — the order number IS the shipment number (ETS-YY-###), one per
--    order for every document copy and the Code128 barcode.
--    Address + email + phones are SNAPSHOTS (later edits never change orders).
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  number                text not null unique,               -- ETS-YY-###
  attempt_key           uuid unique,                        -- client idempotency key per attempt
  user_id               uuid not null references auth.users(id) on delete restrict,
  email                 text not null,                      -- account email snapshot (read-only at checkout)
  phone_primary         text not null,
  phone_alternate       text not null,
  ship_name             text not null,
  governorate_id        smallint not null references public.governorates(id) on delete restrict,
  area_id               bigint not null,
  address1              text not null,
  address2              text,
  postal_code           text,
  -- pending_payment → processing / on_hold / cancelled → completed (PLAN §3)
  status                text not null default 'pending_payment'
                        check (status in ('pending_payment','processing','on_hold','completed','cancelled')),
  payment_method        text not null check (payment_method in ('kashier','cod')),
  payment_status        text not null default 'unpaid'
                        check (payment_status in ('unpaid','paid','cod_pending','cod_collected')),
  subtotal_piastres     integer not null check (subtotal_piastres >= 0),
  discount_piastres     integer not null default 0 check (discount_piastres >= 0),
  shipping_fee_piastres integer not null default 0 check (shipping_fee_piastres >= 0),
  total_piastres        integer not null check (total_piastres >= 0),
  coupon_id             uuid references public.coupons(id) on delete set null,
  coupon_code           text,
  delivered_at          timestamptz,                        -- anchor for 14/30-day windows
  cancel_reason         text,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint orders_area_in_governorate
    foreign key (area_id, governorate_id) references public.areas(id, governorate_id) on delete restrict,
  constraint orders_phones_differ check (phone_alternate <> phone_primary),
  constraint orders_phone_primary_e164 check (phone_primary ~ '^\+201(0|1|2|5)[0-9]{8}$'),
  constraint orders_phone_alternate_e164 check (phone_alternate ~ '^\+201(0|1|2|5)[0-9]{8}$'),
  -- total = subtotal - discount + shipping, always
  constraint orders_total_consistent
    check (total_piastres = subtotal_piastres - discount_piastres + shipping_fee_piastres)
);
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx      on public.orders (status, created_at desc);
alter table public.orders enable row level security;

-- ----------------------------------------------------------------------------
-- 2) ORDER VENDOR GROUPS — financial split per vendor; fulfillment timeline
--    states per group (JOURNEYS §9: received → handed to carrier → out for
--    delivery → delivered).
-- ----------------------------------------------------------------------------
create table if not exists public.order_vendor_groups (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id) on delete cascade,
  vendor_id               uuid not null references public.vendors(id) on delete restrict,
  status                  text not null default 'pending'
                          check (status in ('pending','preparing','handed_to_carrier','out_for_delivery','delivered','cancelled')),
  shipping_mode           text not null default 'platform' check (shipping_mode in ('platform','vendor')),
  vendor_ship_status      text not null default 'not_required'
                          check (vendor_ship_status in ('not_required','pending_admin','approved','rejected')),
  items_subtotal_piastres integer not null default 0 check (items_subtotal_piastres >= 0),
  discount_piastres       integer not null default 0 check (discount_piastres >= 0),
  commission_piastres     integer not null default 0 check (commission_piastres >= 0),
  cancel_reason           text,
  shipped_at              timestamptz,
  delivered_at            timestamptz,
  cancelled_at            timestamptz,
  created_at              timestamptz not null default now(),
  constraint order_vendor_groups_unique unique (order_id, vendor_id)
);
create index if not exists groups_vendor_idx  on public.order_vendor_groups (vendor_id, created_at desc);
create index if not exists groups_order_idx   on public.order_vendor_groups (order_id);
create index if not exists groups_status_idx  on public.order_vendor_groups (status);
alter table public.order_vendor_groups enable row level security;

-- ----------------------------------------------------------------------------
-- 3) ORDER ITEMS — immutable snapshot per purchased variant + commission on
--    the discounted line (AGENT §7).
-- ----------------------------------------------------------------------------
create table if not exists public.order_items (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references public.orders(id) on delete cascade,
  group_id                 uuid not null references public.order_vendor_groups(id) on delete cascade,
  vendor_id                uuid not null references public.vendors(id) on delete restrict,
  variant_id               uuid not null references public.variants(id) on delete restrict,
  product_id               uuid not null references public.products(id) on delete restrict,
  leaf_category_id         uuid not null references public.categories(id) on delete restrict,
  product_name_ar          text not null default '',
  product_name_en          text not null default '',
  option_key               text not null default '',
  sku                      text,
  image_path               text,
  unit_price_piastres      integer not null check (unit_price_piastres > 0),   -- after sale + event
  qty                      integer not null check (qty > 0),
  line_total_piastres      integer not null check (line_total_piastres > 0),
  coupon_discount_piastres integer not null default 0 check (coupon_discount_piastres >= 0),
  commission_piastres      integer not null default 0 check (commission_piastres >= 0),
  commission_rate_bps      integer not null default 0 check (commission_rate_bps >= 0 and commission_rate_bps <= 10000),
  is_fragile               boolean not null default false,
  created_at               timestamptz not null default now()
);
create index if not exists items_order_idx  on public.order_items (order_id);
create index if not exists items_group_idx  on public.order_items (group_id);
create index if not exists items_vendor_idx on public.order_items (vendor_id, created_at desc);
create index if not exists items_product_idx on public.order_items (product_id);
create index if not exists items_variant_idx on public.order_items (variant_id);
alter table public.order_items enable row level security;

-- ----------------------------------------------------------------------------
-- 4) STATUS HISTORY + NOTES
-- ----------------------------------------------------------------------------
create table if not exists public.order_status_history (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  group_id   uuid references public.order_vendor_groups(id) on delete cascade,
  status     text not null,
  note       text not null default '',
  actor      uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists history_order_idx on public.order_status_history (order_id, created_at);
create index if not exists history_group_idx on public.order_status_history (group_id, created_at);
alter table public.order_status_history enable row level security;

create table if not exists public.order_notes (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  group_id    uuid references public.order_vendor_groups(id) on delete cascade,
  author      uuid references auth.users(id) on delete set null,
  is_internal boolean not null default false,
  body        text not null check (length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists notes_order_idx on public.order_notes (order_id, created_at);
alter table public.order_notes enable row level security;

-- ----------------------------------------------------------------------------
-- 5) PAYMENTS — provider_ref (Kashier transactionId) is the idempotency key
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  provider        text not null default 'kashier',
  provider_ref    text not null,
  amount_piastres integer not null check (amount_piastres >= 0),
  status          text not null check (status in ('pending','succeeded','failed')),
  raw_payload     jsonb not null default '{}'::jsonb,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  constraint payments_provider_ref_unique unique (provider, provider_ref)
);
create index if not exists payments_order_idx on public.payments (order_id, created_at desc);
alter table public.payments enable row level security;

-- ----------------------------------------------------------------------------
-- 6) REFUND REQUESTS (submission + timeline; decisions arrive in phase 07)
--    Windows anchor on orders.delivered_at: return 14 days, warranty 30.
-- ----------------------------------------------------------------------------
create table if not exists public.refund_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('return','warranty')),
  description   text not null default '' check (length(description) <= 2000),
  evidence      jsonb not null default '[]'::jsonb,     -- documents-bucket paths
  status        text not null default 'pending_admin'
                check (status in ('pending_admin','approved','rejected','refunded','closed')),
  decision_note text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists refund_requests_order_idx on public.refund_requests (order_id);
create index if not exists refund_requests_user_idx  on public.refund_requests (user_id, created_at desc);
create index if not exists refund_requests_status_idx on public.refund_requests (status, created_at desc);

create table if not exists public.refund_request_items (
  id                uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  order_item_id     uuid not null references public.order_items(id) on delete cascade,
  qty               integer not null check (qty > 0),
  reason            text not null check (reason in ('defect','wrong_item','damaged','not_received','change_of_mind')),
  constraint refund_request_items_unique unique (refund_request_id, order_item_id)
);
create index if not exists refund_items_request_idx on public.refund_request_items (refund_request_id);
create index if not exists refund_items_item_idx    on public.refund_request_items (order_item_id);
alter table public.refund_requests enable row level security;
alter table public.refund_request_items enable row level security;

-- ----------------------------------------------------------------------------
-- 7) ORDER DOCUMENTS — print log (every print/reprint writes a row)
-- ----------------------------------------------------------------------------
create table if not exists public.order_documents (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  vendor_id  uuid references public.vendors(id) on delete set null,
  doc_type   text not null check (doc_type in ('invoice_admin','label_carrier','label_vendor','invoice_vendor','packing_slip')),
  copies     integer not null default 1 check (copies between 1 and 50),
  printed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists documents_order_idx on public.order_documents (order_id, created_at desc);
alter table public.order_documents enable row level security;

-- ============================================================================
-- SETTINGS SEEDS — COD cap (default 5,000 EGP) + document copy defaults
-- ============================================================================
insert into public.settings (key, value) values
('checkout', jsonb_build_object(
  'cod_max_total_piastres', 500000,
  'terms_version', '1.0'
)),
('documents', jsonb_build_object(
  'copies_invoice_admin', 1,
  'copies_label_carrier', 2,
  'copies_label_vendor', 1,
  'copies_invoice_vendor', 1
))
on conflict (key) do nothing;

-- Default commission rule for the seeded level: 5% (basis points stored per
-- order item as a snapshot; vendor_levels.rewards.commission_percent is the
-- live rule the levels system updates).
update public.vendor_levels
set rewards = rewards || jsonb_build_object('commission_percent', 5, 'hold_days', 14)
where rewards ->> 'commission_percent' is null;

-- ============================================================================
-- RLS
-- ============================================================================
-- orders: owner + admin read; writes only through definer RPCs.
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- groups: owner (through their order) + vendor (own rows) + admin.
drop policy if exists groups_select_reader on public.order_vendor_groups;
create policy groups_select_reader on public.order_vendor_groups
  for select to authenticated using (
    public.is_admin()
    or vendor_id = public.own_vendor_id()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

drop policy if exists items_select_reader on public.order_items;
create policy items_select_reader on public.order_items
  for select to authenticated using (
    public.is_admin()
    or vendor_id = public.own_vendor_id()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

drop policy if exists history_select_reader on public.order_status_history;
create policy history_select_reader on public.order_status_history
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
    or (group_id is not null and exists (
         select 1 from public.order_vendor_groups g
         where g.id = group_id and g.vendor_id = public.own_vendor_id()))
  );

-- notes: internal notes never leave staff (admin) + the owning vendor;
-- customers see non-internal notes on their orders.
drop policy if exists notes_select_reader on public.order_notes;
create policy notes_select_reader on public.order_notes
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid() and not is_internal)
    or (group_id is not null and not is_internal and exists (
         select 1 from public.order_vendor_groups g
         where g.id = group_id and g.vendor_id = public.own_vendor_id()))
  );

drop policy if exists payments_select_reader on public.payments;
create policy payments_select_reader on public.payments
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- refunds: customer owns; concerned vendor reads rows that contain their items;
-- admin everything. Writes happen through fn_request_refund (definer).
drop policy if exists refund_requests_select_reader on public.refund_requests;
create policy refund_requests_select_reader on public.refund_requests
  for select to authenticated using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (
      select 1
      from public.refund_request_items rri
      join public.order_items oi on oi.id = rri.order_item_id
      where rri.refund_request_id = refund_requests.id
        and oi.vendor_id = public.own_vendor_id()
    )
  );
drop policy if exists refund_items_select_reader on public.refund_request_items;
create policy refund_items_select_reader on public.refund_request_items
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1 from public.refund_requests rr
      where rr.id = refund_request_id and rr.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.order_items oi
      where oi.id = order_item_id and oi.vendor_id = public.own_vendor_id()
    )
  );

-- documents log: owner + vendor(own docs) + admin read; insert via fn_log_document.
drop policy if exists documents_select_reader on public.order_documents;
create policy documents_select_reader on public.order_documents
  for select to authenticated using (
    public.is_admin()
    or vendor_id = public.own_vendor_id()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- reviews: buyers edit/delete their own (phase 04 granted select only).
drop policy if exists reviews_buyer_update on public.reviews;
create policy reviews_buyer_update on public.reviews
  for update to authenticated
  using (customer_id = auth.uid() and status in ('pending','published'))
  with check (customer_id = auth.uid() and status = 'pending'); -- edits go back to moderation
drop policy if exists reviews_buyer_delete on public.reviews;
create policy reviews_buyer_delete on public.reviews
  for delete to authenticated using (customer_id = auth.uid() and status in ('pending','published'));

-- one review per order item (verified only) — phase-05 rule (O-22)
create unique index if not exists reviews_order_item_unique
  on public.reviews (order_item_id) where order_item_id is not null;

-- storage: admins may read every customer/vendor document object (refund
-- evidence review arrives in phase 07; needed for the documents bucket now).
drop policy if exists "documents_admin_read" on storage.objects;
create policy "documents_admin_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_admin());

-- ============================================================================
-- GRANTS (tables: read-only where a policy filters; writes via RPCs only)
-- ============================================================================
grant select on public.orders, public.order_vendor_groups, public.order_items,
  public.order_status_history, public.order_notes, public.payments,
  public.refund_requests, public.refund_request_items, public.order_documents
  to authenticated;
revoke all on public.orders, public.order_vendor_groups, public.order_items,
  public.order_status_history, public.order_notes, public.payments,
  public.refund_requests, public.refund_request_items, public.order_documents,
  public.order_sequences
  from anon, public;

-- ============================================================================
-- fn_create_order — atomic: validate → create order/groups/items → decrement
-- stock → redeem coupon → clear cart. Everything or nothing (PL/pgSQL
-- exceptions roll back the whole transaction).
-- Payload: { attempt_key?, payment_method, coupon_code?,
--            address: {full_name, phone_primary, phone_alternate,
--                      governorate_id, area_id, address1, address2?, postal_code?} }
-- Pricing is recomputed from the DB — the client never sends prices.
-- ============================================================================
create or replace function public.fn_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_addr jsonb := p_payload->'address';
  v_method text := p_payload->>'payment_method';
  v_coupon_code text := nullif(trim(coalesce(p_payload->>'coupon_code', '')), '');
  v_attempt uuid := nullif(p_payload->>'attempt_key', '')::uuid;

  v_existing orders%rowtype;
  v_profile record;
  v_area record;
  r record;
  x record;
  v_it record;

  v_cod_cap integer := 500000;
  v_shipping integer;
  v_lines jsonb := '[]'::jsonb;          -- coupon validation lines
  v_rows jsonb := '[]'::jsonb;           -- priced rows for insertion
  v_row jsonb;
  v_subtotal integer := 0;

  v_vendor_ids uuid[] := '{}'::uuid[];
  v_vendor_mode boolean := false;        -- any vendor-shipped item

  v_coupon_row public.coupons%rowtype;
  v_coupon jsonb;
  v_discount integer := 0;
  v_free_shipping boolean := false;
  v_eligible_subtotal integer := 0;
  v_alloc integer := 0;
  v_line_discount integer;
  v_running integer := 0;
  v_last_eligible integer := -1;

  v_total integer;
  v_order_id uuid;
  v_number text;
  v_yy smallint;
  v_seq integer;
  v_group_id uuid;
  v_group_subtotal integer;
  v_group_discount integer;
  v_group_commission integer;
  v_commission_bps integer;
  v_rate numeric;
  v_event record;
  v_event_percent integer := 0;
  v_event_cap integer;
  v_unit integer;
  v_unavailable text := '';
  v_order_status text;
  v_vid uuid;
  v_i integer;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;

  -- idempotency: the same attempt key resolves to the same order (no dupes)
  if v_attempt is not null then
    select * into v_existing from public.orders where attempt_key = v_attempt;
    if found then
      return jsonb_build_object('ok', true, 'order_id', v_existing.id,
        'number', v_existing.number, 'payment_method', v_existing.payment_method,
        'duplicate', true);
    end if;
  end if;

  if v_method not in ('kashier', 'cod') then
    return jsonb_build_object('ok', false, 'reason', 'bad_payment_method');
  end if;

  -- account email is the order email — taken from the profile, never the payload
  select email, coalesce(phone, '') into v_profile from public.profiles where id = v_uid;
  if v_profile.email is null or v_profile.email = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_missing');
  end if;

  -- address validation (AGENT §29: email read-only, alternate required ≠ primary)
  if coalesce(trim(v_addr->>'full_name'), '') = ''
     or coalesce(trim(v_addr->>'address1'), '') = ''
     or coalesce(trim(v_addr->>'phone_primary'), '') = ''
     or coalesce(trim(v_addr->>'phone_alternate'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'address_incomplete');
  end if;
  if (v_addr->>'phone_primary') = (v_addr->>'phone_alternate') then
    return jsonb_build_object('ok', false, 'reason', 'phones_equal');
  end if;
  if (v_addr->>'phone_primary') !~ '^\+201(0|1|2|5)[0-9]{8}$'
     or (v_addr->>'phone_alternate') !~ '^\+201(0|1|2|5)[0-9]{8}$' then
    return jsonb_build_object('ok', false, 'reason', 'phone_invalid');
  end if;

  select a.id, a.governorate_id, a.is_active, a.name_ar, a.name_en,
         g.is_active as gov_active, g.shipping_fee_piastres, g.name_ar as gov_ar, g.name_en as gov_en
    into v_area
    from public.areas a join public.governorates g on g.id = a.governorate_id
    where a.id = (v_addr->>'area_id')::bigint
      and a.governorate_id = (v_addr->>'governorate_id')::smallint;
  if not found or not v_area.is_active or not v_area.gov_active then
    return jsonb_build_object('ok', false, 'reason', 'area_unavailable');
  end if;
  v_shipping := v_area.shipping_fee_piastres;

  -- COD cap from settings (default 5,000 EGP)
  select coalesce((s.value->>'cod_max_total_piastres')::integer, 500000) into v_cod_cap
    from public.settings s where s.key = 'checkout';

  -- lock the cart + the variants (deterministic order avoids deadlocks)
  for r in
    select ci.variant_id, ci.qty, ci.product_id,
           v.stock, v.is_active, v.deleted_at as v_deleted, v.price_piastres,
           v.sale_price_piastres, v.option_key, v.sku, v.image_path,
           p.name_ar, p.name_en, p.status as p_status, p.deleted_at as p_deleted,
           p.shipping_mode, p.is_fragile, p.leaf_category_id, p.brand_id,
           p.vendor_id, p.sale_starts_at, p.sale_ends_at, p.event_hidden
      from public.cart_items ci
      join public.variants v on v.id = ci.variant_id
      join public.products p on p.id = ci.product_id
      where ci.user_id = v_uid
      order by ci.variant_id
      for update of ci, v
  loop
    if r.p_deleted is not null or r.p_status <> 'approved'
       or r.v_deleted is not null or not r.is_active or r.price_piastres is null
       or not public.vendor_can_sell(r.vendor_id)
       or r.event_hidden
       or exists (select 1 from public.v_active_event_vendors aev
                  where aev.vendor_id = r.vendor_id and aev.status = 'refused') then
      v_unavailable := v_unavailable || case when v_unavailable = '' then '' else '، ' end || coalesce(nullif(r.name_ar, ''), r.name_en);
      continue;
    end if;
    if r.stock < r.qty then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_stock',
        'variant_id', r.variant_id, 'stock', r.stock, 'name', r.name_ar);
    end if;

    -- unit price: variant sale (product-level window) then event discount —
    -- identical rules to v_storefront_products
    v_unit := r.price_piastres;
    if r.sale_price_piastres is not null
       and r.sale_starts_at is not null and r.sale_starts_at <= now()
       and (r.sale_ends_at is null or r.sale_ends_at > now()) then
      v_unit := least(r.price_piastres, r.sale_price_piastres);
    end if;
    select d.percent, d.max_discount_piastres into v_event_percent, v_event_cap
      from public.v_active_event_vendors aev
      join public.event_discounts d on d.event_id = aev.event_id
      where aev.vendor_id = r.vendor_id and aev.status = 'accepted'
        and ((d.scope = 'product' and d.ref_id = r.product_id)
          or (d.scope = 'category' and d.ref_id = r.leaf_category_id))
      order by (d.scope = 'product') desc, d.percent desc
      limit 1;
    if found and v_event_percent > 0 then
      v_unit := v_unit - trunc(v_unit * v_event_percent / 100);
      if v_event_cap is not null and v_unit < v_event_cap then
        v_unit := v_event_cap;
      end if;
    end if;
    v_event_percent := 0; v_event_cap := null;

    v_rows := v_rows || jsonb_build_object(
      'variant_id', r.variant_id, 'product_id', r.product_id,
      'vendor_id', r.vendor_id, 'leaf_category_id', r.leaf_category_id,
      'brand_id', r.brand_id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'option_key', r.option_key, 'sku', r.sku,
      'image_path', coalesce(nullif(r.image_path, ''),
        (select pm.path from public.product_media pm
          where pm.product_id = r.product_id and pm.kind = 'image'
          order by pm.position limit 1)),
      'unit', v_unit, 'qty', r.qty, 'on_sale', v_unit < r.price_piastres,
      'shipping_mode', r.shipping_mode, 'is_fragile', r.is_fragile);
    v_subtotal := v_subtotal + v_unit * r.qty;
  end loop;

  if jsonb_array_length(v_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;
  if v_unavailable <> '' then
    return jsonb_build_object('ok', false, 'reason', 'items_unavailable', 'names', v_unavailable);
  end if;

  -- vendor groups + vendor-shipped detection
  for x in select distinct (e->>'vendor_id')::uuid as vid,
                  bool_or((e->>'shipping_mode') = 'vendor') as is_vendor_mode
           from jsonb_array_elements(v_rows) e group by 1
  loop
    v_vendor_ids := v_vendor_ids || x.vid;
    if x.is_vendor_mode then v_vendor_mode := true; end if;
  end loop;

  -- coupon (same engine as the cart — server-side recalculation)
  if v_coupon_code is not null then
    for r in select je as ln from jsonb_array_elements(v_rows) je loop
      v_lines := v_lines || jsonb_build_object(
        'product_id', r.ln->>'product_id', 'vendor_id', r.ln->>'vendor_id',
        'leaf_category_id', r.ln->>'leaf_category_id', 'brand_id', r.ln->>'brand_id',
        'unit_price_piastres', (r.ln->>'unit')::integer, 'qty', (r.ln->>'qty')::integer,
        'on_sale', (r.ln->>'on_sale')::boolean);
    end loop;
    v_coupon := public.fn_apply_coupon(v_coupon_code, v_lines);
    if not coalesce((v_coupon->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'coupon_' || coalesce(v_coupon->>'reason', 'invalid'));
    end if;
    v_discount := (v_coupon->>'discount_piastres')::integer;
    v_free_shipping := coalesce((v_coupon->>'free_shipping')::boolean, false);
    select * into v_coupon_row from public.coupons c where upper(c.code) = upper(v_coupon_code);
    -- per-line eligibility for proportional allocation (same rules as the engine)
    v_i := 0;
    for r in select je as ln from jsonb_array_elements(v_lines) je loop
      if not (v_coupon_row.exclude_sale_items and (r.ln->>'on_sale')::boolean) then
        if not exists (
          select 1 from public.coupon_scopes s
          where s.coupon_id = v_coupon_row.id and s.mode = 'exclude' and (
            (s.scope = 'vendor'   and s.ref_id = (r.ln->>'vendor_id')::uuid)
            or (s.scope = 'category' and s.ref_id = (r.ln->>'leaf_category_id')::uuid)
            or (s.scope = 'brand'    and s.ref_id = (r.ln->>'brand_id')::uuid)
            or (s.scope = 'product'  and s.ref_id = (r.ln->>'product_id')::uuid))
        ) then
          if not exists (select 1 from public.coupon_scopes where coupon_id = v_coupon_row.id and mode = 'include')
             or exists (
               select 1 from public.coupon_scopes s
               where s.coupon_id = v_coupon_row.id and s.mode = 'include' and (
                 (s.scope = 'vendor'   and s.ref_id = (r.ln->>'vendor_id')::uuid)
                 or (s.scope = 'category' and s.ref_id = (r.ln->>'leaf_category_id')::uuid)
                 or (s.scope = 'brand'    and s.ref_id = (r.ln->>'brand_id')::uuid)
                 or (s.scope = 'product'  and s.ref_id = (r.ln->>'product_id')::uuid))
             ) then
            v_eligible_subtotal := v_eligible_subtotal + (r.ln->>'unit_price_piastres')::integer * (r.ln->>'qty')::integer;
            v_last_eligible := v_i;
          end if;
        end if;
      end if;
      v_i := v_i + 1;
    end loop;
    if v_free_shipping then v_shipping := 0; end if;
  end if;

  -- allocate the coupon across eligible lines proportionally; the remainder
  -- lands on the last eligible line so the sum matches the engine exactly
  v_running := 0;
  v_i := 0;
  if v_discount > 0 and v_eligible_subtotal > 0 then
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_row := v_it.ln;
      v_line_discount := 0;
      if v_i <= v_last_eligible then
        declare
          v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
          v_is_eligible boolean := false;
        begin
          if v_i = v_last_eligible then
            v_is_eligible := true; -- v_last_eligible was proven eligible above
          else
            -- re-run the cheap eligibility test for this line
            v_is_eligible := exists (
              select 1
                where not (v_coupon_row.exclude_sale_items and (v_row->>'on_sale')::boolean)
                  and not exists (
                    select 1 from public.coupon_scopes s
                    where s.coupon_id = v_coupon_row.id and s.mode = 'exclude' and (
                      (s.scope = 'vendor'   and s.ref_id = (v_row->>'vendor_id')::uuid)
                      or (s.scope = 'category' and s.ref_id = (v_row->>'leaf_category_id')::uuid)
                      or (s.scope = 'brand'    and s.ref_id = (v_row->>'brand_id')::uuid)
                      or (s.scope = 'product'  and s.ref_id = (v_row->>'product_id')::uuid))
                  )
                  and (
                    not exists (select 1 from public.coupon_scopes where coupon_id = v_coupon_row.id and mode = 'include')
                    or exists (
                      select 1 from public.coupon_scopes s
                      where s.coupon_id = v_coupon_row.id and s.mode = 'include' and (
                        (s.scope = 'vendor'   and s.ref_id = (v_row->>'vendor_id')::uuid)
                        or (s.scope = 'category' and s.ref_id = (v_row->>'leaf_category_id')::uuid)
                        or (s.scope = 'brand'    and s.ref_id = (v_row->>'brand_id')::uuid)
                        or (s.scope = 'product'  and s.ref_id = (v_row->>'product_id')::uuid))
                    )
                  )
            );
          end if;
          if v_is_eligible and v_i < v_last_eligible then
            v_line_discount := trunc(v_discount::numeric * v_line_total / v_eligible_subtotal)::integer;
          elsif v_is_eligible then
            v_line_discount := v_discount - v_running; -- remainder on the last eligible line
          end if;
        end;
      end if;
      v_rows := jsonb_set(v_rows, array[v_i::text, 'coupon_discount'], to_jsonb(v_line_discount));
      v_running := v_running + v_line_discount;
      v_i := v_i + 1;
    end loop;
  else
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_rows := jsonb_set(v_rows, array[v_i::text, 'coupon_discount'], to_jsonb(0));
      v_i := v_i + 1;
    end loop;
  end if;

  v_total := v_subtotal - v_discount + v_shipping;

  -- COD rules (US-05/US-06): cap + vendor-shipped — decided here, server-side
  if v_method = 'cod' then
    if v_vendor_mode then
      return jsonb_build_object('ok', false, 'reason', 'cod_vendor_ship');
    end if;
    if v_total > v_cod_cap then
      return jsonb_build_object('ok', false, 'reason', 'cod_cap', 'cap_piastres', v_cod_cap);
    end if;
  end if;

  -- shipment number ETS-YY-### — one per order, assigned exactly once
  v_yy := (extract(year from now())::integer % 100)::smallint;
  insert into public.order_sequences (year, last_seq) values (v_yy, 0)
    on conflict (year) do nothing;
  update public.order_sequences set last_seq = last_seq + 1
    where year = v_yy returning last_seq into v_seq;
  v_number := 'ETS-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 3, '0');

  v_order_status := case when v_method = 'cod' then 'processing'::text
                         when v_vendor_mode then 'on_hold'
                         else 'pending_payment' end;

  insert into public.orders (number, attempt_key, user_id, email,
      phone_primary, phone_alternate, ship_name, governorate_id, area_id,
      address1, address2, postal_code, status, payment_method, payment_status,
      subtotal_piastres, discount_piastres, shipping_fee_piastres, total_piastres,
      coupon_id, coupon_code)
  values (v_number, v_attempt, v_uid, v_profile.email,
      v_addr->>'phone_primary', v_addr->>'phone_alternate', v_addr->>'full_name',
      (v_addr->>'governorate_id')::smallint, (v_addr->>'area_id')::bigint,
      v_addr->>'address1', nullif(trim(coalesce(v_addr->>'address2', '')), ''),
      nullif(trim(coalesce(v_addr->>'postal_code', '')), ''),
      v_order_status, v_method,
      case when v_method = 'cod' then 'cod_pending' else 'unpaid' end,
      v_subtotal, v_discount, v_shipping, v_total,
      case when v_coupon_row.id is not null then v_coupon_row.id end, v_coupon_code)
  returning id into v_order_id;

  -- one group per vendor; commission from the vendor's level rewards (bps)
  foreach v_vid in array v_vendor_ids loop
    v_group_subtotal := 0; v_group_discount := 0; v_group_commission := 0;
    select coalesce((vl.rewards->>'commission_percent')::numeric, 5) into v_rate
      from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
      where v.id = v_vid;
    v_commission_bps := round(coalesce(v_rate, 5) * 100)::integer;

    insert into public.order_vendor_groups (order_id, vendor_id, status,
        shipping_mode, vendor_ship_status)
    values (v_order_id, v_vid,
        case when v_method = 'cod' then 'preparing' else 'pending' end,
        case when exists (
          select 1 from jsonb_array_elements(v_rows) e
          where (e->>'vendor_id')::uuid = v_vid and (e->>'shipping_mode') = 'vendor'
        ) then 'vendor' else 'platform' end,
        case when exists (
          select 1 from jsonb_array_elements(v_rows) e
          where (e->>'vendor_id')::uuid = v_vid and (e->>'shipping_mode') = 'vendor'
        ) then 'pending_admin' else 'not_required' end)
    returning id into v_group_id;

    for v_it in select je as ln from jsonb_array_elements(v_rows) je where (je->>'vendor_id')::uuid = v_vid loop
      v_row := v_it.ln;
      declare
        v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
        v_line_discount integer := coalesce((v_row->>'coupon_discount')::integer, 0);
        v_net integer := v_line_total - v_line_discount;
        v_commission integer := trunc(v_net * v_commission_bps / 10000)::integer;
      begin
        insert into public.order_items (order_id, group_id, vendor_id, variant_id,
            product_id, leaf_category_id, product_name_ar, product_name_en,
            option_key, sku, image_path, unit_price_piastres, qty,
            line_total_piastres, coupon_discount_piastres, commission_piastres,
            commission_rate_bps, is_fragile)
        values (v_order_id, v_group_id, v_vid, (v_row->>'variant_id')::uuid,
            (v_row->>'product_id')::uuid, (v_row->>'leaf_category_id')::uuid,
            coalesce(v_row->>'name_ar', ''), coalesce(v_row->>'name_en', ''),
            coalesce(v_row->>'option_key', ''), v_row->>'sku', v_row->>'image_path',
            (v_row->>'unit')::integer, (v_row->>'qty')::integer,
            v_line_total, v_line_discount, v_commission, v_commission_bps,
            coalesce((v_row->>'is_fragile')::boolean, false));

        v_group_subtotal := v_group_subtotal + v_line_total;
        v_group_discount := v_group_discount + v_line_discount;
        v_group_commission := v_group_commission + v_commission;

        -- stock decrement (variant rows are locked above)
        update public.variants set stock = stock - (v_row->>'qty')::integer
          where id = (v_row->>'variant_id')::uuid;
      end;
    end loop;

    update public.order_vendor_groups
      set items_subtotal_piastres = v_group_subtotal,
          discount_piastres = v_group_discount,
          commission_piastres = v_group_commission
      where id = v_group_id;
  end loop;

  -- coupon redemption (counts toward max_uses inside the transaction)
  if v_coupon_row.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id)
    values (v_coupon_row.id, v_uid, v_order_id);
  end if;

  -- purchased lines leave the cart
  delete from public.cart_items where user_id = v_uid;

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order_id, v_order_status, 'order_created', v_uid);

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'number', v_number,
    'payment_method', v_method, 'status', v_order_status);
exception
  when others then
    -- transaction rolls back automatically; surface the real cause
    return jsonb_build_object('ok', false, 'reason', 'server_error',
      'detail', sqlerrm);
end $$;

-- ============================================================================
-- fn_confirm_payment — idempotent payment confirmation (webhook only).
-- provider_ref = Kashier transactionId; a duplicate ref is a no-op.
-- p_status: 'succeeded' | 'failed'
-- ============================================================================
create or replace function public.fn_confirm_payment(p_number text, p_provider_ref text,
  p_status text, p_amount_piastres integer, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_paid boolean;
  v_new_status text;
  v_ref text := coalesce(nullif(trim(p_provider_ref), ''), 'missing');
begin
  select * into v_order from public.orders where number = p_number;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- idempotency on provider_ref (US-08: identical ref processed once)
  select exists (
    select 1 from public.payments
    where provider = 'kashier' and provider_ref = v_ref and status = 'succeeded'
  ) into v_paid;
  if v_paid then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  -- amount must match the order total — a mismatch is a reconciliation case,
  -- never a silent overwrite
  if p_amount_piastres is not null and p_amount_piastres <> v_order.total_piastres then
    insert into public.payments (order_id, provider, provider_ref, amount_piastres,
        status, raw_payload, processed_at)
    values (v_order.id, 'kashier', v_ref, p_amount_piastres, 'failed',
        jsonb_build_object('reason', 'amount_mismatch', 'expected', v_order.total_piastres,
                           'webhook', coalesce(p_raw, '{}'::jsonb)), now());
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;

  insert into public.payments (order_id, provider, provider_ref, amount_piastres,
      status, raw_payload, processed_at)
  values (v_order.id, 'kashier', v_ref, v_order.total_piastres, p_status,
      coalesce(p_raw, '{}'::jsonb), now());

  if p_status = 'succeeded' then
    v_new_status := case when v_order.status = 'pending_payment'
      and exists (select 1 from public.order_vendor_groups g
                  where g.order_id = v_order.id and g.vendor_ship_status = 'pending_admin')
      then 'on_hold'::text
      when v_order.status = 'pending_payment' then 'processing'
      else v_order.status end;
    update public.orders
      set payment_status = 'paid', status = v_new_status, updated_at = now()
      where id = v_order.id;
    insert into public.order_status_history (order_id, status, note)
    values (v_order.id, v_new_status, 'payment_confirmed');
    perform public.fn_notify(v_order.user_id, 'payment_success', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم تأكيد الدفع', 'body', 'تم استلام دفعة الطلب ' || v_order.number),
      'en', jsonb_build_object('title', 'Payment confirmed', 'body', 'Payment received for order ' || v_order.number),
      'link', '/account/orders/' || v_order.number));
  else
    insert into public.order_status_history (order_id, status, note)
    values (v_order.id, v_order.status, 'payment_failed');
    perform public.fn_notify(v_order.user_id, 'payment_failed', jsonb_build_object(
      'ar', jsonb_build_object('title', 'فشل الدفع', 'body', 'فشل دفع الطلب ' || v_order.number || ' — يمكنك إعادة المحاولة'),
      'en', jsonb_build_object('title', 'Payment failed', 'body', 'Payment failed for order ' || v_order.number || ' — you can retry'),
      'link', '/account/orders/' || v_order.number));
  end if;

  return jsonb_build_object('ok', true, 'idempotent', false);
end $$;

-- ============================================================================
-- fn_cancel_order — customer cancels before anything ships; stock restored;
-- coupon redemption released.
-- ============================================================================
create or replace function public.fn_cancel_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order orders%rowtype;
  it record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select * into v_order from public.orders where id = p_order_id and user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_order.status not in ('pending_payment', 'processing', 'on_hold') then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;
  if exists (select 1 from public.order_vendor_groups g
             where g.order_id = v_order.id
               and g.status not in ('pending', 'preparing')) then
    return jsonb_build_object('ok', false, 'reason', 'already_shipping');
  end if;

  -- restore stock
  for it in select variant_id, qty from public.order_items where order_id = v_order.id loop
    update public.variants set stock = stock + it.qty where id = it.variant_id;
  end loop;

  -- release the coupon redemption (cancelled orders don't consume uses)
  delete from public.coupon_redemptions where order_id = v_order.id;

  update public.orders
    set status = 'cancelled', cancel_reason = left(trim(p_reason), 500),
        cancelled_at = now(), updated_at = now()
    where id = v_order.id;
  update public.order_vendor_groups
    set status = 'cancelled', cancelled_at = now()
    where order_id = v_order.id and status in ('pending', 'preparing');

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order.id, 'cancelled', left(trim(p_reason), 500), v_uid);

  perform public.fn_notify(v_order.user_id, 'order_cancelled', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم إلغاء الطلب', 'body', 'تم إلغاء الطلب ' || v_order.number),
    'en', jsonb_build_object('title', 'Order cancelled', 'body', 'Order ' || v_order.number || ' was cancelled'),
    'link', '/account/orders/' || v_order.number));

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- fn_request_refund — 14-day return / 30-day warranty from delivered_at;
-- duplicate-per-item and quantity rules enforced; evidence = documents paths.
-- p_items: [{order_item_id, qty, reason}]
-- ============================================================================
create or replace function public.fn_request_refund(p_order_id uuid, p_kind text,
  p_items jsonb, p_description text, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order orders%rowtype;
  v_request_id uuid;
  v_item jsonb;
  v_oi record;
  v_already integer;
  v_window_days integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  select * into v_order from public.orders where id = p_order_id and user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_kind not in ('return', 'warranty') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if v_order.delivered_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  v_window_days := case when p_kind = 'return' then 14 else 30 end;
  if v_order.delivered_at + make_interval(days => v_window_days) < now() then
    return jsonb_build_object('ok', false, 'reason', 'window_expired', 'days', v_window_days);
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_items');
  end if;

  insert into public.refund_requests (order_id, user_id, kind, description,
      evidence, status)
  values (p_order_id, v_uid, p_kind, left(coalesce(p_description, ''), 2000),
      coalesce(p_evidence, '[]'::jsonb), 'pending_admin')
  returning id into v_request_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_oi from public.order_items oi
      where oi.id = (v_item->>'order_item_id')::uuid and oi.order_id = p_order_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'item_not_in_order');
    end if;
    -- total requested across ALL requests never exceeds the purchased qty
    select coalesce(sum(qty), 0) into v_already
      from public.refund_request_items rri
      where rri.order_item_id = v_oi.id;
    if v_already + (v_item->>'qty')::integer > v_oi.qty then
      return jsonb_build_object('ok', false, 'reason', 'qty_exceeded',
        'order_item_id', v_oi.id, 'remaining', v_oi.qty - v_already);
    end if;
    insert into public.refund_request_items (refund_request_id, order_item_id, qty, reason)
    values (v_request_id, v_oi.id, (v_item->>'qty')::integer, v_item->>'reason');
  end loop;

  insert into public.order_status_history (order_id, status, note)
  values (p_order_id, v_order.status, 'refund_requested');

  -- notify every admin + the customer
  perform public.fn_notify(v_uid, 'refund_submitted', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم استلام طلب الاسترجاع', 'body', 'سيراجع الإدارة طلبك قريبًا'),
    'en', jsonb_build_object('title', 'Refund request received', 'body', 'Your request is now under admin review'),
    'link', '/account/returns'));
  perform public.fn_notify(a.actor_id, 'refund_submitted_admin', jsonb_build_object(
    'ar', jsonb_build_object('title', 'طلب استرجاع جديد', 'body', 'الطلب ' || v_order.number),
    'en', jsonb_build_object('title', 'New refund request', 'body', 'Order ' || v_order.number),
    'link', '/admin/refunds'))
    from (select id as actor_id from public.profiles where role = 'admin') a;

  return jsonb_build_object('ok', true, 'refund_request_id', v_request_id);
end $$;

-- ============================================================================
-- fn_update_group_status — admin: all states; vendor: 'preparing' only.
-- Delivered on the last group completes the order + stamps delivered_at
-- (anchors the 14/30-day windows and review eligibility).
-- ============================================================================
create or replace function public.fn_update_group_status(p_group_id uuid,
  p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group order_vendor_groups%rowtype;
  v_order orders%rowtype;
  r record;
  v_vendor_is_actor boolean := public.own_vendor_id() = (select vendor_id from public.order_vendor_groups where id = p_group_id);
  v_all_delivered boolean;
  v_all_cancelled boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_order from public.orders where id = v_group.order_id;
  if not (public.is_admin() or v_vendor_is_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_status not in ('preparing','handed_to_carrier','out_for_delivery','delivered','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  if v_vendor_is_actor and not public.is_admin() and p_status <> 'preparing' then
    return jsonb_build_object('ok', false, 'reason', 'vendor_limited');
  end if;
  if v_group.status in ('delivered', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'group_closed');
  end if;
  if p_status <> 'cancelled' and v_order.status = 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'payment_pending');
  end if;
  if p_status = 'cancelled' and not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  update public.order_vendor_groups set
    status = p_status,
    shipped_at = case when p_status = 'handed_to_carrier' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when p_status = 'cancelled' then left(trim(coalesce(p_note, '')), 500) else cancel_reason end
    where id = p_group_id;

  insert into public.order_status_history (order_id, group_id, status, note, actor)
  values (v_order.id, p_group_id, p_status, left(coalesce(p_note, ''), 500), v_uid);

  if p_status = 'cancelled' then
    -- group cancellation restores its stock (US-09: other groups continue)
    for r in select variant_id, qty from public.order_items where group_id = p_group_id loop
      update public.variants set stock = stock + r.qty where id = r.variant_id;
    end loop;
  end if;

  select bool_and(g.status = 'delivered'), bool_and(g.status = 'cancelled')
    into v_all_delivered, v_all_cancelled
    from public.order_vendor_groups g where g.order_id = v_order.id;

  if v_all_delivered then
    update public.orders set status = 'completed', delivered_at = now(), updated_at = now()
      where id = v_order.id;
    insert into public.order_status_history (order_id, status, note, actor)
    values (v_order.id, 'completed', 'all_groups_delivered', v_uid);
    perform public.fn_notify(v_order.user_id, 'order_delivered', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم تسليم طلبك', 'body', 'الطلب ' || v_order.number || ' تم تسليمه بالكامل'),
      'en', jsonb_build_object('title', 'Order delivered', 'body', 'Order ' || v_order.number || ' was delivered'),
      'link', '/account/orders/' || v_order.number));
  elsif not v_all_cancelled then
    update public.orders set status = case
        when v_order.status = 'pending_payment' then 'pending_payment'
        else 'processing' end, updated_at = now()
      where id = v_order.id and status not in ('cancelled');
  elsif v_all_cancelled then
    update public.orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id and status <> 'cancelled';
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- fn_set_cod_collected — admin reconciles a collected COD payment (US-13)
-- ============================================================================
create or replace function public.fn_set_cod_collected(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  if not public.is_admin() or auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_order.payment_method <> 'cod' then
    return jsonb_build_object('ok', false, 'reason', 'not_cod');
  end if;
  if v_order.payment_status = 'cod_collected' then
    return jsonb_build_object('ok', false, 'reason', 'already_collected');
  end if;
  update public.orders set payment_status = 'cod_collected', updated_at = now()
    where id = p_order_id;
  insert into public.order_status_history (order_id, status, note, actor)
  values (p_order_id, v_order.status, 'cod_collected', auth.uid());
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- fn_submit_review — delivered-order items only; one review per order item;
-- 0.5–5 stars (rounded to the nearest half).
-- ============================================================================
create or replace function public.fn_submit_review(p_order_item_id uuid,
  p_rating numeric, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_oi order_items%rowtype;
  v_rating numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  select * into v_oi from public.order_items where id = p_order_item_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not exists (select 1 from public.orders o
                 where o.id = v_oi.order_id and o.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from public.orders o
                 where o.id = v_oi.order_id and o.delivered_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  if exists (select 1 from public.reviews rw where rw.order_item_id = p_order_item_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;
  if p_rating is null or p_rating < 0.5 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_rating');
  end if;
  v_rating := round(p_rating * 2) / 2;
  insert into public.reviews (product_id, vendor_id, customer_id, order_item_id,
      rating, title, body, status)
  values (v_oi.product_id, v_oi.vendor_id, v_uid, p_order_item_id, v_rating,
      left(coalesce(p_title, ''), 200), left(coalesce(p_body, ''), 2000), 'pending');
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- fn_log_document — every print/reprint writes order_documents (AGENT §28);
-- permission checked inside: admin any doc, vendor own docs.
-- ============================================================================
create or replace function public.fn_log_document(p_order_id uuid, p_doc_type text,
  p_vendor_id uuid, p_copies integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vendor_id uuid := public.own_vendor_id();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if public.is_admin() then
    null; -- admins log any document
  elsif v_vendor_id is not null and p_vendor_id = v_vendor_id
        and p_doc_type in ('invoice_vendor', 'label_vendor')
        and exists (select 1 from public.order_vendor_groups g
                    where g.order_id = p_order_id and g.vendor_id = v_vendor_id) then
    null; -- vendors log only their own documents
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  insert into public.order_documents (order_id, vendor_id, doc_type, copies, printed_by)
  values (p_order_id, p_vendor_id, p_doc_type,
          greatest(1, least(coalesce(p_copies, 1), 50)), v_uid);
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- EXECUTE GRANTS
-- ============================================================================
revoke all on function public.fn_create_order(jsonb) from public, anon;
grant execute on function public.fn_create_order(jsonb) to authenticated;

revoke all on function public.fn_confirm_payment(text, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_confirm_payment(text, text, text, integer, jsonb) to service_role;

revoke all on function public.fn_cancel_order(uuid, text) from public, anon;
grant execute on function public.fn_cancel_order(uuid, text) to authenticated;

revoke all on function public.fn_request_refund(uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.fn_request_refund(uuid, text, jsonb, text, jsonb) to authenticated;

revoke all on function public.fn_update_group_status(uuid, text, text) from public, anon;
grant execute on function public.fn_update_group_status(uuid, text, text) to authenticated;

revoke all on function public.fn_set_cod_collected(uuid) from public, anon, authenticated;
grant execute on function public.fn_set_cod_collected(uuid) to service_role, authenticated;

revoke all on function public.fn_submit_review(uuid, numeric, text, text) from public, anon;
grant execute on function public.fn_submit_review(uuid, numeric, text, text) to authenticated;

revoke all on function public.fn_log_document(uuid, text, uuid, integer) from public, anon;
grant execute on function public.fn_log_document(uuid, text, uuid, integer) to authenticated;

-- ============================================================================
-- EMAIL TEMPLATES — order lifecycle (JOURNEYS §15; templates from DB, O-13)
-- ============================================================================
insert into public.email_templates (key, subject_ar, subject_en, html_ar, html_en, variables) values
('order_confirmation',
 'تأكيد طلبك {{order_number}} — اتسوء',
 'Your order {{order_number}} is confirmed — Etsawaa',
 '<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><h2 style="margin:0 0 8px">شكرًا لك، {{customer_name}}</h2><p>تم تأكيد طلبك رقم <strong>{{order_number}}</strong> بإجمالي {{order_total}} ({{payment_method}}).</p><p style="margin:16px 0"><a href="{{track_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">تتبع الطلب</a></p><p style="color:#666;font-size:13px">سنخطرك بكل تحديث على الطلب عبر البريد والتنبيهات.</p></div>',
 '<div dir="ltr" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><h2 style="margin:0 0 8px">Thank you, {{customer_name}}</h2><p>Your order <strong>{{order_number}}</strong> is confirmed with a total of {{order_total}} ({{payment_method}}).</p><p style="margin:16px 0"><a href="{{track_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">Track your order</a></p><p style="color:#666;font-size:13px">We will notify you of every update by email and in-app notifications.</p></div>',
 '["customer_name","order_number","order_total","payment_method","track_url"]'),
('payment_success',
 'تم تأكيد الدفع للطلب {{order_number}} — اتسوء',
 'Payment confirmed for order {{order_number}} — Etsawaa',
 '<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>تم استلام مبلغ {{order_total}} بنجاح للطلب <strong>{{order_number}}</strong>. أصبح الطلب قيد التجهيز.</p><p style="margin:16px 0"><a href="{{order_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">تفاصيل الطلب</a></p></div>',
 '<div dir="ltr" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>We received {{order_total}} for order <strong>{{order_number}}</strong>. It is now being prepared.</p><p style="margin:16px 0"><a href="{{order_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">Order details</a></p></div>',
 '["order_number","order_total","order_url"]'),
('payment_failed',
 'فشل الدفع للطلب {{order_number}} — اتسوء',
 'Payment failed for order {{order_number}} — Etsawaa',
 '<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>فشل دفع الطلب <strong>{{order_number}}</strong>. طلبك محفوظ ويمكنك إعادة المحاولة من صفحة الطلب دون إعادة الشراء.</p><p style="margin:16px 0"><a href="{{retry_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">إعادة المحاولة</a></p></div>',
 '<div dir="ltr" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>Payment for order <strong>{{order_number}}</strong> failed. Your order is saved and you can retry from the order page without placing a new one.</p><p style="margin:16px 0"><a href="{{retry_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">Retry payment</a></p></div>',
 '["order_number","retry_url"]'),
('order_shipped',
 'طلبك {{order_number}} في الطريق — اتسوء',
 'Order {{order_number}} is on its way — Etsawaa',
 '<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>تم تسليم طلبك <strong>{{order_number}}</strong> لشركة الشحن وتسير في الطريق إليك.</p><p style="margin:16px 0"><a href="{{track_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">تتبع الطلب</a></p></div>',
 '<div dir="ltr" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>Your order <strong>{{order_number}}</strong> was handed to the carrier and is on its way.</p><p style="margin:16px 0"><a href="{{track_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">Track your order</a></p></div>',
 '["order_number","track_url"]'),
('order_delivered',
 'تم تسليم طلبك {{order_number}} — اتسوء',
 'Order {{order_number}} was delivered — Etsawaa',
 '<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>تم تسليم الطلب <strong>{{order_number}}</strong> بالكامل. نتمنى أن يسعدك.</p><p>يمكنك تقييم منتجاتك خلال {{review_days}} يوم، وطلب الاسترجاع خلال {{return_days}} يوم من التسليم.</p><p style="margin:16px 0"><a href="{{order_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">تقييم المنتجات</a></p></div>',
 '<div dir="ltr" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>Order <strong>{{order_number}}</strong> was delivered in full. We hope you enjoy it.</p><p>You can review your products within {{review_days}} days and request a return within {{return_days}} days of delivery.</p><p style="margin:16px 0"><a href="{{order_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">Review products</a></p></div>',
 '["order_number","order_url","review_days","return_days"]'),
('order_cancelled',
 'إلغاء الطلب {{order_number}} — اتسوء',
 'Order {{order_number}} cancelled — Etsawaa',
 '<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>تم إلغاء الطلب <strong>{{order_number}}</strong>. السبب: {{reason}}</p><p style="margin:16px 0"><a href="{{order_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">تفاصيل الطلب</a></p></div>',
 '<div dir="ltr" style="font-family:Arial,sans-serif;padding:24px;color:#1a1a1a"><p>Order <strong>{{order_number}}</strong> was cancelled. Reason: {{reason}}</p><p style="margin:16px 0"><a href="{{order_url}}" style="background:#0f766e;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px">Order details</a></p></div>',
 '["order_number","reason","order_url"]')
on conflict (key) do nothing;

-- ============================================================================
-- PATCH 5a — profile alternate phone (O-28: all-roles profile page)
-- ============================================================================
alter table public.profiles add column if not exists phone_alternate text;
alter table public.profiles
  drop constraint if exists profiles_phone_alternate_e164_check;
alter table public.profiles
  add constraint profiles_phone_alternate_e164_check
  check (phone_alternate is null or phone_alternate ~ '^\+[0-9]{10,15}$');

-- ============================================================================
-- PATCH 5b — vendor order access WITHOUT leaking customer contact data.
-- Vendors never get row-level SELECT on orders (phone/email/address are
-- customer-private); they get a definer snapshot of the SAFE columns for
-- orders that contain one of their groups (AGENT §28 / US-15).
-- ============================================================================
create or replace function public.fn_vendor_order_snapshot(p_number text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'status', o.status,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'ship_name', o.ship_name,
    'subtotal_piastres', o.subtotal_piastres, 'discount_piastres', o.discount_piastres,
    'shipping_fee_piastres', o.shipping_fee_piastres, 'total_piastres', o.total_piastres,
    'created_at', o.created_at, 'delivered_at', o.delivered_at, 'cancel_reason', o.cancel_reason,
    'governorate_id', o.governorate_id, 'area_id', o.area_id
  )
  from public.orders o
  where o.number = p_number
    and exists (select 1 from public.order_vendor_groups g
                where g.order_id = o.id and g.vendor_id = public.own_vendor_id());
$$;

create or replace function public.fn_vendor_orders_list()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'status', g.status,
    'shipping_mode', g.shipping_mode, 'vendor_ship_status', g.vendor_ship_status,
    'items_subtotal_piastres', g.items_subtotal_piastres,
    'discount_piastres', g.discount_piastres,
    'commission_piastres', g.commission_piastres,
    'shipped_at', g.shipped_at, 'delivered_at', g.delivered_at,
    'cancel_reason', g.cancel_reason, 'created_at', g.created_at,
    'order', jsonb_build_object(
      'id', o.id, 'number', o.number, 'status', o.status,
      'payment_method', o.payment_method, 'payment_status', o.payment_status,
      'ship_name', o.ship_name, 'total_piastres', o.total_piastres,
      'created_at', o.created_at)
  ) order by g.created_at desc), '[]'::jsonb)
  from public.order_vendor_groups g
  join public.orders o on o.id = g.order_id
  where g.vendor_id = public.own_vendor_id();
$$;

revoke all on function public.fn_vendor_order_snapshot(text) from public, anon;
grant execute on function public.fn_vendor_order_snapshot(text) to authenticated;
revoke all on function public.fn_vendor_orders_list() from public, anon;
grant execute on function public.fn_vendor_orders_list() to authenticated;

-- ============================================================================
-- PATCH 5c — break the RLS recursion between refund_requests and
-- refund_request_items (each policy referenced the other's table). The
-- cross-table checks move into SECURITY DEFINER helpers (definer context
-- bypasses RLS on the inner tables → no recursion).
-- ============================================================================
create or replace function public.fn_refund_visible_to_vendor(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.refund_request_items rri
    join public.order_items oi on oi.id = rri.order_item_id
    where rri.refund_request_id = p_request_id
      and oi.vendor_id = public.own_vendor_id()
  );
$$;

create or replace function public.fn_refund_owned_by_me(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.refund_requests rr
                 where rr.id = p_request_id and rr.user_id = auth.uid());
$$;

create or replace function public.fn_refund_item_mine(p_item_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_items oi
                 where oi.id = p_item_id and oi.vendor_id = public.own_vendor_id());
$$;

drop policy if exists refund_requests_select_reader on public.refund_requests;
create policy refund_requests_select_reader on public.refund_requests
  for select to authenticated using (
    public.is_admin()
    or user_id = auth.uid()
    or public.fn_refund_visible_to_vendor(refund_requests.id)
  );

drop policy if exists refund_items_select_reader on public.refund_request_items;
create policy refund_items_select_reader on public.refund_request_items
  for select to authenticated using (
    public.is_admin()
    or public.fn_refund_owned_by_me(refund_request_id)
    or public.fn_refund_item_mine(order_item_id)
  );

revoke all on function public.fn_refund_visible_to_vendor(uuid),
  public.fn_refund_owned_by_me(uuid), public.fn_refund_item_mine(uuid) from public, anon;
grant execute on function public.fn_refund_visible_to_vendor(uuid),
  public.fn_refund_owned_by_me(uuid), public.fn_refund_item_mine(uuid) to authenticated;
