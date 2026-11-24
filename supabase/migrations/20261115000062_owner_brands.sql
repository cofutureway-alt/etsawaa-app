insert into public.brands (name_ar, name_en, slug_ar, slug_en, is_active, review_status, country_ar, country_en, description_ar, description_en)
values ('وي', 'WE', 'وي', 'we-water-filters', true, 'approved', '', '', 'فلاتر مياه الشرب.', 'Drinking water filters.'),
       ('تكنو فاير', 'Techno Fire', 'تكنو-فاير', 'techno-fire', true, 'approved', '', '', 'بوتاجازات وأسطح طهي.', 'Gas cookers and hobs.'),
       ('بيوريتي', 'Purity', 'بيوريتي', 'purity', true, 'approved', '', '', 'شفاطات المطبخ.', 'Kitchen hoods.'),
       ('سيلفر كريست', 'SilverCrest', 'سيلفر-كريست', 'silvercrest', true, 'approved', 'ألمانيا', 'Germany',
        'العلامة الخاصة بسلسلة ليدل الألمانية للأجهزة المنزلية الصغيرة مثل الخلاطات.', 'Lidl''s own brand of small home appliances such as blenders.'),
       ('ببساطة', 'Basata', 'ببساطة', 'basata', true, 'approved', '', '', 'شوفان.', 'Oats.'),
       ('رينول', 'Renol', 'رينول', 'renol', true, 'approved', '', '', 'مطهرات ومنظفات الأرضيات.', 'Floor disinfectants and cleaners.'),
       ('بابيا', 'Papia', 'بابيا', 'papia', true, 'approved', 'تركيا', 'Turkey',
        'مناديل ومنتجات ورقية من إنتاج شركة حياة كيميا التركية.', 'Tissues and paper products made by Hayat Kimya (Türkiye).'),
       ('ديازينون', 'Diazinon', 'ديازينون', 'diazinon', true, 'approved', '', '', 'مبيد للنمل والصراصير.', 'Ant and cockroach insecticide.')
on conflict do nothing;
insert into public.brand_categories (brand_id, category_id)
select b.id, g.id
  from (values ('we-water-filters','water-coolers-and-filters'), ('techno-fire','cookers'), ('techno-fire','cooktop'),
               ('purity','range-hoods'), ('silvercrest','blenders'), ('basata','breakfast-and-snacks'),
               ('renol','cleaners'), ('papia','tissues-and-disposable-paper'), ('diazinon','pest-control')) l(brand, grp)
  join public.brands b on b.slug_en = l.brand and b.deleted_at is null
  join public.categories g on g.slug_en = l.grp and g.deleted_at is null
on conflict do nothing
returning brand_id;
select b.name_en, b.name_ar, count(bc.*) from brands b left join brand_categories bc on bc.brand_id=b.id where b.slug_en in ('we-water-filters','techno-fire','purity','silvercrest','basata','renol','papia','diazinon') group by 1,2;
