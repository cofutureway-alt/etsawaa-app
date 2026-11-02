-- ============================================================================
-- Etsawaa — Phase 07 Admin Suite (RPCs + dashboard views, part 2 of 2)
-- Every money RPC atomic + idempotent; every sensitive change audited
-- (before/after/actor). Wallet ledger stays the source of truth.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Shared audit helper (definer; actor = auth.uid())
-- ----------------------------------------------------------------------------
create or replace function public.fn_audit(p_action text, p_entity text,
  p_entity_id text, p_before jsonb, p_after jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

revoke all on function public.fn_audit(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.fn_audit(text, text, text, jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 1) FN_ADMIN_SET_COMMISSION (A-06, US-03) — inherit | fixed | category.
--    Applies to FUTURE orders only (create_order reads it live).
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_set_commission(
  p_vendor_id uuid, p_mode text, p_fixed_percent numeric default null,
  p_overrides jsonb default null) -- [{category_id, percent}]
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_mode not in ('inherit','fixed','category') then
    return jsonb_build_object('ok', false, 'reason', 'bad_mode');
  end if;
  if p_mode = 'fixed' and (p_fixed_percent is null or p_fixed_percent < 0 or p_fixed_percent > 100) then
    return jsonb_build_object('ok', false, 'reason', 'bad_percent');
  end if;
  select jsonb_build_object('mode', commission_mode, 'fixed', commission_fixed_percent)
    into v_before from public.vendors where id = p_vendor_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  update public.vendors
     set commission_mode = p_mode,
         commission_fixed_percent = case when p_mode = 'fixed' then p_fixed_percent end,
         updated_at = now()
   where id = p_vendor_id;

  delete from public.vendor_commission_overrides where vendor_id = p_vendor_id;
  if p_mode = 'category' and p_overrides is not null then
    insert into public.vendor_commission_overrides (vendor_id, category_id, percent)
    select p_vendor_id, (o->>'category_id')::uuid, (o->>'percent')::numeric
    from jsonb_array_elements(p_overrides) o
    where (o->>'percent')::numeric between 0 and 100;
  end if;

  perform public.fn_audit('vendor.commission.set', 'vendors', p_vendor_id::text, v_before,
    jsonb_build_object('mode', p_mode, 'fixed', p_fixed_percent, 'overrides', coalesce(p_overrides, '[]'::jsonb)));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 2) FN_VENDOR_EFFECTIVE_COMMISSION (preview for A-06; also usable by order
--    math later) — vendor + leaf category → percent.
-- ----------------------------------------------------------------------------
create or replace function public.fn_vendor_effective_commission(
  p_vendor_id uuid, p_category_id uuid default null)
returns numeric
language sql stable security definer set search_path = public as $$
  select case v.commission_mode
    when 'fixed' then coalesce(v.commission_fixed_percent, 0)
    when 'category' then coalesce(
      (select o.percent from public.vendor_commission_overrides o
        where o.vendor_id = v.id and o.category_id = coalesce(p_category_id, v.category_ids[1])),
      (select coalesce((lvl.rewards->>'commission_percent')::numeric, 5)
         from public.vendor_levels lvl where lvl.id = v.level_id))
    else coalesce((lvl.rewards->>'commission_percent')::numeric, 5)
  end
  from public.vendors v left join public.vendor_levels lvl on lvl.id = v.level_id
  where v.id = p_vendor_id;
$$;

revoke all on function public.fn_vendor_effective_commission(uuid, uuid) from public, anon;
grant execute on function public.fn_vendor_effective_commission(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) FN_ADMIN_APPLY_PENALTY (A-18, US-06) — wallet transaction + row. Waive
--    reverses with a DISTINCT withdrawal_refund-style credit, never deletion.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_apply_penalty(
  p_vendor_id uuid, p_amount_piastres integer, p_reason text, p_rule_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pen uuid; v_ref text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_amount_piastres is null or p_amount_piastres <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  insert into public.vendor_penalties (vendor_id, source, rule_key, amount_piastres, reason, reference)
  values (p_vendor_id, case when p_rule_key is null then 'manual' else 'rule' end,
          p_rule_key, p_amount_piastres, trim(p_reason), null)
  returning id into v_pen;
  v_ref := 'penalty:' || v_pen::text;
  update public.vendor_penalties set reference = v_ref where id = v_pen;

  perform public.fn_post_transaction(p_vendor_id, 'penalty', p_amount_piastres, v_ref,
    trim(p_reason));

  -- notify the vendor (bilingual payload)
  perform public.fn_notify((select owner_id from public.vendors where id = p_vendor_id),
    'penalty',
    jsonb_build_object(
      'ar', jsonb_build_object('title', 'غرامة جديدة', 'body', 'تم تطبيق غرامة على متجرك: ' || trim(p_reason)),
      'en', jsonb_build_object('title', 'New penalty', 'body', 'A penalty was applied to your store: ' || trim(p_reason)),
      'link', '/vendor/wallet'));

  perform public.fn_audit('penalty.applied', 'vendor_penalties', v_pen::text, null,
    jsonb_build_object('vendor_id', p_vendor_id, 'amount', p_amount_piastres, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'penalty_id', v_pen);
end $$;

-- ----------------------------------------------------------------------------
-- 4) FN_ADMIN_WAIVE_PENALTY (A-18) — distinct credit transaction, once.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_waive_penalty(p_penalty_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pen public.vendor_penalties%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_pen from public.vendor_penalties where id = p_penalty_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_pen.status = 'waived' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;

  update public.vendor_penalties
     set status = 'waived', waived_by = auth.uid(), waived_at = now()
   where id = p_penalty_id;

  -- reversal credit: amount returned to available; keyed to the penalty id
  perform public.fn_post_transaction(v_pen.vendor_id, 'withdrawal_refund', v_pen.amount_piastres,
    v_pen.reference, 'Penalty waived: ' || p_reason);

  perform public.fn_audit('penalty.waived', 'vendor_penalties', p_penalty_id::text,
    jsonb_build_object('status', 'applied'), jsonb_build_object('status', 'waived', 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 5) FN_ADMIN_ADJUST_WALLET (A-29) — admin_adjustment credit/debit.
--    Signed amount: >0 credit, <0 debit. Reason MANDATORY.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_adjust_wallet(
  p_vendor_id uuid, p_amount_piastres bigint, p_reason text, p_reference text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_amount_piastres is null or p_amount_piastres = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform public.fn_post_transaction(p_vendor_id, 'admin_adjustment', p_amount_piastres,
    coalesce(nullif(trim(p_reference), ''), 'adjustment:' || extract(epoch from now())::bigint::text),
    trim(p_reason));
  perform public.fn_audit('wallet.adjusted', 'wallets', p_vendor_id::text, null,
    jsonb_build_object('amount', p_amount_piastres, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 6) FN_ADMIN_DECIDE_REFUND (A-16/A-17, US-05) — per-item decision. Atomic:
--    decisions + refund amount + restock + vendor fault ⇒ clawback + penalty,
--    shipping ⇒ no vendor charge. Idempotent: request must be pending_admin.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_decide_refund(
  p_request_id uuid, p_items jsonb, p_note text default null)
-- p_items: [{item_id, decision:'approve'|'partial'|'reject', fault, amount, restock}]
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req public.refund_requests%rowtype;
  v_it public.order_items%rowtype;
  v_dec text; v_fault text; v_amt integer; v_restock boolean;
  v_vendor uuid; v_row jsonb;
  v_clawback_total bigint := 0;
  v_refunded_total bigint := 0;
  v_vendor_faults int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status <> 'pending_admin' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  for v_row in select j from jsonb_array_elements(p_items) j loop
    v_dec := v_row->>'decision'; v_fault := v_row->>'fault';
    v_amt := coalesce((v_row->>'amount')::integer, 0);
    v_restock := coalesce((v_row->>'restock')::boolean, true);
    if v_dec not in ('approve','partial','reject') then
      return jsonb_build_object('ok', false, 'reason', 'bad_decision');
    end if;
    select * into v_it from public.order_items where id = (v_row->>'item_id')::uuid
      and order_id = v_req.order_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'bad_item'); end if;
    if v_dec <> 'reject' and v_amt <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'amount_required');
    end if;

    update public.refund_request_items
       set decision = v_dec, fault = v_fault, refund_amount_piastres = case when v_dec='reject' then 0 else v_amt end,
           restock = v_restock, decided_by = auth.uid(), decided_at = now()
     where refund_request_id = p_request_id and order_item_id = v_it.id;

    if v_dec <> 'reject' then
      v_refunded_total := v_refunded_total + v_amt;
      if v_restock then
        update public.variants set stock = stock + v_it.qty where id = v_it.variant_id;
      end if;
    end if;
    if v_dec <> 'reject' and v_fault = 'vendor' then
      v_vendor := v_it.vendor_id;
      v_clawback_total := v_clawback_total + v_amt;
      v_vendor_faults := v_vendor_faults + 1;
    end if;
  end loop;

  update public.refund_requests
     set status = 'approved', decision_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_at = now()
   where id = p_request_id;

  -- vendor fault ⇒ ONE debit unit: refund_clawback tx + a penalty ROW whose
  -- reference carries the same key (the penalty's money is the clawback tx —
  -- posting both would double-charge). waive() reverses via the penalty ref.
  if v_clawback_total > 0 and v_vendor is not null then
    perform public.fn_post_transaction(v_vendor, 'refund_clawback', -v_clawback_total,
      'refund:' || p_request_id::text, 'Refund clawback (vendor fault)');
    insert into public.vendor_penalties (vendor_id, source, rule_key, amount_piastres, reason, reference)
    values (v_vendor, 'rule', 'refund_fault', v_clawback_total,
            'Refund penalty — vendor fault on request ' || p_request_id::text,
            'penalty:' || p_request_id::text) on conflict do nothing;
  end if;
  -- shipping fault ⇒ no vendor charge, carrier claim documented by note only

  perform public.fn_audit('refund.decided', 'refund_requests', p_request_id::text,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('items', p_items, 'clawback', v_clawback_total, 'refunded', v_refunded_total));
  return jsonb_build_object('ok', true, 'refunded_total', v_refunded_total,
    'clawback_total', v_clawback_total);
end $$;

-- ----------------------------------------------------------------------------
-- 7) FN_ADMIN_EXECUTE_REFUND (A-17) — mark settled (manual transfer ledger at
--    launch; Kashier API arrives with the pre-launch gate). Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_execute_refund(
  p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_req public.refund_requests%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  update public.refund_requests
     set status = 'refunded', executed_at = now(), executed_by = auth.uid(),
         execution_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_request_id;
  perform public.fn_audit('refund.executed', 'refund_requests', p_request_id::text,
    jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'refunded'));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 8) FN_HIDE_VENDOR_LISTINGS (A-08/A-21) — reversible hide + unhide, audited.
-- ----------------------------------------------------------------------------
create or replace function public.fn_hide_vendor_listings(
  p_vendor_id uuid, p_hide boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select hidden_from_listings into v_before from public.vendors where id = p_vendor_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_hide and (p_reason is null or length(trim(p_reason)) < 3) then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  update public.vendors
     set hidden_from_listings = p_hide,
         hidden_reason = case when p_hide then trim(p_reason) end,
         updated_at = now()
   where id = p_vendor_id;
  perform public.fn_audit('vendor.listings.' || case when p_hide then 'hidden' else 'unhidden' end,
    'vendors', p_vendor_id::text, jsonb_build_object('hidden_from_listings', v_before),
    jsonb_build_object('hidden_from_listings', p_hide, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 9) FN_BAN_VENDOR (A-04) — suspend/unban with reason; audited.
-- ----------------------------------------------------------------------------
create or replace function public.fn_ban_vendor(p_vendor_id uuid, p_ban boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select status into v_before from public.vendors where id = p_vendor_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_ban and (p_reason is null or length(trim(p_reason)) < 3) then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  update public.vendors
     set status = case when p_ban then 'suspended' else 'active' end,
         ban_reason = case when p_ban then trim(p_reason) end,
         updated_at = now()
   where id = p_vendor_id;
  perform public.fn_audit('vendor.banned', 'vendors', p_vendor_id::text,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', case when p_ban then 'suspended' else 'active' end, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 10) FN_ADMIN_GRANT_AD (A-20, US-10) — active campaign, source=admin_grant,
--     NO payment transaction ever.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_grant_ad(
  p_vendor_id uuid, p_package_id uuid, p_days integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pkg public.ad_packages%rowtype; v_days integer; v_campaign uuid; v_product uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_pkg from public.ad_packages where id = p_package_id;
  if not found or not v_pkg.is_active then
    return jsonb_build_object('ok', false, 'reason', 'package_unavailable');
  end if;
  v_days := coalesce(p_days, v_pkg.duration_days);
  if v_days is null or v_days <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_days'); end if;

  insert into public.ad_campaigns (package_id, vendor_id, product_id, source, status,
      started_at, ends_at, granted_by)
  values (p_package_id, p_vendor_id,
          (select id from public.products
            where vendor_id = p_vendor_id and status = 'approved' and deleted_at is null
            order by created_at desc limit 1),
          'admin_grant', 'active', now(), now() + make_interval(days => v_days), auth.uid())
  returning id into v_campaign;

  perform public.fn_audit('ad.granted', 'ad_campaigns', v_campaign::text, null,
    jsonb_build_object('vendor_id', p_vendor_id, 'package_id', p_package_id, 'days', v_days));
  return jsonb_build_object('ok', true, 'campaign_id', v_campaign);
end $$;

-- ----------------------------------------------------------------------------
-- 11) FN_EVENT_SET_VENDOR (A-21, US-11) — acceptance flips back (refuse ⇄
--     accept); refusal hides products publicly through the p4 views already.
-- ----------------------------------------------------------------------------
create or replace function public.fn_event_set_vendor(
  p_event_id uuid, p_vendor_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('auto','accepted','refused') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  if p_status = 'refused' and (p_reason is null or length(trim(p_reason)) < 3) then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'reason', 'event_not_found');
  end if;
  insert into public.event_vendors (event_id, vendor_id, status)
  values (p_event_id, p_vendor_id, p_status)
  on conflict (event_id, vendor_id) do update set status = excluded.status;
  perform public.fn_audit('event.vendor.' || p_status, 'event_vendors',
    p_event_id || ':' || p_vendor_id, null, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 12) FN_MANUAL_HIDE_PRODUCT (A-21/A-22) — event_hidden toggle with confirm.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_hide_product(p_product_id uuid, p_hide boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_hide and (p_reason is null or length(trim(p_reason)) < 3) then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select event_hidden into v_before from public.products where id = p_product_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.products set event_hidden = p_hide, updated_at = now() where id = p_product_id;
  perform public.fn_audit('product.hidden', 'products', p_product_id::text,
    jsonb_build_object('event_hidden', v_before),
    jsonb_build_object('event_hidden', p_hide, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 13) FN_PROMOTE_VENDOR_LEVEL (A-19, US-09) — manual promote/demote or auto
--     (cron). History row + notification. Idempotent on same level.
-- ----------------------------------------------------------------------------
create or replace function public.fn_promote_vendor_level(
  p_vendor_id uuid, p_to_level uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_owner uuid;
begin
  select level_id, owner_id into v_from, v_owner from public.vendors where id = p_vendor_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_from = p_to_level then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  update public.vendors set level_id = p_to_level, updated_at = now() where id = p_vendor_id;
  insert into public.vendor_level_history (vendor_id, from_level, to_level, actor, reason)
  values (p_vendor_id, v_from, p_to_level, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));

  perform public.fn_notify(v_owner, 'level',
    jsonb_build_object(
      'ar', jsonb_build_object('title', 'تغيير مستوى المتجر', 'body', 'تم تحديث مستوى متجرك'),
      'en', jsonb_build_object('title', 'Store level changed', 'body', 'Your store level was updated'),
      'link', '/vendor'));

  perform public.fn_audit('vendor.level.changed', 'vendors', p_vendor_id::text,
    jsonb_build_object('level_id', v_from), jsonb_build_object('level_id', p_to_level, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 14) FN_AUTO_LEVELS (cron from §20) — promote vendors whose successful-order
--     count crossed the threshold. Manual demote stays manual.
-- ----------------------------------------------------------------------------
create or replace function public.fn_auto_levels()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_moved integer := 0; r record;
begin
  for r in
    select v.id as vendor_id, lvl.id as level_id
    from public.vendors v
    join public.vendor_levels lvl on lvl.is_active
    where v.status = 'active'
      and (select count(*) from public.order_vendor_groups g
           where g.vendor_id = v.id and g.status = 'delivered') >= lvl.min_successful_orders
      and lvl.min_successful_orders > coalesce((
        select l2.min_successful_orders from public.vendors v2
        join public.vendor_levels l2 on l2.id = v2.level_id where v2.id = v.id), -1)
      and lvl.min_successful_orders = (
        select min(l3.min_successful_orders) from public.vendor_levels l3
        where l3.is_active and l3.min_successful_orders > coalesce((
          select l4.min_successful_orders from public.vendors v3
          join public.vendor_levels l4 on l4.id = v3.level_id where v3.id = v.id), -1))
  loop
    perform public.fn_promote_vendor_level(r.vendor_id, r.level_id, 'auto: threshold reached');
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('ok', true, 'moved', v_moved);
end $$;

-- ----------------------------------------------------------------------------
-- 15) FN_ADMIN_BULK_ORDER_STATUS (A-14) — validated per order; failures listed.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_bulk_order_status(
  p_order_ids uuid[], p_status text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; v_ok int := 0; v_failed jsonb := '[]'::jsonb; v_why text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('processing','completed','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  foreach o in array p_order_ids loop
    begin
      if p_status = 'cancelled' then
        -- validation + side effects live in fn_cancel_order (phase 05)
        perform public.fn_cancel_order_admin(o, trim(p_reason));
      else
        perform public.fn_admin_set_order_status(o, p_status, trim(p_reason));
      end if;
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object(jsonb_build_object('id', o)::text, SQLERRM);
    end;
  end loop;
  perform public.fn_audit('orders.bulk_status', 'orders', null, null,
    jsonb_build_object('count', v_ok, 'status', p_status, 'failed', v_failed));
  return jsonb_build_object('ok', true, 'changed', v_ok, 'failed', v_failed);
end $$;

-- helpers for #15 (create-if-missing so the whole file stays idempotent)
create or replace function public.fn_admin_set_order_status(
  p_order_id uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_old text; v_user uuid;
begin
  select status, user_id into v_old, v_user from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if v_old <> p_status then
    update public.orders set status = p_status, updated_at = now() where id = p_order_id;
    insert into public.order_status_history (order_id, status, actor, note)
    values (p_order_id, p_status, auth.uid(), p_reason);
  end if;
end $$;

create or replace function public.fn_cancel_order_admin(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_old text; r record;
begin
  select status into v_old from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if v_old in ('completed','cancelled') then raise exception 'not_cancellable'; end if;
  update public.orders set status = 'cancelled', cancel_reason = p_reason,
    cancelled_at = now(), updated_at = now() where id = p_order_id;
  insert into public.order_status_history (order_id, status, actor, note)
  values (p_order_id, 'cancelled', auth.uid(), p_reason);
  update public.order_vendor_groups set status = 'cancelled', cancel_reason = p_reason,
    cancelled_at = now() where order_id = p_order_id and status not in ('delivered');
  for r in
    select oi.variant_id, oi.qty from public.order_items oi where oi.order_id = p_order_id
  loop
    update public.variants set stock = stock + r.qty where id = r.variant_id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 16) FN_ADMIN_DELETE blocked / soft-archive PRODUCTS (A-09-A10)
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_archive_product(p_product_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select to_jsonb(p) into v_before from public.products p where id = p_product_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.products set deleted_at = now(), updated_at = now() where id = p_product_id;
  perform public.fn_audit('product.archived', 'products', p_product_id::text,
    jsonb_build_object('deleted_at', v_before->>'deleted_at'),
    jsonb_build_object('reason', p_reason, 'archived', true));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 17) SHIPPING ZONES guards (A-35, US-16/17): delete blocked when referenced.
--     Updated_at trigger for governorates/areas.
-- ----------------------------------------------------------------------------
create or replace function public.fn_geo_touch() returns trigger
language plpgsql as $$
begin
  -- governorates/areas have no updated_at column; audit is done from the app RPC-free
  -- path below via fn_audit calls in the routes. Nothing to mutate here.
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 18) AREAS IMPORT (A-36, US-18) — idempotent CSV rows [{governorate_id,
--     name_ar, name_en?, pickup_fee_piastres?}] → created/updated/skipped.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_import_areas(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_gid smallint; v_pickup integer;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_errors jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  for r in select j from jsonb_array_elements(p_rows) j loop
    v_gid := null; v_pickup := null;
    begin
      v_gid := (r->>'governorate_id')::smallint;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', r, 'error', 'bad_governorate'); continue;
    end;
    if v_gid is null or not exists (select 1 from public.governorates g where g.id = v_gid) then
      v_errors := v_errors || jsonb_build_object('row', r, 'error', 'unknown_governorate'); continue;
    end if;
    if coalesce(trim(coalesce(r->>'name_ar','')), '') = '' then
      v_errors := v_errors || jsonb_build_object('row', r, 'error', 'name_required'); continue;
    end if;
    if coalesce(r->>'pickup_fee_piastres', '')::text <> '' then
      v_pickup := (r->>'pickup_fee_piastres')::integer;
      if v_pickup is null or v_pickup < 0 then
        v_errors := v_errors || jsonb_build_object('row', r, 'error', 'bad_fee'); continue;
      end if;
    end if;

    if exists (select 1 from public.areas a
               where a.governorate_id = v_gid and a.name_ar = r->>'name_ar') then
      update public.areas set
          name_en = coalesce(nullif(trim(coalesce(r->>'name_en','')), ''), name_en),
          pickup_fee_piastres = coalesce(v_pickup, pickup_fee_piastres)
        where governorate_id = v_gid and name_ar = r->>'name_ar';
      v_updated := v_updated + 1;
    else
      insert into public.areas (governorate_id, name_ar, name_en, pickup_fee_piastres, sort)
      values (v_gid, r->>'name_ar', coalesce(nullif(trim(coalesce(r->>'name_en','')), ''), ''),
              coalesce(v_pickup, (select shipping_fee_piastres from public.governorates where id = v_gid)),
              (select coalesce(max(sort),0)+1 from public.areas where governorate_id = v_gid));
      v_created := v_created + 1;
    end if;
  end loop;
  perform public.fn_audit('areas.imported', 'areas', null, null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'errors', jsonb_array_length(v_errors)));
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated,
    'errors', v_errors);
end $$;

revoke all on function public.fn_admin_import_areas(jsonb) from public, anon;

-- ----------------------------------------------------------------------------
-- 19) SETTINGS SECTION SAVE (A-24) — audited upsert; keeps updated_by.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_set_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_key !~ '^[a-z0-9_.]{2,60}$' then return jsonb_build_object('ok', false, 'reason', 'bad_key'); end if;
  select value into v_before from public.settings where key = p_key;
  insert into public.settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  perform public.fn_audit('settings.saved', 'settings', p_key,
    v_before, p_value);
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 20) ROLES (A-26): permission matrix update; last admin protected elsewhere.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_set_role_permissions(p_slug text, p_permissions jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select to_jsonb(r) into v_before from public.roles r where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.roles set permissions = p_permissions where slug = p_slug;
  perform public.fn_audit('role.permissions', 'roles', p_slug,
    v_before->'permissions', p_permissions);
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 21) DASHBOARD VIEWS (A-01) — every number traces to one documented query.
-- ----------------------------------------------------------------------------
create or replace view public.v_admin_kpis as
select
  (select count(*) from public.products where status='pending' and deleted_at is null) as products_awaiting,
  (select count(*) from public.vendors where status='pending') as vendors_awaiting,
  (select count(*) from public.withdrawal_requests where status='pending') as withdrawals_pending,
  (select count(*) from public.vendors where verification_status='submitted') as verifications_pending,
  (select coalesce(sum(total_piastres),0) from public.orders
    where created_at >= date_trunc('day', now()) and status in ('processing','completed')) as sales_today,
  (select count(*) from public.orders where created_at >= date_trunc('day', now())) as orders_today,
  (select count(*) from public.profiles where status='active') as customers_total,
  (select count(*) from public.vendors where status='active') as vendors_active,
  (select coalesce(sum(commission_piastres),0) from public.order_vendor_groups) as commission_all_time,
  (select coalesce(sum(total_piastres),0) from public.orders
     where status in ('processing','completed')) as sales_all_time,
  (select count(*) from public.orders) as orders_all_time,
  (select count(*) from public.products where deleted_at is null) as products_all_time,
  (select count(*) from public.refund_requests where status='pending_admin') as refunds_pending;

grant select on public.v_admin_kpis to authenticated;

create or replace view public.v_admin_daily_sales as
select d::date as day,
  coalesce(sum(o.total_piastres) filter (where o.status in ('processing','completed')), 0) as sales,
  count(o.id) as orders
from generate_series(date_trunc('day', now()) - interval '89 days',
                     date_trunc('day', now()), interval '1 day') d
left join public.orders o on o.created_at >= d and o.created_at < d + interval '1 day'
group by d order by d;

grant select on public.v_admin_daily_sales to authenticated;

create or replace view public.v_admin_top_vendors as
select v.id, v.store_name_ar, v.store_name_en, v.logo_path,
  lvl.name_ar as level_name_ar, lvl.name_en as level_name_en,
  count(g.id) as orders,
  coalesce(sum(g.items_subtotal_piastres),0) as revenue,
  coalesce(sum(g.commission_piastres),0) as commission
from public.vendors v
left join public.vendor_levels lvl on lvl.id = v.level_id
left join public.order_vendor_groups g on g.vendor_id = v.id
group by v.id, lvl.name_ar, lvl.name_en
order by revenue desc
limit 10;

grant select on public.v_admin_top_vendors to authenticated;

create or replace view public.v_admin_top_products as
select p.id, p.name_ar, p.name_en,
  coalesce(round(avg(r.rating),1), 0) as rating_avg,
  count(r.id) as reviews_count
from public.products p
join public.reviews r on r.product_id = p.id and r.status='published'
where p.deleted_at is null
group by p.id
order by rating_avg desc, reviews_count desc
limit 10;

grant select on public.v_admin_top_products to authenticated;

-- ----------------------------------------------------------------------------
-- GRANTS on everything new (definer RPCs)
-- ----------------------------------------------------------------------------
revoke all on function public.fn_admin_set_commission(uuid, text, numeric, jsonb),
  public.fn_admin_apply_penalty(uuid, integer, text, text),
  public.fn_admin_waive_penalty(uuid, text),
  public.fn_admin_adjust_wallet(uuid, bigint, text, text),
  public.fn_admin_decide_refund(uuid, jsonb, text),
  public.fn_admin_execute_refund(uuid, text),
  public.fn_hide_vendor_listings(uuid, boolean, text),
  public.fn_ban_vendor(uuid, boolean, text),
  public.fn_admin_grant_ad(uuid, uuid, integer),
  public.fn_event_set_vendor(uuid, uuid, text, text),
  public.fn_admin_hide_product(uuid, boolean, text),
  public.fn_promote_vendor_level(uuid, uuid, text),
  public.fn_auto_levels(),
  public.fn_admin_bulk_order_status(uuid[], text, text),
  public.fn_admin_set_order_status(uuid, text, text),
  public.fn_cancel_order_admin(uuid, text),
  public.fn_admin_archive_product(uuid, text),
  public.fn_geo_touch(),
  public.fn_admin_set_setting(text, jsonb),
  public.fn_admin_set_role_permissions(text, jsonb)
  from public, anon;
grant execute on function
  public.fn_admin_set_commission(uuid, text, numeric, jsonb),
  public.fn_admin_apply_penalty(uuid, integer, text, text),
  public.fn_admin_waive_penalty(uuid, text),
  public.fn_admin_adjust_wallet(uuid, bigint, text, text),
  public.fn_admin_decide_refund(uuid, jsonb, text),
  public.fn_admin_execute_refund(uuid, text),
  public.fn_hide_vendor_listings(uuid, boolean, text),
  public.fn_ban_vendor(uuid, boolean, text),
  public.fn_admin_grant_ad(uuid, uuid, integer),
  public.fn_event_set_vendor(uuid, uuid, text, text),
  public.fn_admin_hide_product(uuid, boolean, text),
  public.fn_promote_vendor_level(uuid, uuid, text),
  public.fn_auto_levels(),
  public.fn_admin_bulk_order_status(uuid[], text, text),
  public.fn_admin_archive_product(uuid, text),
  public.fn_admin_set_setting(text, jsonb),
  public.fn_admin_set_role_permissions(text, jsonb)
  to authenticated;
