-- ============================================================================
-- Etsawaa — Phase 03 patch: drafts may lack a category until step 2;
-- archive RPC for the product list (V-18); submit validates the category.
-- ============================================================================

alter table public.products alter column leaf_category_id drop not null;


-- Template membership helper: a def belongs to a leaf either directly
-- (attribute_defs.category_id — the phase-02 model) or via category_attributes.
create or replace function public.fn_attr_in_template(p_attribute uuid, p_leaf uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.category_attributes ca
    where ca.category_id = p_leaf and ca.attribute_id = p_attribute
  ) or exists (
    select 1 from public.attribute_defs ad
    where ad.id = p_attribute and ad.category_id = p_leaf and ad.deleted_at is null
  );
$$;

-- fn_submit_product completeness: the leaf category is required to submit
create or replace function public.fn_submit_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_product public.products%rowtype;
  v_vendor  public.vendors%rowtype;
  v_config  jsonb := public.fn_vendor_config();
  v_target  text;
  v_missing text[] := '{}'::text[];
  v_attr    record;
  v_is_leaf boolean;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then
    raise exception 'product not found';
  end if;
  select * into v_vendor from public.vendors where id = v_product.vendor_id;
  if v_vendor.owner_id <> v_user then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is not submittable in status %', v_product.status;
  end if;

  -- selling gate (grace expiry / suspension blocks publish at API level)
  if not public.vendor_can_sell(v_vendor.id) then
    raise exception 'selling is blocked for this store (% / %)', v_vendor.status, v_vendor.verification_status
      using errcode = 'P0001';
  end if;

  -- completeness validation
  if coalesce(v_product.name_ar, '') = '' or coalesce(v_product.name_en, '') = '' then
    v_missing := v_missing || 'name';
  end if;
  if v_product.leaf_category_id is null then
    v_missing := v_missing || 'category';
  else
    select not exists (
      select 1 from public.categories c where c.parent_id = v_product.leaf_category_id and c.deleted_at is null
    ) into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be a leaf category';
    end if;
  end if;
  if not exists (select 1 from public.product_media where product_id = v_product.id) then
    v_missing := v_missing || 'media';
  end if;
  if not exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and sku is not null and price_piastres is not null and price_piastres > 0
  ) then
    v_missing := v_missing || 'variants';
  end if;
  if exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and (sku is null or price_piastres is null or price_piastres <= 0)
  ) then
    v_missing := v_missing || 'variants_incomplete';
  end if;
  for v_attr in
    select ad.code from public.attribute_defs ad
    where ad.is_required and ad.deleted_at is null
      and not ad.is_variant_axis -- axis attrs live in the variant combos
      and public.fn_attr_in_template(ad.id, v_product.leaf_category_id)
      and not exists (
        select 1 from public.product_attribute_values pav
        where pav.product_id = v_product.id and pav.attribute_id = ad.id
      )
  loop
    v_missing := v_missing || ('attribute:' || v_attr.code);
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'product is incomplete: %', array_to_string(v_missing, ', ');
  end if;

  if coalesce(v_config ->> 'review_required', 'true') = 'true' then
    v_target := 'pending';
  else
    v_target := 'approved';
  end if;

  update public.products set
    status = v_target,
    rejection_reason = null,
    submitted_at = now(),
    published_at = case when v_target = 'approved' then now() else null end
  where id = v_product.id
  returning * into v_product;

  if v_target = 'pending' then
    perform public.fn_notify(a.id, 'product.pending', jsonb_build_object(
      'product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
      'vendor', v_vendor.store_name_ar
    ))
    from public.profiles a where a.role = 'admin';
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'product.submit', 'products', v_product.id::text, jsonb_build_object('status', v_target));

  return jsonb_build_object('status', v_target);
end $$;

revoke all on function public.fn_submit_product(uuid) from public, anon;
grant execute on function public.fn_submit_product(uuid) to authenticated;

-- fn_save_product: accept a null leaf category while drafting
create or replace function public.fn_save_product(p_product jsonb, p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_vendor    uuid;
  v_product   public.products%rowtype;
  v_is_new    boolean := p_id is null;
  v_cat       uuid := nullif(p_product ->> 'leaf_category_id', '')::uuid;
  v_is_leaf   boolean;
  v_attr      record;
  v_val       jsonb;
  v_opt       uuid;
  v_specs     jsonb := '{}'::jsonb;
  v_media     jsonb;
  v_i         integer;
  v_sale_s    timestamptz;
  v_sale_e    timestamptz;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select id into v_vendor from public.vendors where owner_id = v_user;
  if v_vendor is null then
    raise exception 'not allowed: no store' using errcode = '42501';
  end if;

  if v_is_new then
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;
  else
    select * into v_product from public.products where id = p_id and vendor_id = v_vendor;
    if v_product.id is null then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
    if v_product.status not in ('draft', 'rejected') then
      raise exception 'product is locked in status %', v_product.status;
    end if;
  end if;

  -- category: must be an active leaf
  if v_cat is not null then
    select not exists (select 1 from public.categories c where c.parent_id = v_cat and c.deleted_at is null)
      and exists (select 1 from public.categories c where c.id = v_cat and c.is_active and c.deleted_at is null)
      into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be an active leaf category';
    end if;
  end if;
  if coalesce(p_product ->> 'brand_id', '') <> ''
     and not exists (select 1 from public.brands where id = (p_product ->> 'brand_id')::uuid and deleted_at is null) then
    raise exception 'brand not found';
  end if;

  v_sale_s := nullif(p_product ->> 'sale_starts_at', '')::timestamptz;
  v_sale_e := nullif(p_product ->> 'sale_ends_at', '')::timestamptz;
  if v_sale_s is not null and v_sale_e is not null and v_sale_e <= v_sale_s then
    raise exception 'sale schedule end must be after the start';
  end if;

  update public.products set
    name_ar  = coalesce(p_product ->> 'name_ar',  v_product.name_ar),
    name_en  = coalesce(p_product ->> 'name_en',  v_product.name_en),
    desc_ar  = coalesce(p_product ->> 'desc_ar',  v_product.desc_ar),
    desc_en  = coalesce(p_product ->> 'desc_en',  v_product.desc_en),
    short_ar = coalesce(p_product ->> 'short_ar', v_product.short_ar),
    short_en = coalesce(p_product ->> 'short_en', v_product.short_en),
    leaf_category_id = coalesce(v_cat, v_product.leaf_category_id),
    brand_id = coalesce(nullif(p_product ->> 'brand_id', '')::uuid, v_product.brand_id),
    is_fragile = coalesce((p_product ->> 'is_fragile')::boolean, v_product.is_fragile),
    shipping_mode = coalesce(p_product ->> 'shipping_mode', v_product.shipping_mode),
    shipping_class = coalesce(p_product ->> 'shipping_class', v_product.shipping_class),
    weight_g = coalesce((p_product ->> 'weight_g')::int, v_product.weight_g),
    dims = coalesce(p_product -> 'dims', v_product.dims),
    sale_starts_at = coalesce(v_sale_s, v_product.sale_starts_at),
    sale_ends_at = coalesce(v_sale_e, v_product.sale_ends_at)
  where id = v_product.id
  returning * into v_product;

  if coalesce(v_product.slug_ar, '') = '' and coalesce(v_product.name_ar, '') <> '' then
    update public.products set slug_ar = public.fn_product_slug(v_product.name_ar) where id = v_product.id;
  end if;
  if coalesce(v_product.slug_en, '') = '' and coalesce(v_product.name_en, '') <> '' then
    update public.products set slug_en = public.fn_product_slug(v_product.name_en) where id = v_product.id;
  end if;

  if p_product ? 'attributes' then
    delete from public.product_attribute_values where product_id = v_product.id;
    for v_val in select * from jsonb_array_elements(coalesce(p_product -> 'attributes', '[]'::jsonb)) loop
      select * into v_attr from public.attribute_defs
        where id = (v_val ->> 'attribute_id')::uuid and deleted_at is null;
      if v_attr.id is null then
        raise exception 'attribute % not found', v_val ->> 'attribute_id';
      end if;
      if v_product.leaf_category_id is null
         or not public.fn_attr_in_template(v_attr.id, v_product.leaf_category_id) then
        raise exception 'attribute % does not belong to the product category', v_attr.code;
      end if;
      v_opt := nullif(v_val ->> 'option_id', '')::uuid;
      if v_attr.type in ('enum', 'color') then
        if v_opt is null or not exists (
          select 1 from public.attribute_options where id = v_opt and attribute_id = v_attr.id and deleted_at is null
        ) then
          raise exception 'value for % must come from the admin options', v_attr.code;
        end if;
      end if;
      insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
      values (
        v_product.id, v_attr.id, v_opt,
        nullif(v_val ->> 'value_text', ''),
        nullif(v_val ->> 'value_number', '')::numeric,
        nullif(v_val ->> 'value_bool', '')::boolean
      );
    end loop;

    delete from public.product_facets where product_id = v_product.id;
    insert into public.product_facets (product_id, attribute_id, option_id)
    select v_product.id, pav.attribute_id, pav.option_id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;

    select coalesce(jsonb_object_agg(ad.code, jsonb_build_object(
      'type', ad.type,
      'unit', ad.unit,
      'value', case
        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)
        when ad.type = 'number' then to_jsonb(pav.value_number)
        when ad.type = 'bool' then to_jsonb(pav.value_bool)
        else to_jsonb(pav.value_text) end
    )), '{}'::jsonb)
    into v_specs
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    left join public.attribute_options ao on ao.id = pav.option_id
    where pav.product_id = v_product.id;
    update public.products set specs = v_specs where id = v_product.id;
  end if;

  if p_product ? 'media' then
    delete from public.product_media where product_id = v_product.id;
    v_i := 0;
    for v_media in select * from jsonb_array_elements(coalesce(p_product -> 'media', '[]'::jsonb)) loop
      insert into public.product_media (product_id, kind, path, position)
      values (v_product.id, coalesce(v_media ->> 'kind', 'image'), v_media ->> 'path', v_i);
      v_i := v_i + 1;
    end loop;
  end if;

  if p_product ? 'tag_ids' then
    delete from public.product_tags where product_id = v_product.id;
    insert into public.product_tags (product_id, tag_id)
    select v_product.id, value::uuid
    from jsonb_array_elements_text(coalesce(p_product -> 'tag_ids', '[]'::jsonb)) value
    where exists (select 1 from public.tags where id = value::uuid and deleted_at is null);
  end if;

  if coalesce((p_product -> 'apply_defaults')::boolean, false) then
    update public.variants set
      price_piastres = coalesce(nullif(p_product ->> 'default_price_piastres', '')::int, price_piastres),
      sale_price_piastres = coalesce(nullif(p_product ->> 'default_sale_piastres', '')::int, sale_price_piastres)
    where product_id = v_product.id and deleted_at is null;
  end if;

  select * into v_product from public.products where id = v_product.id;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, case when v_is_new then 'product.create' else 'product.update' end, 'products', v_product.id::text,
          jsonb_build_object('status', v_product.status, 'name_ar', v_product.name_ar));

  return jsonb_build_object(
    'id', v_product.id,
    'slug_ar', v_product.slug_ar,
    'slug_en', v_product.slug_en,
    'status', v_product.status,
    'updated_at', v_product.updated_at
  );
end $$;

revoke all on function public.fn_save_product(jsonb, uuid) from public, anon;
grant execute on function public.fn_save_product(jsonb, uuid) to authenticated;

-- ============================================================================
-- RPC: fn_archive_product — soft archive from the product list (V-18)
-- ============================================================================
create or replace function public.fn_archive_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id and v.owner_id = v_user and p.deleted_at is null
  ) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  update public.products set deleted_at = now() where id = p_product_id;
  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'product.archive', 'products', p_product_id::text, jsonb_build_object('archived', true));
  return jsonb_build_object('archived', true);
end $$;

revoke all on function public.fn_archive_product(uuid) from public, anon;
grant execute on function public.fn_archive_product(uuid) to authenticated;
