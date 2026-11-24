-- ============================================================================
-- Admin → Users & roles: actions and profile statistics
--
--   fn_admin_set_user_status   ban / unban. The old Customers page updated
--                              profiles.status directly, which RLS and the
--                              column grants refuse — banning never worked.
--                              A ban also blocks sign-in (auth.users
--                              banned_until) and ends the user's sessions.
--   fn_admin_set_vendor_hidden hide / show every product of a seller
--                              (vendors.hidden_from_listings drives
--                              v_storefront_products).
--   fn_admin_user_counts       totals per role for the page header.
--   fn_admin_vendor_overview   seller statistics + finances for the profile.
--   fn_admin_customer_overview customer statistics for the profile.
-- All admin-only (is_admin()).
-- ============================================================================
begin;

create or replace function public.fn_admin_set_user_status(p_user uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_role text; v_before text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('active', 'blocked') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  if p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  select role, status into v_role, v_before from public.profiles where id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status = 'blocked' and v_role = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active' and id <> p_user) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'last_admin');
  end if;

  update public.profiles set status = p_status, updated_at = now() where id = p_user;
  update auth.users set banned_until = case when p_status = 'blocked' then 'infinity'::timestamptz else null end where id = p_user;
  if p_status = 'blocked' then
    delete from auth.sessions where user_id = p_user;
  end if;

  perform public.fn_audit('user.' || case when p_status = 'blocked' then 'banned' else 'unbanned' end, 'profiles', p_user::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
  return jsonb_build_object('ok', true);
end
$function$;

create or replace function public.fn_admin_set_vendor_hidden(p_vendor uuid, p_hidden boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_owner uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.vendors
     set hidden_from_listings = p_hidden,
         hidden_reason = case when p_hidden then nullif(trim(coalesce(p_reason, '')), '') end,
         updated_at = now()
   where id = p_vendor
  returning owner_id into v_owner;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.fn_notify(v_owner, 'store_visibility', jsonb_build_object(
    'ar', jsonb_build_object('title', case when p_hidden then 'تم إخفاء منتجاتك' else 'منتجاتك ظاهرة مجددًا' end,
                             'body', case when p_hidden then 'أخفت الإدارة منتجات متجرك من المتجر العام' else 'أعادت الإدارة إظهار منتجات متجرك' end),
    'en', jsonb_build_object('title', case when p_hidden then 'Your products were hidden' else 'Your products are visible again' end,
                             'body', case when p_hidden then 'An admin hid your store''s products from the storefront' else 'An admin made your store''s products visible again' end),
    'link', '/vendor'));
  perform public.fn_audit(case when p_hidden then 'vendor.products_hidden' else 'vendor.products_shown' end, 'vendors', p_vendor::text,
    null, jsonb_build_object('hidden', p_hidden, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end
$function$;

create or replace function public.fn_admin_user_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object(
    'ok', true,
    'total', (select count(*) from public.profiles),
    'vendor', (select count(*) from public.profiles where role = 'vendor'),
    'customer', (select count(*) from public.profiles where role = 'customer'),
    'admin', (select count(*) from public.profiles where role = 'admin'),
    'staff', (select count(*) from public.profiles where role = 'staff'),
    'blocked', (select count(*) from public.profiles where status = 'blocked'));
end
$function$;

create or replace function public.fn_admin_vendor_overview(p_vendor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_delivered integer; v_cancelled integer; v_open integer; v_total integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select count(*) filter (where status = 'delivered'),
         count(*) filter (where status = 'cancelled'),
         count(*) filter (where status not in ('delivered', 'cancelled')),
         count(*)
    into v_delivered, v_cancelled, v_open, v_total
    from public.order_vendor_groups where vendor_id = p_vendor;
  return jsonb_build_object(
    'ok', true,
    'orders', jsonb_build_object('total', v_total, 'completed', v_delivered, 'cancelled', v_cancelled, 'pending', v_open),
    -- share of finished orders that were delivered (open orders don't count yet)
    'delivery_rate', case when v_delivered + v_cancelled = 0 then null
                          else round(100.0 * v_delivered / (v_delivered + v_cancelled), 1) end,
    'gross_sales_piastres', (select coalesce(sum(items_subtotal_piastres - discount_piastres), 0)
                               from public.order_vendor_groups where vendor_id = p_vendor and status = 'delivered'),
    'commission_piastres', (select coalesce(-sum(amount_piastres), 0) from public.wallet_transactions
                              where vendor_id = p_vendor and type = 'commission'),
    'earnings_piastres', (select coalesce(sum(amount_piastres), 0) from public.wallet_transactions
                            where vendor_id = p_vendor and type = 'earning'),
    'penalties_piastres', (select coalesce(-sum(amount_piastres), 0) from public.wallet_transactions
                             where vendor_id = p_vendor and type = 'penalty'),
    'withdrawn_piastres', (select coalesce(sum(amount_piastres), 0) from public.withdrawal_requests
                             where vendor_id = p_vendor and status = 'approved'),
    'withdrawals_pending_piastres', (select coalesce(sum(amount_piastres), 0) from public.withdrawal_requests
                                       where vendor_id = p_vendor and status = 'pending'),
    'wallet', (select jsonb_build_object('available', available_piastres, 'pending', pending_piastres)
                 from public.wallets where vendor_id = p_vendor),
    'by_type', (select coalesce(jsonb_object_agg(type, total), '{}'::jsonb) from (
                  select type, sum(amount_piastres) as total from public.wallet_transactions
                   where vendor_id = p_vendor group by type) t),
    'products', (select jsonb_build_object(
                   'approved', count(*) filter (where status = 'approved'),
                   'pending', count(*) filter (where status = 'pending'),
                   'draft', count(*) filter (where status = 'draft'),
                   'rejected', count(*) filter (where status = 'rejected'))
                   from public.products where vendor_id = p_vendor and deleted_at is null),
    'rating', (select jsonb_build_object('avg', round(avg(rating), 1), 'count', count(*))
                 from public.reviews where vendor_id = p_vendor and status = 'published'),
    'returns', (select count(distinct rr.id) from public.refund_requests rr
                  join public.order_vendor_groups g on g.order_id = rr.order_id and g.vendor_id = p_vendor),
    'commission_now', public.fn_vendor_line_commission(p_vendor, null),
    'commission_reduction', public.fn_vendor_commission_reduction(p_vendor));
end
$function$;

create or replace function public.fn_admin_customer_overview(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return (
    select jsonb_build_object(
      'ok', true,
      'orders', count(*),
      'completed', count(*) filter (where o.status = 'completed'),
      'cancelled', count(*) filter (where o.status = 'cancelled'),
      'open', count(*) filter (where o.status in ('pending_payment', 'processing', 'on_hold')),
      'spent_piastres', coalesce(sum(o.total_piastres) filter (where o.status in ('processing', 'on_hold', 'completed')), 0),
      'avg_order_piastres', coalesce(round(avg(o.total_piastres) filter (where o.status in ('processing', 'on_hold', 'completed')))::bigint, 0),
      'last_order_at', max(o.created_at),
      'returns', (select count(*) from public.refund_requests where user_id = p_user),
      'reviews', (select count(*) from public.reviews where customer_id = p_user),
      'wishlist', (select count(*) from public.wishlist_items where user_id = p_user),
      'addresses', (select count(*) from public.user_addresses where user_id = p_user))
    from public.orders o where o.user_id = p_user);
end
$function$;

revoke execute on function public.fn_admin_set_user_status(uuid, text, text) from public, anon;
revoke execute on function public.fn_admin_set_vendor_hidden(uuid, boolean, text) from public, anon;
revoke execute on function public.fn_admin_user_counts() from public, anon;
revoke execute on function public.fn_admin_vendor_overview(uuid) from public, anon;
revoke execute on function public.fn_admin_customer_overview(uuid) from public, anon;
grant execute on function public.fn_admin_set_user_status(uuid, text, text) to authenticated;
grant execute on function public.fn_admin_set_vendor_hidden(uuid, boolean, text) to authenticated;
grant execute on function public.fn_admin_user_counts() to authenticated;
grant execute on function public.fn_admin_vendor_overview(uuid) to authenticated;
grant execute on function public.fn_admin_customer_overview(uuid) to authenticated;

commit;
