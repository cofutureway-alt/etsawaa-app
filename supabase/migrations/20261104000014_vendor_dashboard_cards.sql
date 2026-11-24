-- ============================================================================
-- Seller dashboard cards — one call, own store only
--
--   categories  the store's categories with the commission % that applies
--               to this seller (overrides → fixed mode → category → level)
--   low_stock   child-level: each colour + size with stock ≤ threshold
--   best        best sellers by units (cancelled groups excluded)
--   unsold      published ≥ N days ago and no sale in the last N days
-- ============================================================================
begin;

create or replace function public.fn_vendor_dashboard_cards(p_low_stock int default 5, p_unsold_days int default 10)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
  v_low int := greatest(0, least(coalesce(p_low_stock, 5), 1000));
  v_days int := greatest(1, least(coalesce(p_unsold_days, 10), 365));
begin
  select * into v_vendor from public.vendors where owner_id = auth.uid();
  if v_vendor.id is null then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object(
    'ok', true,
    'low_threshold', v_low,
    'unsold_days', v_days,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en,
               'percent', round(public.fn_vendor_line_commission(v_vendor.id, c.id), 2)) order by c.sort, c.name_ar)
      from public.categories c
      where c.id = any(coalesce(v_vendor.category_ids, '{}')) and c.deleted_at is null
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(x order by (x->>'stock')::int, x->>'name_ar')
      from (
        select jsonb_build_object('variant_id', v.id, 'product_id', p.id, 'name_ar', p.name_ar, 'name_en', p.name_en,
                 'sku', v.sku, 'stock', v.stock,
                 'color_ar', co.label_ar, 'color_en', co.label_en, 'color_hex', co.color_hex,
                 'size_ar', so.label_ar, 'size_en', so.label_en,
                 'image', coalesce(
                   (select m.path from public.variant_group_media m where m.group_id = g.id order by m.position limit 1),
                   (select pm.path from public.product_media pm where pm.product_id = p.id and pm.kind = 'image' order by pm.position limit 1))) as x
        from public.variants v
        join public.products p on p.id = v.product_id
        left join public.variant_groups g on g.id = v.group_id
        left join public.attribute_options co on co.id = g.color_option_id
        left join public.attribute_options so on so.id = v.size_option_id
        where p.vendor_id = v_vendor.id and p.deleted_at is null and p.status in ('approved', 'pending')
          and v.deleted_at is null and g.deleted_at is null and v.stock <= v_low
        order by v.stock, p.name_ar
        limit 12
      ) s
    ), '[]'::jsonb),
    'low_stock_total', (
      select count(*) from public.variants v join public.products p on p.id = v.product_id
      left join public.variant_groups g on g.id = v.group_id
      where p.vendor_id = v_vendor.id and p.deleted_at is null and p.status in ('approved', 'pending')
        and v.deleted_at is null and g.deleted_at is null and v.stock <= v_low),
    'best', coalesce((
      select jsonb_agg(b order by (b->>'units')::int desc)
      from (
        select jsonb_build_object('product_id', i.product_id,
                 'name_ar', max(i.product_name_ar), 'name_en', max(i.product_name_en),
                 'units', sum(i.qty), 'revenue_piastres', sum(i.line_total_piastres),
                 'image', (select pm.path from public.product_media pm where pm.product_id = i.product_id and pm.kind = 'image' order by pm.position limit 1)) as b
        from public.order_items i
        join public.order_vendor_groups og on og.id = i.group_id
        where i.vendor_id = v_vendor.id and og.status <> 'cancelled'
        group by i.product_id
        order by sum(i.qty) desc
        limit 5
      ) s
    ), '[]'::jsonb),
    'unsold', coalesce((
      select jsonb_agg(u order by u->>'published_at')
      from (
        select jsonb_build_object('product_id', p.id, 'name_ar', p.name_ar, 'name_en', p.name_en, 'published_at', p.published_at,
                 'days', extract(day from now() - p.published_at)::int,
                 'image', (select pm.path from public.product_media pm where pm.product_id = p.id and pm.kind = 'image' order by pm.position limit 1)) as u
        from public.products p
        where p.vendor_id = v_vendor.id and p.status = 'approved' and p.deleted_at is null
          and p.published_at <= now() - make_interval(days => v_days)
          and not exists (
            select 1 from public.order_items i join public.order_vendor_groups og on og.id = i.group_id
            where i.product_id = p.id and og.status <> 'cancelled' and i.created_at > now() - make_interval(days => v_days))
        order by p.published_at
        limit 6
      ) s
    ), '[]'::jsonb),
    'unsold_total', (
      select count(*) from public.products p
      where p.vendor_id = v_vendor.id and p.status = 'approved' and p.deleted_at is null
        and p.published_at <= now() - make_interval(days => v_days)
        and not exists (
          select 1 from public.order_items i join public.order_vendor_groups og on og.id = i.group_id
          where i.product_id = p.id and og.status <> 'cancelled' and i.created_at > now() - make_interval(days => v_days)))
  );
end $$;

revoke all on function public.fn_vendor_dashboard_cards(int, int) from public, anon;
grant execute on function public.fn_vendor_dashboard_cards(int, int) to authenticated;

commit;
