-- PHASE 06 — earnings wiring: when the last needed group hits delivered /
-- all groups resolve, post the delivered groups' earnings (pending) into the
-- wallet. Idempotent per group (fn_post_earnings keyed on group+type).
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
  v_pickup jsonb;
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
  if v_vendor_is_actor and not public.is_admin() then
    -- the vendor walks the allowed fulfillment ladder only (phase 06)
    if v_group.shipping_mode = 'vendor' and v_group.vendor_ship_status in ('pending_admin','not_required','rejected')
       and p_status in ('handed_to_carrier','out_for_delivery','delivered') then
      return jsonb_build_object('ok', false, 'reason',
        case when v_group.vendor_ship_status = 'pending_admin' then 'awaiting_admin_approval' else 'vendor_ship_not_approved' end);
    end if;
    if p_status = 'cancelled' then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if not (
      (v_group.status = 'pending' and p_status = 'preparing')
      or (v_group.status = 'preparing' and p_status = 'handed_to_carrier')
      or (v_group.status = 'handed_to_carrier' and p_status = 'out_for_delivery')
      or (v_group.status = 'out_for_delivery' and p_status = 'delivered')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition',
        'from', v_group.status, 'to', p_status);
    end if;
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

  -- pickup fee exactly once at ship time (any actor; idempotent)
  if p_status = 'handed_to_carrier' then
    v_pickup := public.fn_post_pickup_fee(p_group_id);
    if not coalesce((v_pickup->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'pickup_failed', 'detail', v_pickup->>'reason');
    end if;
  end if;

  -- earnings (pending) post when the group is delivered
  if p_status = 'delivered' then
    perform public.fn_post_earnings(p_group_id);
  end if;

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
    update public.orders set status = 'completed', delivered_at = coalesce(delivered_at, now()), updated_at = now()
      where id = v_order.id and status <> 'completed';
    update public.orders set delivered_at = now() where id = v_order.id and delivered_at is null;
    -- customer notification (bilingual payload, F-17 shape)
    perform public.fn_notify(v_order.user_id, 'order_completed', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم تسليم طلبك', 'body', 'طلب ' || v_order.number || ' اكتمل — نشكرك!'),
      'en', jsonb_build_object('title', 'Order delivered', 'body', 'Order ' || v_order.number || ' is complete — thank you!'),
      'link', '/ar/account/orders/' || v_order.number));
  elsif v_all_cancelled then
    update public.orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id;
  end if;

  if p_status = 'delivered' then
    perform public.fn_notify(v_order.user_id, 'order_delivered', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم التسليم', 'body', 'تم تسليم جزء من طلب ' || v_order.number),
      'en', jsonb_build_object('title', 'Delivered', 'body', 'Part of your order ' || v_order.number || ' was delivered'),
      'link', '/ar/account/orders/' || v_order.number));
  end if;

  return jsonb_build_object('ok', true);
end $$;
