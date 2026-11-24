-- Admin dashboard v2: every money/statistics figure for a chosen period in one
-- round trip, each compared with the period just before it. Admins only —
-- staff never reach this function (the page shows them the work queue only).
--
-- "Sales" = live orders that are not cancelled and not waiting for payment
-- (processing / on_hold / completed). Test-mode payments are excluded.

create or replace function public.fn_admin_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_to    timestamptz := now();
  v_from  timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_pfrom timestamptz := v_from - make_interval(days => v_days);
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed: admins only' using errcode = '42501';
  end if;

  with
  o as (
    select * from public.orders where payment_mode = 'live' and created_at >= v_pfrom
  ),
  sold as (
    select * from o where status in ('processing', 'on_hold', 'completed')
  ),
  per as (
    select p.k,
           count(*) filter (where s.id is not null)                         as orders_paid,
           coalesce(sum(s.total_piastres), 0)                               as gmv,
           coalesce(sum(s.discount_piastres), 0)                            as discounts,
           count(distinct s.user_id)                                        as buyers
      from (values ('cur', v_from, v_to), ('prev', v_pfrom, v_from)) p(k, a, b)
      left join sold s on s.created_at >= p.a and s.created_at < p.b
     group by p.k
  ),
  allord as (
    select p.k, count(o.id) as orders_all,
           count(o.id) filter (where o.status = 'cancelled') as cancelled
      from (values ('cur', v_from, v_to), ('prev', v_pfrom, v_from)) p(k, a, b)
      left join o on o.created_at >= p.a and o.created_at < p.b
     group by p.k
  ),
  comm as (
    select p.k, coalesce(sum(g.commission_piastres), 0) as commission
      from (values ('cur', v_from, v_to), ('prev', v_pfrom, v_from)) p(k, a, b)
      left join sold s on s.created_at >= p.a and s.created_at < p.b
      left join public.order_vendor_groups g on g.order_id = s.id and g.status is distinct from 'cancelled'
     group by p.k
  ),
  ppl as (
    select p.k,
           (select count(*) from public.profiles x where x.role = 'customer' and x.created_at >= p.a and x.created_at < p.b) as new_customers,
           (select count(*) from public.vendors v where v.created_at >= p.a and v.created_at < p.b) as new_vendors,
           (select count(*) from public.products x where x.deleted_at is null and x.published_at >= p.a and x.published_at < p.b) as new_products,
           (select coalesce(sum(r.refund_total_piastres), 0) from public.refund_requests r where r.created_at >= p.a and r.created_at < p.b) as refunds_amount,
           (select count(*) from public.refund_requests r where r.created_at >= p.a and r.created_at < p.b) as refunds_count
      from (values ('cur', v_from, v_to), ('prev', v_pfrom, v_from)) p(k, a, b)
  ),
  kp as (
    select jsonb_object_agg(per.k, jsonb_build_object(
             'gmv', per.gmv, 'orders', allord.orders_all, 'orders_paid', per.orders_paid,
             'aov', case when per.orders_paid > 0 then round(per.gmv::numeric / per.orders_paid) else 0 end,
             'commission', comm.commission, 'discounts', per.discounts, 'buyers', per.buyers,
             'cancelled', allord.cancelled,
             'new_customers', ppl.new_customers, 'new_vendors', ppl.new_vendors, 'new_products', ppl.new_products,
             'refunds_amount', ppl.refunds_amount, 'refunds_count', ppl.refunds_count)) as j
      from per join allord using (k) join comm using (k) join ppl using (k)
  ),
  series as (
    select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'sales', coalesce(x.sales, 0), 'orders', coalesce(x.orders, 0)) order by d), '[]'::jsonb) as j
      from generate_series(date_trunc('day', v_from), date_trunc('day', v_to), interval '1 day') d
      left join lateral (
        select sum(s.total_piastres) filter (where s.status in ('processing', 'on_hold', 'completed')) as sales,
               count(*) as orders
          from o s where s.created_at >= d and s.created_at < d + interval '1 day'
      ) x on true
  ),
  by_status as (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) as j
      from (select status, count(*) n from o where created_at >= v_from group by status) t
  ),
  by_pay as (
    select coalesce(jsonb_agg(jsonb_build_object('method', payment_method, 'orders', n, 'amount', amt) order by amt desc), '[]'::jsonb) as j
      from (select payment_method, count(*) n, sum(total_piastres) amt from sold where created_at >= v_from group by payment_method) t
  ),
  top_cats as (
    select coalesce(jsonb_agg(jsonb_build_object('name_ar', c.name_ar, 'name_en', c.name_en, 'revenue', t.rev, 'units', t.units) order by t.rev desc), '[]'::jsonb) as j
      from (
        select split_part(lc.path, '/', 1)::uuid root, sum(i.line_total_piastres) rev, sum(i.qty) units
          from public.order_items i
          join sold s on s.id = i.order_id and s.created_at >= v_from
          join public.categories lc on lc.id = i.leaf_category_id
         group by 1 order by 2 desc limit 6
      ) t join public.categories c on c.id = t.root
  ),
  top_vendors as (
    select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'slug', v.slug, 'name_ar', v.store_name_ar, 'name_en', v.store_name_en, 'logo', v.logo_path,
             'orders', t.orders, 'revenue', t.rev, 'commission', t.comm) order by t.rev desc), '[]'::jsonb) as j
      from (
        select g.vendor_id, count(distinct g.order_id) orders, sum(g.items_subtotal_piastres) rev, sum(g.commission_piastres) comm
          from public.order_vendor_groups g join sold s on s.id = g.order_id and s.created_at >= v_from
         where g.status is distinct from 'cancelled'
         group by 1 order by 3 desc limit 5
      ) t join public.vendors v on v.id = t.vendor_id
  ),
  top_products as (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.product_id, 'name_ar', t.name_ar, 'name_en', t.name_en, 'image', t.image, 'units', t.units, 'revenue', t.rev) order by t.units desc, t.rev desc), '[]'::jsonb) as j
      from (
        select i.product_id, max(i.product_name_ar) name_ar, max(i.product_name_en) name_en, max(i.image_path) image,
               sum(i.qty) units, sum(i.line_total_piastres) rev
          from public.order_items i join sold s on s.id = i.order_id and s.created_at >= v_from
         group by 1 order by 5 desc, 6 desc limit 5
      ) t
  ),
  recent as (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'number', number, 'name', ship_name, 'total', total_piastres, 'status', status,
             'payment_method', payment_method, 'payment_status', payment_status, 'created_at', created_at) order by created_at desc), '[]'::jsonb) as j
      from (select * from public.orders where payment_mode = 'live' order by created_at desc limit 6) t
  ),
  catalog as (
    select jsonb_build_object(
      'approved', count(*) filter (where status = 'approved'),
      'pending',  count(*) filter (where status = 'pending'),
      'draft',    count(*) filter (where status = 'draft'),
      'rejected', count(*) filter (where status = 'rejected'),
      'out_of_stock', (select count(*) from public.v_storefront_products vp where vp.is_listable and vp.stock_total <= 0),
      'low_stock',    (select count(*) from public.v_storefront_products vp where vp.is_listable and vp.stock_total between 1 and 3),
      'listed',       (select count(*) from public.v_storefront_products vp where vp.is_listable and vp.min_price_piastres is not null)
    ) as j
      from public.products where deleted_at is null
  ),
  totals as (
    select jsonb_build_object(
      'customers', (select count(*) from public.profiles where role = 'customer' and status = 'active'),
      'vendors_active', (select count(*) from public.vendors where status = 'active'),
      'vendors_pending', (select count(*) from public.vendors where status = 'pending'),
      'gmv_all', (select coalesce(sum(total_piastres), 0) from public.orders where payment_mode = 'live' and status in ('processing', 'on_hold', 'completed')),
      'commission_all', (select coalesce(sum(g.commission_piastres), 0) from public.order_vendor_groups g join public.orders x on x.id = g.order_id
                          where x.payment_mode = 'live' and x.status in ('processing', 'on_hold', 'completed') and g.status is distinct from 'cancelled'),
      'withdrawals_pending', (select count(*) from public.withdrawal_requests where status = 'pending'),
      'withdrawals_pending_amount', (select coalesce(sum(amount_piastres), 0) from public.withdrawal_requests where status = 'pending'),
      'repeat_buyers', (select count(*) from (select user_id from public.orders where payment_mode = 'live' and user_id is not null
                          and status in ('processing', 'on_hold', 'completed') group by user_id having count(*) > 1) r),
      'all_buyers', (select count(distinct user_id) from public.orders where payment_mode = 'live' and user_id is not null
                          and status in ('processing', 'on_hold', 'completed'))
    ) as j
  )
  select jsonb_build_object(
    'days', v_days, 'from', v_from, 'to', v_to,
    'kpis', (select j from kp), 'series', (select j from series), 'by_status', (select j from by_status),
    'by_payment', (select j from by_pay), 'top_categories', (select j from top_cats),
    'top_vendors', (select j from top_vendors), 'top_products', (select j from top_products),
    'recent_orders', (select j from recent), 'catalog', (select j from catalog), 'totals', (select j from totals)
  ) into v_out;
  return v_out;
end $$;

revoke all on function public.fn_admin_dashboard(integer) from public, anon;
grant execute on function public.fn_admin_dashboard(integer) to authenticated;

notify pgrst, 'reload schema';
