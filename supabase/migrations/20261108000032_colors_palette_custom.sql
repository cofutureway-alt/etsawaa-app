-- Colours: a fuller palette (about 60, grouped by family) and seller-made
-- custom colours. A custom colour is a normal option of the colour axis (so
-- swatches, filters and the cart work unchanged) flagged is_custom; the same
-- hex is reused instead of duplicated. Also: one colour = one variant.

alter table public.attribute_options add column if not exists is_custom boolean not null default false;
alter table public.attribute_options add column if not exists created_by uuid references auth.users(id) on delete set null;

with color_def as (select id from public.attribute_defs where code = 'color'),
palette(code, label_ar, label_en, color_hex, sort) as (values
  ('black','أسود','Black','#000000',0),
  ('charcoal','فحمي','Charcoal','#36454F',1),
  ('dark_gray','رمادي غامق','Dark Gray','#4A4A4A',2),
  ('gray','رمادي','Gray','#808080',3),
  ('light_gray','رمادي فاتح','Light Gray','#D3D3D3',4),
  ('silver','فضي','Silver','#C0C0C0',5),
  ('white','أبيض','White','#FFFFFF',6),
  ('off_white','أوف وايت','Off White','#F8F6F0',7),
  ('cream','كريمي','Cream','#FFFDD0',8),
  ('champagne','شامبين','Champagne','#F7E7CE',9),
  ('beige','بيج','Beige','#D7CCC8',10),
  ('nude','نود','Nude','#E3BC9A',11),
  ('khaki','كاكي','Khaki','#C3B091',12),
  ('tan','هافان','Tan','#D2B48C',13),
  ('camel','جملي','Camel','#C19A6B',14),
  ('caramel','كراميل','Caramel','#AF6E4D',15),
  ('light_brown','بني فاتح','Light Brown','#A1887F',16),
  ('brown','بني','Brown','#6D4C41',17),
  ('dark_brown','بني غامق','Dark Brown','#3E2723',18),
  ('red','أحمر','Red','#D32F2F',19),
  ('dark_red','أحمر غامق','Dark Red','#8B0000',20),
  ('burgundy','نبيتي','Burgundy','#800020',21),
  ('wine','نبيذي','Wine','#722F37',22),
  ('coral','مرجاني','Coral','#FF7F50',23),
  ('salmon','سلموني','Salmon','#FA8072',24),
  ('pink','وردي','Pink','#F48FB1',25),
  ('baby_pink','بمبي','Baby Pink','#F8C8DC',26),
  ('fuchsia','فوشيا','Fuchsia','#E91E63',27),
  ('rose_gold','روز جولد','Rose Gold','#B76E79',28),
  ('purple','بنفسجي','Purple','#7B1FA2',29),
  ('mauve','موف','Mauve','#8E6C9E',30),
  ('lilac','ليلكي','Lilac','#C8A2C8',31),
  ('lavender','لافندر','Lavender','#B57EDC',32),
  ('navy','كحلي','Navy','#1A237E',33),
  ('indigo','نيلي','Indigo','#3F51B5',34),
  ('royal_blue','أزرق ملكي','Royal Blue','#4169E1',35),
  ('blue','أزرق','Blue','#1976D2',36),
  ('jeans','جينز','Denim','#5D7EA7',37),
  ('sky_blue','سماوي','Sky Blue','#87CEEB',38),
  ('light_blue','لبني','Light Blue','#81D4FA',39),
  ('petrol','بترولي','Petrol','#1F5F6B',40),
  ('teal','تيل','Teal','#008080',41),
  ('turquoise','تركواز','Turquoise','#40E0D0',42),
  ('cyan','سيان','Cyan','#00BCD4',43),
  ('mint','نعناعي','Mint','#A8E6CF',44),
  ('light_green','أخضر فاتح','Light Green','#8BC34A',45),
  ('green','أخضر','Green','#388E3C',46),
  ('dark_green','أخضر غامق','Dark Green','#1B5E20',47),
  ('army_green','أخضر عسكري','Army Green','#4B5320',48),
  ('olive','زيتي','Olive','#808000',49),
  ('neon','فسفوري','Neon','#CCFF00',50),
  ('lemon','ليموني','Lemon','#FFF44F',51),
  ('yellow','أصفر','Yellow','#FBC02D',52),
  ('mustard','مسطردة','Mustard','#E1AD01',53),
  ('peach','خوخي','Peach','#FFCBA4',54),
  ('orange','برتقالي','Orange','#F57C00',55),
  ('gold','ذهبي','Gold','#D4AF37',56),
  ('copper','نحاسي','Copper','#B87333',57),
  ('bronze','برونزي','Bronze','#CD7F32',58),
  ('multicolor','متعدد الألوان','Multicolor',null,59),
  ('printed','منقوش','Printed',null,60),
  ('transparent','شفاف','Transparent',null,61)
)
insert into public.attribute_options (attribute_id, code, label_ar, label_en, color_hex, sort)
select (select id from color_def), p.code, p.label_ar, p.label_en, p.color_hex, p.sort from palette p
on conflict (attribute_id, code) do update set sort = excluded.sort,
  color_hex = coalesce(public.attribute_options.color_hex, excluded.color_hex);

-- a seller's own colour: returns the option (existing one when the hex is already known)
create or replace function public.fn_vendor_add_color(p_hex text, p_label_ar text, p_label_en text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_attr uuid;
  v_hex text := upper(trim(coalesce(p_hex, '')));
  v_ar text := left(trim(coalesce(p_label_ar, '')), 40);
  v_en text := left(trim(coalesce(nullif(p_label_en, ''), p_label_ar, '')), 40);
  v_row public.attribute_options%rowtype;
begin
  if v_user is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not (public.is_admin() or exists (select 1 from public.store_members m where m.user_id = v_user)
          or exists (select 1 from public.vendors v where v.owner_id = v_user)) then
    raise exception 'not allowed: sellers only' using errcode = '42501';
  end if;
  if v_hex !~ '^#[0-9A-F]{6}$' then raise exception 'bad_hex'; end if;
  if length(v_ar) < 2 then raise exception 'name_required'; end if;
  select id into v_attr from public.attribute_defs where code = 'color';

  select * into v_row from public.attribute_options
   where attribute_id = v_attr and deleted_at is null and upper(color_hex) = v_hex
   order by is_custom, sort limit 1;
  if v_row.id is null then
    -- a seller can't flood the catalogue: 30 custom colours per account
    if (select count(*) from public.attribute_options where created_by = v_user and is_custom) >= 30 then
      raise exception 'too_many_colors';
    end if;
    insert into public.attribute_options (attribute_id, code, label_ar, label_en, color_hex, sort, is_custom, created_by)
    values (v_attr, 'c_' || lower(substr(v_hex, 2)), v_ar, v_en, v_hex, 1000, true, v_user)
    on conflict (attribute_id, code) do update set deleted_at = null
    returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label_ar', v_row.label_ar,
                            'label_en', v_row.label_en, 'color_hex', v_row.color_hex);
end $$;
revoke all on function public.fn_vendor_add_color(text, text, text) from public, anon;
grant execute on function public.fn_vendor_add_color(text, text, text) to authenticated;

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
  -- one colour = one variant (its sizes are rows inside it): never the same colour twice
  if exists (select 1 from public.variant_groups g where g.id = any(v_keep_groups) and g.color_option_id is not null
              group by g.color_option_id having count(*) > 1) then
    raise exception 'duplicate_color: each colour can be used by one variant only';
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
