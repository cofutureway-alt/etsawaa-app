-- Spec review, second pass (2026-11-07)
--  1. remaining unclear / misspelt names
--  2. a CPU "threads" spec separate from textile «عدد الخيوط»
--  3. leftover specs from another product family (jewellery specs on a nail
--     lamp, hair type on car shampoo, flavour on pyjamas & pet beds, cosmetic
--     shade on car sunshades, power/voltage on hand tools, USB on micellar water…)
--  4. thin templates (1–3 specs) get the basic specs they were missing
-- Links that already hold product values are never removed.

create or replace function pg_temp.unlink(p_slug text, p_codes text[]) returns void language sql as $f$
  delete from public.category_attributes ca
   using public.categories c, public.attribute_defs d
   where c.id = ca.category_id and d.id = ca.attribute_id and c.slug_en = p_slug and c.deleted_at is null
     and d.category_id is null and d.code = any(p_codes)
     and not exists (select 1 from public.product_attribute_values v join public.products p on p.id = v.product_id
                      where v.attribute_id = ca.attribute_id and p.leaf_category_id = ca.category_id);
$f$;
create or replace function pg_temp.link(p_slug text, p_codes text[]) returns void language sql as $f$
  insert into public.category_attributes (category_id, attribute_id, sort)
  select c.id, d.id, coalesce((select max(sort) from public.category_attributes x where x.category_id = c.id), 0) + o.ord
    from public.categories c
    cross join unnest(p_codes) with ordinality o(code, ord)
    join public.attribute_defs d on d.code = o.code and d.category_id is null and d.deleted_at is null
   where c.slug_en = p_slug and c.deleted_at is null
  on conflict do nothing;
$f$;
create or replace function pg_temp.ren(p_code text, p_ar text, p_en text default null) returns void language sql as $f$
  update public.attribute_defs set label_ar = p_ar, label_en = coalesce(p_en, label_en)
   where code = p_code and category_id is null;
$f$;

-- 1. names
select pg_temp.ren('cooler_included', 'مبرد مرفق');
select pg_temp.ren('core_count', 'عدد الأنوية');
select pg_temp.ren('timer_settings', 'إعدادات المؤقت');
select pg_temp.ren('powdered', 'تحتوي على بودرة');
select pg_temp.ren('low_water_shut_off', 'إيقاف تلقائي عند نفاد المياه', 'Low-water auto shut-off');
select pg_temp.ren('night_vision', 'الرؤية الليلية');
select pg_temp.ren('doll_type', 'نوع الدمية');
select pg_temp.ren('declared_luminous_flux', 'التدفق الضوئي (لومن)', 'Luminous flux');
select pg_temp.ren('declared_key_ingredient', 'المكون الفعّال', 'Key ingredient');
select pg_temp.ren('declared_main_ingredient', 'المكون الأساسي', 'Main ingredient');
select pg_temp.ren('declared_application_area', 'منطقة الاستخدام', 'Application area');
select pg_temp.ren('pump_type', 'نوع شفاط الحليب (يدوي / كهربائي)', 'Breast pump type');
select pg_temp.ren('hood_type', 'نوع الشفاط (مدخنة / مسطح / بلت إن)', 'Hood type');
select pg_temp.ren('cap_type', 'نوع قاعدة اللمبة (E27 / E14…)', 'Bulb base');
select pg_temp.ren('body_material', 'خامة جسم الآلة', 'Body material');

-- 2. CPU threads ≠ fabric threads
insert into public.attribute_defs (code, type, unit, label_ar, label_en, sort)
select 'cpu_thread_count', 'number', '', 'عدد مسارات المعالجة (Threads)', 'Thread count (CPU)', 241
 where not exists (select 1 from public.attribute_defs where code = 'cpu_thread_count' and category_id is null);
select pg_temp.unlink('desktop-processors', array['thread_count','compatible_devices','voltage']);
select pg_temp.link('desktop-processors', array['cpu_thread_count']);

-- 3. specs from another family
select pg_temp.unlink('car-air-fresheners', array['flavor']);
select pg_temp.link('car-air-fresheners', array['fragrance']);
select pg_temp.unlink('car-wash-shampoos', array['suitable_hair_type','fragrance_free']);
select pg_temp.unlink('car-window-sunshades', array['shade_name_or_code','suitable_skin_type','application_area','finish']);
select pg_temp.unlink('vehicle-paint-waxes-and-sealants', array['material','dimensions_w_d_h']);
select pg_temp.unlink('pajamas', array['flavor','net_weight']);
select pg_temp.unlink('micellar-waters', array['usb_port_count','compatible_devices','dimensions_w_d_h','weight']);
select pg_temp.unlink('safety-glasses', array['power','voltage']);
select pg_temp.unlink('dust-masks', array['power','voltage']);
select pg_temp.unlink('levels', array['power','voltage']);
select pg_temp.unlink('workbenches', array['power','voltage']);
select pg_temp.unlink('hairdressing-scissors', array['power','heat_setting_count','temperature_control','ionic_technology']);
select pg_temp.unlink('hair-brushes-and-combs', array['power','heat_setting_count','temperature_control','ionic_technology']);
select pg_temp.unlink('ultrasonic-skin-scrubbers', array['heat_setting_count','temperature_control','ionic_technology']);
select pg_temp.unlink('home-use-ipl-hair-removal-devices', array['heat_setting_count','temperature_control']);
select pg_temp.unlink('epilators', array['heat_setting_count','temperature_control','ionic_technology']);
select pg_temp.unlink('pet-shampoos', array['flavor']);
select pg_temp.unlink('cat-collars', array['flavor','expiry_date']);
select pg_temp.unlink('dog-collars', array['flavor','expiry_date']);
select pg_temp.unlink('cat-beds', array['flavor','expiry_date']);
select pg_temp.unlink('dog-beds', array['flavor','expiry_date']);
select pg_temp.unlink('cat-toys', array['flavor','expiry_date']);
select pg_temp.unlink('dog-toys', array['flavor','expiry_date']);
select pg_temp.unlink('cat-bowls', array['flavor','expiry_date']);
select pg_temp.unlink('dog-bowls', array['flavor','expiry_date']);
select pg_temp.unlink('dishwasher-detergent', array['energy_efficiency_rating','capacity','total_capacity']);
select pg_temp.unlink('hair-conditioners', array['capacity','total_capacity']);
select pg_temp.unlink('baking-parchment', array['product_form','capacity']);
select pg_temp.unlink('digital-thermometers', array['ingredients']);
select pg_temp.unlink('first-aid-and-medical-masks', array['ingredients']);
select pg_temp.unlink('gel-nail-curing-lamps', array['metal_fineness_or_purity','stone_type','clasp_type']);
select pg_temp.unlink('makeup-mirrors', array['pattern']);
select pg_temp.unlink('newborn-essentials', array['weight_capacity']);
select pg_temp.unlink('bird-toys', array['weight_capacity','age_group']);
select pg_temp.unlink('gifts-and-favors-board-games', array['weight_capacity']);
select pg_temp.unlink('disposable-household-gloves', array['thread_count','machine_washable']);
select pg_temp.unlink('facial-rollers-and-gua-sha-tools', array['thread_count']);
select pg_temp.unlink('window-squeegees', array['thread_count']);
select pg_temp.unlink('dish-sponges-and-scourers', array['thread_count']);
select pg_temp.unlink('brooms-and-dustpans', array['thread_count']);
select pg_temp.unlink('waste-bins', array['thread_count']);
select pg_temp.unlink('floor-mops', array['thread_count']);
select pg_temp.unlink('guitar-amplifiers', array['display_size','resolution','hdr']);
select pg_temp.unlink('smart-cameras', array['display_size']);
select pg_temp.unlink('instrument-cables', array['power_output']);
select pg_temp.unlink('mp3-players', array['power']);
select pg_temp.unlink('desktops', array['battery_life']);
select pg_temp.unlink('eggs', array['main_ingredient']);
select pg_temp.unlink('scalp-scrubs', array['declared_main_ingredient']);  -- duplicate of main_ingredient
select pg_temp.unlink('nintendo-switch-and-video-games-discs', array['coverage']);
select pg_temp.unlink('routers-and-cables', array['coverage']);
select pg_temp.link('routers-and-cables', array['declared_coverage_area']);
-- one generic template was copied onto solid perfume / repellent / mouthwash tablets / face paint / lip tint
select pg_temp.unlink('solid-perfumes', array['size','finish','suitable_age_group']);
select pg_temp.link('solid-perfumes', array['net_weight','fragrance_family']);
select pg_temp.unlink('insect-repellents', array['size','finish']);
select pg_temp.link('insect-repellents', array['net_volume','product_form']);
select pg_temp.unlink('mouthwash-tablets', array['size','finish','fragrance']);
select pg_temp.link('mouthwash-tablets', array['flavor']);
select pg_temp.unlink('face-paints', array['size']);
select pg_temp.link('face-paints', array['net_weight']);
select pg_temp.unlink('lip-tints', array['size']);
select pg_temp.link('lip-tints', array['net_volume','shade_name_or_code']);
-- perfume pages: «fragrance-free» and skin type make no sense on perfume
select pg_temp.unlink('gifts-and-favors-perfumes', array['suitable_skin_type','fragrance_free']);
select pg_temp.unlink('body-and-hair-mists', array['fragrance_free','declared_application_area']);
select pg_temp.unlink('refillable-perfume-atomizers', array['fragrance_family','fragrance_concentration','net_volume','application_area']);

-- 4. thin templates
select pg_temp.link('gaming-mouse-pads', array['dimensions','material','color','model']);
select pg_temp.link('gaming-headset-stands', array['material','color','dimensions','compatibility','model']);
select pg_temp.link('gaming-keyboards', array['model','color','dimensions','weight']);
select pg_temp.link('gift-wrapping-paper', array['material','color','roll_length']);
select pg_temp.link('camera-straps', array['material','color','length','compatibility']);
select pg_temp.link('lenses', array['model','lens_mount']);
select pg_temp.link('painting-tools', array['size','model']);
select pg_temp.link('contact-lenses-and-solutions', array['color','pieces_per_pack','expiry_date']);
select pg_temp.link('hair-ties', array['material','color']);
select pg_temp.link('hair-wraps', array['fabric_material','color','size']);
select pg_temp.link('watch-accessories-watch-accessories', array['compatibility']);
select pg_temp.link('eyewear-accessories', array['compatibility']);
select pg_temp.link('baby-nail-clippers', array['material','color','age_group']);
select pg_temp.link('safety-razors', array['material','blade_material','pieces_per_pack','color']);
select pg_temp.link('cufflinks-and-tie-clips', array['material','piece_count']);
select pg_temp.link('water-filter-cartridges', array['model','material','pieces_per_pack']);
select pg_temp.link('wigs-and-hair-extensions', array['material','length','size']);
