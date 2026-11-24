-- ============================================================================
-- Returns & partial refunds — admin-initiated or customer-requested
--
-- One engine (fn_refund_apply) decides every return, whoever started it:
--  • per order line: qty ≤ purchased − already returned; amount computed on
--    the server from what the buyer actually paid for those units (line total
--    − its share of the coupon), capped by what is still refundable
--  • per vendor: the vendor's earning for those units is reversed
--    (refund_clawback). Not the vendor's fault → the platform gives its
--    commission share back too; vendor fault → the vendor bears the whole
--    refund (the extra = a penalty row) + the return pickup fee
--  • stock comes back when the goods are RECEIVED (restock flag per line)
--  • the buyer's money is executed separately (method + reference), then the
--    order's payment status becomes refunded / partially_refunded
-- Every step writes refund_events (history) + audit_logs. Locks + unique
-- ledger references make retries no-ops.
-- Also fixes the old decide function: it restocked the whole purchased qty
-- (not the returned qty) and booked every vendor-fault clawback on one vendor.
-- ============================================================================
begin;

alter table public.refund_requests
  add column if not exists source text not null default 'customer',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists logistics_status text not null default 'awaiting_return',
  add column if not exists received_at timestamptz,
  add column if not exists items_refund_piastres integer not null default 0,
  add column if not exists shipping_refund_piastres integer not null default 0,
  add column if not exists deduction_piastres integer not null default 0,
  add column if not exists refund_total_piastres integer not null default 0,
  add column if not exists refund_method text,
  add column if not exists refund_reference text,
  add column if not exists settled_at timestamptz;
alter table public.refund_requests drop constraint if exists refund_requests_source_check;
alter table public.refund_requests add constraint refund_requests_source_check check (source in ('customer', 'admin'));
alter table public.refund_requests drop constraint if exists refund_requests_logistics_check;
alter table public.refund_requests add constraint refund_requests_logistics_check
  check (logistics_status in ('awaiting_return', 'received', 'not_required'));
alter table public.refund_requests drop constraint if exists refund_requests_money_check;
alter table public.refund_requests add constraint refund_requests_money_check check (
  items_refund_piastres >= 0 and shipping_refund_piastres >= 0 and deduction_piastres >= 0 and refund_total_piastres >= 0);
alter table public.refund_requests drop constraint if exists refund_requests_method_check;
alter table public.refund_requests add constraint refund_requests_method_check
  check (refund_method is null or refund_method in ('original', 'bank_transfer', 'wallet', 'cash', 'other'));

alter table public.refund_request_items
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null,
  add column if not exists group_id uuid references public.order_vendor_groups(id) on delete set null,
  add column if not exists vendor_debit_piastres integer not null default 0,
  add column if not exists commission_share_piastres integer not null default 0,
  add column if not exists restocked_qty integer not null default 0;
create index if not exists refund_items_vendor_idx on public.refund_request_items (vendor_id);
-- a vendor-fault penalty is written once per (return, vendor)
create unique index if not exists vendor_penalties_refund_once on public.vendor_penalties (reference)
  where reference like 'penalty:%';

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (payment_status = any (array[
  'unpaid', 'paid', 'cod_pending', 'cod_collected', 'partially_refunded', 'refunded']));

-- vendor + shipment of every returned line, whoever created it
create or replace function public.fn_refund_item_fill()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select oi.vendor_id, oi.group_id into new.vendor_id, new.group_id
    from public.order_items oi where oi.id = new.order_item_id;
  return new;
end $$;
drop trigger if exists trg_refund_item_fill on public.refund_request_items;
create trigger trg_refund_item_fill before insert on public.refund_request_items
  for each row execute function public.fn_refund_item_fill();
update public.refund_request_items r set vendor_id = oi.vendor_id, group_id = oi.group_id
  from public.order_items oi where oi.id = r.order_item_id and r.vendor_id is null;

-- history ------------------------------------------------------------------------
create table if not exists public.refund_events (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  event text not null,
  note text,
  meta jsonb not null default '{}'::jsonb,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists refund_events_req_idx on public.refund_events (refund_request_id, created_at);
alter table public.refund_events enable row level security;
drop policy if exists refund_events_read on public.refund_events;
create policy refund_events_read on public.refund_events for select using (
  public.is_admin() or public.fn_refund_owned_by_me(refund_request_id) or public.fn_refund_visible_to_vendor(refund_request_id));
grant select on public.refund_events to authenticated;

create or replace function public.fn_refund_event(p_req uuid, p_event text, p_note text, p_meta jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.refund_events (refund_request_id, event, note, meta, actor)
  values (p_req, p_event, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_meta, '{}'::jsonb), auth.uid());
$$;

-- what is still returnable/refundable per order line (excludes rejected lines
-- and rejected/closed requests; p_exclude lets a decision ignore its own rows)
create or replace function public.fn_refund_line_state(p_item uuid, p_exclude uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_it public.order_items%rowtype;
  v_platform_coupon boolean;
  v_buyer_net integer; v_vendor_gross integer; v_comm integer;
  v_qty_used integer; v_amt_used integer;
begin
  select * into v_it from public.order_items where id = p_item;
  if not found then return null; end if;
  select exists (select 1 from public.orders o join public.coupons c on c.id = o.coupon_id
                  where o.id = v_it.order_id and c.type = 'commission_percent') into v_platform_coupon;
  v_buyer_net := v_it.line_total_piastres - v_it.coupon_discount_piastres;
  if v_platform_coupon then
    v_vendor_gross := v_it.line_total_piastres;
    v_comm := greatest(v_it.commission_piastres - v_it.coupon_discount_piastres, 0);
  else
    v_vendor_gross := v_it.line_total_piastres - v_it.coupon_discount_piastres;
    v_comm := v_it.commission_piastres;
  end if;
  select coalesce(sum(ri.qty), 0),
         coalesce(sum(case when ri.decision in ('approve', 'partial') then ri.refund_amount_piastres else 0 end), 0)
    into v_qty_used, v_amt_used
    from public.refund_request_items ri join public.refund_requests rr on rr.id = ri.refund_request_id
   where ri.order_item_id = p_item
     and rr.status not in ('rejected', 'closed')
     and coalesce(ri.decision, '') <> 'reject'
     and (p_exclude is null or rr.id <> p_exclude);
  return jsonb_build_object(
    'qty', v_it.qty, 'qty_returned', v_qty_used, 'qty_left', greatest(v_it.qty - v_qty_used, 0),
    'buyer_net', v_buyer_net, 'amount_refunded', v_amt_used, 'amount_left', greatest(v_buyer_net - v_amt_used, 0),
    'vendor_net', v_vendor_gross - v_comm, 'commission', v_comm,
    'vendor_id', v_it.vendor_id, 'group_id', v_it.group_id, 'variant_id', v_it.variant_id);
end $$;

-- the engine: apply decisions to a LOCKED pending request, settle the money
-- per vendor, history + audit. Internal (callers check admin + lock).
create or replace function public.fn_refund_apply(p_req uuid, p_items jsonb, p_options jsonb, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_row jsonb; v_ri public.refund_request_items%rowtype;
  v_state jsonb; v_dec text; v_fault text; v_amt integer; v_full integer; v_restock boolean;
  v_ratio numeric; v_normal integer; v_debit integer; v_comm_share integer;
  v_items_total integer := 0; v_approved int := 0;
  v_ship integer; v_ship_used integer; v_deduct integer; v_total integer;
  v_logistics text;
  v_vendor record; v_res jsonb; v_owner uuid;
  v_charge_return boolean;
begin
  select * into v_req from public.refund_requests where id = p_req;
  select * into v_order from public.orders where id = v_req.order_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_ri from public.refund_request_items
     where refund_request_id = p_req and order_item_id = (v_row->>'item_id')::uuid;
    if not found then raise exception 'bad_item' using errcode = 'P0001'; end if;
    v_dec := coalesce(v_row->>'decision', 'approve');
    v_fault := coalesce(nullif(v_row->>'fault', ''), 'customer');
    v_restock := coalesce((v_row->>'restock')::boolean, true);
    if v_dec not in ('approve', 'partial', 'reject') then raise exception 'bad_decision' using errcode = 'P0001'; end if;
    if v_fault not in ('vendor', 'shipping', 'customer', 'defect') then raise exception 'bad_fault' using errcode = 'P0001'; end if;
    v_state := public.fn_refund_line_state(v_ri.order_item_id, p_req);
    if v_dec <> 'reject' then
      if not exists (select 1 from public.order_vendor_groups g where g.id = v_ri.group_id and g.status = 'delivered') then
        raise exception 'group_not_delivered' using errcode = 'P0001';
      end if;
      if v_ri.qty > (v_state->>'qty_left')::int then raise exception 'qty_exceeded' using errcode = 'P0001'; end if;
      -- full value of these units; the last units take the exact remainder
      v_full := case when v_ri.qty = (v_state->>'qty_left')::int then (v_state->>'amount_left')::int
                     else least(round((v_state->>'buyer_net')::numeric * v_ri.qty / (v_state->>'qty')::int)::int,
                                (v_state->>'amount_left')::int) end;
      v_amt := coalesce(nullif(v_row->>'amount', '')::int, 0);
      v_amt := case when v_amt <= 0 then v_full else least(v_amt, v_full) end;
      if v_amt <= 0 then raise exception 'nothing_refundable' using errcode = 'P0001'; end if;
      if v_amt < v_full then v_dec := 'partial'; else v_dec := 'approve'; end if;
      -- vendor's share of this refund: its net for those units, scaled by
      -- how much of the units' value is refunded; vendor fault → whole refund
      v_ratio := case when (v_state->>'buyer_net')::int > 0 then v_amt::numeric / (v_state->>'buyer_net')::int else 0 end;
      v_normal := round((v_state->>'vendor_net')::int * v_ratio)::int;
      v_comm_share := round((v_state->>'commission')::int * v_ratio)::int;
      v_debit := case when v_fault = 'vendor' then greatest(v_amt, v_normal) else v_normal end;
      v_items_total := v_items_total + v_amt;
      v_approved := v_approved + 1;
    else
      v_amt := 0; v_debit := 0; v_comm_share := 0; v_normal := 0;
    end if;
    update public.refund_request_items set
      decision = v_dec, fault = v_fault, refund_amount_piastres = v_amt, restock = v_restock,
      vendor_debit_piastres = v_debit,
      commission_share_piastres = case when v_dec = 'reject' then 0 when v_fault = 'vendor' then 0 else v_comm_share end,
      decided_by = auth.uid(), decided_at = now()
     where id = v_ri.id;
  end loop;

  if exists (select 1 from public.refund_request_items where refund_request_id = p_req and decision is null) then
    raise exception 'undecided_items' using errcode = 'P0001';
  end if;

  -- request-level money: shipping refund (capped by what the order paid and
  -- earlier refunds took) and a return-shipping deduction (change of mind)
  v_ship := greatest(coalesce((p_options->>'shipping_refund_piastres')::int, 0), 0);
  select coalesce(sum(shipping_refund_piastres), 0) into v_ship_used
    from public.refund_requests where order_id = v_req.order_id and id <> p_req and status in ('approved', 'refunded');
  v_ship := least(v_ship, greatest(v_order.shipping_fee_piastres - v_ship_used, 0));
  if v_approved = 0 then v_ship := 0; end if;
  v_deduct := greatest(coalesce((p_options->>'deduction_piastres')::int, 0), 0);
  v_deduct := least(v_deduct, v_items_total + v_ship);
  v_total := v_items_total + v_ship - v_deduct;
  v_logistics := coalesce(nullif(p_options->>'logistics_status', ''), v_req.logistics_status);
  if v_logistics not in ('awaiting_return', 'received', 'not_required') then v_logistics := 'awaiting_return'; end if;

  update public.refund_requests set
    status = case when v_approved = 0 then 'rejected' else 'approved' end,
    decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note),
    decided_at = now(),
    items_refund_piastres = v_items_total, shipping_refund_piastres = v_ship,
    deduction_piastres = v_deduct, refund_total_piastres = v_total,
    logistics_status = case when v_approved = 0 then logistics_status
                            when v_logistics = 'received' then 'awaiting_return' else v_logistics end,
    settled_at = case when v_approved = 0 then null else now() end
   where id = p_req;

  -- money per vendor (only for approved lines)
  select coalesce((value->>'charge_vendor_fault_returns')::boolean, true) into v_charge_return
    from public.settings where key = 'pickup';
  for v_vendor in
    select ri.vendor_id,
           sum(ri.vendor_debit_piastres) as debit,
           sum(ri.refund_amount_piastres) as refunded,
           sum(case when ri.fault = 'vendor' then ri.qty else 0 end) as fault_units,
           sum(case when ri.fault = 'vendor' then ri.vendor_debit_piastres else 0 end) as fault_debit,
           sum(case when ri.fault = 'vendor' then
                 round((s.st->>'vendor_net')::int * ri.refund_amount_piastres::numeric / nullif((s.st->>'buyer_net')::int, 0))
               else 0 end)::int as fault_normal,
           min(ri.group_id::text)::uuid as group_id
      from public.refund_request_items ri
      cross join lateral (select public.fn_refund_line_state(ri.order_item_id, p_req) as st) s
     where ri.refund_request_id = p_req and ri.decision in ('approve', 'partial')
     group by ri.vendor_id
  loop
    perform public.fn_post_transaction(v_vendor.vendor_id, 'refund_clawback', -v_vendor.debit,
      'refund:' || p_req::text || ':' || v_vendor.vendor_id::text,
      'Return/refund on order ' || v_order.number || ' — earnings reversed for returned products',
      v_order.id, null,
      jsonb_build_object('refund_request_id', p_req, 'order_number', v_order.number,
                         'refunded_to_buyer_piastres', v_vendor.refunded, 'vendor_fault_units', v_vendor.fault_units));
    if v_vendor.fault_units > 0 and v_vendor.fault_debit - v_vendor.fault_normal > 0 then
      insert into public.vendor_penalties (vendor_id, source, rule_key, amount_piastres, reason, reference)
      values (v_vendor.vendor_id, 'rule', 'refund_fault', v_vendor.fault_debit - v_vendor.fault_normal,
              'Vendor-fault return on order ' || v_order.number || ' — commission share borne by the vendor',
              'penalty:' || p_req::text || ':' || v_vendor.vendor_id::text)
      on conflict do nothing;
    end if;
    if v_vendor.fault_units > 0 and coalesce(v_charge_return, true) and v_logistics <> 'not_required' then
      perform public.fn_charge_pickup('return', v_vendor.vendor_id, v_order.id, null, p_req, v_vendor.fault_units::int);
    end if;
    select owner_id into v_owner from public.vendors where id = v_vendor.vendor_id;
    perform public.fn_notify(v_owner, 'refund_settled_vendor', jsonb_build_object(
      'ar', jsonb_build_object('title', 'مرتجع على طلب ' || v_order.number, 'body', 'تم خصم قيمة المنتجات المرتجعة من محفظتك'),
      'en', jsonb_build_object('title', 'Return on order ' || v_order.number, 'body', 'The returned products were deducted from your wallet'),
      'link', '/vendor/wallet'));
  end loop;

  perform public.fn_refund_event(p_req, case when v_approved = 0 then 'rejected' else 'approved' end, p_note,
    jsonb_build_object('items_piastres', v_items_total, 'shipping_piastres', v_ship,
                       'deduction_piastres', v_deduct, 'total_piastres', v_total, 'items', p_items));
  perform public.fn_audit('refund.decided', 'refund_requests', p_req::text,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', case when v_approved = 0 then 'rejected' else 'approved' end,
                       'total_piastres', v_total, 'items', p_items, 'options', p_options));
  perform public.fn_notify(v_order.user_id, 'refund_decided', jsonb_build_object(
    'ar', jsonb_build_object('title', case when v_approved = 0 then 'تم رفض طلب الإرجاع' else 'تمت الموافقة على الإرجاع' end,
                             'body', 'الطلب ' || v_order.number),
    'en', jsonb_build_object('title', case when v_approved = 0 then 'Return request declined' else 'Return approved' end,
                             'body', 'Order ' || v_order.number),
    'link', '/account/returns'));

  if v_approved > 0 and v_logistics = 'received' then
    perform public.fn_refund_receive(p_req, 'Received at creation');
  end if;
  return jsonb_build_object('ok', true, 'status', case when v_approved = 0 then 'rejected' else 'approved' end,
    'items_piastres', v_items_total, 'shipping_piastres', v_ship, 'deduction_piastres', v_deduct, 'total_piastres', v_total);
end $$;

-- goods are back: restock what was flagged (exactly the returned qty, once)
create or replace function public.fn_refund_receive(p_req uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in select ri.id, ri.qty, ri.restocked_qty, oi.variant_id
             from public.refund_request_items ri join public.order_items oi on oi.id = ri.order_item_id
            where ri.refund_request_id = p_req and ri.decision in ('approve', 'partial') and ri.restock
              and ri.restocked_qty < ri.qty
            for update of ri
  loop
    update public.variants set stock = stock + (r.qty - r.restocked_qty), updated_at = now() where id = r.variant_id;
    update public.refund_request_items set restocked_qty = r.qty where id = r.id;
    v_n := v_n + (r.qty - r.restocked_qty);
  end loop;
  update public.refund_requests set logistics_status = 'received', received_at = coalesce(received_at, now())
   where id = p_req;
  perform public.fn_refund_event(p_req, 'received', p_note, jsonb_build_object('restocked_units', v_n));
  return jsonb_build_object('ok', true, 'restocked_units', v_n);
end $$;

-- (re)decide a customer request — same signature + optional request options
drop function if exists public.fn_admin_decide_refund(uuid, jsonb, text);
create or replace function public.fn_admin_decide_refund(p_request_id uuid, p_items jsonb, p_note text default null,
  p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_req public.refund_requests%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status <> 'pending_admin' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  return public.fn_refund_apply(p_request_id, p_items, p_options, p_note);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;

-- admin starts a return from the order page: pick lines + qty, decided at once
create or replace function public.fn_admin_create_return(p_order_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_req uuid;
  v_row jsonb; v_state jsonb; v_qty int; v_reason text; v_kind text;
  v_items jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_items');
  end if;
  v_kind := case when p_payload->>'kind' = 'warranty' then 'warranty' else 'return' end;

  insert into public.refund_requests (order_id, user_id, kind, description, evidence, status, source, created_by)
  values (p_order_id, v_order.user_id, v_kind, left(coalesce(p_payload->>'note', ''), 2000), '[]'::jsonb,
          'pending_admin', 'admin', auth.uid())
  returning id into v_req;

  for v_row in select * from jsonb_array_elements(p_payload->'items') loop
    v_qty := coalesce((v_row->>'qty')::int, 0);
    v_state := public.fn_refund_line_state((v_row->>'order_item_id')::uuid, v_req);
    if v_state is null or not exists (select 1 from public.order_items
                                       where id = (v_row->>'order_item_id')::uuid and order_id = p_order_id) then
      raise exception 'item_not_in_order' using errcode = 'P0001';
    end if;
    if v_qty <= 0 or v_qty > (v_state->>'qty_left')::int then
      raise exception 'qty_exceeded' using errcode = 'P0001';
    end if;
    v_reason := coalesce(nullif(v_row->>'reason', ''), 'change_of_mind');
    if v_reason not in ('defect', 'wrong_item', 'damaged', 'not_received', 'change_of_mind') then
      raise exception 'bad_reason' using errcode = 'P0001';
    end if;
    insert into public.refund_request_items (refund_request_id, order_item_id, qty, reason)
    values (v_req, (v_row->>'order_item_id')::uuid, v_qty, v_reason);
    v_items := v_items || jsonb_build_object('item_id', v_row->>'order_item_id', 'decision', 'approve',
      'fault', coalesce(nullif(v_row->>'fault', ''), case v_reason when 'change_of_mind' then 'customer'
                                                                 when 'defect' then 'defect' else 'vendor' end),
      'amount', v_row->'amount', 'restock', coalesce((v_row->>'restock')::boolean, true));
  end loop;

  perform public.fn_refund_event(v_req, 'created', p_payload->>'note', jsonb_build_object('source', 'admin'));
  insert into public.order_status_history (order_id, status, note, actor)
  values (p_order_id, v_order.status, 'return_created_by_admin', auth.uid());
  v_res := public.fn_refund_apply(v_req, v_items,
    jsonb_build_object('shipping_refund_piastres', p_payload->'shipping_refund_piastres',
                       'deduction_piastres', p_payload->'deduction_piastres',
                       'logistics_status', p_payload->>'logistics_status'),
    p_payload->>'note');
  return v_res || jsonb_build_object('refund_request_id', v_req);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'duplicate_item');
end $$;

create or replace function public.fn_admin_return_received(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_req public.refund_requests%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status not in ('approved', 'refunded') then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if v_req.logistics_status = 'received' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  perform public.fn_audit('refund.received', 'refund_requests', p_request_id::text,
    jsonb_build_object('logistics', v_req.logistics_status), jsonb_build_object('logistics', 'received'));
  return public.fn_refund_receive(p_request_id, p_note);
end $$;

-- pay the buyer back (once): method + reference, then the order's payment status
drop function if exists public.fn_admin_execute_refund(uuid, text);
create or replace function public.fn_admin_execute_refund(p_request_id uuid, p_note text default null,
  p_method text default 'original', p_reference text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_refunded bigint;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status = 'refunded' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_req.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if v_req.logistics_status = 'awaiting_return' then
    return jsonb_build_object('ok', false, 'reason', 'awaiting_return');
  end if;
  if coalesce(p_method, '') not in ('original', 'bank_transfer', 'wallet', 'cash', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'bad_method');
  end if;
  update public.refund_requests set status = 'refunded', executed_at = now(), executed_by = auth.uid(),
         execution_note = nullif(trim(coalesce(p_note, '')), ''),
         refund_method = p_method, refund_reference = nullif(trim(coalesce(p_reference, '')), '')
   where id = p_request_id;
  select * into v_order from public.orders where id = v_req.order_id for update;
  select coalesce(sum(refund_total_piastres), 0) into v_refunded
    from public.refund_requests where order_id = v_order.id and status = 'refunded';
  update public.orders set payment_status = case when v_refunded >= v_order.total_piastres then 'refunded'
                                                 else 'partially_refunded' end, updated_at = now()
   where id = v_order.id and v_refunded > 0;
  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order.id, v_order.status, 'refund_executed', auth.uid());
  perform public.fn_refund_event(p_request_id, 'refunded', p_note,
    jsonb_build_object('method', p_method, 'reference', p_reference, 'amount_piastres', v_req.refund_total_piastres));
  perform public.fn_audit('refund.executed', 'refund_requests', p_request_id::text,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'refunded', 'method', p_method, 'reference', p_reference,
                       'amount_piastres', v_req.refund_total_piastres));
  perform public.fn_notify(v_order.user_id, 'refund_executed', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم رد المبلغ', 'body', 'تم رد ' || round(v_req.refund_total_piastres / 100.0, 2) || ' ج.م — الطلب ' || v_order.number),
    'en', jsonb_build_object('title', 'Refund issued', 'body', 'EGP ' || round(v_req.refund_total_piastres / 100.0, 2) || ' refunded — order ' || v_order.number),
    'link', '/account/returns'));
  return jsonb_build_object('ok', true);
end $$;

-- the order page's return panel: what each line can still return / refund
create or replace function public.fn_admin_order_refundables(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return null; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.fn_refund_line_state(i.id) || jsonb_build_object(
                'order_item_id', i.id,
                'group_status', (select g.status from public.order_vendor_groups g where g.id = i.group_id)))
              from public.order_items i where i.order_id = p_order_id), '[]'::jsonb),
    'shipping_fee', (select shipping_fee_piastres from public.orders where id = p_order_id),
    'shipping_refunded', (select coalesce(sum(shipping_refund_piastres), 0) from public.refund_requests
                           where order_id = p_order_id and status in ('approved', 'refunded')));
end $$;

revoke all on function public.fn_refund_apply(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.fn_refund_receive(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_refund_event(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fn_refund_line_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_refund_item_fill() from public, anon, authenticated;
grant execute on function public.fn_admin_decide_refund(uuid, jsonb, text, jsonb) to authenticated;
grant execute on function public.fn_admin_create_return(uuid, jsonb) to authenticated;
grant execute on function public.fn_admin_return_received(uuid, text) to authenticated;
grant execute on function public.fn_admin_execute_refund(uuid, text, text, text) to authenticated;
grant execute on function public.fn_admin_order_refundables(uuid) to authenticated;
revoke all on function public.fn_admin_decide_refund(uuid, jsonb, text, jsonb) from anon;
revoke all on function public.fn_admin_create_return(uuid, jsonb) from anon;
revoke all on function public.fn_admin_return_received(uuid, text) from anon;
revoke all on function public.fn_admin_execute_refund(uuid, text, text, text) from anon;
revoke all on function public.fn_admin_order_refundables(uuid) from anon;

commit;
