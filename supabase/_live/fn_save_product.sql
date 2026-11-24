CREATE OR REPLACE FUNCTION public.fn_save_product(p_product jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_opts      uuid[];
  v_allowed   uuid[];
  v_media     jsonb;
  v_i         integer;
  v_sale_s    timestamptz;
  v_sale_e    timestamptz;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select id into v_vendor from public.vendors where owner_id = v_user;
  if v_vendor is null then
    raise exception 'not allowed: no store' using errcode = '42501';
  end if;

  if v_is_new and exists (select 1 from public.vendors where id = v_vendor and status = 'pending') then
    raise exception 'vendor_under_review: the store is still under review' using errcode = 'P0001';
  end if;
  if v_is_new then
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;
  else
    select * into v_product from public.products where id = p_id and vendor_id = v_vendor;
    if v_product.id is null then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
    if v_product.rejected_final then
      raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
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
  if (case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end) is not null
     and coalesce(v_cat, v_product.leaf_category_id) is not null
     and exists (select 1 from public.brand_categories x
                  where x.brand_id = (case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end))
     and not exists (
       select 1 from public.brand_categories x
         join public.categories c on c.id = coalesce(v_cat, v_product.leaf_category_id)
        where x.brand_id = (case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end)
          and (c.id = x.category_id or c.path like '%' || x.category_id::text || '%')) then
    raise exception 'brand_not_in_category';
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
    brand_id = case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end,
    is_fragile = coalesce((p_product ->> 'is_fragile')::boolean, v_product.is_fragile),
    shipping_mode = coalesce(p_product ->> 'shipping_mode', v_product.shipping_mode),
    shipping_class = coalesce(p_product ->> 'shipping_class', v_product.shipping_class),
    weight_g = coalesce((p_product ->> 'weight_g')::int, v_product.weight_g),
    dims = coalesce(p_product -> 'dims', v_product.dims),
    size_chart = case when p_product ? 'size_chart' then nullif(p_product -> 'size_chart', 'null'::jsonb) else v_product.size_chart end,
    sale_starts_at = coalesce(v_sale_s, v_product.sale_starts_at),
    sale_ends_at = coalesce(v_sale_e, v_product.sale_ends_at)
  where id = v_product.id
  returning * into v_product;

  -- some categories ship with the platform only (settings.shipping_rules) — shipping-rule
  if v_product.shipping_mode = 'vendor' and public.fn_vendor_shipping_blocked(v_product.leaf_category_id) then
    update public.products set shipping_mode = 'platform' where id = v_product.id returning * into v_product;
  end if;

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
      -- option_ids (multi) or option_id (single); de-duplicated, order kept
      select coalesce(array_agg(x.id order by x.ord), '{}'::uuid[]) into v_opts
        from (select distinct on (e.v) nullif(e.v, '')::uuid id, e.ord
                from jsonb_array_elements_text(
                       case when jsonb_typeof(v_val -> 'option_ids') = 'array' then v_val -> 'option_ids'
                            when coalesce(v_val ->> 'option_id', '') <> '' then jsonb_build_array(v_val ->> 'option_id')
                            else '[]'::jsonb end) with ordinality e(v, ord)
               where nullif(e.v, '') is not null
               order by e.v, e.ord) x;
      v_opt := v_opts[1];
      if v_attr.type in ('enum', 'color') then
        if cardinality(v_opts) = 0 then
          continue; -- nothing chosen: no row (required specs are checked on submit)
        end if;
        if cardinality(v_opts) > 1 and not v_attr.is_multi then
          raise exception 'attribute % accepts a single option', v_attr.code;
        end if;
        if exists (
          select 1 from unnest(v_opts) o(id)
           where not exists (select 1 from public.attribute_options ao
                              where ao.id = o.id and ao.attribute_id = v_attr.id and ao.deleted_at is null)
        ) then
          raise exception 'value for % must come from the admin options', v_attr.code;
        end if;
        -- category scope: only the options the admin allowed for this category
        select ca.allowed_option_ids into v_allowed from public.category_attributes ca
         where ca.category_id = v_product.leaf_category_id and ca.attribute_id = v_attr.id;
        if v_allowed is not null and not (v_opts <@ v_allowed) then
          raise exception 'value for % is not offered in this category', v_attr.code;
        end if;
      else
        v_opts := null;
        if nullif(v_val ->> 'value_text', '') is null and nullif(v_val ->> 'value_number', '') is null
           and nullif(v_val ->> 'value_bool', '') is null then
          continue; -- empty free-text / number: no row
        end if;
      end if;
      insert into public.product_attribute_values (product_id, attribute_id, option_id, option_ids, value_text, value_number, value_bool)
      values (
        v_product.id, v_attr.id, v_opt, case when v_opt is null then null else v_opts end,
        nullif(v_val ->> 'value_text', ''),
        nullif(v_val ->> 'value_number', '')::numeric,
        nullif(v_val ->> 'value_bool', '')::boolean
      );
    end loop;

    delete from public.product_facets where product_id = v_product.id;
    insert into public.product_facets (product_id, attribute_id, option_id)
    select distinct v_product.id, pav.attribute_id, o.id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    cross join lateral unnest(coalesce(pav.option_ids, array[pav.option_id])) o(id)
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;

    select coalesce(jsonb_object_agg(ad.code, jsonb_build_object(
      'type', ad.type,
      'unit', ad.unit,
      'value', case
        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)
          || case when ad.is_multi then jsonb_build_object('values', (
               select coalesce(jsonb_agg(jsonb_build_object('option_id', mo.id, 'label_ar', mo.label_ar,
                        'label_en', mo.label_en, 'color_hex', mo.color_hex) order by t.ord), '[]'::jsonb)
                 from unnest(coalesce(pav.option_ids, array[pav.option_id])) with ordinality t(id, ord)
                 join public.attribute_options mo on mo.id = t.id)) else '{}'::jsonb end
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
      values (v_product.id, coalesce(v_media ->> 'kind', 'image'), v_media ->> 'path', v_i)
      on conflict (product_id, path) do nothing; -- dedupe-media
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
end $function$
;
