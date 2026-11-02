-- ============================================================================
-- PHASE 06 — VENDOR OPERATIONS
-- Wallet (ledger) · withdrawals · penalties · vendor shipping flow · pickup
-- fee at ship time · earnings release · commission-funded coupons.
-- References: AGENT.md §7 (money) §8 (shipping) §31 (coupon funding),
-- ARCHITECTURE §6.2/§6.3, JOURNEYS §9a/§14, PLAN phase-06.
-- Apply: node --env-file=.env scripts/apply-migration.mjs <this-file>
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 0) SETTINGS — wallet hold + withdrawal minimum (money rules live in DB)
-- ----------------------------------------------------------------------------
insert into public.settings (key, value) values
('wallet', jsonb_build_object(
  'hold_days', 14,                -- default; overridden per level rewards.hold_days
  'min_withdrawal_piastres', 5000 -- 50 EGP
))
on conflict (key) do nothing;

update public.vendor_levels
set rewards = rewards || jsonb_build_object('hold_days', 14)
where rewards ->> 'hold_days' is null;

-- ----------------------------------------------------------------------------
-- 1) WALLETS + TRANSACTIONS (ledger is the source of truth; balances updated
--    by the post-insert trigger so they can never drift)
-- ----------------------------------------------------------------------------
create table if not exists public.wallets (
  vendor_id          uuid primary key references public.vendors(id) on delete cascade,
  available_piastres bigint not null default 0,
  pending_piastres   bigint not null default 0,
  updated_at         timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  type            text not null check (type in (
                    'earning','commission','pickup_fee','shipping_revenue','penalty',
                    'ad_purchase','withdrawal','withdrawal_refund','refund_clawback','admin_adjustment')),
  amount_piastres bigint not null,        -- signed: + credit, − debit
  reference       text,                   -- order number / withdrawal id / etc.
  reason          text,                   -- mandatory for every debit (CHECK below)
  order_id        uuid references public.orders(id) on delete set null,
  group_id        uuid references public.order_vendor_groups(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint wallet_tx_debit_needs_reason check (amount_piastres >= 0 or length(trim(coalesce(reason, ''))) > 0)
);
-- a money action can never be applied twice: one row per (vendor, type, ref)
create unique index if not exists wallet_tx_unique_action
  on public.wallet_transactions (vendor_id, type,
    coalesce(group_id::text, order_id::text, reference));
create index if not exists wallet_tx_vendor_idx on public.wallet_transactions (vendor_id, created_at desc);
create index if not exists wallet_tx_order_idx  on public.wallet_transactions (order_id);
create index if not exists wallet_tx_type_idx   on public.wallet_transactions (type);

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;

-- the ledger updates the wallet balances (AGENT §7 "derived/updated by triggers")
create or replace function public.fn_wallet_apply_tx()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- ensure the wallet row exists (balances are derived from the ledger)
  insert into public.wallets (vendor_id) values (new.vendor_id)
    on conflict (vendor_id) do nothing;
  -- earning credits are PENDING until their hold date; everything else is immediate
  if new.type = 'earning' then
    update public.wallets set
      pending_piastres = pending_piastres + new.amount_piastres,
      updated_at = now()
    where vendor_id = new.vendor_id;
  elsif new.type = 'withdrawal_refund' then
    -- a cancelled pending withdrawal restores the hold that was placed
    update public.wallets set
      available_piastres = available_piastres + new.amount_piastres,
      updated_at = now()
    where vendor_id = new.vendor_id;
  else
    update public.wallets set
      available_piastres = available_piastres + new.amount_piastres,
      updated_at = now()
    where vendor_id = new.vendor_id;
  end if;
  return new;
end $$;

drop trigger if exists wallet_tx_apply on public.wallet_transactions;
create trigger wallet_tx_apply
  after insert on public.wallet_transactions
  for each row execute function public.fn_wallet_apply_tx();

-- ----------------------------------------------------------------------------
-- 2) WITHDRAWALS + PENALTIES
-- ----------------------------------------------------------------------------
create table if not exists public.withdrawal_requests (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  amount_piastres integer not null check (amount_piastres > 0),
  method          text not null check (method in ('wallet','bank','instapay')),
  details         jsonb not null default '{}'::jsonb, -- account/holder/number
  status          text not null default 'pending' check (status in ('pending','approved','cancelled')),
  requested_by    uuid not null references auth.users(id),
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,
  paid_at         timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now()
);
create index if not exists withdrawals_vendor_idx on public.withdrawal_requests (vendor_id, created_at desc);
create index if not exists withdrawals_status_idx on public.withdrawal_requests (status, created_at desc);
alter table public.withdrawal_requests enable row level security;

create table if not exists public.vendor_penalties (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  source      text not null check (source in ('rule','manual')),
  rule_key    text,
  amount_piastres integer not null check (amount_piastres > 0),
  reason      text not null,
  reference   text,
  status      text not null default 'applied' check (status in ('applied','waived')),
  waived_by   uuid references auth.users(id),
  waived_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists penalties_vendor_idx on public.vendor_penalties (vendor_id, created_at desc);
alter table public.vendor_penalties enable row level security;

-- ----------------------------------------------------------------------------
-- 3) RLS — vendors read their own money rows; writes only through definer RPCs
-- ----------------------------------------------------------------------------
drop policy if exists wallets_vendor_read on public.wallets;
create policy wallets_vendor_read on public.wallets
  for select to authenticated
  using (vendor_id = public.own_vendor_id() or public.is_admin());

drop policy if exists wallet_tx_vendor_read on public.wallet_transactions;
create policy wallet_tx_vendor_read on public.wallet_transactions
  for select to authenticated
  using (vendor_id = public.own_vendor_id() or public.is_admin());

drop policy if exists withdrawals_vendor_read on public.withdrawal_requests;
create policy withdrawals_vendor_read on public.withdrawal_requests
  for select to authenticated
  using (vendor_id = public.own_vendor_id() or public.is_admin());

drop policy if exists penalties_vendor_read on public.vendor_penalties;
create policy penalties_vendor_read on public.vendor_penalties
  for select to authenticated
  using (vendor_id = public.own_vendor_id() or public.is_admin());

revoke all on public.wallets, public.wallet_transactions,
  public.withdrawal_requests, public.vendor_penalties from anon, public;
grant select on public.wallets, public.wallet_transactions,
  public.withdrawal_requests, public.vendor_penalties to authenticated;

-- ----------------------------------------------------------------------------
-- 4) FN_POST_TRANSACTION — single money-write helper: idempotent by
--    (vendor, type, ref); posts the ledger row, the trigger moves balances.
--    The commission of an earning is posted as its own debit row so the
--    vendor sees both sides (ARCHITECTURE §6.3 "commission deducted when
--    earnings are posted").
-- ----------------------------------------------------------------------------
create or replace function public.fn_post_transaction(
  p_vendor_id uuid, p_type text, p_amount bigint, p_reference text,
  p_reason text, p_order_id uuid default null, p_group_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  if p_type not in ('earning','commission','pickup_fee','shipping_revenue','penalty',
                    'ad_purchase','withdrawal','withdrawal_refund','refund_clawback','admin_adjustment') then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;
  -- one transaction per (vendor, type, reference) — retries are no-ops
  if exists (select 1 from public.wallet_transactions
             where vendor_id = p_vendor_id and type = p_type
               and coalesce(group_id::text, order_id::text, reference)
                 = coalesce(p_group_id::text, p_order_id::text, p_reference)) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference,
      reason, order_id, group_id, created_by)
  values (p_vendor_id, p_type, p_amount, p_reference, p_reason, p_order_id, p_group_id, auth.uid())
  returning id into v_tx;
  return jsonb_build_object('ok', true, 'tx_id', v_tx);
exception when unique_violation then
  return jsonb_build_object('ok', true, 'duplicate', true);
end $$;

-- ----------------------------------------------------------------------------
-- 5) FN_REQUEST_VENDOR_SHIPPING — the vendor asks to ship their group.
--    Group → on_hold + vendor_ship_status = pending_admin; the vendor CANNOT
--    mark it shipped while pending (checked in fn_vendor_set_fulfillment).
-- ----------------------------------------------------------------------------
create or replace function public.fn_request_vendor_shipping(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.vendor_id <> public.own_vendor_id() and not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_group.shipping_mode <> 'vendor' then
    return jsonb_build_object('ok', false, 'reason', 'not_vendor_mode');
  end if;
  if v_group.vendor_ship_status in ('pending_admin','approved') then
    -- idempotent request; ensure the ORDER hold matches the group state
    -- (fn_create_order stamps pending_admin at creation without holding)
    if v_group.vendor_ship_status = 'pending_admin' and v_group.status not in ('on_hold','delivered','cancelled') then
      update public.order_vendor_groups set status = 'on_hold' where id = p_group_id;
      update public.orders set status = 'on_hold', updated_at = now()
       where id = v_group.order_id and status in ('processing','pending_payment');
    end if;
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if v_group.status in ('delivered','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'group_closed');
  end if;

  update public.order_vendor_groups
     set vendor_ship_status = 'pending_admin', status = 'on_hold'
   where id = p_group_id;

  update public.orders set status = 'on_hold', updated_at = now()
   where id = v_group.order_id and status in ('processing','pending_payment');

  insert into public.order_status_history (order_id, group_id, status, note, actor)
  values (v_group.order_id, p_group_id, 'on_hold', 'vendor_shipping_requested', auth.uid());

  perform public.fn_notify(o.user_id, 'vendor_shipping_request', jsonb_build_object(
    'ar', jsonb_build_object('title', 'طلب شحن بائع',
          'body', 'يوجد طلب من بائع لشحن طلبك — تحت مراجعة الإدارة.'),
    'en', jsonb_build_object('title', 'Vendor shipping request',
          'body', 'A vendor requested to ship your order — pending admin review.'),
    'link', '/ar/admin/orders'))
  from public.orders o where o.id = v_group.order_id;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 6) FN_APPROVE_VENDOR_SHIPPING — admin only. Approve: the vendor's shipping
--    share is credited as shipping_revenue (idempotent) and the group leaves
--    the hold; Reject: NOTHING is posted, the platform ships, group resumes.
--    p_shipping_piastres: the approved shipping share (>= 0).
-- ----------------------------------------------------------------------------
create or replace function public.fn_approve_vendor_shipping(
  p_group_id uuid, p_decision text, p_shipping_piastres integer default 0,
  p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_number text;
  v_other_pending boolean;
  v_res jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_decision not in ('approve','reject') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.vendor_ship_status <> 'pending_admin' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  select number into v_number from public.orders where id = v_group.order_id;

  if p_decision = 'approve' then
    if coalesce(p_shipping_piastres, 0) < 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_amount');
    end if;
    -- shipping revenue credited ONLY on approval (AGENT §7); idempotent by ref
    if p_shipping_piastres > 0 then
      v_res := public.fn_post_transaction(
        p_vendor_id => v_group.vendor_id, p_type => 'shipping_revenue',
        p_amount => p_shipping_piastres, p_reference => v_number || ':shipping',
        p_reason => 'shipping revenue — approved vendor shipping', p_order_id => v_group.order_id,
        p_group_id => p_group_id);
      if not coalesce((v_res->>'ok')::boolean, false) then
        return jsonb_build_object('ok', false, 'reason', 'post_failed');
      end if;
    end if;
    update public.order_vendor_groups
       set vendor_ship_status = 'approved', status = 'preparing'
     where id = p_group_id;
  else
    -- rejection requires a reason and posts NOTHING
    if length(trim(coalesce(p_note, ''))) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
    update public.order_vendor_groups
       set vendor_ship_status = 'rejected', status = 'preparing'
     where id = p_group_id;
  end if;

  insert into public.order_status_history (order_id, group_id, status, note, actor)
  values (v_group.order_id, p_group_id,
          'preparing',
          case p_decision when 'approve' then 'vendor_shipping_approved'
                          else 'vendor_shipping_rejected: ' || left(p_note, 400) end,
          auth.uid());

  -- the ORDER leaves on_hold only when no other group is still pending review
  select exists (select 1 from public.order_vendor_groups g
                 where g.order_id = v_group.order_id
                   and g.vendor_ship_status = 'pending_admin')
    into v_other_pending;
  if not v_other_pending then
    update public.orders set status = 'processing', updated_at = now()
     where id = v_group.order_id and status = 'on_hold';
  end if;

  perform public.fn_notify(v.owner_id, 'vendor_shipping_decision', jsonb_build_object(
    'ar', jsonb_build_object('title', 'قرار شحن الطلب',
          'body', case p_decision
             when 'approve' then 'تمت الموافقة على شحنك للطلب ' || v_number || ' — يمكنك الشحن الآن.'
             else 'تم رفض طلب شحنك للطلب ' || v_number || ' — ستقوم المنصة بالشحن. السبب: ' || left(coalesce(p_note, ''), 200)
           end),
    'en', jsonb_build_object('title', 'Shipping decision',
          'body', case p_decision
             when 'approve' then 'Your shipping request for order ' || v_number || ' was approved — you can ship now.'
             else 'Your shipping request for order ' || v_number || ' was rejected — the platform will ship. Reason: ' || left(coalesce(p_note, ''), 200)
           end),
    'link', '/ar/vendor/orders'))
  from public.vendors v where v.id = v_group.vendor_id;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 7) FN_POST_PICKUP_FEE — deducted exactly once at SHIP time (the group's
--    first transition to handed_to_carrier). fee = qty × vendor-area rate.
--    Retrying the ship action never double-charges (unique action row).
-- ----------------------------------------------------------------------------
create or replace function public.fn_post_pickup_fee(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_qty integer;
  v_rate integer;
  v_number text;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select sum(i.qty) into v_qty from public.order_items i where i.group_id = p_group_id;
  select a.pickup_fee_piastres into v_rate
    from public.vendors v join public.areas a on a.id = v.area_id
   where v.id = v_group.vendor_id;
  select number into v_number from public.orders where id = v_group.order_id;

  if coalesce(v_rate, 0) = 0 or coalesce(v_qty, 0) = 0 then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'zero_rate');
  end if;

  return public.fn_post_transaction(
    p_vendor_id => v_group.vendor_id,
    p_type => 'pickup_fee',
    p_amount => -(v_qty * v_rate),
    p_reference => v_number || ':pickup',
    p_reason => 'Pickup fee — ' || v_qty || ' × ' || v_rate || ' piastres (area rate)',
    p_order_id => v_group.order_id,
    p_group_id => p_group_id);
end $$;

-- ----------------------------------------------------------------------------
-- 8) FN_VENDOR_SET_FULFILLMENT — vendor transitions for their OWN group.
--    Allowed: pending→preparing, preparing→handed_to_carrier (posts the
--    pickup fee exactly once + tracking history),
--    handed_to_carrier→out_for_delivery. Delivery is admin/platform (or
--    auto). Vendor-shipped groups REQUIRE admin approval before shipping.
--    Invalid transition → rejected with the reason.
-- ----------------------------------------------------------------------------
create or replace function public.fn_vendor_set_fulfillment(p_group_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_order orders%rowtype;
  v_res jsonb;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.vendor_id <> public.own_vendor_id() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_order from public.orders where id = v_group.order_id;

  if v_group.status in ('delivered','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'group_closed');
  end if;
  if v_order.status = 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'payment_pending');
  end if;
  -- vendor shipping cannot ship before admin approval (VO-04)
  if v_group.shipping_mode = 'vendor'
     and v_group.vendor_ship_status in ('pending_admin','not_required','rejected')
     and p_status = 'handed_to_carrier' then
    if v_group.vendor_ship_status = 'pending_admin' then
      return jsonb_build_object('ok', false, 'reason', 'awaiting_admin_approval');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'vendor_ship_not_approved');
  end if;

  -- allowed transitions (server-side table of truth)
  if not (
    (v_group.status = 'pending' and p_status = 'preparing')
    or (v_group.status = 'preparing' and p_status = 'handed_to_carrier')
    or (v_group.status = 'handed_to_carrier' and p_status = 'out_for_delivery')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition',
      'from', v_group.status, 'to', p_status);
  end if;

  update public.order_vendor_groups
     set status = p_status,
         shipped_at = case when p_status = 'handed_to_carrier' then now() else shipped_at end
   where id = p_group_id;

  insert into public.order_status_history (order_id, group_id, status, note, actor)
  values (v_group.order_id, p_group_id, p_status, left(coalesce(p_note, ''), 500), auth.uid());

  -- pickup fee posts exactly at ship time (idempotent on retry)
  if p_status = 'handed_to_carrier' then
    v_res := public.fn_post_pickup_fee(p_group_id);
    if not coalesce((v_res->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'pickup_failed', 'detail', v_res->>'reason');
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 9) FN_POST_EARNINGS — called when a group is DELIVERED: earning (net after
--    commission) → pending; commission → its own debit row. Idempotent per
--    group. Net = items_subtotal − discount − commission (ARCHITECTURE §6.3).
-- ----------------------------------------------------------------------------
create or replace function public.fn_post_earnings(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_number text;
  v_commission integer;
  v_net integer;
  v_hold_days integer;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.status <> 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  select number into v_number from public.orders where id = v_group.order_id;
  v_commission := v_group.commission_piastres;
  v_net := v_group.items_subtotal_piastres - v_group.discount_piastres - v_commission;

  -- vendor keeps the FULL item total when a commission-funded coupon paid the
  -- discount from the platform's commission (VO-22): the coupon discount is
  -- NOT deducted from the vendor when the coupon type is commission_percent.
  if exists (
    select 1 from public.orders o join public.coupons c on c.id = o.coupon_id
     where o.id = v_group.order_id and c.type = 'commission_percent'
  ) then
    v_net := v_net + v_group.discount_piastres; -- vendor untouched
    v_commission := greatest(v_commission - v_group.discount_piastres, 0);
  end if;

  if v_net > 0 then
    perform public.fn_post_transaction(
      p_vendor_id => v_group.vendor_id, p_type => 'earning',
      p_amount => v_net, p_reference => v_number || ':earning',
      p_reason => 'Order earning (net of commission)', p_order_id => v_group.order_id,
      p_group_id => p_group_id);
  end if;
  if v_commission > 0 then
    perform public.fn_post_transaction(
      p_vendor_id => v_group.vendor_id, p_type => 'commission',
      p_amount => -v_commission, p_reference => v_number || ':commission',
      p_reason => 'Platform commission', p_order_id => v_group.order_id,
      p_group_id => p_group_id);
  end if;
  return jsonb_build_object('ok', true, 'net_piastres', v_net, 'commission_piastres', v_commission);
end $$;

-- ----------------------------------------------------------------------------
-- 10) FN_RELEASE_EARNINGS — moves matured pending → available. Batch,
--     idempotent: released rows flip to available exactly once via the
--     withdrawal_refund-type rows? No — clean approach: an explicit release
--     transaction per earning row (type admin_adjustment would pollute).
--     Simplest source of truth: hold date computed per earning from the
--     vendor's level at post time; release posts a balancing pair.
-- ----------------------------------------------------------------------------
create or replace function public.fn_release_earnings()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_hold_days integer;
  r record;
begin
  for r in
    select t.id, t.vendor_id, t.amount_piastres, t.created_at
      from public.wallet_transactions t
     where t.type = 'earning'
       and not exists (
         select 1 from public.wallet_transactions rel
          where rel.vendor_id = t.vendor_id
            and rel.type = 'withdrawal_refund'
            and rel.reference = 'release:' || t.id::text)
       and not exists (
         select 1 from public.wallet_transactions rel2
          where rel2.vendor_id = t.vendor_id
            and rel2.type = 'admin_adjustment'
            and rel2.reference = 'release:' || t.id::text)
  loop
    select coalesce((vl.rewards->>'hold_days')::integer, 14) into v_hold_days
      from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
     where v.id = r.vendor_id;
    if r.created_at < now() - (v_hold_days || ' days')::interval then
      insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
      values (r.vendor_id, 'admin_adjustment', r.amount_piastres, 'release:' || r.id::text,
              'Earnings hold released to available', null);
      update public.wallets set pending_piastres = pending_piastres - r.amount_piastres,
                                 updated_at = now()
       where vendor_id = r.vendor_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'released', v_count);
end $$;

-- admin (or cron) may trigger the release; vendors cannot
revoke all on function public.fn_release_earnings() from public, anon;
grant execute on function public.fn_release_earnings() to authenticated;

-- cron: daily release at 03:40 UTC when pg_cron exists
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    begin
      perform cron.unschedule('release-vendor-earnings');
    exception when others then null;
    end;
    perform cron.schedule('release-vendor-earnings', '40 3 * * *', 'select public.fn_release_earnings();');
  else
    raise notice 'pg_cron not available — fn_release_earnings is exposed for a scheduled Edge Function';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 11) FN_REQUEST_WITHDRAWAL — amount ≤ available (server-side), min enforced,
--     funds HELD immediately (available −= amount through a withdrawal debit
--     row), one pending request per vendor at a time.
-- ----------------------------------------------------------------------------
create or replace function public.fn_request_withdrawal(
  p_amount_piastres integer, p_method text, p_details jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_vendor uuid := public.own_vendor_id();
  v_wallet wallets%rowtype;
  v_min integer;
  v_id uuid;
begin
  if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_method not in ('wallet','bank','instapay') then
    return jsonb_build_object('ok', false, 'reason', 'bad_method');
  end if;
  select * into v_wallet from public.wallets where vendor_id = v_vendor for update;
  if v_wallet is null then
    insert into public.wallets (vendor_id) values (v_vendor);
    select * into v_wallet from public.wallets where vendor_id = v_vendor for update;
  end if;
  select coalesce((s.value->>'min_withdrawal_piastres')::integer, 5000) into v_min
    from public.settings s where s.key = 'wallet';
  if p_amount_piastres < v_min then
    return jsonb_build_object('ok', false, 'reason', 'below_min', 'min_piastres', v_min);
  end if;
  if p_amount_piastres > v_wallet.available_piastres then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available_piastres', v_wallet.available_piastres);
  end if;
  if exists (select 1 from public.withdrawal_requests
             where vendor_id = v_vendor and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'pending_exists');
  end if;

  insert into public.withdrawal_requests (vendor_id, amount_piastres, method, details, requested_by)
  values (v_vendor, p_amount_piastres, p_method, coalesce(p_details, '{}'::jsonb), auth.uid())
  returning id into v_id;

  -- hold the funds: a debit row tied to the withdrawal id
  insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
  values (v_vendor, 'withdrawal', -p_amount_piastres, 'withdrawal:' || v_id::text,
          'Withdrawal request held', auth.uid());
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ----------------------------------------------------------------------------
-- 12) FN_CANCEL_WITHDRAWAL — vendor cancels while pending: restores the hold
--     exactly once (withdrawal_refund row keyed on the same withdrawal).
--     An approved withdrawal can never be cancelled.
-- ----------------------------------------------------------------------------
create or replace function public.fn_cancel_withdrawal(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w withdrawal_requests%rowtype;
begin
  select * into v_w from public.withdrawal_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.vendor_id <> public.own_vendor_id() and not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_w.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  update public.withdrawal_requests
     set status = 'cancelled', cancel_reason = left(coalesce(p_reason, 'vendor_cancelled'), 300),
         reviewed_at = now()
   where id = p_id;

  -- restore the hold exactly once
  if not exists (select 1 from public.wallet_transactions
                 where vendor_id = v_w.vendor_id and type = 'withdrawal_refund'
                   and reference = 'withdrawal:' || p_id::text) then
    insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
    values (v_w.vendor_id, 'withdrawal_refund', v_w.amount_piastres, 'withdrawal:' || p_id::text,
            'Withdrawal cancelled — hold restored', auth.uid());
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 13) FN_ADMIN_WITHDRAWAL_DECISION — approve (manual transfer done) or cancel.
--     Approval flips the status only (the funds were already held at request
--     time → reduced exactly once); cancel restores the hold via
--     withdrawal_refund. Audited via reviewed_by/reviewed_at/paid_at.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_withdrawal_decision(p_id uuid, p_decision text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_w withdrawal_requests%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_decision not in ('approve','cancel') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  select * into v_w from public.withdrawal_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if p_decision = 'approve' then
    update public.withdrawal_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), paid_at = now()
     where id = p_id;
  else
    update public.withdrawal_requests
       set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now(),
           cancel_reason = 'admin_cancelled'
     where id = p_id;
    if not exists (select 1 from public.wallet_transactions
                   where vendor_id = v_w.vendor_id and type = 'withdrawal_refund'
                     and reference = 'withdrawal:' || p_id::text) then
      insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
      values (v_w.vendor_id, 'withdrawal_refund', v_w.amount_piastres, 'withdrawal:' || p_id::text,
              'Withdrawal cancelled by admin — hold restored', auth.uid());
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 14) FN_VENDOR_WALLET_VIEW — safe snapshot (balances + level progress +
--     last transactions + pending withdrawals count) for the vendor UI.
-- ----------------------------------------------------------------------------
create or replace function public.fn_vendor_wallet_view()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_vendor uuid := public.own_vendor_id();
  v_wallet wallets%rowtype;
  v_level record;
  v_result jsonb;
  v_has_level boolean := false;
begin
  select * into v_wallet from public.wallets where vendor_id = v_vendor;
  if not found then
    v_wallet.available_piastres := 0; v_wallet.pending_piastres := 0;
  end if;
  select vl.name_ar, vl.name_en,
         coalesce((vl.rewards->>'commission_percent')::numeric, 5) as commission_percent,
         coalesce((vl.rewards->>'hold_days')::integer, 14) as hold_days,
         vl.min_successful_orders,
         (select min_successful_orders from public.vendor_levels nx
           where nx.is_active and nx.min_successful_orders > vl.min_successful_orders
           order by nx.min_successful_orders limit 1) as next_min_orders,
         (select nx.name_en from public.vendor_levels nx
           where nx.is_active and nx.min_successful_orders > vl.min_successful_orders
           order by nx.min_successful_orders limit 1) as next_name_en
    into v_level
    from public.vendors v join public.vendor_levels vl on vl.id = v.level_id
   where v.id = v_vendor;
  -- FOUND decides (a row with a NULL next_min_orders field makes the composite
  -- "is not null" comparison NULL — the level was invisible without this);
  -- snapshot immediately, the next SELECT resets FOUND
  v_has_level := found;
  select jsonb_build_object(
    'wallet', jsonb_build_object(
      'available_piastres', v_wallet.available_piastres,
      'pending_piastres', v_wallet.pending_piastres),
    'level', case when v_has_level then jsonb_build_object(
      'name_ar', v_level.name_ar, 'name_en', v_level.name_en,
      'commission_percent', v_level.commission_percent,
      'hold_days', v_level.hold_days,
      'min_successful_orders', v_level.min_successful_orders,
      'next_min_orders', v_level.next_min_orders,
      'next_name_en', v_level.next_name_en) else null end,
    'successful_orders', (select count(*) from public.order_vendor_groups g
       where g.vendor_id = v_vendor and g.status = 'delivered'),
    'pending_withdrawals', (select count(*) from public.withdrawal_requests
       where vendor_id = v_vendor and status = 'pending')
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid) from public, anon;
grant execute on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid) to authenticated;
revoke all on function public.fn_request_vendor_shipping(uuid) from public, anon;
grant execute on function public.fn_request_vendor_shipping(uuid) to authenticated;
revoke all on function public.fn_approve_vendor_shipping(uuid, text, integer, text) from public, anon;
grant execute on function public.fn_approve_vendor_shipping(uuid, text, integer, text) to authenticated;
revoke all on function public.fn_post_pickup_fee(uuid) from public, anon;
revoke all on function public.fn_vendor_set_fulfillment(uuid, text, text) from public, anon;
grant execute on function public.fn_vendor_set_fulfillment(uuid, text, text) to authenticated;
revoke all on function public.fn_post_earnings(uuid) from public, anon;
revoke all on function public.fn_request_withdrawal(integer, text, jsonb) from public, anon;
grant execute on function public.fn_request_withdrawal(integer, text, jsonb) to authenticated;
revoke all on function public.fn_cancel_withdrawal(uuid, text) from public, anon;
grant execute on function public.fn_cancel_withdrawal(uuid, text) to authenticated;
revoke all on function public.fn_admin_withdrawal_decision(uuid, text) from public, anon;
grant execute on function public.fn_admin_withdrawal_decision(uuid, text) to authenticated;
revoke all on function public.fn_vendor_wallet_view() from public, anon;
grant execute on function public.fn_vendor_wallet_view() to authenticated;

commit;
