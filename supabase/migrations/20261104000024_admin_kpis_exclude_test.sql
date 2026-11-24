-- Dashboard money and order totals count real (live) orders only — Kashier
-- test-mode orders (orders.payment_mode = 'test') are sandbox payments.
create or replace view public.v_admin_daily_sales as
  select (d.d)::date as day,
         coalesce(sum(o.total_piastres) filter (where o.status = any (array['processing', 'completed'])), 0::bigint) as sales,
         count(o.id) as orders
    from generate_series(date_trunc('day', now()) - interval '89 days', date_trunc('day', now()), interval '1 day') d(d)
    left join public.orders o
      on o.created_at >= d.d and o.created_at < d.d + interval '1 day' and o.payment_mode = 'live'
   group by d.d
   order by d.d;

create or replace view public.v_admin_kpis as
  select
    (select count(*) from public.products where status = 'pending' and deleted_at is null) as products_awaiting,
    (select count(*) from public.vendors where status = 'pending') as vendors_awaiting,
    (select count(*) from public.withdrawal_requests where status = 'pending') as withdrawals_pending,
    (select count(*) from public.vendors where verification_status = 'submitted') as verifications_pending,
    (select coalesce(sum(total_piastres), 0::bigint) from public.orders
      where created_at >= date_trunc('day', now()) and status = any (array['processing', 'completed']) and payment_mode = 'live') as sales_today,
    (select count(*) from public.orders where created_at >= date_trunc('day', now()) and payment_mode = 'live') as orders_today,
    (select count(*) from public.profiles where status = 'active') as customers_total,
    (select count(*) from public.vendors where status = 'active') as vendors_active,
    (select coalesce(sum(g.commission_piastres), 0::bigint) from public.order_vendor_groups g
       join public.orders o on o.id = g.order_id where o.payment_mode = 'live') as commission_all_time,
    (select coalesce(sum(total_piastres), 0::bigint) from public.orders
      where status = any (array['processing', 'completed']) and payment_mode = 'live') as sales_all_time,
    (select count(*) from public.orders where payment_mode = 'live') as orders_all_time,
    (select count(*) from public.products where deleted_at is null) as products_all_time,
    (select count(*) from public.refund_requests where status = 'pending_admin') as refunds_pending;

create or replace view public.v_admin_top_vendors as
  select v.id, v.store_name_ar, v.store_name_en, v.logo_path,
         lvl.name_ar as level_name_ar, lvl.name_en as level_name_en,
         count(g.id) as orders,
         coalesce(sum(g.items_subtotal_piastres), 0::bigint) as revenue,
         coalesce(sum(g.commission_piastres), 0::bigint) as commission
    from public.vendors v
    left join public.vendor_levels lvl on lvl.id = v.level_id
    left join (public.order_vendor_groups g join public.orders o on o.id = g.order_id and o.payment_mode = 'live')
      on g.vendor_id = v.id
   group by v.id, lvl.name_ar, lvl.name_en
   order by coalesce(sum(g.items_subtotal_piastres), 0::bigint) desc
   limit 10;
