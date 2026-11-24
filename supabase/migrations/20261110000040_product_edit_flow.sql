-- Product edit flow:
--  * sellers may always save/submit their product; pending/approved are pulled
--    back to draft automatically on the first save (race-safe with a review
--    decision made at the same time)
--  * staff holding products.edit may edit any seller's product without
--    touching its status, and the store owner is notified (with a reason)
--  * the review decision can carry the submitted_at it was based on, so a
--    decision on a version the seller already replaced is refused as "stale"

-- ---------------------------------------------------------------- fn_save_product
create or replace function public.fn_save_product(p_product jsonb, p_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user      uuid := auth.uid();
  v_vendor    uuid;
  v_product   public.products%rowtype;
  v_is_new    boolean := p_id is null;
  v_is_admin  boolean := false;
  v_was_live  boolean := false;
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
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;

  if v_is_new then
    -- a suspended store can look but not act (enforced here, not only in the UI)
    perform public.fn_assert_my_store_operational();
    select id into v_vendor from public.vendors where owner_id = v_user;
    if v_vendor is null then
      raise exception 'not allowed: no store' using errcode = '42501';
    end if;
    if exists (select 1 from public.vendors where id = v_vendor and status = 'pending') then
      raise exception 'vendor_under_review: the store is still under review' using errcode = 'P0001';
    end if;
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;
  else
    select * into v_product from public.products where id = p_id and deleted_at is null;
    if v_product.id is null then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
    select id into v_vendor from public.vendors where id = v_product.vendor_id and owner_id = v_user;
    if v_vendor is null then
      -- staff editing someone else's product: no status change, no store gate
      if not public.has_permission('products.edit') then
        raise exception 'not allowed: product not found' using errcode = '42501';
      end if;
      v_is_admin := true;
      v_vendor := v_product.vendor_id;
    else
      -- a suspended store can look but not act (enforced here, not only in the UI)
      perform public.fn_assert_my_store_operational();
      if v_product.rejected_final then
        raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
      end if;
      -- under review or live: the first change pulls it back to draft so the
      -- seller never hits a lock when a reviewer decided at the same moment
      if v_product.status in ('pending', 'approved') then
        v_was_live := v_product.status = 'approved';
        update public.products
           set status = 'draft', submitted_at = null, published_at = null
         where id = v_product.id
         returning * into v_product;
        insert into public.audit_logs (actor, action, entity, entity_id, after)
        values (v_user, 'product.reopened', 'products', v_product.id::text,
                jsonb_build_object('status', 'draft', 'auto', true, 'was_live', v_was_live));
      elsif v_product.status not in ('draft', 'rejected') then
        raise exception 'product is locked in status %', v_product.status;
      end if;
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
  values (v_user, case when v_is_new then 'product.create' when v_is_admin then 'product.admin_update' else 'product.update' end,
          'products', v_product.id::text,
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

-- --------------------------------------------------------------- fn_save_children
create or replace function public.fn_save_children(p_product_id uuid, p_children jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_owner uuid;
  v_was_live boolean := false;
  c jsonb; s jsonb; img text;
  v_group uuid; v_variant uuid;
  v_keep_groups uuid[] := '{}'; v_keep_variants uuid[] := '{}';
  v_keys text[] := '{}';
  v_key text; v_ids uuid[]; v_sku text; v_color_code text; v_size_code text; v_i integer;
  v_price integer; v_sale integer; v_s0 timestamptz; v_s1 timestamptz;
  v_d0 timestamptz; v_d1 timestamptz; v_ram_code text;
  v_rprice integer; v_rsale integer; v_rs0 timestamptz; v_rs1 timestamptz;
  v_prefix text;
begin
  if v_user is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.* into v_product from public.products p
   where p.id = p_product_id and p.deleted_at is null;
  if v_product.id is null then raise exception 'not allowed: product not found' using errcode = '42501'; end if;
  select owner_id into v_owner from public.vendors where id = v_product.vendor_id;
  if v_owner is distinct from v_user then
    -- staff editing someone else's product: no status change, no store gate
    if not public.has_permission('products.edit') then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
  else
    -- a suspended store can look but not act (enforced here, not only in the UI)
    perform public.fn_assert_my_store_operational();
    if v_product.rejected_final then
      raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
    end if;
    if v_product.status in ('pending', 'approved') then
      v_was_live := v_product.status = 'approved';
      update public.products
         set status = 'draft', submitted_at = null, published_at = null
       where id = v_product.id
       returning * into v_product;
      insert into public.audit_logs (actor, action, entity, entity_id, after)
      values (v_user, 'product.reopened', 'products', v_product.id::text,
              jsonb_build_object('status', 'draft', 'auto', true, 'was_live', v_was_live));
    elsif v_product.status not in ('draft', 'rejected') then
      raise exception 'product is locked in status %', v_product.status;
    end if;
  end if;
  v_prefix := 'ET-' || upper(substr(replace(p_product_id::text, '-', ''), 1, 6));

  for c in select * from jsonb_array_elements(coalesce(p_children, '[]'::jsonb)) loop
    v_price := nullif(c->>'price_piastres', '')::integer;
    v_sale := nullif(c->>'sale_price_piastres', '')::integer;
    if v_price is not null and v_price <= 0 then raise exception 'price must be positive'; end if;
    if v_sale is not null and (v_price is null or v_sale >= v_price) then
      raise exception 'sale price must be lower than the price';
    end if;
    v_s0 := nullif(c->>'sale_starts_at', '')::timestamptz;
    v_s1 := nullif(c->>'sale_ends_at', '')::timestamptz;
    -- the window as typed (rows with their own sale price use it too)
    v_d0 := v_s0; v_d1 := v_s1;
    -- a discount with no start date starts now
    if v_sale is not null and v_s0 is null then v_s0 := now(); end if;
    if v_sale is null then v_s0 := null; v_s1 := null; end if;
    if v_s0 is not null and v_s1 is not null and v_s1 <= v_s0 then
      raise exception 'sale schedule end must be after the start';
    end if;

    v_group := nullif(c->>'id', '')::uuid;
    if v_group is not null and not exists (select 1 from public.variant_groups where id = v_group and product_id = p_product_id) then
      v_group := null;
    end if;
    if v_group is null then
      insert into public.variant_groups (product_id) values (p_product_id) returning id into v_group;
    end if;
    update public.variant_groups set
      color_option_id = nullif(c->>'color_option_id', '')::uuid,
      price_piastres = v_price, sale_price_piastres = v_sale,
      sale_starts_at = v_s0, sale_ends_at = v_s1,
      sort = coalesce(array_length(v_keep_groups, 1), 0), deleted_at = null
    where id = v_group;
    v_keep_groups := v_keep_groups || v_group;

    delete from public.variant_group_media where group_id = v_group;
    v_i := 0;
    for img in select jsonb_array_elements_text(coalesce(c->'images', '[]'::jsonb)) loop
      insert into public.variant_group_media (group_id, path, position) values (v_group, img, v_i)
        on conflict (group_id, path) do nothing; -- dedupe-media
      v_i := v_i + 1;
      exit when v_i >= 12;
    end loop;

    select coalesce(upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g')), '')
      into v_color_code from public.attribute_options o where o.id = nullif(c->>'color_option_id', '')::uuid;

    for s in select * from jsonb_array_elements(case when jsonb_array_length(coalesce(c->'sizes', '[]'::jsonb)) = 0
                                                    then '[{}]'::jsonb else c->'sizes' end) loop
      v_ids := array_remove(array[nullif(c->>'color_option_id', '')::uuid, nullif(s->>'size_option_id', '')::uuid,
                                  nullif(s->>'ram_option_id', '')::uuid], null);
      select coalesce(string_agg(x::text, ',' order by x::text), '') into v_key from unnest(v_ids) x;
      if v_key = any(v_keys) then
        raise exception 'duplicate colour/size/RAM combination';
      end if;
      v_keys := v_keys || v_key;
      if coalesce((s->>'stock')::integer, 0) < 0 then raise exception 'stock cannot be negative'; end if;

      select upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g'))
        into v_size_code from public.attribute_options o where o.id = nullif(s->>'size_option_id', '')::uuid;
      select upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g'))
        into v_ram_code from public.attribute_options o where o.id = nullif(s->>'ram_option_id', '')::uuid;
      v_sku := v_prefix || coalesce('-' || nullif(left(v_color_code, 6), ''), '') || coalesce('-' || nullif(left(v_size_code, 6), ''), '')
               || coalesce('-' || nullif(left(v_ram_code, 6), '') , '');

      -- a row may carry its own price (phones: each storage / RAM has its price);
      -- otherwise it takes the variant's price and sale
      if nullif(s->>'price_piastres', '') is not null then
        v_rprice := (s->>'price_piastres')::integer;
        v_rsale := nullif(s->>'sale_price_piastres', '')::integer;
        if v_rprice <= 0 then raise exception 'price must be positive'; end if;
        if v_rsale is not null and v_rsale >= v_rprice then raise exception 'sale price must be lower than the price'; end if;
        v_rs0 := case when v_rsale is null then null else coalesce(v_d0, now()) end;
        v_rs1 := case when v_rsale is null then null else v_d1 end;
        if v_rs0 is not null and v_rs1 is not null and v_rs1 <= v_rs0 then
          raise exception 'sale schedule end must be after the start';
        end if;
      else
        v_rprice := v_price; v_rsale := v_sale; v_rs0 := v_s0; v_rs1 := v_s1;
      end if;

      -- reuse the live row for this combination (keeps cart/order references)
      select id into v_variant from public.variants
       where product_id = p_product_id and option_key = v_key and deleted_at is null;
      if v_variant is null then
        -- a tombstoned row for the same combination is revived instead of duplicated
        select id into v_variant from public.variants
         where product_id = p_product_id and option_key = v_key order by updated_at desc limit 1;
      end if;
      if v_variant is null then
        insert into public.variants (product_id, option_key, option_ids) values (p_product_id, v_key, v_ids)
        returning id into v_variant;
      end if;
      -- SKU must stay unique store-wide; suffix if another product took it
      if exists (select 1 from public.variants where sku = v_sku and deleted_at is null and id <> v_variant) then
        v_sku := v_sku || '-' || upper(substr(replace(v_variant::text, '-', ''), 1, 4));
      end if;
      update public.variants set
        group_id = v_group, option_key = v_key, option_ids = v_ids,
        size_option_id = nullif(s->>'size_option_id', '')::uuid,
        ram_option_id = nullif(s->>'ram_option_id', '')::uuid,
        sku = v_sku, price_piastres = v_rprice, sale_price_piastres = v_rsale,
        sale_starts_at = v_rs0, sale_ends_at = v_rs1,
        stock = coalesce((s->>'stock')::integer, 0),
        image_path = (select path from public.variant_group_media where group_id = v_group order by position limit 1),
        is_active = true, deleted_at = null
      where id = v_variant;
      v_keep_variants := v_keep_variants || v_variant;
    end loop;
  end loop;

  -- A variant with no colour (or no size) can't be picked on the product page
  -- once other variants have one: its stock would count while it can never be
  -- bought. So either every variant has a colour or none, same for sizes.
  if exists (select 1 from public.variants v join public.variant_groups g on g.id = v.group_id
              where v.id = any(v_keep_variants) and g.color_option_id is not null)
     and exists (select 1 from public.variants v join public.variant_groups g on g.id = v.group_id
              where v.id = any(v_keep_variants) and g.color_option_id is null) then
    raise exception 'mixed_options: every variant needs a colour once one variant has a colour';
  end if;
  -- one colour = one variant (its sizes are rows inside it): never the same colour twice
  if exists (select 1 from public.variant_groups g where g.id = any(v_keep_groups) and g.color_option_id is not null
              group by g.color_option_id having count(*) > 1) then
    raise exception 'duplicate_color: each colour can be used by one variant only';
  end if;
  if exists (select 1 from public.variants v where v.id = any(v_keep_variants) and v.size_option_id is not null)
     and exists (select 1 from public.variants v where v.id = any(v_keep_variants) and v.size_option_id is null) then
    raise exception 'mixed_options: every variant needs a size once one variant has a size';
  end if;

  if exists (select 1 from public.variants v where v.id = any(v_keep_variants) and v.ram_option_id is not null)
     and exists (select 1 from public.variants v where v.id = any(v_keep_variants) and v.ram_option_id is null) then
    raise exception 'mixed_options: every row needs a RAM once one row has a RAM';
  end if;

  update public.variants set deleted_at = now(), is_active = false
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_variants));
  update public.variant_groups set deleted_at = now()
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_groups));
  update public.products set updated_at = now() where id = p_product_id;

  return jsonb_build_object('ok', true, 'status', (
    select status from public.products where id = p_product_id), 'children', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'sizes', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'size_option_id', v.size_option_id, 'ram_option_id', v.ram_option_id, 'sku', v.sku, 'stock', v.stock)
                                          order by v.option_key), '[]'::jsonb)
                  from public.variants v where v.group_id = g.id and v.deleted_at is null)) order by g.sort), '[]'::jsonb)
    from public.variant_groups g where g.product_id = p_product_id and g.deleted_at is null));
end
$function$
;

-- --------------------------------------------------------------- fn_submit_product
create or replace function public.fn_submit_product(p_product_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
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
  if v_product.rejected_final then
    raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
  end if;
  -- draft / returned / under review / live: sending always starts a fresh review
  if v_product.status not in ('draft', 'rejected', 'pending', 'approved') then
    raise exception 'product is not submittable in status %', v_product.status;
  end if;

  -- selling gate (grace expiry / suspension blocks publish at API level)
  if not public.vendor_can_sell(v_vendor.id) then
    raise exception 'selling is blocked for this store (% / %)', v_vendor.status, v_vendor.verification_status
      using errcode = 'P0001';
  end if;

  -- completeness validation
  if coalesce(v_product.name_ar, '') = '' or coalesce(v_product.name_en, '') = '' then
    v_missing := array_append(v_missing, ('name')::text);
  end if;
  if v_product.leaf_category_id is null then
    v_missing := array_append(v_missing, ('category')::text);
  else
    select not exists (
      select 1 from public.categories c where c.parent_id = v_product.leaf_category_id and c.deleted_at is null
    ) into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be a leaf category';
    end if;
  end if;
  if not exists (select 1 from public.product_media where product_id = v_product.id) then
    v_missing := array_append(v_missing, ('media')::text);
  end if;
  if not exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and sku is not null and price_piastres is not null and price_piastres > 0
  ) then
    v_missing := array_append(v_missing, ('variants')::text);
  end if;
  if exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and (sku is null or price_piastres is null or price_piastres <= 0)
  ) then
    v_missing := array_append(v_missing, ('variants_incomplete')::text);
  end if;
  for v_attr in
    select ad.code from public.attribute_defs ad
    where (ad.is_required or exists (select 1 from public.category_attributes ca_req
              where ca_req.attribute_id = ad.id and ca_req.category_id = v_product.leaf_category_id and ca_req.is_required))
        and ad.deleted_at is null
      and not ad.is_variant_axis -- axis attrs live in the variant combos
      and public.fn_attr_in_template(ad.id, v_product.leaf_category_id)
      and not exists (
        select 1 from public.product_attribute_values pav
        where pav.product_id = v_product.id and pav.attribute_id = ad.id
      )
  loop
    v_missing := array_append(v_missing, (('attribute:' || v_attr.code))::text);
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
end $function$
;

-- --------------------------------------------------------- fn_admin_decide_product
-- the 3-arg signature is replaced: PostgREST must see exactly one function
drop function if exists public.fn_admin_decide_product(uuid, text, text);

create or replace function public.fn_admin_decide_product(
  p_product uuid,
  p_decision text,
  p_note text default null::text,
  p_expected_submitted_at timestamptz default null::timestamptz
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_product public.products%rowtype;
  v_owner   uuid;
  v_note    text := nullif(trim(coalesce(p_note, '')), '');
  v_before  text;
begin
  if not (public.has_permission('products.review') or public.has_permission('products.review')) then
    raise exception 'not allowed: reviewer permission required' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'approve_notes', 'reject', 'reject_final') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  select * into v_product from public.products where id = p_product and deleted_at is null for update;
  if v_product.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_product.rejected_final then
    return jsonb_build_object('ok', false, 'reason', 'rejected_final');
  end if;
  if p_decision = 'reject_final' then
    if v_product.status not in ('pending', 'rejected', 'approved') then
      return jsonb_build_object('ok', false, 'reason', 'bad_status');
    end if;
  elsif p_decision = 'reject' and v_product.status in ('pending', 'approved') then
    null; -- return-for-changes: an approved product can be sent back as well
  elsif v_product.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  -- the seller sent a new version (or withdrew it for editing) meanwhile
  if p_expected_submitted_at is not null and v_product.submitted_at is distinct from p_expected_submitted_at then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  if p_decision in ('approve_notes', 'reject', 'reject_final') and coalesce(length(v_note), 0) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;

  v_before := v_product.status;
  update public.products set
    status = case when p_decision like 'approve%' then 'approved' else 'rejected' end,
    rejection_reason = case when p_decision like 'reject%' then v_note else null end,
    review_note = case when p_decision = 'approve_notes' then v_note else null end,
    rejected_final = (p_decision = 'reject_final'),
    published_at = case when p_decision like 'approve%' then now() else null end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = v_product.id
  returning * into v_product;

  select owner_id into v_owner from public.vendors where id = v_product.vendor_id;
  perform public.fn_notify(v_owner,
    case when p_decision like 'approve%' then 'product.approved' else 'product.rejected' end,
    jsonb_build_object('product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
                       'reason', v_note, 'final', p_decision = 'reject_final'));

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'product.review', 'products', v_product.id::text,
          jsonb_build_object('status', v_before),
          jsonb_build_object('status', v_product.status, 'decision', p_decision, 'note', v_note));

  return jsonb_build_object('ok', true, 'status', v_product.status);
end $function$
;

revoke all on function public.fn_admin_decide_product(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.fn_admin_decide_product(uuid, text, text, timestamptz) to authenticated;

-- ----------------------------------------------------- fn_admin_log_product_edit
-- records a staff edit with its reason and tells the store owner
create or replace function public.fn_admin_log_product_edit(p_product_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reason  text := nullif(trim(coalesce(p_reason, '')), '');
  v_product public.products%rowtype;
  v_owner   uuid;
begin
  if not public.has_permission('products.edit') then
    raise exception 'not allowed: products.edit permission required' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select * into v_product from public.products where id = p_product_id and deleted_at is null;
  if v_product.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'product.admin_edit', 'products', v_product.id::text,
          jsonb_build_object('reason', v_reason, 'status', v_product.status));

  select owner_id into v_owner from public.vendors where id = v_product.vendor_id;
  if v_owner is not null then
    perform public.fn_notify(v_owner, 'product.admin_edited', jsonb_build_object(
      'product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
      'reason', v_reason));
  end if;

  return jsonb_build_object('ok', true);
end $function$
;

revoke all on function public.fn_admin_log_product_edit(uuid, text) from public, anon;
grant execute on function public.fn_admin_log_product_edit(uuid, text) to authenticated;

notify pgrst, 'reload schema';
