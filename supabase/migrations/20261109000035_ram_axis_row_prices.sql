-- Phones / tablets / computers: RAM is its own variant option (not merged
-- with storage), and every row (storage + RAM) can have its own price and
-- sale price — a 256 GB phone costs more than the 128 GB one.
-- The combined "RAM + storage" size options from migration 034 are removed
-- (no product uses them).

-- ── 1. remove the combined options
delete from public.size_type_categories where size_type_id in (select id from public.size_types where code = 'ram_storage');
update public.attribute_options set deleted_at = now()
 where code like 'rs\_%' and deleted_at is null
   and not exists (select 1 from public.variants v where v.size_option_id = attribute_options.id);
delete from public.size_types st where code = 'ram_storage'
   and not exists (select 1 from public.attribute_options o where o.size_type_id = st.id and o.deleted_at is null);

-- ── 2. RAM as a variant axis
insert into public.attribute_defs (code, type, label_ar, label_en, is_variant_axis, is_filterable, is_required, sort, unit)
values ('memory', 'enum', 'الرام', 'RAM', true, true, false, 908, '')
on conflict do nothing;

insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, o.code, o.label_ar, o.label_en, o.ord
  from (values
  ('ram_1gb', '1 جيجا', '1 GB', 0), ('ram_2gb', '2 جيجا', '2 GB', 1), ('ram_3gb', '3 جيجا', '3 GB', 2),
  ('ram_4gb', '4 جيجا', '4 GB', 3), ('ram_6gb', '6 جيجا', '6 GB', 4), ('ram_8gb', '8 جيجا', '8 GB', 5),
  ('ram_12gb', '12 جيجا', '12 GB', 6), ('ram_16gb', '16 جيجا', '16 GB', 7), ('ram_24gb', '24 جيجا', '24 GB', 8),
  ('ram_32gb', '32 جيجا', '32 GB', 9), ('ram_64gb', '64 جيجا', '64 GB', 10)
  ) o(code, label_ar, label_en, ord)
  cross join public.attribute_defs d
 where d.code = 'memory' and d.is_variant_axis and d.category_id is null
on conflict (attribute_id, code) do nothing;

-- phones, tablets, laptops and computers (not storage devices / e-readers)
insert into public.category_attributes (category_id, attribute_id, sort)
select c.id, d.id, coalesce((select max(sort) from public.category_attributes y where y.category_id = c.id), 0) + 3
  from public.categories c cross join public.attribute_defs d
 where d.code = 'memory' and d.is_variant_axis and d.category_id is null
   and c.deleted_at is null and c.id in (
  'd050f77f-61c8-48eb-92b5-cfbe70e77462', '369ac3dc-710b-413c-a4d0-fbca7daec526', 'f1ca2dbd-cb3d-48d1-af8b-f286f3963bb5',
  '3c9d0b53-88e3-4a09-8fa4-5cd49dbe90d2', '8beac8af-b9f2-43ce-9ad3-affe9f6123b0',
  'c22371bf-ef93-41f1-bfdd-a5670a33b666', '9ea7a178-33de-4336-8e0e-db3af572ac03', '4633e331-39d8-45c8-9944-9a225ea1ec83',
  'f4728ebc-6caf-4f1a-a03d-c699e92ee946', '17b27955-18dc-4502-bb7f-15f73a3df1c9', '1a9600e2-6750-4f60-a8de-c0fef3f11cd3',
  '029c7817-7f7c-4126-a489-86f251265832')
on conflict do nothing;

-- ── 3. the variant row keeps its RAM
alter table public.variants add column if not exists ram_option_id uuid references public.attribute_options(id) on delete restrict;

-- ── 4. save: RAM per row + per-row price / sale price
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
  v_d0 timestamptz; v_d1 timestamptz; v_ram_code text;
  v_rprice integer; v_rsale integer; v_rs0 timestamptz; v_rs1 timestamptz;
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

  return jsonb_build_object('ok', true, 'children', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'sizes', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'size_option_id', v.size_option_id, 'ram_option_id', v.ram_option_id, 'sku', v.sku, 'stock', v.stock)
                                          order by v.option_key), '[]'::jsonb)
                  from public.variants v where v.group_id = g.id and v.deleted_at is null)) order by g.sort), '[]'::jsonb)
    from public.variant_groups g where g.product_id = p_product_id and g.deleted_at is null));
end
$function$;
