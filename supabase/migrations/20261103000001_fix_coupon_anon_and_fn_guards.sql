-- ============================================================================
-- Fix 01 — guest coupons + missing authorization guards
--
-- 1) fn_apply_coupon lost its anon grant in phase06 (revoked from public,anon;
--    granted to authenticated only). The storefront route /api/coupon is
--    documented to serve guests (JOURNEYS §5), so guest coupon apply returned
--    a Postgres permission error → HTTP 500. The function is SECURITY DEFINER
--    and its per-user limit already branches on auth.uid() being null.
--
-- 2) Seven SECURITY DEFINER functions perform admin-only mutations but carry
--    no internal role check and are executable by `authenticated`
--    (fn_notify even by `anon`). Bodies below are the LIVE ones captured in
--    backups/fn_*.sql, with a guard prologue added — nothing else changed.
--    `fn_audit` is excluded on purpose: RPCs in other roles call it to record
--    their own actions, so it stays callable; its ACL is tightened next file.
--
-- Re-running is safe (create or replace; grant is additive).
-- ============================================================================
begin;

-- --------------------------------------------------------------------------
-- 1) Guest coupon apply
-- --------------------------------------------------------------------------
grant execute on function public.fn_apply_coupon(text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- 2) Guards
-- --------------------------------------------------------------------------
create or replace function public.fn_cancel_order_admin(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_old text; r record;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
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
end $function$;

create or replace function public.fn_admin_set_order_status(p_order_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_old text; v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  select status, user_id into v_old, v_user from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if v_old <> p_status then
    update public.orders set status = p_status, updated_at = now() where id = p_order_id;
    insert into public.order_status_history (order_id, status, actor, note)
    values (p_order_id, p_status, auth.uid(), p_reason);
  end if;
end $function$;

create or replace function public.fn_promote_vendor_level(p_vendor_id uuid, p_to_level uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare v_from uuid; v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
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
end $function$;

create or replace function public.fn_release_earnings()
returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare
  v_count integer := 0;
  v_hold_days integer;
  r record;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
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
end $function$;

create or replace function public.fn_expire_grace()
returns integer language plpgsql security definer set search_path = 'public' as $function$
declare
  v_vendor record;
  v_count  integer := 0;
  v_admins uuid[];
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_admins from public.profiles where role = 'admin';

  for v_vendor in
    select * from public.vendors
    where status = 'active'
      and verification_status = 'unverified'
      and grace_until is not null
      and grace_until < now()
  loop
    update public.vendors set verification_status = 'grace_expired' where id = v_vendor.id;
    update public.variants set is_active = false
    where product_id in (select id from public.products where vendor_id = v_vendor.id)
      and deleted_at is null;
    perform public.fn_notify(v_vendor.owner_id, 'verification.grace_expired', jsonb_build_object(
      'vendor_id', v_vendor.id, 'store_name_ar', v_vendor.store_name_ar
    ));
    for i in 1..coalesce(cardinality(v_admins), 0) loop
      perform public.fn_notify(v_admins[i], 'vendor.grace_expired', jsonb_build_object(
        'vendor_id', v_vendor.id, 'store_name_ar', v_vendor.store_name_ar
      ));
    end loop;
    insert into public.audit_logs (action, entity, entity_id, after)
    values ('vendor.grace_expired', 'vendors', v_vendor.id::text, jsonb_build_object('grace_until', v_vendor.grace_until));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;

-- fn_notify: server-side writers (triggers, RPCs) call this with no JWT, so the
-- guard only fires for a signed-in non-admin. Keeps the SQL body semantics.
create or replace function public.fn_notify(p_user uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = 'public' as $function$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  insert into public.notifications (user_id, type, payload) values (p_user, p_type, p_payload);
end $function$;

-- fn_post_transaction: the ledger writer. Reachable from admin RPCs (admin JWT)
-- and from the service/trigger path (no JWT). A signed-in non-admin must never
-- post money.
create or replace function public.fn_post_transaction(
  p_vendor_id uuid, p_type text, p_amount bigint, p_reference text,
  p_reason text, p_order_id uuid default null::uuid, p_group_id uuid default null::uuid
) returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare v_tx uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  if p_type not in ('earning','commission','pickup_fee','shipping_revenue','penalty',
                    'ad_purchase','withdrawal','withdrawal_refund','refund_clawback','admin_adjustment') then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;
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
end $function$;

commit;
