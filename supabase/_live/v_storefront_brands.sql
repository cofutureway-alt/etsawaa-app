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
    COALESCE(bc.root_category_ids, '{}'::uuid[]) AS root_category_ids
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
-- reloptions: none
-- grants: postgres:TRIGGER, postgres:REFERENCES, postgres:TRUNCATE, postgres:DELETE, postgres:UPDATE, postgres:SELECT, postgres:INSERT, authenticated:TRIGGER, authenticated:REFERENCES, authenticated:SELECT, anon:TRIGGER, anon:REFERENCES, anon:SELECT, service_role:TRIGGER, service_role:REFERENCES, service_role:TRUNCATE, service_role:DELETE, service_role:UPDATE, service_role:SELECT, service_role:INSERT
