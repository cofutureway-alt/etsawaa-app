-- Parent-category Arabic names found wrong while checking for sibling name clashes
-- (2026-11-07). Slugs and English names were right.
update public.categories set name_ar = 'الآلات الموسيقية' where slug_en = 'musical-instruments' and deleted_at is null;          -- was «الشاشات والأنظمة الصوتية» (copied from TV & audio)
update public.categories set name_ar = 'الإكسسوارات والمجوهرات' where slug_en = 'accessories-and-jewellery' and deleted_at is null; -- was «مجوهرات/إكسسوارات»
update public.categories set name_ar = 'قلايات هوائية بدون زيت' where slug_en = 'air-fryers' and deleted_at is null;             -- was «قلايات بدون زيت وهواية»
update public.categories set name_ar = 'غلايات المياه الكهربائية' where slug_en = 'kettles' and deleted_at is null;             -- was «غلايات المياه الكترونك»
update public.categories set name_ar = 'طابعات وسكانر وإكسسوارات' where slug_en = 'printers-scanners-and-accessories' and deleted_at is null;
update public.categories set name_ar = 'المناديل والمنتجات الورقية' where slug_en = 'tissues-and-disposable-paper' and deleted_at is null; -- was «المنظفات الورقية…»
update public.categories set name_ar = 'ألعاب تعليمية ومونتيسوري لتنمية الذكاء' where slug_en = 'learning-and-montessori-games' and deleted_at is null;
update public.categories set name_ar = 'حلل أرز كهربائية' where slug_en = 'rice-cookers' and deleted_at is null;               -- was «حلال ومحضر أرز كهربائي»
update public.categories set name_ar = 'منشر غسيل قابل للطي' where slug_en = 'clothes-airers' and deleted_at is null;          -- same name as clothes-drying-racks
