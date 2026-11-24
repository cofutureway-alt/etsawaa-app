-- Admin: delete user accounts + sidebar "needs review" counters.
--
-- 1. fn_admin_delete_user(p_user, p_reason) — permanently removes an account
--    (auth.users row; profile, addresses, cart, wishlist, store … cascade).
--    Needs `users.delete` (admins always have it). Staff/admin accounts can
--    only be deleted by an admin; never yourself; never the last admin.
--    Accounts that bought something, or whose store has sales / packaging
--    orders, are refused ('has_orders' / 'store_has_orders') — order and
--    accounting history must survive, so those get banned instead.
--    "Reviewed by"-style references to the person are cleared first so the
--    delete is not blocked by history rows they merely touched. Audited.
-- 2. fn_admin_nav_counts() — pending counts per admin menu entry, only for
--    the entries the caller is allowed to open.

create or replace function public.fn_admin_delete_user(p_user uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_name text; v_email text; v_vendor uuid; v_wallet bigint;
begin
  if not (public.is_admin() or public.has_permission('users.delete')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  select role, full_name, email into v_role, v_name, v_email from public.profiles where id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_role in ('admin', 'staff') and not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_role = 'admin' and (select count(*) from public.profiles where role = 'admin' and id <> p_user) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'last_admin');
  end if;
  if exists (select 1 from public.orders where user_id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'has_orders');
  end if;
  select id into v_vendor from public.vendors where owner_id = p_user limit 1;
  if v_vendor is not null then
    if exists (select 1 from public.order_items where vendor_id = v_vendor)
       or exists (select 1 from public.order_vendor_groups where vendor_id = v_vendor)
       or exists (select 1 from public.packaging_orders where vendor_id = v_vendor)
       or exists (select 1 from public.packaging_returns where vendor_id = v_vendor) then
      return jsonb_build_object('ok', false, 'reason', 'store_has_orders');
    end if;
    select coalesce(available_piastres, 0) + coalesce(pending_piastres, 0) into v_wallet from public.wallets where vendor_id = v_vendor;
    if coalesce(v_wallet, 0) <> 0 then
      return jsonb_build_object('ok', false, 'reason', 'wallet_balance');
    end if;
    delete from public.packaging_balances where vendor_id = v_vendor;
  end if;

  -- clear "touched by" references (NO ACTION foreign keys)
  update public.vendors set reviewed_by = null where reviewed_by = p_user;
  update public.vendor_documents set reviewed_by = null where reviewed_by = p_user;
  update public.refund_requests set executed_by = null where executed_by = p_user;
  update public.refund_request_items set decided_by = null where decided_by = p_user;
  update public.withdrawal_requests set reviewed_by = null where reviewed_by = p_user;
  update public.vendor_penalties set waived_by = null where waived_by = p_user;
  update public.ad_campaigns set granted_by = null where granted_by = p_user;
  update public.vendor_level_history set actor = null where actor = p_user;
  update public.staging_templates set reviewed_by = null where reviewed_by = p_user;
  update public.vendor_status_history set actor = null where actor = p_user;
  if exists (select 1 from public.withdrawal_requests w where w.requested_by = p_user
             and (v_vendor is null or w.vendor_id <> v_vendor)) then
    return jsonb_build_object('ok', false, 'reason', 'has_history');
  end if;

  perform public.fn_audit('user.deleted', 'profiles', p_user::text,
    jsonb_build_object('role', v_role, 'full_name', v_name, 'email', v_email, 'vendor_id', v_vendor),
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')));
  delete from auth.users where id = p_user;
  return jsonb_build_object('ok', true);
exception when foreign_key_violation or not_null_violation then
  return jsonb_build_object('ok', false, 'reason', 'has_history');
end $$;

revoke all on function public.fn_admin_delete_user(uuid, text) from public, anon;
grant execute on function public.fn_admin_delete_user(uuid, text) to authenticated;

create or replace function public.fn_admin_nav_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb := '{}'::jsonb;
begin
  if public.has_permission('orders.view') then
    r := r || jsonb_build_object('orders', (select count(*) from public.orders where status = 'on_hold'));
  end if;
  if public.has_permission('refunds.view') then
    r := r || jsonb_build_object('refunds', (select count(*) from public.refund_requests where status = 'pending_admin'));
  end if;
  if public.has_permission('shipping.manage') then
    r := r || jsonb_build_object('shipping', (select count(*) from public.order_vendor_groups where vendor_ship_status = 'pending_admin'));
  end if;
  if public.has_permission('packaging.view') then
    r := r || jsonb_build_object('packaging/orders', (select count(*) from public.packaging_orders where status = 'confirmed'));
  end if;
  if public.has_permission('vendors.view') then
    r := r || jsonb_build_object('vendors', (select count(*) from public.vendors where status = 'pending' or verification_status = 'submitted'));
  end if;
  if public.has_permission('store_changes.review') then
    r := r || jsonb_build_object('store-changes', (select count(*) from public.vendor_change_requests where status = 'pending'));
  end if;
  if public.has_permission('withdrawals.view') then
    r := r || jsonb_build_object('withdrawals', (select count(*) from public.withdrawal_requests where status = 'pending'));
  end if;
  if public.has_permission('products.view') then
    r := r || jsonb_build_object('products', (select count(*) from public.products where status = 'pending' and deleted_at is null));
  end if;
  if public.has_permission('reviews.moderate') then
    r := r || jsonb_build_object('reviews', (select count(*) from public.reviews where status = 'pending'));
  end if;
  return r;
end $$;

revoke all on function public.fn_admin_nav_counts() from public, anon;
grant execute on function public.fn_admin_nav_counts() to authenticated;
