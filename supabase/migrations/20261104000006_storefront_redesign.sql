-- ============================================================================
-- Storefront redesign support
--   * categories.icon — icon-library key shown in the hero panel / mega menu
--     (images, categories.thumb_path, are shown in the "All categories" row).
--   * brands.description_ar/en — shown on the brand page, edited in admin.
--   * "featured" now also means "promoted by an active ad campaign":
--       products — an active campaign on a featured_product package for it;
--       stores   — vendors.is_featured / featured_permanent / featured_until,
--                  or any active campaign of the store.
--     Regular products/stores keep is_featured = false, so they are never
--     labelled as featured.
-- ============================================================================
begin;

alter table public.categories add column if not exists icon text;
alter table public.brands
  add column if not exists description_ar text not null default '',
  add column if not exists description_en text not null default '';

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
            WHEN (COALESCE(evp.percent, 0) >= COALESCE(evc.percent, 0)) THEN evp.max_piastres
            ELSE evc.max_piastres
        END AS event_max_piastres,
    st.stock_total,
    r.rating_avg,
    r.rating_count,
    (p.featured_permanent OR ((p.featured_until IS NOT NULL) AND (p.featured_until > now())) OR (p.featured_by_vendor AND (fn_vendor_featured_slots(p.vendor_id) > 0)) OR (EXISTS ( SELECT 1
           FROM (ad_campaigns ac
             JOIN ad_packages ap ON ((ap.id = ac.package_id)))
          WHERE ((ac.product_id = p.id) AND (ac.status = 'active'::text) AND (ac.ends_at > now()) AND (ap.placement = 'featured_product'::text))))) AS is_featured,
    p.event_hidden AS is_event_hidden,
    (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))) AS vendor_event_refused,
    ((NOT p.event_hidden) AND (NOT (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))))) AS is_listable,
    p.published_at,
    p.created_at
   FROM ((((((((((products p
     JOIN vendors v ON ((v.id = p.vendor_id)))
     LEFT JOIN categories cat ON ((cat.id = p.leaf_category_id)))
     LEFT JOIN brands b ON ((b.id = p.brand_id)))
     LEFT JOIN vendor_levels lvl ON ((lvl.id = v.level_id)))
     LEFT JOIN LATERAL ( SELECT pm.path
           FROM product_media pm
          WHERE ((pm.product_id = p.id) AND (pm.kind = 'image'::text))
          ORDER BY pm."position"
         LIMIT 1) img ON (true))
     LEFT JOIN LATERAL ( SELECT min(
                CASE
                    WHEN ((p.sale_starts_at IS NOT NULL) AND (p.sale_starts_at <= now()) AND ((p.sale_ends_at IS NULL) OR (p.sale_ends_at > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN LEAST(v2.price_piastres, v2.sale_price_piastres)
                    ELSE v2.price_piastres
                END) AS min_price_piastres,
            min(
                CASE
                    WHEN ((p.sale_starts_at IS NOT NULL) AND (p.sale_starts_at <= now()) AND ((p.sale_ends_at IS NULL) OR (p.sale_ends_at > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN v2.sale_price_piastres
                    ELSE NULL::integer
                END) AS min_sale_price_piastres,
            bool_or(((p.sale_starts_at IS NOT NULL) AND (p.sale_starts_at <= now()) AND ((p.sale_ends_at IS NULL) OR (p.sale_ends_at > now())) AND (v2.sale_price_piastres IS NOT NULL))) AS has_sale,
            min(v2.price_piastres) AS min_regular_piastres
           FROM variants v2
          WHERE ((v2.product_id = p.id) AND (v2.deleted_at IS NULL) AND v2.is_active AND (v2.price_piastres IS NOT NULL))) pr ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(v3.stock), (0)::bigint) AS stock_total
           FROM variants v3
          WHERE ((v3.product_id = p.id) AND (v3.deleted_at IS NULL) AND v3.is_active)) st ON (true))
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            (count(*))::integer AS rating_count
           FROM reviews rw
          WHERE ((rw.product_id = p.id) AND (rw.status = 'published'::text))) r ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'product'::text) AND (d.ref_id = p.id))
          ORDER BY d.percent DESC
         LIMIT 1) evp ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'category'::text) AND fn_category_within(p.leaf_category_id, d.ref_id))
          ORDER BY d.percent DESC
         LIMIT 1) evc ON (true))
  WHERE ((p.status = 'approved'::text) AND (p.deleted_at IS NULL) AND (v.status = 'active'::text) AND (v.verification_status <> 'grace_expired'::text) AND (NOT v.hidden_from_listings));

create or replace view public.v_storefront_stores as
SELECT v.id,
    v.slug,
    v.store_name_ar,
    v.store_name_en,
    v.short_desc_ar,
    v.short_desc_en,
    v.logo_path,
    v.banner_path,
    v.status,
    (v.is_featured OR v.featured_permanent OR ((v.featured_until IS NOT NULL) AND (v.featured_until > now())) OR (EXISTS ( SELECT 1
           FROM ad_campaigns ac
          WHERE ((ac.vendor_id = v.id) AND (ac.status = 'active'::text) AND (ac.ends_at > now()))))) AS is_featured,
    v.hidden_from_listings,
    ((v.status = 'active'::text) AND (NOT v.hidden_from_listings)) AS is_listable,
    v.category_ids,
    lvl.name_ar AS level_name_ar,
    lvl.name_en AS level_name_en,
    lvl.icon AS level_icon,
    r.rating_avg,
    r.rating_count,
    pc.product_count,
    aev.event_id AS refused_event_id,
    aev.name_ar AS refused_event_name_ar,
    aev.name_en AS refused_event_name_en,
    lvl.color AS level_color
   FROM ((((vendors v
     LEFT JOIN vendor_levels lvl ON ((lvl.id = v.level_id)))
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            (count(*))::integer AS rating_count
           FROM reviews rw
          WHERE ((rw.vendor_id = v.id) AND (rw.status = 'published'::text))) r ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS product_count
           FROM products p
          WHERE ((p.vendor_id = v.id) AND (p.status = 'approved'::text) AND (p.deleted_at IS NULL))) pc ON (true))
     LEFT JOIN v_active_event_vendors aev ON (((aev.vendor_id = v.id) AND (aev.status = 'refused'::text))))
  WHERE (v.status = ANY (ARRAY['active'::text, 'suspended'::text]));

create or replace view public.v_storefront_categories as
SELECT id,
    parent_id,
    depth,
    path,
    slug_ar,
    slug_en,
    name_ar,
    name_en,
    description_ar,
    description_en,
    thumb_path,
    sort,
    icon
   FROM categories c
  WHERE (is_active AND (deleted_at IS NULL));

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
    b.description_en
   FROM (brands b
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS product_count
           FROM products p
          WHERE ((p.brand_id = b.id) AND (p.status = 'approved'::text) AND (p.deleted_at IS NULL))) pc ON (true))
  WHERE (b.is_active AND (b.deleted_at IS NULL));

commit;
