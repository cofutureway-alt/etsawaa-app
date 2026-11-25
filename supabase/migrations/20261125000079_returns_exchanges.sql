-- ============================================================================
-- Returns and exchanges (Phase B, owner-approved 2026-11-25)
--
-- The customer asks for one of three resolutions when returning products:
--   refund         — money back (as before)
--   same_product   — a new unit of the same product (another size/colour allowed)
--   other_products — one or more other products from the site
--
-- The admin decides with the existing engine (fn_refund_apply: caps, seller
-- clawbacks, penalties, return pickup fees). For an exchange, approval then:
--   1. credits the value of the approved return to the customer's wallet
--      (exchange_credit, refund bucket);
--   2. creates the replacement order through fn_create_order itself (same
--      pricing, stock, groups, commissions, notifications) at today's site
--      price, no coupon, paid from that credit; the exchange shipping is the
--      customer's when the reason is theirs (change of mind), else free;
--   3. what the credit does not cover is the difference the customer pays on
--      the new order (card or cash on delivery, per the returns settings);
--      what is left over goes where the admin chose: kept in the wallet, or
--      refunded the normal way (taken back out of the wallet and executed
--      later with a method and reference).
--
-- Also fixes fn_request_refund: it inserted the request before validating
-- the items, so a failing item left a partial request saved.
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 1) SCHEMA
-- ----------------------------------------------------------------------------
alter table public.refund_requests
  add column if not exists resolution text not null default 'refund',
  add column if not exists exchange_order_id uuid references public.orders(id) on delete set null,
  add column if not exists credit_destination text,
  add column if not exists exchange_applied_piastres integer not null default 0,
  add column if not exists exchange_wallet_piastres integer not null default 0;
alter table public.refund_requests drop constraint if exists refund_requests_resolution_check;
alter table public.refund_requests add constraint refund_requests_resolution_check
  check (resolution in ('refund', 'same_product', 'other_products'));
alter table public.refund_requests drop constraint if exists refund_requests_credit_destination_check;
alter table public.refund_requests add constraint refund_requests_credit_destination_check
  check (credit_destination is null or credit_destination in ('wallet', 'original'));
alter table public.refund_requests drop constraint if exists refund_requests_exchange_money_check;
alter table public.refund_requests add constraint refund_requests_exchange_money_check
  check (exchange_applied_piastres >= 0 and exchange_wallet_piastres >= 0);
alter table public.refund_requests drop constraint if exists refund_requests_method_check;
alter table public.refund_requests add constraint refund_requests_method_check
  check (refund_method is null or refund_method in
    ('original', 'bank_transfer', 'wallet', 'cash', 'other', 'store_wallet', 'exchange'));

alter table public.orders
  add column if not exists exchange_request_id uuid references public.refund_requests(id) on delete set null;
-- ledger rows written in one transaction keep their real order
alter table public.customer_wallet_transactions alter column created_at set default clock_timestamp();

create index if not exists orders_exchange_request_idx on public.orders (exchange_request_id)
  where exchange_request_id is not null;

create table if not exists public.refund_replacements (
  id                uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id) on delete cascade,
  variant_id        uuid not null references public.variants(id),
  product_id        uuid not null references public.products(id),
  qty               integer not null check (qty > 0 and qty <= 20),
  created_at        timestamptz not null default now(),
  unique (refund_request_id, variant_id)
);
create index if not exists refund_replacements_req_idx on public.refund_replacements (refund_request_id);
alter table public.refund_replacements enable row level security;
drop policy if exists refund_replacements_read on public.refund_replacements;
create policy refund_replacements_read on public.refund_replacements for select to authenticated
  using (public.has_permission('refunds.view') or public.has_permission('orders.view')
         or exists (select 1 from public.refund_requests r
                     where r.id = refund_request_id and r.user_id = auth.uid()));
revoke all on public.refund_replacements from anon, public;
grant select on public.refund_replacements to authenticated;

-- returns settings: is exchange on, and how the difference may be paid
insert into public.settings (key, value)
values ('returns', jsonb_build_object('exchange_enabled', true, 'exchange_pay_methods', jsonb_build_array('kashier', 'cod')))
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2) PRICE OF ONE UNIT TODAY — the same rule fn_create_order charges
--    (variant sale inside its window, then the active event discount)
-- ----------------------------------------------------------------------------
create or replace function public.fn_variant_unit_price(p_variant uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare r record; v_unit integer; v_pct integer; v_cap integer;
begin
  select v.price_piastres, v.sale_price_piastres, v.product_id,
         coalesce(v.sale_starts_at, p.sale_starts_at) as sale_starts_at,
         coalesce(v.sale_ends_at, p.sale_ends_at) as sale_ends_at,
         p.vendor_id, p.leaf_category_id
    into r
    from public.variants v join public.products p on p.id = v.product_id
   where v.id = p_variant;
  if not found or r.price_piastres is null then return null; end if;
  v_unit := r.price_piastres;
  if r.sale_price_piastres is not null and r.sale_starts_at is not null and r.sale_starts_at <= now()
     and (r.sale_ends_at is null or r.sale_ends_at > now()) then
    v_unit := least(r.price_piastres, r.sale_price_piastres);
  end if;
  select d.percent, d.max_discount_piastres into v_pct, v_cap
    from public.v_active_event_vendors aev
    join public.event_discounts d on d.event_id = aev.event_id
   where aev.vendor_id = r.vendor_id and aev.status = 'accepted'
     and ((d.scope = 'product' and d.ref_id = r.product_id)
       or (d.scope = 'category' and public.fn_category_within(r.leaf_category_id, d.ref_id)))
   order by (d.scope = 'product') desc, d.percent desc
   limit 1;
  if found and v_pct > 0 then
    v_unit := v_unit - least(trunc(v_unit * v_pct / 100), coalesce(v_cap, v_unit));
  end if;
  return v_unit;
end $$;

-- can this variant be sold right now (same checks as checkout)?
create or replace function public.fn_variant_sellable(p_variant uuid, p_qty integer)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.variants v join public.products p on p.id = v.product_id
     where v.id = p_variant and v.is_active and v.deleted_at is null and v.price_piastres is not null
       and p.deleted_at is null and p.status = 'approved' and not coalesce(p.event_hidden, false)
       and public.vendor_can_sell(p.vendor_id)
       and not public.fn_packaging_order_cap_reached(p.vendor_id)
       and not exists (select 1 from public.v_active_event_vendors aev
                        where aev.vendor_id = p.vendor_id and aev.status = 'refused')
       and v.stock >= greatest(coalesce(p_qty, 1), 1));
$$;

-- ----------------------------------------------------------------------------
-- 3) WHAT THE CUSTOMER CAN PICK AS A REPLACEMENT
--    p_product_ids: the returned products (same product, another option)
--    p_query: a name search for other products
-- ----------------------------------------------------------------------------
create or replace function public.fn_exchange_options(p_query text default null, p_product_ids uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  if v_q is null and coalesce(array_length(p_product_ids, 1), 0) = 0 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x.ord, x.name_ar)
      from (
        select sp.id, sp.name_ar, sp.name_en, sp.main_image_path, sp.store_name_ar, sp.store_name_en,
               case when sp.id = any(coalesce(p_product_ids, '{}'::uuid[])) then 0 else 1 end as ord,
               (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', v.id, 'label_ar', public.fn_option_key_label(v.option_key, 'ar'),
                    'label_en', public.fn_option_key_label(v.option_key, 'en'),
                    'unit_piastres', public.fn_variant_unit_price(v.id),
                    'stock', v.stock, 'image_path', v.image_path) order by v.option_key), '[]'::jsonb)
                  from public.variants v
                 where v.product_id = sp.id and public.fn_variant_sellable(v.id, 1)) as variants
          from public.v_storefront_products sp
         where sp.is_listable
           and ((p_product_ids is not null and sp.id = any(p_product_ids))
             or (v_q is not null and (sp.name_ar ilike '%' || v_q || '%' or sp.name_en ilike '%' || v_q || '%')))
         limit 12) x
     where jsonb_array_length(x.variants) > 0), '[]'::jsonb);
end $$;
revoke all on function public.fn_exchange_options(text, uuid[]) from public, anon;
grant execute on function public.fn_exchange_options(text, uuid[]) to authenticated;
revoke all on function public.fn_variant_unit_price(uuid) from public, anon;
grant execute on function public.fn_variant_unit_price(uuid) to authenticated;
revoke all on function public.fn_variant_sellable(uuid, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) FN_REQUEST_REFUND — validates everything first, then saves; takes the
--    resolution and the replacement products
-- ----------------------------------------------------------------------------
drop function if exists public.fn_request_refund(uuid, text, jsonb, text, jsonb);
create or replace function public.fn_request_refund(p_order_id uuid, p_kind text, p_items jsonb,
  p_description text, p_evidence jsonb, p_resolution text default 'refund', p_replacements jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order orders%rowtype;
  v_request_id uuid;
  v_item jsonb;
  v_oi record;
  v_already integer;
  v_qty integer;
  v_reason text;
  v_window_days integer;
  v_resolution text := coalesce(nullif(p_resolution, ''), 'refund');
  v_products uuid[] := '{}'::uuid[];
  v_rep jsonb;
  v_var record;
  v_settings jsonb;
  v_seen uuid[] := '{}'::uuid[];
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
  if v_resolution not in ('refund', 'same_product', 'other_products') then
    return jsonb_build_object('ok', false, 'reason', 'bad_resolution');
  end if;

  -- 1) every returned line, before anything is saved
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'qty')::integer, 0);
    v_reason := coalesce(nullif(v_item->>'reason', ''), 'defect');
    select * into v_oi from public.order_items oi
      where oi.id = (v_item->>'order_item_id')::uuid and oi.order_id = p_order_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'item_not_in_order');
    end if;
    if v_qty <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'qty_exceeded', 'order_item_id', v_oi.id, 'remaining', 0);
    end if;
    if v_reason not in ('defect', 'wrong_item', 'damaged', 'not_received', 'change_of_mind') then
      return jsonb_build_object('ok', false, 'reason', 'bad_reason');
    end if;
    -- requested across open requests never exceeds the purchased qty
    -- (a rejected or closed request frees its units again)
    select coalesce(sum(rri.qty), 0) into v_already
      from public.refund_request_items rri join public.refund_requests rr on rr.id = rri.refund_request_id
      where rri.order_item_id = v_oi.id and rr.status not in ('rejected', 'closed')
        and coalesce(rri.decision, '') <> 'reject';
    if v_already + v_qty > v_oi.qty then
      return jsonb_build_object('ok', false, 'reason', 'qty_exceeded',
        'order_item_id', v_oi.id, 'remaining', greatest(v_oi.qty - v_already, 0));
    end if;
    v_products := v_products || v_oi.product_id;
  end loop;

  -- 2) the replacement products (exchange only)
  if v_resolution <> 'refund' then
    select value into v_settings from public.settings where key = 'returns';
    if coalesce((v_settings->>'exchange_enabled')::boolean, true) = false then
      return jsonb_build_object('ok', false, 'reason', 'exchange_disabled');
    end if;
    if jsonb_array_length(coalesce(p_replacements, '[]'::jsonb)) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_replacements');
    end if;
    if jsonb_array_length(p_replacements) > 10 then
      return jsonb_build_object('ok', false, 'reason', 'too_many_replacements');
    end if;
    for v_rep in select * from jsonb_array_elements(p_replacements) loop
      v_qty := coalesce((v_rep->>'qty')::integer, 0);
      if v_qty <= 0 or v_qty > 20 then
        return jsonb_build_object('ok', false, 'reason', 'bad_replacement_qty');
      end if;
      select v.id, v.product_id into v_var from public.variants v
       where v.id = nullif(v_rep->>'variant_id', '')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'replacement_unavailable');
      end if;
      if v_var.id = any(v_seen) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_replacement');
      end if;
      v_seen := v_seen || v_var.id;
      if v_resolution = 'same_product' and not (v_var.product_id = any(v_products)) then
        return jsonb_build_object('ok', false, 'reason', 'not_same_product');
      end if;
      if not public.fn_variant_sellable(v_var.id, v_qty)
         or not exists (select 1 from public.v_storefront_products sp where sp.id = v_var.product_id and sp.is_listable) then
        return jsonb_build_object('ok', false, 'reason', 'replacement_unavailable', 'variant_id', v_var.id);
      end if;
    end loop;
  end if;

  -- 3) save
  insert into public.refund_requests (order_id, user_id, kind, description, evidence, status, resolution)
  values (p_order_id, v_uid, p_kind, left(coalesce(p_description, ''), 2000),
      coalesce(p_evidence, '[]'::jsonb), 'pending_admin', v_resolution)
  returning id into v_request_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.refund_request_items (refund_request_id, order_item_id, qty, reason)
    values (v_request_id, (v_item->>'order_item_id')::uuid, (v_item->>'qty')::integer,
            coalesce(nullif(v_item->>'reason', ''), 'defect'));
  end loop;
  if v_resolution <> 'refund' then
    for v_rep in select * from jsonb_array_elements(p_replacements) loop
      insert into public.refund_replacements (refund_request_id, variant_id, product_id, qty)
      select v_request_id, v.id, v.product_id, (v_rep->>'qty')::integer
        from public.variants v where v.id = (v_rep->>'variant_id')::uuid;
    end loop;
  end if;

  insert into public.order_status_history (order_id, status, note)
  values (p_order_id, v_order.status, case when v_resolution = 'refund' then 'refund_requested' else 'exchange_requested' end);
  perform public.fn_refund_event(v_request_id, 'created', null,
    jsonb_build_object('source', 'customer', 'resolution', v_resolution));

  -- notify the customer + everyone who handles refunds
  perform public.fn_notify(v_uid, 'refund_submitted', jsonb_build_object(
    'ar', jsonb_build_object('title', case when v_resolution = 'refund' then 'تم استلام طلب الاسترجاع' else 'تم استلام طلب الاستبدال' end,
                             'body', 'ستراجع الإدارة طلبك قريبًا'),
    'en', jsonb_build_object('title', case when v_resolution = 'refund' then 'Refund request received' else 'Exchange request received' end,
                             'body', 'Your request is now under review'),
    'link', '/account/returns'));
  perform public.fn_notify(a.actor_id, 'refund_submitted_admin', jsonb_build_object(
    'ar', jsonb_build_object('title', case when v_resolution = 'refund' then 'طلب استرجاع جديد' else 'طلب استبدال جديد' end,
                             'body', 'الطلب ' || v_order.number),
    'en', jsonb_build_object('title', case when v_resolution = 'refund' then 'New refund request' else 'New exchange request' end,
                             'body', 'Order ' || v_order.number),
    'link', '/admin/refunds'))
    from (select id as actor_id from public.profiles where role = 'admin') a;

  return jsonb_build_object('ok', true, 'refund_request_id', v_request_id);
end $$;
revoke all on function public.fn_request_refund(uuid, text, jsonb, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.fn_request_refund(uuid, text, jsonb, text, jsonb, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) FN_REFUND_MAKE_EXCHANGE — after the decision approved the return:
--    credit → replacement order (through fn_create_order) → leftover.
--    Internal: called by fn_admin_decide_refund inside its transaction.
--    Raises P0001 with a reason so the whole decision rolls back.
-- ----------------------------------------------------------------------------
create or replace function public.fn_refund_make_exchange(p_req uuid, p_destination text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_new public.orders%rowtype;
  v_credit integer;
  v_customer_fault boolean;
  v_settings jsonb;
  v_methods jsonb;
  v_method text;
  v_cart jsonb;
  v_claims text;
  v_claim_sub text;
  v_res jsonb;
  v_applied integer;
  v_left integer;
  v_kept integer := 0;
  v_due integer;
begin
  select * into v_req from public.refund_requests where id = p_req for update;
  if v_req.resolution = 'refund' or v_req.status <> 'approved' then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if v_req.exchange_order_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'order_id', v_req.exchange_order_id);
  end if;
  if coalesce(p_destination, '') not in ('wallet', 'original') then
    raise exception 'destination_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.refund_replacements where refund_request_id = p_req) then
    raise exception 'no_replacements' using errcode = 'P0001';
  end if;
  select * into v_order from public.orders where id = v_req.order_id;
  v_credit := v_req.refund_total_piastres;

  -- exchange shipping: the customer's when an approved line is their fault
  select exists (select 1 from public.refund_request_items
                  where refund_request_id = p_req and decision in ('approve', 'partial')
                    and fault = 'customer') into v_customer_fault;

  -- method for the remainder (if any): the first one the settings allow
  select value into v_settings from public.settings where key = 'returns';
  v_methods := coalesce(v_settings->'exchange_pay_methods', '["kashier","cod"]'::jsonb);
  v_method := case when v_methods ? 'kashier' then 'kashier' when v_methods ? 'cod' then 'cod' else 'kashier' end;

  -- 1) the credit lands in the wallet (refund bucket)
  if v_credit > 0 then
    v_res := public.fn_wallet_post(v_req.user_id, 'refund', 'exchange_credit', v_credit,
      'exchange:' || p_req::text, 'exchange', v_req.order_id, p_req, null,
      jsonb_build_object('order_number', v_order.number));
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'wallet_failed' using errcode = 'P0001';
    end if;
  end if;

  -- 2) the replacement order, through the checkout engine, as the customer:
  --    park their cart, put the replacements in it, act as them, restore all
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cart
    from public.cart_items c where c.user_id = v_req.user_id;
  delete from public.cart_items where user_id = v_req.user_id;
  insert into public.cart_items (user_id, variant_id, product_id, qty)
  select v_req.user_id, r.variant_id, r.product_id, r.qty
    from public.refund_replacements r where r.refund_request_id = p_req;

  v_claims := current_setting('request.jwt.claims', true);
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_req.user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_req.user_id::text, true);
  perform set_config('etsawaa.exchange_request', p_req::text, true);
  perform set_config('etsawaa.exchange_free_shipping', case when v_customer_fault then 'off' else 'on' end, true);

  v_res := public.fn_create_order(jsonb_build_object(
    'attempt_key', p_req,
    'payment_method', v_method,
    'wallet_piastres', v_credit,
    'address', jsonb_build_object(
      'full_name', v_order.ship_name, 'phone_primary', v_order.phone_primary,
      'phone_alternate', v_order.phone_alternate, 'governorate_id', v_order.governorate_id,
      'area_id', v_order.area_id, 'address1', v_order.address1, 'address2', v_order.address2,
      'postal_code', v_order.postal_code,
      'lat', v_order.shipping_lat, 'lng', v_order.shipping_lng, 'geo_accuracy', v_order.shipping_geo_accuracy_m)));

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('etsawaa.exchange_request', '', true);
  perform set_config('etsawaa.exchange_free_shipping', '', true);

  delete from public.cart_items where user_id = v_req.user_id;
  insert into public.cart_items (user_id, variant_id, product_id, qty, created_at, updated_at)
  select (e->>'user_id')::uuid, (e->>'variant_id')::uuid, (e->>'product_id')::uuid, (e->>'qty')::int,
         (e->>'created_at')::timestamptz, (e->>'updated_at')::timestamptz
    from jsonb_array_elements(v_cart) e
  on conflict (user_id, variant_id) do nothing;

  if not coalesce((v_res->>'ok')::boolean, false) then
    raise exception '%', 'exchange_' || coalesce(v_res->>'reason', 'failed')
      || coalesce(':' || (v_res->>'names'), '') || coalesce(' — ' || (v_res->>'detail'), '') using errcode = 'P0001';
  end if;

  select * into v_new from public.orders where id = (v_res->>'order_id')::uuid;
  update public.orders set exchange_request_id = p_req, updated_at = now() where id = v_new.id;

  -- 3) the leftover: kept in the wallet, or taken back out to be refunded
  --    the normal way by the admin (execute step)
  v_applied := coalesce(v_new.wallet_paid_piastres, 0);
  v_left := greatest(v_credit - v_applied, 0);
  if v_left > 0 and p_destination = 'original' then
    v_res := public.fn_wallet_post(v_req.user_id, 'refund', 'exchange_credit', -v_left,
      'exchange-leftover:' || p_req::text, 'leftover refunded the normal way', v_req.order_id, p_req, null, '{}'::jsonb);
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'wallet_failed' using errcode = 'P0001';
    end if;
  elsif v_left > 0 then
    v_kept := v_left;
  end if;
  v_due := v_credit - v_applied - v_kept;   -- still to refund by a method

  update public.refund_requests set
    exchange_order_id = v_new.id, credit_destination = p_destination,
    exchange_applied_piastres = v_applied, exchange_wallet_piastres = v_kept
   where id = p_req;

  perform public.fn_refund_event(p_req, 'exchange_order', null, jsonb_build_object(
    'order_number', v_new.number, 'credit_piastres', v_credit, 'applied_piastres', v_applied,
    'kept_in_wallet_piastres', v_kept, 'to_refund_piastres', v_due,
    'difference_piastres', v_new.total_piastres - v_applied));

  -- nothing left to pay out and nothing awaits: the request is settled
  if v_due <= 0 and v_req.logistics_status <> 'awaiting_return' then
    perform public.fn_refund_close_exchange(p_req);
  end if;

  perform public.fn_notify(v_req.user_id, 'exchange_approved', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تمت الموافقة على الاستبدال',
      'body', case when v_new.total_piastres - v_applied > 0
                then 'الطلب الجديد ' || v_new.number || ' — المطلوب دفعه ' || round((v_new.total_piastres - v_applied) / 100.0, 2) || ' ج.م'
                else 'الطلب الجديد ' || v_new.number end),
    'en', jsonb_build_object('title', 'Exchange approved',
      'body', case when v_new.total_piastres - v_applied > 0
                then 'New order ' || v_new.number || ' — EGP ' || round((v_new.total_piastres - v_applied) / 100.0, 2) || ' to pay'
                else 'New order ' || v_new.number end),
    'link', '/order/' || v_new.number));

  return jsonb_build_object('ok', true, 'order_id', v_new.id, 'number', v_new.number,
    'credit_piastres', v_credit, 'applied_piastres', v_applied, 'kept_piastres', v_kept,
    'due_piastres', v_due, 'difference_piastres', v_new.total_piastres - v_applied);
end $$;

-- an exchange with nothing left to pay out is marked done (method 'exchange')
create or replace function public.fn_refund_close_exchange(p_req uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.refund_requests set status = 'refunded', executed_at = now(), executed_by = auth.uid(),
         refund_method = 'exchange', execution_note = coalesce(execution_note, 'settled by exchange')
   where id = p_req and status = 'approved';
  if found then
    perform public.fn_refund_event(p_req, 'refunded', null, jsonb_build_object('method', 'exchange'));
  end if;
end $$;

revoke all on function public.fn_refund_make_exchange(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_refund_close_exchange(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) DECIDE — the live wrapper + the exchange step. p_options:
--      resolution: 'refund' turns an exchange request into a plain refund
--      credit_destination: 'wallet' | 'original' (exchange leftover)
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_decide_refund(p_request_id uuid, p_items jsonb, p_note text default null::text,
  p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_req public.refund_requests%rowtype; v_res jsonb; v_ex jsonb;
begin
  if not public.has_permission('refunds.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status <> 'pending_admin' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if v_req.resolution <> 'refund' and coalesce(p_options->>'resolution', '') = 'refund' then
    update public.refund_requests set resolution = 'refund' where id = p_request_id;
    perform public.fn_refund_event(p_request_id, 'resolution_changed', p_note, jsonb_build_object('to', 'refund'));
  end if;
  v_res := public.fn_refund_apply(p_request_id, p_items, p_options, p_note);
  if coalesce((v_res->>'ok')::boolean, false) and v_res->>'status' = 'approved' then
    v_ex := public.fn_refund_make_exchange(p_request_id, p_options->>'credit_destination');
    if not coalesce((v_ex->>'skipped')::boolean, false) then
      v_res := v_res || jsonb_build_object('exchange', v_ex);
    end if;
  end if;
  return v_res;
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;

-- ----------------------------------------------------------------------------
-- 7) GOODS RECEIVED — live body + an exchange with nothing to pay out closes
-- ----------------------------------------------------------------------------
create or replace function public.fn_refund_receive(p_req uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_req public.refund_requests%rowtype;
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
   where id = p_req
   returning * into v_req;
  perform public.fn_refund_event(p_req, 'received', p_note, jsonb_build_object('restocked_units', v_n));
  if v_req.resolution <> 'refund' and v_req.exchange_order_id is not null
     and v_req.refund_total_piastres - v_req.exchange_applied_piastres - v_req.exchange_wallet_piastres <= 0 then
    perform public.fn_refund_close_exchange(p_req);
  end if;
  return jsonb_build_object('ok', true, 'restocked_units', v_n);
end $$;

-- 8) FN_CREATE_ORDER — live body + free exchange shipping + commission
--    math in bigint (expensive lines overflowed int4 and failed checkout)
CREATE OR REPLACE FUNCTION public.fn_create_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_discount integer := 0;               -- product-funded
  v_cd_discount integer := 0;            -- commission-funded (VO-22)
  v_free_shipping boolean := false;
  v_eligible_subtotal integer := 0;
  v_line_discount integer;
  v_running integer := 0;
  v_last_eligible integer := -1;

  v_total integer;
  v_wallet_request bigint := 0;
  v_wallet_available bigint;
  v_wallet_paid integer := 0;
  v_wallet_full boolean := false;
  v_wallet_res jsonb;
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
        'wallet_paid_piastres', v_existing.wallet_paid_piastres,
        'duplicate', true);
    end if;
  end if;

  if v_method not in ('kashier', 'cod', 'wallet') then
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
  -- an exchange whose reason is not the customer's ships free (set only by
  -- fn_refund_make_exchange inside its own transaction)
  if coalesce(current_setting('etsawaa.exchange_free_shipping', true), '') = 'on' then
    v_shipping := 0;
  end if;

  -- COD cap from settings (default 5,000 EGP)
  select coalesce((s.value->>'cod_max_total_piastres')::integer, 500000) into v_cod_cap
    from public.settings s where s.key in ('payments', 'checkout') and s.value ? 'cod_max_total_piastres'
     order by (s.key = 'payments') desc limit 1;

  -- lock the cart + the variants (deterministic order avoids deadlocks)
  for r in
    select ci.variant_id, ci.qty, ci.product_id,
           v.stock, v.is_active, v.deleted_at as v_deleted, v.price_piastres,
           v.sale_price_piastres, v.option_key, v.sku, v.image_path,
           p.name_ar, p.name_en, p.status as p_status, p.deleted_at as p_deleted,
           p.shipping_mode, p.is_fragile, p.leaf_category_id, p.brand_id,
           p.vendor_id, coalesce(v.sale_starts_at, p.sale_starts_at) as sale_starts_at, coalesce(v.sale_ends_at, p.sale_ends_at) as sale_ends_at, p.event_hidden
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
        or public.fn_packaging_order_cap_reached(r.vendor_id)
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
          or (d.scope = 'category' and public.fn_category_within(r.leaf_category_id, d.ref_id)))
      order by (d.scope = 'product') desc, d.percent desc
      limit 1;
    if found and v_event_percent > 0 then
      -- max_discount_piastres caps the DISCOUNT, not the resulting price.
      -- (Previously this raised v_unit up to the cap, overcharging the customer
      -- whenever the discount exceeded it; least() also bounds the subtraction
      -- so int4 cannot overflow on ~21.5M+ EGP lines.)
      v_unit := v_unit - least(
        trunc(v_unit * v_event_percent / 100),
        coalesce(v_event_cap, v_unit)
      );
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

  -- coupon (same engine as the cart — server-side recalculation; lines carry
  -- the vendor's live commission rate for commission_percent quoting)
  if v_coupon_code is not null then
    for r in select je as ln from jsonb_array_elements(v_rows) je loop
      select coalesce(
          public.fn_vendor_line_commission((r.ln->>'vendor_id')::uuid, (r.ln->>'leaf_category_id')::uuid) * 100,
          (vl.rewards->>'commission_percent')::numeric * 100,
          500
        ) into v_commission_bps
        from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
       where v.id = (r.ln->>'vendor_id')::uuid;
      v_lines := v_lines || jsonb_build_object(
        'product_id', r.ln->>'product_id', 'vendor_id', r.ln->>'vendor_id',
        'leaf_category_id', r.ln->>'leaf_category_id', 'brand_id', r.ln->>'brand_id',
        'unit_price_piastres', (r.ln->>'unit')::integer, 'qty', (r.ln->>'qty')::integer,
        'on_sale', (r.ln->>'on_sale')::boolean,
        'commission_bps', v_commission_bps);
    end loop;
    v_coupon := public.fn_apply_coupon(v_coupon_code, v_lines);
    if not coalesce((v_coupon->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'coupon_' || coalesce(v_coupon->>'reason', 'invalid'));
    end if;
    select * into v_coupon_row from public.coupons c where upper(c.code) = upper(v_coupon_code);
    if (v_coupon->>'type') = 'commission_percent' then
      v_cd_discount := (v_coupon->>'discount_piastres')::integer;
    else
      v_discount := (v_coupon->>'discount_piastres')::integer;
    end if;
    v_free_shipping := coalesce((v_coupon->>'free_shipping')::boolean, false);

    -- companion product coupon (stacking, AGENT §31): product-funded first,
    -- then the commission-funded one on the reduced commission.
    if v_coupon_row.type = 'commission_percent'
       and coalesce(v_coupon_row.pairs_with, '') <> '' then
      declare
        v_pair public.coupons%rowtype;
        v_pair_res jsonb;
      begin
        select * into v_pair from public.coupons c2 where upper(c2.code) = upper(v_coupon_row.pairs_with);
        if v_pair.id is not null and v_pair.status = 'active' and v_pair.stackable
           and v_pair.type in ('percent','fixed') then
          v_pair_res := public.fn_apply_coupon(v_pair.code, v_lines);
          if coalesce((v_pair_res->>'ok')::boolean, false) then
            v_discount := (v_pair_res->>'discount_piastres')::integer;
            if coalesce((v_pair_res->>'free_shipping')::boolean, false) then v_free_shipping := true; end if;
          end if;
        end if;
      end;
    end if;

    -- per-line eligibility for proportional allocation (same rules as the engine)
    v_i := 0;
    for r in select je as ln from jsonb_array_elements(v_lines) je loop
      if public.c_scope_ok(v_coupon_row, r.ln)
         and not (v_coupon_row.exclude_sale_items and (r.ln->>'on_sale')::boolean) then
        v_eligible_subtotal := v_eligible_subtotal + (r.ln->>'unit_price_piastres')::integer * (r.ln->>'qty')::integer;
        v_last_eligible := v_i;
      end if;
      v_i := v_i + 1;
    end loop;
    if v_free_shipping then v_shipping := 0; end if;
  end if;

  -- allocate the PRODUCT coupon across eligible lines proportionally; the
  -- remainder lands on the last eligible line so the sum matches exactly
  v_running := 0;
  v_i := 0;
  if v_discount > 0 and v_eligible_subtotal > 0 then
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_row := v_it.ln;
      v_line_discount := 0;
      declare
        v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
        v_is_eligible boolean;
      begin
        select public.c_scope_ok(v_coupon_row, jsonb_build_object(
                 'vendor_id', v_row->>'vendor_id', 'leaf_category_id', v_row->>'leaf_category_id',
                 'brand_id', v_row->>'brand_id', 'product_id', v_row->>'product_id'))
             and not (v_coupon_row.exclude_sale_items and (v_row->>'on_sale')::boolean)
          into v_is_eligible;
        if v_is_eligible and v_eligible_subtotal > 0 then
          if v_i = v_last_eligible then
            v_line_discount := v_discount - v_running; -- remainder on the last eligible line
          else
            v_line_discount := trunc(v_discount::numeric * v_line_total / v_eligible_subtotal)::integer;
          end if;
        end if;
      end;
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

  -- VO-22: allocate the COMMISSION-FUNDED discount per line —
  -- line_cd = trunc(coupon% × commission_bps × (line_total − product_discount) / 10000 / 100)
  -- capped so commission never goes negative; remainder lands on the last
  -- commission-eligible (rate > 0) line so the sum matches the engine quote.
  if v_coupon_row.type = 'commission_percent' and v_cd_discount > 0 then
    declare
      v_line_commission integer := 0;
      v_line_cd integer := 0;
      v_cd_running integer := 0;
      v_j integer := 0;
    begin
      -- find the last line with a positive rate (remainder target)
      v_j := 0;
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        select coalesce(
            public.fn_vendor_line_commission((v_it.ln->>'vendor_id')::uuid, (v_it.ln->>'leaf_category_id')::uuid) * 100,
            (vl.rewards->>'commission_percent')::numeric * 100,
            500
          ) into v_commission_bps
          from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
         where v.id = (v_it.ln->>'vendor_id')::uuid;
        v_j := v_j + 1;
      end loop;
      v_j := 0;
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        v_row := v_it.ln;
        select coalesce(
            public.fn_vendor_line_commission((v_row->>'vendor_id')::uuid, (v_row->>'leaf_category_id')::uuid) * 100,
            (vl.rewards->>'commission_percent')::numeric * 100,
            500
          ) into v_commission_bps
          from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
         where v.id = (v_row->>'vendor_id')::uuid;
        v_line_commission := greatest(
          trunc(((v_row->>'unit')::integer * (v_row->>'qty')::integer
                 - coalesce((v_row->>'coupon_discount')::integer, 0))::bigint
                * coalesce(v_commission_bps, 0) / 10000.0)::integer, 0);
        v_line_cd := least(trunc(v_line_commission * v_coupon_row.value / 100.0)::integer, v_line_commission);
        if coalesce(v_commission_bps, 0) = 0 then
          v_line_cd := 0; -- zero-commission items produce zero discount
        end if;
        -- the per-line sum IS the order discount (AGENT §31 rounding: per item
        -- to the nearest piastre) — no remainder juggling on top of the quote
        v_rows := jsonb_set(v_rows, array[v_j::text, 'cd_discount'], to_jsonb(v_line_cd));
        v_cd_running := v_cd_running + v_line_cd;
        v_j := v_j + 1;
      end loop;
      v_cd_discount := v_cd_running;
    end;
  else
    declare
      v_j integer := 0;
    begin
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        v_rows := jsonb_set(v_rows, array[v_j::text, 'cd_discount'], to_jsonb(0));
        v_j := v_j + 1;
      end loop;
    end;
  end if;

  v_total := v_subtotal - v_discount - v_cd_discount + v_shipping;

  -- customer wallet: the amount asked for is capped to the balance and the
  -- total; 'wallet' as the method means the wallet must cover everything
  if p_payload ? 'wallet_piastres' then
    v_wallet_request := greatest(coalesce(nullif(p_payload->>'wallet_piastres', '')::bigint, 0), 0);
  end if;
  if v_method = 'wallet' then
    v_wallet_request := greatest(v_total, 0);
  end if;
  if v_wallet_request > 0 and v_total > 0 then
    perform public.fn_wallet_expire_gifts_for(v_uid);
    select coalesce(refund_piastres, 0) + coalesce(gift_piastres, 0)
      into v_wallet_available
      from public.customer_wallets where user_id = v_uid;
    v_wallet_request := least(v_wallet_request, coalesce(v_wallet_available, 0), v_total::bigint);
  else
    v_wallet_request := 0;
  end if;
  v_wallet_paid := v_wallet_request::integer;
  v_wallet_full := v_wallet_paid > 0 and v_wallet_paid = v_total;
  if v_method = 'wallet' and not v_wallet_full then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available_piastres', coalesce(v_wallet_available, 0));
  end if;
  if v_wallet_full then
    v_method := 'wallet';
  end if;

  -- COD rules (US-05/US-06): cap + vendor-shipped — decided here, server-side
  if v_method = 'cod' then
    if v_vendor_mode then
      return jsonb_build_object('ok', false, 'reason', 'cod_vendor_ship');
    end if;
    if coalesce((select (s.value->>'cod_enabled')::boolean from public.settings s where s.key = 'payments'), true) = false then
      return jsonb_build_object('ok', false, 'reason', 'cod_disabled');
    end if;
    if v_total - v_wallet_paid > v_cod_cap then
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
                         when v_wallet_full then 'processing'
                         else 'pending_payment' end;

  insert into public.orders (number, attempt_key, user_id, email,
      phone_primary, phone_alternate, ship_name, governorate_id, area_id,
      address1, address2, postal_code, status, payment_method, payment_status,
      subtotal_piastres, discount_piastres, shipping_fee_piastres, total_piastres,
      wallet_paid_piastres,
      coupon_id, coupon_code,
      -- L-20 delivery pin (optional; Egypt-bounds CHECKs guard values;
      -- coordinates are ADMIN/CARRIER-only — vendor snapshots never select them)
      shipping_lat, shipping_lng, shipping_geo_accuracy_m)
  values (v_number, v_attempt, v_uid, v_profile.email,
      v_addr->>'phone_primary', v_addr->>'phone_alternate', v_addr->>'full_name',
      (v_addr->>'governorate_id')::smallint, (v_addr->>'area_id')::bigint,
      v_addr->>'address1', nullif(trim(coalesce(v_addr->>'address2', '')), ''),
      nullif(trim(coalesce(v_addr->>'postal_code', '')), ''),
      -- pin (only when both coordinates are numeric and inside Egypt)
      v_order_status, v_method,
      case when v_wallet_full then 'paid' when v_method = 'cod' then 'cod_pending' else 'unpaid' end,
      v_subtotal, v_discount + v_cd_discount, v_shipping, v_total,
      v_wallet_paid,
      case when v_coupon_row.id is not null then v_coupon_row.id end,
      trim(coalesce(v_coupon_code, '')
        || case when v_coupon_row.type = 'commission_percent'
                and coalesce(v_coupon_row.pairs_with, '') <> '' then '+' || v_coupon_row.pairs_with else '' end),
      -- L-20 delivery pin (optional; Egypt-bounds CHECKs guard the values;
      -- coordinates are ADMIN/CARRIER-only — vendor snapshots never select them)
      case when jsonb_typeof(v_addr->'lat') = 'number'
           and jsonb_typeof(v_addr->'lng') = 'number'
           and (v_addr->>'lat')::double precision between 21.0 and 31.8
           and (v_addr->>'lng')::double precision between 24.0 and 37.0
          then (v_addr->>'lat')::double precision end,
      case when jsonb_typeof(v_addr->'lat') = 'number'
           and jsonb_typeof(v_addr->'lng') = 'number'
           and (v_addr->>'lat')::double precision between 21.0 and 31.8
           and (v_addr->>'lng')::double precision between 24.0 and 37.0
          then (v_addr->>'lng')::double precision end,
      case when jsonb_typeof(v_addr->'geo_accuracy') = 'number'
           and (v_addr->>'geo_accuracy')::int between 1 and 5000
          then (v_addr->>'geo_accuracy')::int end)
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
        v_line_cd integer := coalesce((v_row->>'cd_discount')::integer, 0);
        -- commission on the price after the PRODUCT discount; the
        -- commission-funded coupon eats FROM that commission (vendor keeps
        -- the full net line — VO-22)
        -- H-08: the LEAF's effective percent (its own row, else the nearest
        -- ancestor override) beats the vendor level default for THIS line
        v_line_bps integer := coalesce(
          (select round(public.fn_vendor_line_commission((v_row->>'vendor_id')::uuid, (v_row->>'leaf_category_id')::uuid) * 100)::integer),
          v_commission_bps,
          500
        );
        v_commission integer := greatest(
          trunc((v_line_total - v_line_discount)::bigint * v_line_bps / 10000)::integer
            - v_line_cd, 0);
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
            v_line_total, v_line_discount + v_line_cd, v_commission, v_line_bps,
            coalesce((v_row->>'is_fragile')::boolean, false));

        v_group_subtotal := v_group_subtotal + v_line_total;
        v_group_discount := v_group_discount + v_line_discount + v_line_cd;
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

  -- the wallet part is taken inside this transaction (gift lots first)
  if v_wallet_paid > 0 then
    v_wallet_res := public.fn_wallet_spend(v_uid, v_wallet_paid, v_order_id,
      'order:' || v_order_id::text);
    if not coalesce((v_wallet_res->>'ok')::boolean, false) then
      raise exception 'wallet_spend_failed:%', coalesce(v_wallet_res->>'reason', 'unknown');
    end if;
  end if;

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order_id, v_order_status,
          case when v_wallet_full then 'payment_confirmed_wallet' else 'order_created' end, v_uid);

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'number', v_number,
    'payment_method', v_method, 'status', v_order_status, 'wallet_paid_piastres', v_wallet_paid);
exception
  when others then
    -- transaction rolls back automatically; surface the real cause
    return jsonb_build_object('ok', false, 'reason', 'server_error',
      'detail', sqlerrm);
end $function$;

-- 9) FN_WALLET_SPEND — live body; an exchange spends its credit, not gifts
CREATE OR REPLACE FUNCTION public.fn_wallet_spend(p_user uuid, p_amount bigint, p_order_id uuid, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wallet public.customer_wallets%rowtype;
  v_left bigint;
  v_take bigint;
  v_gift_total bigint := 0;
  v_lots jsonb := '[]'::jsonb;
  r record;
begin
  if p_user is null or p_amount is null or p_amount <= 0
     or coalesce(trim(p_reference), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  perform public.fn_wallet_expire_gifts_for(p_user);
  insert into public.customer_wallets (user_id) values (p_user)
    on conflict (user_id) do nothing;
  select * into v_wallet from public.customer_wallets where user_id = p_user for update;
  if v_wallet.refund_piastres + v_wallet.gift_piastres < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available_piastres', v_wallet.refund_piastres + v_wallet.gift_piastres);
  end if;
  v_left := p_amount;
  for r in select * from public.customer_wallet_gifts
            where user_id = p_user and status = 'active' and remaining_piastres > 0
              and expires_at > now()
              -- an exchange pays from its own credit (refund bucket), not the gifts
              and coalesce(current_setting('etsawaa.exchange_request', true), '') = ''
            order by expires_at asc, created_at asc
            for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.remaining_piastres);
    update public.customer_wallet_gifts
      set remaining_piastres = remaining_piastres - v_take,
          status = case when remaining_piastres - v_take = 0 then 'used' else 'active' end
      where id = r.id;
    v_lots := v_lots || jsonb_build_object(
      'gift_id', r.id, 'amount_piastres', v_take, 'expires_at', r.expires_at);
    v_left := v_left - v_take;
    v_gift_total := v_gift_total + v_take;
  end loop;
  if v_gift_total > 0 then
    perform public.fn_wallet_post(p_user, 'gift', 'order_payment', -v_gift_total,
      p_reference, 'order_payment', p_order_id, null, null, jsonb_build_object('lots', v_lots));
  end if;
  if v_left > 0 then
    perform public.fn_wallet_post(p_user, 'refund', 'order_payment', -v_left,
      p_reference, 'order_payment', p_order_id, null, null, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'amount_piastres', p_amount,
    'gift_piastres', v_gift_total, 'refund_piastres', p_amount - v_gift_total);
end $function$;

-- 10) FN_ADMIN_EXECUTE_REFUND — live body; pays only what is still due
CREATE OR REPLACE FUNCTION public.fn_admin_execute_refund(p_request_id uuid, p_note text DEFAULT NULL::text, p_method text DEFAULT 'original'::text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_refunded bigint;
  v_wallet_res jsonb;
  v_due integer;
begin
  if not public.has_permission('refunds.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status = 'refunded' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_req.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if v_req.logistics_status = 'awaiting_return' then
    return jsonb_build_object('ok', false, 'reason', 'awaiting_return');
  end if;
  -- an exchange pays out only what the replacement order and the wallet did not take
  v_due := v_req.refund_total_piastres - coalesce(v_req.exchange_applied_piastres, 0)
           - coalesce(v_req.exchange_wallet_piastres, 0);
  if v_req.resolution <> 'refund' and v_due <= 0 then
    perform public.fn_refund_close_exchange(p_request_id);
    return jsonb_build_object('ok', true, 'exchange', true);
  end if;
  if coalesce(p_method, '') not in ('original', 'bank_transfer', 'wallet', 'cash', 'other', 'store_wallet') then
    return jsonb_build_object('ok', false, 'reason', 'bad_method');
  end if;
  update public.refund_requests set status = 'refunded', executed_at = now(), executed_by = auth.uid(),
         execution_note = nullif(trim(coalesce(p_note, '')), ''),
         refund_method = p_method, refund_reference = nullif(trim(coalesce(p_reference, '')), '')
   where id = p_request_id;
  -- refund into the customer's wallet (refund balance, never expires)
  if p_method = 'store_wallet' and v_due > 0 then
    v_wallet_res := public.fn_wallet_post(
      v_req.user_id, 'refund',
      case when v_req.source = 'cancel' then 'cancel_credit' else 'refund_credit' end,
      v_due, 'refund:' || v_req.id::text,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'refund'),
      v_req.order_id, v_req.id, null, '{}'::jsonb);
    if not coalesce((v_wallet_res->>'ok')::boolean, false) then
      raise exception 'wallet_failed:%', coalesce(v_wallet_res->>'reason', 'unknown');
    end if;
    perform public.fn_notify(v_req.user_id, 'wallet_credited', jsonb_build_object(
      'ar', jsonb_build_object('title', 'رصيد في محفظتك',
        'body', 'أضيف ' || round(v_due / 100.0, 2) || ' ج.م إلى محفظتك'),
      'en', jsonb_build_object('title', 'Money added to your wallet',
        'body', 'EGP ' || round(v_due / 100.0, 2) || ' was added to your wallet balance'),
      'link', '/account/wallet'));
  end if;
  select * into v_order from public.orders where id = v_req.order_id for update;
  select coalesce(sum(refund_total_piastres), 0) into v_refunded
    from public.refund_requests where order_id = v_order.id and status = 'refunded';
  update public.orders set payment_status = case when v_refunded >= v_order.total_piastres then 'refunded'
                                                 else 'partially_refunded' end, updated_at = now()
   where id = v_order.id and v_refunded > 0;
  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order.id, v_order.status, 'refund_executed', auth.uid());
  perform public.fn_refund_event(p_request_id, 'refunded', p_note,
    jsonb_build_object('method', p_method, 'reference', p_reference, 'amount_piastres', v_due));
  perform public.fn_audit('refund.executed', 'refund_requests', p_request_id::text,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'refunded', 'method', p_method, 'reference', p_reference,
                       'amount_piastres', v_due));
  perform public.fn_notify(v_order.user_id, 'refund_executed', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم رد المبلغ', 'body', 'تم رد ' || round(v_due / 100.0, 2) || ' ج.م — الطلب ' || v_order.number),
    'en', jsonb_build_object('title', 'Refund issued', 'body', 'EGP ' || round(v_due / 100.0, 2) || ' refunded — order ' || v_order.number),
    'link', '/account/returns'));
  return jsonb_build_object('ok', true);
end $function$;

-- ----------------------------------------------------------------------------
-- 11) THE CUSTOMER PAYS THE DIFFERENCE ON DELIVERY (when the settings allow)
-- ----------------------------------------------------------------------------
create or replace function public.fn_exchange_choose_cod(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_settings jsonb;
  v_cap integer;
  v_due integer;
begin
  select * into v_order from public.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_order.exchange_request_id is null then return jsonb_build_object('ok', false, 'reason', 'not_exchange'); end if;
  if v_order.payment_method = 'cod' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_order.payment_status <> 'unpaid' or v_order.status not in ('pending_payment', 'on_hold') then
    return jsonb_build_object('ok', false, 'reason', 'not_payable');
  end if;
  select value into v_settings from public.settings where key = 'returns';
  if not (coalesce(v_settings->'exchange_pay_methods', '["kashier","cod"]'::jsonb) ? 'cod') then
    return jsonb_build_object('ok', false, 'reason', 'cod_disabled');
  end if;
  if coalesce((select (s.value->>'cod_enabled')::boolean from public.settings s where s.key = 'payments'), true) = false then
    return jsonb_build_object('ok', false, 'reason', 'cod_disabled');
  end if;
  if exists (select 1 from public.order_vendor_groups g where g.order_id = v_order.id and g.shipping_mode = 'vendor') then
    return jsonb_build_object('ok', false, 'reason', 'cod_vendor_ship');
  end if;
  select coalesce((s.value->>'cod_max_total_piastres')::integer, 500000) into v_cap
    from public.settings s where s.key in ('payments', 'checkout') and s.value ? 'cod_max_total_piastres'
   order by (s.key = 'payments') desc limit 1;
  v_due := v_order.total_piastres - coalesce(v_order.wallet_paid_piastres, 0);
  if v_due > coalesce(v_cap, 500000) then
    return jsonb_build_object('ok', false, 'reason', 'cod_cap', 'cap_piastres', v_cap);
  end if;
  update public.orders set payment_method = 'cod', payment_status = 'cod_pending',
         status = case when status = 'pending_payment' then 'processing' else status end, updated_at = now()
   where id = v_order.id;
  update public.order_vendor_groups set status = 'preparing'
   where order_id = v_order.id and status = 'pending';
  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order.id, case when v_order.status = 'pending_payment' then 'processing' else v_order.status end,
          'exchange_difference_cod', auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fn_exchange_choose_cod(uuid) from public, anon;
grant execute on function public.fn_exchange_choose_cod(uuid) to authenticated;

commit;
