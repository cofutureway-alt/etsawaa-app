-- Storefront card: `single_variant_id` = the only live variant of a product
-- that has no options (no colour, no size). The card then offers "Add to cart"
-- directly instead of "Choose options" (nothing for the customer to pick).
-- Same view as before (20261107000015), one column appended at the end.
create or replace view public.v_storefront_products as
 SELECT p.id,
    p.slug_ar,
    p.slug_en,
    p.name_ar,
    p.name_en,
    p.short_ar,
    p.short_en,
    p.leaf_category_id,
    cat.name_ar AS category_name_ar,
    cat.name_en AS category_name_en,
    cat.slug_ar AS category_slug_ar,
    cat.slug_en AS category_slug_en,
    p.brand_id,
    b.name_ar AS brand_name_ar,
    b.name_en AS brand_name_en,
    p.vendor_id,
    v.slug AS vendor_slug,
    v.store_name_ar,
    v.store_name_en,
    v.logo_path AS vendor_logo_path,
    lvl.name_ar AS level_name_ar,
    lvl.name_en AS level_name_en,
    lvl.icon AS level_icon,
    img.path AS main_image_path,
    pr.min_price_piastres,
    pr.min_sale_price_piastres,
    pr.has_sale,
    GREATEST(COALESCE(evp.percent, 0), COALESCE(evc.percent, 0)) AS event_percent,
        CASE
            WHEN COALESCE(evp.percent, 0) >= COALESCE(evc.percent, 0) THEN evp.max_piastres
            ELSE evc.max_piastres
        END AS event_max_piastres,
    st.stock_total,
    r.rating_avg,
    r.rating_count,
    p.featured_permanent OR p.featured_until IS NOT NULL AND p.featured_until > now() OR p.featured_by_vendor AND fn_vendor_featured_slots(p.vendor_id) > 0 OR (EXISTS ( SELECT 1
           FROM ad_campaigns ac
             JOIN ad_packages ap ON ap.id = ac.package_id
          WHERE ac.product_id = p.id AND ac.status = 'active'::text AND ac.ends_at > now() AND ap.placement = 'featured_product'::text)) AS is_featured,
    p.event_hidden AS is_event_hidden,
    (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE aev.vendor_id = v.id AND aev.status = 'refused'::text)) AS vendor_event_refused,
    NOT p.event_hidden AND NOT (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE aev.vendor_id = v.id AND aev.status = 'refused'::text)) AS is_listable,
    p.published_at,
    p.created_at,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', x.id, 'hex', x.color_hex, 'label_ar', x.label_ar, 'label_en', x.label_en, 'image', x.image) ORDER BY x.sort) AS jsonb_agg
           FROM ( SELECT DISTINCT ON (g.color_option_id) o.id,
                    o.color_hex,
                    o.label_ar,
                    o.label_en,
                    g.sort,
                    ( SELECT m.path
                           FROM variant_group_media m
                          WHERE m.group_id = g.id
                          ORDER BY m."position"
                         LIMIT 1) AS image
                   FROM variant_groups g
                     JOIN attribute_options o ON o.id = g.color_option_id
                  WHERE g.product_id = p.id AND g.deleted_at IS NULL AND (EXISTS ( SELECT 1
                           FROM variants vv
                          WHERE vv.group_id = g.id AND vv.deleted_at IS NULL AND vv.is_active))
                  ORDER BY g.color_option_id, g.sort) x), '[]'::jsonb) AS colors,
    pr.min_regular_piastres,
    pr.max_discount_percent,
    COALESCE(( SELECT sum(oi.qty) AS sum
           FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND (o.status <> ALL (ARRAY['cancelled'::text, 'pending_payment'::text]))), 0::bigint)::integer AS sold_count,
    ( SELECT sv.id
           FROM variants sv
          WHERE sv.product_id = p.id AND sv.deleted_at IS NULL AND sv.is_active
            AND (SELECT count(*) FROM variants c2 WHERE c2.product_id = p.id AND c2.deleted_at IS NULL AND c2.is_active) = 1
            AND COALESCE(cardinality(sv.option_ids), 0) = 0
         LIMIT 1) AS single_variant_id
   FROM products p
     JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN categories cat ON cat.id = p.leaf_category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN vendor_levels lvl ON lvl.id = v.level_id
     LEFT JOIN LATERAL ( SELECT pm.path
           FROM product_media pm
          WHERE pm.product_id = p.id AND pm.kind = 'image'::text
          ORDER BY pm."position"
         LIMIT 1) img ON true
     LEFT JOIN LATERAL ( SELECT min(
                CASE
                    WHEN COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamp with time zone) <= now() AND v2.sale_price_piastres < v2.price_piastres AND (COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL OR COALESCE(v2.sale_ends_at, p.sale_ends_at) > now()) AND v2.sale_price_piastres IS NOT NULL THEN LEAST(v2.price_piastres, v2.sale_price_piastres)
                    ELSE v2.price_piastres
                END) AS min_price_piastres,
            min(
                CASE
                    WHEN COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamp with time zone) <= now() AND v2.sale_price_piastres < v2.price_piastres AND (COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL OR COALESCE(v2.sale_ends_at, p.sale_ends_at) > now()) AND v2.sale_price_piastres IS NOT NULL THEN v2.sale_price_piastres
                    ELSE NULL::integer
                END) AS min_sale_price_piastres,
            bool_or(COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamp with time zone) <= now() AND v2.sale_price_piastres < v2.price_piastres AND (COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL OR COALESCE(v2.sale_ends_at, p.sale_ends_at) > now()) AND v2.sale_price_piastres IS NOT NULL) AS has_sale,
            min(v2.price_piastres) AS min_regular_raw,
            (array_agg(v2.price_piastres ORDER BY (
                CASE
                    WHEN COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamp with time zone) <= now() AND v2.sale_price_piastres < v2.price_piastres AND (COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL OR COALESCE(v2.sale_ends_at, p.sale_ends_at) > now()) AND v2.sale_price_piastres IS NOT NULL THEN v2.sale_price_piastres
                    ELSE v2.price_piastres
                END), v2.price_piastres))[1] AS min_regular_piastres,
            COALESCE(max(
                CASE
                    WHEN COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamp with time zone) <= now() AND v2.sale_price_piastres < v2.price_piastres AND (COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL OR COALESCE(v2.sale_ends_at, p.sale_ends_at) > now()) AND v2.sale_price_piastres IS NOT NULL THEN round((v2.price_piastres - v2.sale_price_piastres)::numeric * 100::numeric / v2.price_piastres::numeric)
                    ELSE NULL::numeric
                END), 0::numeric)::integer AS max_discount_percent
           FROM variants v2
          WHERE v2.product_id = p.id AND v2.deleted_at IS NULL AND v2.is_active AND v2.price_piastres IS NOT NULL) pr ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(v3.stock), 0::bigint) AS stock_total
           FROM variants v3
          WHERE v3.product_id = p.id AND v3.deleted_at IS NULL AND v3.is_active) st ON true
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            count(*)::integer AS rating_count
           FROM reviews rw
          WHERE rw.product_id = p.id AND rw.status = 'published'::text) r ON true
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM v_active_event_vendors aev
             JOIN event_discounts d ON d.event_id = aev.event_id
          WHERE aev.vendor_id = p.vendor_id AND aev.status = 'accepted'::text AND d.scope = 'product'::text AND d.ref_id = p.id
          ORDER BY d.percent DESC
         LIMIT 1) evp ON true
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM v_active_event_vendors aev
             JOIN event_discounts d ON d.event_id = aev.event_id
          WHERE aev.vendor_id = p.vendor_id AND aev.status = 'accepted'::text AND d.scope = 'category'::text AND fn_category_within(p.leaf_category_id, d.ref_id)
          ORDER BY d.percent DESC
         LIMIT 1) evc ON true
  WHERE p.status = 'approved'::text AND p.deleted_at IS NULL AND v.status = 'active'::text AND v.verification_status <> 'grace_expired'::text AND NOT v.hidden_from_listings;
