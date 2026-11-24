-- Owner feedback 2026-11-13 (catalogue part of phase 1):
--  1. Pack volumes: 75 mL (toothpaste) and the other common small / mid sizes.
--  2. "الشهادات" is never required (a pillow has none; certificates are optional info).
--  3. Brands: Man Look (after-shave balm), Women's (facial hair removers),
--     Real Man (men's perfumes); Penduline also under kids' perfumes.

-- ── 1. volumes
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, 'vol_' || v.ml || 'ml', v.ml || ' مل', v.ml || ' mL', 0, st.id
  from (values (10), (15), (20), (25), (30), (35), (40), (45), (60), (75), (80), (90), (120), (125), (175), (180), (350), (450), (600)) v(ml)
  cross join public.attribute_defs d
  cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'volume'
on conflict (attribute_id, code) do nothing;

-- keep the list in millilitre order
update public.attribute_options o set sort = 200 + x.rn
  from (select o2.id, row_number() over (order by substring(o2.code from 'vol_(\d+)ml')::int) - 1 rn
          from public.attribute_options o2 join public.size_types st on st.id = o2.size_type_id
         where st.code = 'volume' and o2.code ~ '^vol_\d+ml$') x
 where o.id = x.id;

-- ── 2. certificates optional
update public.category_attributes ca set is_required = false
  from public.attribute_defs d
 where d.id = ca.attribute_id and d.code = 'certification' and ca.is_required;

-- ── 3. brands
insert into public.brands (name_ar, name_en, slug_ar, slug_en, is_active, review_status, country_ar, country_en)
values ('مان لوك', 'Man Look', 'مان-لوك', 'man-look', true, 'approved', '', ''),
       ('وومنز', 'Women''s', 'وومنز', 'womens', true, 'approved', '', ''),
       ('ريل مان', 'Real Man', 'ريل-مان', 'real-man', true, 'approved', '', '')
on conflict do nothing;

insert into public.brand_categories (brand_id, category_id)
select b.id, c.parent_id
  from (values ('man-look', 'aftershaves'), ('womens', 'epilators'), ('womens', 'depilatory-creams'),
               ('real-man', 'mens-perfumes-mens-perfumes'), ('penduline', 'kids-and-baby-perfumes')) l(brand, leaf)
  join public.brands b on b.slug_en = l.brand and b.deleted_at is null
  join public.categories c on c.slug_en = l.leaf and c.deleted_at is null
on conflict do nothing;

notify pgrst, 'reload schema';
