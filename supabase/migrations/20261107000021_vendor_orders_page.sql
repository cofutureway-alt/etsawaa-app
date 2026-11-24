-- Seller → Orders: one call per page view.
-- Before: own_vendor_id() → fn_vendor_orders_list() (EVERY order the store
-- ever had, unbounded, filtered by status/search in Node) → order_items →
-- order_documents, all sequential. Now: filtering, search and pagination run
-- in SQL and the page's lines and print history come back embedded.
-- SECURITY DEFINER scoped to own_vendor_id(), exactly like the old list.

create or replace function public.fn_vendor_orders_page(
  p_status text default null,
  p_q text default null,
  p_page int default 1,
  p_per_page int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vendor uuid := public.own_vendor_id();
  v_q text := nullif(lower(btrim(coalesce(p_q, ''))), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_limit int := least(greatest(coalesce(p_per_page, 30), 1), 100);
  v_offset int := (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_per_page, 30), 1), 100);
  v_total int;
  v_groups jsonb;
  v_items jsonb;
  v_docs jsonb;
begin
  if v_vendor is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vendor');
  end if;

  -- one pass: filter + sort + page, with the filtered total as a window count
  with page_rows as (
    select g.id, g.status, g.shipping_mode, g.vendor_ship_status, g.items_subtotal_piastres,
           g.discount_piastres, g.commission_piastres, g.shipped_at, g.delivered_at,
           g.cancel_reason, g.created_at,
           o.id as o_id, o.number, o.status as o_status, o.payment_method, o.payment_status,
           o.ship_name, o.total_piastres, o.created_at as o_created_at,
           count(*) over () as total
      from public.order_vendor_groups g
      join public.orders o on o.id = g.order_id
     where g.vendor_id = v_vendor
       and (v_status is null or g.status = v_status)
       and (v_q is null or lower(o.number) like '%' || v_q || '%' or lower(coalesce(o.ship_name, '')) like '%' || v_q || '%')
     order by g.created_at desc
     offset v_offset limit v_limit
  )
  select coalesce(max(total), 0)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'status', status,
           'shipping_mode', shipping_mode, 'vendor_ship_status', vendor_ship_status,
           'items_subtotal_piastres', items_subtotal_piastres,
           'discount_piastres', discount_piastres,
           'commission_piastres', commission_piastres,
           'shipped_at', shipped_at, 'delivered_at', delivered_at,
           'cancel_reason', cancel_reason, 'created_at', created_at,
           'order', jsonb_build_object(
             'id', o_id, 'number', number, 'status', o_status,
             'payment_method', payment_method, 'payment_status', payment_status,
             'ship_name', ship_name, 'total_piastres', total_piastres,
             'created_at', o_created_at)
         ) order by created_at desc), '[]'::jsonb)
    into v_total, v_groups
    from page_rows;
  -- a page past the end still reports the real total
  if v_total = 0 and v_offset > 0 then
    select count(*)::int into v_total
      from public.order_vendor_groups g join public.orders o on o.id = g.order_id
     where g.vendor_id = v_vendor
       and (v_status is null or g.status = v_status)
       and (v_q is null or lower(o.number) like '%' || v_q || '%' or lower(coalesce(o.ship_name, '')) like '%' || v_q || '%');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'group_id', i.group_id, 'product_name_ar', i.product_name_ar, 'product_name_en', i.product_name_en,
      'option_key', i.option_key, 'qty', i.qty, 'line_total_piastres', i.line_total_piastres,
      'coupon_discount_piastres', i.coupon_discount_piastres)), '[]'::jsonb)
    into v_items
    from public.order_items i
   where i.group_id in (select (e->>'id')::uuid from jsonb_array_elements(v_groups) e);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'order_id', d.order_id, 'doc_type', d.doc_type, 'copies', d.copies, 'created_at', d.created_at)
      order by d.created_at desc), '[]'::jsonb)
    into v_docs
    from public.order_documents d
   where d.order_id in (select (e->'order'->>'id')::uuid from jsonb_array_elements(v_groups) e);

  return jsonb_build_object('ok', true, 'total', v_total, 'page', greatest(coalesce(p_page, 1), 1),
    'per_page', v_limit, 'groups', v_groups, 'items', v_items, 'docs', v_docs);
end;
$$;

revoke all on function public.fn_vendor_orders_page(text, text, int, int) from public, anon;
grant execute on function public.fn_vendor_orders_page(text, text, int, int) to authenticated;
