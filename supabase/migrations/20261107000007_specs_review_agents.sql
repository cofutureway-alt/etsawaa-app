-- Spec review, fourth pass (2026-11-07): five parallel reviewers read every category
-- template and the full spec dictionary; their findings were validated against live
-- data (slug exists, removed spec is linked, added spec exists) and merged:
--  * ~430 misplaced or duplicate specs removed from ~400 categories (warranty on food,
--    cosmetics, cleaning products & clothing; «الخامة» repeating upper/frame/base material;
--    bag size repeating W×D×H; laptop specs on phones; sleeve length on sleeveless tops…)
--  * ~75 core specs added (processor + screen on laptops, connection on drives, suction
--    rate on hoods, ball size on balls, heel type moved from flats to heels…)
--  * 39 unclear labels renamed, 30 category names corrected
-- Links that hold product values are never removed.

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
-- remove p_code from every category that also has one of p_present
-- labels
update public.attribute_defs set label_ar = 'درجة الخشونة' where code = 'abrasiveness' and category_id is null;  -- was درجة الخشونة (كشط)
update public.attribute_defs set label_ar = 'طريقة التثبيت' where code = 'attachment_method' and category_id is null;  -- was طريقة تثبيت الملحقات
update public.attribute_defs set label_ar = 'مقاس محيط الصدر' where code = 'band_size' and category_id is null;  -- was مقاس محيط الصدر حسب نظام المقاسات
update public.attribute_defs set label_ar = 'عدد قطع الصابون في العبوة' where code = 'bars_per_pack' and category_id is null;  -- was عدد الألواح في العبوة
update public.attribute_defs set label_ar = 'نوع الزيت الأساسي' where code = 'base_oil_type' and category_id is null;  -- was نوع الزيت المناسب
update public.attribute_defs set label_ar = 'مقاس السرير', label_en = 'Bed Size' where code = 'bed_size_category' and category_id is null;  -- was فئة مقاس السرير
update public.attribute_defs set label_ar = 'مكالمات بلوتوث' where code = 'bluetooth_calling' and category_id is null;  -- was إجراء مكالمات Bluetooth
update public.attribute_defs set label_ar = 'نوع الشاحن' where code = 'charger_type' and category_id is null;  -- was نوع الشحن
update public.attribute_defs set label_ar = 'المركبات أو فئة المقاس المتوافقة' where code = 'compatible_vehicles_or_size_class' and category_id is null;  -- was السيارات أو فئة المقاس المتوافقة
update public.attribute_defs set label_ar = 'نوع أداة التجعيد' where code = 'curler_type' and category_id is null;  -- was نوع جهاز التجعيد
update public.attribute_defs set label_ar = 'كثافة النسيج (دنير)' where code = 'denier' and category_id is null;  -- was سمك النسيج بالدنيير
update public.attribute_defs set label_ar = 'شكل المنظف (بودرة / سائل / أقراص)' where code = 'detergent_form' and category_id is null;  -- was شكل مسحوق الغسيل
update public.attribute_defs set label_ar = 'الأبعاد (طول × عرض × ارتفاع)' where code = 'dimensions_l_w_h' and category_id is null;  -- was الأبعاد: طول × عرض × ارتفاع
update public.attribute_defs set label_ar = 'قابلة للتعتيم' where code = 'dimmable' and category_id is null;  -- was قابلة لتعتيم الإضاءة
update public.attribute_defs set label_ar = 'عدد الأدراج أو الأقسام' where code = 'drawer_or_compartment_count' and category_id is null;  -- was عدد الإدراج أو الأقسام
update public.attribute_defs set label_ar = 'صينية تجميع المياه مرفقة' where code = 'drip_tray_included' and category_id is null;  -- was صينية لتجميع الماء
update public.attribute_defs set label_ar = 'قطر وحدة الصوت (الدرايفر)' where code = 'driver_size' and category_id is null;  -- was قطر مكبر الصوت
update public.attribute_defs set label_ar = 'نوع وسط الترشيح' where code = 'filter_media_type' and category_id is null;  -- was وضع وسط الترشيح
update public.attribute_defs set label_ar = 'طريقة التثبيت' where code = 'fixing_method' and category_id is null;  -- was طريقة التثبيت (أدوات التثبيت)
update public.attribute_defs set label_ar = 'مقاس الفريم (الهيكل)' where code = 'frame_size' and category_id is null;  -- was مقاس الإطار
update public.attribute_defs set label_ar = 'مثبت الصورة داخل جسم الكاميرا' where code = 'in_body_image_stabilization' and category_id is null;  -- was تثبيت صورة داخل الجسم
update public.attribute_defs set label_ar = 'الملحقات المرفقة' where code = 'included_attachments' and category_id is null;  -- was المرفقات المرفقة
update public.attribute_defs set label_ar = 'المحيط الداخلي أو الطول', label_en = 'Inner Circumference or Length' where code = 'inner_circumference_or_length' and category_id is null;  -- was المحيط أو الطول الخارجي
update public.attribute_defs set label_ar = 'نوع ماونت العدسة' where code = 'lens_mount' and category_id is null;  -- was حامل العدسة
update public.attribute_defs set label_ar = 'نوع القفل' where code = 'lock_type' and category_id is null;  -- was نوع القفل (أمان)
update public.attribute_defs set label_ar = 'أقصى وزن للطفل' where code = 'maximum_baby_weight' and category_id is null;  -- was أقصى وزن للحفاض
update public.attribute_defs set label_ar = 'دقة الكاميرا (ميجابكسل)' where code = 'megapixels' and category_id is null;  -- was دقة الكاميرات
update public.attribute_defs set label_ar = 'أقل وزن للطفل' where code = 'minimum_baby_weight' and category_id is null;  -- was أقل وزن للحفاض
update public.attribute_defs set label_ar = 'وزن القفاز (أونصة)', label_en = 'Glove Weight (oz)' where code = 'nominal_glove_weight' and category_id is null;  -- was الوزن الاسمي للقفاز
update public.attribute_defs set label_ar = 'نوع الطلاء' where code = 'polish_type' and category_id is null;  -- was نوع التلميع
update public.attribute_defs set label_ar = 'قدرة الخرج' where code = 'power_output' and category_id is null;  -- was القدرة الخارجة
update public.attribute_defs set label_ar = 'عدد الأوراق المقطعة في العبوة' where code = 'pre_cut_sheets_per_pack' and category_id is null;  -- was عدد العبوات المقطعة بالعبوة
update public.attribute_defs set label_ar = 'طريقة الاستخدام (بالشطف / بدون شطف)' where code = 'rinse_out_or_leave_in' and category_id is null;  -- was يُشطف أم يُترك
update public.attribute_defs set label_ar = 'عدد المقاعد' where code = 'seating_capacity' and category_id is null;  -- was سعة المقاعد
update public.attribute_defs set label_ar = 'المقاسات وأكواد الرؤوس', label_en = 'Sizes and Tip Codes' where code = 'sizes_and_tip_codes' and category_id is null;  -- was المقاسات واكواد الرؤوس
update public.attribute_defs set label_ar = 'عدد الأقسام', label_en = 'Compartment Count' where code = 'sorting_compartment_count' and category_id is null;  -- was عدد أقسام الفرز
update public.attribute_defs set label_ar = 'التركيز', label_en = 'Strength' where code = 'strength_as_labeled' and category_id is null;  -- was التركيز كما على العبوة
update public.attribute_defs set label_ar = 'الوزن الإجمالي للقطعة' where code = 'total_item_weight' and category_id is null;  -- was وزن القطعة الكامل
update public.attribute_defs set label_ar = 'أطوال شفرات المساحات' where code = 'wiper_blade_lengths' and category_id is null;  -- was أأطوال شفرات المساحات
-- category names
update public.categories set name_ar = 'مكبرات الصوت (أمبليفاير)' where slug_en = 'amplifiers' and deleted_at is null;  -- was مسرح منزلي وساوند بار
update public.categories set name_ar = 'جيم ألعاب الرضع (بلاي جيم)' where slug_en = 'baby-play-gyms' and deleted_at is null;  -- was سجادة ألعاب الرضع
update public.categories set name_ar = 'سجادة لعب للرضع' where slug_en = 'baby-play-mats' and deleted_at is null;  -- was سجادة العاب الرضع
update public.categories set name_ar = 'حذاء باليرينا' where slug_en = 'ballet-flats' and deleted_at is null;  -- was الأحذية الباليرينا
update public.categories set name_ar = 'كلاسير (ملف حلقات)' where slug_en = 'binders' and deleted_at is null;  -- was ملف ورقي
update public.categories set name_ar = 'ألعاب الطاولة والكروت' where slug_en = 'board-and-card-games' and deleted_at is null;  -- was لعبة الطاولة
update public.categories set name_ar = 'تانك توب أولادي' where slug_en = 'boys-tank-tops' and deleted_at is null;  -- was توب أولادي كت
update public.categories set name_ar = 'حبوب الإفطار' where slug_en = 'breakfast-cereals' and deleted_at is null;  -- was كورن فليكس
update public.categories set name_ar = 'بنطلون كولوت' where slug_en = 'culottes' and deleted_at is null;  -- was بنطلون كيلوت
update public.categories set name_ar = 'ملابس بيت بناتي' where slug_en = 'girls-clothing-home-wear' and deleted_at is null;  -- was ملابس بيت
update public.categories set name_ar = 'تانك توب بناتي' where slug_en = 'girls-tank-tops' and deleted_at is null;  -- was توب بناتي كت
update public.categories set name_ar = 'ذهب' where slug_en = 'gold' and deleted_at is null;  -- was ذهب و فضة
update public.categories set name_ar = 'توك شعر' where slug_en = 'hair-ties' and deleted_at is null;  -- was توك وبندانات ومشابك شعر
update public.categories set name_ar = 'ديكور منزلي يدوي' where slug_en = 'handmade-home-decor' and deleted_at is null;  -- was شموع معطرة
update public.categories set name_ar = 'حلي وشنط يدوية' where slug_en = 'handmade-jewelry-and-bags' and deleted_at is null;  -- was حلي
update public.categories set name_ar = 'سماعات الرأس' where slug_en = 'headphones' and deleted_at is null;  -- was سماعات بلوتوث
update public.categories set name_ar = 'بونيه الحجاب' where slug_en = 'hijab-undercaps' and deleted_at is null;  -- was بندانة الحجاب
update public.categories set name_ar = 'كريم شعر بدون شطف (ليف إن)' where slug_en = 'leave-in-hair-creams' and deleted_at is null;  -- was كريم يترك على الشعر
update public.categories set name_ar = 'أدوات المكياج' where slug_en = 'makeup-tools' and deleted_at is null;  -- was فرش مكياج
update public.categories set name_ar = 'أطقم ملابس حديثي الولادة' where slug_en = 'newborn-clothing-sets' and deleted_at is null;  -- was مستلزمات ملابس حديثي الولادة
update public.categories set name_ar = 'نينتندو سويتش وأسطوانات ألعاب' where slug_en = 'nintendo-switch-and-video-games-discs' and deleted_at is null;  -- was نينتندو سويتش واسطوانات ألعاب
update public.categories set name_ar = 'أجهزة بلايستيشن وإكس بوكس' where slug_en = 'playstation-and-xbox-consoles' and deleted_at is null;  -- was أجهزة البلايستيشن والإكس بوكس ونينتندو سويتش وأسطوانات وألعاب الفيديو
update public.categories set name_ar = 'طابعات' where slug_en = 'printers' and deleted_at is null;  -- was طابعات و اسكنرز وأحبار
update public.categories set name_ar = 'سالوبيتات' where slug_en = 'rompers' and deleted_at is null;  -- was سلوبيتات
update public.categories set name_ar = 'واقي الشاشة' where slug_en = 'screen-protectors' and deleted_at is null;  -- was شاشات حماية
update public.categories set name_ar = 'فستان قميص' where slug_en = 'shirt-dresses' and deleted_at is null;  -- was فستان بقميص
update public.categories set name_ar = 'الساعات الذكية والباند الرياضي' where slug_en = 'smartwatches-and-bands' and deleted_at is null;  -- was الساعات الذكية والباند الرياضي (Smart Bands)
update public.categories set name_ar = 'واقي شاشة التابلت' where slug_en = 'tablet-screen-protectors' and deleted_at is null;  -- was سكرين تابلت
update public.categories set name_ar = 'توب تيوب (بدون حمالات)' where slug_en = 'tube-tops' and deleted_at is null;  -- was توب أنبوبي
update public.categories set name_ar = 'شال باشمينا حريمي' where slug_en = 'womens-pashmina-shawls' and deleted_at is null;  -- was شال بسمينة حريمي
-- per-category fixes
select pg_temp.link('2-in-1-laptops', array['processor','screen_size']::text[]);
select pg_temp.unlink('accessories-backpacks', array['bag_dimensions']::text[]);
select pg_temp.unlink('accessories-sunglasses', array['color']::text[]);
select pg_temp.unlink('aftershaves', array['warranty_period']::text[]);
select pg_temp.link('all-in-one-pcs', array['processor']::text[]);
select pg_temp.unlink('aluminum-foil', array['warranty_period']::text[]);
select pg_temp.unlink('amplifiers', array['battery_life','driver_size']::text[]);
select pg_temp.unlink('anklets', array['material']::text[]);
select pg_temp.unlink('baby-bodysuits', array['warranty_period']::text[]);
select pg_temp.unlink('baby-diapers', array['warranty_period']::text[]);
select pg_temp.unlink('baby-food-jars', array['color']::text[]);
select pg_temp.unlink('baby-play-gyms', array['material']::text[]);
select pg_temp.unlink('baby-shoes', array['material']::text[]);
select pg_temp.unlink('baby-sleepsuits-and-rompers', array['warranty_period']::text[]);
select pg_temp.unlink('baby-walkers', array['pieces_count']::text[]);
select pg_temp.link('baby-walkers', array['color']::text[]);
select pg_temp.unlink('backpacks-backpacks', array['bag_dimensions']::text[]);
select pg_temp.unlink('baking-parchment', array['warranty_period']::text[]);
select pg_temp.unlink('ballet-flats', array['material','heel_type']::text[]);
select pg_temp.unlink('barber-neck-strips', array['warranty_period','pieces_per_pack']::text[]);
select pg_temp.link('basketballs', array['ball_size']::text[]);
select pg_temp.unlink('bath-mats', array['size']::text[]);
select pg_temp.unlink('bath-pillows', array['size']::text[]);
select pg_temp.unlink('bath-salts-and-bath-bombs', array['warranty_period','net_volume']::text[]);
select pg_temp.unlink('bathroom-shelves', array['size']::text[]);
select pg_temp.link('beach-and-pool-accessories-towels', array['dimensions']::text[]);
select pg_temp.unlink('beach-bags', array['bag_dimensions']::text[]);
select pg_temp.link('beach-towels', array['dimensions']::text[]);
select pg_temp.unlink('bicycle-helmets', array['sport','level']::text[]);
select pg_temp.unlink('bidet-sprayers', array['size']::text[]);
select pg_temp.unlink('biscuits-and-cookies', array['warranty_period']::text[]);
select pg_temp.unlink('blazers', array['warranty_period']::text[]);
select pg_temp.unlink('blushes', array['warranty_period']::text[]);
select pg_temp.unlink('board-and-card-games', array['suitable_age_group']::text[]);
select pg_temp.unlink('body-and-hair-mists', array['warranty_period']::text[]);
select pg_temp.unlink('body-lotions', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('body-oils', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('body-powders', array['warranty_period','net_volume']::text[]);
select pg_temp.unlink('body-scrubs', array['warranty_period']::text[]);
select pg_temp.unlink('body-washes', array['warranty_period']::text[]);
select pg_temp.unlink('bottle-cleaning-brushes', array['suitable_age_group']::text[]);
select pg_temp.unlink('bottle-sterilizers', array['suitable_age_group']::text[]);
select pg_temp.unlink('bottle-warmers', array['suitable_age_group']::text[]);
select pg_temp.unlink('bottled-drinking-water', array['warranty_period']::text[]);
select pg_temp.unlink('boxing-gloves', array['material','weight','dimensions_w_d_h']::text[]);
select pg_temp.unlink('bracelets', array['material']::text[]);
select pg_temp.unlink('breast-milk-storage-bags', array['warranty_period','suitable_age_group']::text[]);
select pg_temp.unlink('breast-pumps', array['suitable_age_group']::text[]);
select pg_temp.unlink('briefcases-and-document-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('bronzers', array['warranty_period']::text[]);
select pg_temp.unlink('brow-makeup', array['warranty_period']::text[]);
select pg_temp.unlink('building-block-sets', array['suitable_age_group']::text[]);
select pg_temp.link('business-laptops', array['processor','screen_size']::text[]);
select pg_temp.unlink('camera-lenses', array['lens_filter_category']::text[]);
select pg_temp.unlink('camera-memory-cards', array['connectivity','weight']::text[]);
select pg_temp.link('camera-memory-cards', array['speed_class_ratings','advertised_read_speed']::text[]);
select pg_temp.unlink('canned-tuna-and-fish', array['warranty_period']::text[]);
select pg_temp.unlink('car-air-fresheners', array['warranty_period']::text[]);
select pg_temp.link('car-chargers', array['output_port_types','fast_charging_protocols']::text[]);
select pg_temp.unlink('car-fluids', array['material','dimensions','warranty_period']::text[]);
select pg_temp.unlink('car-polishes', array['warranty_period']::text[]);
select pg_temp.link('car-polishes', array['pack_volume','product_form']::text[]);
select pg_temp.unlink('car-seat-covers', array['compatible_vehicles']::text[]);
select pg_temp.unlink('car-wash-shampoos', array['warranty_period']::text[]);
select pg_temp.unlink('carpets-and-mats', array['mounting_type']::text[]);
select pg_temp.unlink('casual-and-school-backpacks', array['bag_dimensions']::text[]);
select pg_temp.link('ceiling-fans', array['speed_setting_count']::text[]);
select pg_temp.unlink('charging-and-data-cables', array['charging_port_type']::text[]);
select pg_temp.unlink('cheese', array['warranty_period']::text[]);
select pg_temp.unlink('childrens-play-tents', array['included_batteries','power_source']::text[]);
select pg_temp.link('chimney-hoods', array['air_extraction_rate']::text[]);
select pg_temp.unlink('chips-and-savory-snacks', array['warranty_period']::text[]);
select pg_temp.unlink('chocolate', array['warranty_period']::text[]);
select pg_temp.link('circular-saws', array['disc_diameter']::text[]);
select pg_temp.unlink('clothes-hangers', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('coffee', array['warranty_period']::text[]);
select pg_temp.unlink('coffee-filters', array['warranty_period']::text[]);
select pg_temp.unlink('concealers', array['warranty_period']::text[]);
select pg_temp.unlink('contact-lenses-and-solutions', array['warranty_period']::text[]);
select pg_temp.unlink('contour-makeup', array['warranty_period']::text[]);
select pg_temp.unlink('cooking-oil', array['warranty_period']::text[]);
select pg_temp.unlink('cosmetic-cotton-pads', array['warranty_period']::text[]);
select pg_temp.unlink('cotton-swabs', array['warranty_period']::text[]);
select pg_temp.unlink('crossbody-and-shoulder-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('cuticle-oils', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('dates', array['warranty_period']::text[]);
select pg_temp.unlink('dental-floss-and-floss-picks', array['warranty_period']::text[]);
select pg_temp.unlink('deodorants-and-antiperspirants', array['warranty_period']::text[]);
select pg_temp.unlink('depilatory-creams', array['warranty_period']::text[]);
select pg_temp.unlink('depilatory-waxes-and-wax-strips', array['warranty_period']::text[]);
select pg_temp.unlink('diaper-and-changing-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('dining-chairs', array['material']::text[]);
select pg_temp.unlink('dish-sponges-and-scourers', array['warranty_period']::text[]);
select pg_temp.unlink('dishwasher-detergent', array['warranty_period']::text[]);
select pg_temp.unlink('disposable-household-gloves', array['warranty_period']::text[]);
select pg_temp.unlink('dolls', array['suitable_age_group']::text[]);
select pg_temp.unlink('doorbell-cameras', array['sensor_size']::text[]);
select pg_temp.link('doorbell-cameras', array['night_vision']::text[]);
select pg_temp.unlink('drawing-tablets', array['power']::text[]);
select pg_temp.unlink('dried-pulses', array['warranty_period']::text[]);
select pg_temp.unlink('drinking-water-purifiers', array['capacity']::text[]);
select pg_temp.unlink('drumsticks', array['body_material']::text[]);
select pg_temp.link('drumsticks', array['material']::text[]);
select pg_temp.unlink('dry-shampoos', array['warranty_period']::text[]);
select pg_temp.unlink('dumbbells', array['weight']::text[]);
select pg_temp.unlink('dust-masks', array['piece_count','warranty_period']::text[]);
select pg_temp.unlink('duvets-and-comforters', array['material']::text[]);
select pg_temp.unlink('earplugs', array['dimensions_w_d_h','warranty_period']::text[]);
select pg_temp.unlink('electric-hobs', array['flame_failure_safety','material']::text[]);
select pg_temp.unlink('electric-kettles', array['material']::text[]);
select pg_temp.unlink('empty-hair-mist-spray-bottles', array['pieces_per_pack','material']::text[]);
select pg_temp.unlink('energy-drinks', array['warranty_period']::text[]);
select pg_temp.unlink('engine-air-filters', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('engine-coolants', array['warranty_period']::text[]);
select pg_temp.unlink('engine-oils', array['warranty_period']::text[]);
select pg_temp.unlink('evening-bags-and-clutches', array['bag_dimensions']::text[]);
select pg_temp.link('external-hard-drives', array['connection_interface']::text[]);
select pg_temp.link('external-ssds', array['connection_interface']::text[]);
select pg_temp.unlink('eye-creams', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('eyeglasses-and-frames', array['material']::text[]);
select pg_temp.unlink('eyelash-adhesives', array['warranty_period']::text[]);
select pg_temp.unlink('eyeliners-and-kohl', array['warranty_period']::text[]);
select pg_temp.unlink('eyeshadow-palettes', array['warranty_period']::text[]);
select pg_temp.unlink('fabric-softener', array['warranty_period']::text[]);
select pg_temp.unlink('face-masks', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('face-powders', array['warranty_period']::text[]);
select pg_temp.unlink('face-primers', array['warranty_period']::text[]);
select pg_temp.unlink('facial-cleansers', array['warranty_period']::text[]);
select pg_temp.unlink('facial-exfoliators', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('facial-moisturizers', array['warranty_period']::text[]);
select pg_temp.unlink('facial-serums', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('facial-tissues', array['warranty_period','fragrance_free']::text[]);
select pg_temp.unlink('facial-toners', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('false-nail-adhesives', array['warranty_period']::text[]);
select pg_temp.unlink('fashion-gloves', array['dimensions_w_d_h','warranty_period']::text[]);
select pg_temp.link('feature-phones', array['screen_size','active_sim_count']::text[]);
select pg_temp.link('fire-extinguishers', array['capacity']::text[]);
select pg_temp.unlink('flats', array['material']::text[]);
select pg_temp.unlink('floor-cleaner', array['warranty_period']::text[]);
select pg_temp.unlink('flour', array['warranty_period']::text[]);
select pg_temp.unlink('foldable-phones', array['graphics']::text[]);
select pg_temp.link('foldable-phones', array['battery_capacity','main_rear_camera_resolution']::text[]);
select pg_temp.unlink('folding-camping-chairs', array['material','dimensions_w_d_h']::text[]);
select pg_temp.unlink('food-cling-film', array['warranty_period']::text[]);
select pg_temp.unlink('foot-creams', array['warranty_period']::text[]);
select pg_temp.unlink('footballs', array['material']::text[]);
select pg_temp.unlink('foundations', array['warranty_period']::text[]);
select pg_temp.unlink('fragrance-gift-sets', array['warranty_period']::text[]);
select pg_temp.unlink('frozen-vegetables-and-fruit', array['warranty_period']::text[]);
select pg_temp.link('gaming-laptops', array['processor','screen_size']::text[]);
select pg_temp.link('gaming-mice', array['maximum_sensor_sensitivity']::text[]);
select pg_temp.unlink('gas-hobs', array['material']::text[]);
select pg_temp.unlink('gifts-and-favors-handbags', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('gifts-and-favors-perfumes', array['net_volume','warranty_period']::text[]);
select pg_temp.unlink('gifts-and-favors-plush-toys', array['suitable_age_group','material']::text[]);
select pg_temp.unlink('girls-dresses', array['warranty_period']::text[]);
select pg_temp.unlink('glass-cleaner', array['warranty_period']::text[]);
select pg_temp.unlink('guitar-accessories', array['finish']::text[]);
select pg_temp.unlink('gym-and-duffel-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('hair-clips-and-pins', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('hair-color-developers', array['warranty_period']::text[]);
select pg_temp.unlink('hair-concealing-fibers', array['warranty_period','net_volume','main_ingredient','color']::text[]);
select pg_temp.unlink('hair-conditioners', array['warranty_period']::text[]);
select pg_temp.unlink('hair-dyes-and-color-kits', array['warranty_period','color']::text[]);
select pg_temp.unlink('hair-extensions', array['color']::text[]);
select pg_temp.unlink('hair-heat-protectants', array['warranty_period']::text[]);
select pg_temp.unlink('hair-lightening-powders', array['warranty_period','color']::text[]);
select pg_temp.unlink('hair-masks', array['warranty_period']::text[]);
select pg_temp.unlink('hair-serums-and-oils', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('hair-steamers', array['cordless_runtime']::text[]);
select pg_temp.unlink('hair-straighteners', array['temperature_control']::text[]);
select pg_temp.unlink('hair-styling-and-hold-products', array['warranty_period']::text[]);
select pg_temp.unlink('halter-tops', array['sleeve_length']::text[]);
select pg_temp.unlink('hand-creams', array['warranty_period']::text[]);
select pg_temp.unlink('hand-dishwashing-liquid', array['warranty_period']::text[]);
select pg_temp.unlink('hand-sanitizers', array['warranty_period','main_ingredient']::text[]);
select pg_temp.unlink('handbag-organizer-inserts', array['bag_dimensions']::text[]);
select pg_temp.unlink('handbags-handbags', array['bag_dimensions']::text[]);
select pg_temp.unlink('handmade-home-decor', array['fragrance']::text[]);
select pg_temp.unlink('headphones', array['power_output']::text[]);
select pg_temp.unlink('heated-straightening-brushes', array['temperature_control']::text[]);
select pg_temp.unlink('heels', array['material']::text[]);
select pg_temp.link('heels', array['heel_type']::text[]);
select pg_temp.unlink('highlighters', array['warranty_period']::text[]);
select pg_temp.unlink('home-theater-and-speakers-headphones', array['power_output']::text[]);
select pg_temp.unlink('honey', array['warranty_period']::text[]);
select pg_temp.unlink('ice-molds', array['microwave_safe']::text[]);
select pg_temp.unlink('instant-cameras', array['sensor_size']::text[]);
select pg_temp.unlink('instant-water-heaters', array['capacity']::text[]);
select pg_temp.unlink('instrument-cases', array['finish']::text[]);
select pg_temp.link('internal-hard-drives', array['connection_interface','drive_form_factor']::text[]);
select pg_temp.link('internal-ssds', array['connection_interface','drive_form_factor']::text[]);
select pg_temp.link('island-hoods', array['air_extraction_rate']::text[]);
select pg_temp.unlink('jams-and-sweet-spreads', array['warranty_period']::text[]);
select pg_temp.unlink('jigsaw-puzzles', array['suitable_age_group']::text[]);
select pg_temp.unlink('juice-extractors', array['capacity']::text[]);
select pg_temp.unlink('kids-and-baby-perfumes', array['warranty_period']::text[]);
select pg_temp.unlink('kids-clothing-sets', array['warranty_period']::text[]);
select pg_temp.unlink('kids-sandals', array['material']::text[]);
select pg_temp.unlink('kids-underwear', array['warranty_period']::text[]);
select pg_temp.unlink('kitchen-knives-and-sets', array['material']::text[]);
select pg_temp.link('kitchen-knives-and-sets', array['handle_material']::text[]);
select pg_temp.unlink('kitchen-paper-towels', array['warranty_period']::text[]);
select pg_temp.unlink('laptop-bags', array['dimensions_w_d_h']::text[]);
select pg_temp.link('laptop-batteries', array['compatible_devices']::text[]);
select pg_temp.link('laptop-chargers', array['compatible_devices']::text[]);
select pg_temp.unlink('lash-application-under-eye-pads', array['warranty_period']::text[]);
select pg_temp.unlink('laundry-detergent', array['warranty_period']::text[]);
select pg_temp.unlink('leave-in-hair-creams', array['warranty_period']::text[]);
select pg_temp.unlink('lip-balms', array['warranty_period']::text[]);
select pg_temp.unlink('lip-glosses-and-lip-oils', array['warranty_period']::text[]);
select pg_temp.unlink('lip-liners', array['warranty_period']::text[]);
select pg_temp.unlink('lip-tints', array['suitable_age_group']::text[]);
select pg_temp.unlink('lipsticks', array['warranty_period']::text[]);
select pg_temp.unlink('liquid-hand-washes', array['warranty_period']::text[]);
select pg_temp.unlink('luggage-covers', array['bag_dimensions']::text[]);
select pg_temp.unlink('lunch-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('makeup-bags-and-cases', array['declared_dimensions']::text[]);
select pg_temp.unlink('makeup-brush-cleansers', array['warranty_period']::text[]);
select pg_temp.unlink('makeup-organizers', array['bag_dimensions']::text[]);
select pg_temp.unlink('makeup-removers', array['warranty_period']::text[]);
select pg_temp.unlink('makeup-setting-sprays', array['warranty_period']::text[]);
select pg_temp.unlink('manual-eyelash-curlers', array['body_material']::text[]);
select pg_temp.unlink('manual-razors', array['pieces_per_pack']::text[]);
select pg_temp.unlink('manual-screwdrivers-and-sets', array['material']::text[]);
select pg_temp.unlink('mascaras', array['warranty_period']::text[]);
select pg_temp.unlink('mattresses', array['thread_count']::text[]);
select pg_temp.link('mechanical-keyboards', array['key_switch_technology']::text[]);
select pg_temp.unlink('men-sports-shoes-sneakers', array['material']::text[]);
select pg_temp.unlink('mens-ankle-boots', array['material']::text[]);
select pg_temp.unlink('mens-basketball-shoes', array['material']::text[]);
select pg_temp.link('mens-basketball-shoes', array['color']::text[]);
select pg_temp.unlink('mens-boots', array['material']::text[]);
select pg_temp.unlink('mens-brogues', array['material']::text[]);
select pg_temp.unlink('mens-chelsea-boots', array['material']::text[]);
select pg_temp.unlink('mens-classic-casual-shoes', array['material']::text[]);
select pg_temp.unlink('mens-clogs', array['material']::text[]);
select pg_temp.unlink('mens-derby-shoes', array['material']::text[]);
select pg_temp.unlink('mens-espadrilles', array['material']::text[]);
select pg_temp.unlink('mens-football-boots', array['material']::text[]);
select pg_temp.link('mens-football-boots', array['color']::text[]);
select pg_temp.unlink('mens-formal-shoes', array['material']::text[]);
select pg_temp.unlink('mens-hiking-boots', array['material']::text[]);
select pg_temp.unlink('mens-home-slippers', array['material']::text[]);
select pg_temp.unlink('mens-knee-high-boots', array['material']::text[]);
select pg_temp.unlink('mens-loafers', array['material']::text[]);
select pg_temp.unlink('mens-moccasins', array['material']::text[]);
select pg_temp.unlink('mens-oxford-shoes', array['material']::text[]);
select pg_temp.unlink('mens-perfumes-mens-perfumes', array['warranty_period']::text[]);
select pg_temp.unlink('mens-pocket-watches', array['strap_material']::text[]);
select pg_temp.unlink('mens-running-and-training-shoes', array['material']::text[]);
select pg_temp.unlink('mens-running-shoes', array['material']::text[]);
select pg_temp.unlink('mens-sandals-and-slippers', array['material']::text[]);
select pg_temp.unlink('mens-shirts', array['warranty_period']::text[]);
select pg_temp.unlink('mens-sneakers-and-sports-shoes', array['material']::text[]);
select pg_temp.unlink('mens-tank-tops', array['sleeve_length']::text[]);
select pg_temp.unlink('mens-tennis-shoes', array['material']::text[]);
select pg_temp.link('mens-tennis-shoes', array['color']::text[]);
select pg_temp.unlink('mens-trail-running-shoes', array['material']::text[]);
select pg_temp.unlink('mens-underwear', array['warranty_period']::text[]);
select pg_temp.unlink('mens-waistcoats', array['sleeve_length']::text[]);
select pg_temp.unlink('mens-walking-shoes', array['material']::text[]);
select pg_temp.unlink('mens-work-boots', array['material']::text[]);
select pg_temp.unlink('micellar-waters', array['warranty_period']::text[]);
select pg_temp.unlink('microfiber-cleaning-cloths', array['material','warranty_period']::text[]);
select pg_temp.unlink('milk', array['warranty_period']::text[]);
select pg_temp.link('mini-pcs', array['processor']::text[]);
select pg_temp.unlink('mobile-chargers', array['power']::text[]);
select pg_temp.link('mobile-phone-batteries', array['compatible_phone_models']::text[]);
select pg_temp.unlink('motorcycle-batteries', array['position']::text[]);
select pg_temp.link('motorcycle-batteries', array['battery_capacity']::text[]);
select pg_temp.unlink('motorcycle-helmets', array['compatible_vehicles']::text[]);
select pg_temp.unlink('mouthwashes', array['warranty_period']::text[]);
select pg_temp.unlink('multipurpose-cleaner', array['warranty_period']::text[]);
select pg_temp.unlink('nail-art-decorations-and-stickers', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('nail-polish-removers', array['warranty_period']::text[]);
select pg_temp.unlink('nail-polishes', array['warranty_period']::text[]);
select pg_temp.unlink('necklaces-and-chains', array['material']::text[]);
select pg_temp.unlink('network-cables', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('newborn-clothing-sets', array['warranty_period']::text[]);
select pg_temp.unlink('nuts', array['warranty_period']::text[]);
select pg_temp.unlink('oil-blotting-sheets', array['warranty_period','net_volume','main_ingredient']::text[]);
select pg_temp.link('otg-adapters', array['connector_type']::text[]);
select pg_temp.unlink('packaged-juice', array['warranty_period']::text[]);
select pg_temp.unlink('pajamas', array['warranty_period']::text[]);
select pg_temp.unlink('pasta', array['warranty_period']::text[]);
select pg_temp.unlink('pc-power-supplies', array['power']::text[]);
select pg_temp.link('pedestal-fans', array['speed_setting_count']::text[]);
select pg_temp.unlink('perfumes', array['warranty_period']::text[]);
select pg_temp.unlink('personal-cleansing-wipes', array['warranty_period','net_volume']::text[]);
select pg_temp.unlink('phone-cases', array['compatible_devices','dimensions_w_d_h']::text[]);
select pg_temp.unlink('phone-screen-protectors', array['compatible_devices','dimensions_w_d_h','weight']::text[]);
select pg_temp.link('phone-screen-repair-kits', array['compatible_phone_models']::text[]);
select pg_temp.unlink('picnic-blankets-and-mats', array['material']::text[]);
select pg_temp.unlink('picnic-cooler-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('plush-toys-plush-toys', array['material','suitable_age_group']::text[]);
select pg_temp.unlink('polo-shirts', array['warranty_period']::text[]);
select pg_temp.unlink('portable-monitors', array['storage_capacity']::text[]);
select pg_temp.unlink('radiators', array['voltage']::text[]);
select pg_temp.unlink('rain-ponchos', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('reading-glasses', array['material']::text[]);
select pg_temp.unlink('refurbished-mobile-phones', array['storage_capacity']::text[]);
select pg_temp.unlink('remote-control-toy-cars', array['suitable_age_group']::text[]);
select pg_temp.unlink('replacement-electric-toothbrush-heads', array['pieces_per_pack']::text[]);
select pg_temp.unlink('replacement-razor-blades-and-cartridges', array['warranty_period','pieces_per_pack']::text[]);
select pg_temp.unlink('resistance-bands', array['weight','dimensions_w_d_h']::text[]);
select pg_temp.unlink('reusable-shopping-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('rice', array['warranty_period']::text[]);
select pg_temp.link('ro-water-purifiers', array['filtration_stage_count']::text[]);
select pg_temp.unlink('rulers', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('sanitary-pads-and-pantyliners', array['warranty_period']::text[]);
select pg_temp.unlink('sauces-and-condiments', array['warranty_period']::text[]);
select pg_temp.unlink('scalp-scrubs', array['warranty_period']::text[]);
select pg_temp.link('school-backpacks', array['capacity']::text[]);
select pg_temp.unlink('school-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('school-supplies-backpacks', array['bag_dimensions']::text[]);
select pg_temp.unlink('school-supplies-school-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('school-uniforms', array['warranty_period']::text[]);
select pg_temp.unlink('scooter-cvt-belts', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('scooter-variator-rollers', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('scooters', array['pieces_count']::text[]);
select pg_temp.unlink('security-cameras', array['camera_resolution']::text[]);
select pg_temp.unlink('security-sensors', array['storage']::text[]);
select pg_temp.unlink('security-video-recorders', array['compatible_devices']::text[]);
select pg_temp.unlink('self-tanning-products', array['warranty_period']::text[]);
select pg_temp.unlink('shampoos', array['warranty_period']::text[]);
select pg_temp.unlink('shaving-brushes', array['material']::text[]);
select pg_temp.unlink('shaving-gels-and-foams', array['warranty_period']::text[]);
select pg_temp.unlink('shorts', array['warranty_period']::text[]);
select pg_temp.unlink('shower-curtains', array['size']::text[]);
select pg_temp.unlink('shower-heads', array['size']::text[]);
select pg_temp.unlink('skateboards', array['material']::text[]);
select pg_temp.unlink('skipping-ropes', array['material','dimensions_w_d_h']::text[]);
select pg_temp.unlink('sleeping-bags', array['dimensions_w_d_h']::text[]);
select pg_temp.unlink('smartphones', array['graphics']::text[]);
select pg_temp.link('smartphones', array['battery_capacity','main_rear_camera_resolution']::text[]);
select pg_temp.unlink('smartwatch-straps', array['main_material']::text[]);
select pg_temp.unlink('sneakers', array['material']::text[]);
select pg_temp.unlink('snorkeling-sets', array['sport']::text[]);
select pg_temp.unlink('soap-and-cleansing-bars', array['warranty_period']::text[]);
select pg_temp.unlink('soft-drinks', array['warranty_period']::text[]);
select pg_temp.unlink('spices-and-seasonings', array['warranty_period']::text[]);
select pg_temp.unlink('sports-sunglasses', array['material']::text[]);
select pg_temp.link('sticky-notes', array['sheets_per_pack']::text[]);
select pg_temp.unlink('storage-water-heaters', array['noise_level']::text[]);
select pg_temp.link('stovetop-tea-kettles', array['compatible_hob_types']::text[]);
select pg_temp.unlink('subwoofers', array['battery_life']::text[]);
select pg_temp.unlink('sugar', array['warranty_period']::text[]);
select pg_temp.unlink('sunscreens', array['warranty_period','color']::text[]);
select pg_temp.link('swimming-caps', array['color']::text[]);
select pg_temp.unlink('swimming-goggles', array['frame_shape','polarized_lenses']::text[]);
select pg_temp.link('swings', array['declared_maximum_user_weight']::text[]);
select pg_temp.unlink('table-salt', array['warranty_period']::text[]);
select pg_temp.unlink('tablet-cases', array['compatible_devices','dimensions_w_d_h']::text[]);
select pg_temp.unlink('tablets-and-ipads', array['graphics']::text[]);
select pg_temp.unlink('tank-tops', array['sleeve_length']::text[]);
select pg_temp.unlink('tea', array['warranty_period']::text[]);
select pg_temp.unlink('thermal-paste', array['dimensions_w_d_h','weight','warranty_period']::text[]);
select pg_temp.unlink('toilet-cleaner', array['warranty_period']::text[]);
select pg_temp.unlink('toilet-paper', array['warranty_period','fragrance_free']::text[]);
select pg_temp.unlink('tool-sets', array['power','voltage']::text[]);
select pg_temp.unlink('toothpastes', array['warranty_period']::text[]);
select pg_temp.unlink('towel-racks', array['size']::text[]);
select pg_temp.link('tower-fans', array['speed_setting_count']::text[]);
select pg_temp.unlink('tracksuits', array['warranty_period']::text[]);
select pg_temp.link('trampolines', array['declared_maximum_user_weight']::text[]);
select pg_temp.unlink('trash-bags', array['warranty_period']::text[]);
select pg_temp.unlink('travel-electronics-organizers', array['bag_dimensions']::text[]);
select pg_temp.unlink('travel-neck-pillows', array['material']::text[]);
select pg_temp.unlink('trousers', array['warranty_period']::text[]);
select pg_temp.unlink('tube-tops', array['sleeve_length']::text[]);
select pg_temp.unlink('undershirts', array['warranty_period']::text[]);
select pg_temp.unlink('unisex-eau-de-parfum', array['warranty_period']::text[]);
select pg_temp.link('usb-hubs', array['usb_port_count']::text[]);
select pg_temp.unlink('vehicle-paint-waxes-and-sealants', array['warranty_period']::text[]);
select pg_temp.link('volleyballs', array['ball_size']::text[]);
select pg_temp.unlink('waist-and-belt-bags', array['bag_dimensions']::text[]);
select pg_temp.unlink('watch-straps', array['main_material']::text[]);
select pg_temp.unlink('webcams', array['camera_resolution','lens_mount','sensor_size']::text[]);
select pg_temp.link('wi-fi-extenders', array['wi_fi_standard']::text[]);
select pg_temp.unlink('wigs', array['material','color']::text[]);
select pg_temp.link('wireless-mice', array['maximum_sensor_sensitivity']::text[]);
select pg_temp.unlink('women-sports-shoes-womens-running-shoes', array['material']::text[]);
select pg_temp.unlink('women-sportswear-yoga-mats', array['size','sport']::text[]);
select pg_temp.link('women-sportswear-yoga-mats', array['thickness','dimensions']::text[]);
select pg_temp.unlink('womens-ankle-boots', array['material']::text[]);
select pg_temp.unlink('womens-basketball-shoes', array['material','level']::text[]);
select pg_temp.link('womens-basketball-shoes', array['color']::text[]);
select pg_temp.unlink('womens-body-splashes', array['warranty_period']::text[]);
select pg_temp.unlink('womens-boots', array['material']::text[]);
select pg_temp.unlink('womens-chelsea-boots', array['material']::text[]);
select pg_temp.unlink('womens-classic-casual-shoes', array['material']::text[]);
select pg_temp.unlink('womens-clogs', array['material']::text[]);
select pg_temp.unlink('womens-derby-shoes', array['material']::text[]);
select pg_temp.unlink('womens-espadrilles', array['material']::text[]);
select pg_temp.unlink('womens-football-boots', array['material','level']::text[]);
select pg_temp.link('womens-football-boots', array['color']::text[]);
select pg_temp.unlink('womens-formal-shoes', array['material']::text[]);
select pg_temp.unlink('womens-heeled-shoes', array['material']::text[]);
select pg_temp.link('womens-heeled-shoes', array['heel_type']::text[]);
select pg_temp.unlink('womens-hiking-boots', array['material']::text[]);
select pg_temp.unlink('womens-home-slippers', array['material']::text[]);
select pg_temp.unlink('womens-knee-high-boots', array['material']::text[]);
select pg_temp.unlink('womens-loafers', array['material']::text[]);
select pg_temp.unlink('womens-moccasins', array['material']::text[]);
select pg_temp.unlink('womens-oxford-shoes', array['material']::text[]);
select pg_temp.unlink('womens-perfumes', array['warranty_period']::text[]);
select pg_temp.unlink('womens-pocket-watches', array['strap_material']::text[]);
select pg_temp.unlink('womens-running-and-training-shoes', array['material']::text[]);
select pg_temp.link('womens-running-shoes', array['upper_material','sole_material','sizing_system']::text[]);
select pg_temp.unlink('womens-sandals-and-slippers', array['material']::text[]);
select pg_temp.unlink('womens-shoes-sports-shoes-womens-running-shoes', array['material']::text[]);
select pg_temp.unlink('womens-sneakers-and-sports-shoes', array['material']::text[]);
select pg_temp.link('womens-swimwear', array['color']::text[]);
select pg_temp.unlink('womens-tennis-shoes', array['material','level']::text[]);
select pg_temp.link('womens-tennis-shoes', array['color']::text[]);
select pg_temp.unlink('womens-trail-running-shoes', array['material']::text[]);
select pg_temp.unlink('womens-walking-shoes', array['material']::text[]);
select pg_temp.unlink('womens-wedges', array['material']::text[]);
select pg_temp.unlink('womens-work-boots', array['material']::text[]);
select pg_temp.unlink('yoga-mats', array['sport','level']::text[]);
select pg_temp.link('yoga-mats', array['color','thickness','dimensions_l_x_w']::text[]);
select pg_temp.unlink('yogurt', array['warranty_period']::text[]);
select pg_temp.unlink('yogurt-drinks', array['warranty_period']::text[]);
update public.attribute_defs set unit = '' where code = 'memory_card_type' and category_id is null;  -- a card type has no unit
