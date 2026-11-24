-- Seller-team feedback (2026-11-11/12), catalogue part:
--  1. Missing product types: plastic chair, vase, satellite receiver, dog house,
--     household / handheld sewing machine, insecticide (ants & cockroaches);
--     clearer names for smart plug ("مقبس ذكي") and wardrobe ("خزانة").
--  2. Missing fabrics on clothing (gabardine, milton, rozalin, crepe, lace; cotton /
--     viscose were hidden by the per-type allowed lists) and white concrete for décor.
--  3. Fields shown where they make no sense: warranty on clothing, strap style on
--     shirts / coats / galabiyas…, dimensions + weight on pens.
--  4. Socks get their own sizes instead of T-shirt sizes.
--  5. Energy-efficiency rating becomes optional everywhere.
--  6. "نوع الكاميرا" (digital cameras) was a number field → a list.
--  7. Brands: Quartz (engine oil), Chance (crossbody bags), Moro (bed sheets), FIT (hand tools).
-- Every removal of a field link is skipped when a product already holds a value for it.

create or replace function pg_temp.slug_ar(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(btrim(p), '[()/،,]+', ' ', 'g'), '\s+', '-', 'g'), '-')
$$;

create or replace function pg_temp.add_leaf(p_group text, p_slug text, p_ar text, p_en text, p_template text)
returns uuid language plpgsql as $$
declare v_group uuid; v_tpl public.categories%rowtype; v_id uuid;
begin
  select id into v_id from public.categories where slug_en = p_slug and deleted_at is null;
  if v_id is not null then return v_id; end if;
  select id into v_group from public.categories where slug_en = p_group and deleted_at is null;
  if v_group is null then raise exception 'group % missing', p_group; end if;
  select * into v_tpl from public.categories where slug_en = p_template and deleted_at is null;
  if v_tpl.id is null then raise exception 'template % missing', p_template; end if;
  insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, sort, icon)
  values (v_group, pg_temp.slug_ar(p_ar), p_slug, p_ar, p_en,
          coalesce((select max(sort) + 1 from public.categories where parent_id = v_group), 1), v_tpl.icon)
  returning id into v_id;
  insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
  select v_id, attribute_id, sort, allowed_option_ids, is_required from public.category_attributes where category_id = v_tpl.id;
  insert into public.size_type_categories (size_type_id, category_id)
  select size_type_id, v_id from public.size_type_categories where category_id = v_tpl.id;
  return v_id;
end $$;

-- drop a field from a product type unless a product of that type already has a value for it
create or replace function pg_temp.unlink(p_cat uuid, p_code text) returns void language plpgsql as $$
begin
  delete from public.category_attributes ca
   using public.attribute_defs d
   where d.id = ca.attribute_id and d.code = p_code and ca.category_id = p_cat
     and not exists (select 1 from public.product_attribute_values v join public.products p on p.id = v.product_id
                      where v.attribute_id = ca.attribute_id and p.leaf_category_id = p_cat);
end $$;

-- global option of a shared attribute (created when missing)
create or replace function pg_temp.opt(p_attr text, p_code text, p_ar text, p_en text) returns uuid language plpgsql as $$
declare v_attr uuid; v_id uuid;
begin
  select id into v_attr from public.attribute_defs where code = p_attr and category_id is null and deleted_at is null;
  if v_attr is null then raise exception 'attribute % missing', p_attr; end if;
  select id into v_id from public.attribute_options where attribute_id = v_attr and (code = p_code or label_ar = p_ar);
  if v_id is null then
    insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
    values (v_attr, p_code, p_ar, p_en, coalesce((select max(sort) + 1 from public.attribute_options where attribute_id = v_attr), 1))
    returning id into v_id;
  end if;
  return v_id;
end $$;

do $$
declare
  v_id uuid; r record; v_add uuid[]; v_fashion uuid; v_decor uuid; v_books uuid;
  v_keep_shoulder text[] := array[
    'baby-bodysuits','baby-sleepsuits-and-rompers','burkinis','cocktail-dresses','crop-tops','denim-dresses',
    'evening-dresses','girls-crop-tops','girls-dresses','girls-tank-tops','halter-tops','jumpsuits','kids-party-dresses',
    'knit-dresses','lingerie-sets','maternity-clothing','maxi-dresses','midi-dresses','mini-dresses','nightdresses',
    'nightgowns','off-shoulder-tops','peplum-tops','rompers','shirt-dresses','tank-tops','tops','tube-tops',
    'wedding-dresses','womens-bodysuits','womens-camisoles','womens-dresses','womens-rompers','womens-sleepwear',
    'wrap-dresses','wrap-tops','blouses','mens-tank-tops','boys-tank-tops','undershirts'];
begin
  -- ── 1. product types
  v_id := pg_temp.add_leaf('furniture', 'plastic-chairs', 'كرسي بلاستيك', 'Plastic Chairs', 'dining-chairs');
  perform pg_temp.unlink(v_id, 'upholstery_material');
  v_id := pg_temp.add_leaf('home-decor', 'vases', 'مزهرية / فازة', 'Vases', 'clocks-and-vases');
  perform pg_temp.unlink(v_id, 'mounting_type');
  perform pg_temp.add_leaf('screens-and-tvs-and-receivers-and-projectors', 'satellite-receivers', 'رسيفر', 'Satellite Receivers', 'streaming-devices');
  perform pg_temp.add_leaf('dogs-supplies', 'dog-houses', 'بيت الكلب', 'Dog Houses', 'dog-beds');
  perform pg_temp.add_leaf('sewing-machines', 'household-sewing-machines', 'ماكينة خياطة منزلية', 'Household Sewing Machines', 'overlock-machines');
  perform pg_temp.add_leaf('sewing-machines', 'handheld-sewing-machines', 'ماكينة خياطة يدوية', 'Handheld Sewing Machines', 'overlock-machines');
  v_id := pg_temp.add_leaf('pest-control', 'insecticides', 'مبيد حشرات (نمل وصراصير)', 'Insecticides (Ants & Cockroaches)', 'insect-repellents');
  update public.category_attributes ca set is_required = false
    from public.attribute_defs d where d.id = ca.attribute_id and ca.category_id = v_id and d.code = 'suitable_age_group';
  update public.categories set name_ar = 'الفيشة الذكية / مقبس ذكي', name_en = 'Smart Plugs / Sockets'
   where slug_en = 'smart-plugs' and deleted_at is null;
  update public.categories set name_ar = 'دولاب الملابس / خزانة', name_en = 'Wardrobes / Closets'
   where slug_en = 'wardrobes' and deleted_at is null;

  select id into v_fashion from public.categories where slug_en = 'fashion' and depth = 1 and deleted_at is null;
  select id into v_decor from public.categories where slug_en = 'home-decor' and deleted_at is null;
  select id into v_books from public.categories where slug_en = 'books-and-stationery' and depth = 1 and deleted_at is null;

  -- ── 2. fabrics (same option on both shared lists, clothing types use either)
  update public.attribute_options o set label_ar = 'فيسكوز / رايون'
    from public.attribute_defs d where d.id = o.attribute_id and d.code in ('fabric_material', 'material') and d.category_id is null
     and o.label_ar = 'فسكوز / رايون';
  for r in select unnest(array['fabric_material', 'material']) code loop
    v_add := array[
      pg_temp.opt(r.code, 'gabardine', 'جبردين', 'Gabardine'),
      pg_temp.opt(r.code, 'milton', 'ميلتون', 'Milton'),
      pg_temp.opt(r.code, 'rozalin', 'روزلين', 'Rozalin'),
      pg_temp.opt(r.code, 'crepe', 'كريب', 'Crepe'),
      pg_temp.opt(r.code, 'lace', 'دانتيل', 'Lace')];
    -- clothing types whose list is a textile list (it already holds cotton or polyester):
    -- add the new fabrics plus the common ones it may be missing
    update public.category_attributes ca
       set allowed_option_ids = (select array_agg(distinct x) from unnest(ca.allowed_option_ids || v_add || array(
             select o.id from public.attribute_options o
              where o.attribute_id = ca.attribute_id
                and o.label_ar in ('قطن', 'قطن مخلوط', 'بوليستر', 'كتان', 'فيسكوز / رايون', 'شيفون', 'ساتان', 'تريكو', 'قطيفة', 'حرير', 'صوف'))) x)
      from public.attribute_defs d, public.categories c
     where d.id = ca.attribute_id and d.code = r.code and d.category_id is null
       and c.id = ca.category_id and c.path like v_fashion::text || '%'
       and ca.allowed_option_ids is not null
       and exists (select 1 from public.attribute_options o where o.id = any (ca.allowed_option_ids) and o.label_ar in ('قطن', 'بوليستر'));
  end loop;
  -- white concrete on décor items (lists that hold marble or ceramic)
  v_id := pg_temp.opt('material', 'white_concrete', 'خرسانة بيضاء', 'White concrete');
  update public.category_attributes ca set allowed_option_ids = ca.allowed_option_ids || v_id
    from public.attribute_defs d, public.categories c
   where d.id = ca.attribute_id and d.code = 'material' and d.category_id is null
     and c.id = ca.category_id and c.path like '%' || v_decor::text || '%'
     and ca.allowed_option_ids is not null and not (v_id = any (ca.allowed_option_ids))
     and exists (select 1 from public.attribute_options o where o.id = any (ca.allowed_option_ids) and o.label_ar in ('رخام', 'سيراميك'));

  -- ── 3. fields that make no sense
  for r in select c.id from public.categories c where c.path like v_fashion::text || '%' and c.deleted_at is null loop
    perform pg_temp.unlink(r.id, 'warranty_period');
  end loop;
  for r in select ca.category_id id from public.category_attributes ca join public.attribute_defs d on d.id = ca.attribute_id
             join public.categories c on c.id = ca.category_id
            where d.code = 'shoulder_style' and not (c.slug_en = any (v_keep_shoulder)) loop
    perform pg_temp.unlink(r.id, 'shoulder_style');
  end loop;
  for r in select c.id from public.categories c
            where c.path like v_books::text || '%' and c.deleted_at is null and c.name_ar ~ 'قلم|أقلام' loop
    perform pg_temp.unlink(r.id, 'dimensions_w_d_h');
    perform pg_temp.unlink(r.id, 'dimensions');
    perform pg_temp.unlink(r.id, 'weight');
  end loop;

  -- ── 5. energy rating optional
  update public.category_attributes ca set is_required = false
    from public.attribute_defs d where d.id = ca.attribute_id and d.code in ('energy_rating', 'energy_efficiency_rating', 'efficiency_certification');
end $$;

-- ── 4. sock sizes
insert into public.size_types (code, name_ar, name_en, sort)
values ('socks', 'مقاسات الشرابات', 'Sock sizes', 14)
on conflict (code) do nothing;

insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, o.code, o.ar, o.en, 500 + o.ord, st.id
  from (values ('sk_free', 'فري سايز', 'Free size', 0), ('sk_35_38', '35 - 38', '35 - 38', 1), ('sk_39_42', '39 - 42', '39 - 42', 2),
               ('sk_43_46', '43 - 46', '43 - 46', 3), ('sk_47_50', '47 - 50', '47 - 50', 4),
               ('sk_kids_s', 'أطفال صغير', 'Kids small', 5), ('sk_kids_m', 'أطفال وسط', 'Kids medium', 6), ('sk_kids_l', 'أطفال كبير', 'Kids large', 7)) o(code, ar, en, ord)
  cross join public.attribute_defs d
  cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'socks'
on conflict (attribute_id, code) do nothing;

do $$
declare r record;
begin
  for r in select c.id from public.categories c
            where c.deleted_at is null and c.slug_en in ('mens-socks', 'socks-and-hosiery', 'sports-socks') loop
    insert into public.size_type_categories (size_type_id, category_id)
    select st.id, r.id from public.size_types st where st.code = 'socks' on conflict do nothing;
    -- T-shirt sizes go unless a live variant of that type already uses one
    delete from public.size_type_categories x using public.size_types st
     where st.id = x.size_type_id and st.code = 'clothing' and x.category_id = r.id
       and not exists (select 1 from public.variants v join public.attribute_options o on o.id = v.size_option_id
                         join public.variant_groups g on g.id = v.group_id join public.products p on p.id = g.product_id
                        where o.size_type_id = st.id and p.leaf_category_id = r.id);
  end loop;
end $$;

-- ── 6. camera type: a list, not a number (no product holds a value yet)
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'camera_type' and deleted_at is null and type = 'number';
  if v_attr is null then return; end if;
  if exists (select 1 from public.product_attribute_values where attribute_id = v_attr) then return; end if;
  update public.attribute_defs set type = 'enum' where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
  values (v_attr, 'dslr', 'كاميرا احترافية DSLR', 'DSLR', 1),
         (v_attr, 'mirrorless', 'كاميرا ميرورلس', 'Mirrorless', 2),
         (v_attr, 'compact', 'كاميرا ديجيتال صغيرة (كومباكت)', 'Compact', 3),
         (v_attr, 'bridge', 'كاميرا بريدج', 'Bridge', 4),
         (v_attr, 'action', 'كاميرا أكشن', 'Action camera', 5),
         (v_attr, 'instant', 'كاميرا فورية', 'Instant camera', 6),
         (v_attr, 'camcorder', 'كاميرا فيديو', 'Camcorder', 7),
         (v_attr, 'other', 'أخرى', 'Other', 8)
  on conflict (attribute_id, code) do nothing;
end $$;

-- ── 7. brands
insert into public.brands (name_ar, name_en, slug_ar, slug_en, is_active, review_status, country_ar, country_en)
values ('كوارتز (توتال)', 'Quartz', 'كوارتز', 'quartz', true, 'approved', 'فرنسا', 'France'),
       ('شانس', 'Chance', 'شانس', 'chance', true, 'approved', '', ''),
       ('مورو', 'Moro', 'مورو', 'moro', true, 'approved', 'مصر', 'Egypt'),
       ('فيت', 'FIT', 'فيت', 'fit', true, 'approved', 'الصين', 'China')
on conflict do nothing;

insert into public.brand_categories (brand_id, category_id)
select b.id, p.parent_id
  from (values ('quartz', 'engine-oils'), ('chance', 'crossbody-bags'), ('chance', 'crossbody-and-shoulder-bags'),
               ('moro', 'bed-sheet-sets'), ('moro', 'bedsheets-and-comforters'), ('fit', 'hammers')) l(brand, leaf)
  join public.brands b on b.slug_en = l.brand and b.deleted_at is null
  join public.categories p on p.slug_en = l.leaf and p.deleted_at is null
on conflict do nothing;

notify pgrst, 'reload schema';
