CREATE OR REPLACE FUNCTION public.fn_search_products(p_q text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_brand uuid DEFAULT NULL::uuid, p_attrs jsonb DEFAULT NULL::jsonb, p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_rating numeric DEFAULT NULL::numeric, p_in_stock boolean DEFAULT NULL::boolean, p_sort text DEFAULT 'newest'::text, p_page integer DEFAULT 1, p_per_page integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q text;
  v_norm text;
  v_cat_path text;
  v_total integer := 0;
  v_where_core text;
  v_items jsonb;
  v_facet_brands jsonb;
  v_facet_categories jsonb;
  v_facet_attrs jsonb;
  v_where text;
  v_cat_cond text := '';
  v_brand_cond text := '';
  v_price_cond text := '';
  v_rating_cond text := '';
  v_stock_cond text := '';
  v_attr_cond text := '';
  v_price_expr text := 'coalesce(case when has_sale then min_sale_price_piastres end, min_price_piastres)';
  v_event_price_expr text := 'case when event_percent > 0 then least('
    || v_price_expr || ' - (' || v_price_expr || ' * event_percent / 100),'
    || ' coalesce(event_max_piastres, 9223372036854775807)) else '
    || v_price_expr || ' end';
  v_attrs jsonb := coalesce(p_attrs, '[]'::jsonb);
  v_attr_elem jsonb;
  v_off integer := greatest(coalesce(p_page, 1) - 1, 0) * least(coalesce(p_per_page, 24), 60);
  v_limit integer := least(coalesce(p_per_page, 24), 60);
  v_order text;
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) > 80 then
    v_q := left(v_q, 80);
  end if;
  v_norm := public.ar_norm(v_q);

  if p_category is not null then
    select path into v_cat_path from public.categories where id = p_category;
    if v_cat_path is null then
      return jsonb_build_object('total', 0, 'page', greatest(coalesce(p_page,1),1), 'per_page', v_limit,
        'items', '[]'::jsonb, 'facets', jsonb_build_object());
    end if;
  end if;

  v_where_core := ' min_price_piastres is not null and is_listable';
  v_where := v_where_core;

  if v_q <> '' then
    v_where := v_where || format(' and (
      public.fn_tsv_match(id, %L)
      or public.ar_norm(name_ar) like %L
      or name_en ilike %L
      or name_ar %% %L
      or name_en %% %L
    )', v_q, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q);
  end if;
  if p_category is not null then
    v_cat_cond := format(
      ' (leaf_category_id = %L::uuid or exists (
         select 1 from public.categories sc
         where sc.id = leaf_category_id and sc.path like %L))',
      p_category::text, v_cat_path || '/%');
    v_where := v_where || ' and' || v_cat_cond;
  end if;
  if p_brand is not null then
    v_brand_cond := format(' and brand_id = %L::uuid', p_brand::text);
    v_where := v_where || v_brand_cond;
  end if;
  if p_price_min is not null or p_price_max is not null then
    if p_price_min is not null then
      v_price_cond := v_price_cond || format(' %s >= %s', v_price_expr, p_price_min::text);
    end if;
    if p_price_max is not null then
      v_price_cond := v_price_cond || (case when v_price_cond <> '' then ' and' else '' end)
        || format(' %s <= %s', v_price_expr, p_price_max::text);
    end if;
    v_where := v_where || ' and' || v_price_cond;
  end if;
  if p_rating is not null and p_rating >= 1 then
    v_rating_cond := format(' (rating_avg >= %s and rating_count > 0)', p_rating::text);
    v_where := v_where || ' and' || v_rating_cond;
  end if;
  if coalesce(p_in_stock, false) then
    v_stock_cond := ' stock_total > 0';
    v_where := v_where || ' and' || v_stock_cond;
  end if;

  -- attribute facet conditions: every selected attribute must have ≥1 match
  for v_attr_elem in select * from jsonb_array_elements(v_attrs) loop
    if jsonb_typeof(v_attr_elem->'option_ids') = 'array'
       and jsonb_array_length(v_attr_elem->'option_ids') > 0 then
      v_attr_cond := v_attr_cond || format(
        ' exists (select 1 from public.product_facets pf
           where pf.product_id = id and pf.attribute_id = %L::uuid
             and pf.option_id::text = any(array(select jsonb_array_elements_text(%L))))',
        v_attr_elem->>'attribute_id', v_attr_elem->'option_ids');
    end if;
  end loop;
  if v_attr_cond <> '' then
    v_attr_cond := ' and' || v_attr_cond;
    v_where := v_where || v_attr_cond;
  end if;

  execute 'select count(*) from public.v_storefront_products where' || v_where into v_total;

  v_order := case p_sort
    when 'price_asc'  then v_event_price_expr || ' asc nulls last, published_at desc'
    when 'price_desc' then v_event_price_expr || ' desc nulls last, published_at desc'
    when 'rating'     then 'rating_avg desc nulls last, rating_count desc, published_at desc'
    when 'best_selling' then 'sold_count desc, rating_avg desc nulls last, published_at desc'
    when 'discount'   then 'max_discount_percent desc, published_at desc'
    else 'is_featured desc, published_at desc nulls last'
  end;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*) order by %s), '[]'::jsonb)
    from (
      select vp.*, %s as event_price_piastres
      from public.v_storefront_products vp
      where%s
      order by %s offset %s limit %s
    ) t
  $f$, v_order, v_event_price_expr, v_where, v_order, v_off::text, v_limit::text)
    into v_items;

  -- ---- facets -------------------------------------------------------------
  -- brands: base minus the brand filter
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select brand_id as id, brand_name_ar as name_ar, brand_name_en as name_en, count(*)::int as count
      from public.v_storefront_products
      where%s
      group by brand_id, brand_name_ar, brand_name_en
      having brand_id is not null
    ) f
  $f$, v_where_core || v_attr_cond)
    into v_facet_brands;

  -- categories: children of the current node (or level-1 roots), unfiltered
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select sc.id, sc.name_ar as name_ar, sc.name_en as name_en, sc.slug_ar, sc.slug_en,
             count(vp.id)::int as count
      from (%s) sc
      left join public.v_storefront_products vp
        on vp.min_price_piastres is not null and vp.is_listable
       and (vp.leaf_category_id = sc.id
            or exists (select 1 from public.categories dsc
                       where dsc.id = vp.leaf_category_id and dsc.path like sc.path || '/%%'))
      group by sc.id, sc.name_ar, sc.name_en, sc.slug_ar, sc.slug_en
    ) f
  $f$,
    case when p_category is null
      then 'select * from public.v_storefront_categories where depth = 1'
      else format('select * from public.categories c where c.is_active and c.deleted_at is null and c.parent_id = %L::uuid', p_category::text)
    end
  ) into v_facet_categories;

  -- attribute options: defs effective for the scope; counts on the base
  -- minus ALL attribute filters (stable counts while multi-selecting)
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.attribute_sort, f.option_sort), '[]'::jsonb)
    from (
      select distinct fd.attribute_id, fd.code, fd.label_ar, fd.label_en, fd.type, fd.unit, fd.sort as attribute_sort,
             fo.option_id, fo.label_ar as option_label_ar, fo.label_en as option_label_en,
             fo.color_hex, fo.sort as option_sort, coalesce(fc.count, 0)::int as count
      from (select distinct fd.attribute_id, fd.code, fd.label_ar, fd.label_en, fd.type, fd.unit, fd.sort from public.v_storefront_facet_defs fd where %2$s) fd
      join public.v_storefront_facet_options fo on fo.attribute_id = fd.attribute_id
      left join (
        select pf.attribute_id, pf.option_id, count(*)::int as count
        from public.product_facets pf
        where exists (
          select 1 from public.v_storefront_products vp2
          where vp2.id = pf.product_id and (%1$s)
        )
        group by pf.attribute_id, pf.option_id
      ) fc on fc.attribute_id = fd.attribute_id and fc.option_id = fo.option_id
      where true
    ) f
  $f$,
    v_where_core || v_brand_cond,
    case when p_category is null then 'true' else
      format('(fd.leaf_category_id = %L::uuid or exists (
        select 1 from public.categories sc2
        where sc2.id = fd.leaf_category_id and sc2.path like %L))',
        p_category::text, v_cat_path || '/%')
    end
  ) into v_facet_attrs;

  return jsonb_build_object(
    'total', v_total,
    'page', greatest(coalesce(p_page, 1), 1),
    'per_page', v_limit,
    'items', coalesce(v_items, '[]'::jsonb),
    'facets', jsonb_build_object(
      'brands', coalesce(v_facet_brands, '[]'::jsonb),
      'categories', coalesce(v_facet_categories, '[]'::jsonb),
      'attributes', coalesce(v_facet_attrs, '[]'::jsonb)
    )
  );
end $function$
;
