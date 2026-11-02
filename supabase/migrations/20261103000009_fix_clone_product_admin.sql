-- ============================================================================
-- Fix 09 — fn_clone_product rejected admins
--
-- The function pinned ownership to vendors.owner_id = auth.uid(), which is
-- correct for the vendor panel but made the admin "clone" button fail every
-- time (admins own no store). Clone is a catalog operation the admin page
-- exposes, so admin is a legitimate caller. The vendor path is unchanged.
--
-- The body below is the LIVE definition with only that guard modified.
-- ============================================================================
begin;

CREATE OR REPLACE FUNCTION public.fn_clone_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_src     public.products%rowtype;
  v_new     public.products%rowtype;
  v_variant record;
  v_new_sku text;
  v_n       integer := 0;
  v_drift   text[] := '{}'::text[];
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_src from public.products where id = p_product_id;
  if v_src.id is null then
    raise exception 'product not found';
  end if;
  -- Admin may clone any product (the admin products page calls this); a vendor
  -- only its own. Without the is_admin() branch the admin button always failed.
  if not public.is_admin()
     and not exists (select 1 from public.vendors where id = v_src.vendor_id and owner_id = v_user) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if coalesce((public.fn_vendor_config() ->> 'allow_clone'), 'true') <> 'true' then
    raise exception 'cloning is disabled';
  end if;

  insert into public.products (
    vendor_id, leaf_category_id, brand_id, name_ar, name_en, desc_ar, desc_en, short_ar, short_en,
    is_fragile, shipping_mode, shipping_class, weight_g, dims, status, sale_starts_at, sale_ends_at
  ) values (
    v_src.vendor_id, v_src.leaf_category_id, v_src.brand_id,
    v_src.name_ar || ' (نسخة)', v_src.name_en || ' (copy)',
    v_src.desc_ar, v_src.desc_en, v_src.short_ar, v_src.short_en,
    v_src.is_fragile, v_src.shipping_mode, v_src.shipping_class, v_src.weight_g, v_src.dims,
    'draft', v_src.sale_starts_at, v_src.sale_ends_at
  ) returning * into v_new;

  update public.products set
    slug_ar = public.fn_product_slug(v_new.name_ar),
    slug_en = public.fn_product_slug(v_new.name_en)
  where id = v_new.id;

  insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
  select v_new.id, attribute_id, option_id, value_text, value_number, value_bool
  from public.product_attribute_values where product_id = v_src.id;

  insert into public.product_facets (product_id, attribute_id, option_id)
  select v_new.id, attribute_id, option_id from public.product_facets where product_id = v_src.id;

  insert into public.product_media (product_id, kind, path, position)
  select v_new.id, kind, path, position from public.product_media where product_id = v_src.id;

  insert into public.product_tags (product_id, tag_id)
  select v_new.id, tag_id from public.product_tags where product_id = v_src.id;

  for v_variant in select * from public.variants where product_id = v_src.id and deleted_at is null loop
    -- unique SKU suggestion: base-C1, -C2, ...
    v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C1';
    while exists (select 1 from public.variants where sku = v_new_sku and deleted_at is null) loop
      v_n := v_n + 1;
      v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C' || (v_n + 1)::text;
    end loop;
    v_n := 0;
    insert into public.variants (product_id, sku, option_key, option_ids, price_piastres, sale_price_piastres, stock, image_path, is_active)
    values (v_new.id, v_new_sku, v_variant.option_key, v_variant.option_ids,
            v_variant.price_piastres, v_variant.sale_price_piastres, v_variant.stock, v_variant.image_path, v_variant.is_active);
  end loop;

  -- template drift warning: attributes no longer in the current template
  select coalesce(array_agg(pav.attribute_id::text), '{}'::text[]) into v_drift
  from public.product_attribute_values pav
  where pav.product_id = v_new.id
    and not exists (
      select 1 from public.category_attributes ca
      where ca.category_id = v_new.leaf_category_id and ca.attribute_id = pav.attribute_id
    );

  return jsonb_build_object('id', v_new.id, 'name_en', v_new.name_en, 'drifted_attributes', to_jsonb(v_drift));
end $function$
;

commit;
