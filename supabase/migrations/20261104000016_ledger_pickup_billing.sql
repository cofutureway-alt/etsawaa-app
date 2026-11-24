-- ============================================================================
-- Wallet ledger hardening + pickup billing (per shipment / per product)
--
-- 1) Ledger posting helpers become INTERNAL (grants are the guard, like
--    fn_notify): fn_post_transaction refused non-admin callers, so a seller
--    marking a shipment "handed to carrier" failed at the pickup-fee step.
--    Users can no longer EXECUTE the posting helpers at all.
-- 2) Idempotency key = (vendor, type, reference): every posting carries an
--    explicit reference, so two partial refunds on the same shipment no longer
--    collide on group_id while a retried posting is still a no-op.
-- 3) Commission was deducted twice (earning was already net of commission AND
--    a commission debit followed). Earning now posts GROSS, commission posts
--    its own debit, both PENDING; release moves the net to available.
-- 4) Pickup fee: settings.pickup.billing_mode = per_shipment | per_product.
--    One pickup_charges row per shipment (unique) → the wallet debit is linked
--    to it; vendor-shipped groups are never charged; retries are no-ops.
-- ============================================================================
begin;

-- 1) structured details for wallet rows (units, rate, mode, refs) ------------
alter table public.wallet_transactions add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type = any (array[
  'earning','commission','pickup_fee','shipping_revenue','penalty','ad_purchase','withdrawal',
  'withdrawal_refund','refund_clawback','admin_adjustment','packaging_balance','packaging_refund']));

drop index if exists public.wallet_tx_unique_action;
create unique index wallet_tx_unique_action on public.wallet_transactions
  (vendor_id, type, coalesce(reference, group_id::text, order_id::text));
create index if not exists wallet_tx_group_idx on public.wallet_transactions (group_id);

-- 2) internal posting helper (no caller check; EXECUTE revoked below) --------
drop function if exists public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid);
create or replace function public.fn_post_transaction(
  p_vendor_id uuid, p_type text, p_amount bigint, p_reference text, p_reason text,
  p_order_id uuid default null, p_group_id uuid default null, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'zero_amount');
  end if;
  select id into v_tx from public.wallet_transactions
   where vendor_id = p_vendor_id and type = p_type
     and coalesce(reference, group_id::text, order_id::text) = coalesce(p_reference, p_group_id::text, p_order_id::text);
  if v_tx is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_tx);
  end if;
  insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference,
      reason, order_id, group_id, created_by, meta)
  values (p_vendor_id, p_type, p_amount, p_reference, p_reason, p_order_id, p_group_id,
      auth.uid(), coalesce(p_meta, '{}'::jsonb))
  returning id into v_tx;
  return jsonb_build_object('ok', true, 'tx_id', v_tx);
exception when unique_violation then
  select id into v_tx from public.wallet_transactions
   where vendor_id = p_vendor_id and type = p_type
     and coalesce(reference, group_id::text, order_id::text) = coalesce(p_reference, p_group_id::text, p_order_id::text);
  return jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_tx);
end $$;

-- 3) commission + earning both land in PENDING; release moves the net ---------
create or replace function public.fn_wallet_apply_tx()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (vendor_id) values (new.vendor_id)
    on conflict (vendor_id) do nothing;
  -- an order's earning and its commission are PENDING until the hold ends;
  -- everything else (fees, refunds, withdrawals, adjustments) is immediate
  if new.type in ('earning', 'commission') then
    update public.wallets set pending_piastres = pending_piastres + new.amount_piastres, updated_at = now()
     where vendor_id = new.vendor_id;
  else
    update public.wallets set available_piastres = available_piastres + new.amount_piastres, updated_at = now()
     where vendor_id = new.vendor_id;
  end if;
  return new;
end $$;

create or replace function public.fn_post_earnings(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_number text;
  v_commission integer;
  v_gross integer;
  v_platform_coupon boolean;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.status <> 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  select number into v_number from public.orders where id = v_group.order_id;
  -- a commission-funded coupon (VO-22) is paid from the platform's commission:
  -- the vendor keeps the full item total and the commission shrinks instead
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
  return jsonb_build_object('ok', true, 'gross_piastres', v_gross, 'commission_piastres', v_commission,
                            'net_piastres', v_gross - v_commission);
end $$;

create or replace function public.fn_release_earnings()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_hold_days integer;
  v_net bigint;
  r record;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  for r in
    select t.id, t.vendor_id, t.amount_piastres, t.created_at, t.group_id, t.order_id
      from public.wallet_transactions t
     where t.type = 'earning'
       and not exists (select 1 from public.wallet_transactions rel
                        where rel.vendor_id = t.vendor_id and rel.type = 'admin_adjustment'
                          and rel.reference = 'release:' || t.id::text)
     for update of t skip locked
  loop
    select coalesce((vl.rewards->>'hold_days')::integer, 14) into v_hold_days
      from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
     where v.id = r.vendor_id;
    if r.created_at < now() - make_interval(days => coalesce(v_hold_days, 14)) then
      -- the group's commission was pending alongside the earning: release net
      select r.amount_piastres + coalesce(sum(c.amount_piastres), 0) into v_net
        from public.wallet_transactions c
       where c.vendor_id = r.vendor_id and c.type = 'commission' and c.group_id = r.group_id;
      insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, order_id, created_by, meta)
      values (r.vendor_id, 'admin_adjustment', v_net, 'release:' || r.id::text,
              'Earnings hold released to available', r.order_id, null,
              jsonb_build_object('group_id', r.group_id, 'kind', 'release'));
      update public.wallets set pending_piastres = pending_piastres - v_net, updated_at = now()
       where vendor_id = r.vendor_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'released', v_count);
end $$;

-- 4) pickup billing -------------------------------------------------------------
insert into public.settings (key, value)
values ('pickup', jsonb_build_object('billing_mode', 'per_product', 'charge_vendor_fault_returns', true))
on conflict (key) do nothing;

create table if not exists public.pickup_charges (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  group_id uuid references public.order_vendor_groups(id) on delete set null,
  refund_request_id uuid references public.refund_requests(id) on delete set null,
  kind text not null check (kind in ('outbound', 'return')),
  billing_mode text not null check (billing_mode in ('per_shipment', 'per_product')),
  units integer not null check (units >= 0),
  rate_piastres integer not null check (rate_piastres >= 0),
  amount_piastres integer not null check (amount_piastres >= 0),
  wallet_tx_id uuid references public.wallet_transactions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- one outbound pickup per shipment, one return pickup per (return, vendor)
create unique index if not exists pickup_charges_outbound_once on public.pickup_charges (group_id) where kind = 'outbound';
create unique index if not exists pickup_charges_return_once on public.pickup_charges (refund_request_id, vendor_id) where kind = 'return';
create index if not exists pickup_charges_vendor_idx on public.pickup_charges (vendor_id, created_at desc);

alter table public.pickup_charges enable row level security;
drop policy if exists pickup_charges_read on public.pickup_charges;
create policy pickup_charges_read on public.pickup_charges for select
  using (vendor_id = public.own_vendor_id() or public.is_admin());
grant select on public.pickup_charges to authenticated;

create or replace function public.fn_pickup_billing_mode()
returns text
language sql stable security definer set search_path = public as $$
  select case when (select value->>'billing_mode' from public.settings where key = 'pickup') = 'per_shipment'
              then 'per_shipment' else 'per_product' end;
$$;

-- Charge one pickup: p_units products at the vendor area's rate under the
-- current billing mode. Internal; callers pass the idempotency scope.
create or replace function public.fn_charge_pickup(
  p_kind text, p_vendor uuid, p_order uuid, p_group uuid, p_refund uuid, p_units integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mode text := public.fn_pickup_billing_mode();
  v_rate integer;
  v_amount integer;
  v_number text;
  v_charge uuid;
  v_tx jsonb;
  v_ref text;
begin
  select coalesce(a.pickup_fee_piastres, 0) into v_rate
    from public.vendors v left join public.areas a on a.id = v.area_id where v.id = p_vendor;
  v_rate := coalesce(v_rate, 0);
  v_amount := case when coalesce(p_units, 0) <= 0 then 0
                   when v_mode = 'per_shipment' then v_rate
                   else v_rate * p_units end;
  select number into v_number from public.orders where id = p_order;

  insert into public.pickup_charges (vendor_id, order_id, group_id, refund_request_id, kind,
      billing_mode, units, rate_piastres, amount_piastres, created_by)
  values (p_vendor, p_order, p_group, p_refund, p_kind, v_mode, coalesce(p_units, 0), v_rate, v_amount, auth.uid())
  on conflict do nothing
  returning id into v_charge;
  if v_charge is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if v_amount = 0 then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'zero_rate', 'charge_id', v_charge);
  end if;

  v_ref := case when p_kind = 'outbound' then 'pickup:' || p_group::text
                else 'return-pickup:' || p_refund::text || ':' || p_vendor::text end;
  v_tx := public.fn_post_transaction(p_vendor, 'pickup_fee', -v_amount, v_ref,
    case when p_kind = 'outbound' then 'Pickup fee' else 'Return pickup fee (vendor fault)' end
      || ' — order ' || coalesce(v_number, '?') || ': '
      || case when v_mode = 'per_shipment' then '1 shipment × ' || v_rate
              else p_units || ' products × ' || v_rate end || ' piastres',
    p_order, p_group,
    jsonb_build_object('kind', p_kind, 'billing_mode', v_mode, 'units', p_units, 'rate_piastres', v_rate,
                       'order_number', v_number, 'charge_id', v_charge, 'refund_request_id', p_refund));
  update public.pickup_charges set wallet_tx_id = (v_tx->>'tx_id')::uuid where id = v_charge;
  return jsonb_build_object('ok', true, 'posted', true, 'amount_piastres', v_amount, 'charge_id', v_charge);
end $$;

-- Outbound pickup of one shipment (= one vendor group). Locked + unique, so
-- a retried "handed to carrier" never charges twice. Vendor-shipped groups
-- are not collected by the platform → no pickup fee.
create or replace function public.fn_post_pickup_fee(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_group order_vendor_groups%rowtype;
  v_units integer;
begin
  select * into v_group from public.order_vendor_groups where id = p_group_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.shipping_mode = 'vendor' then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'vendor_shipping');
  end if;
  select coalesce(sum(i.qty), 0) into v_units from public.order_items i where i.group_id = p_group_id;
  return public.fn_charge_pickup('outbound', v_group.vendor_id, v_group.order_id, p_group_id, null, v_units);
end $$;

-- internal helpers: definer flows call them, users never do
revoke all on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fn_post_earnings(uuid) from public, anon, authenticated;
revoke all on function public.fn_post_pickup_fee(uuid) from public, anon, authenticated;
revoke all on function public.fn_charge_pickup(text, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.fn_post_earnings(uuid) to service_role;
grant execute on function public.fn_post_pickup_fee(uuid) to service_role;
grant execute on function public.fn_charge_pickup(text, uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.fn_pickup_billing_mode() to authenticated;

commit;
