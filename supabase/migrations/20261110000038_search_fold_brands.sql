-- One shared search fold for every surface (storefront views, RPCs, brand
-- directory), brand initial-letter columns, random-but-stable product order,
-- and brand suggestions. Applied as one file by the runner.

-- 1. ar_norm: the live definition plus waw/yaa hamza, standalone hamza,
--    Arabic-Indic + Persian digits and whitespace collapsing.
create or replace function public.ar_norm(txt text)
 returns text
 language sql
 immutable parallel safe
as $function$
  select btrim(regexp_replace(
    replace(replace(replace(replace(replace(
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(txt, '')),
            '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
          '[ًٌٍَُِّْٰـ]', '', 'g'),
        '[أإآٱ]', 'ا', 'g'),
      'ؤ', 'و'), 'ئ', 'ي'), 'ى', 'ي'), 'ة', 'ه'), 'ء', ''),
    '\s+', ' ', 'g'))
$function$;

-- 2. token match: every folded query token must appear in the folded haystack.
--    position() instead of LIKE so a visitor's % / _ stay literal.
create or replace function public.fn_search_match(p_hay text, p_q text)
 returns boolean
 language sql
 immutable parallel safe
as $function$
  select not exists (
    select 1
    from regexp_split_to_table(public.ar_norm(p_q), '\s+') as t(token)
    where t.token <> ''
      and position(t.token in public.ar_norm(coalesce(p_hay, ''))) = 0
  )
$function$;

grant execute on function public.fn_search_match(text, text) to anon, authenticated;

-- 3. brands view: same live columns, then the three filter-only columns.
create or replace view public.v_storefront_brands as
 SELECT b.id,
    b.slug_ar,
    b.slug_en,
    b.name_ar,
    b.name_en,
    b.thumb_path,
    b.sort,
    COALESCE(pc.product_count, 0) AS product_count,
    b.description_ar,
    b.description_en,
    b.country_ar,
    b.country_en,
    b.founded_year,
    COALESCE(bc.category_ids, '{}'::uuid[]) AS category_ids,
    COALESCE(bc.root_category_ids, '{}'::uuid[]) AS root_category_ids,
    public.ar_norm(b.name_ar || ' ' || b.name_en) AS search_norm,
    left(public.ar_norm(b.name_ar), 1) AS letter_ar,
    CASE
      WHEN left(btrim(b.name_en), 1) ~ '[0-9]' THEN '#'
      ELSE upper(left(btrim(b.name_en), 1))
    END AS letter_en
   FROM brands b
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS product_count
           FROM products p
          WHERE p.brand_id = b.id AND p.status = 'approved'::text AND p.deleted_at IS NULL) pc ON true
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT c.id) AS category_ids,
            array_agg(DISTINCT split_part(c.path, '/'::text, 1)::uuid) AS root_category_ids
           FROM brand_categories x
             JOIN categories c ON c.id = x.category_id AND c.deleted_at IS NULL AND c.is_active
          WHERE x.brand_id = b.id) bc ON true
  WHERE b.is_active AND b.deleted_at IS NULL;

grant select on public.v_storefront_brands to anon, authenticated;

-- 4. product search: 12th param p_seed, folded multi-column text match, and
--    "recommended" = featured first, then a stable md5 shuffle.
drop function if exists public.fn_search_products(text, uuid, uuid, jsonb, integer, integer, numeric, boolean, text, integer, integer);

CREATE OR REPLACE FUNCTION public.fn_search_products(
  p_q text DEFAULT NULL::text,
  p_category uuid DEFAULT NULL::uuid,
  p_brand uuid DEFAULT NULL::uuid,
  p_attrs jsonb DEFAULT NULL::jsonb,
  p_price_min integer DEFAULT NULL::integer,
  p_price_max integer DEFAULT NULL::integer,
  p_rating numeric DEFAULT NULL::numeric,
  p_in_stock boolean DEFAULT NULL::boolean,
  p_sort text DEFAULT 'recommended'::text,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 24,
  p_seed text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q text;
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
  v_seed text;
  v_recommended_order text;
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) > 80 then
    v_q := left(v_q, 80);
  end if;

  -- an unvalidated seed never reaches the ORDER BY text
  if coalesce(p_seed, '') ~ '^[a-z0-9]{1,16}$' then
    v_seed := p_seed;
  else
    v_seed := null;
  end if;
  v_recommended_order := 'is_featured desc, md5(id::text || '
    || quote_literal(coalesce(nullif(v_seed, ''), to_char(now(), 'YYYYMMDDHH24'))) || ')';

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
    v_where := v_where || format($q$
      and (
        public.fn_search_match(concat_ws(' ', name_ar, name_en, brand_name_ar, brand_name_en,
          category_name_ar, category_name_en, store_name_ar, store_name_en), %L)
        or public.fn_tsv_match(id, %L)
        or name_ar %% %L
        or name_en %% %L
      )$q$, v_q, v_q, v_q, v_q);
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
    when 'recommended' then v_recommended_order
    when 'newest'     then 'is_featured desc, published_at desc nulls last'
    when 'price_asc'  then v_event_price_expr || ' asc nulls last, published_at desc'
    when 'price_desc' then v_event_price_expr || ' desc nulls last, published_at desc'
    when 'rating'     then 'rating_avg desc nulls last, rating_count desc, published_at desc'
    when 'best_selling' then 'sold_count desc, rating_avg desc nulls last, published_at desc'
    when 'discount'   then 'max_discount_percent desc, published_at desc'
    else v_recommended_order
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
  -- brands: base minus the brand filter, logo included for the facet dropdown
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select brand_id as id, brand_name_ar as name_ar, brand_name_en as name_en,
             (select b.thumb_path from public.brands b where b.id = brand_id) as thumb_path,
             count(*)::int as count
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
end $function$;

revoke all on function public.fn_search_products(text, uuid, uuid, jsonb, integer, integer, numeric, boolean, text, integer, integer, text) from public;
grant execute on function public.fn_search_products(text, uuid, uuid, jsonb, integer, integer, numeric, boolean, text, integer, integer, text) to anon, authenticated;

-- 5. suggestions: folded multi-column matches + a brands group.
CREATE OR REPLACE FUNCTION public.fn_search_suggestions(p_q text, p_limit integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q text; v_products jsonb; v_stores jsonb; v_categories jsonb; v_brands jsonb;
  v_lim integer := least(coalesce(p_limit, 4), 8);
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) < 2 then
    return jsonb_build_object('products', '[]', 'stores', '[]', 'categories', '[]', 'brands', '[]');
  end if;
  if char_length(v_q) > 60 then
    v_q := left(v_q, 60);
  end if;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select vp.id, vp.slug_ar, vp.slug_en, vp.name_ar, vp.name_en, vp.main_image_path,
             coalesce(case when vp.has_sale then vp.min_sale_price_piastres end,
                      vp.min_price_piastres) as price_piastres
      from public.v_storefront_products vp
      where vp.min_price_piastres is not null and (
        public.fn_search_match(concat_ws(' ', vp.name_ar, vp.name_en, vp.brand_name_ar, vp.brand_name_en,
          vp.category_name_ar, vp.category_name_en, vp.store_name_ar, vp.store_name_en), %L)
        or public.fn_tsv_match(vp.id, %L)
        or vp.name_ar %% %L
        or vp.name_en %% %L
      )
      order by vp.is_featured desc, vp.rating_count desc, vp.published_at desc
      limit %s
    ) t
  $f$, v_q, v_q, v_q, v_q, v_lim::text)
    into v_products;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select s.slug, s.store_name_ar as name_ar, s.store_name_en as name_en, s.logo_path
      from public.v_storefront_stores s
      where s.status = 'active' and s.product_count > 0
        and (public.fn_search_match(concat_ws(' ', s.store_name_ar, s.store_name_en), %L)
             or s.store_name_ar %% %L
             or s.store_name_en %% %L)
      order by s.is_featured desc, s.product_count desc
      limit %s
    ) t
  $f$, v_q, v_q, v_q, v_lim::text)
    into v_stores;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select c.slug_ar, c.slug_en, c.name_ar, c.name_en, c.depth
      from public.v_storefront_categories c
      where public.fn_search_match(concat_ws(' ', c.name_ar, c.name_en), %L)
         or c.name_ar %% %L
         or c.name_en %% %L
      order by c.depth, c.sort
      limit %s
    ) t
  $f$, v_q, v_q, v_q, v_lim::text)
    into v_categories;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select b.slug_ar, b.slug_en, b.name_ar, b.name_en, b.thumb_path
      from public.v_storefront_brands b
      where public.fn_search_match(concat_ws(' ', b.name_ar, b.name_en), %L)
      order by b.product_count desc, b.name_en
      limit %s
    ) t
  $f$, v_q, v_lim::text)
    into v_brands;

  return jsonb_build_object('products', v_products, 'stores', v_stores, 'categories', v_categories, 'brands', v_brands);
end $function$;

notify pgrst, 'reload schema';
