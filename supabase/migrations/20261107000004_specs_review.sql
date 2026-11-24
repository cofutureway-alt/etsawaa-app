-- Spec dictionary review (2026-11-07), generated from a full audit of every
-- used attribute and every category template:
--  1. Arabic spelling (ه→ة, ي→ى, أ/إ hamzas, «او»→«أو») on 108 labels
--  2. clearer names for ambiguous specs («رمات», «قصى وزن…», «موديل», «الصيغة»…)
--  3. «المعلن/المعلنة» / Declared / Advertised dropped where no clash
--  4. units: 'count' removed, wrong units (GB on storage conditions, Ah on
--     power banks, L on perfume capacity…) removed, «عدد …» text → number
--  5. ~110 categories whose template came from another product family
--     (printer specs on drinks, ISBN on school bags & water dispensers, drill
--     specs on espadrilles, SPF on hair ties, cookware on yoga pants, food
--     specs on juicers…) get the right specs; links holding product values are kept
--  6. four computing categories whose Arabic names were shifted

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
-- 1. Arabic spelling (ه→ة, أقصى, أو, أنواع …) — reviewed word list
update public.attribute_defs set label_ar = 'طول العباية' where code = 'abaya_length' and category_id is null and label_ar = 'طول العبايه';
update public.attribute_defs set label_ar = 'نوع العباية' where code = 'abaya_type' and category_id is null and label_ar = 'نوع العبايه';
update public.attribute_defs set label_ar = 'تحذيرات العمر والسلامة' where code = 'age_and_safety_warnings' and category_id is null and label_ar = 'تحذيرات العمر والسلامه';
update public.attribute_defs set label_ar = 'خالية من الامونيا' where code = 'ammonia_free' and category_id is null and label_ar = 'خاليه من الامونيا';
update public.attribute_defs set label_ar = 'خامة القطعة الأساسية' where code = 'base_material' and category_id is null and label_ar = 'خامه القطعه الاساسيه';
update public.attribute_defs set label_ar = 'سعة البطارية' where code = 'battery_capacity' and category_id is null and label_ar = 'سعة الباطرية';
update public.attribute_defs set label_ar = 'عمر البطارية' where code = 'battery_life' and category_id is null and label_ar = 'عمر البطاريه';
update public.attribute_defs set label_ar = 'تقنية البطارية' where code = 'battery_technology' and category_id is null and label_ar = 'تقنيه البطاريه';
update public.attribute_defs set label_ar = 'خامة الوعاء' where code = 'bowl_material' and category_id is null and label_ar = 'خامه الوعاء';
update public.attribute_defs set label_ar = 'نوع حمالة الصدر' where code = 'bra_type' and category_id is null and label_ar = 'نوع حماله الصدر';
update public.attribute_defs set label_ar = 'أقصى سطوع' where code = 'brightness' and category_id is null and label_ar = 'أقصي سطوع';
update public.attribute_defs set label_ar = 'السعة للعلبة الواحدة' where code = 'capacity_per_container' and category_id is null and label_ar = 'السعه للعلبه الواحدة';
update public.attribute_defs set label_ar = 'تقنية التنظيف' where code = 'cleansing_technology' and category_id is null and label_ar = 'تقنيه التنظيف';
update public.attribute_defs set label_ar = 'درجة الخشونة' where code = 'coarseness' and category_id is null and label_ar = 'درجه الخشونه';
update public.attribute_defs set label_ar = 'شكل القهوة' where code = 'coffee_form' and category_id is null and label_ar = 'شكل القهوه';
update public.attribute_defs set label_ar = 'درجة دوام اللون' where code = 'color_permanence' and category_id is null and label_ar = 'درجه دوام اللون';
update public.attribute_defs set label_ar = 'أنواع الجل المتوافقة' where code = 'compatible_gel_types' and category_id is null and label_ar = 'انواع الجل المتوافقه';
update public.attribute_defs set label_ar = 'الاستشوارات المتوافقة' where code = 'compatible_hair_dryers' and category_id is null and label_ar = 'الاستشوارات المرافقه';
update public.attribute_defs set label_ar = 'أنواع الأظافر المتوافقة' where code = 'compatible_nail_types' and category_id is null and label_ar = 'انواع الأظافر المتناسقه';
update public.attribute_defs set label_ar = 'نسخة الجهاز' where code = 'console_edition' and category_id is null and label_ar = 'نسخه الجهاز';
update public.attribute_defs set label_ar = 'خامة سطح التلامس' where code = 'contact_surface_material' and category_id is null and label_ar = 'خامه سطح التلامس';
update public.attribute_defs set label_ar = 'خامة سطح الطهي' where code = 'cooking_surface_material' and category_id is null and label_ar = 'خامه سطح الطهي';
update public.attribute_defs set label_ar = 'وحدة العد' where code = 'counting_unit' and category_id is null and label_ar = 'وحده العد';
update public.attribute_defs set label_ar = 'منطقة الاستخدام المعلنة' where code = 'declared_application_area' and category_id is null and label_ar = 'منطقه الاستخدام المعلنه';
update public.attribute_defs set label_ar = 'مناطق الاستخدام المعلنة' where code = 'declared_application_areas' and category_id is null and label_ar = 'مناطق الاستخدام المعلنه';
update public.attribute_defs set label_ar = 'الأبعاد المعلنة' where code = 'declared_dimensions' and category_id is null and label_ar = 'الأبعاد المعلنه';
update public.attribute_defs set label_ar = 'مدة حفظ السخونة المعلنة' where code = 'declared_hot_retention' and category_id is null and label_ar = 'مدة حفظ السخونه المعلنة';
update public.attribute_defs set label_ar = 'الاستخدام الأساسي المعلن' where code = 'declared_main_purpose' and category_id is null and label_ar = 'الاستخدام الاساسي المعلن';
update public.attribute_defs set label_ar = 'أقصى ضغط معلن' where code = 'declared_maximum_pressure' and category_id is null and label_ar = 'أقصي ضغط معلن';
update public.attribute_defs set label_ar = 'أقصى سرعة معلنة' where code = 'declared_maximum_speed' and category_id is null and label_ar = 'أقصي سرعه معلنه';
update public.attribute_defs set label_ar = 'أقصى عزم معلن' where code = 'declared_maximum_torque' and category_id is null and label_ar = 'أقصي عزم معلن';
update public.attribute_defs set label_ar = 'أقصى وزن مستخدم معلن' where code = 'declared_maximum_user_weight' and category_id is null and label_ar = 'قصى وزن مستخدم معلن';
update public.attribute_defs set label_ar = 'مقاومة الماء المعلنة' where code = 'declared_water_resistance' and category_id is null and label_ar = 'مقاومه الماء المعلنه';
update public.attribute_defs set label_ar = 'عدد الإدراج أو الأقسام' where code = 'drawer_or_compartment_count' and category_id is null and label_ar = 'عدد الإدراج او الأقسام';
update public.attribute_defs set label_ar = 'خاصية التجفيف' where code = 'drying_function' and category_id is null and label_ar = 'خاصيه التجفيف';
update public.attribute_defs set label_ar = 'نسبة الدسم' where code = 'fat_content_class' and category_id is null and label_ar = 'نسبه الدسم';
update public.attribute_defs set label_ar = 'الحشو أو التغطية' where code = 'filling_or_coating' and category_id is null and label_ar = 'الحشو او التغطية';
update public.attribute_defs set label_ar = 'النكهة' where code = 'flavor' and category_id is null and label_ar = 'النكهه';
update public.attribute_defs set label_ar = 'مقاس الإطار' where code = 'frame_size' and category_id is null and label_ar = 'مقاس الاطار';
update public.attribute_defs set label_ar = 'لغه اللعبة' where code = 'game_language' and category_id is null and label_ar = 'لغه اللعبه';
update public.attribute_defs set label_ar = 'درجة الطحن' where code = 'grind_size' and category_id is null and label_ar = 'درجه الطحن';
update public.attribute_defs set label_ar = 'نوع ربطة الشعر' where code = 'hair_tie_type' and category_id is null and label_ar = 'نوع ربطه الشعر';
update public.attribute_defs set label_ar = 'اليد المناسبة للاستخدام' where code = 'hand_orientation' and category_id is null and label_ar = 'اليد المناسبه للاستخدام';
update public.attribute_defs set label_ar = 'خامة المقبض' where code = 'handle_material' and category_id is null and label_ar = 'خامه المقبض';
update public.attribute_defs set label_ar = 'نوع الطوق أو العصابة' where code = 'headband_type' and category_id is null and label_ar = 'نوع الطوق أو العصابه';
update public.attribute_defs set label_ar = 'خامة أو طلاء سطح التسخين' where code = 'heated_surface_material_or_coating' and category_id is null and label_ar = 'خامه او طلاء سطح التسخين';
update public.attribute_defs set label_ar = 'درجة التثبيت' where code = 'hold_level' and category_id is null and label_ar = 'درجه التثبيت';
update public.attribute_defs set label_ar = 'عدد رؤوس البرد المؤقتة' where code = 'included_bit_count' and category_id is null and label_ar = 'عدد رؤوس البرد المؤقته';
update public.attribute_defs set label_ar = 'سعه كل عبوة' where code = 'individual_container_capacities' and category_id is null and label_ar = 'سعه كل عبوه';
update public.attribute_defs set label_ar = 'عدد القطع الفردية' where code = 'individual_pad_count' and category_id is null and label_ar = 'عدد القطع الفرديه';
update public.attribute_defs set label_ar = 'الأبعاد بعد النفخ' where code = 'inflated_dimensions' and category_id is null and label_ar = 'الابعاد بعد النفخ';
update public.attribute_defs set label_ar = 'المحيط أو الطول الخارجي' where code = 'inner_circumference_or_length' and category_id is null and label_ar = 'المحيط او الطول الخارجي';
update public.attribute_defs set label_ar = 'خامة البطانة الداخلية' where code = 'inner_liner_material' and category_id is null and label_ar = 'خامه البطانه الداخليه';
update public.attribute_defs set label_ar = 'معزولة حرارياً' where code = 'insulated' and category_id is null and label_ar = 'معزوله حراريا';
update public.attribute_defs set label_ar = 'نوع المكواة' where code = 'iron_type' and category_id is null and label_ar = 'نوع المكواه';
update public.attribute_defs set label_ar = 'طول القطعة' where code = 'item_length' and category_id is null and label_ar = 'طول القطعه';
update public.attribute_defs set label_ar = 'خامة جسم الغلاية' where code = 'kettle_body_material' and category_id is null and label_ar = 'خامه جسم الغلايه';
update public.attribute_defs set label_ar = 'خامة الرموش' where code = 'lash_material' and category_id is null and label_ar = 'خامه الرموش';
update public.attribute_defs set label_ar = 'طريقة فتح الغطاء' where code = 'lid_opening_mechanism' and category_id is null and label_ar = 'طريقه فتح الغطاء';
update public.attribute_defs set label_ar = 'خامة البطانة' where code = 'lining_material' and category_id is null and label_ar = 'خامه البطانه';
update public.attribute_defs set label_ar = 'مؤشر الحمولة' where code = 'load_index' and category_id is null and label_ar = 'مؤشر الحموله';
update public.attribute_defs set label_ar = 'ايقاف عند نفاذ الكمية' where code = 'low_water_shut_off' and category_id is null and label_ar = 'ايقاف عند نفاذ الكميه';
update public.attribute_defs set label_ar = 'رقم قطعة المصنع' where code = 'manufacturer_part_number' and category_id is null and label_ar = 'رقم قطعه المصنع';
update public.attribute_defs set label_ar = 'المرتبة مرفقة' where code = 'mattress_included' and category_id is null and label_ar = 'المرتبه مرفقه';
update public.attribute_defs set label_ar = 'أقصى وزن للحفاض' where code = 'maximum_baby_weight' and category_id is null and label_ar = 'اقصي وزن للحفاض';
update public.attribute_defs set label_ar = 'أقصى مقاس لظرف الريش' where code = 'maximum_chuck_capacity' and category_id is null and label_ar = 'أقصي مقاس لظرف الريش';
update public.attribute_defs set label_ar = 'أقصى ارتفاع لمبرد المعالج' where code = 'maximum_cpu_cooler_height' and category_id is null and label_ar = 'قصى ارتفاع لمبرد المعالج';
update public.attribute_defs set label_ar = 'أقصى حرارة معلنة' where code = 'maximum_declared_temperature' and category_id is null and label_ar = 'أقصي حرارة معلنة';
update public.attribute_defs set label_ar = 'أقصى مقاس لابتوب مناسب' where code = 'maximum_laptop_size' and category_id is null and label_ar = 'اقصي مقاس لابتوب مناسب';
update public.attribute_defs set label_ar = 'أقصى عمر موصى به' where code = 'maximum_recommended_age' and category_id is null and label_ar = 'اقصي عمر موصي به';
update public.attribute_defs set label_ar = 'أقصى سرعة دوران' where code = 'maximum_rotational_speed' and category_id is null and label_ar = 'أقصي سرعه دوران';
update public.attribute_defs set label_ar = 'أقل وزن للحفاض' where code = 'minimum_baby_weight' and category_id is null and label_ar = 'اقل وزن للحفاض';
update public.attribute_defs set label_ar = 'شكل واحدة الذاكرة' where code = 'module_form_factor' and category_id is null and label_ar = 'شكل واحده الذاكرة';
update public.attribute_defs set label_ar = 'الوزن الصافي للعبوة' where code = 'net_weight_per_pack' and category_id is null and label_ar = 'الوزن الصافي للعبوه';
update public.attribute_defs set label_ar = 'طريقة فتح الرضاعة' where code = 'nursing_access_type' and category_id is null and label_ar = 'طريقه فتح الرضاعه';
update public.attribute_defs set label_ar = 'درجة الشفافية' where code = 'opacity' and category_id is null and label_ar = 'درجه الشفافية';
update public.attribute_defs set label_ar = 'عدد اللهايات في العبوة' where code = 'pacifiers_per_pack' and category_id is null and label_ar = 'عدد اللهايات في العبوه';
update public.attribute_defs set label_ar = 'محتويات العبوة' where code = 'pack_contents' and category_id is null and label_ar = 'محتويات العبوه';
update public.attribute_defs set label_ar = 'عدد وحدات العبوة' where code = 'pack_unit_count' and category_id is null and label_ar = 'عدد وحدات العبوه';
update public.attribute_defs set label_ar = 'نوع الفوطة' where code = 'pad_type' and category_id is null and label_ar = 'نوع الفوطه';
update public.attribute_defs set label_ar = 'نوع الحماية' where code = 'protection_type' and category_id is null and label_ar = 'نوع الحمايه';
update public.attribute_defs set label_ar = 'الذاكرة العشوائية (RAM)' where code = 'ram' and category_id is null and label_ar = 'رمات';
update public.attribute_defs set label_ar = 'القدرة الكهربائية الاسمية' where code = 'rated_input_power' and category_id is null and label_ar = 'القدره الكهربائيه الاسميه';
update public.attribute_defs set label_ar = 'نوع ماكينة الحلاقة' where code = 'razor_type' and category_id is null and label_ar = 'نوع ماكينه الحلاقه';
update public.attribute_defs set label_ar = 'عدد الماكينات في العبوة' where code = 'razors_per_pack' and category_id is null and label_ar = 'عدد الماكينات في العبوه';
update public.attribute_defs set label_ar = 'درجة التحميص' where code = 'roast_level' and category_id is null and label_ar = 'درجه التحميص';
update public.attribute_defs set label_ar = 'خامة أو طلاء الفافات' where code = 'roller_material_or_coating' and category_id is null and label_ar = 'خامه او طلاء الفافات';
update public.attribute_defs set label_ar = 'عدد اللفات أو العبوات' where code = 'rolls_or_packs_per_offer' and category_id is null and label_ar = 'عدد اللفات او العبوات';
update public.attribute_defs set label_ar = 'عدد اللفات في العبوة' where code = 'rolls_per_pack' and category_id is null and label_ar = 'عدد اللفات في العبوه';
update public.attribute_defs set label_ar = 'درجة اللزوجة sae' where code = 'sae_viscosity_grade' and category_id is null and label_ar = 'درجه اللزوجه sae';
update public.attribute_defs set label_ar = 'أنواع رؤوس المفكات' where code = 'screwdriver_tip_types' and category_id is null and label_ar = 'انواع رؤوس المفكات';
update public.attribute_defs set label_ar = 'خامة المقعد' where code = 'seat_material' and category_id is null and label_ar = 'خامه المقعد';
update public.attribute_defs set label_ar = 'تصنيفات السرعة' where code = 'speed_class_ratings' and category_id is null and label_ar = 'تصنيفات السرعه';
update public.attribute_defs set label_ar = 'رمز السرعة' where code = 'speed_rating' and category_id is null and label_ar = 'رمز السرعه';
update public.attribute_defs set label_ar = 'نوع الرياضة' where code = 'sport_type' and category_id is null and label_ar = 'نوع الرياضه';
update public.attribute_defs set label_ar = 'أنواع البخار' where code = 'steam_types' and category_id is null and label_ar = 'انواع البخار';
update public.attribute_defs set label_ar = 'عدد الشرائط في اللفة' where code = 'strips_per_roll' and category_id is null and label_ar = 'عدد الشرائط في اللفه';
update public.attribute_defs set label_ar = 'الوان الشعر المناسبة' where code = 'suitable_hair_colors' and category_id is null and label_ar = 'الوان الشعر المناسبه';
update public.attribute_defs set label_ar = 'مستوى الدعم' where code = 'support_level' and category_id is null and label_ar = 'مستوي الدعم';
update public.attribute_defs set label_ar = 'شكل الحملة' where code = 'teat_shape' and category_id is null and label_ar = 'شكل الحمله';
update public.attribute_defs set label_ar = 'الموضوع أو الشخصية' where code = 'theme_or_character' and category_id is null and label_ar = 'الموضوع او الشخصيه';
update public.attribute_defs set label_ar = 'الموضوع أو الصورة' where code = 'theme_or_picture' and category_id is null and label_ar = 'الموضوع او الصوره';
update public.attribute_defs set label_ar = 'عدد الخيوط المعالجة' where code = 'thread_count' and category_id is null and label_ar = 'عدد الخيوط المعالجه';
update public.attribute_defs set label_ar = 'الدرجة أو اللون' where code = 'tint_or_shade' and category_id is null and label_ar = 'الدرجه او اللون';
update public.attribute_defs set label_ar = 'خامة الطرف' where code = 'tip_material' and category_id is null and label_ar = 'خامه الطرف';
update public.attribute_defs set label_ar = 'خامة التجنيد' where code = 'upholstery_material' and category_id is null and label_ar = 'خامه التجنيد';
update public.attribute_defs set label_ar = 'فئه المركبة' where code = 'vehicle_category' and category_id is null and label_ar = 'فئه المركبه';
update public.attribute_defs set label_ar = 'قاعدة مقاومة للماء' where code = 'water_resistant_backing' and category_id is null and label_ar = 'قاعده مقاومه للماء';

-- 2. clearer names
update public.attribute_defs set label_ar = 'الموديل', label_en = 'Model' where code = 'model' and category_id is null;
update public.attribute_defs set label_ar = 'الذاكرة العشوائية (RAM)', label_en = 'RAM' where code = 'ram' and category_id is null;
update public.attribute_defs set label_ar = 'أقصى وزن للمستخدم', label_en = 'Maximum User Weight' where code = 'declared_maximum_user_weight' and category_id is null;
update public.attribute_defs set label_ar = 'عدد الخيوط', label_en = 'Thread Count' where code = 'thread_count' and category_id is null;
update public.attribute_defs set label_ar = 'فئة الطول', label_en = 'Length Style' where code = 'length_style' and category_id is null;
update public.attribute_defs set label_ar = 'نوع الموصّل', label_en = 'Connector Type' where code = 'connector_type' and category_id is null;
update public.attribute_defs set label_ar = 'مقاس الشنطة', label_en = 'Bag Size' where code = 'bag_dimensions' and category_id is null;
update public.attribute_defs set label_ar = 'طريقة التثبيت / التعليق', label_en = 'Mounting Type' where code = 'mounting_type' and category_id is null;
update public.attribute_defs set label_ar = 'الجهد الكهربائي', label_en = 'Voltage' where code = 'voltage' and category_id is null;
update public.attribute_defs set label_ar = 'نوع الرياضة', label_en = 'Sport' where code = 'sport' and category_id is null;
update public.attribute_defs set label_ar = 'المستوى (مبتدئ / محترف)', label_en = 'Skill Level' where code = 'level' and category_id is null;
update public.attribute_defs set label_ar = 'نوع النسخة (ورقي / إلكتروني)', label_en = 'Format' where code = 'format' and category_id is null;
update public.attribute_defs set label_ar = 'برامج التشغيل', label_en = 'Programs' where code = 'programs' and category_id is null;
update public.attribute_defs set label_ar = 'سعة البطارية', label_en = 'Battery Capacity' where code = 'battery_capacity' and category_id is null;
update public.attribute_defs set label_ar = 'النكهة', label_en = 'Flavor' where code = 'flavor' and category_id is null;
update public.attribute_defs set label_ar = 'سعة التخزين', label_en = 'Storage' where code = 'storage' and category_id is null;
update public.attribute_defs set label_ar = 'القدرة الكهربائية', label_en = 'Power' where code = 'power' and category_id is null;
update public.attribute_defs set label_ar = 'القدرة الكهربائية', label_en = 'Wattage' where code = 'wattage' and category_id is null;
update public.attribute_defs set label_ar = 'عدد القطع', label_en = 'Piece Count' where code = 'pieces_count' and category_id is null;
update public.attribute_defs set label_ar = 'الستايل / التصميم', label_en = 'Style' where code = 'style' and category_id is null;
update public.attribute_defs set label_ar = 'النوع', label_en = 'Type' where code = 'type' and category_id is null;
update public.attribute_defs set label_ar = 'اللمسة النهائية (مطفي / لامع)', label_en = 'Finish' where code = 'finish' and category_id is null;
update public.attribute_defs set label_ar = 'الوزن الصافي للعبوة', label_en = 'Net Weight per Pack' where code = 'net_weight_per_pack' and category_id is null;
update public.attribute_defs set label_ar = 'تحذيرات العمر والسلامة', label_en = 'Age & Safety Warnings' where code = 'age_and_safety_warnings' and category_id is null;
update public.attribute_defs set label_ar = 'القطر', label_en = 'Diameter' where code = 'diameter' and category_id is null;
update public.attribute_defs set label_ar = 'الشكل', label_en = 'Shape' where code = 'shape' and category_id is null;

-- 3. drop «المعلن(ة)» / Declared / Advertised
update public.attribute_defs set label_ar = 'مدة تشغيل البطارية', label_en = 'Battery Life' where code = 'advertised_battery_life' and category_id is null; -- مدة تشغيل البطارية المعلنة
update public.attribute_defs set label_ar = 'معدل نقل البيانات', label_en = 'Data Transfer Rate' where code = 'advertised_data_transfer_rate' and category_id is null; -- معدل نقل البيانات المعلن
update public.attribute_defs set label_ar = 'مدى السير', label_en = 'Range' where code = 'advertised_range' and category_id is null; -- مدى السير المعلن
update public.attribute_defs set label_ar = 'أقصى سرعة قراءة', label_en = 'Read Speed' where code = 'advertised_read_speed' and category_id is null; -- أقصى سرعة قراءة معلنة
update public.attribute_defs set label_ar = 'مدة التشغيل', label_en = 'Runtime' where code = 'advertised_runtime' and category_id is null; -- مدة التشغيل المعلنة
update public.attribute_defs set label_ar = 'أقصى سرعة قراءة متتابعة', label_en = 'Sequential Read Speed' where code = 'advertised_sequential_read_speed' and category_id is null; -- أقصى سرعة قراءة متتابعة معلنة
update public.attribute_defs set label_ar = 'فئة الامتصاص', label_en = 'Absorbency Class' where code = 'declared_absorbency_class' and category_id is null; -- فئة الامتصاص المعلنة
update public.attribute_defs set label_ar = 'المادة الفعالة', label_en = 'Active Ingredient' where code = 'declared_active_ingredient' and category_id is null; -- المادة الفعالة المعلنة
update public.attribute_defs set label_ar = 'تدفق الهواء', label_en = 'Airflow' where code = 'declared_airflow' and category_id is null; -- تدفق الهواء المعلن
update public.attribute_defs set label_ar = 'مقاومة الضباب', label_en = 'Anti-fog Treatment' where code = 'declared_anti_fog_treatment' and category_id is null; -- مقاومة الضباب المعلنة
update public.attribute_defs set label_ar = 'مناطق الاستخدام', label_en = 'Application Areas' where code = 'declared_application_areas' and category_id is null; -- مناطق الاستخدام المعلنة
update public.attribute_defs set label_ar = 'نطاق التطبيق', label_en = 'Application Scope' where code = 'declared_application_scope' and category_id is null; -- نطاق التطبيق المعلن
update public.attribute_defs set label_ar = 'معيار الاعتماد', label_en = 'Approval Standard' where code = 'declared_approval_standard' and category_id is null; -- معيار الاعتماد المعلن
update public.attribute_defs set label_ar = 'حالة الكافيين', label_en = 'Caffeine Status' where code = 'declared_caffeine_status' and category_id is null; -- حالة الكافيين المعلنة
update public.attribute_defs set label_ar = 'السعة', label_en = 'Capacity' where code = 'declared_capacity' and category_id is null; -- السعة المعلنة
update public.attribute_defs set label_ar = 'نسبة الكاكاو', label_en = 'Cocoa Content' where code = 'declared_cocoa_content' and category_id is null; -- نسبة الكاكاو المعلنة
update public.attribute_defs set label_ar = 'درجة حرارة الراحة', label_en = 'Comfort Temperature' where code = 'declared_comfort_temperature' and category_id is null; -- درجة حرارة الراحة المعلنة
update public.attribute_defs set label_ar = 'التوافق والاعتمادات', label_en = 'Compatibility and Approvals' where code = 'declared_compatibility_and_approvals' and category_id is null; -- التوافق والاعتمادات المعلنة
update public.attribute_defs set label_ar = 'المطورات المتوافقة', label_en = 'Compatible Developers' where code = 'declared_compatible_developers' and category_id is null; -- المطورات المتوافقة المعلنة
update public.attribute_defs set label_ar = 'ألوان الشعر المناسبة', label_en = 'Compatible Hair Colors' where code = 'declared_compatible_hair_colors' and category_id is null; -- ألوان الشعر المناسبة المعلنة
update public.attribute_defs set label_ar = 'درجات البشرة المناسبة', label_en = 'Compatible Skin Tones' where code = 'declared_compatible_skin_tones' and category_id is null; -- درجات البشرة المناسبة المعلنة
update public.attribute_defs set label_ar = 'درجة التركيز', label_en = 'Concentration Type' where code = 'declared_concentration_type' and category_id is null; -- درجة التركيز المعلنة
update public.attribute_defs set label_ar = 'قطر فتحة التثبيت', label_en = 'Connector Diameter' where code = 'declared_connector_diameter' and category_id is null; -- قطر فتحة التثبيت المعلن
update public.attribute_defs set label_ar = 'تقنية سائل التبريد', label_en = 'Coolant Technology' where code = 'declared_coolant_technology' and category_id is null; -- تقنية سائل التبريد المعلنة
update public.attribute_defs set label_ar = 'مدة التشغيل اللاسلكي', label_en = 'Cordless Runtime' where code = 'declared_cordless_runtime' and category_id is null; -- مدة التشغيل اللاسلكي المعلنة
update public.attribute_defs set label_ar = 'الغرض التجميلي', label_en = 'Cosmetic Purpose' where code = 'declared_cosmetic_purpose' and category_id is null; -- الغرض التجميلي المعلن
update public.attribute_defs set label_ar = 'مساحة التغطية', label_en = 'Coverage Area' where code = 'declared_coverage_area' and category_id is null; -- مساحة التغطية المعلنة
update public.attribute_defs set label_ar = 'الأبعاد', label_en = 'Dimensions' where code = 'declared_dimensions' and category_id is null; -- الأبعاد المعلنة
update public.attribute_defs set label_ar = 'فئة السماكة', label_en = 'Duty Grade' where code = 'declared_duty_grade' and category_id is null; -- فئة السماكة المعلنة
update public.attribute_defs set label_ar = 'تصنيف العزل الكهربائي', label_en = 'Electrical Insulation Rating' where code = 'declared_electrical_insulation_rating' and category_id is null; -- تصنيف العزل الكهربائي المعلن
update public.attribute_defs set label_ar = 'فجوة الأقطاب', label_en = 'Electrode Gap' where code = 'declared_electrode_gap' and category_id is null; -- فجوة الأقطاب المعلنة
update public.attribute_defs set label_ar = 'نوع التقشير', label_en = 'Exfoliation Type' where code = 'declared_exfoliation_type' and category_id is null; -- نوع التقشير المعلن
update public.attribute_defs set label_ar = 'خامة الألياف', label_en = 'Fiber Material' where code = 'declared_fiber_material' and category_id is null; -- خامة الألياف المعلنة
update public.attribute_defs set label_ar = 'ارتفاع التعبئة', label_en = 'Fill Height' where code = 'declared_fill_height' and category_id is null; -- ارتفاع التعبئة المعلن
update public.attribute_defs set label_ar = 'أبعاد الوحدة', label_en = 'Fixture Dimensions' where code = 'declared_fixture_dimensions' and category_id is null; -- أبعاد الوحدة المعلنة
update public.attribute_defs set label_ar = 'ملاءمة ملامسة الطعام', label_en = 'Food-contact Suitability' where code = 'declared_food_contact_suitability' and category_id is null; -- ملاءمة ملامسة الطعام المعلنة
update public.attribute_defs set label_ar = 'معدل الفرم', label_en = 'Grinding rate' where code = 'declared_grinding_rate' and category_id is null; -- معدل الفرم المعلن
update public.attribute_defs set label_ar = 'أقصى حماية حرارية', label_en = 'Heat Protection Limit' where code = 'declared_heat_protection_limit' and category_id is null; -- أقصى حماية حرارية معلنة
update public.attribute_defs set label_ar = 'ملاءمة التصفيف الحراري', label_en = 'Heat Styling Suitability' where code = 'declared_heat_styling_suitability' and category_id is null; -- ملاءمة التصفيف الحراري المعلنة
update public.attribute_defs set label_ar = 'مدة حفظ السخونة', label_en = 'Hot Retention' where code = 'declared_hot_retention' and category_id is null; -- مدة حفظ السخونة المعلنة
update public.attribute_defs set label_ar = 'الغرض', label_en = 'Intended Use' where code = 'declared_intended_use' and category_id is null; -- الغرض المعلن
update public.attribute_defs set label_ar = 'درجة الحماية IP', label_en = 'IP Rating' where code = 'declared_ip_rating' and category_id is null; -- درجة الحماية المعلنة IP
update public.attribute_defs set label_ar = 'المكونات الرئيسية', label_en = 'Key Ingredients' where code = 'declared_key_ingredients' and category_id is null; -- المكونات الرئيسية المعلنة
update public.attribute_defs set label_ar = 'أنماط الضوء', label_en = 'Light Modes' where code = 'declared_light_modes' and category_id is null; -- أنماط الضوء المعلنة
update public.attribute_defs set label_ar = 'الزيت أو المكون الرئيسي', label_en = 'Main Oil or Ingredient' where code = 'declared_main_oil_or_ingredient' and category_id is null; -- الزيت أو المكون الرئيسي المعلن
update public.attribute_defs set label_ar = 'الزيوت الرئيسية', label_en = 'Main Oils' where code = 'declared_main_oils' and category_id is null; -- الزيوت الرئيسية المعلنة
update public.attribute_defs set label_ar = 'الاستخدام الأساسي', label_en = 'Main Purpose' where code = 'declared_main_purpose' and category_id is null; -- الاستخدام الأساسي المعلن
update public.attribute_defs set label_ar = 'أقصى حرارة تحمل', label_en = 'Maximum Heat Resistance' where code = 'declared_maximum_heat_resistance' and category_id is null; -- أقصى حرارة تحمل معلنة
update public.attribute_defs set label_ar = 'أقصى حمولة', label_en = 'Maximum Load' where code = 'declared_maximum_load' and category_id is null; -- أقصى حمولة معلنة
update public.attribute_defs set label_ar = 'أقصى ضغط', label_en = 'Maximum Pressure' where code = 'declared_maximum_pressure' and category_id is null; -- أقصى ضغط معلن
update public.attribute_defs set label_ar = 'أقصى مدة تشغيل', label_en = 'Maximum Runtime' where code = 'declared_maximum_runtime' and category_id is null; -- أقصى مدة تشغيل معلنة
update public.attribute_defs set label_ar = 'أقصى سرعة', label_en = 'Maximum Speed' where code = 'declared_maximum_speed' and category_id is null; -- أقصى سرعة معلنة
update public.attribute_defs set label_ar = 'أقصى عزم', label_en = 'Maximum Torque' where code = 'declared_maximum_torque' and category_id is null; -- أقصى عزم معلن
update public.attribute_defs set label_ar = 'أقصى مقاس تلفزيون', label_en = 'Maximum TV Size' where code = 'declared_maximum_tv_size' and category_id is null; -- أقصى مقاس تلفزيون معلن
update public.attribute_defs set label_ar = 'معدل إزالة الرطوبة', label_en = 'Moisture Extraction Rate' where code = 'declared_moisture_extraction_rate' and category_id is null; -- معدل إزالة الرطوبة المعلن
update public.attribute_defs set label_ar = 'الطول الاسمي', label_en = 'Nominal Length' where code = 'declared_nominal_length' and category_id is null; -- الطول الاسمي المعلن
update public.attribute_defs set label_ar = 'حماية زيادة الحمل', label_en = 'Overload Protection' where code = 'declared_overload_protection' and category_id is null; -- حماية زيادة الحمل المعلنة
update public.attribute_defs set label_ar = 'سعة الوعاء .', label_en = 'Pot Capacity' where code = 'declared_pot_capacity' and category_id is null; -- سعة الوعاء المعلنة .
update public.attribute_defs set label_ar = 'قاعدة البودرة', label_en = 'Powder Base' where code = 'declared_powder_base' and category_id is null; -- قاعدة البودرة المعلنة
update public.attribute_defs set label_ar = 'نطاق طول الراكب', label_en = 'Rider Height Range' where code = 'declared_rider_height_range' and category_id is null; -- نطاق طول الراكب المعلن
update public.attribute_defs set label_ar = 'عدد المقاعد المناسب', label_en = 'Seating Capacity' where code = 'declared_seating_capacity' and category_id is null; -- عدد المقاعد المناسب المعلن
update public.attribute_defs set label_ar = 'توافق الوسائد الهوائية الجانبية', label_en = 'Side-Airbag Compatibility' where code = 'declared_side_airbag_compatibility' and category_id is null; -- توافق الوسائد الهوائية الجانبية المعلن
update public.attribute_defs set label_ar = 'المقاس', label_en = 'Size' where code = 'declared_size' and category_id is null; -- المقاس المعلن
update public.attribute_defs set label_ar = 'المقاسات', label_en = 'Sizes' where code = 'declared_sizes' and category_id is null; -- المقاسات المعلنة
update public.attribute_defs set label_ar = 'منع التسرب', label_en = 'Spill Resistance' where code = 'declared_spill_resistance' and category_id is null; -- منع التسرب المعلن
update public.attribute_defs set label_ar = 'المواصفة أو الاعتماد', label_en = 'Standard or Certification' where code = 'declared_standard_or_certification' and category_id is null; -- المواصفة أو الاعتماد المعلن
update public.attribute_defs set label_ar = 'الأسطح المناسبة', label_en = 'Suitable Surfaces' where code = 'declared_suitable_surfaces' and category_id is null; -- الأسطح المناسبة المعلنة
update public.attribute_defs set label_ar = 'درجة التسمير', label_en = 'Tan Shade' where code = 'declared_tan_shade' and category_id is null; -- درجة التسمير المعلنة
update public.attribute_defs set label_ar = 'نطاق الحرارة', label_en = 'Temperature Range' where code = 'declared_temperature_range' and category_id is null; -- نطاق الحرارة المعلن
update public.attribute_defs set label_ar = 'الاستخدام', label_en = 'Use' where code = 'declared_use' and category_id is null; -- الاستخدام المعلن
update public.attribute_defs set label_ar = 'مكان الاستخدام', label_en = 'Use Location' where code = 'declared_use_location' and category_id is null; -- مكان الاستخدام المعلن
update public.attribute_defs set label_ar = 'حماية الأشعة فوق البنفسجية', label_en = 'UV Protection' where code = 'declared_uv_protection' and category_id is null; -- حماية الأشعة فوق البنفسجية المعلنة
update public.attribute_defs set label_ar = 'دقة الفيديو', label_en = 'Video Resolution' where code = 'declared_video_resolution' and category_id is null; -- دقة الفيديو المعلنة
update public.attribute_defs set label_ar = 'سعة المياه', label_en = 'Water Capacity' where code = 'declared_water_capacity' and category_id is null; -- سعة المياه المعلنة
update public.attribute_defs set label_ar = 'مقاومة الماء', label_en = 'Water Resistance' where code = 'declared_water_resistance' and category_id is null; -- مقاومة الماء المعلنة
update public.attribute_defs set label_ar = 'تصنيف مقاومة الماء', label_en = 'Water Resistance Rating' where code = 'declared_water_resistance_rating' and category_id is null; -- تصنيف مقاومة الماء المعلن
update public.attribute_defs set label_ar = 'نوع المياه', label_en = 'Water Type' where code = 'declared_water_type' and category_id is null; -- نوع المياه المعلن
update public.attribute_defs set label_ar = 'سعة الشمع', label_en = 'Wax Capacity' where code = 'declared_wax_capacity' and category_id is null; -- سعة الشمع المعلنة
update public.attribute_defs set label_ar = 'الوزن', label_en = 'Weight' where code = 'declared_weight' and category_id is null; -- الوزن المعلن
update public.attribute_defs set label_ar = 'الاستخدام الجاف أو الرطب', label_en = 'Wet or Dry Use' where code = 'declared_wet_or_dry_use' and category_id is null; -- الاستخدام الجاف أو الرطب المعلن
update public.attribute_defs set label_ar = 'أقصى ارتفاع', label_en = 'Maximum Declared Height' where code = 'maximum_declared_height' and category_id is null; -- أقصى ارتفاع معلن
update public.attribute_defs set label_ar = 'أقصى حرارة', label_en = 'Maximum Declared Temperature' where code = 'maximum_declared_temperature' and category_id is null; -- أقصى حرارة معلنة
update public.attribute_defs set label_ar = 'أقصى تيار', label_en = 'Rated Maximum Current' where code = 'rated_maximum_current' and category_id is null; -- أقصى تيار معلن
update public.attribute_defs set label_ar = 'أقصى حمل إجمالي', label_en = 'Rated Maximum Total Load' where code = 'rated_maximum_total_load' and category_id is null; -- أقصى حمل إجمالي معلن
update public.attribute_defs set label_ar = 'جهد التشغيل', label_en = 'Rated Voltage' where code = 'rated_voltage' and category_id is null; -- جهد التشغيل المعلن
update public.attribute_defs set label_ar = 'أقصى سرعة كتابة متتابعة', label_en = 'Sequential Write Speed' where code = 'advertised_sequential_write_speed' and category_id is null; -- أقصى سرعة كتابة متتابعة معلنة
update public.attribute_defs set label_ar = 'توصيل أرضي', label_en = 'Earth Connection' where code = 'declared_earth_connection' and category_id is null; -- توصيل أرضي معلن
update public.attribute_defs set label_ar = 'مقاسات الأطراف', label_en = 'Tip Sizes' where code = 'declared_tip_sizes' and category_id is null; -- مقاسات الأطراف المعلنة
update public.attribute_defs set label_ar = 'نطاق الجهد', label_en = 'Rated Voltage Range' where code = 'rated_voltage_range' and category_id is null; -- نطاق الجهد المعلن
update public.attribute_defs set label_ar = 'الفئة العمرية', label_en = 'Age Group' where code = 'declared_age_group' and category_id is null; -- الفئة العمرية المعلنة
update public.attribute_defs set label_en = upper(left(label_en, 1)) || substr(label_en, 2) where category_id is null and label_en ~ '^[a-z]';

-- 4. units: 'count' is not a unit; wrong units on free-text specs
update public.attribute_defs set unit = '' where unit = 'count';
update public.attribute_defs set unit = '' where code = 'storage_conditions' and category_id is null;
update public.attribute_defs set unit = '' where code = 'capacity' and category_id is null;
update public.attribute_defs set unit = '' where code = 'battery_capacity' and category_id is null;
update public.attribute_defs set unit = '' where code = 'controller_power_source' and category_id is null;
update public.attribute_defs set unit = '' where code = 'auxiliary_power_connectors' and category_id is null;
update public.attribute_defs set unit = '' where code = 'gpu_power_connectors' and category_id is null;
update public.attribute_defs set unit = '' where code = 'brightness_control' and category_id is null;
update public.attribute_defs set unit = '' where code = 'resolution' and category_id is null;
update public.attribute_defs set unit = '' where code = 'count_basis' and category_id is null;
update public.attribute_defs set unit = '' where code = 'counting_unit' and category_id is null;
-- «عدد …» kept as free text → a number field
update public.attribute_defs d set type = 'number'
 where d.category_id is null and d.type = 'text' and d.label_ar like 'عدد %'
   and not exists (select 1 from public.product_attribute_values v where v.attribute_id = d.id);

-- 5. re-template categories that received another product family's specs
select pg_temp.unlink('mens-traditional-wristwatches', array['pattern']);
select pg_temp.unlink('womens-traditional-wristwatches', array['pattern']);
select pg_temp.unlink('womens-digital-watches', array['pattern']);
select pg_temp.unlink('mens-wrist-watches', array['pattern']);
select pg_temp.unlink('mens-diving-watches', array['pattern']);
select pg_temp.unlink('kids-watches-kids-watches', array['pattern']);
select pg_temp.unlink('watches-watches', array['pattern']);
select pg_temp.unlink('womens-pocket-watches', array['pattern']);
select pg_temp.unlink('mens-pocket-watches', array['pattern']);
select pg_temp.unlink('womens-diving-watches', array['pattern']);
select pg_temp.unlink('womens-wrist-watches', array['pattern']);
select pg_temp.unlink('womens-chronograph-watches', array['pattern']);
select pg_temp.unlink('mens-chronograph-watches', array['pattern']);
select pg_temp.unlink('gifts-and-favors-watches', array['pattern']);
select pg_temp.unlink('mens-digital-watches', array['pattern']);
select pg_temp.unlink('eyewear-accessories', array['occasion', 'pattern']);
select pg_temp.unlink('watch-accessories-watch-accessories', array['occasion', 'pattern']);
select pg_temp.unlink('smartwatches-and-bands', array['occasion', 'pattern']);
select pg_temp.link('smartwatches-and-bands', array['screen_size', 'compatible_phone_operating_systems', 'water_resistance_rating', 'built_in_positioning_systems', 'bluetooth_calling', 'advertised_battery_life', 'display_type', 'battery_capacity']);
select pg_temp.unlink('fish-tanks', array['occasion', 'pattern']);
select pg_temp.link('fish-tanks', array['capacity', 'dimensions']);
select pg_temp.unlink('salad-dressings', array['color', 'material', 'occasion', 'pattern', 'size']);
select pg_temp.link('salad-dressings', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage_conditions', 'weight_or_volume', 'flavor']);
select pg_temp.unlink('makeup-spatulas', array['fragrance', 'main_ingredient', 'suitable_age_group']);
select pg_temp.unlink('interdental-brushes', array['age_and_safety_warnings', 'age_group']);
select pg_temp.unlink('mice-and-keyboards', array['accessories_included', 'body_material', 'finish', 'fretboard_material', 'instrument_type', 'pickup_type', 'string_count']);
select pg_temp.link('mice-and-keyboards', array['connectivity', 'bluetooth', 'dimensions_w_d_h', 'power_source']);
select pg_temp.unlink('laptop-bags', array['battery_life', 'connectivity', 'graphics', 'operating_system', 'ports', 'processor', 'ram', 'resolution', 'screen_size', 'storage']);
select pg_temp.link('laptop-bags', array['bag_dimensions', 'capacity', 'closure_type', 'dimensions_w_d_h', 'main_material', 'maximum_laptop_size', 'water_resistance', 'color']);
select pg_temp.unlink('monitors', array['battery_life', 'graphics', 'operating_system', 'processor', 'ram', 'storage']);
select pg_temp.link('monitors', array['refresh_rate', 'display_type', 'hdr']);
select pg_temp.unlink('hard-drives-and-flash', array['battery_life', 'graphics', 'operating_system', 'ports', 'processor', 'ram', 'resolution', 'screen_size']);
select pg_temp.unlink('camera-memory-cards', array['battery_life', 'graphics', 'operating_system', 'ports', 'processor', 'ram', 'resolution', 'screen_size']);
select pg_temp.unlink('blood-pressure-monitors', array['graphics', 'operating_system', 'ports', 'processor', 'ram', 'resolution', 'storage']);
select pg_temp.unlink('hair-wraps', array['formulation', 'ingredients', 'shade', 'skin_type', 'spf', 'type', 'volume']);
select pg_temp.link('hair-wraps', array['pieces_per_pack', 'pattern']);
select pg_temp.unlink('hair-ties', array['formulation', 'ingredients', 'shade', 'skin_type', 'spf', 'type', 'volume']);
select pg_temp.link('hair-ties', array['pieces_per_pack', 'pattern']);
select pg_temp.unlink('ice-cream', array['formulation', 'shade', 'skin_type', 'spf', 'type']);
select pg_temp.link('ice-cream', array['flavor', 'shelf_life', 'storage_conditions']);
select pg_temp.unlink('safety-razors', array['formulation', 'ingredients', 'shade', 'skin_type', 'spf', 'volume']);
select pg_temp.unlink('baby-nail-clippers', array['formulation', 'ingredients', 'shade', 'skin_type', 'spf', 'volume']);
select pg_temp.unlink('wigs-and-hair-extensions', array['formulation', 'ingredients', 'skin_type', 'spf', 'volume']);
select pg_temp.unlink('teeth-whitening-kits', array['skin_type', 'spf']);
select pg_temp.unlink('shrugs', array['dimensions', 'mounting_type']);
select pg_temp.link('shrugs', array['fabric_material', 'fit', 'neckline', 'sizing_system', 'sleeve_length', 'size']);
select pg_temp.unlink('eyeglasses-and-frames', array['dimensions', 'mounting_type', 'pattern']);
select pg_temp.link('eyeglasses-and-frames', array['frame_color', 'frame_shape', 'frame_material', 'lens_width']);
select pg_temp.unlink('car-seat-cushions', array['mounting_type']);
select pg_temp.unlink('ear-protection', array['power', 'voltage']);
select pg_temp.unlink('work-gloves', array['power', 'voltage']);
select pg_temp.unlink('squares', array['power', 'voltage']);
select pg_temp.unlink('hand-saws', array['power', 'voltage']);
select pg_temp.unlink('hammers', array['power', 'voltage']);
select pg_temp.unlink('clamps', array['power', 'voltage']);
select pg_temp.unlink('tool-belts', array['power', 'voltage']);
select pg_temp.unlink('water-filter-cartridges', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage', 'weight_or_volume']);
select pg_temp.link('water-filter-cartridges', array['compatibility', 'dimensions']);
select pg_temp.unlink('ro-water-purifiers', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage', 'weight_or_volume']);
select pg_temp.link('ro-water-purifiers', array['capacity', 'power', 'voltage', 'dimensions']);
select pg_temp.unlink('citrus-juicers', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage', 'weight_or_volume']);
select pg_temp.link('citrus-juicers', array['capacity', 'power', 'voltage', 'control_type', 'dimensions']);
select pg_temp.unlink('rice-cookers-with-steamer', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage', 'weight_or_volume']);
select pg_temp.link('rice-cookers-with-steamer', array['capacity', 'power', 'voltage', 'control_type', 'dimensions']);
select pg_temp.unlink('semolina', array['storage']);
select pg_temp.link('semolina', array['storage_conditions']);
select pg_temp.unlink('chickpeas', array['storage']);
select pg_temp.link('chickpeas', array['storage_conditions']);
select pg_temp.unlink('lentils', array['storage']);
select pg_temp.link('lentils', array['storage_conditions']);
select pg_temp.unlink('popcorn', array['storage']);
select pg_temp.link('popcorn', array['storage_conditions']);
select pg_temp.unlink('cottage-cheese', array['storage']);
select pg_temp.link('cottage-cheese', array['storage_conditions']);
select pg_temp.unlink('labneh', array['storage']);
select pg_temp.link('labneh', array['storage_conditions']);
select pg_temp.unlink('croissants', array['storage']);
select pg_temp.link('croissants', array['storage_conditions']);
select pg_temp.unlink('dried-fruits', array['storage']);
select pg_temp.link('dried-fruits', array['storage_conditions']);
select pg_temp.unlink('frozen-chicken-nuggets', array['storage']);
select pg_temp.link('frozen-chicken-nuggets', array['storage_conditions']);
select pg_temp.unlink('frozen-pizza', array['storage']);
select pg_temp.link('frozen-pizza', array['storage_conditions']);
select pg_temp.unlink('sparkling-water', array['storage']);
select pg_temp.link('sparkling-water', array['storage_conditions']);
select pg_temp.unlink('barbecue-sauce', array['storage']);
select pg_temp.link('barbecue-sauce', array['storage_conditions']);
select pg_temp.unlink('tahini', array['storage']);
select pg_temp.link('tahini', array['storage_conditions']);
select pg_temp.unlink('contact-lenses-and-solutions', array['battery_life', 'connectivity', 'display_size', 'driver_size', 'frequency_response', 'hdr', 'power_output', 'resolution']);
select pg_temp.unlink('camera-straps', array['battery_life', 'connectivity', 'display_size', 'driver_size', 'frequency_response', 'hdr', 'power_output', 'resolution']);
select pg_temp.unlink('camera-batteries', array['connectivity', 'display_size', 'driver_size', 'frequency_response', 'hdr', 'power_output', 'resolution']);
select pg_temp.link('camera-batteries', array['battery_capacity', 'compatibility']);
select pg_temp.unlink('lenses', array['battery_life', 'connectivity', 'display_size', 'driver_size', 'frequency_response', 'hdr', 'power_output', 'resolution']);
select pg_temp.link('lenses', array['compatibility']);
select pg_temp.unlink('tripods-and-studio-lights-and-accessories', array['battery_life', 'display_size', 'driver_size', 'frequency_response', 'hdr', 'resolution']);
select pg_temp.unlink('security-and-cctv-cameras', array['driver_size', 'frequency_response', 'power_output']);
select pg_temp.unlink('smart-cameras', array['driver_size', 'frequency_response', 'power_output']);
select pg_temp.unlink('paper-napkins', array['binding', 'format', 'isbn', 'language', 'pages', 'publisher']);
select pg_temp.link('paper-napkins', array['ply_count', 'pieces_per_pack', 'dimensions']);
select pg_temp.unlink('boys-and-girls-shoes-casual-school-kids-sports-shoes', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('boys-and-girls-shoes-casual-school-kids-sports-shoes', array['closure_type', 'primary_use', 'sizing_system', 'sole_material', 'upper_material', 'occasion', 'pattern', 'color', 'size']);
select pg_temp.unlink('casual-and-school-backpacks', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('casual-and-school-backpacks', array['bag_dimensions', 'capacity', 'closure_type', 'dimensions_w_d_h', 'main_material', 'maximum_laptop_size', 'water_resistance', 'color']);
select pg_temp.unlink('school-bags', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('school-bags', array['bag_dimensions', 'capacity', 'closure_type', 'dimensions_w_d_h', 'main_material', 'maximum_laptop_size', 'water_resistance', 'color']);
select pg_temp.unlink('school-supplies-school-bags', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('school-supplies-school-bags', array['bag_dimensions', 'capacity', 'closure_type', 'dimensions_w_d_h', 'main_material', 'maximum_laptop_size', 'water_resistance', 'color']);
select pg_temp.unlink('gift-wrapping-paper', array['binding', 'format', 'isbn', 'language', 'pages', 'publisher']);
select pg_temp.link('gift-wrapping-paper', array['dimensions', 'pattern']);
select pg_temp.unlink('top-loading-water-dispensers', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('top-loading-water-dispensers', array['capacity', 'control_type', 'dimensions', 'energy_rating', 'noise_level', 'power', 'voltage']);
select pg_temp.unlink('bottom-loading-water-dispensers', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('bottom-loading-water-dispensers', array['capacity', 'control_type', 'dimensions', 'energy_rating', 'noise_level', 'power', 'voltage']);
select pg_temp.unlink('office-furniture', array['binding', 'format', 'isbn', 'language', 'pack_count', 'pages', 'publisher']);
select pg_temp.link('office-furniture', array['assembly_required', 'dimensions', 'frame_material', 'style', 'weight_capacity']);
select pg_temp.unlink('card-holders', array['cable_length', 'compatibility', 'connector_type', 'power_output']);
select pg_temp.link('card-holders', array['main_material', 'wallet_type', 'closure_type', 'strap_type', 'lining_material', 'sorting_compartment_count']);
select pg_temp.unlink('suitcases-and-duffle-bags', array['cable_length', 'compatibility', 'connector_type', 'power_output']);
select pg_temp.link('suitcases-and-duffle-bags', array['capacity', 'closure_type', 'dimensions_w_d_h', 'main_material', 'water_resistance']);
select pg_temp.unlink('pencil-cases', array['cable_length', 'compatibility', 'connector_type', 'power_output']);
select pg_temp.link('pencil-cases', array['dimensions_w_d_h', 'closure_type', 'main_material']);
select pg_temp.unlink('cases', array['cable_length', 'connector_type', 'power_output']);
select pg_temp.unlink('screen-protectors', array['cable_length', 'connector_type', 'power_output']);
select pg_temp.unlink('tablet-screen-protectors', array['cable_length', 'connector_type', 'power_output']);
select pg_temp.unlink('phone-stands', array['cable_length', 'connector_type', 'power_output']);
select pg_temp.unlink('women-sportswear-womens-yoga-pants', array['capacity', 'diameter', 'dishwasher_safe', 'heat_source', 'non_stick', 'pieces_count']);
select pg_temp.link('women-sportswear-womens-yoga-pants', array['fabric_material', 'length', 'opacity', 'sizing_system', 'color', 'size']);
select pg_temp.unlink('womens-yoga-pants', array['capacity', 'diameter', 'dishwasher_safe', 'heat_source', 'non_stick', 'pieces_count']);
select pg_temp.link('womens-yoga-pants', array['fabric_material', 'length', 'opacity', 'sizing_system', 'color', 'size']);
select pg_temp.unlink('accessories-water-bottles', array['heat_source', 'non_stick']);
select pg_temp.unlink('sports-water-bottles', array['heat_source', 'non_stick']);
select pg_temp.unlink('water-bottles', array['heat_source', 'non_stick']);
select pg_temp.unlink('fire-extinguishers', array['voltage']);
select pg_temp.unlink('reflective-triangles', array['voltage']);
select pg_temp.unlink('car-fluids', array['voltage']);
select pg_temp.unlink('car-floor-mats-and-liners', array['voltage']);
select pg_temp.unlink('motorcycle-handlebar-grips', array['voltage']);
select pg_temp.unlink('engine-coolants', array['voltage']);
select pg_temp.unlink('bedsheets-and-comforters', array['assembly_required', 'frame_material', 'seating_capacity', 'weight_capacity']);
select pg_temp.link('bedsheets-and-comforters', array['fabric_material', 'thread_count', 'pattern', 'pieces_count']);
select pg_temp.unlink('vegetable-choppers', array['assembly_required', 'frame_material', 'seating_capacity', 'style', 'weight_capacity']);
select pg_temp.link('vegetable-choppers', array['capacity', 'power', 'voltage']);
select pg_temp.unlink('tablets-and-ipads', array['assembly_required', 'dimensions', 'frame_material', 'seating_capacity', 'style', 'weight_capacity']);
select pg_temp.link('tablets-and-ipads', array['processor', 'ram', 'storage', 'screen_size', 'resolution', 'graphics', 'operating_system', 'battery_life', 'ports', 'connectivity']);
select pg_temp.unlink('mens-espadrilles', array['chuck_size', 'included_bits', 'power_source', 'speed', 'voltage']);
select pg_temp.link('mens-espadrilles', array['closure_type', 'primary_use', 'sizing_system', 'sole_material', 'upper_material', 'occasion', 'pattern', 'color', 'size']);
select pg_temp.unlink('womens-espadrilles', array['chuck_size', 'included_bits', 'power_source', 'speed', 'voltage']);
select pg_temp.link('womens-espadrilles', array['closure_type', 'primary_use', 'sizing_system', 'sole_material', 'upper_material', 'occasion', 'pattern', 'color', 'size']);
select pg_temp.unlink('styling-tools', array['chuck_size', 'included_bits', 'speed']);
select pg_temp.link('styling-tools', array['heat_setting_count', 'temperature_control']);
select pg_temp.unlink('makeup-tools', array['chuck_size', 'included_bits', 'power_source', 'speed', 'voltage']);
select pg_temp.link('makeup-tools', array['bristle_material', 'piece_count']);
select pg_temp.unlink('painting-tools', array['chuck_size', 'included_bits', 'power_source', 'speed', 'voltage']);
select pg_temp.link('painting-tools', array['piece_count']);
select pg_temp.unlink('baking-sheets', array['pattern', 'thread_count']);
select pg_temp.link('baking-sheets', array['dimensions', 'non_stick', 'dishwasher_safe']);
select pg_temp.unlink('gaming-headset-stands', array['connectivity', 'controller_included', 'platform', 'refresh_rate', 'resolution', 'storage']);
select pg_temp.unlink('gaming-mouse-pads', array['connectivity', 'controller_included', 'platform', 'refresh_rate', 'resolution', 'storage']);
select pg_temp.unlink('gaming-keyboards', array['controller_included', 'refresh_rate', 'resolution', 'storage']);
select pg_temp.unlink('yogurt-drinks', array['connectivity', 'duplex', 'ink_or_toner_type', 'max_paper_size', 'print_color', 'print_speed', 'print_technology', 'scanner_type']);
select pg_temp.link('yogurt-drinks', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage_conditions', 'weight_or_volume', 'flavor']);
select pg_temp.unlink('energy-drinks', array['connectivity', 'duplex', 'ink_or_toner_type', 'max_paper_size', 'print_color', 'print_speed', 'print_technology', 'scanner_type']);
select pg_temp.link('energy-drinks', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage_conditions', 'weight_or_volume', 'flavor']);
select pg_temp.unlink('soft-drinks', array['connectivity', 'duplex', 'ink_or_toner_type', 'max_paper_size', 'print_color', 'print_speed', 'print_technology', 'scanner_type']);
select pg_temp.link('soft-drinks', array['ingredients', 'origin', 'packaging', 'shelf_life', 'storage_conditions', 'weight_or_volume', 'flavor']);
select pg_temp.unlink('cufflinks-and-tie-clips', array['connectivity', 'duplex', 'ink_or_toner_type', 'max_paper_size', 'print_color', 'print_speed', 'print_technology', 'scanner_type']);
select pg_temp.link('cufflinks-and-tie-clips', array['metal_or_plating_color']);
select pg_temp.unlink('trumpets', array['capacity', 'features', 'pet_type']);
select pg_temp.link('trumpets', array['instrument_type', 'body_material', 'finish', 'accessories_included']);
select pg_temp.unlink('sweaters-and-pullovers', array['power_source']);
select pg_temp.unlink('galabeyas', array['power_source']);
select pg_temp.unlink('niqabs', array['power_source']);
select pg_temp.unlink('refillable-toiletry-travel-bottles', array['power_source']);
select pg_temp.unlink('caps-and-hats', array['power_source']);
select pg_temp.unlink('accessories-caps-and-hats', array['power_source']);
select pg_temp.unlink('scarves-and-shawls', array['power_source']);
select pg_temp.unlink('women-sportswear-sports-bras', array['power_source']);
select pg_temp.unlink('kimonos-and-beach-cover-ups', array['power_source']);
select pg_temp.unlink('sports-trousers-and-joggers', array['power_source']);
select pg_temp.unlink('fashion-gloves', array['power_source']);
select pg_temp.unlink('sweatshirts', array['power_source']);
select pg_temp.unlink('sand-and-beach-toy-sets', array['power_source']);
select pg_temp.unlink('hijab-undercaps', array['power_source']);
select pg_temp.unlink('hijabs', array['power_source']);
select pg_temp.unlink('sports-bras', array['power_source']);
select pg_temp.unlink('dressing-gowns-and-bathrobes', array['power_source']);
select pg_temp.unlink('school-uniforms', array['power_source']);
select pg_temp.unlink('women-sportswear-sweatshirts', array['power_source']);
select pg_temp.unlink('darbukas', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('tambourines', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('accordions', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('bongos', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('cajons', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('harmonicas', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('clarinets', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('flutes', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('metronomes', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('music-stands', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('instrument-cases', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('drum-sets', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('drumsticks', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('keyboard-stands', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('saxophones', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('keyboards-and-digital-pianos', array['fretboard_material', 'pickup_type', 'string_count']);
select pg_temp.unlink('irons', array['electrical_power']);
select pg_temp.unlink('electric-kettles', array['electrical_power']);
select pg_temp.unlink('milk', array['color']);
select pg_temp.unlink('spices-and-seasonings', array['color']);
select pg_temp.unlink('sugar', array['color']);
select pg_temp.unlink('dates', array['color']);
select pg_temp.unlink('nuts', array['color']);
select pg_temp.unlink('chocolate', array['color']);
select pg_temp.unlink('cheese', array['color']);
select pg_temp.unlink('yogurt', array['color']);
select pg_temp.unlink('canned-tuna-and-fish', array['color']);
select pg_temp.unlink('jams-and-sweet-spreads', array['color']);
select pg_temp.unlink('chips-and-savory-snacks', array['color']);
select pg_temp.unlink('sauces-and-condiments', array['color']);
select pg_temp.unlink('coffee', array['color']);
select pg_temp.unlink('tea', array['color']);
select pg_temp.unlink('frozen-vegetables-and-fruit', array['color']);
select pg_temp.unlink('cooking-oil', array['color']);
select pg_temp.unlink('packaged-juice', array['color']);
select pg_temp.unlink('bottled-drinking-water', array['color']);
select pg_temp.unlink('biscuits-and-cookies', array['color']);
select pg_temp.unlink('table-salt', array['color']);
select pg_temp.unlink('dried-pulses', array['color']);
select pg_temp.unlink('flour', array['color']);
select pg_temp.unlink('pasta', array['color']);
select pg_temp.unlink('rice', array['color']);
select pg_temp.unlink('honey', array['color']);

-- 6. Arabic names shifted between sibling categories (slugs / English were right)
update public.categories set name_ar = 'ماوس وكيبورد' where slug_en = 'mice-and-keyboards' and deleted_at is null;
update public.categories set name_ar = 'حقائب لابتوب' where slug_en = 'laptop-bags' and deleted_at is null;
update public.categories set name_ar = 'سكانر وأحبار' where slug_en = 'scanners-and-ink' and deleted_at is null;
update public.categories set name_ar = 'شاشات' where slug_en = 'monitors' and deleted_at is null;
