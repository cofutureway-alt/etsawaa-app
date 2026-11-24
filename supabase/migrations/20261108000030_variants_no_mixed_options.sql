-- Variants: never mix a variant without colour/size with variants that have one.
-- Product e6024fe7 kept its first "price & stock" row (no colour, no size, 50
-- pieces) next to beige/blue/black variants with 0 stock: the page said "50
-- available" while every option was crossed out. fn_save_children now refuses
-- that mix; the existing row is retired (soft delete, reversible).

CREATE OR REPLACE FUNCTION public.fn_save_children(p_product_id uuid, p_children jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  c jsonb; s jsonb; img text;
  v_group uuid; v_variant uuid;
  v_keep_groups uuid[] := '{}'; v_keep_variants uuid[] := '{}';
  v_keys text[] := '{}';
  v_key text; v_ids uuid[]; v_sku text; v_color_code text; v_size_code text; v_i integer;
  v_price integer; v_sale integer; v_s0 timestamptz; v_s1 timestamptz;
  v_prefix text;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.* into v_product from public.products p join public.vendors v on v.id = p.vendor_id
   where p.id = p_product_id and v.owner_id = v_user;
  if v_product.id is null then raise exception 'not allowed: product not found' using errcode = '42501'; end if;
  if v_product.rejected_final then
    raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
  end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is locked in status %', v_product.status;
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
      v_ids := array_remove(array[nullif(c->>'color_option_id', '')::uuid, nullif(s->>'size_option_id', '')::uuid], null);
      select coalesce(string_agg(x::text, ',' order by x::text), '') into v_key from unnest(v_ids) x;
      if v_key = any(v_keys) then
        raise exception 'duplicate colour/size combination';
      end if;
      v_keys := v_keys || v_key;
      if coalesce((s->>'stock')::integer, 0) < 0 then raise exception 'stock cannot be negative'; end if;

      select upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g'))
        into v_size_code from public.attribute_options o where o.id = nullif(s->>'size_option_id', '')::uuid;
      v_sku := v_prefix || coalesce('-' || nullif(left(v_color_code, 6), ''), '') || coalesce('-' || nullif(left(v_size_code, 6), ''), '');

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
        sku = v_sku, price_piastres = v_price, sale_price_piastres = v_sale,
        sale_starts_at = v_s0, sale_ends_at = v_s1,
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
  if exists (select 1 from public.variants v where v.id = any(v_keep_variants) and v.size_option_id is not null)
     and exists (select 1 from public.variants v where v.id = any(v_keep_variants) and v.size_option_id is null) then
    raise exception 'mixed_options: every variant needs a size once one variant has a size';
  end if;

  update public.variants set deleted_at = now(), is_active = false
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_variants));
  update public.variant_groups set deleted_at = now()
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_groups));
  update public.products set updated_at = now() where id = p_product_id;

  return jsonb_build_object('ok', true, 'children', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'sizes', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'size_option_id', v.size_option_id, 'sku', v.sku, 'stock', v.stock)
                                          order by v.option_key), '[]'::jsonb)
                  from public.variants v where v.group_id = g.id and v.deleted_at is null)) order by g.sort), '[]'::jsonb)
    from public.variant_groups g where g.product_id = p_product_id and g.deleted_at is null));
end
$function$;


-- the one product in this state: retire the unpickable row
update public.variants v set deleted_at = now(), is_active = false
 where v.deleted_at is null and v.option_ids = '{}'
   and exists (select 1 from public.variants o where o.product_id = v.product_id and o.deleted_at is null and o.option_ids <> '{}');
update public.variant_groups g set deleted_at = now()
 where g.deleted_at is null and g.color_option_id is null
   and not exists (select 1 from public.variants v where v.group_id = g.id and v.deleted_at is null);
