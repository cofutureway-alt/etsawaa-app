-- Owner feedback 2026-11-15, catalogue part:
--  1. Duplicate product type: "المضرب الكهربائي" (hand-mixers, no products) and
--     "مضرب كهربائي" (electric-whisks, 1 product) → one type, the one holding the
--     product keeps it and gains the other's extra fields.
--  2. Ice cube trays live with the kitchen tools (and are named so vendors find them).
--  3. Spices move to "مستلزمات المطبخ والتوابل والصوصات", with more spice names
--     and the fields a food product needs (country, expiry, ingredients).
--  4. Flavored milk: coconut and other common flavours.
--  5. Pack weights: the common supermarket sizes (360 g tomato sauce etc.).

do $$
declare v_keep uuid; v_drop uuid; v_kitchen uuid; v_pantry uuid; v_spices uuid; v_ice uuid; v_tpl uuid;
begin
  -- ── 1. duplicate mixer type
  select id into v_keep from public.categories where slug_en = 'electric-whisks' and deleted_at is null;
  select id into v_drop from public.categories where slug_en = 'hand-mixers' and deleted_at is null;
  if v_keep is not null and v_drop is not null then
    if exists (select 1 from public.products where leaf_category_id = v_drop) then
      raise exception 'hand-mixers has products; merge by hand';
    end if;
    insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
    select v_keep, ca.attribute_id, ca.sort, ca.allowed_option_ids, false
      from public.category_attributes ca join public.attribute_defs d on d.id = ca.attribute_id
     where ca.category_id = v_drop and d.code <> 'model'
       and not exists (select 1 from public.category_attributes x where x.category_id = v_keep and x.attribute_id = ca.attribute_id);
    update public.categories set name_ar = 'المضرب الكهربائي (مضرب يدوي)', name_en = 'Hand Mixers / Electric Whisks' where id = v_keep;
    update public.categories set is_active = false, deleted_at = now(), slug_en = slug_en || '-merged', slug_ar = slug_ar || '-مدمج' where id = v_drop;
  end if;

  -- ── 2. ice cube trays → kitchen tools
  select id into v_kitchen from public.categories where slug_en = 'kitchen-tools-and-gadgets' and deleted_at is null;
  select id into v_ice from public.categories where slug_en = 'ice-molds' and deleted_at is null;
  if v_kitchen is not null and v_ice is not null then
    update public.categories set parent_id = v_kitchen, name_ar = 'قالب مكعبات الثلج', name_en = 'Ice Cube Trays & Molds',
           sort = coalesce((select max(sort) + 1 from public.categories where parent_id = v_kitchen), 1)
     where id = v_ice;
  end if;

  -- ── 3. spices
  select id into v_pantry from public.categories where slug_en = 'pantry-and-condiments' and deleted_at is null;
  select id into v_spices from public.categories where slug_en = 'spices-and-seasonings' and deleted_at is null;
  select id into v_tpl from public.categories where slug_en = 'canned-tomato-sauce' and deleted_at is null;
  if v_pantry is not null and v_spices is not null then
    update public.categories set parent_id = v_pantry, sort = 0 where id = v_spices and parent_id <> v_pantry;
    -- the food fields every pantry item has (country, expiry, ingredients)
    insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
    select v_spices, ca.attribute_id, ca.sort + 20, ca.allowed_option_ids, false
      from public.category_attributes ca join public.attribute_defs d on d.id = ca.attribute_id
     where ca.category_id = v_tpl and d.code in ('country', 'expiry_date', 'main_ingredient')
       and not exists (select 1 from public.category_attributes x where x.category_id = v_spices and x.attribute_id = ca.attribute_id);
    -- "model" means nothing on a spice
    delete from public.category_attributes ca using public.attribute_defs d
     where d.id = ca.attribute_id and ca.category_id = v_spices and d.code = 'model'
       and not exists (select 1 from public.product_attribute_values v join public.products p on p.id = v.product_id
                        where v.attribute_id = ca.attribute_id and p.leaf_category_id = v_spices);
  end if;
end $$;

-- more spice names (the list is global; "أخرى" stays last)
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, s.code, s.ar, s.en, 100 + s.ord
  from (values ('garlic_powder', 'ثوم بودرة', 'Garlic powder', 1), ('onion_powder', 'بصل بودرة', 'Onion powder', 2),
               ('fennel', 'شمر', 'Fennel', 3), ('anise', 'ينسون', 'Anise', 4), ('caraway', 'كراوية', 'Caraway', 5),
               ('nigella', 'حبة البركة', 'Nigella seeds', 6), ('sesame', 'سمسم', 'Sesame', 7),
               ('white_pepper', 'فلفل أبيض', 'White pepper', 8), ('sweet_paprika', 'فلفل حلو', 'Sweet pepper', 9),
               ('chili_flakes', 'شطة مجروشة', 'Chili flakes', 10), ('mixed_herbs', 'أعشاب مشكلة', 'Mixed herbs', 11),
               ('basil', 'ريحان', 'Basil', 12), ('rosemary', 'روزماري / حصا لبان', 'Rosemary', 13),
               ('thyme_leaves', 'ورق زعتر', 'Thyme leaves', 14), ('mint_dried', 'نعناع مجفف', 'Dried mint', 15),
               ('dill_dried', 'شبت مجفف', 'Dried dill', 16), ('parsley_dried', 'بقدونس مجفف', 'Dried parsley', 17),
               ('star_anise', 'ينسون نجمي', 'Star anise', 18), ('saffron', 'زعفران', 'Saffron', 19),
               ('mahlab', 'محلب', 'Mahlab', 20), ('mastic', 'مستكة', 'Mastic', 21), ('fenugreek', 'حلبة', 'Fenugreek', 22),
               ('biryani', 'بهارات برياني', 'Biryani spices', 23), ('pizza', 'بهارات بيتزا', 'Pizza seasoning', 24),
               ('grill', 'بهارات مشويات', 'Grill seasoning', 25), ('potato', 'بهارات بطاطس', 'Potato seasoning', 26),
               ('pasta', 'بهارات مكرونة', 'Pasta seasoning', 27), ('rice', 'بهارات أرز', 'Rice spices', 28),
               ('ras_el_hanout', 'رأس الحانوت', 'Ras el hanout', 29), ('za_atar_mix', 'زعتر بالسمسم (خلطة)', 'Za''atar mix', 30)) s(code, ar, en, ord)
  cross join public.attribute_defs d
 where d.code = 'spice_or_blend_name' and d.category_id is null and d.deleted_at is null
on conflict (attribute_id, code) do nothing;
update public.attribute_options o set sort = 999
  from public.attribute_defs d where d.id = o.attribute_id and d.code = 'spice_or_blend_name' and d.category_id is null and o.code = 'other';

-- ── 4. flavours (global flavour list) and the flavoured-milk list
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, f.code, f.ar, f.en, 100 + f.ord
  from (values ('coconut', 'جوز الهند', 'Coconut', 1), ('banana', 'موز', 'Banana', 2), ('hazelnut', 'بندق', 'Hazelnut', 3),
               ('coffee_mocha', 'قهوة / موكا', 'Coffee / Mocha', 4), ('dates', 'تمر', 'Dates', 5),
               ('berries', 'توت', 'Berries', 6), ('pistachio', 'فستق', 'Pistachio', 7), ('biscuit', 'بسكويت / كوكيز', 'Biscuit / Cookies', 8),
               ('peach', 'خوخ', 'Peach', 9), ('guava', 'جوافة', 'Guava', 10), ('cantaloupe', 'كانتالوب', 'Cantaloupe', 11),
               ('oat', 'شوفان', 'Oat', 12), ('rice_pudding', 'أرز باللبن', 'Rice pudding', 13), ('cinnamon', 'قرفة', 'Cinnamon', 14),
               ('lotus', 'لوتس / كراميل بسكويت', 'Lotus / Biscoff', 15)) f(code, ar, en, ord)
  cross join public.attribute_defs d
 where d.code = 'flavor' and d.category_id is null and d.deleted_at is null
on conflict (attribute_id, code) do nothing;
update public.attribute_options o set sort = 999
  from public.attribute_defs d where d.id = o.attribute_id and d.code = 'flavor' and d.category_id is null and o.code = 'other';

update public.category_attributes ca
   set allowed_option_ids = (select array_agg(distinct x) from unnest(ca.allowed_option_ids || array(
         select o.id from public.attribute_options o
          where o.attribute_id = ca.attribute_id
            and o.code in ('coconut', 'banana', 'hazelnut', 'coffee_mocha', 'dates', 'berries', 'pistachio', 'biscuit',
                           'peach', 'guava', 'cantaloupe', 'oat', 'rice_pudding', 'cinnamon', 'lotus'))) x)
  from public.attribute_defs d, public.categories c
 where d.id = ca.attribute_id and d.code = 'flavor' and d.category_id is null
   and c.id = ca.category_id and c.slug_en = 'flavored-milk' and ca.allowed_option_ids is not null;

-- ── 5. pack weights
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, 'wt_' || w.g || 'g',
       case when w.g >= 1000 then trim(trailing '.' from trim(trailing '0' from to_char(w.g / 1000.0, 'FM990.99'))) || ' كجم' else w.g || ' جم' end,
       case when w.g >= 1000 then trim(trailing '.' from trim(trailing '0' from to_char(w.g / 1000.0, 'FM990.99'))) || ' kg' else w.g || ' g' end,
       0, st.id
  from (values (10), (15), (20), (25), (30), (35), (40), (45), (60), (70), (75), (80), (85), (90), (110), (120), (125), (130), (135),
               (160), (170), (175), (180), (185), (190), (225), (240), (260), (280), (300), (320), (330), (340), (350), (360),
               (370), (380), (390), (425), (450), (454), (600), (650), (700), (800), (850), (900), (1200), (1250), (1800)) w(g)
  cross join public.attribute_defs d
  cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'weight'
on conflict (attribute_id, code) do nothing;

-- keep the list in gram order
update public.attribute_options o set sort = 100 + x.rn
  from (select o2.id, row_number() over (order by substring(o2.code from 'wt_(\d+)g')::int) - 1 rn
          from public.attribute_options o2 join public.size_types st on st.id = o2.size_type_id
         where st.code = 'weight' and o2.code ~ '^wt_\d+g$') x
 where o.id = x.id;

notify pgrst, 'reload schema';
