CREATE OR REPLACE FUNCTION public.fn_search_suggestions(p_q text, p_limit integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q text; v_norm text; v_products jsonb; v_stores jsonb; v_categories jsonb;
  v_lim integer := least(coalesce(p_limit, 4), 8);
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) < 2 then
    return jsonb_build_object('products', '[]', 'stores', '[]', 'categories', '[]');
  end if;
  if char_length(v_q) > 60 then
    v_q := left(v_q, 60);
  end if;
  v_norm := public.ar_norm(v_q);

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select vp.id, vp.slug_ar, vp.slug_en, vp.name_ar, vp.name_en, vp.main_image_path,
             coalesce(case when vp.has_sale then vp.min_sale_price_piastres end,
                      vp.min_price_piastres) as price_piastres
      from public.v_storefront_products vp
      where vp.min_price_piastres is not null and (
        public.fn_tsv_match(vp.id, %L)
        or public.ar_norm(vp.name_ar) like %L
        or vp.name_en ilike %L
        or vp.name_ar %% %L
        or vp.name_en %% %L
      )
      order by vp.is_featured desc, vp.rating_count desc, vp.published_at desc
      limit %s
    ) t
  $f$, v_q, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q, v_lim::text)
    into v_products;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select s.slug, s.store_name_ar as name_ar, s.store_name_en as name_en, s.logo_path
      from public.v_storefront_stores s
      where s.status = 'active' and s.product_count > 0
        and (public.ar_norm(s.store_name_ar) like %L
             or s.store_name_en ilike %L
             or s.store_name_ar %% %L
             or s.store_name_en %% %L)
      order by s.is_featured desc, s.product_count desc
      limit %s
    ) t
  $f$, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q, v_lim::text)
    into v_stores;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select c.slug_ar, c.slug_en, c.name_ar, c.name_en, c.depth
      from public.v_storefront_categories c
      where public.ar_norm(c.name_ar) like %L
         or c.name_en ilike %L
         or c.name_ar %% %L
         or c.name_en %% %L
      order by c.depth, c.sort
      limit %s
    ) t
  $f$, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q, v_lim::text)
    into v_categories;

  return jsonb_build_object('products', v_products, 'stores', v_stores, 'categories', v_categories);
end $function$
;
