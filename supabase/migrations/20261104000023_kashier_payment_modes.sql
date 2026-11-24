-- Kashier: live / test payment modes, payment sessions, and money isolation.
--
-- Every card order (customer orders and seller packaging orders) records the
-- Kashier mode it was created in. The webhook proves its mode by which
-- Payment API key signed it, and a confirmation is refused when that mode
-- differs from the order's — test money can never mark a live order paid,
-- and the other way round.
--
-- Test orders stay fully testable (they move to paid / processing like real
-- ones) but never touch seller money:
--   * fn_post_transaction skips wallet postings tied to a test order
--   * fn_post_earnings and fn_charge_pickup return early for a test order,
--     so no packaging balance is collected against fake earnings
--   * a test packaging order on the 50% plan opens no packaging balance
-- Test orders are labelled in the admin and excluded from money totals.

alter table public.orders
  add column if not exists payment_mode text not null default 'live',
  add column if not exists kashier_session_id text;
alter table public.orders drop constraint if exists orders_payment_mode_check;
alter table public.orders add constraint orders_payment_mode_check check (payment_mode in ('live', 'test'));

alter table public.packaging_orders
  add column if not exists payment_mode text not null default 'live',
  add column if not exists kashier_session_id text;
alter table public.packaging_orders drop constraint if exists packaging_orders_payment_mode_check;
alter table public.packaging_orders add constraint packaging_orders_payment_mode_check check (payment_mode in ('live', 'test'));

alter table public.payments add column if not exists mode text not null default 'live';
alter table public.packaging_payments add column if not exists mode text not null default 'live';

create index if not exists orders_payment_mode_test_idx on public.orders (created_at desc) where payment_mode = 'test';

-- is this order (or the order of this vendor group) a test-payment order?
create or replace function public.fn_is_test_order(p_order uuid, p_group uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
     where o.payment_mode = 'test'
       and (o.id = p_order
            or o.id = (select g.order_id from public.order_vendor_groups g where g.id = p_group))
  );
$$;
revoke all on function public.fn_is_test_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_is_test_order(uuid, uuid) to service_role;

-- 1) wallet postings: never for a test order
create or replace function public.fn_post_transaction(p_vendor_id uuid, p_type text, p_amount bigint, p_reference text, p_reason text, p_order_id uuid default null, p_group_id uuid default null, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'zero_amount');
  end if;
  if (p_order_id is not null or p_group_id is not null) and public.fn_is_test_order(p_order_id, p_group_id) then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'test_order');
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

-- 2) earnings (and the packaging-balance collection inside it) and pickup
--    fees: the existing bodies move to *_core, a guard sits in front
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_post_earnings_core') then
    alter function public.fn_post_earnings(uuid) rename to fn_post_earnings_core;
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_charge_pickup_core') then
    alter function public.fn_charge_pickup(text, uuid, uuid, uuid, uuid, integer) rename to fn_charge_pickup_core;
  end if;
end $$;

create or replace function public.fn_post_earnings(p_group_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.fn_is_test_order(null, p_group_id) then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'test_order');
  end if;
  return public.fn_post_earnings_core(p_group_id);
end $$;

create or replace function public.fn_charge_pickup(
  p_kind text, p_vendor uuid, p_order uuid, p_group uuid, p_refund uuid, p_units integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.fn_is_test_order(p_order, p_group) then
    return jsonb_build_object('ok', true, 'charged', false, 'reason', 'test_order');
  end if;
  return public.fn_charge_pickup_core(p_kind, p_vendor, p_order, p_group, p_refund, p_units);
end $$;

revoke all on function public.fn_post_earnings_core(uuid) from public, anon, authenticated;
revoke all on function public.fn_charge_pickup_core(text, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fn_post_earnings(uuid) from public, anon, authenticated;
revoke all on function public.fn_charge_pickup(text, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_post_earnings(uuid) to service_role;
grant execute on function public.fn_charge_pickup(text, uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid, jsonb) to service_role;

-- 3) customer order confirmation with a mode check
drop function if exists public.fn_confirm_payment(text, text, text, integer, jsonb);
create or replace function public.fn_confirm_payment(p_number text, p_provider_ref text, p_status text, p_amount_piastres integer, p_raw jsonb, p_mode text default 'live')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_paid boolean;
  v_new_status text;
  v_ref text := coalesce(nullif(trim(p_provider_ref), ''), 'missing');
begin
  select * into v_order from public.orders where number = p_number for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if coalesce(p_mode, 'live') <> v_order.payment_mode then
    return jsonb_build_object('ok', false, 'reason', 'mode_mismatch');
  end if;

  -- idempotency on provider_ref (US-08: identical ref processed once)
  select exists (
    select 1 from public.payments
    where provider = 'kashier' and provider_ref = v_ref and status = 'succeeded'
  ) into v_paid;
  if v_paid then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  -- a later failure for an order that is already paid changes nothing
  if p_status = 'failed' and v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  if p_amount_piastres is not null and p_amount_piastres <> v_order.total_piastres then
    insert into public.payments (order_id, provider, provider_ref, amount_piastres,
        status, raw_payload, processed_at, mode)
    values (v_order.id, 'kashier', v_ref, p_amount_piastres, 'failed',
        jsonb_build_object('reason', 'amount_mismatch', 'expected', v_order.total_piastres,
                           'webhook', coalesce(p_raw, '{}'::jsonb)), now(), v_order.payment_mode);
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;

  insert into public.payments (order_id, provider, provider_ref, amount_piastres,
      status, raw_payload, processed_at, mode)
  values (v_order.id, 'kashier', v_ref, v_order.total_piastres, p_status,
      coalesce(p_raw, '{}'::jsonb), now(), v_order.payment_mode);

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
    values (v_order.id, v_new_status, case when v_order.payment_mode = 'test' then 'payment_confirmed_test' else 'payment_confirmed' end);
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
revoke all on function public.fn_confirm_payment(text, text, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_confirm_payment(text, text, text, integer, jsonb, text) to service_role;

-- 4) packaging: mode check + no balance for a test 50% order
create or replace function public.fn_packaging_apply_payment(p_number text, p_provider text, p_ref text, p_status text, p_amount integer, p_raw jsonb, p_method text default 'card', p_mode text default null)
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
  if p_mode is not null and p_mode <> v_order.payment_mode then
    return jsonb_build_object('ok', false, 'reason', 'mode_mismatch');
  end if;
  if exists (select 1 from public.packaging_payments where provider = p_provider and provider_ref = p_ref) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if p_status not in ('succeeded', 'failed') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  v_due := public.fn_packaging_due_now(v_order);
  v_kind := case when v_order.payment_plan = 'split' then 'deposit' else 'full' end;

  if p_status = 'failed' then
    if v_due = 0 then return jsonb_build_object('ok', true, 'idempotent', true); end if;
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload, created_by, mode)
    values (v_order.id, v_kind, p_method, p_provider, p_ref, coalesce(p_amount, 0), 'failed', 'declined', coalesce(p_raw, '{}'::jsonb), auth.uid(), v_order.payment_mode);
    perform public.fn_packaging_event(v_order.id, null, 'payment_failed', null, jsonb_build_object('ref', p_ref));
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  -- a success for an order that no longer awaits payment = double charge → flag it
  if v_due = 0 then
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload, created_by, mode)
    values (v_order.id, 'overpayment', p_method, p_provider, p_ref, coalesce(p_amount, 0), 'succeeded', 'order_not_awaiting_payment', coalesce(p_raw, '{}'::jsonb), auth.uid(), v_order.payment_mode);
    perform public.fn_packaging_event(v_order.id, null, 'overpayment', 'Payment received for an order that was not awaiting payment', jsonb_build_object('ref', p_ref));
    return jsonb_build_object('ok', false, 'reason', 'not_awaiting_payment');
  end if;
  if p_amount is distinct from v_due then
    insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload, created_by, mode)
    values (v_order.id, v_kind, p_method, p_provider, p_ref, coalesce(p_amount, 0), 'failed', 'amount_mismatch', coalesce(p_raw, '{}'::jsonb) || jsonb_build_object('expected', v_due), auth.uid(), v_order.payment_mode);
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'expected', v_due);
  end if;

  insert into public.packaging_payments (order_id, kind, method, provider, provider_ref, amount_piastres, status, raw_payload, created_by, mode)
  values (v_order.id, v_kind, p_method, p_provider, p_ref, p_amount, 'succeeded', coalesce(p_raw, '{}'::jsonb), auth.uid(), v_order.payment_mode);
  update public.packaging_orders set status = 'confirmed', confirmed_at = now(), paid_piastres = paid_piastres + p_amount,
         payment_status = case when payment_plan = 'split' then 'deposit_paid' else 'paid' end, updated_at = now()
   where id = v_order.id;
  -- a test order never opens a balance that real earnings would pay off
  if v_order.payment_plan = 'split' and v_order.payment_mode = 'live' then
    insert into public.packaging_balances (vendor_id, order_id, amount_piastres, original_piastres)
    values (v_order.vendor_id, v_order.id, v_order.total_piastres - p_amount, v_order.total_piastres - p_amount)
    on conflict (order_id) do nothing;
  end if;
  perform public.fn_packaging_event(v_order.id, null, 'payment_succeeded', null,
    jsonb_build_object('ref', p_ref, 'amount_piastres', p_amount, 'kind', v_kind, 'mode', v_order.payment_mode));
  perform public.fn_audit('packaging.payment', 'packaging_orders', v_order.id::text, null,
    jsonb_build_object('ref', p_ref, 'amount_piastres', p_amount, 'kind', v_kind, 'provider', p_provider, 'mode', v_order.payment_mode));
  select owner_id into v_owner from public.vendors where id = v_order.vendor_id;
  perform public.fn_notify(v_owner, 'packaging_paid', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم تأكيد طلب التغليف ' || v_order.number, 'body',
          case when v_order.payment_mode = 'test' then 'دفعة تجريبية — لا توجد أموال حقيقية'
               when v_order.payment_plan = 'split' then 'تم دفع 50% — يُحصَّل الباقي مع أول طلب يتم تسليمه' else 'تم الدفع بالكامل' end),
    'en', jsonb_build_object('title', 'Packaging order ' || v_order.number || ' confirmed', 'body',
          case when v_order.payment_mode = 'test' then 'Test payment — no real money'
               when v_order.payment_plan = 'split' then '50% paid — the rest is collected with your next delivered order' else 'Paid in full' end),
    'link', '/vendor/packaging/orders/' || v_order.number));
  return jsonb_build_object('ok', true, 'status', 'succeeded');
end $$;
drop function if exists public.fn_packaging_apply_payment(text, text, text, text, integer, jsonb, text);

drop function if exists public.fn_confirm_packaging_payment(text, text, text, integer, jsonb);
create or replace function public.fn_confirm_packaging_payment(p_number text, p_provider_ref text, p_status text, p_amount_piastres integer, p_raw jsonb, p_mode text default 'live')
returns jsonb
language sql security definer set search_path = public as $$
  select public.fn_packaging_apply_payment(p_number, 'kashier', coalesce(nullif(trim(p_provider_ref), ''), 'missing'),
    p_status, p_amount_piastres, p_raw, 'card', coalesce(p_mode, 'live'));
$$;
revoke all on function public.fn_packaging_apply_payment(text, text, text, text, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.fn_packaging_apply_payment(text, text, text, text, integer, jsonb, text, text) to service_role;
revoke all on function public.fn_confirm_packaging_payment(text, text, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_confirm_packaging_payment(text, text, text, integer, jsonb, text) to service_role;

-- 5) payment settings: test mode + methods (keys stay in the server .env)
update public.settings
   set value = (value - 'kashier_key' - 'kashier_merchant')
               || jsonb_build_object('kashier_test_mode', coalesce(value->>'kashier_test_mode', 'off'),
                                     'kashier_methods', coalesce(value->'kashier_methods', '[]'::jsonb))
 where key = 'payments';
