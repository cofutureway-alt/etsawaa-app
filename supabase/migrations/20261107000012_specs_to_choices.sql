-- Specs as choices (2026-11-07): sellers pick from a list instead of typing.
-- Six review agents read all 868 free-text specs. 741 became choice lists (enum,
-- multi-choice where a product can have several values). 127 stay text: model numbers,
-- compatible models, ingredients, authors, specs shared by unrelated categories
-- (e.g. «النوع», «الستايل»). The 8 categories that still had no real choice got their own
-- choice specs: extension cords, film cameras, contact lenses, RO purifiers, paper
-- napkins, trash bags, camera batteries, car fluids. Re-runnable.
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
-- 1. free text -> choices
update public.attribute_defs set type = 'enum', is_multi = false where code = 'abaya_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('open_front', 'عباية مفتوحة', 'Open Front', 0),
  ('closed', 'عباية مقفولة', 'Closed', 1),
  ('butterfly', 'عباية فراشة', 'Butterfly', 2),
  ('kimono', 'عباية كيمونو', 'Kimono', 3),
  ('bisht', 'عباية بشت', 'Bisht', 4),
  ('khaleeji', 'عباية خليجي', 'Khaleeji', 5),
  ('embroidered', 'عباية مطرزة', 'Embroidered', 6),
  ('prayer', 'عباية / إسدال صلاة', 'Prayer Abaya / Isdal', 7),
  ('with_hood_niqab', 'عباية بطرحة / خمار', 'With Hijab / Khimar', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'abaya_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'abrasiveness' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('non_scratch', 'ناعم لا يخدش', 'Non-scratch', 0),
  ('medium', 'متوسط', 'Medium', 1),
  ('heavy', 'خشن للبقع الصعبة', 'Heavy duty', 2),
  ('extra_heavy', 'خشن جداً (سلك)', 'Extra heavy (steel)', 3)) v(code, ar, en, sort)
 where d.code = 'abrasiveness' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'accessories_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gig_bag', 'شنطة قماش', 'Gig bag', 0),
  ('hard_case', 'شنطة صلبة', 'Hard case', 1),
  ('bow', 'قوس', 'Bow', 2),
  ('rosin', 'قلفونية', 'Rosin', 3),
  ('spare_strings', 'أوتار إضافية', 'Spare strings', 4),
  ('picks', 'ريشة', 'Picks', 5),
  ('tuner', 'دوزان', 'Tuner', 6),
  ('strap', 'حزام', 'Strap', 7),
  ('stand', 'حامل', 'Stand', 8),
  ('reeds', 'ريد', 'Reeds', 9),
  ('cleaning_kit', 'أدوات تنظيف', 'Cleaning kit', 10),
  ('power_adapter', 'شاحن / أداپتر', 'Power adapter', 11),
  ('sustain_pedal', 'بدال', 'Sustain pedal', 12),
  ('headphones', 'سماعة', 'Headphones', 13),
  ('cable', 'كابل', 'Cable', 14),
  ('none', 'بدون ملحقات', 'None', 15),
  ('other', 'أخرى', 'Other', 16)) v(code, ar, en, sort)
 where d.code = 'accessories_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'active_noise_cancellation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون عزل', 'None', 0),
  ('passive', 'عزل سلبي (بالتصميم)', 'Passive Isolation', 1),
  ('enc_calls', 'عزل ضوضاء المكالمات (ENC)', 'ENC (Call Noise Reduction)', 2),
  ('anc', 'عزل ضوضاء نشط ANC', 'ANC', 3),
  ('hybrid_anc', 'عزل نشط هجين (Hybrid ANC)', 'Hybrid ANC', 4),
  ('adaptive_anc', 'عزل نشط تكيفي (Adaptive ANC)', 'Adaptive ANC', 5)) v(code, ar, en, sort)
 where d.code = 'active_noise_cancellation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'active_stylus_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('not_supported', 'لا يدعم القلم', 'Not Supported', 0),
  ('supported_sold_separately', 'يدعم القلم (يباع منفصل)', 'Supported (Sold Separately)', 1),
  ('included', 'القلم مرفق في العلبة', 'Stylus Included', 2)) v(code, ar, en, sort)
 where d.code = 'active_stylus_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'activity_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('shape_sorting', 'فرز الأشكال', 'Shape Sorting', 0),
  ('stacking', 'تكديس (رص)', 'Stacking', 1),
  ('nesting', 'تداخل (أكواب متداخلة)', 'Nesting', 2),
  ('color_matching', 'مطابقة الألوان', 'Color Matching', 3),
  ('counting', 'عد وأرقام', 'Counting', 4),
  ('pegging_threading', 'تركيب أوتاد / لضم خرز', 'Pegging / Threading', 5),
  ('hammering', 'دق (شاكوش)', 'Hammering', 6)) v(code, ar, en, sort)
 where d.code = 'activity_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'adhesive_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('liquid_brush', 'سائل بفرشاة', 'Liquid with brush', 0),
  ('liquid_tube', 'سائل في أنبوبة', 'Liquid tube', 1),
  ('gel', 'جل', 'Gel', 2),
  ('tabs', 'لزق جاهز (تابس)', 'Adhesive tabs', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'adhesive_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'adhesive_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clear', 'شفاف', 'Clear', 0),
  ('black', 'أسود', 'Black', 1),
  ('white_to_clear', 'أبيض يجف شفاف', 'White dries clear', 2),
  ('pen', 'قلم لاصق', 'Glue pen', 3),
  ('extension_pro', 'لاصق احترافي للإكستنشن', 'Professional extension glue', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'adhesive_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'تعديل الارتفاع' where code = 'adjustable_height' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fixed', 'ثابت (غير قابل للتعديل)', 'Fixed', 0),
  ('manual_steps', 'يدوي بدرجات / مسامير', 'Manual (steps / pins)', 1),
  ('manual_knob', 'يدوي بمقبض ربط', 'Manual (knob lock)', 2),
  ('gas_spring', 'مكبس غاز / هيدروليك', 'Gas spring / Hydraulic', 3),
  ('crank', 'ذراع لف (كرنك)', 'Hand crank', 4),
  ('electric_single', 'كهربائي بموتور واحد', 'Electric (single motor)', 5),
  ('electric_dual', 'كهربائي بموتورين', 'Electric (dual motor)', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'adjustable_height' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'adjustable_seat' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('not_adjustable', 'ثابت', 'Not adjustable', 0),
  ('height_only', 'ارتفاع فقط', 'Height only', 1),
  ('height_and_distance', 'ارتفاع وقرب/بعد', 'Height and fore/aft', 2),
  ('fully_adjustable', 'قابل للتعديل بالكامل (4 اتجاهات)', 'Fully adjustable (4-way)', 3)) v(code, ar, en, sort)
 where d.code = 'adjustable_seat' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'تعديل ارتفاع المقعد' where code = 'adjustable_seat_height' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gas_lift', 'مكبس غاز (هيدروليك)', 'Gas lift', 0),
  ('fixed', 'ثابت', 'Fixed', 1),
  ('manual', 'يدوي', 'Manual', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'adjustable_seat_height' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'adjustable_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fixed', 'مقاس ثابت', 'Fixed Size', 0),
  ('adjustable', 'قابل لتعديل المقاس', 'Adjustable', 1)) v(code, ar, en, sort)
 where d.code = 'adjustable_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'age_and_safety_warnings' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('small_parts_under3', 'قطع صغيرة - غير مناسب لأقل من 3 سنوات', 'Small Parts - Not for Under 3', 0),
  ('adult_supervision', 'يستخدم تحت إشراف شخص بالغ', 'Adult Supervision Required', 1),
  ('suitable_from_birth', 'مناسب من الولادة', 'Suitable from Birth', 2),
  ('contains_batteries', 'يحتوي على بطاريات - تحفظ بعيدا عن الأطفال', 'Contains Batteries', 3),
  ('magnets', 'يحتوي على مغناطيس - خطر البلع', 'Contains Magnets - Swallowing Hazard', 4),
  ('cord_strangulation', 'خطر الاختناق بالأحبال', 'Cord Strangulation Hazard', 5),
  ('protective_gear', 'يلزم ارتداء أدوات حماية', 'Protective Gear Required', 6),
  ('not_edible', 'غير صالح للأكل', 'Not Edible', 7),
  ('max_weight', 'له حد أقصى للوزن', 'Maximum Weight Limit', 8),
  ('none', 'بدون تحذيرات خاصة', 'No Special Warnings', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'age_and_safety_warnings' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'air_removal_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hand_roll', 'لف باليد', 'Hand Roll', 0),
  ('vacuum_cleaner', 'بالمكنسة الكهربائية', 'Vacuum Cleaner Valve', 1),
  ('hand_pump', 'منفاخ يدوي', 'Hand Pump', 2),
  ('electric_pump', 'منفاخ كهربائي', 'Electric Pump', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'air_removal_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'airflow_operation_modes' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ducted', 'شفط للخارج (بماسورة)', 'Ducted extraction', 0),
  ('recirculation', 'إعادة تدوير بفلتر كربون', 'Recirculation (carbon filter)', 1),
  ('both', 'الاثنين', 'Both', 2)) v(code, ar, en, sort)
 where d.code = 'airflow_operation_modes' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'alcohol_free_as_labeled' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('alcohol_free', 'خالي من الكحول', 'Alcohol-free', 0),
  ('contains_alcohol', 'يحتوي على كحول', 'Contains alcohol', 1)) v(code, ar, en, sort)
 where d.code = 'alcohol_free_as_labeled' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'allergen_statement' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gluten', 'جلوتين (قمح)', 'Gluten', 0),
  ('milk', 'لبن', 'Milk', 1),
  ('eggs', 'بيض', 'Eggs', 2),
  ('peanuts', 'فول سوداني', 'Peanuts', 3),
  ('tree_nuts', 'مكسرات', 'Tree nuts', 4),
  ('soy', 'صويا', 'Soy', 5),
  ('sesame', 'سمسم', 'Sesame', 6),
  ('fish', 'سمك', 'Fish', 7),
  ('shellfish', 'قشريات', 'Shellfish', 8),
  ('mustard', 'مسطردة', 'Mustard', 9),
  ('celery', 'كرفس', 'Celery', 10),
  ('sulphites', 'كبريتيت', 'Sulphites', 11),
  ('may_contain_traces', 'قد يحتوي على آثار', 'May contain traces', 12),
  ('allergen_free', 'خالي من مسببات الحساسية', 'No allergens declared', 13)) v(code, ar, en, sort)
 where d.code = 'allergen_statement' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'ammonia_free' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ammonia_free', 'خالية من الأمونيا', 'Ammonia-free', 0),
  ('low_ammonia', 'أمونيا قليلة', 'Low ammonia', 1),
  ('contains_ammonia', 'تحتوي على أمونيا', 'Contains ammonia', 2)) v(code, ar, en, sort)
 where d.code = 'ammonia_free' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'anti_colic_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('valve_teat', 'صمام في الحلمة', 'Teat Valve', 1),
  ('internal_vent', 'أنبوب تهوية داخلي', 'Internal Vent Tube', 2),
  ('base_vent', 'فتحة تهوية في القاعدة', 'Base Vent', 3),
  ('collapsible_liner', 'كيس داخلي قابل للانكماش', 'Collapsible Liner', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'anti_colic_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'application_area' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('face', 'الوجه', 'Face', 0),
  ('eyes', 'العين', 'Eyes', 1),
  ('lips', 'الشفاه', 'Lips', 2),
  ('cheeks', 'الخدود', 'Cheeks', 3),
  ('brows', 'الحواجب', 'Brows', 4),
  ('lashes', 'الرموش', 'Lashes', 5),
  ('under_eye', 'تحت العين', 'Under-eye', 6),
  ('neck', 'الرقبة', 'Neck', 7),
  ('body', 'الجسم', 'Body', 8),
  ('hands', 'اليدين', 'Hands', 9),
  ('feet', 'القدمين', 'Feet', 10),
  ('nails', 'الأظافر', 'Nails', 11),
  ('hair', 'الشعر', 'Hair', 12),
  ('scalp', 'فروة الرأس', 'Scalp', 13),
  ('wrists_pulse', 'نقاط النبض', 'Pulse points', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'application_area' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'application_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('liquid_gel', 'سائل / جل بالعبوة', 'Liquid / Gel squeeze', 0),
  ('spray', 'بخاخ', 'Spray', 1),
  ('powder', 'بودرة', 'Powder', 2),
  ('rim_block', 'معلق للحافة (ريم بلوك)', 'Rim block', 3),
  ('cistern_tablet', 'أقراص للسيفون', 'Cistern tablet', 4),
  ('gel_stamp', 'جل لاصق (ستامب)', 'Gel stamp', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'application_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'assembly_required' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا، جاهز للاستخدام', 'No, ready to use', 0),
  ('simple', 'تركيب بسيط (عدة مرفقة)', 'Simple assembly (tools included)', 1),
  ('professional', 'يحتاج تركيب فني', 'Professional assembly needed', 2),
  ('free_installation', 'التركيب مجاني من البائع', 'Free installation by seller', 3)) v(code, ar, en, sort)
 where d.code = 'assembly_required' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'attachment_clip_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('lobster', 'كلابة (لوبستر)', 'Lobster Clasp', 0),
  ('swivel_snap', 'خطاف دوار', 'Swivel Snap Hook', 1),
  ('trigger_snap', 'خطاف زناد', 'Trigger Snap', 2),
  ('carabiner', 'كارابينر', 'Carabiner', 3),
  ('d_ring', 'حلقة D', 'D-ring', 4),
  ('buckle', 'إبزيم', 'Buckle', 5),
  ('magnetic', 'مغناطيس', 'Magnetic', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'attachment_clip_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'attachment_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clip_in', 'كلبس', 'Clip-in', 0),
  ('tape_in', 'شريط لاصق', 'Tape-in', 1),
  ('glue', 'صمغ / غراء', 'Glue', 2),
  ('adhesive_tabs', 'لزق جاهز (تابات)', 'Adhesive Tabs', 3),
  ('self_adhesive', 'ذاتي اللصق', 'Self-adhesive', 4),
  ('magnetic', 'مغناطيسي', 'Magnetic', 5),
  ('micro_ring', 'حلقات صغيرة (مايكرو رينج)', 'Micro Ring', 6),
  ('keratin_bond', 'كيراتين (حرارة)', 'Keratin Bond', 7),
  ('sew_in', 'خياطة', 'Sew-in', 8),
  ('halo', 'هالو (خيط شفاف)', 'Halo', 9),
  ('ponytail_wrap', 'ربطة ذيل حصان', 'Ponytail Wrap', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'attachment_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'autofocus' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('af', 'تركيز تلقائي', 'Autofocus', 0),
  ('af_mf', 'تلقائي ويدوي', 'AF / MF', 1),
  ('mf_only', 'يدوي فقط', 'Manual Only', 2)) v(code, ar, en, sort)
 where d.code = 'autofocus' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'automatic_boil_shut_off' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('auto_off_boil_dry', 'فصل تلقائي + حماية من التشغيل فاضية', 'Auto Shut-off + Boil-dry Protection', 0),
  ('auto_off', 'فصل تلقائي بعد الغليان', 'Auto Shut-off', 1),
  ('none', 'بدون فصل تلقائي', 'No Auto Shut-off', 2)) v(code, ar, en, sort)
 where d.code = 'automatic_boil_shut_off' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'automatic_duplex_printing' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('automatic', 'تلقائي', 'Automatic', 0),
  ('manual', 'يدوي', 'Manual', 1),
  ('none', 'غير مدعوم', 'Not supported', 2)) v(code, ar, en, sort)
 where d.code = 'automatic_duplex_printing' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'إيقاف تلقائي عند الوصول للضغط المضبوط' where code = 'automatic_pressure_shutoff' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('digital_preset', 'نعم - ضبط الضغط بشاشة ديجيتال', 'Yes, digital preset', 0),
  ('fixed', 'نعم - يفصل عند ضغط ثابت', 'Yes, fixed cut-off pressure', 1),
  ('no', 'لا (إيقاف يدوي)', 'No (manual stop)', 2)) v(code, ar, en, sort)
 where d.code = 'automatic_pressure_shutoff' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'auxiliary_power_connectors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون (من اللوحة الأم)', 'None', 0),
  ('pin6', '6 بن', '6-pin', 1),
  ('pin8', '8 بن', '8-pin', 2),
  ('pin6_8', '6+8 بن', '6+8-pin', 3),
  ('pin8x2', '2×8 بن', '2x 8-pin', 4),
  ('pin8x3', '3×8 بن', '3x 8-pin', 5),
  ('pin16', '16 بن (12VHPWR)', '16-pin 12VHPWR', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'auxiliary_power_connectors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'backing_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('peva', 'PEVA مقاوم للماء', 'PEVA', 0),
  ('aluminum_foil', 'ألومنيوم عازل', 'Aluminum foil', 1),
  ('pvc', 'PVC', 'PVC', 2),
  ('oxford', 'قماش أكسفورد', 'Oxford fabric', 3),
  ('polyester', 'بوليستر', 'Polyester', 4),
  ('foam', 'إسفنج', 'Foam', 5),
  ('none', 'بدون قاعدة', 'No backing', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'backing_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bag_or_case_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pouch', 'شنطة صغيرة (باوتش)', 'Pouch', 0),
  ('train_case', 'شنطة بيوتي كيس', 'Train case', 1),
  ('trolley', 'شنطة بعجل', 'Trolley case', 2),
  ('hanging', 'شنطة تعليق', 'Hanging bag', 3),
  ('clear', 'شفافة', 'Clear bag', 4),
  ('brush_roll', 'حافظة فرش', 'Brush roll', 5),
  ('toiletry', 'شنطة أدوات سفر', 'Toiletry bag', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'bag_or_case_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bag_or_sleeve_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sleeve', 'جراب (سليف)', 'Sleeve', 0),
  ('briefcase', 'شنطة يد (بريف كيس)', 'Briefcase', 1),
  ('backpack', 'شنطة ظهر', 'Backpack', 2),
  ('messenger', 'شنطة كتف (ماسنجر)', 'Messenger', 3),
  ('tote', 'شنطة توت', 'Tote', 4),
  ('hard_case', 'جراب صلب', 'Hard Case', 5),
  ('rolling', 'شنطة بعجل', 'Rolling Bag', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'bag_or_sleeve_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bag_style' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('backpack', 'شنطة ظهر', 'Backpack', 0),
  ('tote', 'توت', 'Tote', 1),
  ('shoulder', 'كتف', 'Shoulder', 2),
  ('crossbody', 'كروس', 'Crossbody', 3),
  ('messenger', 'ماسنجر', 'Messenger', 4),
  ('clutch', 'كلاتش', 'Clutch', 5),
  ('envelope_clutch', 'كلاتش ظرف', 'Envelope Clutch', 6),
  ('box_clutch', 'كلاتش علبة', 'Box Clutch', 7),
  ('wristlet', 'شنطة معصم', 'Wristlet', 8),
  ('foldable', 'تطبق (فولدينج)', 'Foldable', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'bag_style' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'ball_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('size_1', 'مقاس 1 (ميني)', 'Size 1 (mini)', 0),
  ('size_2', 'مقاس 2', 'Size 2', 1),
  ('size_3', 'مقاس 3', 'Size 3', 2),
  ('size_4', 'مقاس 4', 'Size 4', 3),
  ('size_5', 'مقاس 5', 'Size 5', 4),
  ('size_6', 'مقاس 6', 'Size 6', 5),
  ('size_7', 'مقاس 7', 'Size 7', 6)) v(code, ar, en, sort)
 where d.code = 'ball_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'band_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('65', '65 (30)', '65 (30)', 0),
  ('70', '70 (32)', '70 (32)', 1),
  ('75', '75 (34)', '75 (34)', 2),
  ('80', '80 (36)', '80 (36)', 3),
  ('85', '85 (38)', '85 (38)', 4),
  ('90', '90 (40)', '90 (40)', 5),
  ('95', '95 (42)', '95 (42)', 6),
  ('100', '100 (44)', '100 (44)', 7),
  ('105', '105 (46)', '105 (46)', 8),
  ('110', '110 (48)', '110 (48)', 9),
  ('115', '115 (50)', '115 (50)', 10),
  ('free_size', 'فري سايز', 'Free Size', 11)) v(code, ar, en, sort)
 where d.code = 'band_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'barrel_material_or_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ceramic', 'سيراميك', 'Ceramic', 0),
  ('tourmaline', 'تورمالين', 'Tourmaline', 1),
  ('ceramic_tourmaline', 'سيراميك وتورمالين', 'Ceramic tourmaline', 2),
  ('titanium', 'تيتانيوم', 'Titanium', 3),
  ('keratin', 'كيراتين', 'Keratin coated', 4),
  ('gold', 'مطلي ذهب', 'Gold plated', 5),
  ('chrome', 'كروم', 'Chrome', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'barrel_material_or_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'base_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gold', 'ذهب', 'Gold', 0),
  ('silver', 'فضة', 'Silver', 1),
  ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 2),
  ('brass', 'نحاس أصفر', 'Brass', 3),
  ('copper', 'نحاس أحمر', 'Copper', 4),
  ('alloy', 'معدن مخلوط (سبيكة)', 'Alloy', 5),
  ('titanium', 'تيتانيوم', 'Titanium', 6),
  ('platinum', 'بلاتين', 'Platinum', 7),
  ('tungsten', 'تنجستن', 'Tungsten', 8),
  ('leather', 'جلد', 'Leather', 9),
  ('beads', 'خرز', 'Beads', 10),
  ('resin', 'ريزن', 'Resin', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'base_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'base_oil_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mineral', 'معدني', 'Mineral', 0),
  ('semi_synthetic', 'نصف تخليقي', 'Semi-synthetic', 1),
  ('fully_synthetic', 'تخليقي بالكامل', 'Fully synthetic', 2),
  ('synthetic_pao', 'تخليقي PAO / إستر', 'Synthetic PAO / ester', 3)) v(code, ar, en, sort)
 where d.code = 'base_oil_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'base_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('h4', 'H4', 'H4', 0),
  ('h7', 'H7', 'H7', 1),
  ('h1', 'H1', 'H1', 2),
  ('h3', 'H3', 'H3', 3),
  ('h11', 'H11 / H8 / H9', 'H11 / H8 / H9', 4),
  ('h13', 'H13', 'H13', 5),
  ('hb3', 'HB3 (9005)', 'HB3 (9005)', 6),
  ('hb4', 'HB4 (9006)', 'HB4 (9006)', 7),
  ('h27', 'H27 (880/881)', 'H27 (880/881)', 8),
  ('d_series', 'زينون D1S / D2S / D3S / D4S', 'Xenon D1S / D2S / D3S / D4S', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'base_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bath_tool_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('natural_loofah', 'ليفة طبيعية', 'Natural loofah', 0),
  ('mesh_pouf', 'ليفة شبك', 'Mesh pouf', 1),
  ('sponge', 'إسفنجة', 'Sponge', 2),
  ('kees_glove', 'كيس حمام مغربي (جوانتي)', 'Exfoliating glove', 3),
  ('back_brush', 'فرشاة ظهر بيد طويلة', 'Long-handle back brush', 4),
  ('back_strap', 'ليفة ظهر بمقبضين', 'Back strap', 5),
  ('silicone', 'ليفة سيليكون', 'Silicone scrubber', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'bath_tool_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'battery_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('smf', 'جافة (بدون صيانة)', 'Maintenance-free (SMF)', 0),
  ('flooded', 'سائلة (مية)', 'Flooded lead-acid', 1),
  ('efb', 'EFB', 'EFB', 2),
  ('agm', 'AGM', 'AGM', 3),
  ('gel', 'جل', 'Gel', 4),
  ('lithium', 'ليثيوم', 'Lithium', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'battery_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bed_size_category' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('crib', 'سرير أطفال', 'Crib', 0),
  ('single_90', 'فردي 90×190', 'Single 90×190', 1),
  ('single_100', 'فردي 100×200', 'Single 100×200', 2),
  ('semi_double_120', 'نص ونص 120×200', 'Semi-double 120×200', 3),
  ('double_140', 'دبل 140×200', 'Double 140×200', 4),
  ('double_150', 'دبل 150×200', 'Double 150×200', 5),
  ('queen_160', 'كوين 160×200', 'Queen 160×200', 6),
  ('king_180', 'كينج 180×200', 'King 180×200', 7),
  ('super_king_200', 'سوبر كينج 200×200', 'Super King 200×200', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'bed_size_category' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'belt_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('timing', 'سير كاتينة (تايمنج)', 'Timing belt', 0),
  ('serpentine', 'سير مجرى (Poly-V)', 'Serpentine / Poly-V ribbed', 1),
  ('v_belt', 'سير مسنن V', 'V-belt', 2),
  ('timing_kit', 'طقم سير كاتينة مع البلي', 'Timing belt kit', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'belt_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'beverage_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('juice_100', 'عصير طبيعي 100%', '100% juice', 0),
  ('nectar', 'نكتار', 'Nectar', 1),
  ('juice_drink', 'مشروب عصير', 'Juice drink', 2),
  ('smoothie', 'سموذي', 'Smoothie', 3),
  ('concentrate', 'عصير مركز', 'Concentrate', 4),
  ('vegetable_juice', 'عصير خضار', 'Vegetable juice', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'beverage_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bib_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cloth', 'قماش', 'Cloth', 0),
  ('waterproof', 'ضد الماء', 'Waterproof', 1),
  ('silicone_pocket', 'سيليكون بجيب', 'Silicone with Pocket', 2),
  ('bandana', 'باندانا', 'Bandana', 3),
  ('sleeved', 'بأكمام', 'Sleeved', 4),
  ('disposable', 'استعمال مرة واحدة', 'Disposable', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'bib_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bicycle_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mountain', 'جبلي (ماونتن)', 'Mountain bike', 0),
  ('road', 'سباق (رود)', 'Road bike', 1),
  ('city_hybrid', 'مدينة / هايبرد', 'City / hybrid', 2),
  ('bmx', 'BMX', 'BMX', 3),
  ('folding', 'قابلة للطي', 'Folding', 4),
  ('fat_bike', 'فات بايك (كاوتش عريض)', 'Fat bike', 5),
  ('fixie', 'فيكسي', 'Fixie / single speed', 6),
  ('electric', 'كهربائية', 'Electric', 7),
  ('kids_training_wheels', 'أطفال بعجل مساعد', 'Kids with training wheels', 8),
  ('balance', 'دراجة توازن بدون بدال', 'Balance bike', 9),
  ('tricycle', 'تروسيكل 3 عجل', 'Tricycle', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'bicycle_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'binding' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('paperback', 'غلاف ورقي', 'Paperback', 0),
  ('hardcover', 'غلاف مقوى (هارد كفر)', 'Hardcover', 1),
  ('spiral', 'سلك (سبيرال)', 'Spiral', 2),
  ('board_book', 'كرتون مقوى (للأطفال)', 'Board Book', 3),
  ('leather', 'غلاف جلد', 'Leather-bound', 4),
  ('stapled', 'دبوس', 'Stapled', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'binding' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'biscuit_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('plain_tea', 'بسكويت شاي سادة', 'Plain / tea biscuits', 0),
  ('cream_sandwich', 'محشي كريمة', 'Cream sandwich', 1),
  ('chocolate_coated', 'مغطى شوكولاتة', 'Chocolate coated', 2),
  ('wafer', 'ويفر', 'Wafer', 3),
  ('cookies', 'كوكيز', 'Cookies', 4),
  ('digestive', 'دايجستيف', 'Digestive', 5),
  ('butter', 'بسكويت زبدة', 'Butter cookies', 6),
  ('petit_four', 'بيتي فور', 'Petit four', 7),
  ('date_filled', 'محشي عجوة (معمول)', 'Date-filled / maamoul', 8),
  ('crackers', 'كراكرز مالح', 'Savory crackers', 9),
  ('rusk', 'بقسماط', 'Rusk', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'biscuit_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bit_holder_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hex_quarter_magnetic', 'سداسي 1/4 بوصة مغناطيسي', '1/4" hex magnetic', 0),
  ('hex_quick_release', 'سداسي 1/4 بوصة تثبيت سريع', '1/4" hex quick release', 1),
  ('keyless_chuck', 'ظرف بدون مفتاح', 'Keyless chuck', 2),
  ('fixed_bit', 'لقمة ثابتة', 'Fixed bit', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'bit_holder_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'blade_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stainless', 'ستانلس ستيل', 'Stainless steel', 0),
  ('high_carbon', 'ستانلس عالي الكربون', 'High-carbon stainless', 1),
  ('japanese', 'صلب ياباني', 'Japanese steel', 2),
  ('damascus', 'دمشقي', 'Damascus', 3),
  ('carbon_steel', 'صلب كربوني', 'Carbon steel', 4),
  ('ceramic', 'سيراميك', 'Ceramic', 5),
  ('titanium_coated', 'مطلي تيتانيوم', 'Titanium coated', 6),
  ('diamond', 'ألماس', 'Diamond', 7),
  ('tungsten_carbide', 'كربيد التنجستن', 'Tungsten carbide', 8),
  ('whetstone', 'حجر سن', 'Whetstone', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'blade_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'blade_or_cartridge_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('double_edge', 'موس دبل (أمان)', 'Double-edge blade', 0),
  ('single_edge', 'موس سنجل / شفرة حلاق', 'Single-edge blade', 1),
  ('cartridge_2', 'رأس 2 شفرة', '2-blade cartridge', 2),
  ('cartridge_3', 'رأس 3 شفرات', '3-blade cartridge', 3),
  ('cartridge_4', 'رأس 4 شفرات', '4-blade cartridge', 4),
  ('cartridge_5', 'رأس 5 شفرات', '5-blade cartridge', 5),
  ('cartridge_6', 'رأس 6 شفرات', '6-blade cartridge', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'blade_or_cartridge_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'block_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('classic_bricks', 'مكعبات صغيرة كلاسيك (متوافقة مع ليجو)', 'Classic Bricks (LEGO-compatible)', 0),
  ('large_duplo', 'مكعبات كبيرة للصغار (دوبلو)', 'Large Blocks (Duplo-type)', 1),
  ('magnetic_tiles', 'بلاطات مغناطيسية', 'Magnetic Tiles', 2),
  ('magnetic_sticks', 'عصيان وكور مغناطيسية', 'Magnetic Sticks & Balls', 3),
  ('wooden', 'مكعبات خشب', 'Wooden Blocks', 4),
  ('micro_nano', 'مكعبات ميكرو / نانو', 'Micro / Nano Blocks', 5),
  ('technic', 'تكنيك / ميكانيكية', 'Technic / Mechanical', 6),
  ('soft_foam', 'مكعبات إسفنج / طرية', 'Soft Foam Blocks', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'block_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bluetooth' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون بلوتوث', 'No Bluetooth', 0),
  ('4x', 'بلوتوث 4.x', 'Bluetooth 4.x', 1),
  ('5_0', 'بلوتوث 5.0', 'Bluetooth 5.0', 2),
  ('5_1', 'بلوتوث 5.1', 'Bluetooth 5.1', 3),
  ('5_2', 'بلوتوث 5.2', 'Bluetooth 5.2', 4),
  ('5_3', 'بلوتوث 5.3', 'Bluetooth 5.3', 5),
  ('5_4', 'بلوتوث 5.4', 'Bluetooth 5.4', 6),
  ('6_0', 'بلوتوث 6.0', 'Bluetooth 6.0', 7),
  ('ble', 'بلوتوث منخفض الطاقة (BLE)', 'Bluetooth Low Energy (BLE)', 8)) v(code, ar, en, sort)
 where d.code = 'bluetooth' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bluetooth_calling' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('not_supported', 'لا يدعم المكالمات', 'No Calling', 0),
  ('notifications_only', 'إشعارات المكالمات فقط', 'Call Notifications Only', 1),
  ('bluetooth_calls', 'مكالمات بلوتوث (مايك وسماعة)', 'Bluetooth Calls (Mic & Speaker)', 2),
  ('esim_standalone', 'مكالمات مستقلة بشريحة / eSIM', 'Standalone Calls (SIM / eSIM)', 3)) v(code, ar, en, sort)
 where d.code = 'bluetooth_calling' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'board_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('classic', 'سكيت بورد كلاسيك', 'Classic Skateboard', 0),
  ('cruiser_penny', 'كروزر / بيني بورد', 'Cruiser / Penny Board', 1),
  ('longboard', 'لونج بورد', 'Longboard', 2),
  ('surfskate', 'سيرف سكيت', 'Surfskate', 3),
  ('waveboard', 'ويف بورد (لوح بعجلتين)', 'Waveboard', 4),
  ('electric', 'لوح كهربائي', 'Electric Skateboard', 5),
  ('kids_mini', 'لوح أطفال', 'Kids Mini Board', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'board_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bottle_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pp', 'بلاستيك PP', 'PP Plastic', 0),
  ('ppsu', 'بلاستيك PPSU', 'PPSU', 1),
  ('tritan', 'تريتان', 'Tritan', 2),
  ('pet', 'بلاستيك PET', 'PET Plastic', 3),
  ('glass', 'زجاج', 'Glass', 4),
  ('silicone', 'سيليكون', 'Silicone', 5),
  ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 6),
  ('aluminum', 'ألومنيوم', 'Aluminum', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'bottle_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'طول البنطلون / الشورت' where code = 'bottom_length' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('shorts', 'شورت', 'Shorts', 0),
  ('knee', 'لحد الركبة', 'Knee length', 1),
  ('capri', 'كابري (3/4)', 'Capri 3/4', 2),
  ('ankle', 'لحد الكاحل', 'Ankle length', 3),
  ('full', 'طويل كامل', 'Full length', 4)) v(code, ar, en, sort)
 where d.code = 'bottom_length' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bowl_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 0),
  ('glass', 'زجاج', 'Glass', 1),
  ('plastic', 'بلاستيك', 'Plastic', 2),
  ('ceramic', 'سيراميك', 'Ceramic', 3)) v(code, ar, en, sort)
 where d.code = 'bowl_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'boxing_glove_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('training', 'تدريب', 'Training', 0),
  ('sparring', 'سبارينج (نزال تدريبي)', 'Sparring', 1),
  ('bag', 'كيس (باج)', 'Bag gloves', 2),
  ('competition', 'مباريات', 'Competition', 3),
  ('muay_thai_kickboxing', 'كيك بوكسينج / مواي تاي', 'Kickboxing / Muay Thai', 4),
  ('mma', 'MMA (أصابع مفتوحة)', 'MMA (open finger)', 5),
  ('kids', 'أطفال', 'Kids', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'boxing_glove_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bra_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tshirt', 'تي شيرت (ناعم بدون خياطة)', 'T-shirt Bra', 0),
  ('push_up', 'بوش أب', 'Push-up', 1),
  ('balconette', 'بالكونيت', 'Balconette', 2),
  ('plunge', 'بلانج (فتحة عميقة)', 'Plunge', 3),
  ('full_coverage', 'تغطية كاملة', 'Full Coverage', 4),
  ('minimizer', 'مصغر (مينيمايزر)', 'Minimizer', 5),
  ('strapless', 'بدون حمالات (سترابلس)', 'Strapless', 6),
  ('bralette', 'برالت', 'Bralette', 7),
  ('sports', 'رياضي', 'Sports Bra', 8),
  ('nursing', 'رضاعة', 'Nursing Bra', 9),
  ('adhesive', 'لاصق (سيليكون)', 'Adhesive / Stick-on', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'bra_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'brake_disc_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('vented', 'مهوّى', 'Vented', 0),
  ('solid', 'مصمت', 'Solid', 1),
  ('drilled', 'مثقب', 'Drilled', 2),
  ('slotted', 'مشقوق', 'Slotted', 3),
  ('drilled_slotted', 'مثقب ومشقوق', 'Drilled and slotted', 4),
  ('drum', 'طنبورة (درام)', 'Drum', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'brake_disc_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'brake_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rim_v_brake', 'فرامل فكي (V-Brake)', 'Rim / V-brake', 0),
  ('mechanical_disc', 'ديسك ميكانيكي (سلك)', 'Mechanical disc', 1),
  ('hydraulic_disc', 'ديسك هيدروليك (زيت)', 'Hydraulic disc', 2),
  ('coaster', 'فرامل بالبدال للخلف', 'Coaster (back-pedal)', 3),
  ('drum', 'طنبورة', 'Drum brake', 4),
  ('electronic_regen', 'فرامل كهربائية (إلكترونية)', 'Electronic / regenerative', 5),
  ('rear_fender_foot', 'فرامل رجل على الرفرف الخلفي', 'Rear fender foot brake', 6),
  ('toe_stop', 'فرامل أمامية (توو ستوب)', 'Toe stop', 7),
  ('heel_brake', 'فرامل كعب', 'Heel brake', 8),
  ('none', 'بدون فرامل', 'No brake', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'brake_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'brightness_control' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون (سطوع ثابت)', 'None (fixed)', 0),
  ('touch_dimmer', 'تاتش بتدرج', 'Touch dimmer', 1),
  ('stepped', 'مستويات محددة', 'Stepped levels', 2),
  ('dimmer_color_modes', 'تدرج + 3 ألوان إضاءة', 'Dimmer + 3 color modes', 3),
  ('remote', 'بريموت', 'Remote control', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'brightness_control' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bristle_firmness' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('extra_soft', 'ناعمة جدًا', 'Extra Soft', 0),
  ('soft', 'ناعمة', 'Soft', 1),
  ('medium', 'متوسطة', 'Medium', 2),
  ('hard', 'خشنة', 'Hard', 3)) v(code, ar, en, sort)
 where d.code = 'bristle_firmness' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bristle_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('nylon', 'نايلون', 'Nylon', 0),
  ('synthetic', 'ألياف صناعية', 'Synthetic Fibers', 1),
  ('taklon', 'تاكلون', 'Taklon', 2),
  ('natural_hair', 'شعر طبيعي', 'Natural Hair', 3),
  ('boar', 'شعر خنزير بري', 'Boar Bristle', 4),
  ('badger', 'شعر غرير', 'Badger Hair', 5),
  ('goat', 'شعر ماعز', 'Goat Hair', 6),
  ('horsehair', 'شعر حصان', 'Horsehair', 7),
  ('silicone', 'سيليكون', 'Silicone', 8),
  ('plastic', 'بلاستيك', 'Plastic', 9),
  ('sponge', 'إسفنج', 'Sponge', 10),
  ('metal_pins', 'سنون معدن', 'Metal Pins', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'bristle_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'brush_rotation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'ثابتة', 'Non-rotating', 0),
  ('one_way', 'دوران في اتجاه واحد', 'One-direction', 1),
  ('two_way', 'دوران في الاتجاهين', 'Bi-directional', 2)) v(code, ar, en, sort)
 where d.code = 'brush_rotation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'brush_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bottle_brush', 'فرشاة رضاعة', 'Bottle Brush', 0),
  ('nipple_brush', 'فرشاة حلمات', 'Nipple Brush', 1),
  ('straw_brush', 'فرشاة شفاطات', 'Straw Brush', 2),
  ('sponge_brush', 'فرشاة إسفنج', 'Sponge Brush', 3),
  ('silicone_brush', 'فرشاة سيليكون', 'Silicone Brush', 4),
  ('set', 'طقم فرش', 'Brush Set', 5),
  ('electric', 'فرشاة كهربائية دوارة', 'Electric Rotating Brush', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'brush_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'brush_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('foundation', 'كريم أساس', 'Foundation', 0),
  ('concealer', 'كونسيلر', 'Concealer', 1),
  ('powder', 'بودرة', 'Powder', 2),
  ('blush', 'بلاشر', 'Blush', 3),
  ('contour', 'كونتور', 'Contour', 4),
  ('highlighter', 'هايلايتر', 'Highlighter', 5),
  ('kabuki', 'كابوكي', 'Kabuki', 6),
  ('eyeshadow', 'ظلال عيون', 'Eyeshadow', 7),
  ('blending', 'دمج', 'Blending', 8),
  ('eyeliner', 'آيلاينر', 'Eyeliner', 9),
  ('brow', 'حواجب', 'Brow', 10),
  ('lip', 'شفاه', 'Lip', 11),
  ('full_set', 'طقم كامل', 'Full set', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'brush_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'brushing_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('oscillating', 'دوارة تذبذبية', 'Oscillating-rotating', 0),
  ('sonic', 'سونيك (اهتزاز)', 'Sonic', 1),
  ('ultrasonic', 'ألتراسونيك', 'Ultrasonic', 2),
  ('pulsating', 'دوارة نبضية 3D', '3D pulsating', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'brushing_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bucket_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون جردل', 'No Bucket', 0),
  ('spin_bucket', 'جردل دوار (سبين)', 'Spin Bucket', 1),
  ('wringer_bucket', 'جردل بعصارة', 'Bucket with Wringer', 2),
  ('dual_compartment', 'جردل بخزانين (نظيف ومتسخ)', 'Dual-compartment Bucket', 3),
  ('plain_bucket', 'جردل عادي', 'Plain Bucket', 4)) v(code, ar, en, sort)
 where d.code = 'bucket_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_dsl_modem' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون مودم', 'None', 0),
  ('adsl', 'ADSL / ADSL2+', 'ADSL / ADSL2+', 1),
  ('vdsl', 'VDSL / VDSL2', 'VDSL / VDSL2', 2)) v(code, ar, en, sort)
 where d.code = 'built_in_dsl_modem' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_grinder' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون مطحنة', 'No Grinder', 0),
  ('conical_burr', 'مطحنة مخروطية (Conical Burr)', 'Conical Burr Grinder', 1),
  ('flat_burr', 'مطحنة مسطحة (Flat Burr)', 'Flat Burr Grinder', 2),
  ('blade', 'مطحنة شفرات', 'Blade Grinder', 3)) v(code, ar, en, sort)
 where d.code = 'built_in_grinder' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_lock' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون قفل', 'None', 0),
  ('combination', 'قفل أرقام', 'Combination', 1),
  ('tsa', 'قفل TSA', 'TSA Lock', 2),
  ('key', 'قفل بمفتاح', 'Key Lock', 3)) v(code, ar, en, sort)
 where d.code = 'built_in_lock' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_microphone' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون ميكروفون', 'None', 0),
  ('single', 'ميكروفون واحد', 'Single Mic', 1),
  ('dual', 'ميكروفونين', 'Dual Mic', 2),
  ('enc', 'ميكروفون عازل للضوضاء (ENC)', 'Noise-cancelling Mic (ENC)', 3),
  ('boom', 'ميكروفون ذراع', 'Boom Mic', 4),
  ('detachable', 'ميكروفون يتشال', 'Detachable Mic', 5)) v(code, ar, en, sort)
 where d.code = 'built_in_microphone' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'built_in_positioning_systems' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون (يعتمد على GPS الموبايل)', 'None (Connected GPS)', 0),
  ('gps', 'GPS', 'GPS', 1),
  ('dual_band_gps', 'GPS ثنائي التردد (L1+L5)', 'Dual-band GPS (L1+L5)', 2),
  ('glonass', 'GLONASS', 'GLONASS', 3),
  ('galileo', 'Galileo', 'Galileo', 4),
  ('beidou', 'BeiDou', 'BeiDou', 5),
  ('qzss', 'QZSS', 'QZSS', 6),
  ('lbs_wifi', 'تحديد بالشبكة / Wi-Fi (LBS)', 'LBS / Wi-Fi Positioning', 7)) v(code, ar, en, sort)
 where d.code = 'built_in_positioning_systems' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_satellite_receiver' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون رسيفر', 'No Receiver', 0),
  ('built_in', 'رسيفر مدمج', 'Built-in Receiver', 1),
  ('built_in_dual', 'رسيفر مدمج (أقمار + أرضي)', 'Built-in Receiver (Satellite + Terrestrial)', 2)) v(code, ar, en, sort)
 where d.code = 'built_in_satellite_receiver' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_wireless_charging' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون شحن لاسلكي', 'No wireless charging', 0),
  ('qi_10w', 'شحن لاسلكي Qi حتى 10 وات', 'Qi up to 10W', 1),
  ('qi_15w', 'شحن لاسلكي سريع 15 وات', 'Fast Qi 15W', 2),
  ('magsafe', 'MagSafe / Qi2 مغناطيسي', 'MagSafe / Qi2 magnetic', 3)) v(code, ar, en, sort)
 where d.code = 'built_in_wireless_charging' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'built_in_wireless_connectivity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('wifi5_bt', 'Wi-Fi 5 + Bluetooth', 'Wi-Fi 5 + Bluetooth', 1),
  ('wifi6_bt', 'Wi-Fi 6 + Bluetooth', 'Wi-Fi 6 + Bluetooth', 2),
  ('wifi6e_bt', 'Wi-Fi 6E + Bluetooth', 'Wi-Fi 6E + Bluetooth', 3),
  ('wifi7_bt', 'Wi-Fi 7 + Bluetooth', 'Wi-Fi 7 + Bluetooth', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'built_in_wireless_connectivity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bulb_base_code' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('p43t', 'P43t (H4)', 'P43t (H4)', 0),
  ('px26d', 'PX26d (H7)', 'PX26d (H7)', 1),
  ('p14_5s', 'P14.5s (H1)', 'P14.5s (H1)', 2),
  ('pk22s', 'PK22s (H3)', 'PK22s (H3)', 3),
  ('pgj19_2', 'PGJ19-2 (H11)', 'PGJ19-2 (H11)', 4),
  ('p20d', 'P20d (HB3)', 'P20d (HB3)', 5),
  ('p22d', 'P22d (HB4)', 'P22d (HB4)', 6),
  ('w2_1x9_5d', 'W2.1x9.5d (T10 ونش)', 'W2.1x9.5d (T10 wedge)', 7),
  ('w3x16d', 'W3x16d (T20)', 'W3x16d (T20)', 8),
  ('ba15s', 'BA15s (مسمار واحد)', 'BA15s (single contact)', 9),
  ('bay15d', 'BAY15d (مسمارين)', 'BAY15d (dual contact)', 10),
  ('festoon', 'فستون SV8.5', 'Festoon SV8.5', 11),
  ('xenon_d', 'قاعدة زينون D', 'Xenon D-series base', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'bulb_base_code' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bulb_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم، اللمبة مرفقة', 'Yes', 0),
  ('no', 'لا، بدون لمبة', 'No', 1),
  ('integrated_led', 'LED مدمج (بدون لمبة منفصلة)', 'Integrated LED', 2)) v(code, ar, en, sort)
 where d.code = 'bulb_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bulb_type_code' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('h4', 'H4', 'H4', 0),
  ('h7', 'H7', 'H7', 1),
  ('h1', 'H1', 'H1', 2),
  ('h3', 'H3', 'H3', 3),
  ('h11', 'H11 / H8', 'H11 / H8', 4),
  ('hb3', 'HB3 (9005)', 'HB3 (9005)', 5),
  ('hb4', 'HB4 (9006)', 'HB4 (9006)', 6),
  ('d2s', 'D2S / D4S / D1S', 'D1S / D2S / D4S', 7),
  ('w5w', 'W5W (T10)', 'W5W (T10)', 8),
  ('p21w', 'P21W', 'P21W', 9),
  ('p21_5w', 'P21/5W', 'P21/5W', 10),
  ('w21w', 'W21W / W21/5W (T20)', 'W21W / W21/5W (T20)', 11),
  ('py21w', 'PY21W (برتقالي)', 'PY21W (amber)', 12),
  ('c5w', 'C5W (فستون)', 'C5W (festoon)', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'bulb_type_code' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bulbs_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم، اللمبات مرفقة', 'Yes', 0),
  ('no', 'لا، بدون لمبات', 'No', 1),
  ('integrated_led', 'LED مدمج (بدون لمبات منفصلة)', 'Integrated LED', 2)) v(code, ar, en, sort)
 where d.code = 'bulbs_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'bus_interface' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pcie3_x16', 'PCIe 3.0 x16', 'PCIe 3.0 x16', 0),
  ('pcie4_x8', 'PCIe 4.0 x8', 'PCIe 4.0 x8', 1),
  ('pcie4_x16', 'PCIe 4.0 x16', 'PCIe 4.0 x16', 2),
  ('pcie5_x8', 'PCIe 5.0 x8', 'PCIe 5.0 x8', 3),
  ('pcie5_x16', 'PCIe 5.0 x16', 'PCIe 5.0 x16', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'bus_interface' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cable_function' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('throttle', 'سلك بنزين', 'Throttle', 0),
  ('clutch', 'سلك دبرياج', 'Clutch', 1),
  ('front_brake', 'سلك فرامل أمامي', 'Front brake', 2),
  ('rear_brake', 'سلك فرامل خلفي', 'Rear brake', 3),
  ('speedometer', 'سلك عداد', 'Speedometer', 4),
  ('choke', 'سلك شوك', 'Choke', 5),
  ('seat_lock', 'سلك فتح الكرسي', 'Seat lock', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'cable_function' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cable_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون كابل', 'No Cable', 0),
  ('usb_c_to_usb_c', 'كابل USB-C إلى USB-C', 'USB-C to USB-C', 1),
  ('usb_a_to_usb_c', 'كابل USB-A إلى USB-C', 'USB-A to USB-C', 2),
  ('usb_c_to_lightning', 'كابل USB-C إلى Lightning', 'USB-C to Lightning', 3),
  ('usb_a_to_lightning', 'كابل USB-A إلى Lightning', 'USB-A to Lightning', 4),
  ('micro_usb', 'كابل Micro USB', 'Micro USB Cable', 5),
  ('built_in', 'كابل مدمج في الشاحن', 'Built-in Cable', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'cable_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'canopy_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('polyester', 'بوليستر', 'Polyester', 0),
  ('pongee', 'بونجي', 'Pongee', 1),
  ('nylon', 'نايلون', 'Nylon', 2),
  ('clear_poe', 'بلاستيك شفاف', 'Clear Plastic (POE/PVC)', 3),
  ('uv_coated', 'مبطن ضد UV', 'UV-coated Fabric', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'canopy_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cap_construction' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('lace_front', 'لايس أمامي', 'Lace Front', 0),
  ('full_lace', 'لايس كامل', 'Full Lace', 1),
  ('lace_360', 'لايس 360', '360 Lace', 2),
  ('hd_lace', 'لايس HD', 'HD Lace', 3),
  ('lace_closure', 'كلوجر لايس', 'Lace Closure', 4),
  ('glueless', 'بدون صمغ (جلولس)', 'Glueless', 5),
  ('u_part', 'يو بارت', 'U-part', 6),
  ('headband_wig', 'باروكة بطوق', 'Headband Wig', 7),
  ('monofilament', 'مونوفيلامنت', 'Monofilament', 8),
  ('machine_made', 'ماكينة (قاعدة عادية)', 'Machine-made', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'cap_construction' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cap_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('small', 'صغير', 'Small', 0),
  ('medium', 'متوسط', 'Medium', 1),
  ('large', 'كبير', 'Large', 2),
  ('adjustable', 'قابل للتعديل', 'Adjustable', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'cap_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cap_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('e27', 'E27 (قلاوظ كبير)', 'E27', 0),
  ('e14', 'E14 (قلاوظ صغير)', 'E14', 1),
  ('b22', 'B22 (مسمار)', 'B22 bayonet', 2),
  ('gu10', 'GU10', 'GU10', 3),
  ('mr16_gu5_3', 'MR16 / GU5.3', 'MR16 / GU5.3', 4),
  ('g9', 'G9', 'G9', 5),
  ('g4', 'G4', 'G4', 6),
  ('e40', 'E40', 'E40', 7),
  ('g13_t8', 'G13 (نيون T8)', 'G13 (T8 tube)', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'cap_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'car_seat_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('infant_carrier', 'كاري للرضع (جروب 0+)', 'Infant carrier (group 0+)', 0),
  ('convertible_0_1', 'متحول (جروب 0+/1)', 'Convertible (group 0+/1)', 1),
  ('group_1', 'جروب 1', 'Group 1', 2),
  ('group_2_3', 'بوستر بظهر (جروب 2/3)', 'High-back booster (group 2/3)', 3),
  ('booster_cushion', 'بوستر قاعدة فقط', 'Booster cushion', 4),
  ('all_in_one', 'كل المراحل (0-36 كجم)', 'All-in-one (0-36 kg)', 5),
  ('rotating', 'دوار 360', '360 rotating', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'car_seat_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'carbonation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('still', 'عادية (غير فوارة)', 'Still', 0),
  ('lightly_sparkling', 'فوارة خفيفة', 'Lightly sparkling', 1),
  ('sparkling', 'فوارة', 'Sparkling', 2)) v(code, ar, en, sort)
 where d.code = 'carbonation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'card_format' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('micro_sd', 'microSD', 'microSD', 0),
  ('sd', 'SD', 'SD', 1),
  ('cfexpress', 'CFexpress', 'CFexpress', 2),
  ('cf', 'CompactFlash', 'CompactFlash', 3),
  ('xqd', 'XQD', 'XQD', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'card_format' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'carrying_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('handles', 'يد', 'Handles', 0),
  ('shoulder_strap', 'حمالة كتف', 'Shoulder Strap', 1),
  ('crossbody', 'كروس', 'Crossbody', 2),
  ('backpack', 'حمالات ظهر', 'Backpack Straps', 3),
  ('trolley', 'عجل وذراع سحب', 'Trolley Handle', 4)) v(code, ar, en, sort)
 where d.code = 'carrying_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'carrying_positions' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front_inward', 'أمامي للداخل', 'Front Inward', 0),
  ('front_outward', 'أمامي للخارج', 'Front Outward', 1),
  ('hip', 'على الجنب', 'Hip', 2),
  ('back', 'على الظهر', 'Back', 3),
  ('newborn_cradle', 'وضع حديث الولادة (نايم)', 'Newborn Cradle', 4)) v(code, ar, en, sort)
 where d.code = 'carrying_positions' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'case_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('silicone_back', 'جراب سيليكون', 'Silicone Back Case', 0),
  ('clear', 'جراب شفاف', 'Clear Case', 1),
  ('hard_back', 'جراب هارد', 'Hard Back Case', 2),
  ('rugged_armor', 'جراب ضد الصدمات (أرمر)', 'Rugged / Armor Case', 3),
  ('magsafe', 'جراب MagSafe مغناطيسي', 'MagSafe Case', 4),
  ('leather', 'جراب جلد', 'Leather Case', 5),
  ('flip_book', 'جراب فليب (كتاب)', 'Flip / Book Cover', 6),
  ('wallet', 'جراب محفظة', 'Wallet Case', 7),
  ('smart_folio', 'سمارت كفر (فوليو)', 'Smart Folio Cover', 8),
  ('keyboard_case', 'جراب بكيبورد', 'Keyboard Case', 9),
  ('kids_eva', 'جراب أطفال إسفنج EVA', 'Kids EVA Case', 10),
  ('stand_ring', 'جراب بحامل / رينج', 'Case with Stand / Ring', 11),
  ('battery_case', 'جراب بطارية', 'Battery Case', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'case_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cca_test_standard' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('en', 'EN', 'EN', 0),
  ('sae', 'SAE', 'SAE', 1),
  ('din', 'DIN', 'DIN', 2),
  ('jis', 'JIS', 'JIS', 3),
  ('iec', 'IEC', 'IEC', 4)) v(code, ar, en, sort)
 where d.code = 'cca_test_standard' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'certification' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ce', 'CE', 'CE', 0),
  ('fda', 'FDA', 'FDA', 1),
  ('iso_13485', 'ISO 13485', 'ISO 13485', 2),
  ('iso_9001', 'ISO 9001', 'ISO 9001', 3),
  ('eda', 'هيئة الدواء المصرية', 'Egyptian Drug Authority', 4),
  ('en_14683', 'EN 14683 (كمامات طبية)', 'EN 14683', 5),
  ('ffp2_ffp3', 'FFP2 / FFP3 (EN 149)', 'FFP2 / FFP3 (EN 149)', 6),
  ('n95', 'N95 (NIOSH)', 'N95 (NIOSH)', 7),
  ('gmp', 'GMP', 'GMP', 8),
  ('none_declared', 'بدون شهادة معلنة', 'None declared', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'certification' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'chain_seal_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standard', 'عادي (بدون حلقات)', 'Standard (non-sealed)', 0),
  ('o_ring', 'O-Ring', 'O-ring', 1),
  ('x_ring', 'X-Ring', 'X-ring', 2),
  ('z_ring', 'Z-Ring', 'Z-ring', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'chain_seal_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'chain_size_code' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('428', '428', '428', 0),
  ('428h', '428H', '428H', 1),
  ('420', '420', '420', 2),
  ('415', '415', '415', 3),
  ('520', '520', '520', 4),
  ('525', '525', '525', 5),
  ('530', '530', '530', 6),
  ('25h', '25H', '25H', 7),
  ('219', '219', '219', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'chain_size_code' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'changing_mat_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('portable_foldable', 'محمول يطوى', 'Portable Foldable', 0),
  ('contoured_foam', 'إسفنج بحواف', 'Contoured Foam', 1),
  ('waterproof_pad', 'مفرش ضد الماء', 'Waterproof Pad', 2),
  ('disposable', 'استعمال مرة واحدة', 'Disposable', 3),
  ('changing_station', 'مفرش مع منظم', 'Changing Station', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'changing_mat_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'character_or_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('teddy_bear', 'دبدوب', 'Teddy Bear', 0),
  ('rabbit', 'أرنب', 'Rabbit', 1),
  ('cat', 'قطة', 'Cat', 2),
  ('dog', 'كلب', 'Dog', 3),
  ('unicorn', 'يونيكورن', 'Unicorn', 4),
  ('dinosaur', 'ديناصور', 'Dinosaur', 5),
  ('panda', 'باندا', 'Panda', 6),
  ('elephant', 'فيل', 'Elephant', 7),
  ('lion_tiger', 'أسد / نمر', 'Lion / Tiger', 8),
  ('monkey', 'قرد', 'Monkey', 9),
  ('sea_animals', 'حيوانات بحرية', 'Sea Animals', 10),
  ('heart', 'قلب', 'Heart', 11),
  ('food_shape', 'شكل أكل / فاكهة', 'Food / Fruit Shape', 12),
  ('cartoon_character', 'شخصية كرتونية', 'Cartoon Character', 13),
  ('doll', 'عروسة قماش', 'Rag Doll', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'character_or_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'charger_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wall', 'شاحن حائط (رأس شاحن)', 'Wall Charger', 0),
  ('gan_wall', 'شاحن حائط GaN', 'GaN Wall Charger', 1),
  ('wireless_pad', 'شاحن لاسلكي', 'Wireless Charger', 2),
  ('magnetic_magsafe', 'شاحن مغناطيسي MagSafe', 'Magnetic MagSafe Charger', 3),
  ('multi_device_station', 'محطة شحن لأكثر من جهاز', 'Multi-device Charging Station', 4),
  ('desktop_multi_port', 'شاحن مكتبي متعدد المنافذ', 'Desktop Multi-port Charger', 5),
  ('travel_adapter', 'شاحن سفر بمحول فيش', 'Travel Adapter Charger', 6),
  ('car', 'شاحن سيارة', 'Car Charger', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'charger_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'charging_port_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_c', 'USB-C', 'USB-C', 0),
  ('lightning', 'Lightning', 'Lightning', 1),
  ('micro_usb', 'Micro USB', 'Micro USB', 2),
  ('wireless_case', 'شحن لاسلكي (علبة الشحن)', 'Wireless Charging Case', 3),
  ('magnetic', 'شاحن مغناطيسي', 'Magnetic Charger', 4),
  ('proprietary', 'قاعدة / شاحن خاص', 'Proprietary Dock', 5),
  ('replaceable_batteries', 'بطاريات قابلة للتغيير (بدون منفذ)', 'Replaceable Batteries (No Port)', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'charging_port_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cheese_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('white_feta', 'جبنة بيضاء / فيتا', 'White / feta', 0),
  ('istanbuli', 'إسطنبولي', 'Istanbuli', 1),
  ('roumy', 'رومي', 'Roumy', 2),
  ('cheddar', 'شيدر', 'Cheddar', 3),
  ('mozzarella', 'موتزاريلا', 'Mozzarella', 4),
  ('cream_cheese', 'جبنة كريمي', 'Cream cheese', 5),
  ('processed_triangles', 'جبنة مثلثات', 'Processed triangles', 6),
  ('slices', 'شرائح (توست)', 'Processed slices', 7),
  ('halloumi', 'حلومي', 'Halloumi', 8),
  ('gouda', 'جودة', 'Gouda', 9),
  ('edam', 'إيدام', 'Edam', 10),
  ('parmesan', 'بارميزان', 'Parmesan', 11),
  ('mish', 'مش', 'Mish', 12),
  ('qareesh', 'قريش', 'Qareesh', 13),
  ('blue', 'جبنة زرقاء (ريكفور)', 'Blue cheese', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'cheese_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'chin_strap_closure' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('micrometric', 'قفل سريع مسنن (Micrometric)', 'Micrometric ratchet', 0),
  ('double_d', 'حلقتين D (Double D)', 'Double D-ring', 1),
  ('quick_release', 'توكة بلاستيك سريعة', 'Quick-release buckle', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'chin_strap_closure' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'chipset' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('intel_h610', 'Intel H610', 'Intel H610', 0),
  ('intel_b660', 'Intel B660', 'Intel B660', 1),
  ('intel_b760', 'Intel B760', 'Intel B760', 2),
  ('intel_h770', 'Intel H770', 'Intel H770', 3),
  ('intel_z690', 'Intel Z690', 'Intel Z690', 4),
  ('intel_z790', 'Intel Z790', 'Intel Z790', 5),
  ('intel_b860', 'Intel B860', 'Intel B860', 6),
  ('intel_z890', 'Intel Z890', 'Intel Z890', 7),
  ('intel_h510', 'Intel H510', 'Intel H510', 8),
  ('intel_b560', 'Intel B560', 'Intel B560', 9),
  ('amd_a520', 'AMD A520', 'AMD A520', 10),
  ('amd_b450', 'AMD B450', 'AMD B450', 11),
  ('amd_b550', 'AMD B550', 'AMD B550', 12),
  ('amd_x570', 'AMD X570', 'AMD X570', 13),
  ('amd_a620', 'AMD A620', 'AMD A620', 14),
  ('amd_b650', 'AMD B650', 'AMD B650', 15),
  ('amd_x670', 'AMD X670', 'AMD X670', 16),
  ('amd_b850', 'AMD B850', 'AMD B850', 17),
  ('amd_x870', 'AMD X870', 'AMD X870', 18),
  ('other', 'أخرى', 'Other', 19)) v(code, ar, en, sort)
 where d.code = 'chipset' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'chocolate_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('milk', 'بالحليب', 'Milk', 0),
  ('dark', 'دارك', 'Dark', 1),
  ('extra_dark', 'دارك 70% فأكثر', 'Extra dark (70%+)', 2),
  ('white', 'بيضاء', 'White', 3),
  ('ruby', 'روبي', 'Ruby', 4),
  ('sugar_free', 'بدون سكر', 'Sugar free', 5),
  ('cooking', 'شوكولاتة طبخ (كومباوند)', 'Cooking / compound', 6),
  ('mixed', 'تشكيلة', 'Assorted', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'chocolate_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cleaner_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('liquid', 'سائل', 'Liquid', 0),
  ('spray', 'بخاخ', 'Spray', 1),
  ('gel', 'جل', 'Gel', 2),
  ('foam', 'فوم (رغوة)', 'Foam', 3),
  ('cream', 'كريم', 'Cream', 4),
  ('powder', 'بودرة', 'Powder', 5),
  ('wipes', 'مناديل', 'Wipes', 6),
  ('tablets', 'أقراص', 'Tablets', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'cleaner_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cleaning_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('surface_wash', 'تنظيف سطحي فقط', 'Surface Clean Only', 0),
  ('hand_wash', 'غسيل يدوي', 'Hand Wash', 1),
  ('machine_wash', 'غسيل في الغسالة (هادئ)', 'Machine Wash (Gentle)', 2),
  ('electric_spin', 'تنظيف كهربائي دوار', 'Electric Spin Cleaning', 3),
  ('ultrasonic', 'موجات فوق صوتية', 'Ultrasonic', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'cleaning_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cleaning_tool_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sponge_scourer', 'إسفنجة بوش خشن', 'Sponge with scourer', 0),
  ('sponge', 'إسفنجة فقط', 'Sponge only', 1),
  ('steel_wool', 'سلك مواعين', 'Steel wool', 2),
  ('stainless_scrubber', 'سلك ستانلس', 'Stainless scrubber', 3),
  ('scourer_pad', 'لوفة / فيبر خشن', 'Scouring pad', 4),
  ('silicone', 'إسفنجة سيليكون', 'Silicone sponge', 5),
  ('brush', 'فرشاة', 'Brush', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'cleaning_tool_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cleansing_bar_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('soap', 'صابون عادي', 'Soap', 0),
  ('glycerin', 'صابون جلسرين', 'Glycerin', 1),
  ('syndet', 'منظف غير صابوني (سينديت)', 'Syndet bar', 2),
  ('natural', 'صابون طبيعي / يدوي', 'Natural / handmade', 3),
  ('antibacterial', 'مضاد للبكتيريا / طبي', 'Antibacterial / medicated', 4),
  ('shampoo_bar', 'شامبو صلب', 'Shampoo bar', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'cleansing_bar_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cleansing_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sonic', 'اهتزاز سونيك', 'Sonic vibration', 0),
  ('rotating', 'دوارة', 'Rotating', 1),
  ('ultrasonic', 'ألتراسونيك', 'Ultrasonic', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'cleansing_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'clip_or_pin_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('claw_clip', 'مشبك كلابة', 'Claw Clip', 0),
  ('snap_clip', 'مشبك طقطقة', 'Snap Clip', 1),
  ('alligator', 'مشبك تمساح', 'Alligator Clip', 2),
  ('duckbill', 'مشبك منقار البطة', 'Duckbill Clip', 3),
  ('bobby_pin', 'بنس شعر', 'Bobby Pin', 4),
  ('u_pin', 'دبوس U', 'U-shaped Pin', 5),
  ('barrette', 'توكة فرنساوي', 'Barrette', 6),
  ('banana_clip', 'مشبك موز', 'Banana Clip', 7),
  ('hair_stick', 'عصا شعر', 'Hair Stick', 8),
  ('side_comb', 'مشط جانبي', 'Side Comb', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'clip_or_pin_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'coarseness' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fine', 'ناعم', 'Fine', 0),
  ('medium', 'متوسط', 'Medium', 1),
  ('coarse', 'خشن', 'Coarse', 2),
  ('double_sided', 'وجهين (ناعم وخشن)', 'Double-sided', 3)) v(code, ar, en, sort)
 where d.code = 'coarseness' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'coffee_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('whole_beans', 'حبوب كاملة (بن حب)', 'Whole beans', 0),
  ('ground', 'مطحونة', 'Ground', 1),
  ('instant', 'سريعة الذوبان', 'Instant', 2),
  ('capsules', 'كبسولات', 'Capsules', 3),
  ('pods', 'بودز (أقراص ورقية)', 'Pods', 4),
  ('mix_3in1', 'أكياس 3 في 1 / ميكس', '3-in-1 / mix sachets', 5),
  ('ready_to_drink', 'جاهزة للشرب', 'Ready to drink', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'coffee_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'coffee_input_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ground', 'بن مطحون', 'Ground Coffee', 0),
  ('beans', 'بن حبوب', 'Coffee Beans', 1),
  ('capsules', 'كبسولات', 'Capsules', 2),
  ('ese_pods', 'أكياس ESE (بودز)', 'ESE Pods', 3),
  ('instant', 'قهوة سريعة الذوبان', 'Instant Coffee', 4)) v(code, ar, en, sort)
 where d.code = 'coffee_input_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'coffee_machine_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('espresso_manual', 'ماكينة إسبريسو يدوية (بذراع)', 'Manual Espresso (Portafilter)', 0),
  ('bean_to_cup', 'أوتوماتيك بالكامل (من الحبوب للفنجان)', 'Bean-to-Cup Automatic', 1),
  ('capsule', 'ماكينة كبسولات', 'Capsule Machine', 2),
  ('drip_filter', 'ماكينة قهوة أمريكي (فلتر)', 'Drip / Filter Coffee Maker', 3),
  ('turkish', 'ماكينة قهوة تركي', 'Turkish Coffee Maker', 4),
  ('moka_electric', 'موكا بوت كهربائي', 'Electric Moka Pot', 5),
  ('french_press', 'فرنش برس', 'French Press', 6),
  ('cold_brew', 'كولد برو', 'Cold Brew Maker', 7),
  ('combo', 'ماكينة متعددة (إسبريسو + أمريكي)', 'Combo (Espresso + Drip)', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'coffee_machine_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'color_family' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('nude', 'نيود', 'Nude', 0),
  ('brown', 'بني', 'Brown', 1),
  ('warm', 'ألوان دافئة', 'Warm', 2),
  ('cool', 'ألوان باردة', 'Cool', 3),
  ('smoky', 'سموكي', 'Smoky', 4),
  ('pink', 'وردي', 'Pink', 5),
  ('colorful', 'ألوان صارخة', 'Bright / Colorful', 6),
  ('shimmer', 'شيمر / جليتر', 'Shimmer / Glitter', 7),
  ('matte', 'مات', 'Matte', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'color_family' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'color_permanence' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('temporary', 'مؤقتة (تروح مع الغسيل)', 'Temporary', 0),
  ('semi_permanent', 'نصف دائمة', 'Semi-permanent', 1),
  ('demi_permanent', 'شبه دائمة', 'Demi-permanent', 2),
  ('permanent', 'دائمة', 'Permanent', 3)) v(code, ar, en, sort)
 where d.code = 'color_permanence' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'color_treated_hair_safe' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('formulated_for', 'مخصص للشعر المصبوغ', 'Formulated for color-treated', 0),
  ('safe', 'آمن على الشعر المصبوغ', 'Color-safe', 1),
  ('not_recommended', 'غير مناسب للشعر المصبوغ', 'Not recommended', 2)) v(code, ar, en, sort)
 where d.code = 'color_treated_hair_safe' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_applications' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cabinets', 'دواليب', 'Cabinets', 0),
  ('drawers', 'أدراج', 'Drawers', 1),
  ('fridge', 'ثلاجة', 'Refrigerator', 2),
  ('oven', 'فرن', 'Oven', 3),
  ('toilet', 'قاعدة الحمام', 'Toilet', 4),
  ('doors', 'أبواب', 'Doors', 5),
  ('sliding_doors', 'أبواب سحاب', 'Sliding Doors', 6),
  ('windows', 'شبابيك', 'Windows', 7),
  ('outlets', 'فيش الكهرباء', 'Electrical Outlets', 8),
  ('appliances', 'أجهزة منزلية', 'Appliances', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'compatible_applications' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'compatible_braking_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ate', 'ATE / Teves', 'ATE / Teves', 0),
  ('bosch', 'Bosch', 'Bosch', 1),
  ('trw_lucas', 'TRW / Lucas', 'TRW / Lucas', 2),
  ('akebono', 'Akebono', 'Akebono', 3),
  ('sumitomo', 'Sumitomo', 'Sumitomo', 4),
  ('mando', 'Mando', 'Mando', 5),
  ('brembo', 'Brembo', 'Brembo', 6),
  ('continental', 'Continental', 'Continental', 7),
  ('aisin', 'Aisin / Advics', 'Aisin / Advics', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'compatible_braking_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_bulb_base' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('e27', 'E27 (قلاوظ كبير)', 'E27', 0),
  ('e14', 'E14 (قلاوظ صغير)', 'E14', 1),
  ('b22', 'B22 (مسمار)', 'B22 bayonet', 2),
  ('gu10', 'GU10', 'GU10', 3),
  ('mr16_gu5_3', 'MR16 / GU5.3', 'MR16 / GU5.3', 4),
  ('g9', 'G9', 'G9', 5),
  ('g4', 'G4', 'G4', 6),
  ('integrated_led', 'LED مدمج', 'Integrated LED', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'compatible_bulb_base' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_cameras' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ip', 'كاميرات IP', 'IP Cameras', 0),
  ('poe_ip', 'كاميرات IP PoE', 'PoE IP Cameras', 1),
  ('ahd', 'كاميرات AHD', 'AHD Cameras', 2),
  ('tvi', 'كاميرات HD-TVI', 'HD-TVI Cameras', 3),
  ('cvi', 'كاميرات HD-CVI', 'HD-CVI Cameras', 4),
  ('analog', 'كاميرات أنالوج (CVBS)', 'Analog CVBS Cameras', 5),
  ('wifi', 'كاميرات Wi-Fi', 'Wi-Fi Cameras', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'compatible_cameras' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_capsule_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('nespresso_original', 'Nespresso Original', 'Nespresso Original', 0),
  ('nespresso_vertuo', 'Nespresso Vertuo', 'Nespresso Vertuo', 1),
  ('dolce_gusto', 'Dolce Gusto', 'Dolce Gusto', 2),
  ('k_cup', 'K-Cup (Keurig)', 'K-Cup (Keurig)', 3),
  ('lavazza_a_modo_mio', 'Lavazza A Modo Mio', 'Lavazza A Modo Mio', 4),
  ('caffitaly', 'Caffitaly', 'Caffitaly', 5),
  ('tassimo', 'Tassimo', 'Tassimo', 6),
  ('ese_pods', 'ESE Pods', 'ESE pods', 7),
  ('not_applicable', 'غير كبسولات', 'Not capsules', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'compatible_capsule_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_capsule_systems' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'لا يستخدم كبسولات', 'No Capsules', 0),
  ('nespresso_original', 'Nespresso Original', 'Nespresso Original', 1),
  ('nespresso_vertuo', 'Nespresso Vertuo', 'Nespresso Vertuo', 2),
  ('dolce_gusto', 'Dolce Gusto', 'Dolce Gusto', 3),
  ('lavazza_a_modo_mio', 'Lavazza A Modo Mio', 'Lavazza A Modo Mio', 4),
  ('k_cup', 'K-Cup', 'K-Cup', 5),
  ('tassimo', 'Tassimo', 'Tassimo', 6),
  ('caffitaly', 'Caffitaly', 'Caffitaly', 7),
  ('ese', 'ESE Pods', 'ESE Pods', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'compatible_capsule_systems' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'compatible_chain_size_code' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('428', '428', '428', 0),
  ('428h', '428H', '428H', 1),
  ('420', '420', '420', 2),
  ('415', '415', '415', 3),
  ('520', '520', '520', 4),
  ('525', '525', '525', 5),
  ('530', '530', '530', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'compatible_chain_size_code' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_color_systems' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('permanent_cream', 'صبغة كريم دائمة', 'Permanent cream color', 0),
  ('demi_permanent', 'صبغة شبه دائمة', 'Demi-permanent color', 1),
  ('bleach_powder', 'بودرة تفتيح', 'Lightening powder', 2),
  ('toner', 'تونر', 'Toner', 3),
  ('universal', 'كل الأنواع', 'Universal', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'compatible_color_systems' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_containers' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standard_neck', 'رضاعة فتحة عادية', 'Standard-neck Bottles', 0),
  ('wide_neck', 'رضاعة فتحة واسعة', 'Wide-neck Bottles', 1),
  ('glass_bottles', 'رضاعة زجاج', 'Glass Bottles', 2),
  ('plastic_bottles', 'رضاعة بلاستيك', 'Plastic Bottles', 3),
  ('food_jars', 'برطمانات أكل الأطفال', 'Baby Food Jars', 4),
  ('milk_bags', 'أكياس حليب الأم', 'Breast Milk Bags', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'compatible_containers' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_devices' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pc', 'كمبيوتر (ويندوز)', 'Windows PC', 0),
  ('laptop', 'لابتوب', 'Laptop', 1),
  ('mac', 'Mac', 'Mac', 2),
  ('android', 'موبايل Android', 'Android Phone', 3),
  ('iphone', 'iPhone', 'iPhone', 4),
  ('ipad_tablet', 'تابلت / iPad', 'Tablet / iPad', 5),
  ('ps5', 'PlayStation 5', 'PlayStation 5', 6),
  ('ps4', 'PlayStation 4', 'PlayStation 4', 7),
  ('xbox', 'Xbox', 'Xbox', 8),
  ('switch', 'Nintendo Switch', 'Nintendo Switch', 9),
  ('camera', 'كاميرا', 'Camera', 10),
  ('smart_tv', 'شاشة سمارت', 'Smart TV', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'compatible_devices' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_gel_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gel_polish', 'مناكير جل', 'Gel polish', 0),
  ('builder', 'جل بيلدر', 'Builder gel', 1),
  ('poly_gel', 'بولي جل', 'Poly gel', 2),
  ('hard_gel', 'هارد جل', 'Hard gel', 3),
  ('base_top', 'بيز وتوب كوت', 'Base / Top coat', 4),
  ('uv_only', 'جل UV فقط', 'UV-only gel', 5),
  ('led', 'جل LED', 'LED gel', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'compatible_gel_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_hair_dryers' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('universal', 'عالمي يناسب معظم الاستشوارات', 'Universal', 0),
  ('philips', 'Philips', 'Philips', 1),
  ('braun', 'Braun', 'Braun', 2),
  ('babyliss', 'BaByliss', 'BaByliss', 3),
  ('remington', 'Remington', 'Remington', 4),
  ('dyson', 'Dyson', 'Dyson', 5),
  ('kemei', 'Kemei', 'Kemei', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'compatible_hair_dryers' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_hob_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gas', 'بوتاجاز غاز', 'Gas', 0),
  ('electric', 'سخان كهرباء', 'Electric coil', 1),
  ('ceramic_glass', 'سيراميك / زجاج', 'Ceramic / Glass', 2),
  ('induction', 'إنداكشن', 'Induction', 3),
  ('halogen', 'هالوجين', 'Halogen', 4),
  ('oven', 'فرن', 'Oven', 5),
  ('camping', 'موقد رحلات', 'Camping stove', 6)) v(code, ar, en, sort)
 where d.code = 'compatible_hob_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_items' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bottles', 'رضاعات', 'Bottles', 0),
  ('teats', 'حلمات', 'Teats', 1),
  ('pacifiers', 'لهايات', 'Pacifiers', 2),
  ('pump_parts', 'قطع شفاط الحليب', 'Breast Pump Parts', 3),
  ('teethers', 'عضاضات', 'Teethers', 4),
  ('cups', 'أكواب', 'Cups', 5),
  ('tableware', 'أطباق ومعالق', 'Tableware', 6),
  ('small_toys', 'ألعاب صغيرة', 'Small Toys', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'compatible_items' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_lash_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('natural', 'رموش طبيعية', 'Natural lashes', 0),
  ('strip', 'رموش شريط', 'Strip lashes', 1),
  ('cluster', 'رموش خصل', 'Cluster lashes', 2),
  ('individual', 'رموش فردية', 'Individual lashes', 3),
  ('extensions', 'إكستنشن', 'Extensions', 4)) v(code, ar, en, sort)
 where d.code = 'compatible_lash_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'compatible_makeup_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('water_based', 'مكياج مائي', 'Water-based', 0),
  ('silicone_based', 'مكياج سيليكون', 'Silicone-based', 1),
  ('alcohol_based', 'مكياج كحولي', 'Alcohol-based', 2),
  ('universal', 'كل الأنواع', 'Universal', 3)) v(code, ar, en, sort)
 where d.code = 'compatible_makeup_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_nail_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('natural', 'أظافر طبيعية', 'Natural nails', 0),
  ('press_on', 'أظافر بريس أون', 'Press-on nails', 1),
  ('tips', 'تيبس', 'Nail tips', 2),
  ('acrylic', 'أكريليك', 'Acrylic', 3),
  ('gel', 'جل', 'Gel', 4)) v(code, ar, en, sort)
 where d.code = 'compatible_nail_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_phone_operating_systems' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('android', 'Android', 'Android', 0),
  ('ios', 'iOS (آيفون)', 'iOS', 1),
  ('harmonyos', 'HarmonyOS', 'HarmonyOS', 2)) v(code, ar, en, sort)
 where d.code = 'compatible_phone_operating_systems' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_platforms' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ps5', 'بلايستيشن 5', 'PlayStation 5', 0),
  ('ps4', 'بلايستيشن 4', 'PlayStation 4', 1),
  ('pc', 'كمبيوتر (Windows)', 'PC (Windows)', 2),
  ('xbox_series', 'Xbox Series X|S', 'Xbox Series X|S', 3),
  ('xbox_one', 'Xbox One', 'Xbox One', 4),
  ('switch', 'نينتندو سويتش', 'Nintendo Switch', 5),
  ('android', 'Android', 'Android', 6),
  ('ios', 'iOS / iPadOS', 'iOS / iPadOS', 7),
  ('mac', 'Mac', 'Mac', 8),
  ('steam_deck', 'Steam Deck', 'Steam Deck', 9),
  ('smart_tv', 'تلفزيون ذكي', 'Smart TV', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'compatible_platforms' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_polish_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('regular', 'مناكير عادي', 'Regular polish', 0),
  ('gel', 'جل', 'Gel', 1),
  ('glitter', 'جليتر', 'Glitter', 2),
  ('acrylic', 'أكريليك', 'Acrylic', 3),
  ('dip_powder', 'بودرة ديب', 'Dip powder', 4)) v(code, ar, en, sort)
 where d.code = 'compatible_polish_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'compatible_sensor_format' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_frame', 'فل فريم', 'Full Frame', 0),
  ('aps_c', 'APS-C', 'APS-C', 1),
  ('mft', 'مايكرو فور ثيردز', 'Micro Four Thirds', 2),
  ('medium_format', 'ميديم فورمات', 'Medium Format', 3),
  ('one_inch', '1 بوصة', '1-inch', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'compatible_sensor_format' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_socket_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('type_c_eu', 'أوروبي رفيع (Type C)', 'European (Type C)', 0),
  ('type_f_schuko', 'أوروبي بأرضي (Type F / Schuko)', 'Schuko (Type F)', 1),
  ('type_g_uk', 'إنجليزي 3 سنون (Type G)', 'UK (Type G)', 2),
  ('type_a_b_us', 'أمريكي (Type A/B)', 'US (Type A/B)', 3),
  ('type_i_au', 'أسترالي (Type I)', 'Australian (Type I)', 4),
  ('type_j_ch', 'سويسري (Type J)', 'Swiss (Type J)', 5),
  ('universal', 'عالمي (يقبل كل الأنواع)', 'Universal', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'compatible_socket_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_tips' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standard_jet', 'فوهة عادية', 'Standard jet', 0),
  ('orthodontic', 'للتقويم', 'Orthodontic', 1),
  ('periodontal', 'للجيوب اللثوية', 'Periodontal', 2),
  ('plaque', 'لإزالة البلاك', 'Plaque seeker', 3),
  ('tongue', 'منظف لسان', 'Tongue cleaner', 4),
  ('nasal', 'للأنف', 'Nasal', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'compatible_tips' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_tool_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('synthetic_brushes', 'فرش صناعية', 'Synthetic brushes', 0),
  ('natural_brushes', 'فرش شعر طبيعي', 'Natural-hair brushes', 1),
  ('sponges', 'إسفنج مكياج', 'Makeup sponges', 2),
  ('puffs', 'بفات بودرة', 'Powder puffs', 3)) v(code, ar, en, sort)
 where d.code = 'compatible_tool_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_vehicles_or_size_class' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('universal', 'يونيفرسال (يناسب كل العربيات)', 'Universal', 0),
  ('sedan', 'سيدان', 'Sedan', 1),
  ('hatchback', 'هاتشباك', 'Hatchback', 2),
  ('suv', 'SUV / جيب', 'SUV / 4x4', 3),
  ('pickup', 'نص نقل (بيك أب)', 'Pickup', 4),
  ('van', 'ميكروباص / فان', 'Van / minibus', 5),
  ('small_car', 'عربية صغيرة', 'Small car', 6),
  ('motorcycle', 'موتوسيكل', 'Motorcycle', 7),
  ('scooter', 'سكوتر', 'Scooter', 8),
  ('truck', 'نقل ثقيل', 'Truck', 9),
  ('bicycle', 'عجلة (دراجة)', 'Bicycle', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'compatible_vehicles_or_size_class' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'compatible_wax_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hard_beads', 'شمع حبيبات (هارد واكس)', 'Hard wax beads', 0),
  ('soft', 'شمع طري (بالشرائح)', 'Soft strip wax', 1),
  ('roll_on', 'رول أون (كارتريدج)', 'Roll-on cartridge', 2),
  ('sugar', 'حلاوة', 'Sugar wax', 3),
  ('paraffin', 'بارافين', 'Paraffin', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'compatible_wax_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'compression_zipper' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'compression_zipper' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'concentrated_or_ready_to_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('concentrated', 'مركز (يخفف بالمية)', 'Concentrated', 0),
  ('ready_to_use', 'جاهز للاستخدام', 'Ready to use', 1),
  ('premix_50_50', 'مخلوط جاهز 50/50', 'Premixed 50/50', 2)) v(code, ar, en, sort)
 where d.code = 'concentrated_or_ready_to_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'conditioner_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rinse_out', 'بلسم بالشطف', 'Rinse-out', 0),
  ('leave_in', 'بدون شطف (ليف إن)', 'Leave-in', 1),
  ('deep', 'علاج عميق', 'Deep conditioner', 2),
  ('spray', 'بخاخ', 'Spray', 3),
  ('co_wash', 'غسول بلسم (كو-واش)', 'Co-wash', 4),
  ('two_in_one', '2 في 1', '2-in-1', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'conditioner_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'connecting_link_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clip', 'وصلة بكلبس', 'Clip-type master link', 0),
  ('rivet', 'وصلة برشام', 'Rivet-type master link', 1),
  ('endless', 'جنزير مقفول بدون وصلة', 'Endless (no master link)', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'connecting_link_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'connection_interface' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sata3', 'SATA III', 'SATA III', 0),
  ('nvme_gen3', 'NVMe PCIe 3.0', 'NVMe PCIe 3.0', 1),
  ('nvme_gen4', 'NVMe PCIe 4.0', 'NVMe PCIe 4.0', 2),
  ('nvme_gen5', 'NVMe PCIe 5.0', 'NVMe PCIe 5.0', 3),
  ('msata', 'mSATA', 'mSATA', 4),
  ('usb_30', 'USB 3.0 / 3.2 Gen 1', 'USB 3.0 / 3.2 Gen 1', 5),
  ('usb_c_32', 'USB-C 3.2 Gen 2', 'USB-C 3.2 Gen 2', 6),
  ('usb_c_20x2', 'USB-C 3.2 Gen 2x2', 'USB-C 3.2 Gen 2x2', 7),
  ('usb4_tb', 'USB4 / Thunderbolt', 'USB4 / Thunderbolt', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'connection_interface' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'connection_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_a', 'سلك USB', 'Wired USB', 0),
  ('usb_c', 'سلك USB-C', 'Wired USB-C', 1),
  ('jack_35', 'سلك 3.5 مم', '3.5mm Jack', 2),
  ('bluetooth', 'Bluetooth', 'Bluetooth', 3),
  ('wireless_24ghz', 'وايرلس 2.4GHz (دونجل)', '2.4GHz Wireless', 4),
  ('wi_fi', 'Wi-Fi', 'Wi-Fi', 5),
  ('ethernet_poe', 'كابل شبكة / PoE', 'Ethernet / PoE', 6),
  ('xlr', 'XLR', 'XLR', 7),
  ('lightning', 'Lightning', 'Lightning', 8),
  ('radio_dect', 'موجات راديو (DECT)', 'Radio (DECT)', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'connection_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'connectivity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bluetooth', 'بلوتوث', 'Bluetooth', 0),
  ('wifi', 'Wi-Fi', 'Wi-Fi', 1),
  ('usb_c', 'USB-C', 'USB-C', 2),
  ('usb_a', 'USB-A', 'USB-A', 3),
  ('micro_usb', 'Micro-USB', 'Micro-USB', 4),
  ('wireless_2_4', 'لاسلكي 2.4 GHz (دونجل)', '2.4 GHz wireless (dongle)', 5),
  ('aux_3_5', 'AUX 3.5 مم', '3.5 mm AUX', 6),
  ('hdmi', 'HDMI', 'HDMI', 7),
  ('hdmi_arc', 'HDMI ARC / eARC', 'HDMI ARC / eARC', 8),
  ('optical', 'أوبتيكال', 'Optical', 9),
  ('ethernet', 'Ethernet (كابل شبكة)', 'Ethernet', 10),
  ('nfc', 'NFC', 'NFC', 11),
  ('rca', 'RCA', 'RCA', 12),
  ('lightning', 'Lightning', 'Lightning', 13),
  ('thunderbolt', 'Thunderbolt', 'Thunderbolt', 14),
  ('displayport', 'DisplayPort', 'DisplayPort', 15),
  ('cellular', 'شريحة اتصال 4G / 5G', 'Cellular 4G / 5G', 16),
  ('zigbee', 'Zigbee', 'Zigbee', 17),
  ('matter_thread', 'Matter / Thread', 'Matter / Thread', 18),
  ('infrared', 'أشعة تحت حمراء (IR)', 'Infrared', 19),
  ('memory_card', 'كارت ميموري', 'Memory card slot', 20),
  ('wired', 'سلكي', 'Wired', 21),
  ('other', 'أخرى', 'Other', 22)) v(code, ar, en, sort)
 where d.code = 'connectivity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'connectivity_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wifi_only', 'Wi-Fi فقط', 'Wi-Fi Only', 0),
  ('wifi_4g', 'Wi-Fi + شريحة 4G', 'Wi-Fi + 4G LTE', 1),
  ('wifi_5g', 'Wi-Fi + شريحة 5G', 'Wi-Fi + 5G', 2),
  ('wifi_3g', 'Wi-Fi + شريحة 3G', 'Wi-Fi + 3G', 3)) v(code, ar, en, sort)
 where d.code = 'connectivity_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'connector_a' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_a', 'USB-A', 'USB-A', 0),
  ('usb_c', 'USB-C', 'USB-C', 1),
  ('lightning', 'Lightning', 'Lightning', 2),
  ('micro_usb', 'Micro USB', 'Micro USB', 3),
  ('mini_usb', 'Mini USB', 'Mini USB', 4),
  ('magnetic', 'مغناطيسي', 'Magnetic', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'connector_a' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'نوع الموصل الثاني' where code = 'connector_b' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_a', 'USB-A', 'USB-A', 0),
  ('usb_c', 'USB-C', 'USB-C', 1),
  ('lightning', 'Lightning', 'Lightning', 2),
  ('micro_usb', 'Micro USB', 'Micro USB', 3),
  ('mini_usb', 'Mini USB', 'Mini USB', 4),
  ('magnetic', 'مغناطيسي', 'Magnetic', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'connector_b' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'connector_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_c', 'USB-C', 'USB-C', 0),
  ('usb_a', 'USB-A', 'USB-A', 1),
  ('micro_usb', 'Micro-USB', 'Micro-USB', 2),
  ('lightning', 'Lightning', 'Lightning', 3),
  ('hdmi', 'HDMI', 'HDMI', 4),
  ('mini_hdmi', 'Mini HDMI', 'Mini HDMI', 5),
  ('micro_hdmi', 'Micro HDMI', 'Micro HDMI', 6),
  ('jack_3_5', 'جاك 3.5 مم', '3.5 mm jack', 7),
  ('jack_6_35', 'جاك 6.35 مم', '6.35 mm (1/4") jack', 8),
  ('xlr', 'XLR', 'XLR', 9),
  ('hook_u', 'خطاف U (مساحات)', 'U-hook (wiper)', 10),
  ('pin', 'مسمار جانبي (مساحات)', 'Side pin (wiper)', 11),
  ('bayonet', 'بيونيت / Top Lock (مساحات)', 'Bayonet / Top lock (wiper)', 12),
  ('push_button', 'زر ضغط (مساحات)', 'Push button (wiper)', 13),
  ('multi_adapter', 'وصلات متعددة (يونيفرسال)', 'Multi-adapter (universal)', 14),
  ('hose_quick', 'وصلة خرطوم سريعة', 'Quick-connect hose fitting', 15),
  ('hose_threaded', 'وصلة خرطوم قلاوظ', 'Threaded hose fitting', 16),
  ('other', 'أخرى', 'Other', 17)) v(code, ar, en, sort)
 where d.code = 'connector_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'console_edition' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standard', 'عادي (بقارئ أسطوانات)', 'Standard (disc)', 0),
  ('digital', 'ديجيتال (بدون قارئ)', 'Digital Edition', 1),
  ('slim', 'سليم', 'Slim', 2),
  ('pro', 'برو', 'Pro', 3),
  ('series_x', 'Series X', 'Series X', 4),
  ('series_s', 'Series S', 'Series S', 5),
  ('switch_oled', 'سويتش OLED', 'Switch OLED', 6),
  ('switch_lite', 'سويتش Lite', 'Switch Lite', 7),
  ('switch_2', 'سويتش 2', 'Switch 2', 8),
  ('limited', 'إصدار خاص / محدود', 'Special / Limited edition', 9),
  ('bundle', 'باندل مع ألعاب', 'Game bundle', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'console_edition' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'contact_surface_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('silicone', 'سيليكون', 'Silicone', 0),
  ('nylon', 'شعيرات نايلون', 'Nylon bristles', 1),
  ('mixed', 'سيليكون ونايلون', 'Silicone and nylon', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'contact_surface_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'container_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spray', 'بخاخ', 'Spray Bottle', 0),
  ('squeeze', 'عبوة ضغط', 'Squeeze Bottle', 1),
  ('pump', 'بامب', 'Pump Dispenser', 2),
  ('flip_cap', 'غطاء قلاب', 'Flip-cap Bottle', 3),
  ('dropper', 'قطارة', 'Dropper', 4),
  ('jar', 'برطمان', 'Jar', 5),
  ('foam', 'رغوة', 'Foam Dispenser', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'container_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'contains_acetone' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'يحتوي على أسيتون', 'Contains acetone', 0),
  ('acetone_free', 'خالي من الأسيتون', 'Acetone-free', 1)) v(code, ar, en, sort)
 where d.code = 'contains_acetone' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'contains_alcohol' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('alcohol_free', 'خالي من الكحول', 'Alcohol-free', 0),
  ('contains_alcohol', 'يحتوي على كحول', 'Contains alcohol', 1)) v(code, ar, en, sort)
 where d.code = 'contains_alcohol' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'contains_fluoride' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('with_fluoride', 'بالفلورايد', 'With fluoride', 0),
  ('fluoride_free', 'خالي من الفلورايد', 'Fluoride-free', 1)) v(code, ar, en, sort)
 where d.code = 'contains_fluoride' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'contains_latex' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'يحتوي على لاتكس', 'Contains latex', 0),
  ('latex_free', 'خالي من اللاتكس', 'Latex-free', 1)) v(code, ar, en, sort)
 where d.code = 'contains_latex' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'continuous_drainage' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hose_included', 'يدعم - الخرطوم مرفق', 'Supported, hose included', 0),
  ('hose_not_included', 'يدعم - الخرطوم غير مرفق', 'Supported, hose not included', 1),
  ('pump', 'مضخة تصريف مدمجة', 'Built-in drain pump', 2),
  ('no', 'لا يدعم', 'Not supported', 3)) v(code, ar, en, sort)
 where d.code = 'continuous_drainage' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'control_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ir_remote', 'ريموت (أشعة)', 'IR remote', 0),
  ('rf_remote', 'ريموت RF', 'RF remote', 1),
  ('bluetooth_app', 'تطبيق (بلوتوث)', 'App via Bluetooth', 2),
  ('wifi_app', 'تطبيق (Wi-Fi)', 'App via Wi-Fi', 3),
  ('voice', 'تحكم صوتي (Alexa / Google)', 'Voice assistant', 4),
  ('inline_button', 'زرار على السلك', 'Inline button controller', 5),
  ('music_sync', 'تفاعل مع الموسيقى', 'Music sync', 6),
  ('none', 'بدون تحكم (تشغيل مباشر)', 'None', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'control_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'control_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('knob', 'مفتاح دوار (ميكانيكي)', 'Rotary knob (mechanical)', 0),
  ('buttons', 'أزرار', 'Push buttons', 1),
  ('touch', 'لمس', 'Touch', 2),
  ('digital', 'ديجيتال بشاشة', 'Digital with display', 3),
  ('remote', 'ريموت كنترول', 'Remote control', 4),
  ('app', 'تطبيق موبايل', 'Smartphone app', 5),
  ('voice', 'تحكم صوتي', 'Voice control', 6),
  ('lever', 'ذراع / مفتاح تشغيل', 'Lever / switch', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'control_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'controller_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('one', 'دراع واحد', '1 controller', 0),
  ('two', 'دراعين', '2 controllers', 1),
  ('joycon_pair', 'زوج Joy-Con', 'Joy-Con pair', 2),
  ('none', 'بدون دراع', 'No controller', 3)) v(code, ar, en, sort)
 where d.code = 'controller_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'controller_power_source' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('aa', 'بطاريات AA', 'AA Batteries', 0),
  ('aaa', 'بطاريات AAA', 'AAA Batteries', 1),
  ('9v', 'بطارية 9 فولت', '9V Battery', 2),
  ('rechargeable_usb', 'بطارية مدمجة تشحن USB', 'Built-in USB Rechargeable', 3),
  ('phone_app', 'تحكم من الموبايل (بدون ريموت)', 'Phone App (No Remote)', 4)) v(code, ar, en, sort)
 where d.code = 'controller_power_source' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'convection_fan' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'بدون مروحة', 'No fan', 0),
  ('fan', 'مروحة توزيع حرارة', 'Convection fan', 1),
  ('true_convection', 'مروحة بسخان دائري (حراري حقيقي)', 'True convection (ring element)', 2)) v(code, ar, en, sort)
 where d.code = 'convection_fan' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'converts_to_a_bed' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا', 'No', 0),
  ('pull_out', 'كنبة سرير بسحب', 'Pull-out sofa bed', 1),
  ('fold_out', 'كنبة سرير بفرد للأمام', 'Fold-out sofa bed', 2),
  ('click_clack', 'كليك كلاك (ظهر بينزل)', 'Click-clack', 3),
  ('futon', 'فوتون', 'Futon', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'converts_to_a_bed' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cooking_plate_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('non_stick', 'تيفال (غير لاصق)', 'Non-stick', 0),
  ('ceramic', 'سيراميك', 'Ceramic', 1),
  ('granite', 'جرانيت', 'Granite', 2),
  ('marble', 'ماربل', 'Marble Coating', 3),
  ('uncoated', 'بدون طلاء', 'Uncoated', 4)) v(code, ar, en, sort)
 where d.code = 'cooking_plate_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cooking_plate_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fixed_triangle', 'ألواح ثابتة (مثلثات توست)', 'Fixed Triangle Plates', 0),
  ('fixed_grill', 'ألواح ثابتة مخططة (جريل)', 'Fixed Grill Plates', 1),
  ('fixed_flat', 'ألواح ثابتة مسطحة', 'Fixed Flat Plates', 2),
  ('removable', 'ألواح قابلة للفك والغسيل', 'Removable Plates', 3),
  ('interchangeable_3in1', 'ألواح متبدلة 3 في 1 (توست / جريل / وافل)', 'Interchangeable 3-in-1', 4),
  ('interchangeable_multi', 'ألواح متبدلة متعددة (أكثر من 3)', 'Interchangeable Multi-plate', 5)) v(code, ar, en, sort)
 where d.code = 'cooking_plate_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cooking_surface_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('non_stick', 'تيفال (غير لاصق)', 'Non-stick', 0),
  ('ceramic', 'سيراميك', 'Ceramic', 1),
  ('granite', 'جرانيت', 'Granite', 2),
  ('marble', 'رخام (طلاء ماربل)', 'Marble Coating', 3),
  ('cast_iron', 'زهر', 'Cast Iron', 4),
  ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 5),
  ('aluminum', 'ألومنيوم', 'Aluminum', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'cooking_surface_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cool_shot' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('button', 'زرار هواء بارد', 'Cool shot button', 0),
  ('cold_mode', 'وضع هواء بارد ثابت', 'Cold air setting', 1),
  ('none', 'بدون هواء بارد', 'None', 2)) v(code, ar, en, sort)
 where d.code = 'cool_shot' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cooler_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم (بوكس بمروحة)', 'Yes (Boxed)', 0),
  ('no', 'لا (تراي بدون مروحة)', 'No (Tray)', 1)) v(code, ar, en, sort)
 where d.code = 'cooler_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cot_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standard_crib', 'سرير أطفال ثابت', 'Standard crib', 0),
  ('convertible', 'قابل للتحويل لسرير كبير', 'Convertible / cot bed', 1),
  ('travel', 'سرير سفر (بارك)', 'Travel cot', 2),
  ('bedside', 'بجانب سرير الأم', 'Bedside / co-sleeper', 3),
  ('cradle', 'مهد (سرير هزاز)', 'Cradle / rocking', 4),
  ('moses_basket', 'سلة نوم (موسى)', 'Moses basket', 5),
  ('bunk', 'دورين', 'Bunk', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'cot_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'count_basis' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pair', 'زوج', 'Pair', 0),
  ('multi_pair', 'عدة أزواج', 'Multiple pairs', 1),
  ('cluster', 'خصلة', 'Cluster', 2),
  ('tray', 'صينية / علبة', 'Tray / Box', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'count_basis' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'counting_unit' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('piece', 'قطعة', 'Piece', 0),
  ('sheet', 'شيت', 'Sheet', 1),
  ('pack', 'باكيت', 'Pack', 2),
  ('box', 'علبة', 'Box', 3),
  ('wheel', 'عجلة', 'Wheel', 4),
  ('jar', 'برطمان', 'Jar', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'counting_unit' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cover_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cotton', 'قطن', 'Cotton', 0),
  ('polyester', 'بوليستر', 'Polyester', 1),
  ('microfiber', 'مايكروفايبر', 'Microfiber', 2),
  ('velvet', 'قطيفة / فيلور', 'Velvet / Velour', 3),
  ('satin', 'ساتان', 'Satin', 4),
  ('silk', 'حرير', 'Silk', 5),
  ('linen', 'كتان', 'Linen', 6),
  ('spandex', 'سباندكس', 'Spandex', 7),
  ('bamboo', 'ألياف بامبو', 'Bamboo Fiber', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'cover_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'coverage' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sheer', 'شفافة', 'Sheer', 0),
  ('light', 'خفيفة', 'Light', 1),
  ('medium', 'متوسطة', 'Medium', 2),
  ('full', 'كاملة', 'Full', 3),
  ('buildable', 'قابلة للبناء', 'Buildable', 4)) v(code, ar, en, sort)
 where d.code = 'coverage' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'coverage_area' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front_only', 'أمامي فقط', 'Front only', 0),
  ('front_rear', 'أمامي وخلفي', 'Front and rear', 1),
  ('full_with_trunk', 'طقم كامل مع الشنطة', 'Full set with trunk', 2),
  ('trunk_only', 'الشنطة فقط', 'Trunk only', 3),
  ('waist', 'الوسط', 'Waist', 4),
  ('abdomen', 'البطن', 'Abdomen', 5),
  ('waist_thighs', 'الوسط والأفخاد', 'Waist and thighs', 6),
  ('full_body', 'الجسم كامل', 'Full body', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'coverage_area' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cpu_socket' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('lga1700', 'LGA 1700', 'LGA 1700', 0),
  ('lga1851', 'LGA 1851', 'LGA 1851', 1),
  ('lga1200', 'LGA 1200', 'LGA 1200', 2),
  ('lga1151', 'LGA 1151', 'LGA 1151', 3),
  ('lga2066', 'LGA 2066', 'LGA 2066', 4),
  ('am4', 'AM4', 'AM4', 5),
  ('am5', 'AM5', 'AM5', 6),
  ('str5', 'sTR5', 'sTR5', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'cpu_socket' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cup_padding' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unpadded', 'بدون حشو', 'Unpadded', 0),
  ('lightly_padded', 'حشو خفيف', 'Lightly Padded', 1),
  ('padded', 'محشو', 'Padded', 2),
  ('push_up', 'حشو بوش أب', 'Push-up Padding', 3),
  ('removable', 'حشو قابل للإزالة', 'Removable Pads', 4)) v(code, ar, en, sort)
 where d.code = 'cup_padding' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cup_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('aa', 'AA', 'AA', 0),
  ('opt_a', 'A', 'A', 1),
  ('opt_b', 'B', 'B', 2),
  ('opt_c', 'C', 'C', 3),
  ('opt_d', 'D', 'D', 4),
  ('dd_e', 'DD / E', 'DD / E', 5),
  ('opt_f', 'F', 'F', 6),
  ('opt_g', 'G', 'G', 7),
  ('h_plus', 'H أو أكبر', 'H+', 8)) v(code, ar, en, sort)
 where d.code = 'cup_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'curing_lamp_required' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا (يجف في الهواء)', 'No (air dry)', 0),
  ('uv_led', 'نعم، جهاز UV/LED', 'Yes, UV/LED lamp', 1)) v(code, ar, en, sort)
 where d.code = 'curing_lamp_required' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'curler_design' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('classic', 'كلاسيكي كامل', 'Classic full', 0),
  ('wide', 'عريض', 'Wide-angle', 1),
  ('partial', 'جزئي (للأطراف)', 'Partial / Mini', 2),
  ('spring', 'بسوستة', 'Spring-loaded', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'curler_design' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'curler_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('curling_iron', 'مكواة بماسك', 'Curling iron with clamp', 0),
  ('wand', 'مكواة مخروطية (واند)', 'Curling wand', 1),
  ('automatic', 'مكواة أوتوماتيك', 'Automatic curler', 2),
  ('waver', 'مموج (3 أسطوانات)', 'Triple barrel waver', 3),
  ('heatless_headband', 'رباط ساتان بدون حرارة', 'Heatless headband rod', 4),
  ('foam_rollers', 'بكر إسفنج', 'Foam rollers', 5),
  ('velcro_rollers', 'بكر لاصق', 'Velcro rollers', 6),
  ('flexi_rods', 'بكر مرن', 'Flexi rods', 7),
  ('spiral', 'حلزوني', 'Spiral curlers', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'curler_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'curved_screen' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('flat', 'مسطحة', 'Flat', 0),
  ('r1800', 'منحنية 1800R', 'Curved 1800R', 1),
  ('r1500', 'منحنية 1500R', 'Curved 1500R', 2),
  ('r1000', 'منحنية 1000R', 'Curved 1000R', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'curved_screen' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'cut_style' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('whole', 'كامل', 'Whole', 0),
  ('diced', 'مكعبات', 'Diced', 1),
  ('sliced', 'شرائح', 'Sliced', 2),
  ('strips', 'أصابع (شرائح طولية)', 'Strips / fries cut', 3),
  ('chopped', 'مفروم', 'Chopped / minced', 4),
  ('florets', 'زهرات', 'Florets', 5),
  ('halves', 'أنصاف', 'Halves', 6),
  ('puree', 'مهروس (بيوريه)', 'Puree', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'cut_style' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'damper_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gas', 'غاز', 'Gas pressure', 0),
  ('oil', 'زيت', 'Oil (hydraulic)', 1),
  ('twin_tube', 'أنبوبين (Twin Tube)', 'Twin-tube', 2),
  ('mono_tube', 'أنبوب واحد (Mono Tube)', 'Mono-tube', 3),
  ('strut_assembly', 'مساعد كامل بالسوستة', 'Complete strut assembly', 4),
  ('adjustable', 'قابل للضبط', 'Adjustable', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'damper_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'data_transfer_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('charging_only', 'شحن فقط', 'Charging Only', 0),
  ('usb2', 'USB 2.0 (480Mbps)', 'USB 2.0 (480Mbps)', 1),
  ('usb3_5g', 'USB 3.0 (5Gbps)', 'USB 3.0 (5Gbps)', 2),
  ('usb3_10g', 'USB 3.2 (10Gbps)', 'USB 3.2 (10Gbps)', 3),
  ('usb4_40g', 'USB4 / Thunderbolt (40Gbps)', 'USB4 / Thunderbolt (40Gbps)', 4)) v(code, ar, en, sort)
 where d.code = 'data_transfer_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'date_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('whole_pitted_in', 'صحيح بالنواة', 'Whole with pit', 0),
  ('pitted', 'منزوع النوى', 'Pitted', 1),
  ('stuffed', 'محشي', 'Stuffed', 2),
  ('paste', 'عجوة (معجون)', 'Date paste', 3),
  ('chopped', 'مقطع', 'Chopped', 4),
  ('fresh_rutab', 'رطب', 'Fresh / rutab', 5),
  ('syrup', 'دبس تمر', 'Date syrup', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'date_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'date_variety' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('siwi', 'سيوي', 'Siwi', 0),
  ('barhi', 'برحي', 'Barhi', 1),
  ('zaghloul', 'زغلول', 'Zaghloul', 2),
  ('samani', 'سماني', 'Samani', 3),
  ('hayani', 'حياني', 'Hayani', 4),
  ('amhat', 'أمهات', 'Amhat', 5),
  ('malakabi', 'ملكابي', 'Malakabi', 6),
  ('sakkoti', 'سكوتي', 'Sakkoti', 7),
  ('bartamoda', 'برتمودا', 'Bartamoda', 8),
  ('ajwa', 'عجوة المدينة', 'Ajwa', 9),
  ('medjool', 'مجدول', 'Medjool', 10),
  ('sukkari', 'سكري', 'Sukkari', 11),
  ('khalas', 'خلاص', 'Khalas', 12),
  ('segai', 'صقعي', 'Segai', 13),
  ('mabroom', 'مبروم', 'Mabroom', 14),
  ('safawi', 'صفاوي', 'Safawi', 15),
  ('mixed', 'مشكل', 'Mixed', 16),
  ('other', 'أخرى', 'Other', 17)) v(code, ar, en, sort)
 where d.code = 'date_variety' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'deck_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('maple', 'خشب ميبل (قيقب)', 'Maple Wood', 0),
  ('bamboo', 'بامبو', 'Bamboo', 1),
  ('plastic', 'بلاستيك', 'Plastic', 2),
  ('aluminum', 'ألومنيوم', 'Aluminum', 3),
  ('composite', 'خامات مركبة / فايبر جلاس', 'Composite / Fiberglass', 4),
  ('carbon_fiber', 'كربون فايبر', 'Carbon Fiber', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'deck_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_absorbency_class' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('light', 'خفيف', 'Light', 0),
  ('normal', 'عادي', 'Normal', 1),
  ('heavy', 'غزير', 'Heavy', 2),
  ('extra_heavy', 'غزير جداً', 'Extra heavy', 3),
  ('night', 'ليلي', 'Overnight', 4)) v(code, ar, en, sort)
 where d.code = 'declared_absorbency_class' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_active_ingredient' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ethanol', 'كحول إيثيلي', 'Ethanol', 0),
  ('isopropyl', 'كحول أيزوبروبيل', 'Isopropyl alcohol', 1),
  ('benzalkonium', 'بنزالكونيوم كلوريد', 'Benzalkonium chloride', 2),
  ('chlorhexidine', 'كلورهيكسيدين', 'Chlorhexidine', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'declared_active_ingredient' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_anti_fog_treatment' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('anti_fog', 'طبقة مقاومة للضباب', 'Anti-fog Coating', 0),
  ('none', 'بدون', 'None', 1)) v(code, ar, en, sort)
 where d.code = 'declared_anti_fog_treatment' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_application_areas' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('face', 'الوجه', 'Face', 0),
  ('body', 'الجسم', 'Body', 1),
  ('legs', 'الرجلين', 'Legs', 2),
  ('arms', 'الذراعين', 'Arms', 3),
  ('underarms', 'تحت الإبط', 'Underarms', 4),
  ('bikini', 'منطقة البكيني', 'Bikini', 5),
  ('upper_lip', 'الشارب', 'Upper lip', 6),
  ('eyebrows', 'الحواجب', 'Eyebrows', 7),
  ('nose', 'الأنف', 'Nose', 8),
  ('ears', 'الأذن', 'Ears', 9),
  ('hands', 'اليدين', 'Hands', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'declared_application_areas' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_application_scope' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_head', 'الشعر كله', 'Full head', 0),
  ('highlights', 'هايلايت / ميش', 'Highlights', 1),
  ('balayage', 'بالياج', 'Balayage', 2),
  ('root_touch_up', 'الجذور', 'Root touch-up', 3),
  ('on_scalp', 'على فروة الرأس', 'On-scalp', 4),
  ('off_scalp', 'بعيد عن فروة الرأس', 'Off-scalp', 5)) v(code, ar, en, sort)
 where d.code = 'declared_application_scope' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_approval_standard' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ece_r44', 'ECE R44/04', 'ECE R44/04', 0),
  ('ece_r129', 'ECE R129 (i-Size)', 'ECE R129 (i-Size)', 1),
  ('fmvss_213', 'FMVSS 213 (أمريكي)', 'FMVSS 213', 2),
  ('none_declared', 'بدون اعتماد معلن', 'None declared', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'declared_approval_standard' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_caffeine_status' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('regular', 'بالكافيين (عادي)', 'Regular', 0),
  ('decaf', 'منزوع الكافيين', 'Decaffeinated', 1),
  ('half_caff', 'نص كافيين', 'Half caff', 2)) v(code, ar, en, sort)
 where d.code = 'declared_caffeine_status' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_compatible_developers' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('vol10', '10 فوليوم (3%)', '10 vol (3%)', 0),
  ('vol20', '20 فوليوم (6%)', '20 vol (6%)', 1),
  ('vol30', '30 فوليوم (9%)', '30 vol (9%)', 2),
  ('vol40', '40 فوليوم (12%)', '40 vol (12%)', 3)) v(code, ar, en, sort)
 where d.code = 'declared_compatible_developers' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_compatible_hair_colors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('black', 'أسود', 'Black', 0),
  ('dark_brown', 'بني غامق', 'Dark brown', 1),
  ('brown', 'بني', 'Brown', 2),
  ('light_brown', 'بني فاتح', 'Light brown', 3),
  ('dark_blonde', 'أشقر غامق', 'Dark blonde', 4),
  ('blonde', 'أشقر', 'Blonde', 5)) v(code, ar, en, sort)
 where d.code = 'declared_compatible_hair_colors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_compatible_skin_tones' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('type1', 'فاتحة جداً (I)', 'Very fair (I)', 0),
  ('type2', 'فاتحة (II)', 'Fair (II)', 1),
  ('type3', 'قمحية فاتحة (III)', 'Medium (III)', 2),
  ('type4', 'قمحية / حنطية (IV)', 'Olive (IV)', 3),
  ('type5', 'سمراء (V)', 'Brown (V)', 4),
  ('type6', 'سمراء غامقة (VI)', 'Dark (VI)', 5)) v(code, ar, en, sort)
 where d.code = 'declared_compatible_skin_tones' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_concentration_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('regular', 'عادي', 'Regular', 0),
  ('concentrated', 'مركز', 'Concentrated', 1),
  ('ultra', 'مركز جداً (ألترا)', 'Ultra concentrated', 2)) v(code, ar, en, sort)
 where d.code = 'declared_concentration_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_coolant_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('iat', 'IAT تقليدي (أخضر)', 'IAT (inorganic, green)', 0),
  ('oat', 'OAT عضوي', 'OAT (organic)', 1),
  ('hoat', 'HOAT هجين', 'HOAT (hybrid)', 2),
  ('si_oat', 'Si-OAT (G12++/G13)', 'Si-OAT (G12++/G13)', 3),
  ('p_oat', 'P-OAT (آسيوي)', 'P-OAT (Asian)', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'declared_coolant_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_cosmetic_purpose' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hydration', 'ترطيب', 'Hydration', 0),
  ('brightening', 'تفتيح ونضارة', 'Brightening', 1),
  ('dark_spots', 'تصبغات وبقع', 'Dark spots', 2),
  ('anti_aging', 'مكافحة التجاعيد', 'Anti-aging', 3),
  ('firming', 'شد', 'Firming', 4),
  ('acne', 'حبوب', 'Acne', 5),
  ('pores', 'مسام', 'Pores', 6),
  ('oil_control', 'تحكم في الدهون', 'Oil control', 7),
  ('soothing', 'تهدئة', 'Soothing', 8),
  ('exfoliation', 'تقشير', 'Exfoliation', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'declared_cosmetic_purpose' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_duty_grade' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standard', 'عادي', 'Standard', 0),
  ('heavy', 'تقيل', 'Heavy duty', 1),
  ('extra_heavy', 'تقيل جداً', 'Extra heavy duty', 2)) v(code, ar, en, sort)
 where d.code = 'declared_duty_grade' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_earth_connection' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم، بأرضي', 'Yes, earthed', 0),
  ('no', 'لا، بدون أرضي', 'No earth', 1)) v(code, ar, en, sort)
 where d.code = 'declared_earth_connection' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_electrical_insulation_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('vde_1000v', 'معزول 1000 فولت VDE', 'VDE 1000V insulated', 0),
  ('iec_60900_1000v', 'معزول 1000 فولت IEC 60900', 'IEC 60900 1000V insulated', 1),
  ('grip_only', 'مقبض معزول (غير مصنف)', 'Insulated grip only (not rated)', 2),
  ('not_insulated', 'غير معزول', 'Not insulated', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'declared_electrical_insulation_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_exfoliation_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('physical', 'ميكانيكي (حبيبات)', 'Physical (granules)', 0),
  ('salt', 'ملح', 'Salt', 1),
  ('sugar', 'سكر', 'Sugar', 2),
  ('chemical', 'كيميائي (أحماض AHA/BHA)', 'Chemical (AHA/BHA)', 3),
  ('enzymatic', 'إنزيمي', 'Enzymatic', 4),
  ('combined', 'مزدوج', 'Combined', 5)) v(code, ar, en, sort)
 where d.code = 'declared_exfoliation_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_fiber_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('keratin', 'كيراتين', 'Keratin', 0),
  ('cotton', 'قطن', 'Cotton', 1),
  ('viscose', 'فيسكوز / رايون', 'Viscose / rayon', 2),
  ('plant', 'ألياف نباتية', 'Plant-based', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'declared_fiber_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_food_contact_suitability' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('food_safe', 'آمن لملامسة الطعام', 'Food safe', 0),
  ('not_food', 'غير مخصص للطعام', 'Not for food contact', 1)) v(code, ar, en, sort)
 where d.code = 'declared_food_contact_suitability' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_heat_styling_suitability' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('heat_safe_high', 'يتحمل الحرارة العالية (فوق 180°م)', 'Heat Safe (High)', 0),
  ('heat_safe_low', 'يتحمل حرارة منخفضة فقط', 'Low Heat Only', 1),
  ('not_heat_safe', 'لا يتحمل الحرارة', 'Not Heat Safe', 2)) v(code, ar, en, sort)
 where d.code = 'declared_heat_styling_suitability' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_intended_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sleep', 'النوم', 'Sleeping', 0),
  ('swimming', 'السباحة', 'Swimming', 1),
  ('noise', 'ضوضاء / شغل', 'Noise Protection / Work', 2),
  ('concerts', 'حفلات وموسيقى', 'Concerts / Music', 3),
  ('flying', 'السفر بالطيارة', 'Flying', 4),
  ('studying', 'المذاكرة والتركيز', 'Studying / Focus', 5),
  ('shooting', 'ضرب النار', 'Shooting', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'declared_intended_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_ip_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ip20', 'IP20 (داخلي)', 'IP20', 0),
  ('ipx4', 'IPX4 (مقاوم للرذاذ)', 'IPX4', 1),
  ('ip44', 'IP44', 'IP44', 2),
  ('ip54', 'IP54', 'IP54', 3),
  ('ip65', 'IP65 (مقاوم للمياه)', 'IP65', 4),
  ('ip66', 'IP66', 'IP66', 5),
  ('ip67', 'IP67', 'IP67', 6),
  ('ip68', 'IP68 (ضد المياه)', 'IP68', 7),
  ('none_declared', 'غير محدد', 'Not declared', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'declared_ip_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_key_ingredient' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hyaluronic', 'هيالورونيك أسيد', 'Hyaluronic acid', 0),
  ('vitamin_c', 'فيتامين C', 'Vitamin C', 1),
  ('niacinamide', 'نياسيناميد', 'Niacinamide', 2),
  ('retinol', 'ريتينول', 'Retinol', 3),
  ('salicylic', 'ساليسيليك أسيد', 'Salicylic acid', 4),
  ('glycolic', 'جليكوليك أسيد', 'Glycolic acid', 5),
  ('ceramides', 'سيراميد', 'Ceramides', 6),
  ('collagen', 'كولاجين', 'Collagen', 7),
  ('peptides', 'ببتيدات', 'Peptides', 8),
  ('snail', 'مستخلص الحلزون', 'Snail mucin', 9),
  ('shea', 'زبدة الشيا', 'Shea butter', 10),
  ('cocoa', 'زبدة الكاكاو', 'Cocoa butter', 11),
  ('aloe', 'صبار', 'Aloe vera', 12),
  ('urea', 'يوريا', 'Urea', 13),
  ('glycerin', 'جلسرين', 'Glycerin', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'declared_key_ingredient' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_key_ingredients' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('aha', 'أحماض AHA', 'AHA', 0),
  ('bha', 'أحماض BHA', 'BHA', 1),
  ('vitamin_c', 'فيتامين C', 'Vitamin C', 2),
  ('vitamin_e', 'فيتامين E', 'Vitamin E', 3),
  ('hyaluronic', 'هيالورونيك أسيد', 'Hyaluronic acid', 4),
  ('niacinamide', 'نياسيناميد', 'Niacinamide', 5),
  ('retinol', 'ريتينول', 'Retinol', 6),
  ('caffeine', 'كافيين', 'Caffeine', 7),
  ('clay', 'طين', 'Clay', 8),
  ('charcoal', 'فحم', 'Charcoal', 9),
  ('tea_tree', 'شجرة الشاي', 'Tea tree', 10),
  ('rose_water', 'ماء ورد', 'Rose water', 11),
  ('witch_hazel', 'هاماميليس', 'Witch hazel', 12),
  ('jojoba', 'زيت جوجوبا', 'Jojoba oil', 13),
  ('almond', 'زيت لوز', 'Almond oil', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'declared_key_ingredients' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_light_modes' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('red', 'أحمر', 'Red', 0),
  ('blue', 'أزرق', 'Blue', 1),
  ('near_infrared', 'أشعة تحت حمراء قريبة', 'Near infrared', 2),
  ('green', 'أخضر', 'Green', 3),
  ('yellow', 'أصفر', 'Yellow', 4),
  ('purple', 'بنفسجي', 'Purple', 5),
  ('cyan', 'سماوي', 'Cyan', 6),
  ('white', 'أبيض', 'White', 7)) v(code, ar, en, sort)
 where d.code = 'declared_light_modes' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_main_oil_or_ingredient' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('argan', 'زيت أرجان', 'Argan oil', 0),
  ('coconut', 'زيت جوز الهند', 'Coconut oil', 1),
  ('castor', 'زيت خروع', 'Castor oil', 2),
  ('rosemary', 'زيت روزماري (إكليل الجبل)', 'Rosemary oil', 3),
  ('jojoba', 'زيت جوجوبا', 'Jojoba oil', 4),
  ('olive', 'زيت زيتون', 'Olive oil', 5),
  ('almond', 'زيت لوز', 'Almond oil', 6),
  ('black_seed', 'زيت حبة البركة', 'Black seed oil', 7),
  ('onion', 'زيت بصل', 'Onion oil', 8),
  ('avocado', 'زيت أفوكادو', 'Avocado oil', 9),
  ('keratin', 'كيراتين', 'Keratin', 10),
  ('biotin', 'بيوتين', 'Biotin', 11),
  ('silicone', 'سيليكون (سيروم لمعان)', 'Silicone', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'declared_main_oil_or_ingredient' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_main_oils' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('argan', 'زيت أرجان', 'Argan', 0),
  ('almond', 'زيت لوز', 'Almond', 1),
  ('coconut', 'زيت جوز الهند', 'Coconut', 2),
  ('jojoba', 'زيت جوجوبا', 'Jojoba', 3),
  ('olive', 'زيت زيتون', 'Olive', 4),
  ('sesame', 'زيت سمسم', 'Sesame', 5),
  ('grapeseed', 'زيت بذر العنب', 'Grapeseed', 6),
  ('rosehip', 'زيت ثمر الورد', 'Rosehip', 7),
  ('black_seed', 'زيت حبة البركة', 'Black seed', 8),
  ('vitamin_e', 'فيتامين E', 'Vitamin E', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'declared_main_oils' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_main_purpose' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('moisturizing', 'ترطيب', 'Moisturizing', 0),
  ('cleansing', 'تنظيف عميق', 'Deep cleansing', 1),
  ('repair', 'إصلاح وتغذية', 'Repair / nourishing', 2),
  ('hair_fall', 'ضد التساقط', 'Anti hair fall', 3),
  ('anti_dandruff', 'ضد القشرة', 'Anti-dandruff', 4),
  ('frizz', 'ضد الهيشان', 'Anti-frizz', 5),
  ('volume', 'كثافة وحجم', 'Volume', 6),
  ('oil_control', 'تحكم في الدهون', 'Oil control', 7),
  ('acne', 'ضد الحبوب', 'Anti-acne', 8),
  ('brightening', 'تفتيح', 'Brightening', 9),
  ('anti_aging', 'مكافحة التجاعيد', 'Anti-aging', 10),
  ('dark_circles', 'الهالات والانتفاخ', 'Dark circles / puffiness', 11),
  ('soothing', 'تهدئة', 'Soothing', 12),
  ('fresh_breath', 'نفس منعش', 'Fresh breath', 13),
  ('gum_care', 'حماية اللثة', 'Gum care', 14),
  ('whitening', 'تبييض', 'Whitening', 15),
  ('other', 'أخرى', 'Other', 16)) v(code, ar, en, sort)
 where d.code = 'declared_main_purpose' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_overload_protection' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون حماية', 'None', 0),
  ('fuse', 'فيوز', 'Fuse', 1),
  ('breaker', 'قاطع أوتوماتيك (ريست)', 'Resettable circuit breaker', 2),
  ('surge', 'حماية من الصدمات (سيرج)', 'Surge protection', 3),
  ('child_shutters', 'حماية أطفال', 'Child safety shutters', 4)) v(code, ar, en, sort)
 where d.code = 'declared_overload_protection' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_powder_base' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('talc', 'تلك', 'Talc', 0),
  ('cornstarch', 'نشا ذرة (بدون تلك)', 'Cornstarch', 1),
  ('rice', 'نشا أرز', 'Rice starch', 2),
  ('arrowroot', 'أراروت', 'Arrowroot', 3),
  ('kaolin', 'طين كاولين', 'Kaolin clay', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'declared_powder_base' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_side_airbag_compatibility' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('compatible', 'متوافق (خياطة خاصة للإيرباج)', 'Compatible (tear-away seams)', 0),
  ('not_compatible', 'غير متوافق', 'Not compatible', 1),
  ('not_specified', 'غير محدد', 'Not specified', 2)) v(code, ar, en, sort)
 where d.code = 'declared_side_airbag_compatibility' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_spill_resistance' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spill_proof', 'ضد الانسكاب تمامًا', 'Spill-proof', 0),
  ('leak_resistant', 'مقاوم للتسريب', 'Leak-resistant', 1),
  ('not_spill_proof', 'غير مانع للتسريب', 'Not Spill-proof', 2)) v(code, ar, en, sort)
 where d.code = 'declared_spill_resistance' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_standard_or_certification' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ece_22_06', 'ECE 22.06', 'ECE 22.06', 0),
  ('ece_22_05', 'ECE 22.05', 'ECE 22.05', 1),
  ('dot', 'DOT (أمريكي)', 'DOT (FMVSS 218)', 2),
  ('snell', 'Snell', 'Snell', 3),
  ('egyptian_standard', 'مواصفة مصرية', 'Egyptian standard', 4),
  ('none_declared', 'بدون اعتماد معلن', 'None declared', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'declared_standard_or_certification' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_suitable_surfaces' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('car_paint', 'دهان السيارة', 'Car paint', 0),
  ('glass', 'زجاج', 'Glass', 1),
  ('plastic', 'بلاستيك', 'Plastic', 2),
  ('chrome_metal', 'كروم ومعادن', 'Chrome / metal', 3),
  ('wheels', 'جنوط', 'Wheels / rims', 4),
  ('leather', 'جلد', 'Leather', 5),
  ('fabric', 'قماش وفرش', 'Fabric / upholstery', 6),
  ('stainless_steel', 'استانلس', 'Stainless steel', 7),
  ('non_stick', 'تيفال (غير لاصق)', 'Non-stick cookware', 8),
  ('ceramic_tiles', 'سيراميك وبورسلين', 'Ceramic / porcelain tiles', 9),
  ('marble', 'رخام', 'Marble', 10),
  ('wood', 'خشب', 'Wood', 11),
  ('all_surfaces', 'كل الأسطح', 'All surfaces', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'declared_suitable_surfaces' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_tan_shade' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('light', 'فاتح', 'Light', 0),
  ('medium', 'متوسط', 'Medium', 1),
  ('dark', 'غامق', 'Dark', 2),
  ('ultra_dark', 'غامق جداً', 'Ultra dark', 3),
  ('gradual', 'تدريجي', 'Gradual', 4)) v(code, ar, en, sort)
 where d.code = 'declared_tan_shade' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'declared_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('baby', 'للأطفال', 'Baby', 0),
  ('face_makeup_removal', 'للوجه وإزالة المكياج', 'Face / makeup removal', 1),
  ('hands_body', 'لليدين والجسم', 'Hands and body', 2),
  ('intimate', 'للمناطق الحساسة', 'Intimate', 3),
  ('antibacterial', 'معقمة', 'Antibacterial', 4),
  ('all_purpose_flour', 'دقيق لكل الاستخدامات', 'All-purpose flour', 5),
  ('bread', 'للعيش', 'Bread', 6),
  ('cakes', 'للكيك', 'Cakes', 7),
  ('pastry', 'للمعجنات والفطير', 'Pastry', 8),
  ('pizza', 'للبيتزا', 'Pizza', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'declared_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_use_location' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('indoor', 'داخلي', 'Indoor', 0),
  ('outdoor', 'خارجي', 'Outdoor', 1),
  ('indoor_outdoor', 'داخلي وخارجي', 'Indoor & outdoor', 2),
  ('bathroom', 'حمام', 'Bathroom', 3)) v(code, ar, en, sort)
 where d.code = 'declared_use_location' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_uv_protection' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('uv400', 'حماية UV400', 'UV400 Protection', 0),
  ('uv_protection', 'حماية UV', 'UV Protection', 1),
  ('none', 'بدون حماية', 'None', 2)) v(code, ar, en, sort)
 where d.code = 'declared_uv_protection' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_video_resolution' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('p480', '480p', '480p', 0),
  ('p720', '720p (HD)', '720p HD', 1),
  ('p1080', '1080p (فل HD)', '1080p Full HD', 2),
  ('k2', '2K', '2K', 3),
  ('k4', '4K', '4K', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'declared_video_resolution' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_water_resistance' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'غير مقاوم للماء', 'Not water resistant', 0),
  ('water_repellent', 'طارد للماء', 'Water repellent', 1),
  ('water_resistant', 'مقاوم للماء', 'Water resistant', 2),
  ('waterproof', 'ضد الماء تماماً', 'Waterproof', 3),
  ('ipx4', 'مقاوم للرذاذ IPX4', 'IPX4', 4),
  ('ipx7', 'مقاوم للماء IPX7', 'IPX7', 5),
  ('min40', 'مقاوم للماء 40 دقيقة', 'Water resistant 40 min', 6),
  ('min80', 'مقاوم للماء 80 دقيقة', 'Water resistant 80 min', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'declared_water_resistance' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_water_resistance_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'غير مقاوم للماء', 'Not water resistant', 0),
  ('ipx4', 'مقاوم للرذاذ IPX4', 'IPX4', 1),
  ('ipx5', 'IPX5', 'IPX5', 2),
  ('ipx6', 'IPX6', 'IPX6', 3),
  ('ipx7', 'مقاوم للماء IPX7', 'IPX7', 4),
  ('ipx8', 'ضد الماء IPX8', 'IPX8', 5)) v(code, ar, en, sort)
 where d.code = 'declared_water_resistance_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_water_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('natural_mineral', 'مياه معدنية طبيعية', 'Natural mineral water', 0),
  ('spring', 'مياه ينابيع', 'Spring water', 1),
  ('purified', 'مياه معالجة / منقاة', 'Purified / treated', 2),
  ('alkaline', 'مياه قلوية', 'Alkaline', 3),
  ('low_sodium', 'قليلة الصوديوم (للأطفال)', 'Low sodium / baby', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'declared_water_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'declared_wet_or_dry_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dry', 'جاف فقط', 'Dry only', 0),
  ('wet_dry', 'جاف ورطب', 'Wet and dry', 1),
  ('wet', 'رطب فقط', 'Wet only', 2)) v(code, ar, en, sort)
 where d.code = 'declared_wet_or_dry_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'decoration_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stickers', 'ستيكرز', 'Stickers', 0),
  ('water_decals', 'ستيكر مائي', 'Water decals', 1),
  ('rhinestones', 'ستراس', 'Rhinestones', 2),
  ('glitter', 'جليتر', 'Glitter', 3),
  ('foil', 'فويل', 'Foil', 4),
  ('charms_3d', 'إكسسوارات 3D', '3D charms', 5),
  ('pearls', 'لولي', 'Pearls', 6),
  ('studs', 'مسامير معدن', 'Metal studs', 7),
  ('sequins', 'ترتر', 'Sequins', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'decoration_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'desk_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('writing', 'مكتب عادي / كتابة', 'Writing desk', 0),
  ('computer', 'مكتب كمبيوتر', 'Computer desk', 1),
  ('study_kids', 'مكتب مذاكرة أطفال', 'Kids study desk', 2),
  ('l_shaped', 'مكتب على شكل L', 'L-shaped desk', 3),
  ('executive', 'مكتب مدير', 'Executive desk', 4),
  ('gaming', 'مكتب جيمنج', 'Gaming desk', 5),
  ('standing', 'مكتب واقف', 'Standing desk', 6),
  ('wall_folding', 'مكتب حائط قابل للطي', 'Wall-mounted folding desk', 7),
  ('with_shelves', 'مكتب بمكتبة / أرفف', 'Desk with hutch / shelves', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'desk_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'detachable_handheld_unit' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم - تتحول لمحمولة', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'detachable_handheld_unit' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'شكل المنظف' where code = 'detergent_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('powder', 'بودرة', 'Powder', 0),
  ('liquid', 'سائل', 'Liquid', 1),
  ('gel', 'جل', 'Gel', 2),
  ('pods', 'كبسولات', 'Pods / Capsules', 3),
  ('tablets', 'أقراص', 'Tablets', 4),
  ('sheets', 'شرائح (شيتس)', 'Sheets', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'detergent_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'device_design' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wand', 'قلم / عصا', 'Wand / Pen', 0),
  ('comb', 'مشط حراري', 'Comb', 1),
  ('clamp', 'مكبس (كلامب)', 'Clamp', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'device_design' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'device_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cordless', 'لاسلكي محمول', 'Cordless portable', 0),
  ('countertop', 'على الحوض (بخزان)', 'Countertop', 1),
  ('faucet', 'على الحنفية', 'Faucet-mounted', 2),
  ('shower', 'للدش', 'Shower', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'device_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'diaper_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tape', 'حفاض بلزق', 'Tape Diaper', 0),
  ('pants', 'حفاض شورت (بانتس)', 'Pants', 1),
  ('cloth', 'قماش قابل لإعادة الاستخدام', 'Reusable Cloth', 2),
  ('swim', 'حفاض سباحة', 'Swim Diaper', 3),
  ('overnight', 'ليلي', 'Overnight', 4),
  ('newborn', 'حديثي الولادة', 'Newborn', 5),
  ('premature', 'مبتسرين', 'Premature', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'diaper_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dimmable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'قابلة للتعتيم', 'Dimmable', 0),
  ('no', 'غير قابلة للتعتيم', 'Not dimmable', 1),
  ('step', 'تعتيم على مراحل (من المفتاح)', 'Step dimming (via switch)', 2)) v(code, ar, en, sort)
 where d.code = 'dimmable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'display_outputs' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hdmi', 'HDMI', 'HDMI', 0),
  ('displayport', 'DisplayPort', 'DisplayPort', 1),
  ('dvi', 'DVI', 'DVI', 2),
  ('vga', 'VGA', 'VGA', 3),
  ('usb_c', 'USB-C', 'USB-C', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'display_outputs' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'display_resolution' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hd', 'HD (1366×768 / 1280×720)', 'HD', 0),
  ('hd_plus', 'HD+ (1600×720)', 'HD+', 1),
  ('fhd', 'Full HD (1920×1080)', 'Full HD', 2),
  ('fhd_plus', 'FHD+ (2400×1080)', 'FHD+', 3),
  ('wuxga', 'WUXGA (1920×1200)', 'WUXGA', 4),
  ('2k_qhd', '2K / QHD (2560×1440)', '2K / QHD', 5),
  ('qhd_plus', 'QHD+ (3200×1440 / 2560×1600)', 'QHD+ / WQXGA', 6),
  ('3k', '3K / 2.8K', '3K / 2.8K', 7),
  ('4k', '4K UHD (3840×2160)', '4K UHD', 8),
  ('5k', '5K', '5K', 9),
  ('8k', '8K', '8K', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'display_resolution' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'display_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ips_lcd', 'IPS LCD', 'IPS LCD', 0),
  ('tft_lcd', 'TFT LCD', 'TFT LCD', 1),
  ('led', 'LED', 'LED', 2),
  ('va', 'VA', 'VA', 3),
  ('tn', 'TN', 'TN', 4),
  ('oled', 'OLED', 'OLED', 5),
  ('amoled', 'AMOLED', 'AMOLED', 6),
  ('super_amoled', 'Super AMOLED / Dynamic AMOLED', 'Super / Dynamic AMOLED', 7),
  ('ltpo_oled', 'LTPO OLED', 'LTPO OLED', 8),
  ('qled', 'QLED', 'QLED', 9),
  ('mini_led', 'Mini LED / Neo QLED', 'Mini LED / Neo QLED', 10),
  ('qd_oled', 'QD-OLED', 'QD-OLED', 11),
  ('micro_led', 'Micro LED', 'Micro LED', 12),
  ('e_ink', 'حبر إلكتروني E-Ink', 'E-Ink', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'display_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'doll_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fashion', 'عروسة موضة (باربي)', 'Fashion Doll', 0),
  ('baby', 'عروسة بيبي', 'Baby Doll', 1),
  ('reborn', 'عروسة ريبورن (واقعية)', 'Reborn Doll', 2),
  ('rag', 'عروسة قماش', 'Rag Doll', 3),
  ('interactive', 'عروسة تتكلم / تفاعلية', 'Interactive / Talking Doll', 4),
  ('princess', 'عروسة أميرات', 'Princess Doll', 5),
  ('mini_surprise', 'عرايس صغيرة / مفاجآت', 'Mini / Surprise Dolls', 6),
  ('action_figure', 'مجسم شخصية (أكشن فيجر)', 'Action Figure', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'doll_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'door_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hinged', 'ضلف مفصلي', 'Hinged', 0),
  ('sliding', 'جرار (سحاب)', 'Sliding', 1),
  ('sliding_mirror', 'جرار بمرايا', 'Sliding with mirror', 2),
  ('hinged_mirror', 'ضلف بمرايا', 'Hinged with mirror', 3),
  ('open', 'مفتوح بدون أبواب', 'Open (no doors)', 4),
  ('fabric_zip', 'قماش بسوستة', 'Fabric with zipper', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'door_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dough_hooks_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('beaters_only', 'مضارب فقط (بدون خطافات)', 'Beaters Only', 0),
  ('beaters_and_hooks', 'مضارب + خطافات عجن', 'Beaters + Dough Hooks', 1),
  ('hooks_and_blender', 'مضارب + خطافات + عصا خلاط', 'Beaters + Hooks + Blender Stick', 2)) v(code, ar, en, sort)
 where d.code = 'dough_hooks_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dress_length' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mini', 'قصير (ميني)', 'Mini', 0),
  ('above_knee', 'فوق الركبة', 'Above Knee', 1),
  ('knee', 'لحد الركبة', 'Knee Length', 2),
  ('midi', 'ميدي (نص الساق)', 'Midi', 3),
  ('tea_length', 'تحت نص الساق', 'Tea Length', 4),
  ('ankle', 'لحد الكاحل', 'Ankle Length', 5),
  ('maxi', 'ماكسي (طويل للأرض)', 'Maxi / Floor Length', 6),
  ('high_low', 'قدام قصير وورا طويل', 'High-low', 7),
  ('with_train', 'بذيل', 'With Train', 8)) v(code, ar, en, sort)
 where d.code = 'dress_length' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dress_style' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('casual', 'كاجوال (يومي)', 'Casual', 0),
  ('evening_soiree', 'سواريه / سهرة', 'Evening / Soiree', 1),
  ('cocktail', 'كوكتيل', 'Cocktail', 2),
  ('party', 'حفلات', 'Party', 3),
  ('wedding', 'زفاف', 'Wedding', 4),
  ('engagement', 'خطوبة / كتب كتاب', 'Engagement', 5),
  ('work_office', 'عملي (شغل)', 'Work / Office', 6),
  ('modest', 'محتشم (للمحجبات)', 'Modest', 7),
  ('beach_summer', 'صيفي / بحر', 'Beach / Summer', 8),
  ('kids_party', 'حفلات أطفال', 'Kids Party', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'dress_style' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'drinking_spout_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('soft_spout', 'بزبوز طري', 'Soft Spout', 0),
  ('hard_spout', 'بزبوز صلب', 'Hard Spout', 1),
  ('straw', 'شفاطة', 'Straw', 2),
  ('weighted_straw', 'شفاطة بثقل', 'Weighted Straw', 3),
  ('rim_360', 'حافة 360', '360 Rim', 4),
  ('open_cup', 'كوب مفتوح', 'Open Cup', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'drinking_spout_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'drip_tray_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'بدون صينية', 'No tray', 0),
  ('fixed', 'صينية ثابتة', 'Fixed tray', 1),
  ('removable', 'صينية قابلة للفك', 'Removable tray', 2),
  ('with_spout', 'صينية ببزبوز تصريف', 'Tray with drain spout', 3)) v(code, ar, en, sort)
 where d.code = 'drip_tray_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'drive_form_factor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('in35', '3.5 بوصة', '3.5-inch', 0),
  ('in25', '2.5 بوصة', '2.5-inch', 1),
  ('m2_2280', 'M.2 2280', 'M.2 2280', 2),
  ('m2_2242', 'M.2 2242', 'M.2 2242', 3),
  ('m2_2230', 'M.2 2230', 'M.2 2230', 4),
  ('msata', 'mSATA', 'mSATA', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'drive_form_factor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'drying_function' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون تجفيف', 'No Drying', 0),
  ('hot_air', 'تجفيف بالهواء الساخن', 'Hot Air Drying', 1),
  ('spin_dry', 'تجفيف بالدوران', 'Spin Drying', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'drying_function' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'drying_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('vented', 'تهوية (بخرطوم)', 'Vented', 0),
  ('condenser', 'تكثيف', 'Condenser', 1),
  ('heat_pump', 'مضخة حرارية', 'Heat pump', 2)) v(code, ar, en, sort)
 where d.code = 'drying_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dumbbell_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rubber_hex', 'مطاط سداسي ثابت', 'Rubber hex (fixed)', 0),
  ('vinyl_neoprene', 'مغلف فينيل / نيوبرين', 'Vinyl / neoprene coated', 1),
  ('chrome', 'كروم', 'Chrome', 2),
  ('cast_iron', 'حديد زهر', 'Cast iron', 3),
  ('adjustable_plates', 'قابل للتعديل بالأطباق (صواميل)', 'Adjustable plate-loaded', 4),
  ('adjustable_selector', 'قابل للتعديل بالمؤشر (سريع)', 'Adjustable selector', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'dumbbell_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'duplex' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('automatic', 'تلقائي', 'Automatic', 0),
  ('manual', 'يدوي', 'Manual', 1),
  ('none', 'غير مدعوم', 'Not supported', 2)) v(code, ar, en, sort)
 where d.code = 'duplex' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dust_collection_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bag', 'بكيس', 'Bagged', 0),
  ('bagless_cyclone', 'بدون كيس (سيكلون)', 'Bagless Cyclone', 1),
  ('water_filter', 'فلتر مياه', 'Water Filtration', 2),
  ('auto_empty_station', 'محطة تفريغ ذاتي', 'Auto-empty Station', 3),
  ('drum', 'برميل (رطب وجاف)', 'Drum (Wet & Dry)', 4)) v(code, ar, en, sort)
 where d.code = 'dust_collection_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'dustpan_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون جاروف', 'No Dustpan', 0),
  ('standard', 'جاروف عادي', 'Standard Dustpan', 1),
  ('long_handle', 'جاروف بيد طويلة (واقف)', 'Long-handled Upright Dustpan', 2),
  ('with_comb', 'جاروف بمشط تنظيف', 'Dustpan with Cleaning Comb', 3)) v(code, ar, en, sort)
 where d.code = 'dustpan_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'earring_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stud', 'حلق صغير (ستاد)', 'Stud', 0),
  ('hoop', 'حلق حلقة', 'Hoop', 1),
  ('huggie', 'حلق هاجي (حلقة صغيرة)', 'Huggie', 2),
  ('drop', 'حلق متدلي', 'Drop', 3),
  ('dangle', 'حلق طويل متحرك', 'Dangle', 4),
  ('chandelier', 'حلق شانديلير', 'Chandelier', 5),
  ('ear_cuff', 'إير كاف (كلبس على الأذن)', 'Ear Cuff', 6),
  ('climber', 'حلق كلايمبر', 'Ear Climber', 7),
  ('threader', 'حلق سلسلة (ثريدر)', 'Threader', 8),
  ('clip_on', 'حلق كلبس (بدون خرم)', 'Clip-on', 9),
  ('jacket', 'حلق جاكيت (وجهين)', 'Ear Jacket', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'earring_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'efficiency_certification' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('80plus_bronze', '80 PLUS برونزي', '80 PLUS Bronze', 0),
  ('80plus_gold', '80 PLUS ذهبي', '80 PLUS Gold', 1),
  ('80plus_white', '80 PLUS أبيض (Standard)', '80 PLUS White', 2),
  ('80plus_silver', '80 PLUS فضي', '80 PLUS Silver', 3),
  ('80plus_platinum', '80 PLUS بلاتيني', '80 PLUS Platinum', 4),
  ('80plus_titanium', '80 PLUS تيتانيوم', '80 PLUS Titanium', 5),
  ('cybenetics', 'شهادة Cybenetics', 'Cybenetics rated', 6),
  ('none', 'بدون شهادة', 'Not certified', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'efficiency_certification' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'electrode_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('nickel', 'نيكل / نحاس (عادي)', 'Nickel / copper core', 0),
  ('iridium', 'إيريديوم', 'Iridium', 1),
  ('platinum', 'بلاتين', 'Platinum', 2),
  ('double_platinum', 'بلاتين مزدوج', 'Double platinum', 3),
  ('iridium_platinum', 'إيريديوم + بلاتين', 'Iridium-platinum', 4),
  ('silver', 'فضة', 'Silver', 5),
  ('ruthenium', 'روثينيوم', 'Ruthenium', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'electrode_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'emergency_stop' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('magnetic_safety_key', 'مفتاح أمان مغناطيسي بمشبك', 'Magnetic safety key with clip', 0),
  ('stop_button', 'زرار إيقاف طوارئ', 'Emergency stop button', 1),
  ('key_and_button', 'مفتاح أمان + زرار إيقاف', 'Safety key + stop button', 2),
  ('none', 'لا يوجد', 'None', 3)) v(code, ar, en, sort)
 where d.code = 'emergency_stop' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'empty_tank_shut_off' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('yes_alert', 'نعم مع تنبيه ضوئي', 'Yes, with indicator light', 1),
  ('no', 'لا', 'No', 2)) v(code, ar, en, sort)
 where d.code = 'empty_tank_shut_off' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'end_fitting_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('barrel_nipple', 'راس أسطوانية', 'Barrel nipple', 0),
  ('pear_nipple', 'راس كمثرى', 'Pear nipple', 1),
  ('ball_end', 'راس كروية', 'Ball end', 2),
  ('threaded_adjuster', 'نهاية مقلوظة بضبط', 'Threaded adjuster end', 3),
  ('eye_end', 'نهاية حلقة', 'Eye end', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'end_fitting_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'energy_efficiency_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('a_ppp', 'A+++', 'A+++', 0),
  ('a_pp', 'A++', 'A++', 1),
  ('a_p', 'A+', 'A+', 2),
  ('opt_a', 'A', 'A', 3),
  ('opt_b', 'B', 'B', 4),
  ('opt_c', 'C', 'C', 5),
  ('opt_d', 'D', 'D', 6),
  ('opt_e', 'E', 'E', 7),
  ('opt_f', 'F', 'F', 8),
  ('opt_g', 'G', 'G', 9),
  ('not_rated', 'غير مصنف', 'Not rated', 10)) v(code, ar, en, sort)
 where d.code = 'energy_efficiency_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'engine_application' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('petrol', 'بنزين', 'Petrol', 0),
  ('diesel', 'ديزل', 'Diesel', 1),
  ('petrol_diesel', 'بنزين وديزل', 'Petrol and diesel', 2),
  ('motorcycle_4t', 'موتوسيكل 4 شوط', 'Motorcycle 4-stroke', 3),
  ('motorcycle_2t', 'موتوسيكل 2 شوط', 'Motorcycle 2-stroke', 4),
  ('heavy_duty', 'نقل ثقيل', 'Heavy-duty', 5),
  ('hybrid', 'هايبرد', 'Hybrid', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'engine_application' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'esim_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا يدعم eSIM', 'No eSIM', 0),
  ('esim_and_physical', 'eSIM + شريحة عادية', 'eSIM + Physical SIM', 1),
  ('dual_esim', 'يدعم 2 eSIM + شريحة عادية', 'Dual eSIM + Physical SIM', 2),
  ('esim_only', 'eSIM فقط', 'eSIM Only', 3)) v(code, ar, en, sort)
 where d.code = 'esim_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'exercise_bike_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('upright', 'عجلة ثابتة عادية (أبرايت)', 'Upright', 0),
  ('recumbent', 'بظهر (ريكمبنت)', 'Recumbent', 1),
  ('spinning', 'سبينينج', 'Spin bike', 2),
  ('x_bike_folding', 'قابلة للطي (X-Bike)', 'Folding X-bike', 3),
  ('air_bike', 'إير بايك (بمروحة)', 'Air / fan bike', 4),
  ('elliptical_combo', 'عجلة + أوبتيكال', 'Bike-elliptical combo', 5),
  ('mini_pedal', 'بدال صغير (ميني)', 'Mini pedal exerciser', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'exercise_bike_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'exfoliation_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('physical', 'ميكانيكي (حبيبات)', 'Physical (granules)', 0),
  ('aha', 'كيميائي AHA', 'Chemical AHA', 1),
  ('bha', 'كيميائي BHA', 'Chemical BHA', 2),
  ('enzymatic', 'إنزيمي', 'Enzymatic', 3),
  ('peeling_gel', 'جل تقشير (بيلينج)', 'Peeling gel', 4),
  ('combined', 'مزدوج', 'Combined', 5)) v(code, ar, en, sort)
 where d.code = 'exfoliation_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'expandable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا (مقاس ثابت)', 'No (fixed)', 0),
  ('telescopic', 'قابل للسحب (تليسكوبي)', 'Telescopic', 1),
  ('adjustable_dividers', 'فواصل قابلة للتحريك', 'Adjustable dividers', 2),
  ('modular', 'قطع تتركب مع بعض', 'Modular pieces', 3)) v(code, ar, en, sort)
 where d.code = 'expandable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'extendable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا (مقاس ثابت)', 'No (fixed size)', 0),
  ('center_leaf', 'تمديد بلوح في المنتصف', 'Center extension leaf', 1),
  ('butterfly', 'تمديد فراشة (مطوي داخلها)', 'Butterfly leaf', 2),
  ('drop_leaf', 'جوانب بتتفرد (دروب ليف)', 'Drop-leaf', 3),
  ('end_leaves', 'ألواح من الطرفين', 'End extension leaves', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'extendable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'eye_protection_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('goggles', 'نظارة حماية مرفقة', 'Goggles included', 0),
  ('built_in', 'حماية عين مدمجة', 'Built-in eye shield', 1),
  ('none', 'بدون', 'None', 2)) v(code, ar, en, sort)
 where d.code = 'eye_protection_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'face_shield_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clear', 'شفاف', 'Clear', 0),
  ('smoked', 'فاميه (مدخن)', 'Smoked / tinted', 1),
  ('mirrored', 'عاكس (مرايا)', 'Mirrored / iridium', 2),
  ('photochromic', 'فوتوكروميك (يغمق مع الشمس)', 'Photochromic', 3),
  ('internal_sun_visor', 'زجاج + نضارة شمس داخلية', 'Clear with internal sun visor', 4),
  ('anti_fog', 'مضاد للشبورة', 'Anti-fog / Pinlock ready', 5),
  ('no_shield', 'بدون واقي وجه', 'No face shield', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'face_shield_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'fast_charging_protocols' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_pd', 'USB Power Delivery (PD)', 'USB Power Delivery (PD)', 0),
  ('pps', 'PPS', 'PPS', 1),
  ('qc3', 'Quick Charge 3.0', 'Quick Charge 3.0', 2),
  ('qc4', 'Quick Charge 4+ / 5', 'Quick Charge 4+ / 5', 3),
  ('samsung_sfc', 'Samsung Super Fast Charging', 'Samsung Super Fast Charging', 4),
  ('apple_fast', 'شحن سريع آيفون (20W+)', 'Apple Fast Charging', 5),
  ('huawei_scp', 'Huawei SuperCharge', 'Huawei SuperCharge', 6),
  ('vooc', 'VOOC / SuperVOOC (أوبو / ريلمي)', 'VOOC / SuperVOOC', 7),
  ('xiaomi_turbo', 'Xiaomi HyperCharge / Turbo', 'Xiaomi HyperCharge / Turbo', 8),
  ('afc_fcp', 'AFC / FCP', 'AFC / FCP', 9),
  ('qi_qi2', 'شحن لاسلكي Qi / Qi2', 'Qi / Qi2 Wireless', 10),
  ('none', 'بدون شحن سريع', 'No Fast Charging', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'fast_charging_protocols' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'fastening_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('laces', 'رباط', 'Laces', 0),
  ('slip_on', 'بدون رباط (سليب أون)', 'Slip-on', 1),
  ('velcro', 'لاصق (فيلكرو)', 'Hook and loop', 2),
  ('zipper', 'سوستة', 'Zipper', 3),
  ('buckle', 'توكة', 'Buckle', 4),
  ('elastic', 'أستك', 'Elastic', 5),
  ('quick_lace', 'رباط سريع / بكرة', 'Quick lace / BOA', 6),
  ('toggle', 'قفل حبل', 'Toggle', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'fastening_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fat_content_class' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_fat', 'كامل الدسم', 'Full fat', 0),
  ('semi_skimmed', 'نصف دسم (قليل الدسم)', 'Semi-skimmed / low fat', 1),
  ('skimmed', 'خالي الدسم', 'Skimmed / fat free', 2)) v(code, ar, en, sort)
 where d.code = 'fat_content_class' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'filing_surface_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('emery', 'صنفرة (إيمري)', 'Emery', 0),
  ('glass', 'زجاج', 'Glass', 1),
  ('stainless', 'ستانلس ستيل', 'Stainless steel', 2),
  ('ceramic', 'سيراميك', 'Ceramic', 3),
  ('pumice', 'حجر خفاف', 'Pumice', 4),
  ('foam_buffer', 'إسفنج تلميع', 'Foam buffer', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'filing_surface_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'filling_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('polyester_fiber', 'فايبر بوليستر', 'Polyester fiber', 0),
  ('hollow_fiber', 'هولو فايبر', 'Hollow fiber', 1),
  ('microfiber', 'مايكروفايبر', 'Microfiber', 2),
  ('cotton', 'قطن', 'Cotton', 3),
  ('feather', 'ريش', 'Feathers', 4),
  ('down', 'زغب (داون)', 'Down', 5),
  ('memory_foam', 'ميموري فوم', 'Memory foam', 6),
  ('foam_shredded', 'إسفنج مفروم', 'Shredded foam', 7),
  ('latex', 'لاتكس', 'Latex', 8),
  ('eps_beads', 'حبيبات فلين (EPS)', 'EPS beads', 9),
  ('wool', 'صوف', 'Wool', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'filling_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'filling_or_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'سادة (بدون)', 'Plain', 0),
  ('almond', 'لوز', 'Almond', 1),
  ('pistachio', 'فستق', 'Pistachio', 2),
  ('walnut', 'عين جمل', 'Walnut', 3),
  ('cashew', 'كاجو', 'Cashew', 4),
  ('hazelnut', 'بندق', 'Hazelnut', 5),
  ('chocolate', 'مغطى شوكولاتة', 'Chocolate coated', 6),
  ('coconut', 'جوز هند', 'Coconut', 7),
  ('sesame', 'سمسم', 'Sesame', 8),
  ('caramel', 'كراميل', 'Caramel', 9),
  ('orange_peel', 'قشر برتقال', 'Orange peel', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'filling_or_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'filter_construction' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('inline', 'على الخط (Inline)', 'Inline', 0),
  ('spin_on', 'قلاوظ (Spin-on)', 'Spin-on', 1),
  ('cartridge', 'خرطوشة (Element)', 'Cartridge / element', 2),
  ('water_separator', 'بفاصل مياه', 'With water separator', 3),
  ('in_tank', 'داخل التانك (مع الطرمبة)', 'In-tank', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'filter_construction' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'filter_media_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('particulate', 'عادي (أتربة)', 'Particulate', 0),
  ('carbon', 'كربون نشط', 'Activated carbon', 1),
  ('antibacterial', 'مضاد للبكتيريا', 'Antibacterial', 2),
  ('anti_allergen', 'مضاد للحساسية / HEPA', 'Anti-allergen / HEPA', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'filter_media_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'filter_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('panel', 'مستطيل (لوح)', 'Panel', 0),
  ('round', 'دائري', 'Round', 1),
  ('cylindrical', 'أسطواني', 'Cylindrical', 2),
  ('conical', 'مخروطي (رياضي)', 'Conical / cone', 3),
  ('oval', 'بيضاوي', 'Oval', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'filter_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'filter_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spin_on', 'فلتر علبة (لف)', 'Spin-on', 0),
  ('cartridge', 'فلتر خرطوشة (عنصر)', 'Cartridge / Element', 1),
  ('reusable', 'فلتر قماش قابل للغسيل', 'Reusable washable', 2),
  ('hepa', 'HEPA', 'HEPA', 3),
  ('sponge', 'إسفنج', 'Sponge', 4),
  ('disposable_bag', 'كيس ورق للاستعمال مرة', 'Disposable bag', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'filter_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'filter_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('true_hepa', 'فلتر HEPA', 'True HEPA', 0),
  ('hepa_h13', 'HEPA H13', 'HEPA H13', 1),
  ('carbon', 'كربون نشط', 'Activated carbon', 2),
  ('pre_filter', 'فلتر أولي', 'Pre-filter', 3),
  ('ionizer', 'أيونايزر', 'Ionizer', 4),
  ('uv_c', 'أشعة UV-C', 'UV-C', 5),
  ('washable', 'فلتر قابل للغسيل', 'Washable filter', 6),
  ('antibacterial', 'مضاد للبكتيريا', 'Antibacterial', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'filter_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'finish' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('matte', 'مطفي', 'Matte', 0),
  ('glossy', 'لامع', 'Glossy', 1),
  ('satin', 'ساتان / نص لامع', 'Satin', 2),
  ('natural', 'طبيعي', 'Natural', 3),
  ('dewy', 'ندي / جلو', 'Dewy', 4),
  ('shimmer', 'شيمر', 'Shimmer', 5),
  ('metallic', 'ميتاليك', 'Metallic', 6),
  ('glitter', 'جليتر', 'Glitter', 7),
  ('polished', 'مصقول', 'Polished', 8),
  ('brushed', 'مخدوش (براشد)', 'Brushed', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'finish' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'firmness' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('soft', 'طري', 'Soft', 0),
  ('medium_soft', 'متوسط الطراوة', 'Medium soft', 1),
  ('medium', 'متوسط', 'Medium', 2),
  ('medium_firm', 'متوسط الصلابة', 'Medium firm', 3),
  ('firm', 'صلب (ناشف)', 'Firm', 4),
  ('extra_firm', 'صلب جدًا (طبي)', 'Extra firm', 5)) v(code, ar, en, sort)
 where d.code = 'firmness' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fish_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tuna_light', 'تونة (لايت / سكيب جاك)', 'Light tuna (skipjack)', 0),
  ('tuna_white', 'تونة بيضاء (ألباكور)', 'White tuna (albacore)', 1),
  ('tuna_yellowfin', 'تونة صفراء الزعانف', 'Yellowfin tuna', 2),
  ('sardines', 'سردين', 'Sardines', 3),
  ('mackerel', 'ماكريل', 'Mackerel', 4),
  ('salmon', 'سالمون', 'Salmon', 5),
  ('anchovies', 'أنشوجة', 'Anchovies', 6),
  ('herring', 'رنجة', 'Herring', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'fish_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fitting_axle_and_side' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front_both', 'أمامي (يمين وشمال)', 'Front axle, both sides', 0),
  ('rear_both', 'خلفي (يمين وشمال)', 'Rear axle, both sides', 1),
  ('front_left', 'أمامي شمال', 'Front left', 2),
  ('front_right', 'أمامي يمين', 'Front right', 3),
  ('rear_left', 'خلفي شمال', 'Rear left', 4),
  ('rear_right', 'خلفي يمين', 'Rear right', 5)) v(code, ar, en, sort)
 where d.code = 'fitting_axle_and_side' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'fitting_position' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front', 'أمامي', 'Front', 0),
  ('rear', 'خلفي', 'Rear', 1),
  ('driver_side', 'ناحية السواق', 'Driver side', 2),
  ('passenger_side', 'ناحية الراكب', 'Passenger side', 3),
  ('rear_window', 'الزجاج الخلفي', 'Rear window', 4),
  ('front_rear', 'أمامي وخلفي', 'Front and rear', 5)) v(code, ar, en, sort)
 where d.code = 'fitting_position' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fitting_side' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('left', 'شمال', 'Left', 0),
  ('right', 'يمين', 'Right', 1),
  ('pair', 'زوج (يمين وشمال)', 'Pair (left and right)', 2),
  ('universal', 'يركب على الجهتين', 'Either side', 3)) v(code, ar, en, sort)
 where d.code = 'fitting_side' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fixing_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('oem_clips', 'كلبسات / خطافات التثبيت الأصلية', 'OEM clips / hooks', 0),
  ('anti_slip', 'ظهر مانع للانزلاق', 'Anti-slip backing', 1),
  ('velcro', 'فيلكرو (لاصق)', 'Hook and loop (Velcro)', 2),
  ('loose', 'بدون تثبيت (فرش حر)', 'Loose fit', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'fixing_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fixture_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('chandelier', 'نجفة', 'Chandelier', 0),
  ('pendant', 'دلاية', 'Pendant', 1),
  ('flush_mount', 'بلافونيرة ملزوقة في السقف', 'Flush mount', 2),
  ('semi_flush', 'نص ملزوقة', 'Semi-flush', 3),
  ('spot_downlight', 'سبوت', 'Spot / downlight', 4),
  ('panel', 'بانل', 'Panel', 5),
  ('track', 'تراك', 'Track light', 6),
  ('magnetic_track', 'تراك مغناطيسي', 'Magnetic track', 7),
  ('ceiling_fan_light', 'مروحة سقف بإضاءة', 'Ceiling fan with light', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'fixture_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'flame_failure_safety' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('all', 'كل العيون والفرن', 'All burners and oven', 1),
  ('burners', 'العيون فقط', 'Burners only', 2),
  ('oven', 'الفرن فقط', 'Oven only', 3)) v(code, ar, en, sort)
 where d.code = 'flame_failure_safety' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'flavor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('original', 'سادة / أصلي', 'Original / Plain', 0),
  ('chicken', 'فراخ', 'Chicken', 1),
  ('beef', 'لحم', 'Beef', 2),
  ('fish_tuna', 'سمك / تونة', 'Fish / Tuna', 3),
  ('salmon', 'سلمون', 'Salmon', 4),
  ('cheese', 'جبنة', 'Cheese', 5),
  ('salt_vinegar', 'ملح وخل', 'Salt & Vinegar', 6),
  ('tomato_ketchup', 'طماطم / كاتشب', 'Tomato / Ketchup', 7),
  ('chili_spicy', 'شطة / حار', 'Chili / Spicy', 8),
  ('bbq', 'باربكيو', 'BBQ', 9),
  ('garlic', 'ثوم', 'Garlic', 10),
  ('lemon', 'ليمون', 'Lemon', 11),
  ('orange', 'برتقال', 'Orange', 12),
  ('strawberry', 'فراولة', 'Strawberry', 13),
  ('mango', 'مانجو', 'Mango', 14),
  ('apple', 'تفاح', 'Apple', 15),
  ('mixed_fruit', 'فواكه مشكلة', 'Mixed Fruit', 16),
  ('cola', 'كولا', 'Cola', 17),
  ('mint', 'نعناع', 'Mint', 18),
  ('chocolate', 'شوكولاتة', 'Chocolate', 19),
  ('vanilla', 'فانيليا', 'Vanilla', 20),
  ('caramel', 'كراميل', 'Caramel', 21),
  ('honey', 'عسل', 'Honey', 22),
  ('mixed', 'نكهات مشكلة', 'Mixed Flavors', 23),
  ('other', 'أخرى', 'Other', 24)) v(code, ar, en, sort)
 where d.code = 'flavor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'flavor_or_additions' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('plain', 'سادة', 'Plain', 0),
  ('mint', 'نعناع', 'Mint', 1),
  ('cardamom', 'حبهان', 'Cardamom', 2),
  ('bergamot', 'برغموت (إيرل جراي)', 'Bergamot (Earl Grey)', 3),
  ('lemon', 'ليمون', 'Lemon', 4),
  ('jasmine', 'ياسمين', 'Jasmine', 5),
  ('ginger', 'جنزبيل', 'Ginger', 6),
  ('cinnamon', 'قرفة', 'Cinnamon', 7),
  ('fruits', 'فواكه / توت', 'Fruits / berries', 8),
  ('vanilla', 'فانيليا', 'Vanilla', 9),
  ('honey', 'عسل', 'Honey', 10),
  ('chamomile', 'كاموميل (بابونج)', 'Chamomile', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'flavor_or_additions' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'flavor_or_filling' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('plain', 'سادة', 'Plain', 0),
  ('hazelnut', 'بندق', 'Hazelnut', 1),
  ('almond', 'لوز', 'Almond', 2),
  ('pistachio', 'فستق', 'Pistachio', 3),
  ('peanut', 'فول سوداني', 'Peanut', 4),
  ('caramel', 'كراميل', 'Caramel', 5),
  ('biscuit', 'بسكويت', 'Biscuit', 6),
  ('wafer', 'ويفر', 'Wafer', 7),
  ('cookies_cream', 'كوكيز آند كريم', 'Cookies & cream', 8),
  ('nougat', 'نوجا', 'Nougat', 9),
  ('crispy_rice', 'أرز مقرمش', 'Crispy rice', 10),
  ('praline', 'برالين', 'Praline', 11),
  ('coconut', 'جوز هند', 'Coconut', 12),
  ('raisins', 'زبيب', 'Raisins', 13),
  ('orange', 'برتقال', 'Orange', 14),
  ('mint', 'نعناع', 'Mint', 15),
  ('strawberry', 'فراولة', 'Strawberry', 16),
  ('coffee', 'قهوة', 'Coffee', 17),
  ('other', 'أخرى', 'Other', 18)) v(code, ar, en, sort)
 where d.code = 'flavor_or_filling' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'flavor_or_scent' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unscented', 'بدون رائحة', 'Unscented', 0),
  ('strawberry', 'فراولة', 'Strawberry', 1),
  ('cherry', 'كريز', 'Cherry', 2),
  ('vanilla', 'فانيليا', 'Vanilla', 3),
  ('mint', 'نعناع', 'Mint', 4),
  ('coconut', 'جوز هند', 'Coconut', 5),
  ('honey', 'عسل', 'Honey', 6),
  ('cocoa', 'كاكاو', 'Cocoa', 7),
  ('watermelon', 'بطيخ', 'Watermelon', 8),
  ('peach', 'خوخ', 'Peach', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'flavor_or_scent' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'floor_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no_floor', 'بدون أرضية', 'No floor', 0),
  ('fabric_floor', 'أرضية قماش', 'Fabric floor', 1),
  ('padded_mat', 'أرضية مبطنة / مرتبة', 'Padded mat floor', 2),
  ('floor_and_bassinet', 'أرضية + سرير علوي', 'Floor + raised bassinet', 3)) v(code, ar, en, sort)
 where d.code = 'floor_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'floss_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('waxed', 'خيط بالشمع', 'Waxed', 0),
  ('unwaxed', 'خيط بدون شمع', 'Unwaxed', 1),
  ('tape', 'شريط عريض', 'Tape', 2),
  ('ptfe', 'PTFE ناعم', 'PTFE', 3),
  ('expanding', 'إسفنجي يتمدد', 'Expanding', 4),
  ('picks', 'خلة بخيط', 'Floss picks', 5),
  ('super_floss', 'للتقويم والتركيبات', 'Super floss', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'floss_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'flour_source' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wheat', 'قمح', 'Wheat', 0),
  ('corn', 'ذرة', 'Corn', 1),
  ('rice', 'أرز', 'Rice', 2),
  ('oat', 'شوفان', 'Oat', 3),
  ('barley', 'شعير', 'Barley', 4),
  ('chickpea', 'حمص', 'Chickpea', 5),
  ('almond', 'لوز', 'Almond', 6),
  ('coconut', 'جوز هند', 'Coconut', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'flour_source' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'flour_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all_purpose', 'دقيق فاخر (72%)', 'All-purpose (72%)', 0),
  ('baladi', 'دقيق بلدي (82%)', 'Baladi (82%)', 1),
  ('bread', 'دقيق خبز (قوي)', 'Bread flour', 2),
  ('cake', 'دقيق كيك (ضعيف)', 'Cake flour', 3),
  ('self_raising', 'ذاتي التخمير', 'Self-raising', 4),
  ('whole_wheat', 'دقيق أسمر (قمح كامل)', 'Whole wheat', 5),
  ('pastry', 'دقيق معجنات', 'Pastry flour', 6),
  ('gluten_free', 'خالي من الجلوتين', 'Gluten free', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'flour_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'foldable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير قابل للطي', 'Not foldable', 0),
  ('foldable', 'قابل للطي', 'Foldable', 1),
  ('one_hand', 'طي بيد واحدة', 'One-hand fold', 2),
  ('compact_travel', 'طي مضغوط للسفر', 'Compact travel fold', 3),
  ('detachable', 'قابل للفك', 'Detachable / Disassemblable', 4)) v(code, ar, en, sort)
 where d.code = 'foldable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'folding_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('one_hand', 'طي بإيد واحدة', 'One-hand fold', 0),
  ('two_hand', 'طي بالإيدين', 'Two-hand fold', 1),
  ('umbrella', 'طي شمسية', 'Umbrella fold', 2),
  ('compact_cabin', 'طي صغير (مقاس الطيارة)', 'Compact / cabin fold', 3),
  ('auto_fold', 'طي أوتوماتيك', 'Auto fold', 4),
  ('non_folding', 'غير قابل للطي', 'Non-folding', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'folding_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'football_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('match', 'كرة مباريات', 'Match Ball', 0),
  ('training', 'كرة تدريب', 'Training Ball', 1),
  ('futsal', 'كرة صالات (فوتسال)', 'Futsal', 2),
  ('street', 'كرة شارع (أسفلت)', 'Street Ball', 3),
  ('beach', 'كرة شاطئ', 'Beach Soccer', 4),
  ('kids_mini', 'كرة أطفال / ميني', 'Kids / Mini Ball', 5),
  ('souvenir', 'كرة تذكارية (فرق)', 'Souvenir / Club Ball', 6)) v(code, ar, en, sort)
 where d.code = 'football_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'footed_or_footless' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('footed', 'بقدم', 'Footed', 0),
  ('footless', 'بدون قدم', 'Footless', 1),
  ('fold_over', 'قدم قابلة للقلب', 'Fold-over feet', 2)) v(code, ar, en, sort)
 where d.code = 'footed_or_footless' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'form_factor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('atx', 'ATX', 'ATX', 0),
  ('micro_atx', 'Micro-ATX', 'Micro-ATX', 1),
  ('mini_itx', 'Mini-ITX', 'Mini-ITX', 2),
  ('e_atx', 'E-ATX', 'E-ATX', 3),
  ('full_tower', 'كيسة كبيرة (Full Tower)', 'Full Tower', 4),
  ('mid_tower', 'كيسة متوسطة (Mid Tower)', 'Mid Tower', 5),
  ('mini_tower', 'كيسة صغيرة (Mini Tower)', 'Mini Tower', 6),
  ('sff', 'صغير الحجم (SFF)', 'Small Form Factor (SFF)', 7),
  ('mini_pc', 'ميني PC', 'Mini PC', 8),
  ('all_in_one', 'متكامل مع الشاشة (All-in-One)', 'All-in-One', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'form_factor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'نوع النسخة' where code = 'format' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('printed', 'ورقي', 'Printed', 0),
  ('ebook', 'إلكتروني', 'E-book', 1),
  ('audiobook', 'كتاب صوتي', 'Audiobook', 2)) v(code, ar, en, sort)
 where d.code = 'format' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'formulation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cream', 'كريم', 'Cream', 0),
  ('lotion', 'لوشن', 'Lotion', 1),
  ('gel', 'جل', 'Gel', 2),
  ('serum', 'سيروم', 'Serum', 3),
  ('oil', 'زيت', 'Oil', 4),
  ('liquid', 'سائل', 'Liquid', 5),
  ('foam', 'فوم', 'Foam', 6),
  ('mousse', 'موس', 'Mousse', 7),
  ('spray', 'بخاخ', 'Spray', 8),
  ('powder', 'بودرة', 'Powder', 9),
  ('balm', 'بلسم', 'Balm', 10),
  ('stick', 'ستيك', 'Stick', 11),
  ('bar', 'صابونة', 'Bar', 12),
  ('strips', 'شرائح', 'Strips', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'formulation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'forward_and_reverse_rotation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'forward_and_reverse_rotation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fragrance' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unscented', 'بدون رائحة', 'Unscented', 0),
  ('lavender', 'لافندر', 'Lavender', 1),
  ('rose', 'ورد', 'Rose', 2),
  ('jasmine', 'ياسمين', 'Jasmine', 3),
  ('vanilla', 'فانيليا', 'Vanilla', 4),
  ('lemon', 'ليمون', 'Lemon', 5),
  ('citrus', 'حمضيات / برتقال', 'Citrus / orange', 6),
  ('apple', 'تفاح', 'Apple', 7),
  ('strawberry', 'فراولة', 'Strawberry', 8),
  ('coconut', 'جوز الهند', 'Coconut', 9),
  ('fresh_ocean', 'فريش / بحري', 'Fresh / ocean', 10),
  ('oud', 'عود', 'Oud', 11),
  ('musk', 'مسك', 'Musk', 12),
  ('sandalwood', 'صندل', 'Sandalwood', 13),
  ('mint', 'نعناع', 'Mint', 14),
  ('aloe', 'صبار', 'Aloe vera', 15),
  ('baby_powder', 'بودرة أطفال', 'Baby powder', 16),
  ('clean_cotton', 'قطن / غسيل نضيف', 'Clean cotton', 17),
  ('other', 'أخرى', 'Other', 18)) v(code, ar, en, sort)
 where d.code = 'fragrance' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fragrance_concentration' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('extrait', 'بارفان / إكستريه', 'Parfum / Extrait', 0),
  ('edp', 'أو دو بارفان (EDP)', 'Eau de Parfum', 1),
  ('edt', 'أو دو تواليت (EDT)', 'Eau de Toilette', 2),
  ('edc', 'أو دو كولونيا (EDC)', 'Eau de Cologne', 3),
  ('body_mist', 'بودي ميست / سبلاش', 'Body mist / splash', 4),
  ('perfume_oil', 'زيت عطري', 'Perfume oil', 5),
  ('solid', 'عطر صلب', 'Solid perfume', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'fragrance_concentration' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'fragrance_family' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('floral', 'زهري', 'Floral', 0),
  ('fruity', 'فواكه', 'Fruity', 1),
  ('oriental', 'شرقي / عنبري', 'Oriental / Amber', 2),
  ('oud', 'عود', 'Oud', 3),
  ('woody', 'خشبي', 'Woody', 4),
  ('musky', 'مسك', 'Musky', 5),
  ('fresh_citrus', 'فريش / حمضيات', 'Fresh / Citrus', 6),
  ('aquatic', 'مائي / بحري', 'Aquatic', 7),
  ('gourmand', 'حلو (فانيليا وكراميل)', 'Gourmand', 8),
  ('spicy', 'توابل', 'Spicy', 9),
  ('aromatic', 'عشبي أروماتيك', 'Aromatic / Fougere', 10),
  ('powdery', 'بودري', 'Powdery', 11),
  ('leather', 'جلدي', 'Leather', 12),
  ('chypre', 'شيبر', 'Chypre', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'fragrance_family' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'frame_color' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('black', 'أسود', 'Black', 0),
  ('matte_black', 'أسود مطفي', 'Matte Black', 1),
  ('tortoise', 'هافان (تورتواز)', 'Tortoise / Havana', 2),
  ('gold', 'ذهبي', 'Gold', 3),
  ('silver', 'فضي', 'Silver', 4),
  ('gunmetal', 'رصاصي (جن ميتال)', 'Gunmetal', 5),
  ('rose_gold', 'روز جولد', 'Rose Gold', 6),
  ('brown', 'بني', 'Brown', 7),
  ('transparent', 'شفاف', 'Transparent', 8),
  ('white', 'أبيض', 'White', 9),
  ('blue', 'أزرق', 'Blue', 10),
  ('red', 'أحمر', 'Red', 11),
  ('pink', 'وردي', 'Pink', 12),
  ('green', 'أخضر', 'Green', 13),
  ('multicolor', 'متعدد الألوان', 'Multicolor', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'frame_color' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'frame_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('metal', 'معدن', 'Metal', 0),
  ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 1),
  ('steel', 'صلب (حديد)', 'Steel / Iron', 2),
  ('aluminum', 'ألومنيوم', 'Aluminum', 3),
  ('titanium', 'تيتانيوم', 'Titanium', 4),
  ('plastic', 'بلاستيك', 'Plastic', 5),
  ('acetate', 'أسيتات', 'Acetate', 6),
  ('tr90', 'TR90 (مرن)', 'TR90', 7),
  ('solid_wood', 'خشب طبيعي (زان / موسكي)', 'Solid Wood', 8),
  ('mdf', 'خشب MDF', 'MDF', 9),
  ('rattan_bamboo', 'خيزران / بامبو', 'Rattan / Bamboo', 10),
  ('carbon_fiber', 'كربون فايبر', 'Carbon Fiber', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'frame_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'frame_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rectangle', 'مستطيل', 'Rectangle', 0),
  ('square', 'مربع', 'Square', 1),
  ('round', 'دائري', 'Round', 2),
  ('oval', 'بيضاوي', 'Oval', 3),
  ('aviator', 'أفياتور (طيار)', 'Aviator', 4),
  ('cat_eye', 'عين القطة', 'Cat Eye', 5),
  ('wayfarer', 'وايفرر', 'Wayfarer', 6),
  ('clubmaster', 'كلوب ماستر (نص إطار علوي)', 'Clubmaster / Browline', 7),
  ('oversized', 'كبير (أوفر سايز)', 'Oversized', 8),
  ('butterfly', 'فراشة', 'Butterfly', 9),
  ('hexagonal', 'سداسي / هندسي', 'Hexagonal / Geometric', 10),
  ('shield_wrap', 'قطعة واحدة / رياضي ملتف', 'Shield / Wraparound', 11),
  ('rimless', 'بدون إطار', 'Rimless', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'frame_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'frame_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('xs', 'XS (13-14 بوصة)', 'XS (13-14 in)', 0),
  ('opt_s', 'S (15-16 بوصة)', 'S (15-16 in)', 1),
  ('opt_m', 'M (17-18 بوصة)', 'M (17-18 in)', 2),
  ('opt_l', 'L (19-20 بوصة)', 'L (19-20 in)', 3),
  ('xl', 'XL (21 بوصة فأكثر)', 'XL (21 in+)', 4),
  ('one_size', 'مقاس واحد', 'One size', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'frame_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'freezer_safe' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'freezer_safe' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'frequency_band' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single_2_4', '2.4 GHz', '2.4 GHz', 0),
  ('dual_band', 'ثنائي النطاق 2.4 + 5 GHz', 'Dual band 2.4 + 5 GHz', 1),
  ('tri_band', 'ثلاثي النطاق', 'Tri band', 2),
  ('tri_band_6', 'يشمل 6 GHz', 'Includes 6 GHz', 3),
  ('not_applicable', 'لا ينطبق (كابل)', 'Not applicable (cable)', 4)) v(code, ar, en, sort)
 where d.code = 'frequency_band' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fretboard_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rosewood', 'روز وود', 'Rosewood', 0),
  ('ebony', 'أبنوس', 'Ebony', 1),
  ('maple', 'ميبل (قيقب)', 'Maple', 2),
  ('walnut', 'جوز', 'Walnut', 3),
  ('laurel', 'لوريل', 'Laurel', 4),
  ('engineered', 'خشب مصنع / مركب', 'Engineered wood', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'fretboard_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'fruit_or_flavor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('orange', 'برتقال', 'Orange', 0),
  ('mango', 'مانجو', 'Mango', 1),
  ('guava', 'جوافة', 'Guava', 2),
  ('apple', 'تفاح', 'Apple', 3),
  ('cocktail', 'كوكتيل', 'Cocktail / mixed fruit', 4),
  ('pineapple', 'أناناس', 'Pineapple', 5),
  ('strawberry', 'فراولة', 'Strawberry', 6),
  ('peach', 'خوخ', 'Peach', 7),
  ('apricot', 'مشمش', 'Apricot', 8),
  ('grape', 'عنب', 'Grape', 9),
  ('pomegranate', 'رمان', 'Pomegranate', 10),
  ('lemon', 'ليمون', 'Lemon', 11),
  ('lemon_mint', 'ليمون بالنعناع', 'Lemon mint', 12),
  ('sugarcane', 'قصب', 'Sugarcane', 13),
  ('tamarind', 'تمر هندي', 'Tamarind', 14),
  ('hibiscus', 'كركديه', 'Hibiscus', 15),
  ('carrot', 'جزر', 'Carrot', 16),
  ('tomato', 'طماطم', 'Tomato', 17),
  ('other', 'أخرى', 'Other', 18)) v(code, ar, en, sort)
 where d.code = 'fruit_or_flavor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'fuel_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('petrol', 'بنزين', 'Petrol', 0),
  ('diesel', 'سولار (ديزل)', 'Diesel', 1),
  ('natural_gas', 'غاز طبيعي', 'Natural gas', 2),
  ('lpg', 'غاز أنابيب (بوتاجاز)', 'LPG (cylinder)', 3),
  ('electric', 'كهرباء', 'Electric', 4),
  ('gas_electric', 'غاز وكهرباء', 'Dual fuel (gas + electric)', 5),
  ('hybrid', 'هايبرد', 'Hybrid', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'fuel_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'full_tank_shut_off' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('yes_alert', 'نعم مع تنبيه ضوئي / صوتي', 'Yes, with light / sound alert', 1),
  ('no', 'لا', 'No', 2)) v(code, ar, en, sort)
 where d.code = 'full_tank_shut_off' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'functions' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('print', 'طباعة', 'Print', 0),
  ('scan', 'سكانر', 'Scan', 1),
  ('copy', 'تصوير', 'Copy', 2),
  ('fax', 'فاكس', 'Fax', 3),
  ('adf', 'تغذية أوراق تلقائية (ADF)', 'Automatic document feeder', 4),
  ('wireless', 'طباعة لاسلكية', 'Wireless printing', 5)) v(code, ar, en, sort)
 where d.code = 'functions' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'game_language' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('arabic', 'عربي', 'Arabic', 0),
  ('english', 'إنجليزي', 'English', 1),
  ('arabic_english', 'عربي وإنجليزي', 'Arabic & English', 2),
  ('french', 'فرنساوي', 'French', 3),
  ('language_independent', 'بدون لغة (لا تعتمد على اللغة)', 'Language Independent', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'game_language' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'game_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('family_board', 'لعبة طاولة عائلية', 'Family Board Game', 0),
  ('card', 'لعبة كروت', 'Card Game', 1),
  ('strategy', 'استراتيجية', 'Strategy', 2),
  ('party', 'ألعاب سهرات وجماعية', 'Party Game', 3),
  ('classic', 'كلاسيك (شطرنج / طاولة / دومينو)', 'Classic (Chess/Backgammon/Dominoes)', 4),
  ('trading_monopoly', 'بنك الحظ / مونوبولي', 'Monopoly / Trading', 5),
  ('word_trivia', 'كلمات وأسئلة', 'Word & Trivia', 6),
  ('educational', 'تعليمية', 'Educational', 7),
  ('cooperative', 'تعاونية', 'Cooperative', 8),
  ('dice', 'نرد (زهر)', 'Dice Game', 9),
  ('puzzle_logic', 'ألغاز وذكاء', 'Puzzle / Logic', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'game_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'garment_bag_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('suit', 'حافظة بدلة', 'Suit Bag', 0),
  ('dress', 'حافظة فستان (طويلة)', 'Dress Bag', 1),
  ('foldable_carry_on', 'تطبق للكابينة', 'Foldable Carry-on', 2),
  ('hanging', 'معلقة بشماعة', 'Hanging', 3),
  ('dust_cover', 'غطاء شفاف ضد التراب', 'Clear Dust Cover', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'garment_bag_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'gpu_power_connectors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pin_6_2', '6+2 Pin', '6+2-pin PCIe', 0),
  ('pin_8', '8 Pin', '8-pin PCIe', 1),
  ('pin_6', '6 Pin', '6-pin PCIe', 2),
  ('12vhpwr', '12VHPWR (16 Pin)', '12VHPWR 16-pin', 3),
  ('12v_2x6', '12V-2x6', '12V-2x6', 4),
  ('none', 'لا يوجد', 'None', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'gpu_power_connectors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'grain_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('whole', 'صحيح (كامل)', 'Whole', 0),
  ('split', 'مجروش / مدشوش', 'Split / crushed', 1),
  ('peeled', 'مقشور', 'Peeled / hulled', 2),
  ('ground', 'مطحون', 'Ground', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'grain_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'grill_function' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون شواية', 'No grill', 0),
  ('electric', 'شواية كهرباء', 'Electric grill', 1),
  ('gas', 'شواية غاز', 'Gas grill', 2),
  ('rotisserie', 'شواية بسيخ دوار', 'Grill with rotisserie', 3)) v(code, ar, en, sort)
 where d.code = 'grill_function' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'grill_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('contact_grill', 'شواية بغطاء ضاغط (بانيني)', 'Contact / Panini Grill', 0),
  ('open_plate', 'شواية سطح مفتوح', 'Open Plate Grill', 1),
  ('smokeless_indoor', 'شواية بدون دخان', 'Smokeless Indoor Grill', 2),
  ('raclette', 'شواية راكليت / طاولة', 'Raclette / Tabletop Grill', 3),
  ('rotisserie', 'شواية بسيخ دوار', 'Rotisserie', 4),
  ('bbq_electric', 'شواية باربكيو كهربائية', 'Electric BBQ', 5),
  ('oven_gas_grill', 'شواية فرن غاز', 'Gas Oven Grill', 6),
  ('oven_electric_grill', 'شواية فرن كهرباء', 'Electric Oven Grill', 7),
  ('no_grill', 'بدون شواية', 'No Grill', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'grill_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'grind_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('whole', 'حبوب كاملة', 'Whole', 0),
  ('extra_fine', 'ناعم جداً (تركي)', 'Extra fine (Turkish)', 1),
  ('fine', 'ناعم', 'Fine', 2),
  ('espresso', 'إسبريسو', 'Espresso', 3),
  ('medium', 'وسط', 'Medium', 4),
  ('coarse', 'خشن', 'Coarse', 5),
  ('extra_coarse', 'خشن جداً', 'Extra coarse', 6),
  ('adjustable', 'قابل للتعديل (درجات متعددة)', 'Adjustable', 7)) v(code, ar, en, sort)
 where d.code = 'grind_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'grit_grade' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('coarse_80_100', 'خشن 80/100', 'Coarse 80/100', 0),
  ('medium_100_180', 'متوسط 100/180', 'Medium 100/180', 1),
  ('fine_180_240', 'ناعم 180/240', 'Fine 180/240', 2),
  ('buffer', 'تلميع ناعم جداً', 'Buffer / Polish', 3),
  ('multi_sided', 'متعدد الأوجه', 'Multi-sided', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'grit_grade' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hair_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('human_virgin', 'شعر طبيعي فيرجن', 'Virgin Human Hair', 0),
  ('human_remy', 'شعر طبيعي ريمي', 'Remy Human Hair', 1),
  ('human_non_remy', 'شعر طبيعي (غير ريمي)', 'Non-Remy Human Hair', 2),
  ('synthetic', 'شعر صناعي', 'Synthetic', 3),
  ('heat_resistant_synthetic', 'صناعي يتحمل الحرارة', 'Heat-resistant Synthetic', 4),
  ('blend', 'مخلوط (طبيعي وصناعي)', 'Human and Synthetic Blend', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'hair_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hair_texture' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('straight', 'ناعم (سترايت)', 'Straight', 0),
  ('body_wave', 'بودي ويف', 'Body Wave', 1),
  ('loose_wave', 'ويفي واسع', 'Loose Wave', 2),
  ('water_wave', 'ووتر ويف', 'Water Wave', 3),
  ('deep_wave', 'ديب ويف', 'Deep Wave', 4),
  ('curly', 'كيرلي', 'Curly', 5),
  ('kinky_curly', 'كيرلي أفرو', 'Kinky Curly', 6),
  ('kinky_straight', 'ناعم أفرو', 'Kinky Straight', 7),
  ('yaki', 'ياكي', 'Yaki', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'hair_texture' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hair_tie_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('elastic', 'أستك شعر', 'Elastic Band', 0),
  ('scrunchie', 'سكرانشي', 'Scrunchie', 1),
  ('spiral', 'أستك سلك (سبايرال)', 'Spiral Coil', 2),
  ('ribbon', 'شريطة', 'Ribbon', 3),
  ('bow', 'فيونكة', 'Bow', 4),
  ('seamless', 'أستك بدون معدن', 'Seamless', 5),
  ('hair_cuff', 'حلقة شعر (كاف)', 'Hair Cuff', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'hair_tie_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hand_orientation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('right', 'لليد اليمين', 'Right-handed', 0),
  ('left', 'لليد الشمال', 'Left-handed', 1),
  ('ambidextrous', 'للإيدين الاتنين', 'Ambidextrous', 2)) v(code, ar, en, sort)
 where d.code = 'hand_orientation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'handle_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stainless', 'ستانلس ستيل', 'Stainless steel', 0),
  ('wood', 'خشب', 'Wood', 1),
  ('bamboo', 'بامبو', 'Bamboo', 2),
  ('plastic', 'بلاستيك', 'Plastic', 3),
  ('silicone', 'سيليكون', 'Silicone', 4),
  ('rubber', 'مطاط', 'Rubber', 5),
  ('ceramic', 'سيراميك', 'Ceramic', 6),
  ('glass', 'زجاج', 'Glass', 7),
  ('resin', 'ريزن', 'Resin', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'handle_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hanger_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('plastic', 'بلاستيك', 'Plastic', 0),
  ('wooden', 'خشب', 'Wooden', 1),
  ('velvet', 'قطيفة (مانع انزلاق)', 'Velvet non-slip', 2),
  ('metal', 'معدن / سلك', 'Metal / Wire', 3),
  ('suit', 'شماعة بدلة', 'Suit hanger', 4),
  ('clip', 'بمشابك (بنطلون / جيبة)', 'Clip (trousers / skirt)', 5),
  ('multi_tier', 'متعددة الأدوار', 'Multi-tier', 6),
  ('kids', 'أطفال', 'Kids', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'hanger_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'harness_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('five_point', '5 نقاط', '5-point', 0),
  ('three_point', '3 نقاط', '3-point', 1),
  ('three_five_convertible', '3 أو 5 نقاط (قابل للتحويل)', '3/5-point convertible', 2),
  ('vehicle_belt', 'حزام العربية', 'Vehicle seat belt', 3),
  ('impact_shield', 'درع أمامي', 'Impact shield', 4),
  ('none', 'بدون حزام', 'None', 5)) v(code, ar, en, sort)
 where d.code = 'harness_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'hdr' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'لا يدعم', 'Not supported', 0),
  ('hdr10', 'HDR10', 'HDR10', 1),
  ('hdr10_plus', 'HDR10+', 'HDR10+', 2),
  ('dolby_vision', 'Dolby Vision', 'Dolby Vision', 3),
  ('hlg', 'HLG', 'HLG', 4),
  ('displayhdr_400', 'DisplayHDR 400', 'DisplayHDR 400', 5),
  ('displayhdr_600', 'DisplayHDR 600', 'DisplayHDR 600', 6),
  ('displayhdr_1000', 'DisplayHDR 1000', 'DisplayHDR 1000', 7),
  ('wdr', 'WDR (للكاميرات)', 'WDR', 8),
  ('hdr_generic', 'HDR (عام)', 'HDR (generic)', 9)) v(code, ar, en, sort)
 where d.code = 'hdr' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'head_coarseness_grades' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fine', 'ناعم', 'Fine', 0),
  ('regular', 'عادي', 'Regular', 1),
  ('coarse', 'خشن', 'Coarse', 2),
  ('extra_coarse', 'خشن جداً', 'Extra coarse', 3)) v(code, ar, en, sort)
 where d.code = 'head_coarseness_grades' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'headband_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hard_plastic', 'طوق بلاستيك', 'Plastic Headband', 0),
  ('metal', 'طوق معدن', 'Metal Headband', 1),
  ('padded', 'طوق منفوخ', 'Padded Headband', 2),
  ('fabric', 'عصابة قماش', 'Fabric Headband', 3),
  ('elastic', 'عصابة أستك', 'Elastic Headband', 4),
  ('turban', 'عصابة تربون (معقودة)', 'Twist / Turban', 5),
  ('sports', 'عصابة رياضية', 'Sports Headband', 6),
  ('jeweled', 'طوق بفصوص / خرز', 'Jeweled Headband', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'headband_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'heading_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('eyelet', 'حلقات معدن (عيون)', 'Eyelet / Grommet', 0),
  ('rod_pocket', 'جراب للماسورة', 'Rod pocket', 1),
  ('pinch_pleat', 'كسرات (بينش بليت)', 'Pinch pleat', 2),
  ('tape_hooks', 'شريط وخطافات', 'Tape with hooks', 3),
  ('tab_top', 'عراوي قماش', 'Tab top', 4),
  ('ring_clips', 'حلقات بمشابك', 'Ring clips', 5),
  ('wave', 'ويف (موجة)', 'Wave', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'heading_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'headphone_form_factor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tws_in_ear', 'إيربودز لاسلكية (TWS)', 'True Wireless In-ear', 0),
  ('wired_in_ear', 'سماعة أذن سلك', 'Wired In-ear', 1),
  ('neckband', 'نيك باند (حول الرقبة)', 'Neckband', 2),
  ('over_ear', 'هيدفون فوق الأذن (Over-ear)', 'Over-ear', 3),
  ('on_ear', 'هيدفون على الأذن (On-ear)', 'On-ear', 4),
  ('open_ear', 'أذن مفتوحة / عظمية', 'Open-ear / Bone Conduction', 5),
  ('ear_hook', 'بخطاف أذن (رياضي)', 'Ear Hook', 6),
  ('single_ear', 'سماعة أذن واحدة (هاندز فري)', 'Single-ear Headset', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'headphone_form_factor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true, label_ar = 'مصادر الحرارة المناسبة' where code = 'heat_source' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gas', 'غاز', 'Gas', 0),
  ('electric', 'كهرباء', 'Electric', 1),
  ('ceramic_glass', 'سيراميك / زجاج', 'Ceramic / Glass', 2),
  ('induction', 'إنداكشن', 'Induction', 3),
  ('oven', 'فرن', 'Oven', 4)) v(code, ar, en, sort)
 where d.code = 'heat_source' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'heated_surface_material_or_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ceramic', 'سيراميك', 'Ceramic', 0),
  ('tourmaline', 'تورمالين', 'Tourmaline', 1),
  ('ceramic_tourmaline', 'سيراميك وتورمالين', 'Ceramic tourmaline', 2),
  ('titanium', 'تيتانيوم', 'Titanium', 3),
  ('aluminum', 'ألومنيوم', 'Aluminum', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'heated_surface_material_or_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'heater_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('oil', 'زيت (رادياتير)', 'Oil-filled radiator', 0),
  ('fan', 'مروحة هواء ساخن', 'Fan heater', 1),
  ('halogen', 'هالوجين', 'Halogen', 2),
  ('quartz', 'كوارتز (شمعات)', 'Quartz', 3),
  ('ceramic', 'سيراميك PTC', 'Ceramic PTC', 4),
  ('carbon_infrared', 'كربون / أشعة تحت حمراء', 'Carbon / infrared', 5),
  ('convector', 'كونفكتور', 'Convector', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'heater_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'heating_function' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون تسخين', 'No heat', 0),
  ('single', 'تسخين بدرجة واحدة', 'Single heat level', 1),
  ('adjustable', 'تسخين بأكثر من درجة', 'Adjustable heat levels', 2),
  ('hot_cold', 'ساخن وبارد', 'Hot and cold', 3)) v(code, ar, en, sort)
 where d.code = 'heating_function' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'heating_required' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('heater', 'يحتاج سخان', 'Needs heater', 0),
  ('microwave', 'يسخن في الميكروويف', 'Microwave', 1),
  ('hand_warm', 'يدفى بين الإيدين', 'Warm between hands', 2),
  ('cold', 'بارد بدون تسخين', 'No heating (cold)', 3)) v(code, ar, en, sort)
 where d.code = 'heating_required' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'heel_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stiletto', 'كعب رفيع (ستيليتو)', 'Stiletto', 0),
  ('block', 'كعب عريض (بلوك)', 'Block Heel', 1),
  ('kitten', 'كعب قصير رفيع (كيتن)', 'Kitten Heel', 2),
  ('wedge', 'كعب ويدج', 'Wedge', 3),
  ('platform', 'بلاتفورم', 'Platform', 4),
  ('cone', 'كعب مخروطي', 'Cone Heel', 5),
  ('flared', 'كعب مفرود (فلير)', 'Flared Heel', 6),
  ('transparent', 'كعب شفاف', 'Clear / Perspex Heel', 7),
  ('sculptural', 'كعب بتصميم فني', 'Sculptural Heel', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'heel_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'helmet_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_face', 'فول فيس (مقفولة)', 'Full face', 0),
  ('modular', 'قلاب (موديولار)', 'Modular / flip-up', 1),
  ('open_face', 'مفتوحة 3/4', 'Open face (3/4)', 2),
  ('half', 'نص خوذة', 'Half helmet', 3),
  ('motocross', 'موتوكروس (أوف رود)', 'Motocross / off-road', 4),
  ('dual_sport', 'أدفنشر (ديوال سبورت)', 'Dual sport / adventure', 5),
  ('kids', 'أطفال', 'Kids', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'helmet_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hob_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gas', 'غاز', 'Gas', 0),
  ('gas_on_glass', 'غاز على زجاج', 'Gas on glass', 1),
  ('ceramic', 'كهرباء سيراميك', 'Ceramic electric', 2),
  ('induction', 'إنداكشن', 'Induction', 3),
  ('hot_plate', 'سخان كهرباء عادي', 'Electric hot plate', 4),
  ('mixed', 'مختلط (غاز + كهرباء)', 'Mixed (gas + electric)', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'hob_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'hold_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('light', 'خفيف', 'Light', 0),
  ('flexible', 'مرن', 'Flexible', 1),
  ('medium', 'متوسط', 'Medium', 2),
  ('strong', 'قوي', 'Strong', 3),
  ('extra_strong', 'قوي جداً', 'Extra strong', 4)) v(code, ar, en, sort)
 where d.code = 'hold_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'honey_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clover', 'عسل برسيم', 'Clover', 0),
  ('citrus', 'عسل موالح', 'Citrus blossom', 1),
  ('cotton', 'عسل قطن', 'Cotton', 2),
  ('wildflower', 'عسل زهور برية', 'Wildflower / multifloral', 3),
  ('sidr', 'عسل سدر', 'Sidr', 4),
  ('black_seed', 'عسل حبة البركة', 'Black seed', 5),
  ('eucalyptus', 'عسل كافور', 'Eucalyptus', 6),
  ('mountain', 'عسل جبلي', 'Mountain', 7),
  ('manuka', 'عسل مانوكا', 'Manuka', 8),
  ('honeycomb', 'عسل بالشمع', 'Honeycomb', 9),
  ('royal_jelly_mix', 'عسل بغذاء الملكات', 'With royal jelly', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'honey_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'نوع الشفاط' where code = 'hood_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('chimney', 'مدخنة حائط', 'Chimney (wall)', 0),
  ('angled', 'مائل', 'Angled', 1),
  ('flat', 'مسطح تحت الدولاب', 'Flat / Under-cabinet', 2),
  ('built_in', 'بلت إن', 'Built-in', 3),
  ('telescopic', 'تليسكوبي (سحاب)', 'Telescopic / Slide-out', 4),
  ('island', 'جزيرة (سقف)', 'Island', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'hood_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'humidification_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ultrasonic', 'بخار بارد (ألتراسونيك)', 'Ultrasonic cool mist', 0),
  ('evaporative', 'تبخيري', 'Evaporative', 1),
  ('warm_mist', 'بخار دافئ', 'Warm mist / steam', 2),
  ('hybrid', 'هجين (بارد ودافئ)', 'Hybrid (cool and warm)', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'humidification_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'image_stabilization' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون مثبت', 'None', 0),
  ('optical', 'مثبت بصري (OIS / VR / IS)', 'Optical', 1)) v(code, ar, en, sort)
 where d.code = 'image_stabilization' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'in_body_image_stabilization' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('axis_3', '3 محاور', '3-axis', 1),
  ('axis_5', '5 محاور', '5-axis', 2)) v(code, ar, en, sort)
 where d.code = 'in_body_image_stabilization' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'in_shell_or_shelled' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('in_shell', 'بالقشر', 'In shell', 0),
  ('shelled', 'مقشرة', 'Shelled', 1),
  ('mixed', 'مخلوط', 'Mixed', 2)) v(code, ar, en, sort)
 where d.code = 'in_shell_or_shelled' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'incline_adjustment_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون ميل', 'No incline', 0),
  ('manual', 'ميل يدوي', 'Manual', 1),
  ('electric', 'ميل كهربائي (أوتوماتيك)', 'Electric / automatic', 2)) v(code, ar, en, sort)
 where d.code = 'incline_adjustment_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'included_accessories' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mixing_bowl', 'بولة خلط', 'Mixing bowl', 0),
  ('tint_brush', 'فرشاة صبغة', 'Tint brush', 1),
  ('gloves', 'جوانتي', 'Gloves', 2),
  ('cape', 'كاب', 'Cape', 3),
  ('comb', 'مشط', 'Comb', 4),
  ('clips', 'مشابك', 'Clips', 5),
  ('ear_covers', 'غطاء أذن', 'Ear covers', 6),
  ('compressor', 'كمبروسر', 'Compressor', 7),
  ('airbrush_gun', 'مسدس إيربراش', 'Airbrush gun', 8),
  ('hose', 'خرطوم', 'Hose', 9),
  ('makeup_bottles', 'عبوات مكياج', 'Makeup bottles', 10),
  ('cleaning_kit', 'أدوات تنظيف', 'Cleaning kit', 11),
  ('power_adapter', 'أداپتر كهرباء', 'Power adapter', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'included_accessories' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'included_batteries' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('not_required', 'لا تحتاج بطاريات', 'No Batteries Required', 0),
  ('included', 'البطاريات مرفقة', 'Batteries Included', 1),
  ('not_included', 'تحتاج بطاريات (غير مرفقة)', 'Batteries Required, Not Included', 2),
  ('rechargeable_built_in', 'بطارية مدمجة قابلة للشحن', 'Built-in Rechargeable Battery', 3),
  ('demo_only', 'بطاريات تجريبية مرفقة', 'Demo Batteries Included', 4)) v(code, ar, en, sort)
 where d.code = 'included_batteries' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'included_breast_shield_sizes' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mm_17', '17 مم', '17 mm', 0),
  ('mm_19', '19 مم', '19 mm', 1),
  ('mm_21', '21 مم', '21 mm', 2),
  ('mm_24', '24 مم', '24 mm', 3),
  ('mm_25', '25 مم', '25 mm', 4),
  ('mm_27', '27 مم', '27 mm', 5),
  ('mm_28', '28 مم', '28 mm', 6),
  ('mm_30', '30 مم', '30 mm', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'included_breast_shield_sizes' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'included_drive_capacity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون هارد', 'No Drive', 0),
  ('gb_500', '500 جيجا', '500 GB', 1),
  ('tb_1', '1 تيرا', '1 TB', 2),
  ('tb_2', '2 تيرا', '2 TB', 3),
  ('tb_4', '4 تيرا', '4 TB', 4),
  ('tb_6', '6 تيرا', '6 TB', 5),
  ('tb_8', '8 تيرا', '8 TB', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'included_drive_capacity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'included_tool_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('detail_brush', 'فرشاة تفاصيل', 'Detail brush', 0),
  ('striper', 'فرشاة خطوط', 'Striper', 1),
  ('flat_brush', 'فرشاة مسطحة', 'Flat brush', 2),
  ('fan_brush', 'فرشاة مروحة', 'Fan brush', 3),
  ('dotting', 'أداة تنقيط', 'Dotting tool', 4),
  ('sponge', 'إسفنجة تدرج', 'Gradient sponge', 5),
  ('tweezers', 'ملقاط', 'Tweezers', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'included_tool_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'included_treatment_heads' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('body', 'رأس للجسم', 'Body', 0),
  ('face', 'رأس للوجه', 'Face', 1),
  ('precision', 'رأس دقيق', 'Precision', 2),
  ('bikini', 'رأس للبكيني', 'Bikini', 3),
  ('underarm', 'رأس للإبط', 'Underarm', 4),
  ('skin_rejuvenation', 'رأس تجديد البشرة', 'Skin rejuvenation', 5),
  ('acne', 'رأس للحبوب', 'Acne', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'included_treatment_heads' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'indoor_or_outdoor_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('indoor', 'داخلي', 'Indoor', 0),
  ('outdoor', 'خارجي', 'Outdoor', 1),
  ('both', 'داخلي وخارجي', 'Indoor and Outdoor', 2)) v(code, ar, en, sort)
 where d.code = 'indoor_or_outdoor_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'infant_support_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('sling', 'شبكة / مسند قماش', 'Newborn Sling', 1),
  ('foam_insert', 'مسند إسفنج', 'Foam Insert', 2),
  ('built_in_seat', 'مسند مدمج', 'Built-in Support', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'infant_support_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'ingress_protection_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون حماية', 'None', 0),
  ('ipx4', 'IPX4 (رذاذ)', 'IPX4', 1),
  ('ipx5', 'IPX5', 'IPX5', 2),
  ('ipx6', 'IPX6', 'IPX6', 3),
  ('ipx7', 'IPX7 (غمر مؤقت)', 'IPX7', 4),
  ('ip65', 'IP65', 'IP65', 5),
  ('ip66', 'IP66 (خارجي)', 'IP66', 6),
  ('ip67', 'IP67', 'IP67', 7),
  ('ip68', 'IP68', 'IP68', 8)) v(code, ar, en, sort)
 where d.code = 'ingress_protection_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'ink_color' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('blue', 'أزرق', 'Blue', 0),
  ('black', 'أسود', 'Black', 1),
  ('red', 'أحمر', 'Red', 2),
  ('green', 'أخضر', 'Green', 3),
  ('yellow', 'أصفر', 'Yellow', 4),
  ('pink', 'وردي', 'Pink', 5),
  ('orange', 'برتقالي', 'Orange', 6),
  ('purple', 'بنفسجي', 'Purple', 7),
  ('light_blue', 'لبني', 'Light Blue', 8),
  ('gold_silver', 'ذهبي / فضي', 'Gold / Silver', 9),
  ('white', 'أبيض', 'White', 10),
  ('pastel', 'ألوان باستيل', 'Pastel Colors', 11),
  ('multicolor', 'ألوان متعددة (طقم)', 'Multicolor Set', 12)) v(code, ar, en, sort)
 where d.code = 'ink_color' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'ink_or_toner_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ink_cartridge', 'خرطوشة حبر', 'Ink cartridge', 0),
  ('ink_bottle', 'زجاجة حبر (Ink Tank)', 'Ink bottle (ink tank)', 1),
  ('toner', 'تونر ليزر', 'Laser toner', 2),
  ('drum', 'درام', 'Drum unit', 3),
  ('ribbon', 'شريط حبر', 'Ribbon', 4),
  ('thermal', 'ورق حراري (بدون حبر)', 'Thermal (inkless)', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'ink_or_toner_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'inner_liner_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ss304', 'ستانلس ستيل 304', 'Stainless steel 304', 0),
  ('ss316', 'ستانلس ستيل 316', 'Stainless steel 316', 1),
  ('glass', 'زجاج', 'Glass', 2),
  ('ceramic', 'مبطن سيراميك', 'Ceramic coated', 3),
  ('copper', 'مبطن نحاس', 'Copper coated', 4),
  ('plastic', 'بلاستيك', 'Plastic', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'inner_liner_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'inner_pot_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('non_stick', 'تيفال (غير لاصق)', 'Non-stick (PTFE)', 0),
  ('ceramic', 'سيراميك', 'Ceramic', 1),
  ('granite', 'جرانيت', 'Granite', 2),
  ('stainless_steel', 'ستانلس ستيل بدون طلاء', 'Uncoated Stainless Steel', 3),
  ('aluminum', 'ألومنيوم بدون طلاء', 'Uncoated Aluminum', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'inner_pot_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'input_plug_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('type_c_eu', 'أوروبي رفيع (Type C)', 'European (Type C)', 0),
  ('type_f_schuko', 'أوروبي بأرضي (Type F / Schuko)', 'Schuko (Type F)', 1),
  ('type_g_uk', 'إنجليزي 3 سنون (Type G)', 'UK (Type G)', 2),
  ('type_a_b_us', 'أمريكي (Type A/B)', 'US (Type A/B)', 3),
  ('type_i_au', 'أسترالي (Type I)', 'Australian (Type I)', 4),
  ('universal', 'متعدد (يتبدل)', 'Interchangeable / universal', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'input_plug_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'installation_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('isofix', 'ISOFIX', 'ISOFIX', 0),
  ('isofix_top_tether', 'ISOFIX + حزام علوي', 'ISOFIX + top tether', 1),
  ('isofix_support_leg', 'ISOFIX + رجل دعم', 'ISOFIX + support leg', 2),
  ('vehicle_belt', 'بحزام العربية', 'Vehicle seat belt', 3),
  ('latch', 'LATCH', 'LATCH', 4),
  ('base', 'بقاعدة منفصلة', 'Separate base', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'installation_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'installation_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('countertop', 'على الرخامة / حر', 'Countertop / Freestanding', 0),
  ('under_sink', 'تحت الحوض', 'Under Sink', 1),
  ('faucet_mount', 'على الحنفية', 'Faucet Mount', 2),
  ('wall_mounted', 'تعليق على الحائط', 'Wall Mounted', 3),
  ('whole_house', 'مدخل المياه الرئيسي (للبيت كله)', 'Whole House / Point of Entry', 4),
  ('built_in', 'بلت إن (مدمج)', 'Built-in', 5),
  ('over_the_range', 'فوق البوتاجاز', 'Over-the-range', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'installation_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'instrument_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('acoustic', 'أكوستيك', 'Acoustic', 0),
  ('electric', 'كهربائي', 'Electric', 1),
  ('electro_acoustic', 'إلكترو أكوستيك', 'Electro-acoustic', 2),
  ('digital', 'ديجيتال', 'Digital', 3),
  ('silent', 'صامت (سايلنت)', 'Silent', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'instrument_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'insulated' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير معزولة (طبقة واحدة)', 'Not insulated (single wall)', 0),
  ('double_wall_vacuum', 'معزولة طبقتين فاكيوم', 'Double-wall vacuum', 1),
  ('triple_wall', 'معزولة 3 طبقات', 'Triple-wall', 2),
  ('foam', 'عزل فوم', 'Foam insulated', 3)) v(code, ar, en, sort)
 where d.code = 'insulated' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'insulated_lining' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون عزل', 'None', 0),
  ('foil', 'ألومنيوم فويل', 'Aluminum Foil', 1),
  ('thermal_foam', 'إسفنج حراري', 'Thermal Foam', 2),
  ('peva', 'PEVA مانع للتسريب', 'PEVA Leakproof', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'insulated_lining' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'integrated_graphics' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('intel_uhd', 'Intel UHD Graphics', 'Intel UHD Graphics', 0),
  ('intel_iris_xe', 'Intel Iris Xe', 'Intel Iris Xe', 1),
  ('intel_arc', 'Intel Arc Graphics', 'Intel Arc Graphics', 2),
  ('amd_radeon', 'AMD Radeon Graphics', 'AMD Radeon Graphics', 3),
  ('amd_radeon_vega', 'AMD Radeon Vega', 'AMD Radeon Vega', 4),
  ('amd_radeon_7xxm', 'AMD Radeon 700M (780M/760M)', 'AMD Radeon 700M series', 5),
  ('none', 'بدون رسوميات مدمجة (يحتاج كارت شاشة)', 'None (dedicated GPU required)', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'integrated_graphics' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'intended_areas' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('head', 'شعر الرأس', 'Head hair', 0),
  ('beard', 'اللحية', 'Beard', 1),
  ('mustache', 'الشارب', 'Mustache', 2),
  ('sideburns', 'السوالف', 'Sideburns', 3),
  ('nose', 'الأنف', 'Nose', 4),
  ('ears', 'الأذن', 'Ears', 5),
  ('eyebrows', 'الحواجب', 'Eyebrows', 6),
  ('body', 'الجسم', 'Body', 7),
  ('bikini', 'المناطق الحساسة', 'Bikini / intimate', 8)) v(code, ar, en, sort)
 where d.code = 'intended_areas' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'intended_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cutting', 'قص الشعر', 'Haircutting', 0),
  ('coloring', 'صبغ الشعر', 'Coloring', 1),
  ('shampoo', 'غسيل الشعر', 'Shampooing', 2),
  ('foundation', 'كريم أساس', 'Foundation', 3),
  ('concealer', 'كونسيلر', 'Concealer', 4),
  ('powder', 'بودرة', 'Powder', 5),
  ('contour', 'كونتور', 'Contour', 6),
  ('blending', 'دمج', 'Blending', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'intended_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'interior_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('granite', 'جرانيت', 'Granite', 0),
  ('ptfe', 'تيفلون (تيفال)', 'Teflon / PTFE', 1),
  ('ceramic', 'سيراميك', 'Ceramic', 2),
  ('marble', 'رخامي', 'Marble coating', 3),
  ('titanium', 'تيتانيوم', 'Titanium', 4),
  ('diamond', 'ألماس', 'Diamond', 5),
  ('enamel', 'صاج مطلي (إنامل)', 'Enamel', 6),
  ('stainless_uncoated', 'ستانلس بدون طلاء', 'Uncoated stainless', 7),
  ('aluminum_uncoated', 'ألومنيوم بدون طلاء', 'Uncoated aluminum', 8),
  ('cast_iron', 'زهر', 'Cast iron', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'interior_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'internal_or_external' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('internal', 'داخلي', 'Internal', 0),
  ('external_portable', 'خارجي محمول', 'External portable', 1),
  ('external_desktop', 'خارجي مكتبي (بمصدر كهرباء)', 'External desktop', 2)) v(code, ar, en, sort)
 where d.code = 'internal_or_external' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'inverter_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'بدون إنفرتر', 'No inverter', 0),
  ('inverter', 'موتور إنفرتر', 'Inverter motor', 1),
  ('direct_drive', 'إنفرتر دايركت درايف', 'Inverter direct drive', 2)) v(code, ar, en, sort)
 where d.code = 'inverter_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'ionic_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ionic', 'أيونات سالبة', 'Ionic', 0),
  ('nano_ionic', 'نانو أيون', 'Nano ionic', 1),
  ('ionic_tourmaline', 'أيونات مع تورمالين', 'Ionic with tourmaline', 2),
  ('none', 'بدون أيونات', 'None', 3)) v(code, ar, en, sort)
 where d.code = 'ionic_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'iron_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('steam', 'مكواة بخار', 'Steam Iron', 0),
  ('dry', 'مكواة جاف', 'Dry Iron', 1),
  ('steam_generator', 'مكواة بخزان (ستيم جينيريتور)', 'Steam Generator Iron', 2),
  ('cordless', 'مكواة لاسلكية', 'Cordless Iron', 3),
  ('travel', 'مكواة سفر', 'Travel Iron', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'iron_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'jaw_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('chrome_vanadium', 'كروم فاناديوم', 'Chrome vanadium', 0),
  ('carbon_steel', 'صلب كربوني', 'Carbon steel', 1),
  ('chrome_molybdenum', 'كروم موليبدينوم', 'Chrome molybdenum', 2),
  ('stainless', 'ستانلس ستيل', 'Stainless steel', 3),
  ('nickel_chrome', 'نيكل كروم', 'Nickel chrome', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'jaw_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'juicing_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('centrifugal', 'طرد مركزي (سريعة)', 'Centrifugal', 0),
  ('slow_masticating', 'عصر بطيء (سلو جوسر)', 'Slow Masticating', 1),
  ('citrus_press', 'عصارة موالح', 'Citrus Press', 2),
  ('twin_gear', 'ترس مزدوج', 'Twin Gear', 3),
  ('manual', 'يدوية', 'Manual', 4)) v(code, ar, en, sort)
 where d.code = 'juicing_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'kettle_body_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 0),
  ('glass', 'زجاج', 'Glass', 1),
  ('plastic', 'بلاستيك', 'Plastic', 2),
  ('double_wall', 'جدار مزدوج (ستانلس + بلاستيك)', 'Double Wall', 3),
  ('ceramic', 'سيراميك', 'Ceramic', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'kettle_body_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'key_switch_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mechanical', 'ميكانيكي', 'Mechanical', 0),
  ('membrane', 'ممبرين (عادي)', 'Membrane', 1),
  ('mecha_membrane', 'شبه ميكانيكي (Mecha-Membrane)', 'Mecha-membrane hybrid', 2),
  ('scissor', 'سيزور (مفاتيح رفيعة)', 'Scissor', 3),
  ('optical', 'أوبتيكال', 'Optical', 4),
  ('magnetic', 'مغناطيسي (Hall Effect)', 'Magnetic (Hall Effect)', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'key_switch_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'keyboard_form_factor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_size', 'كامل (100%)', 'Full size (100%)', 0),
  ('tkl', 'بدون أرقام TKL (80%)', 'Tenkeyless (80%)', 1),
  ('pct_96', '96%', '96%', 2),
  ('pct_75', '75%', '75%', 3),
  ('pct_65', '65%', '65%', 4),
  ('pct_60', '60%', '60%', 5),
  ('compact', 'صغير (ميني)', 'Compact / Mini', 6),
  ('numpad', 'لوحة أرقام فقط', 'Numpad only', 7),
  ('split', 'منقسم (Ergonomic)', 'Split / Ergonomic', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'keyboard_form_factor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'keyboard_language' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('arabic_english', 'عربي / إنجليزي', 'Arabic / English', 0),
  ('english', 'إنجليزي فقط', 'English only', 1),
  ('french_arabic', 'فرنسي / عربي', 'French / Arabic', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'keyboard_language' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'keyboard_layout_and_language' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('arabic_english_us', 'عربي / إنجليزي (US)', 'Arabic / English (US layout)', 0),
  ('english_us', 'إنجليزي US', 'English (US)', 1),
  ('arabic_english_uk', 'عربي / إنجليزي (UK)', 'Arabic / English (UK layout)', 2),
  ('english_uk', 'إنجليزي UK', 'English (UK)', 3),
  ('french_arabic_azerty', 'فرنسي / عربي (AZERTY)', 'French / Arabic (AZERTY)', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'keyboard_layout_and_language' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'labelled_as_concentrated' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير مركز', 'Not concentrated', 0),
  ('concentrated', 'مركز', 'Concentrated', 1),
  ('ultra', 'مركز جداً (ألترا)', 'Ultra concentrated', 2)) v(code, ar, en, sort)
 where d.code = 'labelled_as_concentrated' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'labelled_as_iodized' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'مدعم باليود', 'Iodized', 0),
  ('no', 'غير مدعم باليود', 'Not iodized', 1)) v(code, ar, en, sort)
 where d.code = 'labelled_as_iodized' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'labelled_fragrance_free' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fragrance_free', 'خالي من العطر', 'Fragrance-free', 0),
  ('lightly_scented', 'رائحة خفيفة', 'Lightly scented', 1),
  ('scented', 'معطر', 'Scented', 2)) v(code, ar, en, sort)
 where d.code = 'labelled_fragrance_free' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'labelled_microwave_suitability' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'مناسب للميكروويف', 'Microwave safe', 0),
  ('no', 'غير مناسب للميكروويف', 'Not microwave safe', 1)) v(code, ar, en, sort)
 where d.code = 'labelled_microwave_suitability' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'labelled_sugar_claim' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no_added_sugar', 'بدون سكر مضاف', 'No added sugar', 0),
  ('sugar_free', 'خالي من السكر (دايت)', 'Sugar free / diet', 1),
  ('reduced_sugar', 'قليل السكر (لايت)', 'Reduced sugar / light', 2),
  ('added_sugar', 'بسكر مضاف', 'Contains added sugar', 3),
  ('no_claim', 'لا يوجد بيان', 'No claim on pack', 4)) v(code, ar, en, sort)
 where d.code = 'labelled_sugar_claim' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'language' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('arabic', 'عربي', 'Arabic', 0),
  ('english', 'إنجليزي', 'English', 1),
  ('french', 'فرنساوي', 'French', 2),
  ('german', 'ألماني', 'German', 3),
  ('italian', 'إيطالي', 'Italian', 4),
  ('spanish', 'إسباني', 'Spanish', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'language' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lash_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('faux_mink', 'منك صناعي', 'Faux mink', 0),
  ('mink', 'منك طبيعي', 'Mink', 1),
  ('silk', 'حرير', 'Silk', 2),
  ('synthetic', 'ألياف صناعية', 'Synthetic', 3),
  ('human_hair', 'شعر طبيعي', 'Human hair', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'lash_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lash_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_strip', 'شريط كامل', 'Full strip', 0),
  ('half_strip', 'نص شريط', 'Half strip', 1),
  ('cluster', 'خصل', 'Cluster', 2),
  ('individual', 'فردي', 'Individual', 3),
  ('magnetic', 'مغناطيس', 'Magnetic', 4),
  ('bottom', 'رموش سفلية', 'Bottom lashes', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'lash_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'leakproof' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير مانع للتسرب', 'Not leakproof', 0),
  ('leak_resistant', 'مقاوم للتسرب', 'Leak-resistant', 1),
  ('leakproof', 'مانع للتسرب تماماً', 'Fully leakproof', 2),
  ('airtight', 'محكم الغلق ضد الهواء والتسرب', 'Airtight & leakproof', 3)) v(code, ar, en, sort)
 where d.code = 'leakproof' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'length_style' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('crop', 'قصير جدا (كروب)', 'Crop', 0),
  ('hip', 'لحد الوسط / الهانش', 'Hip Length', 1),
  ('thigh', 'لنص الفخذ', 'Mid-thigh', 2),
  ('above_knee', 'فوق الركبة', 'Above Knee', 3),
  ('knee', 'لحد الركبة', 'Knee Length', 4),
  ('capri', 'كابري (3/4)', 'Capri (3/4)', 5),
  ('midi', 'ميدي (نص الساق)', 'Midi', 6),
  ('ankle', 'لحد الكاحل', 'Ankle Length', 7),
  ('maxi', 'ماكسي (طويل للأرض)', 'Maxi / Floor Length', 8),
  ('full_length', 'طول كامل', 'Full Length', 9),
  ('high_low', 'قدام قصير وورا طويل', 'High-low', 10)) v(code, ar, en, sort)
 where d.code = 'length_style' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lens_color' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('black_smoke', 'أسود / سموكي', 'Black / Smoke', 0),
  ('gray', 'رمادي', 'Gray', 1),
  ('brown', 'بني', 'Brown', 2),
  ('green', 'أخضر (G15)', 'Green (G15)', 3),
  ('gradient', 'متدرج', 'Gradient', 4),
  ('blue', 'أزرق', 'Blue', 5),
  ('mirror_silver', 'مرايا فضي', 'Silver Mirror', 6),
  ('mirror_blue', 'مرايا أزرق', 'Blue Mirror', 7),
  ('mirror_gold', 'مرايا ذهبي / برتقالي', 'Gold / Orange Mirror', 8),
  ('mirror_rainbow', 'مرايا ألوان (ريفو)', 'Rainbow / Revo Mirror', 9),
  ('yellow_amber', 'أصفر / عسلي (ليلي)', 'Yellow / Amber', 10),
  ('pink_rose', 'وردي', 'Pink / Rose', 11),
  ('clear', 'شفاف', 'Clear', 12),
  ('photochromic', 'فوتوكروميك (يتغير مع الشمس)', 'Photochromic', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'lens_color' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lens_filter_category' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cat_0', 'فئة 0 (شفافة - بدون تظليل)', 'Category 0 (Clear)', 0),
  ('cat_1', 'فئة 1 (تظليل خفيف)', 'Category 1 (Light Tint)', 1),
  ('cat_2', 'فئة 2 (تظليل متوسط)', 'Category 2 (Medium Tint)', 2),
  ('cat_3', 'فئة 3 (شمس قوية - الأكثر شيوعا)', 'Category 3 (Dark Tint)', 3),
  ('cat_4', 'فئة 4 (شمس شديدة - لا تصلح للقيادة)', 'Category 4 (Very Dark, Not for Driving)', 4)) v(code, ar, en, sort)
 where d.code = 'lens_filter_category' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lens_mount' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('canon_ef', 'Canon EF', 'Canon EF', 0),
  ('canon_ef_s', 'Canon EF-S', 'Canon EF-S', 1),
  ('canon_rf', 'Canon RF', 'Canon RF', 2),
  ('canon_ef_m', 'Canon EF-M', 'Canon EF-M', 3),
  ('nikon_f', 'Nikon F', 'Nikon F', 4),
  ('nikon_z', 'Nikon Z', 'Nikon Z', 5),
  ('sony_e', 'Sony E / FE', 'Sony E / FE', 6),
  ('fujifilm_x', 'Fujifilm X', 'Fujifilm X', 7),
  ('fujifilm_g', 'Fujifilm G', 'Fujifilm G', 8),
  ('mft', 'Micro Four Thirds', 'Micro Four Thirds', 9),
  ('l_mount', 'L-Mount', 'L-Mount', 10),
  ('pentax_k', 'Pentax K', 'Pentax K', 11),
  ('fixed', 'عدسة ثابتة', 'Fixed Lens', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'lens_mount' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lens_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clear', 'شفافة', 'Clear', 0),
  ('tinted', 'ملونة / مظللة', 'Tinted', 1),
  ('mirrored', 'مرايا', 'Mirrored', 2),
  ('polarized', 'مستقطبة', 'Polarized', 3),
  ('photochromic', 'فوتوكروميك', 'Photochromic', 4),
  ('prescription', 'طبية (بمقاس نظر)', 'Prescription / Optical', 5)) v(code, ar, en, sort)
 where d.code = 'lens_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('beginner', 'مبتدئ', 'Beginner', 0),
  ('intermediate', 'متوسط', 'Intermediate', 1),
  ('advanced', 'متقدم / محترف', 'Advanced / Pro', 2),
  ('all_levels', 'كل المستويات', 'All levels', 3)) v(code, ar, en, sort)
 where d.code = 'level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lid_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'بدون غطاء', 'No lid', 0),
  ('glass', 'غطاء زجاج', 'Glass lid', 1),
  ('metal', 'غطاء معدن', 'Metal lid', 2),
  ('plastic', 'غطاء بلاستيك', 'Plastic lid', 3),
  ('silicone', 'غطاء سيليكون', 'Silicone lid', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'lid_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lid_opening_mechanism' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pedal', 'دواسة', 'Pedal', 0),
  ('push_button', 'زر ضغط', 'Push button', 1),
  ('swing', 'غطاء مرجيحة', 'Swing lid', 2),
  ('flip', 'غطاء قلاب', 'Flip lid', 3),
  ('sensor', 'حساس بدون لمس', 'Touchless sensor', 4),
  ('butterfly', 'غطاء فراشة', 'Butterfly lid', 5),
  ('no_lid', 'بدون غطاء', 'Open (no lid)', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'lid_opening_mechanism' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lid_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('screw', 'غطاء قلاووظ', 'Screw cap', 0),
  ('flip', 'غطاء قلاب', 'Flip lid', 1),
  ('straw', 'غطاء بشفاطة', 'Straw lid', 2),
  ('sport', 'غطاء رياضي (بوش)', 'Sport / Push-pull cap', 3),
  ('snap_lock', 'غطاء بكلبسات (4 جوانب)', 'Snap-lock clips', 4),
  ('press_fit', 'غطاء ضغط', 'Press-fit', 5),
  ('vacuum_valve', 'غطاء بصمام فاكيوم', 'Vacuum valve', 6),
  ('bamboo', 'غطاء بامبو', 'Bamboo lid', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'lid_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'light_color_or_color_mode' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('warm_white', 'أبيض دافي (وورم)', 'Warm white', 0),
  ('natural_white', 'أبيض طبيعي', 'Natural white', 1),
  ('cool_white', 'أبيض بارد (ديلايت)', 'Cool white / daylight', 2),
  ('tunable_white', 'أبيض متغير (CCT)', 'Tunable white (CCT)', 3),
  ('single_color', 'لون واحد (أحمر/أزرق/أخضر...)', 'Single color', 4),
  ('rgb', 'RGB ملون', 'RGB', 5),
  ('rgbw', 'RGBW (ملون + أبيض)', 'RGBW', 6),
  ('rgbic', 'RGBIC (ألوان متحركة)', 'RGBIC', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'light_color_or_color_mode' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'light_filtering_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sheer', 'شفاف (تل / شيفون)', 'Sheer', 0),
  ('light_filtering', 'يخفف الضوء', 'Light filtering', 1),
  ('room_darkening', 'تعتيم جزئي', 'Room darkening', 2),
  ('blackout', 'بلاك أوت (تعتيم كامل)', 'Blackout', 3)) v(code, ar, en, sort)
 where d.code = 'light_filtering_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'light_source_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('led', 'LED', 'LED', 0),
  ('uv_led', 'UV/LED', 'UV/LED', 1),
  ('uv', 'UV', 'UV', 2),
  ('led_filament', 'فتيلة LED', 'LED filament', 3),
  ('fluorescent', 'موفر (فلورسنت)', 'Fluorescent / CFL', 4),
  ('halogen', 'هالوجين', 'Halogen', 5),
  ('incandescent', 'لمبة عادية (تنجستن)', 'Incandescent', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'light_source_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'lighting_application' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('low_beam', 'نور واطي', 'Low beam', 0),
  ('high_beam', 'نور عالي', 'High beam', 1),
  ('fog', 'ضباب', 'Fog light', 2),
  ('turn_signal', 'إشارة (فلاشر)', 'Turn signal', 3),
  ('brake_tail', 'فرامل / خلفي', 'Brake / tail light', 4),
  ('reverse', 'نور الرجوع', 'Reverse light', 5),
  ('parking', 'نور ركن (جانبي)', 'Parking / side light', 6),
  ('drl', 'نهاري DRL', 'Daytime running light', 7),
  ('interior', 'إضاءة داخلية (صالون)', 'Interior', 8),
  ('license_plate', 'نور النمرة', 'License plate', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'lighting_application' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lighting_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('halogen', 'هالوجين', 'Halogen', 0),
  ('led', 'LED', 'LED', 1),
  ('xenon', 'زينون HID', 'Xenon HID', 2),
  ('incandescent', 'عادي (فتيلة)', 'Incandescent', 3),
  ('laser', 'ليزر', 'Laser', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'lighting_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lined' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unlined', 'بدون بطانة', 'Unlined', 0),
  ('partially_lined', 'مبطن جزئيا', 'Partially Lined', 1),
  ('fully_lined', 'مبطن بالكامل', 'Fully Lined', 2),
  ('fleece_thermal', 'مبطن فرو / حراري', 'Fleece / Thermal Lined', 3)) v(code, ar, en, sort)
 where d.code = 'lined' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lining_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unlined', 'بدون بطانة', 'Unlined', 0),
  ('polyester', 'بوليستر', 'Polyester', 1),
  ('nylon', 'نايلون', 'Nylon', 2),
  ('cotton', 'قطن', 'Cotton', 3),
  ('satin', 'ساتان', 'Satin', 4),
  ('velvet', 'قطيفة', 'Velvet', 5),
  ('suede', 'شامواه', 'Suede', 6),
  ('genuine_leather', 'جلد طبيعي', 'Genuine Leather', 7),
  ('faux_leather', 'جلد صناعي', 'Faux Leather', 8),
  ('canvas', 'كانفاس', 'Canvas', 9),
  ('microfiber', 'مايكروفايبر', 'Microfiber', 10),
  ('insulated', 'بطانة عازلة (فويل)', 'Insulated Foil', 11),
  ('waterproof', 'ضد الماء (PEVA)', 'Waterproof (PEVA)', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'lining_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'loading_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front', 'تحميل أمامي', 'Front load', 0),
  ('top', 'تحميل علوي', 'Top load', 1),
  ('twin_tub', 'حوضين (نص أوتوماتيك)', 'Twin tub (semi-automatic)', 2)) v(code, ar, en, sort)
 where d.code = 'loading_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lock_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون قفل', 'None', 0),
  ('combination', 'قفل أرقام', 'Combination', 1),
  ('tsa_combination', 'قفل أرقام TSA', 'TSA Combination', 2),
  ('key', 'بمفتاح', 'Key', 3),
  ('fingerprint', 'بصمة', 'Fingerprint', 4),
  ('magnetic', 'مغناطيسي', 'Magnetic', 5),
  ('latch', 'مزلاج / ضغط', 'Latch / Push Button', 6),
  ('strap_adhesive', 'حزام لاصق', 'Adhesive Strap', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'lock_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'low_water_shut_off' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'low_water_shut_off' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'lumbar_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('built_in', 'مدمج ثابت', 'Built-in fixed', 1),
  ('adjustable', 'قابل للتعديل', 'Adjustable', 2),
  ('separate_cushion', 'مخدة منفصلة', 'Separate cushion', 3)) v(code, ar, en, sort)
 where d.code = 'lumbar_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'machine_washable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم، في الغسالة', 'Yes, machine washable', 0),
  ('gentle', 'في الغسالة على برنامج هادئ', 'Gentle cycle only', 1),
  ('cover_only', 'الكفر فقط يتغسل', 'Removable cover only', 2),
  ('hand_wash', 'غسيل يدوي فقط', 'Hand wash only', 3),
  ('dry_clean', 'دراي كلين فقط', 'Dry clean only', 4),
  ('spot_clean', 'تنظيف موضعي فقط', 'Spot clean only', 5)) v(code, ar, en, sort)
 where d.code = 'machine_washable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'main_effect' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('volume', 'تكثيف', 'Volume', 0),
  ('lengthening', 'تطويل', 'Lengthening', 1),
  ('curling', 'رفع وتقويس', 'Curling', 2),
  ('defining', 'فصل وتحديد', 'Defining', 3),
  ('waterproof', 'ضد الماء', 'Waterproof', 4),
  ('growth', 'تقوية وتطويل طبيعي', 'Nourishing / Growth', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'main_effect' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'main_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('detangling', 'فك التشابك', 'Detangling', 0),
  ('blow_drying', 'سشوار (فرشاة دائرية)', 'Blow-drying', 1),
  ('smoothing', 'فرد وتنعيم', 'Smoothing', 2),
  ('volume', 'إعطاء حجم', 'Volume', 3),
  ('teasing', 'نفش', 'Teasing', 4),
  ('styling', 'تصفيف وتقسيم', 'Styling / parting', 5),
  ('curly_hair', 'للشعر الكيرلي', 'Curly hair', 6),
  ('beard', 'للحية', 'Beard', 7),
  ('scalp_massage', 'تدليك فروة الرأس', 'Scalp massage', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'main_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'manufacturer_stated_cooling_suitability' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fridge_and_freezer', 'يدخل الثلاجة والفريزر', 'Fridge and Freezer', 0),
  ('fridge_only', 'يدخل الثلاجة فقط', 'Fridge Only', 1),
  ('not_suitable', 'لا يبرد', 'Not for Cooling', 2)) v(code, ar, en, sort)
 where d.code = 'manufacturer_stated_cooling_suitability' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'manufacturer_stated_microwave_sui_b4b60a' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'manufacturer_stated_microwave_sui_b4b60a' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'manufacturer_stated_pre_sterilization' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'manufacturer_stated_pre_sterilization' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mask_design' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('contoured_3d', 'مجسم 3D', 'Contoured 3D', 0),
  ('flat', 'مسطح', 'Flat', 1),
  ('cooling_gel', 'جل تبريد', 'Cooling Gel', 2),
  ('weighted', 'بثقل', 'Weighted', 3),
  ('heated', 'تسخين', 'Heated', 4),
  ('headphones', 'بسماعات', 'With Headphones', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'mask_design' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mask_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('silicone', 'سيليكون مرن', 'Flexible silicone', 0),
  ('hard_plastic', 'بلاستيك صلب', 'Hard plastic', 1),
  ('other', 'أخرى', 'Other', 2)) v(code, ar, en, sort)
 where d.code = 'mask_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mask_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sheet', 'ماسك ورقي (شيت)', 'Sheet mask', 0),
  ('clay', 'طين', 'Clay', 1),
  ('peel_off', 'تقشير (بيل أوف)', 'Peel-off', 2),
  ('cream', 'كريمي', 'Cream', 3),
  ('gel', 'جل', 'Gel', 4),
  ('sleeping', 'ماسك ليلي', 'Sleeping mask', 5),
  ('hydrogel', 'هيدروجيل', 'Hydrogel', 6),
  ('bubble', 'فقاعات', 'Bubble', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'mask_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'massage_mechanism' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('vibration', 'اهتزاز', 'Vibration', 0),
  ('percussion', 'طرق (مسدس مساج)', 'Percussion', 1),
  ('shiatsu_kneading', 'شياتسو / عجن بكرات', 'Shiatsu kneading nodes', 2),
  ('rolling', 'بكرات دوارة', 'Rolling', 3),
  ('air_compression', 'ضغط هواء', 'Air compression', 4),
  ('ems', 'نبضات كهربائية EMS', 'EMS / microcurrent', 5),
  ('sonic', 'اهتزاز صوتي (سونيك)', 'Sonic', 6),
  ('ultrasonic', 'موجات فوق صوتية', 'Ultrasonic', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'massage_mechanism' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'massage_tip_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('silicone', 'سيليكون', 'Silicone', 0),
  ('plastic', 'بلاستيك', 'Plastic', 1),
  ('rubber', 'مطاط', 'Rubber', 2),
  ('metal', 'معدن', 'Metal', 3),
  ('wood', 'خشب', 'Wood', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'massage_tip_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'massage_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('kneading', 'عجن', 'Kneading', 0),
  ('shiatsu', 'شياتسو', 'Shiatsu', 1),
  ('rolling', 'تدوير', 'Rolling', 2),
  ('tapping', 'طرق', 'Tapping', 3),
  ('vibration', 'اهتزاز', 'Vibration', 4),
  ('air_compression', 'ضغط هواء', 'Air compression', 5),
  ('heat', 'حرارة', 'Heat', 6),
  ('scraping', 'كشط', 'Scraping', 7),
  ('water_bubbles', 'فقاعات / تدليك مائي', 'Water bubbles / jets', 8),
  ('acupressure', 'نقاط الضغط', 'Acupressure', 9),
  ('ems', 'نبضات كهربائية EMS', 'EMS', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'massage_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mat_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('polyester_padded', 'قماش بوليستر مبطن', 'Padded Polyester', 0),
  ('cotton', 'قطن', 'Cotton', 1),
  ('plush', 'قطيفة / فرو ناعم', 'Plush / Velvet', 2),
  ('eva_foam', 'إسفنج EVA', 'EVA Foam', 3),
  ('xpe_foam', 'إسفنج XPE ضد الماء', 'XPE Foam (Waterproof)', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'mat_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'material_composition' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('80_20', '80% بوليستر / 20% بولي أميد', '80% Polyester / 20% Polyamide', 0),
  ('70_30', '70% بوليستر / 30% بولي أميد', '70% Polyester / 30% Polyamide', 1),
  ('100_polyester', '100% بوليستر', '100% Polyester', 2),
  ('coral_fleece', 'كورال فليس', 'Coral Fleece', 3),
  ('bamboo', 'ألياف بامبو', 'Bamboo Fiber', 4),
  ('cotton_blend', 'قطن مخلوط', 'Cotton Blend', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'material_composition' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mattress_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'mattress_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mattress_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bonnell_spring', 'سوست عادية (بونيل)', 'Bonnell spring', 0),
  ('pocket_spring', 'سوست منفصلة (بوكيت)', 'Pocket spring', 1),
  ('medical', 'طبية', 'Medical / orthopedic', 2),
  ('foam', 'فوم (سفنج)', 'Foam', 3),
  ('memory_foam', 'ميموري فوم', 'Memory foam', 4),
  ('latex', 'لاتكس', 'Latex', 5),
  ('hybrid', 'هايبرد (سوست + فوم)', 'Hybrid', 6),
  ('cotton', 'قطن', 'Cotton', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'mattress_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'max_paper_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('a4', 'A4', 'A4', 0),
  ('a3', 'A3', 'A3', 1),
  ('a3_plus', 'A3+', 'A3+', 2),
  ('legal', 'Legal', 'Legal', 3),
  ('letter', 'Letter', 'Letter', 4),
  ('a5', 'A5', 'A5', 5),
  ('photo_4x6', 'صور 4×6', 'Photo 4x6', 6),
  ('receipt_roll', 'رول إيصالات', 'Receipt roll', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'max_paper_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'maximum_aperture' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('f095', 'f/0.95', 'f/0.95', 0),
  ('f12', 'f/1.2', 'f/1.2', 1),
  ('f14', 'f/1.4', 'f/1.4', 2),
  ('f18', 'f/1.8', 'f/1.8', 3),
  ('f2', 'f/2', 'f/2', 4),
  ('f28', 'f/2.8', 'f/2.8', 5),
  ('f35', 'f/3.5', 'f/3.5', 6),
  ('f4', 'f/4', 'f/4', 7),
  ('f56', 'f/5.6', 'f/5.6', 8),
  ('variable', 'متغيرة (مثل f/3.5-5.6)', 'Variable (e.g. f/3.5-5.6)', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'maximum_aperture' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'maximum_paper_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('a3', 'A3', 'A3', 0),
  ('a4', 'A4', 'A4', 1),
  ('letter', 'Letter', 'Letter', 2),
  ('legal', 'Legal', 'Legal', 3),
  ('b5', 'B5', 'B5', 4),
  ('a5', 'A5', 'A5', 5),
  ('a6', 'A6', 'A6', 6),
  ('photo', 'صور (4x6)', 'Photo 4x6', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'maximum_paper_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'maximum_recording_resolution' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('p1080', '1080p (2 ميجا)', '1080p (2MP)', 0),
  ('mp3', '3 ميجا', '3MP', 1),
  ('mp4', '4 ميجا', '4MP', 2),
  ('mp5', '5 ميجا', '5MP', 3),
  ('k4', '4K (8 ميجا)', '4K (8MP)', 4),
  ('mp12', '12 ميجا', '12MP', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'maximum_recording_resolution' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'maximum_supported_foot_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('eu42', 'لحد مقاس 42', 'Up to EU 42', 0),
  ('eu44', 'لحد مقاس 44', 'Up to EU 44', 1),
  ('eu46', 'لحد مقاس 46', 'Up to EU 46', 2),
  ('eu48', 'لحد مقاس 48', 'Up to EU 48', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'maximum_supported_foot_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'maximum_video_resolution' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('p720', '720p', '720p', 0),
  ('p1080', '1080p (فل HD)', '1080p Full HD', 1),
  ('k27', '2.7K', '2.7K', 2),
  ('k4', '4K', '4K', 3),
  ('k5_6', '5K / 6K', '5K / 6K', 4),
  ('k8', '8K', '8K', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'maximum_video_resolution' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'measurement_scale_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('metric', 'متري (سم/م)', 'Metric', 0),
  ('imperial', 'إنش/قدم', 'Imperial', 1),
  ('dual', 'متري وإنش', 'Dual metric/imperial', 2)) v(code, ar, en, sort)
 where d.code = 'measurement_scale_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'memory_card_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sd', 'SD', 'SD', 0),
  ('micro_sd', 'microSD', 'microSD', 1),
  ('cfexpress_a', 'CFexpress Type A', 'CFexpress Type A', 2),
  ('cfexpress_b', 'CFexpress Type B', 'CFexpress Type B', 3),
  ('xqd', 'XQD', 'XQD', 4),
  ('cf', 'CompactFlash', 'CompactFlash', 5),
  ('internal', 'ذاكرة داخلية', 'Internal Memory', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'memory_card_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'memory_generation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ddr4', 'DDR4', 'DDR4', 0),
  ('ddr5', 'DDR5', 'DDR5', 1),
  ('ddr3', 'DDR3', 'DDR3', 2),
  ('ddr3l', 'DDR3L', 'DDR3L', 3),
  ('lpddr4x', 'LPDDR4X', 'LPDDR4X', 4),
  ('lpddr5', 'LPDDR5 / LPDDR5X', 'LPDDR5 / LPDDR5X', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'memory_generation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mesh_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('easymesh', 'يدعم Mesh (EasyMesh)', 'Supported (EasyMesh)', 0),
  ('brand_mesh', 'يدعم Mesh الخاص بالشركة', 'Supported (brand mesh system)', 1),
  ('mesh_kit', 'نظام Mesh كامل (أكتر من وحدة)', 'Mesh kit (multi-unit)', 2),
  ('no', 'لا يدعم', 'Not supported', 3)) v(code, ar, en, sort)
 where d.code = 'mesh_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'metal_fineness_or_purity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('k24', 'ذهب عيار 24', '24K Gold', 0),
  ('k21', 'ذهب عيار 21', '21K Gold', 1),
  ('k18', 'ذهب عيار 18', '18K Gold', 2),
  ('k14', 'ذهب عيار 14', '14K Gold', 3),
  ('k9', 'ذهب عيار 9', '9K Gold', 4),
  ('silver_925', 'فضة 925 (استرليني)', '925 Sterling Silver', 5),
  ('silver_900', 'فضة 900', '900 Silver', 6),
  ('silver_800', 'فضة 800', '800 Silver', 7),
  ('silver_999', 'فضة 999 (خالصة)', '999 Fine Silver', 8),
  ('platinum_950', 'بلاتين 950', '950 Platinum', 9),
  ('not_precious', 'معدن غير ثمين (بدون عيار)', 'Non-precious Metal (No Purity)', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'metal_fineness_or_purity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'metal_or_plating_color' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yellow_gold', 'ذهبي أصفر', 'Yellow Gold', 0),
  ('white_gold', 'ذهبي أبيض', 'White Gold', 1),
  ('rose_gold', 'روز جولد', 'Rose Gold', 2),
  ('silver', 'فضي', 'Silver', 3),
  ('black', 'أسود', 'Black', 4),
  ('gunmetal', 'رمادي معدني (جن ميتال)', 'Gunmetal', 5),
  ('bronze', 'برونزي', 'Bronze', 6),
  ('copper', 'نحاسي', 'Copper', 7),
  ('antique', 'عتيق (أنتيك)', 'Antique', 8),
  ('two_tone', 'لونين', 'Two-tone', 9),
  ('multicolor', 'متعدد الألوان', 'Multicolor', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'metal_or_plating_color' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'metal_purity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('k24', 'ذهب عيار 24', '24K Gold', 0),
  ('k21', 'ذهب عيار 21', '21K Gold', 1),
  ('k18', 'ذهب عيار 18', '18K Gold', 2),
  ('k14', 'ذهب عيار 14', '14K Gold', 3),
  ('k9', 'ذهب عيار 9', '9K Gold', 4),
  ('silver_925', 'فضة 925 (استرليني)', '925 Sterling Silver', 5),
  ('silver_900', 'فضة 900', '900 Silver', 6),
  ('silver_800', 'فضة 800', '800 Silver', 7),
  ('silver_999', 'فضة 999 (خالصة)', '999 Fine Silver', 8),
  ('platinum_950', 'بلاتين 950', '950 Platinum', 9),
  ('not_precious', 'معدن غير ثمين (بدون عيار)', 'Non-precious Metal (No Purity)', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'metal_purity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'microphone_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dynamic', 'ديناميك', 'Dynamic', 0),
  ('condenser', 'مكثف (كوندنسر)', 'Condenser', 1),
  ('usb', 'مايك USB', 'USB Microphone', 2),
  ('lavalier_wired', 'مايك كليب سلك (لافالير)', 'Wired Lavalier', 3),
  ('lavalier_wireless', 'مايك كليب لاسلكي', 'Wireless Lavalier', 4),
  ('handheld_wireless', 'مايك يد لاسلكي', 'Wireless Handheld', 5),
  ('shotgun', 'شوتجن (للكاميرا)', 'Shotgun', 6),
  ('ribbon', 'ريبون', 'Ribbon', 7),
  ('karaoke', 'مايك كاريوكي بسماعة', 'Karaoke Microphone', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'microphone_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'microwave_safe' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('without_lid', 'نعم بدون الغطاء', 'Yes, without lid', 1),
  ('no', 'لا', 'No', 2)) v(code, ar, en, sort)
 where d.code = 'microwave_safe' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'microwave_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('solo', 'ميكروويف عادي (سولو)', 'Solo', 0),
  ('grill', 'ميكروويف بشواية', 'Grill', 1),
  ('convection', 'ميكروويف بالهواء الساخن (كونفكشن)', 'Convection', 2),
  ('inverter', 'ميكروويف إنفرتر', 'Inverter', 3),
  ('air_fryer_combo', 'ميكروويف + قلاية هوائية', 'Microwave + Air Fryer', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'microwave_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'milk_preparation_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون', 'None', 0),
  ('steam_wand', 'ذراع بخار يدوي', 'Manual Steam Wand', 1),
  ('panarello', 'ذراع بخار أوتوماتيك (Panarello)', 'Panarello Wand', 2),
  ('milk_carafe', 'دورق حليب مدمج أوتوماتيك', 'Built-in Milk Carafe', 3),
  ('separate_frother', 'مضرب حليب منفصل مرفق', 'Separate Milk Frother', 4)) v(code, ar, en, sort)
 where d.code = 'milk_preparation_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'milk_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cow', 'لبن بقري', 'Cow', 0),
  ('buffalo', 'لبن جاموسي', 'Buffalo', 1),
  ('mixed', 'مخلوط', 'Mixed', 2),
  ('goat', 'لبن ماعز', 'Goat', 3),
  ('camel', 'لبن نوق', 'Camel', 4),
  ('lactose_free', 'خالي من اللاكتوز', 'Lactose free', 5),
  ('almond', 'لوز (نباتي)', 'Almond (plant)', 6),
  ('soy', 'صويا (نباتي)', 'Soy (plant)', 7),
  ('oat', 'شوفان (نباتي)', 'Oat (plant)', 8),
  ('coconut', 'جوز هند (نباتي)', 'Coconut (plant)', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'milk_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mobile_network_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('5g', '5G', '5G', 0),
  ('4g', '4G LTE', '4G LTE', 1),
  ('3g', '3G', '3G', 2),
  ('2g', '2G فقط', '2G Only', 3)) v(code, ar, en, sort)
 where d.code = 'mobile_network_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'module_form_factor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dimm', 'DIMM (كمبيوتر مكتبي)', 'DIMM (desktop)', 0),
  ('so_dimm', 'SO-DIMM (لابتوب)', 'SO-DIMM (laptop)', 1),
  ('cudimm', 'CUDIMM', 'CUDIMM', 2),
  ('camm2', 'CAMM2', 'CAMM2', 3),
  ('rdimm', 'RDIMM (سيرفر)', 'RDIMM (server)', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'module_form_factor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'monitor_included_or_built_in' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون شاشة', 'No monitor', 0),
  ('included', 'شاشة منفصلة مرفقة', 'Separate monitor included', 1),
  ('built_in', 'شاشة مدمجة (All-in-One)', 'Built-in (All-in-One)', 2)) v(code, ar, en, sort)
 where d.code = 'monitor_included_or_built_in' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'monitor_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('audio', 'صوت فقط', 'Audio Only', 0),
  ('video', 'صوت وصورة', 'Audio and Video', 1),
  ('wifi_app', 'كاميرا Wi-Fi بتطبيق', 'Wi-Fi App Camera', 2),
  ('movement', 'مراقبة الحركة والتنفس', 'Movement / Breathing', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'monitor_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mop_head_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('microfiber', 'مايكروفايبر', 'Microfiber', 0),
  ('cotton', 'قطن', 'Cotton', 1),
  ('chenille', 'شنيل', 'Chenille', 2),
  ('sponge', 'إسفنج', 'Sponge', 3),
  ('pva', 'إسفنج PVA', 'PVA Sponge', 4),
  ('nylon_scrub', 'ليفة نايلون', 'Nylon Scrubber', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'mop_head_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mop_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spin', 'مساحة دوارة (سبين)', 'Spin Mop', 0),
  ('flat', 'مساحة مسطحة', 'Flat Mop', 1),
  ('string', 'مساحة خيوط (شرشوبة)', 'String Mop', 2),
  ('sponge', 'مساحة إسفنج', 'Sponge Mop', 3),
  ('spray', 'مساحة رذاذ (سبراي)', 'Spray Mop', 4),
  ('butterfly_twist', 'مساحة فراشة / لف', 'Butterfly / Twist Mop', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'mop_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'motion_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('manual_bounce', 'هزاز يدوي (بونسر)', 'Manual bounce', 0),
  ('side_to_side', 'مرجيحة يمين وشمال', 'Side-to-side swing', 1),
  ('front_to_back', 'مرجيحة لقدام وورا', 'Front-to-back swing', 2),
  ('rocking', 'هزاز (روكر)', 'Rocking', 3),
  ('gliding', 'انزلاقي', 'Gliding', 4),
  ('vibration', 'اهتزاز', 'Vibration', 5),
  ('multi_motion', 'حركات متعددة (كهربائي)', 'Multi-motion electric', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'motion_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mounting_location' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('air_vent', 'فتحة التكييف', 'Air vent', 0),
  ('dashboard', 'التابلوه', 'Dashboard', 1),
  ('windshield', 'الزجاج الأمامي', 'Windshield', 2),
  ('dash_windshield', 'تابلوه أو زجاج (شفاط)', 'Dashboard or windshield (suction)', 3),
  ('cd_slot', 'فتحة الـ CD', 'CD slot', 4),
  ('cup_holder', 'حامل الأكواب', 'Cup holder', 5),
  ('handlebar', 'جادون الموتوسيكل / العجلة', 'Handlebar', 6),
  ('rear_mirror', 'المراية', 'Mirror', 7),
  ('headrest', 'مسند الرأس', 'Headrest', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'mounting_location' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'mounting_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('adhesive', 'لزق', 'Adhesive', 0),
  ('screw', 'مسامير', 'Screw-mounted', 1),
  ('pressure', 'ضغط بدون حفر', 'Pressure-mounted', 2),
  ('magnetic', 'مغناطيسي', 'Magnetic', 3),
  ('strap', 'حزام', 'Strap', 4),
  ('clamp', 'مشبك', 'Clamp', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'mounting_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'mounting_size_and_thread_direction' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('m8_right', 'M8 سن يمين', 'M8 right-hand thread', 0),
  ('m8_left', 'M8 سن شمال', 'M8 left-hand thread', 1),
  ('m10_right', 'M10 سن يمين', 'M10 right-hand thread', 2),
  ('m10_left', 'M10 سن شمال', 'M10 left-hand thread', 3),
  ('m10_pair_left_right', 'M10 زوج (سن يمين + سن شمال)', 'M10 pair (right + left thread)', 4),
  ('bar_end', 'تركيب في طرف الجادون', 'Bar-end mount', 5),
  ('clamp', 'تركيب بقفيز على الجادون', 'Handlebar clamp', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'mounting_size_and_thread_direction' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'mounting_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('freestanding', 'أرضي (قائم بذاته)', 'Freestanding', 0),
  ('wall', 'تعليق على الحائط', 'Wall-mounted', 1),
  ('tabletop', 'على الترابيزة', 'Tabletop', 2),
  ('over_door', 'تعليق على الباب', 'Over-the-door', 3),
  ('ceiling', 'تعليق في السقف', 'Ceiling', 4),
  ('window', 'على الشباك', 'Window', 5),
  ('suction_cup', 'شفاط (فاكيوم)', 'Suction cup', 6),
  ('adhesive', 'لاصق', 'Adhesive', 7),
  ('rail_rod', 'على ماسورة / مجرى', 'Rail / Rod', 8),
  ('clip', 'مشبك', 'Clip-on', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'mounting_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'movement_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('quartz', 'كوارتز (بطارية)', 'Quartz', 0),
  ('automatic', 'أوتوماتيك', 'Automatic', 1),
  ('mechanical_manual', 'ميكانيكي (تعبئة يدوية)', 'Manual Mechanical', 2),
  ('digital', 'ديجيتال', 'Digital', 3),
  ('analog_digital', 'عقارب وديجيتال', 'Analog-Digital', 4),
  ('solar', 'طاقة شمسية', 'Solar', 5),
  ('kinetic', 'كاينتيك', 'Kinetic', 6),
  ('smart', 'ذكية', 'Smart', 7),
  ('silent_sweep', 'عقرب صامت (سويب)', 'Silent Sweep', 8),
  ('pull_back', 'سحب للخلف', 'Pull-back', 9),
  ('friction', 'احتكاك (دفع)', 'Friction', 10),
  ('battery_motor', 'موتور بالبطارية', 'Battery Motor', 11),
  ('remote_control', 'ريموت كنترول', 'Remote Control', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'movement_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'nail_length_category' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('short', 'قصير', 'Short', 0),
  ('medium', 'متوسط', 'Medium', 1),
  ('long', 'طويل', 'Long', 2),
  ('extra_long', 'طويل جداً', 'Extra long', 3)) v(code, ar, en, sort)
 where d.code = 'nail_length_category' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'nail_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('square', 'مربع', 'Square', 0),
  ('squoval', 'مربع بحواف دائرية', 'Squoval', 1),
  ('round', 'دائري', 'Round', 2),
  ('oval', 'بيضاوي', 'Oval', 3),
  ('almond', 'لوزي (ألموند)', 'Almond', 4),
  ('coffin', 'باليرينا (كوفين)', 'Coffin / Ballerina', 5),
  ('stiletto', 'ستيليتو', 'Stiletto', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'nail_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'night_vision' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون رؤية ليلية', 'None', 0),
  ('infrared', 'أشعة تحت الحمراء (أبيض وأسود)', 'Infrared (B&W)', 1),
  ('color', 'رؤية ليلية ملونة', 'Color Night Vision', 2),
  ('dual_light', 'إضاءة مزدوجة (IR وملونة)', 'Dual Light (IR + Color)', 3)) v(code, ar, en, sort)
 where d.code = 'night_vision' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'nipple_brush_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'nipple_brush_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'non_slip_base' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rubber_feet', 'أرجل مطاط', 'Rubber Grips', 0),
  ('suction', 'شفاطات تثبيت', 'Suction Cups', 1),
  ('none', 'لا', 'No', 2)) v(code, ar, en, sort)
 where d.code = 'non_slip_base' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'non_slip_surface' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'غير مانع للانزلاق', 'No', 0),
  ('one_side', 'وش واحد مانع للانزلاق', 'One side', 1),
  ('both_sides', 'الوشين مانعين للانزلاق', 'Both sides', 2)) v(code, ar, en, sort)
 where d.code = 'non_slip_surface' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'non_stick' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا', 'No', 0),
  ('teflon', 'نعم - تيفلون', 'Yes - Teflon', 1),
  ('granite', 'نعم - جرانيت', 'Yes - Granite', 2),
  ('ceramic', 'نعم - سيراميك', 'Yes - Ceramic', 3),
  ('silicone', 'نعم - سيليكون', 'Yes - Silicone', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'non_stick' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'nursing_access_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('zipper', 'سوستة', 'Zipper', 0),
  ('buttons', 'زراير من قدام', 'Front Buttons', 1),
  ('side_slits', 'فتحات جانبية مخفية', 'Hidden Side Slits', 2),
  ('layered_overlay', 'طبقة علوية ترفع', 'Layered Overlay', 3),
  ('crossover_wrap', 'كروس / ملفوف', 'Crossover / Wrap', 4),
  ('clip_down', 'كلبس تفتح الكوب', 'Clip-down Cups', 5),
  ('pull_aside', 'سحب جانبي', 'Pull-aside', 6)) v(code, ar, en, sort)
 where d.code = 'nursing_access_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'nut_type_or_mix' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('almonds', 'لوز', 'Almonds', 0),
  ('cashews', 'كاجو', 'Cashews', 1),
  ('pistachios', 'فستق', 'Pistachios', 2),
  ('hazelnuts', 'بندق', 'Hazelnuts', 3),
  ('walnuts', 'عين جمل', 'Walnuts', 4),
  ('peanuts', 'فول سوداني', 'Peanuts', 5),
  ('white_seeds', 'لب أبيض', 'White pumpkin seeds', 6),
  ('syrian_seeds', 'لب سوري', 'Syrian (watermelon) seeds', 7),
  ('sunflower_seeds', 'لب سوبر (عباد الشمس)', 'Sunflower seeds', 8),
  ('roasted_chickpeas', 'حمص محمص', 'Roasted chickpeas', 9),
  ('pecans', 'بيكان', 'Pecans', 10),
  ('macadamia', 'مكاديميا', 'Macadamia', 11),
  ('pine_nuts', 'صنوبر', 'Pine nuts', 12),
  ('mixed_nuts', 'مكسرات مشكلة', 'Mixed nuts', 13),
  ('nuts_dried_fruit', 'مكسرات بالفواكه المجففة', 'Nuts & dried fruit mix', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'nut_type_or_mix' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'oil_source' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sunflower', 'عباد الشمس', 'Sunflower', 0),
  ('corn', 'ذرة', 'Corn', 1),
  ('soybean', 'صويا', 'Soybean', 2),
  ('blend', 'خليط زيوت نباتية', 'Vegetable oil blend', 3),
  ('olive', 'زيتون', 'Olive', 4),
  ('palm', 'نخيل', 'Palm', 5),
  ('canola', 'كانولا', 'Canola', 6),
  ('cottonseed', 'بذرة القطن', 'Cottonseed', 7),
  ('sesame', 'سمسم (سيرج)', 'Sesame', 8),
  ('coconut', 'جوز هند', 'Coconut', 9),
  ('flaxseed', 'بذر كتان (حار)', 'Flaxseed', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'oil_source' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'opacity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('opaque_squat_proof', 'غير شفاف تماما (سكوات بروف)', 'Opaque / Squat-proof', 0),
  ('opaque', 'غير شفاف', 'Opaque', 1),
  ('semi_sheer', 'شفاف جزئيا', 'Semi-sheer', 2),
  ('sheer_mesh', 'شفاف / شبك', 'Sheer / Mesh', 3)) v(code, ar, en, sort)
 where d.code = 'opacity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'opening_and_closing_mechanism' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('manual', 'يدوي', 'Manual', 0),
  ('auto_open', 'فتح أوتوماتيك', 'Auto Open', 1),
  ('auto_open_close', 'فتح وقفل أوتوماتيك', 'Auto Open and Close', 2)) v(code, ar, en, sort)
 where d.code = 'opening_and_closing_mechanism' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'operating_modes' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cleansing', 'تنظيف / تقشير', 'Cleansing / peeling', 0),
  ('ion_plus', 'أيون+ (إدخال المستحضر)', 'Ion+ infusion', 1),
  ('ion_minus', 'أيون- (تنظيف عميق)', 'Ion- cleansing', 2),
  ('ems_lifting', 'شد EMS', 'EMS lifting', 3),
  ('drilling', 'تخريم عادي', 'Drilling', 4),
  ('hammer', 'تخريم بالدق (هيلتي)', 'Hammer drilling', 5),
  ('screwdriving', 'فك وربط', 'Screwdriving', 6),
  ('chiseling', 'تكسير', 'Chiseling', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'operating_modes' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'operating_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('android', 'Android', 'Android', 0),
  ('ios', 'iOS', 'iOS', 1),
  ('ipados', 'iPadOS', 'iPadOS', 2),
  ('harmonyos', 'HarmonyOS', 'HarmonyOS', 3),
  ('windows_11_home', 'Windows 11 Home', 'Windows 11 Home', 4),
  ('windows_11_pro', 'Windows 11 Pro', 'Windows 11 Pro', 5),
  ('windows_10', 'Windows 10', 'Windows 10', 6),
  ('macos', 'macOS', 'macOS', 7),
  ('chromeos', 'ChromeOS', 'ChromeOS', 8),
  ('linux', 'Linux / Ubuntu', 'Linux / Ubuntu', 9),
  ('no_os', 'بدون نظام (DOS)', 'No OS / FreeDOS', 10),
  ('google_tv', 'Google TV / Android TV', 'Google TV / Android TV', 11),
  ('tizen', 'Tizen (سامسونج)', 'Tizen', 12),
  ('webos', 'webOS (إل جي)', 'webOS', 13),
  ('vidaa', 'VIDAA', 'VIDAA', 14),
  ('linux_tv', 'نظام لينكس للشاشات', 'Linux TV OS', 15),
  ('other', 'أخرى', 'Other', 16)) v(code, ar, en, sort)
 where d.code = 'operating_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'operation_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('manual', 'يدوي', 'Manual', 0),
  ('electric', 'كهربائي', 'Electric', 1),
  ('fully_automatic', 'أوتوماتيك بالكامل', 'Fully Automatic', 2),
  ('semi_automatic', 'نصف أوتوماتيك (حوضين)', 'Semi-automatic (Twin Tub)', 3),
  ('top_load_auto', 'أوتوماتيك تحميل علوي', 'Top-load Automatic', 4)) v(code, ar, en, sort)
 where d.code = 'operation_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'organizer_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('drawer_unit', 'منظم بأدراج', 'Drawer unit', 0),
  ('rotating', 'منظم دوار', 'Rotating', 1),
  ('compartment_box', 'علبة بخانات', 'Compartment box', 2),
  ('drawer_insert', 'تقسيمة درج', 'Drawer insert tray', 3),
  ('dividers', 'فواصل', 'Dividers', 4),
  ('cutlery_tray', 'منظم معالق وشوك', 'Cutlery tray', 5),
  ('lipstick_holder', 'حامل روج', 'Lipstick holder', 6),
  ('brush_holder', 'حامل فرش', 'Brush holder', 7),
  ('hanging', 'منظم تعليق', 'Hanging organizer', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'organizer_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'origin' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('egypt', 'مصر', 'Egypt', 0),
  ('saudi_arabia', 'السعودية', 'Saudi Arabia', 1),
  ('uae', 'الإمارات', 'UAE', 2),
  ('turkey', 'تركيا', 'Turkey', 3),
  ('italy', 'إيطاليا', 'Italy', 4),
  ('spain', 'إسبانيا', 'Spain', 5),
  ('greece', 'اليونان', 'Greece', 6),
  ('germany', 'ألمانيا', 'Germany', 7),
  ('france', 'فرنسا', 'France', 8),
  ('netherlands', 'هولندا', 'Netherlands', 9),
  ('uk', 'بريطانيا', 'United Kingdom', 10),
  ('usa', 'أمريكا', 'USA', 11),
  ('lebanon', 'لبنان', 'Lebanon', 12),
  ('jordan', 'الأردن', 'Jordan', 13),
  ('tunisia', 'تونس', 'Tunisia', 14),
  ('morocco', 'المغرب', 'Morocco', 15),
  ('russia', 'روسيا', 'Russia', 16),
  ('ukraine', 'أوكرانيا', 'Ukraine', 17),
  ('brazil', 'البرازيل', 'Brazil', 18),
  ('india', 'الهند', 'India', 19),
  ('china', 'الصين', 'China', 20),
  ('thailand', 'تايلاند', 'Thailand', 21),
  ('malaysia', 'ماليزيا', 'Malaysia', 22),
  ('other', 'أخرى', 'Other', 23)) v(code, ar, en, sort)
 where d.code = 'origin' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'outer_fabric_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('plush_polyester', 'قطيفة بوليستر', 'Polyester Plush', 0),
  ('super_soft', 'قطيفة سوبر سوفت (كريستال)', 'Super Soft Crystal Velvet', 1),
  ('minky', 'مينكي', 'Minky', 2),
  ('faux_fur', 'فرو صناعي', 'Faux Fur', 3),
  ('fleece', 'فليس', 'Fleece', 4),
  ('cotton', 'قطن', 'Cotton', 5),
  ('organic_cotton', 'قطن عضوي', 'Organic Cotton', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'outer_fabric_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'outer_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('genuine_leather', 'جلد طبيعي', 'Genuine leather', 0),
  ('pu_leather', 'جلد صناعي PU', 'PU synthetic leather', 1),
  ('pvc', 'PVC', 'PVC', 2),
  ('tpu', 'TPU', 'TPU', 3),
  ('vinyl', 'فينيل', 'Vinyl', 4),
  ('rubber', 'كاوتش (مطاط)', 'Rubber', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'outer_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'outlet_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('universal', 'عالمي (يقبل كل الفيش)', 'Universal', 0),
  ('schuko', 'أوروبي بأرضي (Schuko)', 'Schuko', 1),
  ('eu_2pin', 'أوروبي رفيع', 'European 2-pin', 2),
  ('uk', 'إنجليزي 3 سنون', 'UK', 3),
  ('usb_a', 'منافذ USB-A', 'USB-A ports', 4),
  ('usb_c', 'منافذ USB-C', 'USB-C ports', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'outlet_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'output_port_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_c', 'USB-C', 'USB-C', 0),
  ('usb_a', 'USB-A', 'USB-A', 1),
  ('lightning', 'Lightning', 'Lightning', 2),
  ('micro_usb', 'Micro USB', 'Micro USB', 3),
  ('built_in_cable', 'كابل مدمج', 'Built-in Cable', 4),
  ('wireless', 'شحن لاسلكي', 'Wireless Charging', 5),
  ('ac_outlet', 'مخرج كهرباء (فيشة)', 'AC Outlet', 6),
  ('dc', 'مخرج DC', 'DC Output', 7)) v(code, ar, en, sort)
 where d.code = 'output_port_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'oven_energy_source' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gas', 'غاز', 'Gas', 0),
  ('electric', 'كهرباء', 'Electric', 1),
  ('gas_electric_grill', 'فرن غاز وشواية كهرباء', 'Gas oven + electric grill', 2),
  ('dual_fuel', 'غاز وكهرباء (دوال)', 'Dual fuel', 3)) v(code, ar, en, sort)
 where d.code = 'oven_energy_source' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'oven_safe' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير مناسب للفرن', 'Not oven safe', 0),
  ('up_to_180', 'حتى 180°م', 'Up to 180°C', 1),
  ('up_to_220', 'حتى 220°م', 'Up to 220°C', 2),
  ('up_to_260', 'حتى 260°م', 'Up to 260°C', 3),
  ('body_only', 'الجسم فقط (بدون اليد / الغطاء)', 'Body only (no handle / lid)', 4),
  ('yes', 'نعم (بدون تحديد)', 'Yes (unspecified)', 5)) v(code, ar, en, sort)
 where d.code = 'oven_safe' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'overheat_protection' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'فصل تلقائي', 'Auto shut-off', 0),
  ('thermal_fuse', 'فيوز حراري (يحتاج تغيير)', 'Thermal fuse (one-time)', 1),
  ('no', 'لا', 'No', 2)) v(code, ar, en, sort)
 where d.code = 'overheat_protection' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'pack_contents' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('color_cream', 'كريم الصبغة', 'Color cream', 0),
  ('developer', 'أوكسجين / مطور', 'Developer', 1),
  ('conditioner', 'بلسم بعد الصبغة', 'Aftercare conditioner', 2),
  ('serum', 'سيروم / زيت حماية', 'Protective serum', 3),
  ('gloves', 'جوانتي', 'Gloves', 4),
  ('applicator', 'فرشاة / أبليكيتور', 'Applicator', 5),
  ('instructions', 'ورقة تعليمات', 'Instructions', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'pack_contents' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pack_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('roll_box_cutter', 'رول في علبة بقاطع', 'Roll in box with cutter', 0),
  ('roll', 'رول', 'Roll', 1),
  ('pre_cut_sheets', 'شيتات مقطعة جاهزة', 'Pre-cut sheets', 2),
  ('jumbo_roll', 'رول كبير (للمطاعم)', 'Jumbo / Catering roll', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'pack_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pack_format' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('box', 'علبة كرتون', 'Box', 0),
  ('soft_pack', 'باكيت سوفت', 'Soft pack', 1),
  ('pocket', 'باكيت جيب', 'Pocket pack', 2),
  ('roll', 'رول', 'Roll', 3),
  ('car_tube', 'علبة عربية', 'Car tube', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'pack_format' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'packaging' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('can', 'كانز (علبة معدن)', 'Can', 0),
  ('plastic_bottle', 'زجاجة بلاستيك', 'Plastic bottle', 1),
  ('glass_bottle', 'زجاجة إزاز', 'Glass bottle', 2),
  ('glass_jar', 'برطمان إزاز', 'Glass jar', 3),
  ('plastic_jar', 'برطمان / علبة بلاستيك', 'Plastic jar / tub', 4),
  ('carton', 'كرتونة (تتراباك)', 'Carton (Tetra Pak)', 5),
  ('bag', 'كيس', 'Bag / pouch', 6),
  ('box', 'علبة كرتون', 'Cardboard box', 7),
  ('tray', 'طبق / صينية', 'Tray', 8),
  ('sachet', 'أظرف', 'Sachets', 9),
  ('multipack', 'عبوة متعددة (باكدج)', 'Multipack', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'packaging' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'packing_medium' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('vegetable_oil', 'زيت نباتي', 'Vegetable oil', 0),
  ('sunflower_oil', 'زيت عباد الشمس', 'Sunflower oil', 1),
  ('olive_oil', 'زيت زيتون', 'Olive oil', 2),
  ('water_brine', 'مياه / محلول ملحي', 'Water / brine', 3),
  ('tomato_sauce', 'صلصة طماطم', 'Tomato sauce', 4),
  ('chili_oil', 'زيت بالشطة (حار)', 'Chili oil (spicy)', 5),
  ('lemon', 'بالليمون', 'Lemon', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'packing_medium' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pad_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pantyliner', 'فوطة يومية', 'Pantyliner', 0),
  ('ultra_thin', 'ألترا رفيعة', 'Ultra thin', 1),
  ('regular', 'عادية', 'Regular', 2),
  ('maxi', 'ماكسي سميكة', 'Maxi', 3),
  ('night', 'ليلية', 'Overnight', 4),
  ('maternity', 'بعد الولادة', 'Maternity', 5),
  ('cotton', 'قطن طبيعي', 'Cotton', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'pad_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pan_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('frying', 'طاسة قلي', 'Frying pan', 0),
  ('deep', 'طاسة عميقة', 'Deep fry pan', 1),
  ('grill', 'جريل (بخطوط)', 'Grill pan', 2),
  ('saute', 'سوتيه', 'Sauté pan', 3),
  ('crepe', 'كريب', 'Crêpe pan', 4),
  ('egg', 'طاسة بيض', 'Egg pan', 5),
  ('saj', 'صاج', 'Saj / Tawa', 6),
  ('wok', 'ووك', 'Wok', 7),
  ('set', 'طقم طاسات', 'Pan set', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'pan_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'panel_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ips', 'IPS', 'IPS', 0),
  ('va', 'VA', 'VA', 1),
  ('tn', 'TN', 'TN', 2),
  ('oled', 'OLED', 'OLED', 3),
  ('qd_oled', 'QD-OLED', 'QD-OLED', 4),
  ('amoled', 'AMOLED', 'AMOLED', 5),
  ('mini_led', 'Mini-LED', 'Mini-LED', 6),
  ('fast_ips', 'Fast IPS / Nano IPS', 'Fast IPS / Nano IPS', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'panel_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'parental_remote_control' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون ريموت للأهل', 'No Parental Remote', 0),
  ('remote_2_4g', 'ريموت 2.4G مرفق', '2.4G Remote Included', 1),
  ('app_bluetooth', 'تحكم من الموبايل (بلوتوث)', 'Bluetooth App Control', 2)) v(code, ar, en, sort)
 where d.code = 'parental_remote_control' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pasta_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spaghetti', 'اسباجتي', 'Spaghetti', 0),
  ('penne', 'قلم (بيني)', 'Penne', 1),
  ('elbows', 'كوع / مقلمة', 'Elbows', 2),
  ('rings', 'خواتم', 'Rings', 3),
  ('orzo', 'لسان عصفور', 'Orzo', 4),
  ('vermicelli', 'شعرية', 'Vermicelli', 5),
  ('shells', 'صدف', 'Shells', 6),
  ('farfalle', 'فيونكة (فراشة)', 'Farfalle (bow-tie)', 7),
  ('fusilli', 'حلزونية (فوسيلي)', 'Fusilli', 8),
  ('rigatoni', 'ريجاتوني', 'Rigatoni', 9),
  ('lasagna', 'لازانيا', 'Lasagna sheets', 10),
  ('fettuccine', 'فيتوتشيني / تالياتيلي', 'Fettuccine / tagliatelle', 11),
  ('stars_alphabet', 'نجوم / حروف', 'Stars / alphabet', 12),
  ('noodles', 'نودلز', 'Noodles', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'pasta_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pasta_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('durum_semolina', 'سميد قمح صلب', 'Durum wheat semolina', 0),
  ('regular_wheat', 'دقيق قمح عادي', 'Regular wheat', 1),
  ('whole_wheat', 'قمح كامل (أسمر)', 'Whole wheat', 2),
  ('egg', 'بالبيض', 'Egg pasta', 3),
  ('gluten_free', 'خالية من الجلوتين', 'Gluten free', 4),
  ('vegetable', 'بالخضار', 'Vegetable pasta', 5),
  ('instant', 'سريعة التحضير', 'Instant', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'pasta_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pc_power_standard' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('atx_2', 'ATX 2.x', 'ATX 2.x', 0),
  ('atx_3_0', 'ATX 3.0', 'ATX 3.0', 1),
  ('atx_3_1', 'ATX 3.1', 'ATX 3.1', 2),
  ('eps12v', 'EPS12V', 'EPS12V', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'pc_power_standard' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'performance_classifications' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('api_sp', 'API SP', 'API SP', 0),
  ('api_sn', 'API SN / SN Plus', 'API SN / SN Plus', 1),
  ('api_sm', 'API SM', 'API SM', 2),
  ('api_sl', 'API SL أو أقل', 'API SL or lower', 3),
  ('api_ck4', 'API CK-4', 'API CK-4', 4),
  ('api_ci4', 'API CI-4 / CH-4', 'API CI-4 / CH-4', 5),
  ('api_cf', 'API CF / CD', 'API CF / CD', 6),
  ('acea_a3b4', 'ACEA A3/B4', 'ACEA A3/B4', 7),
  ('acea_a5b5', 'ACEA A5/B5', 'ACEA A5/B5', 8),
  ('acea_c3', 'ACEA C3', 'ACEA C3', 9),
  ('acea_c2', 'ACEA C2 / C5', 'ACEA C2 / C5', 10),
  ('acea_e', 'ACEA E7 / E4', 'ACEA E7 / E4', 11),
  ('ilsac', 'ILSAC GF-5 / GF-6', 'ILSAC GF-5 / GF-6', 12),
  ('jaso_ma2', 'JASO MA / MA2', 'JASO MA / MA2', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'performance_classifications' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'permitted_hair_condition' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dry', 'شعر جاف', 'Dry hair', 0),
  ('damp', 'شعر رطب (نص ناشف)', 'Damp hair', 1),
  ('wet', 'شعر مبلول', 'Wet hair', 2)) v(code, ar, en, sort)
 where d.code = 'permitted_hair_condition' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'personalization' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون تخصيص', 'Not personalized', 0),
  ('name', 'كتابة اسم', 'Name', 1),
  ('name_date', 'اسم وتاريخ', 'Name and date', 2),
  ('custom_message', 'رسالة / عبارة خاصة', 'Custom message', 3),
  ('photo', 'طباعة صورة', 'Photo print', 4),
  ('logo', 'لوجو', 'Logo', 5),
  ('colors_theme', 'اختيار الألوان والثيم', 'Colors / theme choice', 6),
  ('full_design', 'تصميم كامل حسب الطلب', 'Fully custom design', 7)) v(code, ar, en, sort)
 where d.code = 'personalization' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'pet_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cats', 'قطط', 'Cats', 0),
  ('kittens', 'قطط صغيرة', 'Kittens', 1),
  ('dogs', 'كلاب', 'Dogs', 2),
  ('puppies', 'جراء (كلاب صغيرة)', 'Puppies', 3),
  ('small_dogs', 'كلاب صغيرة الحجم', 'Small Breed Dogs', 4),
  ('large_dogs', 'كلاب كبيرة الحجم', 'Large Breed Dogs', 5),
  ('birds', 'طيور', 'Birds', 6),
  ('small_animals', 'حيوانات صغيرة (أرانب / هامستر)', 'Small Animals', 7),
  ('all_pets', 'كل الحيوانات الأليفة', 'All Pets', 8)) v(code, ar, en, sort)
 where d.code = 'pet_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'phone_retention_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spring_clamp', 'ماسك بسوستة', 'Spring clamp', 0),
  ('magnetic', 'مغناطيس', 'Magnetic', 1),
  ('magsafe', 'MagSafe', 'MagSafe', 2),
  ('gravity', 'جاذبية (يقفل بوزن الموبايل)', 'Gravity lock', 3),
  ('auto_clamp', 'ماسك كهربائي تلقائي', 'Auto electric clamp', 4),
  ('one_touch', 'قفل بضغطة واحدة', 'One-touch lock', 5),
  ('x_grip', 'ماسك X / شبكة (موتوسيكل)', 'X-grip / net (motorcycle)', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'phone_retention_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pickup_pattern' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cardioid', 'كارديود (اتجاه واحد)', 'Cardioid', 0),
  ('supercardioid', 'سوبر كارديود', 'Supercardioid', 1),
  ('hypercardioid', 'هايبر كارديود', 'Hypercardioid', 2),
  ('omnidirectional', 'كل الاتجاهات (أومني)', 'Omnidirectional', 3),
  ('bidirectional', 'ثنائي الاتجاه (Figure-8)', 'Bidirectional (Figure-8)', 4),
  ('shotgun_lobar', 'شوتجن (ضيق جدا)', 'Shotgun / Lobar', 5),
  ('multi_pattern', 'متعدد الأنماط', 'Multi-pattern', 6)) v(code, ar, en, sort)
 where d.code = 'pickup_pattern' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pickup_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون لاقط (أكوستيك)', 'None (acoustic)', 0),
  ('piezo', 'بيزو', 'Piezo', 1),
  ('preamp_eq', 'بيزو مع إكولايزر / بريامب', 'Piezo with preamp EQ', 2),
  ('single_coil', 'سينجل كويل', 'Single coil', 3),
  ('humbucker', 'هامباكر', 'Humbucker', 4),
  ('p90', 'P90', 'P90', 5),
  ('soundhole_magnetic', 'مغناطيسي لفتحة الصوت', 'Magnetic soundhole', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'pickup_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pillow_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('u_shape', 'حرف U', 'U-shape', 0),
  ('j_shape', 'حرف J', 'J-shape', 1),
  ('wrap', 'ملفوف (360)', 'Wrap-around', 2),
  ('inflatable', 'منفوخ', 'Inflatable', 3),
  ('round', 'مدور', 'Round', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'pillow_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'plate_material_or_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ceramic', 'سيراميك', 'Ceramic', 0),
  ('tourmaline', 'تورمالين', 'Tourmaline', 1),
  ('ceramic_tourmaline', 'سيراميك وتورمالين', 'Ceramic tourmaline', 2),
  ('titanium', 'تيتانيوم', 'Titanium', 3),
  ('keratin', 'كيراتين', 'Keratin coated', 4),
  ('marble', 'رخام', 'Marble coated', 5),
  ('aluminum', 'ألومنيوم', 'Aluminum', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'plate_material_or_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'platform' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ps5', 'بلايستيشن 5', 'PlayStation 5', 0),
  ('ps4', 'بلايستيشن 4', 'PlayStation 4', 1),
  ('xbox_series', 'Xbox Series X|S', 'Xbox Series X|S', 2),
  ('xbox_one', 'Xbox One', 'Xbox One', 3),
  ('switch', 'نينتندو سويتش', 'Nintendo Switch', 4),
  ('switch_2', 'نينتندو سويتش 2', 'Nintendo Switch 2', 5),
  ('pc', 'كمبيوتر (Windows)', 'PC (Windows)', 6),
  ('mac', 'Mac', 'Mac', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'platform' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'plating_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون طلاء', 'No Plating', 0),
  ('gold_plated', 'مطلي ذهب', 'Gold Plated', 1),
  ('rose_gold_plated', 'مطلي روز جولد', 'Rose Gold Plated', 2),
  ('silver_plated', 'مطلي فضة', 'Silver Plated', 3),
  ('rhodium_plated', 'مطلي روديوم', 'Rhodium Plated', 4),
  ('black_rhodium', 'مطلي روديوم أسود', 'Black Rhodium Plated', 5),
  ('pvd', 'طلاء PVD (ثابت)', 'PVD Coating', 6),
  ('gold_filled', 'جولد فيلد (حشو ذهب)', 'Gold Filled', 7),
  ('vermeil', 'فيرميل (فضة مطلية ذهب)', 'Vermeil', 8),
  ('ip_plated', 'طلاء أيوني IP', 'IP Plated', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'plating_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'play_theme' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('kitchen', 'مطبخ وطبخ', 'Kitchen & Cooking', 0),
  ('tea_set', 'طقم شاي', 'Tea Set', 1),
  ('doctor', 'دكتور', 'Doctor', 2),
  ('tools', 'عدة وورشة', 'Tool Workshop', 3),
  ('beauty_makeup', 'مكياج وكوافير', 'Beauty & Makeup', 4),
  ('supermarket', 'سوبر ماركت وكاشير', 'Supermarket & Cash Register', 5),
  ('cleaning', 'تنظيف البيت', 'Cleaning', 6),
  ('food_icecream', 'أكل وآيس كريم', 'Food & Ice Cream', 7),
  ('police_fire', 'شرطة / مطافي', 'Police / Firefighter', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'play_theme' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'plier_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('combination', 'زرادية عادية (كومبينيشن)', 'Combination pliers', 0),
  ('long_nose', 'بوز طويل', 'Long nose', 1),
  ('diagonal_cutter', 'قصافة', 'Diagonal cutter', 2),
  ('locking', 'كماشة قفل (فايس جريب)', 'Locking pliers', 3),
  ('water_pump', 'كماشة بلف (موسورجي)', 'Water pump / groove joint', 4),
  ('slip_joint', 'كماشة منزلقة', 'Slip joint', 5),
  ('end_cutter', 'كماشة نجار (قطاعة أطراف)', 'End cutter / pincers', 6),
  ('wire_stripper', 'مقشرة أسلاك', 'Wire stripper', 7),
  ('crimping', 'كابسة أطراف', 'Crimping', 8),
  ('circlip', 'كماشة سيرسكليب (تيلة)', 'Circlip', 9),
  ('set', 'طقم', 'Set', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'plier_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'polarized_lenses' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('polarized', 'مستقطبة (بولارايزد)', 'Polarized', 0),
  ('not_polarized', 'غير مستقطبة', 'Non-polarized', 1)) v(code, ar, en, sort)
 where d.code = 'polarized_lenses' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'polish_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('regular', 'مناكير عادي', 'Regular', 0),
  ('gel', 'جل (يحتاج جهاز)', 'Gel', 1),
  ('gel_effect', 'جل إفكت (بدون جهاز)', 'Gel effect (no lamp)', 2),
  ('breathable', 'مناكير مسامي (للوضوء)', 'Breathable / Halal', 3),
  ('peel_off', 'بيل أوف', 'Peel-off', 4),
  ('base_coat', 'بيز كوت', 'Base coat', 5),
  ('top_coat', 'توب كوت', 'Top coat', 6),
  ('glitter', 'جليتر', 'Glitter', 7),
  ('kids', 'للأطفال (مائي)', 'Kids (water-based)', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'polish_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'ports' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_c', 'USB-C', 'USB-C', 0),
  ('usb_a', 'USB-A', 'USB-A', 1),
  ('hdmi', 'HDMI', 'HDMI', 2),
  ('displayport', 'DisplayPort', 'DisplayPort', 3),
  ('thunderbolt', 'Thunderbolt', 'Thunderbolt', 4),
  ('ethernet', 'Ethernet (RJ45)', 'Ethernet (RJ45)', 5),
  ('wan', 'منفذ WAN', 'WAN port', 6),
  ('dsl', 'منفذ خط أرضي (RJ11)', 'DSL (RJ11)', 7),
  ('jack_3_5', 'سماعة 3.5 مم', '3.5 mm audio jack', 8),
  ('lightning', 'Lightning', 'Lightning', 9),
  ('micro_usb', 'Micro-USB', 'Micro-USB', 10),
  ('sd_card', 'قارئ كارت SD', 'SD card reader', 11),
  ('microsd', 'مدخل microSD', 'microSD slot', 12),
  ('vga', 'VGA', 'VGA', 13),
  ('dc_in', 'مدخل كهرباء DC', 'DC power in', 14),
  ('other', 'أخرى', 'Other', 15)) v(code, ar, en, sort)
 where d.code = 'ports' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'powder_color' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('white', 'أبيض', 'White', 0),
  ('blue', 'أزرق', 'Blue', 1),
  ('violet', 'بنفسجي', 'Violet', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'powder_color' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'powder_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('loose', 'سايبة (لوز)', 'Loose', 0),
  ('pressed', 'مضغوطة (كومباكت)', 'Pressed / Compact', 1),
  ('translucent', 'شفافة للتثبيت', 'Translucent setting', 2),
  ('two_way_cake', 'تو واي كيك', 'Two-way cake', 3),
  ('baked', 'مخبوزة', 'Baked', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'powder_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'بودرة داخلية' where code = 'powdered' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('powder_free', 'بدون بودرة', 'Powder-free', 0),
  ('powdered', 'ببودرة', 'Powdered', 1)) v(code, ar, en, sort)
 where d.code = 'powdered' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'powdered_sheets' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('powdered', 'ببودرة', 'Powdered', 0),
  ('unpowdered', 'بدون بودرة', 'Unpowdered', 1)) v(code, ar, en, sort)
 where d.code = 'powdered_sheets' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'power_supply_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('included', 'مرفق', 'Included', 0),
  ('not_included', 'غير مرفق', 'Not included', 1),
  ('usb_powered', 'يعمل بـ USB (بدون محول)', 'USB powered (no adapter)', 2)) v(code, ar, en, sort)
 where d.code = 'power_supply_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'preparation_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('raw', 'ني (خام)', 'Raw', 0),
  ('roasted', 'محمص', 'Roasted', 1),
  ('salted_roasted', 'محمص بالملح', 'Salted roasted', 2),
  ('fried', 'مقلي', 'Fried', 3),
  ('blanched', 'مقشر (مسلوق قشرته)', 'Blanched', 4),
  ('smoked', 'مدخن', 'Smoked', 5),
  ('coated', 'مغلف', 'Coated', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'preparation_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pressure_sensor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('light_alert', 'تنبيه بالضوء', 'Visual alert', 0),
  ('vibration_alert', 'تنبيه بالاهتزاز / الصوت', 'Vibration / sound alert', 1),
  ('auto_slowdown', 'تقليل السرعة تلقائياً', 'Auto slowdown', 2),
  ('none', 'بدون مستشعر', 'None', 3)) v(code, ar, en, sort)
 where d.code = 'pressure_sensor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'primary_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('daily', 'استخدام يومي', 'Everyday use', 0),
  ('home_workout', 'تمارين منزلية', 'Home workout', 1),
  ('gym', 'جيم', 'Gym', 2),
  ('professional_training', 'تدريب احترافي', 'Professional training', 3),
  ('competition', 'مباريات وبطولات', 'Competition', 4),
  ('yoga_pilates', 'يوجا وبيلاتس', 'Yoga & pilates', 5),
  ('martial_arts', 'ملاكمة وفنون قتالية', 'Boxing & martial arts', 6),
  ('rehab', 'علاج طبيعي وتأهيل', 'Physiotherapy / rehab', 7),
  ('outdoor', 'خروج وأنشطة خارجية', 'Outdoor', 8),
  ('beach_pool', 'بحر وحمام سباحة', 'Beach & pool', 9),
  ('casual_outing', 'خروج كاجوال', 'Casual outings', 10),
  ('occasions', 'سهرات ومناسبات', 'Occasions / evening', 11),
  ('travel', 'سفر', 'Travel', 12),
  ('motorcycle_touring', 'ركوب موتوسيكل (طرق)', 'Motorcycle road riding', 13),
  ('off_road_racing', 'سباقات وأوف رود', 'Racing / off-road', 14),
  ('kids', 'أطفال', 'Kids', 15),
  ('other', 'أخرى', 'Other', 16)) v(code, ar, en, sort)
 where d.code = 'primary_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'print_color' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('color', 'ألوان', 'Color', 0),
  ('mono', 'أبيض وأسود', 'Monochrome', 1),
  ('color_photo', 'ألوان للصور (6 أحبار أو أكثر)', 'Photo color (6+ inks)', 2)) v(code, ar, en, sort)
 where d.code = 'print_color' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'print_color_mode' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('color', 'ألوان', 'Color', 0),
  ('mono', 'أبيض وأسود', 'Monochrome', 1),
  ('color_photo', 'ألوان للصور (6 أحبار أو أكثر)', 'Photo color (6+ inks)', 2)) v(code, ar, en, sort)
 where d.code = 'print_color_mode' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'print_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('inkjet', 'حبر (Inkjet)', 'Inkjet', 0),
  ('ink_tank', 'تانك حبر', 'Ink tank', 1),
  ('laser', 'ليزر', 'Laser', 2),
  ('led', 'LED', 'LED', 3),
  ('thermal', 'حراري', 'Thermal', 4),
  ('dot_matrix', 'نقطي (Dot Matrix)', 'Dot matrix', 5),
  ('dye_sub', 'تسامي حراري (صور)', 'Dye-sublimation', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'print_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'processing_grade' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('refined', 'مكرر', 'Refined', 0),
  ('extra_virgin', 'بكر ممتاز (إكسترا فيرجن)', 'Extra virgin', 1),
  ('virgin', 'بكر', 'Virgin', 2),
  ('pure_olive', 'زيت زيتون نقي (مخلوط)', 'Pure / classic olive oil', 3),
  ('pomace', 'تفل (بوماس)', 'Pomace', 4),
  ('cold_pressed', 'معصور على البارد', 'Cold pressed', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'processing_grade' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'processing_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fresh', 'طازج', 'Fresh', 0),
  ('pasteurized', 'مبستر', 'Pasteurized', 1),
  ('uht', 'معقم طويل الأجل (UHT)', 'UHT', 2),
  ('canned_sterilized', 'معلب / معقم', 'Canned / sterilized', 3),
  ('concentrated', 'مركز', 'Concentrated', 4),
  ('dried_powdered', 'مجفف / بودرة', 'Dried / powdered', 5),
  ('frozen', 'مجمد', 'Frozen', 6),
  ('fermented', 'متخمر', 'Fermented / cultured', 7),
  ('aged', 'معتق', 'Aged / matured', 8),
  ('smoked', 'مدخن', 'Smoked', 9),
  ('rolled_flakes', 'رقائق (مفرود)', 'Rolled / flakes', 10),
  ('instant', 'سريع التحضير', 'Instant / quick', 11),
  ('organic', 'أورجانيك', 'Organic', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'processing_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'product_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('jam', 'مربى', 'Jam', 0),
  ('marmalade', 'مارمالاد', 'Marmalade', 1),
  ('chocolate_spread', 'شوكولاتة للدهن', 'Chocolate spread', 2),
  ('peanut_butter', 'زبدة فول سوداني', 'Peanut butter', 3),
  ('biscuit_spread', 'كريمة بسكويت (لوتس)', 'Biscuit spread', 4),
  ('halawa_spread', 'حلاوة طحينية للدهن', 'Halva spread', 5),
  ('potty', 'نونية', 'Potty', 6),
  ('toilet_seat', 'مقعد تدريب على التواليت', 'Toilet training seat', 7),
  ('seat_with_step', 'مقعد بسلم', 'Training seat with step', 8),
  ('potty_2in1', 'نونية 2 في 1', '2-in-1 potty / seat', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'product_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'professional_use_only' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('professional_only', 'للصالونات والمحترفين فقط', 'Professional use only', 0),
  ('home_and_pro', 'للاستخدام المنزلي والمهني', 'Home and professional', 1)) v(code, ar, en, sort)
 where d.code = 'professional_use_only' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'protection_product_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('carnauba', 'شمع كرنوبا', 'Carnauba wax', 0),
  ('synthetic_sealant', 'سيلانت صناعي', 'Synthetic sealant', 1),
  ('ceramic', 'سيراميك (نانو)', 'Ceramic coating', 2),
  ('graphene', 'جرافين', 'Graphene coating', 3),
  ('spray_wax', 'شمع بخاخ سريع', 'Spray / quick wax', 4),
  ('cleaner_wax', 'ملمع وشمع في واحد', 'Cleaner wax (all-in-one)', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'protection_product_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'protection_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('deodorant', 'مزيل رائحة فقط', 'Deodorant', 0),
  ('antiperspirant', 'مضاد للتعرق', 'Antiperspirant', 1),
  ('both', 'مزيل رائحة ومضاد للتعرق', 'Deodorant and antiperspirant', 2)) v(code, ar, en, sort)
 where d.code = 'protection_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'protector_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tempered_glass', 'زجاج سكريتة عادي', 'Tempered Glass', 0),
  ('full_glue_glass', 'زجاج كامل الشاشة (9D / 21D)', 'Full Glue Glass (9D/21D)', 1),
  ('privacy', 'خصوصية (برايفسي)', 'Privacy', 2),
  ('matte', 'مطفي (مات) ضد البصمات', 'Matte Anti-fingerprint', 3),
  ('ceramic', 'سيراميك', 'Ceramic', 4),
  ('hydrogel_nano', 'نانو / هيدروجيل', 'Nano / Hydrogel Film', 5),
  ('uv_glass', 'زجاج UV (للشاشات المنحنية)', 'UV Glass', 6),
  ('anti_blue', 'ضد الضوء الأزرق', 'Anti-blue Light', 7),
  ('camera_lens', 'واقي عدسة الكاميرا', 'Camera Lens Protector', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'protector_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'protocol' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wifi', 'Wi-Fi', 'Wi-Fi', 0),
  ('zigbee', 'Zigbee', 'Zigbee', 1),
  ('bluetooth', 'Bluetooth', 'Bluetooth', 2),
  ('matter', 'Matter', 'Matter', 3),
  ('thread', 'Thread', 'Thread', 4),
  ('z_wave', 'Z-Wave', 'Z-Wave', 5),
  ('modbus', 'Modbus / RS485', 'Modbus / RS485', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'protocol' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'psu_form_factor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('atx', 'ATX', 'ATX', 0),
  ('sfx', 'SFX', 'SFX', 1),
  ('sfx_l', 'SFX-L', 'SFX-L', 2),
  ('tfx', 'TFX', 'TFX', 3),
  ('flex_atx', 'Flex ATX', 'Flex ATX', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'psu_form_factor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pulse_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fava', 'فول', 'Fava beans', 0),
  ('yellow_lentils', 'عدس أصفر', 'Yellow lentils', 1),
  ('brown_lentils', 'عدس بجبة', 'Brown lentils', 2),
  ('chickpeas', 'حمص', 'Chickpeas', 3),
  ('white_beans', 'فاصوليا بيضاء', 'White beans', 4),
  ('black_eyed_peas', 'لوبيا', 'Black-eyed peas', 5),
  ('kidney_beans', 'فاصوليا حمراء', 'Kidney beans', 6),
  ('lupin', 'ترمس', 'Lupin', 7),
  ('split_peas', 'بسلة ناشفة', 'Dried / split peas', 8),
  ('mung', 'ماش', 'Mung beans', 9),
  ('mixed', 'مشكل', 'Mixed', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'pulse_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'pump_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون منفاخ', 'None', 0),
  ('hand_pump', 'منفاخ يدوي', 'Hand Pump', 1),
  ('electric_pump', 'منفاخ كهربائي', 'Electric Pump', 2)) v(code, ar, en, sort)
 where d.code = 'pump_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'نوع شفاط الحليب' where code = 'pump_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('manual', 'يدوي', 'Manual', 0),
  ('electric_plug', 'كهربائي بالسلك', 'Electric (Plug-in)', 1),
  ('electric_rechargeable', 'كهربائي بالشحن', 'Electric (Rechargeable)', 2),
  ('wearable', 'كهربائي يلبس (لاسلكي)', 'Wearable Electric', 3),
  ('silicone_collector', 'سيليكون شفط ذاتي', 'Silicone Collector', 4)) v(code, ar, en, sort)
 where d.code = 'pump_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'purification_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ro', 'تناضح عكسي (RO)', 'Reverse Osmosis (RO)', 0),
  ('uf', 'ألترا فلتريشن (UF)', 'Ultrafiltration (UF)', 1),
  ('sediment', 'فلتر رواسب (PP)', 'Sediment (PP)', 2),
  ('activated_carbon', 'كربون نشط', 'Activated Carbon', 3),
  ('uv', 'أشعة UV', 'UV Sterilization', 4),
  ('mineralizer', 'إضافة أملاح معدنية', 'Mineralizer', 5),
  ('alkaline', 'قلوي (Alkaline)', 'Alkaline', 6),
  ('ceramic', 'سيراميك', 'Ceramic', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'purification_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'rattle_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('handheld', 'شخشيخة يد', 'Handheld Rattle', 0),
  ('teether_rattle', 'شخشيخة وعضاضة', 'Teether Rattle', 1),
  ('wrist_foot', 'سوار يد / شراب رجل', 'Wrist / Foot Rattle', 2),
  ('stroller_hanging', 'معلقة للعربية / السرير', 'Stroller / Crib Hanging', 3),
  ('maraca_shaker', 'ماراكاس / شيكر', 'Maraca / Shaker', 4),
  ('set', 'طقم شخاليل', 'Rattle Set', 5)) v(code, ar, en, sort)
 where d.code = 'rattle_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'razor_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('disposable', 'ماكينة استخدام مرة واحدة', 'Disposable', 0),
  ('cartridge', 'ماكينة برؤوس بديلة', 'Cartridge razor', 1),
  ('safety', 'ماكينة أمان (موس دبل)', 'Safety razor', 2),
  ('straight', 'موس حلاق', 'Straight razor / shavette', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'razor_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'ready_to_use_or_concentrated' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ready', 'جاهز للاستخدام', 'Ready to use', 0),
  ('concentrated', 'مركز (يخفف بالماء)', 'Concentrated (dilute)', 1),
  ('super_concentrated', 'مركز جداً', 'Super concentrated', 2)) v(code, ar, en, sort)
 where d.code = 'ready_to_use_or_concentrated' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'reclining_backrest' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fixed', 'ثابت', 'Fixed', 0),
  ('limited', 'إمالة بسيطة', 'Limited recline', 1),
  ('multi_position', 'أكثر من وضع', 'Multi-position', 2),
  ('lie_flat', 'ينام مفرود بالكامل', 'Lie-flat', 3),
  ('tilt_lock', 'هزاز مع قفل ميل', 'Tilt with lock', 4)) v(code, ar, en, sort)
 where d.code = 'reclining_backrest' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'recorder_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dvr', 'DVR', 'DVR', 0),
  ('nvr', 'NVR', 'NVR', 1),
  ('poe_nvr', 'NVR PoE', 'PoE NVR', 2),
  ('xvr', 'XVR (هجين)', 'XVR Hybrid', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'recorder_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'recyclable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'قابل لإعادة التدوير', 'Recyclable', 0),
  ('recycled', 'مصنوع من مواد معاد تدويرها', 'Made from recycled material', 1),
  ('partial', 'قابل جزئياً', 'Partially recyclable', 2),
  ('no', 'غير قابل', 'Not recyclable', 3)) v(code, ar, en, sort)
 where d.code = 'recyclable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'refill_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bottom_pump', 'تعبئة من الأسفل (ضخ من البخاخ)', 'Bottom pump refill', 0),
  ('screw_top', 'غطاء يفتح وتعبئة مباشرة', 'Screw top', 1),
  ('funnel', 'بقمع', 'Funnel', 2),
  ('syringe_dropper', 'سرنجة / قطارة', 'Syringe / dropper', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'refill_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'removable_cover' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('removable_washable', 'يتشال ويتغسل', 'Removable and Washable', 0),
  ('removable', 'يتشال', 'Removable', 1),
  ('fixed', 'ثابت', 'Fixed', 2)) v(code, ar, en, sort)
 where d.code = 'removable_cover' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'removable_tray' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no_tray', 'بدون صينية', 'No Tray', 0),
  ('fixed', 'صينية ثابتة', 'Fixed Tray', 1),
  ('removable', 'صينية تتشال', 'Removable Tray', 2),
  ('removable_dishwasher', 'تتشال وتدخل غسالة الأطباق', 'Removable, Dishwasher-safe', 3)) v(code, ar, en, sort)
 where d.code = 'removable_tray' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'removes_waterproof_makeup' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'removes_waterproof_makeup' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'replaceable_head' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'replaceable_head' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'requires_electricity' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'لا يحتاج كهرباء', 'No Electricity Needed', 0),
  ('yes_pump', 'يحتاج كهرباء (موتور / طلمبة)', 'Requires Electricity (Pump)', 1),
  ('yes_uv_only', 'كهرباء للمبة UV فقط', 'Electricity for UV Only', 2)) v(code, ar, en, sort)
 where d.code = 'requires_electricity' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'resistance_band_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mini_loop', 'حلقة صغيرة (ميني باند)', 'Mini loop band', 0),
  ('long_loop', 'حلقة طويلة (باور باند)', 'Long loop / pull-up band', 1),
  ('fabric_hip', 'قماش للأرداف (هيب باند)', 'Fabric hip band', 2),
  ('tube_handles', 'أنبوب بمقابض', 'Tube with handles', 3),
  ('flat_therapy', 'شريط مفرود (علاج طبيعي)', 'Flat therapy band', 4),
  ('figure_8', 'شكل 8', 'Figure-8 band', 5),
  ('set', 'طقم متنوع', 'Mixed set', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'resistance_band_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'resistance_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('extra_light', 'خفيف جدًا', 'Extra light', 0),
  ('light', 'خفيف', 'Light', 1),
  ('medium', 'متوسط', 'Medium', 2),
  ('heavy', 'تقيل', 'Heavy', 3),
  ('extra_heavy', 'تقيل جدًا', 'Extra heavy', 4)) v(code, ar, en, sort)
 where d.code = 'resistance_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'resistance_mechanism' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('magnetic', 'مغناطيسي', 'Magnetic', 0),
  ('friction', 'احتكاك (لباد)', 'Friction / felt pad', 1),
  ('electromagnetic', 'كهرومغناطيسي', 'Electromagnetic', 2),
  ('air', 'هواء (مروحة)', 'Air / fan', 3),
  ('belt', 'سير', 'Belt', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'resistance_mechanism' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'resolution' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fhd_1080p', 'Full HD 1080p', 'Full HD 1080p', 0),
  ('qhd_1440p', '2K QHD 1440p', '2K QHD 1440p', 1),
  ('uhd_4k', '4K UHD', '4K UHD', 2),
  ('hd_720p', 'HD 720p', 'HD 720p', 3),
  ('hd_plus', 'HD+', 'HD+', 4),
  ('fhd_plus', 'FHD+', 'FHD+', 5),
  ('qhd_plus', 'QHD+ / 2K+', 'QHD+ / 2K+', 6),
  ('wuxga', 'WUXGA 1920×1200', 'WUXGA 1920x1200', 7),
  ('uwqhd', 'UWQHD 3440×1440', 'UWQHD 3440x1440', 8),
  ('5k', '5K', '5K', 9),
  ('8k', '8K', '8K', 10),
  ('sd_480p', 'SD 480p', 'SD 480p', 11),
  ('mp_2', '2 ميجابكسل (1080p)', '2 MP (1080p)', 12),
  ('mp_3', '3 ميجابكسل', '3 MP', 13),
  ('mp_4', '4 ميجابكسل (2K)', '4 MP (2K)', 14),
  ('mp_5', '5 ميجابكسل', '5 MP', 15),
  ('mp_8', '8 ميجابكسل (4K)', '8 MP (4K)', 16),
  ('other', 'أخرى', 'Other', 17)) v(code, ar, en, sort)
 where d.code = 'resolution' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'reusability' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single_use', 'استخدام مرة واحدة', 'Single-use', 0),
  ('reusable', 'قابل لإعادة الاستخدام والغسيل', 'Reusable / washable', 1)) v(code, ar, en, sort)
 where d.code = 'reusability' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'reusable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('reusable', 'يستخدم أكثر من مرة', 'Reusable', 0),
  ('disposable', 'استعمال مرة واحدة', 'Disposable', 1)) v(code, ar, en, sort)
 where d.code = 'reusable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'rice_variety' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('egyptian', 'مصري (حبة قصيرة)', 'Egyptian short grain', 0),
  ('basmati', 'بسمتي', 'Basmati', 1),
  ('long_grain', 'حبة طويلة (أمريكاني)', 'Long grain', 2),
  ('jasmine', 'ياسمين (تايلاندي)', 'Jasmine', 3),
  ('sella', 'سيلا (مسلوق)', 'Sella / parboiled', 4),
  ('brown', 'أرز بني', 'Brown', 5),
  ('sushi', 'سوشي', 'Sushi', 6),
  ('arborio', 'ريزوتو (أربوريو)', 'Arborio / risotto', 7),
  ('wild', 'أرز بري', 'Wild rice', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'rice_variety' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'ring_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('adjustable', 'مقاس مفتوح (قابل للتعديل)', 'Adjustable', 0),
  ('s14', '14', '14', 1),
  ('s15', '15', '15', 2),
  ('s16', '16', '16', 3),
  ('s17', '17', '17', 4),
  ('s18', '18', '18', 5),
  ('s19', '19', '19', 6),
  ('s20', '20', '20', 7),
  ('s21', '21', '21', 8),
  ('s22', '22', '22', 9),
  ('s23', '23', '23', 10),
  ('s24', '24', '24', 11),
  ('s25', '25', '25', 12),
  ('s26', '26', '26', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'ring_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'rinse_out_or_leave_in' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rinse_out', 'بالشطف', 'Rinse-out', 0),
  ('leave_in', 'بدون شطف', 'Leave-in', 1),
  ('both', 'الطريقتين', 'Both', 2)) v(code, ar, en, sort)
 where d.code = 'rinse_out_or_leave_in' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'rinsing_required' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم، يحتاج شطف', 'Yes, rinse required', 0),
  ('no', 'لا، بدون شطف', 'No-rinse', 1)) v(code, ar, en, sort)
 where d.code = 'rinsing_required' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'roast_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('light', 'فاتح', 'Light', 0),
  ('medium', 'وسط', 'Medium', 1),
  ('medium_dark', 'وسط غامق', 'Medium-dark', 2),
  ('dark', 'غامق', 'Dark', 3),
  ('extra_dark', 'غامق جدًا (إسبريسو)', 'Extra dark / espresso', 4),
  ('blend', 'مخلوط (فاتح + غامق)', 'Mixed roast blend', 5)) v(code, ar, en, sort)
 where d.code = 'roast_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'roller_material_or_coating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ceramic', 'سيراميك', 'Ceramic', 0),
  ('tourmaline', 'تورمالين', 'Tourmaline', 1),
  ('titanium', 'تيتانيوم', 'Titanium', 2),
  ('velvet', 'قطيفة', 'Velvet / flocked', 3),
  ('plastic', 'بلاستيك', 'Plastic', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'roller_material_or_coating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'rope_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('pvc', 'PVC', 'PVC', 0),
  ('coated_steel', 'سلك صلب مغلف', 'Coated steel cable', 1),
  ('beaded', 'خرز بلاستيك', 'Beaded', 2),
  ('cotton', 'قطن', 'Cotton', 3),
  ('nylon', 'نايلون', 'Nylon', 4),
  ('leather', 'جلد', 'Leather', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'rope_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'router_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('home_wifi', 'راوتر واي فاي منزلي', 'Home Wi-Fi router', 0),
  ('adsl_vdsl', 'راوتر ADSL / VDSL (خط أرضي)', 'ADSL / VDSL modem router', 1),
  ('4g_lte', 'راوتر 4G بشريحة', '4G LTE SIM router', 2),
  ('5g', 'راوتر 5G بشريحة', '5G SIM router', 3),
  ('mifi', 'راوتر جيب (MiFi)', 'Pocket MiFi', 4),
  ('mesh', 'نظام Mesh', 'Mesh system', 5),
  ('gaming', 'راوتر جيمنج', 'Gaming router', 6),
  ('fiber', 'راوتر فايبر (ONT)', 'Fiber router (ONT)', 7),
  ('access_point', 'أكسس بوينت', 'Access point', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'router_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sae_viscosity_grade' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('5w30', '5W-30', '5W-30', 0),
  ('5w40', '5W-40', '5W-40', 1),
  ('10w40', '10W-40', '10W-40', 2),
  ('20w50', '20W-50', '20W-50', 3),
  ('15w40', '15W-40', '15W-40', 4),
  ('0w20', '0W-20', '0W-20', 5),
  ('0w30', '0W-30', '0W-30', 6),
  ('0w40', '0W-40', '0W-40', 7),
  ('5w20', '5W-20', '5W-20', 8),
  ('10w30', '10W-30', '10W-30', 9),
  ('10w60', '10W-60', '10W-60', 10),
  ('sae_40', 'SAE 40', 'SAE 40', 11),
  ('sae_50', 'SAE 50', 'SAE 50', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'sae_viscosity_grade' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'safety_certification' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ce', 'CE', 'CE', 0),
  ('en71', 'EN71 (أوروبي للألعاب)', 'EN71', 1),
  ('astm_f963', 'ASTM F963 (أمريكي)', 'ASTM F963', 2),
  ('cpsia_cpc', 'CPSIA / CPC', 'CPSIA / CPC', 3),
  ('iso_8124', 'ISO 8124', 'ISO 8124', 4),
  ('eos', 'هيئة المواصفات المصرية', 'Egyptian Standards (EOS)', 5),
  ('bpa_free', 'خالي من BPA', 'BPA Free', 6),
  ('fda', 'FDA (ملامس للطعام)', 'FDA (Food Contact)', 7),
  ('ukca', 'UKCA', 'UKCA', 8),
  ('none', 'بدون شهادة معلنة', 'Not Declared', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'safety_certification' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'safety_lid_lock' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون قفل', 'No Lock', 0),
  ('mechanical', 'قفل يدوي', 'Manual Lock', 1),
  ('pressure_auto', 'قفل أوتوماتيك مع الضغط', 'Automatic Pressure Lock', 2),
  ('multi_safety', 'قفل + أنظمة أمان متعددة', 'Lock + Multiple Safety Systems', 3)) v(code, ar, en, sort)
 where d.code = 'safety_lid_lock' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'safety_locking_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('lid_lock', 'قفل الغطاء تحت الضغط', 'Lid lock under pressure', 0),
  ('safety_valve', 'صمام أمان', 'Safety valve', 1),
  ('gasket_window', 'فتحة أمان بالجوان', 'Gasket release window', 2),
  ('pressure_indicator', 'مؤشر الضغط', 'Pressure indicator', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'safety_locking_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'salt_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('refined_table', 'ملح طعام مكرر', 'Refined table salt', 0),
  ('sea', 'ملح بحري', 'Sea salt', 1),
  ('himalayan', 'ملح هيمالايا الوردي', 'Himalayan pink', 2),
  ('rock', 'ملح صخري', 'Rock salt', 3),
  ('coarse', 'ملح خشن', 'Coarse salt', 4),
  ('low_sodium', 'قليل الصوديوم', 'Low sodium', 5),
  ('black', 'ملح أسود', 'Black salt', 6),
  ('flavored', 'ملح بالنكهات', 'Flavored salt', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'salt_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sauce_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ketchup', 'كاتشب', 'Ketchup', 0),
  ('mayonnaise', 'مايونيز', 'Mayonnaise', 1),
  ('mustard', 'مسطردة', 'Mustard', 2),
  ('hot_sauce', 'صوص حار (شطة)', 'Hot sauce', 3),
  ('bbq', 'باربكيو', 'BBQ', 4),
  ('sweet_chili', 'سويت تشيلي', 'Sweet chili', 5),
  ('garlic', 'ثومية', 'Garlic sauce', 6),
  ('tahini_sauce', 'صوص طحينة', 'Tahini sauce', 7),
  ('ranch', 'رانش', 'Ranch', 8),
  ('soy', 'صويا', 'Soy sauce', 9),
  ('pasta_sauce', 'صوص مكرونة', 'Pasta sauce', 10),
  ('pesto', 'بيستو', 'Pesto', 11),
  ('worcestershire', 'وورسيسترشاير', 'Worcestershire', 12),
  ('cheese_sauce', 'صوص جبنة', 'Cheese sauce', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'sauce_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'scale_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('digital', 'ديجيتال', 'Digital', 0),
  ('mechanical', 'ميكانيكي (زنبرك)', 'Mechanical Spring', 1)) v(code, ar, en, sort)
 where d.code = 'scale_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'scanner_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('flatbed', 'مسطح (Flatbed)', 'Flatbed', 0),
  ('sheetfed', 'بتغذية أوراق (ADF)', 'Sheet-fed / ADF', 1),
  ('portable', 'محمول / يدوي', 'Portable / handheld', 2),
  ('photo_film', 'صور وأفلام', 'Photo / film', 3),
  ('book', 'كتب', 'Book scanner', 4),
  ('barcode', 'باركود', 'Barcode', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'scanner_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'scent' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unscented', 'بدون رائحة', 'Unscented', 0),
  ('lemon', 'ليمون', 'Lemon', 1),
  ('lavender', 'لافندر', 'Lavender', 2),
  ('pine', 'صنوبر', 'Pine', 3),
  ('rose', 'ورد', 'Rose', 4),
  ('jasmine', 'ياسمين', 'Jasmine', 5),
  ('floral', 'زهور', 'Floral', 6),
  ('fresh', 'انتعاش / نسيم البحر', 'Fresh / Ocean', 7),
  ('apple', 'تفاح', 'Apple', 8),
  ('eucalyptus', 'كافور / أوكالبتوس', 'Eucalyptus', 9),
  ('baby', 'رائحة أطفال', 'Baby scent', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'scent' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'scented' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unscented', 'بدون رائحة', 'Unscented', 0),
  ('lightly', 'رائحة خفيفة', 'Lightly scented', 1),
  ('scented', 'معطرة', 'Scented', 2)) v(code, ar, en, sort)
 where d.code = 'scented' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'scissor_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cutting', 'مقص قص', 'Cutting', 0),
  ('thinning', 'مقص تخفيف (فيليه)', 'Thinning', 1),
  ('texturizing', 'مقص تشكيل', 'Texturizing', 2),
  ('set', 'طقم قص وتخفيف', 'Cutting and thinning set', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'scissor_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'screwdriver_tip_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('slotted', 'عادي (مسطح)', 'Slotted / flat', 0),
  ('phillips', 'صليبة (PH)', 'Phillips (PH)', 1),
  ('pozidriv', 'بوزي (PZ)', 'Pozidriv (PZ)', 2),
  ('torx', 'نجمة (Torx)', 'Torx', 3),
  ('hex', 'ألن (سداسي)', 'Hex', 4),
  ('square', 'مربع (Robertson)', 'Square', 5),
  ('tri_wing', 'Tri-wing', 'Tri-wing', 6),
  ('pentalobe', 'Pentalobe', 'Pentalobe', 7),
  ('y_type', 'Y', 'Y-type', 8),
  ('spanner', 'شوكة (Spanner)', 'Spanner', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'screwdriver_tip_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'scrub_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('sugar', 'سكر', 'Sugar', 0),
  ('salt', 'ملح', 'Salt', 1),
  ('coffee', 'قهوة', 'Coffee', 2),
  ('apricot_walnut', 'مشمش / جوز', 'Apricot / walnut', 3),
  ('oatmeal', 'شوفان', 'Oatmeal', 4),
  ('moroccan', 'صابون مغربي (بلدي)', 'Moroccan black soap', 5),
  ('chemical', 'أحماض (كيميائي)', 'Chemical', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'scrub_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'season_classification' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('summer', 'صيفي', 'Summer', 0),
  ('all_season', 'كل المواسم', 'All-season', 1),
  ('winter', 'شتوي', 'Winter', 2),
  ('all_terrain', 'كل الطرق (All-Terrain)', 'All-terrain', 3)) v(code, ar, en, sort)
 where d.code = 'season_classification' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'seasoning_or_flavor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('unsalted', 'سادة بدون ملح', 'Unsalted', 0),
  ('salted', 'بالملح', 'Salted', 1),
  ('lemon_salt', 'ليمون وملح', 'Lemon & salt', 2),
  ('spicy', 'حار (شطة)', 'Spicy chili', 3),
  ('bbq', 'باربكيو', 'BBQ', 4),
  ('cheese', 'جبنة', 'Cheese', 5),
  ('smoked', 'مدخن', 'Smoked', 6),
  ('honey', 'عسل', 'Honey', 7),
  ('chocolate', 'شوكولاتة', 'Chocolate', 8),
  ('sugar_coated', 'مسكر', 'Sugar coated', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'seasoning_or_flavor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'seat_belt' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون حزام', 'No Seat Belt', 0),
  ('lap_belt', 'حزام وسط', 'Lap Belt', 1),
  ('3_point', 'حزام 3 نقاط', '3-point Harness', 2),
  ('5_point', 'حزام 5 نقاط', '5-point Harness', 3)) v(code, ar, en, sort)
 where d.code = 'seat_belt' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'seat_coverage' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_5', 'طقم كامل 5 مقاعد', 'Full set (5 seats)', 0),
  ('front_2', 'المقعدين الأماميين', 'Front 2 seats', 1),
  ('rear_bench', 'الكنبة الخلفية', 'Rear bench', 2),
  ('full_7', '7 مقاعد', '7 seats', 3),
  ('single', 'مقعد واحد', 'Single seat', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'seat_coverage' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'seat_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wood', 'خشب', 'Wood', 0),
  ('metal', 'معدن', 'Metal', 1),
  ('plastic', 'بلاستيك', 'Plastic', 2),
  ('fabric', 'قماش', 'Fabric', 3),
  ('velvet', 'قطيفة', 'Velvet', 4),
  ('faux_leather', 'جلد صناعي', 'Faux leather', 5),
  ('leather', 'جلد طبيعي', 'Genuine leather', 6),
  ('rattan', 'خوص / راتان', 'Rattan / Wicker', 7),
  ('mesh', 'شبك (ميش)', 'Mesh', 8),
  ('oxford', 'قماش أكسفورد / بوليستر', 'Oxford / Polyester', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'seat_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'seat_upholstery_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('mesh', 'شبك (ميش)', 'Mesh', 0),
  ('fabric', 'قماش', 'Fabric', 1),
  ('faux_leather', 'جلد صناعي PU', 'Faux leather (PU)', 2),
  ('leather', 'جلد طبيعي', 'Genuine leather', 3),
  ('velvet', 'قطيفة', 'Velvet', 4),
  ('pvc', 'جلد PVC', 'PVC leather', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'seat_upholstery_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'seating_orientation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rear_facing', 'عكس اتجاه السير', 'Rear-facing', 0),
  ('forward_facing', 'مع اتجاه السير', 'Forward-facing', 1),
  ('both', 'الاتجاهين', 'Rear & forward facing', 2),
  ('rotating_360', 'دوار 360', '360 rotating', 3)) v(code, ar, en, sort)
 where d.code = 'seating_orientation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'security' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wpa3', 'WPA3', 'WPA3', 0),
  ('wpa2', 'WPA2', 'WPA2', 1),
  ('wpa', 'WPA', 'WPA', 2),
  ('firewall', 'جدار حماية (Firewall)', 'Firewall', 3),
  ('vpn', 'VPN', 'VPN', 4),
  ('parental', 'رقابة أبوية', 'Parental controls', 5),
  ('guest', 'شبكة ضيوف', 'Guest network', 6),
  ('antivirus', 'حماية من الفيروسات', 'Built-in antivirus', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'security' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sensor_size' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_frame', 'فل فريم', 'Full Frame', 0),
  ('aps_c', 'APS-C', 'APS-C', 1),
  ('mft', 'مايكرو فور ثيردز', 'Micro Four Thirds', 2),
  ('one_inch', '1 بوصة', '1-inch', 3),
  ('inch_1_1_3', '1/1.3 بوصة', '1/1.3-inch', 4),
  ('inch_1_1_7', '1/1.7 بوصة', '1/1.7-inch', 5),
  ('inch_1_2_3', '1/2.3 بوصة', '1/2.3-inch', 6),
  ('medium_format', 'ميديم فورمات', 'Medium Format', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'sensor_size' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'shackle_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('metal', 'حلقة معدن صلبة', 'Metal Shackle', 0),
  ('steel_cable', 'سلك ستيل', 'Steel Cable', 1),
  ('flexible_cable', 'سلك مرن مغلف', 'Flexible Coated Cable', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'shackle_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'shaft_and_tip_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('chrome_vanadium', 'كروم فاناديوم (CrV)', 'Chrome vanadium (CrV)', 0),
  ('s2', 'صلب S2', 'S2 steel', 1),
  ('chrome_molybdenum', 'كروم موليبدينوم (CrMo)', 'Chrome molybdenum', 2),
  ('carbon_steel', 'صلب كربوني', 'Carbon steel', 3),
  ('stainless', 'ستانلس ستيل', 'Stainless steel', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'shaft_and_tip_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rectangular', 'مستطيل', 'Rectangular', 0),
  ('round', 'دائري', 'Round', 1),
  ('square', 'مربع', 'Square', 2),
  ('oval', 'بيضاوي', 'Oval', 3),
  ('runner', 'ممر (طويل ورفيع)', 'Runner', 4),
  ('semicircle', 'نصف دائرة', 'Semicircle', 5),
  ('octagon', 'مثمن', 'Octagon', 6),
  ('heart', 'قلب', 'Heart', 7),
  ('irregular', 'شكل غير منتظم', 'Irregular', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'shaving_system' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('foil', 'شبكة (فويل)', 'Foil', 0),
  ('rotary', 'رؤوس دوارة', 'Rotary', 1),
  ('hybrid', 'هايبرد (حلاقة وتهذيب)', 'Hybrid blade', 2)) v(code, ar, en, sort)
 where d.code = 'shaving_system' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sheet_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fitted', 'ملاية بأستك', 'Fitted sheet', 0),
  ('flat', 'ملاية مفرودة', 'Flat sheet', 1),
  ('fitted_set', 'طقم بأستك + كيسان مخدات', 'Fitted set with pillowcases', 2),
  ('flat_set', 'طقم مفرود + كيسان مخدات', 'Flat set with pillowcases', 3),
  ('full_set', 'طقم كامل (بأستك + مفرودة + مخدات)', 'Full set (fitted + flat + pillowcases)', 4),
  ('duvet_cover_set', 'طقم كفر لحاف', 'Duvet cover set', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'sheet_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'shell_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('abs', 'بلاستيك ABS', 'ABS', 0),
  ('polycarbonate', 'بولي كربونات', 'Polycarbonate', 1),
  ('fiberglass', 'فايبر جلاس', 'Fiberglass', 2),
  ('composite', 'ألياف مركبة (كومبوزيت)', 'Composite fiber', 3),
  ('carbon_fiber', 'كاربون فايبر', 'Carbon fiber', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'shell_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'shell_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hard_polycarbonate', 'صلب بولي كربونات', 'Hard Polycarbonate', 0),
  ('hard_abs', 'صلب ABS', 'Hard ABS', 1),
  ('hard_pp', 'صلب PP', 'Hard Polypropylene', 2),
  ('aluminum', 'ألومنيوم', 'Aluminum', 3),
  ('soft_fabric', 'قماش (سوفت)', 'Soft Fabric', 4),
  ('hybrid', 'هجين (صلب وقماش)', 'Hybrid', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'shell_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'silhouette' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('a_line', 'قصة A (كلوش خفيف)', 'A-line', 0),
  ('fit_flare', 'ضيق من فوق وكلوش من تحت', 'Fit & Flare', 1),
  ('bodycon', 'ضيق محدد (بودي كون)', 'Bodycon', 2),
  ('sheath', 'شيث (مستقيم محدد)', 'Sheath', 3),
  ('straight_shift', 'مستقيم واسع (شيفت)', 'Straight / Shift', 4),
  ('mermaid', 'حورية (ميرميد)', 'Mermaid', 5),
  ('ball_gown', 'منفوش (بال جاون / برنسيس)', 'Ball Gown / Princess', 6),
  ('empire', 'إمباير (وسط عالي)', 'Empire Waist', 7),
  ('wrap', 'ملفوف (راب)', 'Wrap', 8),
  ('slip', 'سليب (حمالات)', 'Slip', 9),
  ('kaftan_loose', 'واسع (قفطان)', 'Loose / Kaftan', 10),
  ('trapeze', 'ترابيز', 'Trapeze', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'silhouette' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sim_card_support' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'لا يدعم شريحة', 'No SIM support', 0),
  ('4g', 'شريحة 4G', '4G SIM', 1),
  ('5g', 'شريحة 5G', '5G SIM', 2),
  ('dual_sim', 'شريحتين', 'Dual SIM', 3),
  ('esim', 'eSIM', 'eSIM', 4)) v(code, ar, en, sort)
 where d.code = 'sim_card_support' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'single_or_double_pumping' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single', 'ثدي واحد', 'Single', 0),
  ('double', 'الثديين معًا', 'Double', 1),
  ('convertible', 'قابل للتحويل', 'Convertible', 2)) v(code, ar, en, sort)
 where d.code = 'single_or_double_pumping' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'الاستخدام' where code = 'single_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single_use', 'للاستخدام مرة واحدة', 'Single use', 0),
  ('reusable', 'قابل لإعادة الاستخدام', 'Reusable', 1)) v(code, ar, en, sort)
 where d.code = 'single_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'size_class' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('liner', 'صغير (يومي)', 'Liner', 0),
  ('normal', 'عادي', 'Normal', 1),
  ('long', 'طويل', 'Long', 2),
  ('extra_long', 'طويل جداً', 'Extra long', 3),
  ('night', 'ليلي', 'Night', 4)) v(code, ar, en, sort)
 where d.code = 'size_class' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'skate_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('quad', 'باتيناج 4 عجل (كواد)', 'Quad Roller Skates', 0),
  ('inline', 'عجل في خط واحد (إن لاين)', 'Inline Skates', 1),
  ('adjustable_kids', 'باتيناج أطفال بمقاس متغير', 'Adjustable Kids Skates', 2),
  ('ice', 'تزلج على الجليد', 'Ice Skates', 3),
  ('heel_wheels', 'حذاء بعجل في الكعب', 'Heel Wheel Shoes', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'skate_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'skin_tone_sensor' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('auto', 'مستشعر تلقائي يضبط الطاقة', 'Automatic sensor', 0),
  ('safety_only', 'مستشعر أمان فقط', 'Safety sensor only', 1),
  ('none', 'بدون مستشعر', 'None', 2)) v(code, ar, en, sort)
 where d.code = 'skin_tone_sensor' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'skin_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all', 'كل أنواع البشرة', 'All skin types', 0),
  ('normal', 'عادية', 'Normal', 1),
  ('dry', 'جافة', 'Dry', 2),
  ('oily', 'دهنية', 'Oily', 3),
  ('combination', 'مختلطة', 'Combination', 4),
  ('sensitive', 'حساسة', 'Sensitive', 5),
  ('acne_prone', 'معرضة للحبوب', 'Acne-prone', 6),
  ('mature', 'ناضجة', 'Mature', 7)) v(code, ar, en, sort)
 where d.code = 'skin_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'skipping_rope_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('speed', 'سرعة', 'Speed rope', 0),
  ('weighted', 'تقيل (بأوزان)', 'Weighted', 1),
  ('beaded', 'بالخرز', 'Beaded', 2),
  ('cordless', 'بدون حبل', 'Cordless', 3),
  ('smart_counter', 'بعداد ذكي', 'Smart / with counter', 4),
  ('kids', 'أطفال', 'Kids', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'skipping_rope_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'smart_tv' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('smart', 'سمارت (متصل بالإنترنت)', 'Smart TV', 0),
  ('not_smart', 'عادي (غير سمارت)', 'Non-smart', 1)) v(code, ar, en, sort)
 where d.code = 'smart_tv' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'snack_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('potato_chips', 'شيبسي بطاطس', 'Potato chips', 0),
  ('corn_tortilla', 'شيبسي ذرة / تورتيلا', 'Corn / tortilla chips', 1),
  ('puffs', 'كرانشي / منفوخ', 'Puffs / extruded', 2),
  ('baked', 'مخبوز (بيك)', 'Baked chips', 3),
  ('popcorn', 'فشار', 'Popcorn', 4),
  ('pretzels', 'بريتزل', 'Pretzels', 5),
  ('crackers', 'كراكرز / مقرمشات', 'Crackers', 6),
  ('rice_cakes', 'كيك أرز', 'Rice cakes', 7),
  ('bread_sticks', 'عيش محمص / بقسماط', 'Bread sticks / rusks', 8),
  ('vegetable_chips', 'شيبسي خضار', 'Vegetable chips', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'snack_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sofa_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('three_seater', 'كنبة 3 مقاعد', '3-seater', 0),
  ('two_seater', 'كنبة مقعدين', '2-seater', 1),
  ('corner_l', 'ركنة على شكل L', 'L-shaped corner', 2),
  ('corner_u', 'ركنة على شكل U', 'U-shaped corner', 3),
  ('sofa_bed', 'كنبة سرير', 'Sofa bed', 4),
  ('recliner', 'كنبة ريكلاينر', 'Recliner sofa', 5),
  ('chesterfield', 'شيسترفيلد', 'Chesterfield', 6),
  ('modular', 'موديولار (قطع منفصلة)', 'Modular', 7),
  ('chaise', 'شيزلونج', 'Chaise lounge', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'sofa_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sole_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rubber', 'كاوتش / مطاط', 'Rubber', 0),
  ('eva', 'EVA', 'EVA', 1),
  ('tpr', 'TPR', 'TPR', 2),
  ('pu', 'بولي يوريثان PU', 'PU', 3),
  ('tpu', 'TPU', 'TPU', 4),
  ('phylon', 'فايلون', 'Phylon', 5),
  ('leather', 'جلد طبيعي', 'Leather', 6),
  ('crepe', 'كريب', 'Crepe', 7),
  ('cork', 'فلين', 'Cork', 8),
  ('pvc', 'بلاستيك PVC', 'PVC', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'sole_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'soleplate_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ceramic', 'سيراميك', 'Ceramic', 0),
  ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 1),
  ('non_stick', 'تيفال (غير لاصق)', 'Non-stick', 2),
  ('aluminum', 'ألومنيوم', 'Aluminum', 3),
  ('titanium', 'تيتانيوم', 'Titanium', 4),
  ('anodized', 'ألومنيوم مؤكسد (أنودايز)', 'Anodized Aluminum', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'soleplate_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sound_or_lights' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون صوت أو إضاءة', 'None', 0),
  ('music', 'موسيقى فقط', 'Music Only', 1),
  ('lights', 'إضاءة فقط', 'Lights Only', 2),
  ('music_lights', 'موسيقى وإضاءة', 'Music & Lights', 3),
  ('kick_piano', 'بيانو بالرجل + موسيقى وإضاءة', 'Kick Piano + Music & Lights', 4)) v(code, ar, en, sort)
 where d.code = 'sound_or_lights' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'speaker_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('portable_bluetooth', 'سماعة بلوتوث محمولة', 'Portable Bluetooth', 0),
  ('party', 'سماعة حفلات (بارتي بوكس)', 'Party Speaker', 1),
  ('bookshelf', 'سماعة رف (بوك شيلف)', 'Bookshelf', 2),
  ('floor_standing', 'سماعة أرضية (تاور)', 'Floor-standing', 3),
  ('computer', 'سماعة كمبيوتر', 'Computer Speakers', 4),
  ('soundbar', 'ساوند بار', 'Soundbar', 5),
  ('subwoofer', 'صب ووفر', 'Subwoofer', 6),
  ('smart', 'سماعة ذكية', 'Smart Speaker', 7),
  ('ceiling_wall', 'سماعة سقف / حائط', 'Ceiling / Wall', 8),
  ('pa_active', 'سماعة PA / مسرح', 'PA / Stage Speaker', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'speaker_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'speed_class_ratings' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('class_10', 'Class 10', 'Class 10', 0),
  ('u1', 'UHS-I U1', 'UHS-I U1', 1),
  ('u3', 'UHS-I U3', 'UHS-I U3', 2),
  ('v10', 'V10', 'V10', 3),
  ('v30', 'V30', 'V30', 4),
  ('v60', 'V60', 'V60', 5),
  ('v90', 'V90', 'V90', 6),
  ('a1', 'A1', 'A1', 7),
  ('a2', 'A2', 'A2', 8),
  ('uhs_ii', 'UHS-II', 'UHS-II', 9),
  ('cfexpress', 'CFexpress', 'CFexpress', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'speed_class_ratings' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'speed_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('opt_h', 'H (حتى 210 كم/س)', 'H (210 km/h)', 0),
  ('opt_v', 'V (حتى 240 كم/س)', 'V (240 km/h)', 1),
  ('opt_t', 'T (حتى 190 كم/س)', 'T (190 km/h)', 2),
  ('opt_s', 'S (حتى 180 كم/س)', 'S (180 km/h)', 3),
  ('opt_w', 'W (حتى 270 كم/س)', 'W (270 km/h)', 4),
  ('opt_y', 'Y (حتى 300 كم/س)', 'Y (300 km/h)', 5),
  ('zr', 'ZR / (Y)', 'ZR', 6),
  ('opt_r', 'R (حتى 170 كم/س)', 'R (170 km/h)', 7),
  ('opt_q', 'Q (حتى 160 كم/س)', 'Q (160 km/h)', 8),
  ('opt_p', 'P (حتى 150 كم/س)', 'P (150 km/h)', 9),
  ('opt_n', 'N (حتى 140 كم/س)', 'N (140 km/h)', 10),
  ('l_m', 'L / M (موتوسيكلات ونقل خفيف)', 'L / M', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'speed_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'speed_settings' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single', 'سرعة واحدة', 'Single Speed', 0),
  ('2_3', '2 - 3 سرعات', '2-3 Speeds', 1),
  ('opt_5', '5 سرعات', '5 Speeds', 2),
  ('6_7', '6 - 7 سرعات', '6-7 Speeds', 3),
  ('10_plus', '10 سرعات أو أكثر', '10+ Speeds', 4),
  ('variable', 'سرعة متغيرة (دواسة / منظم)', 'Variable Speed', 5),
  ('with_turbo', 'سرعات + تيربو', 'Speeds + Turbo', 6)) v(code, ar, en, sort)
 where d.code = 'speed_settings' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'spf_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون SPF', 'No SPF', 0),
  ('spf15', 'SPF 15', 'SPF 15', 1),
  ('spf20', 'SPF 20', 'SPF 20', 2),
  ('spf30', 'SPF 30', 'SPF 30', 3),
  ('spf40', 'SPF 40', 'SPF 40', 4),
  ('spf50', 'SPF 50', 'SPF 50', 5),
  ('spf50_plus', 'SPF 50+', 'SPF 50+', 6),
  ('spf100', 'SPF 100', 'SPF 100', 7)) v(code, ar, en, sort)
 where d.code = 'spf_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'spice_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('whole', 'حب (صحيح)', 'Whole', 0),
  ('ground', 'مطحون', 'Ground', 1),
  ('crushed', 'مجروش', 'Crushed', 2),
  ('flakes', 'رقائق', 'Flakes', 3),
  ('dried_leaves', 'أوراق مجففة', 'Dried leaves', 4),
  ('paste', 'معجون', 'Paste', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'spice_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'spice_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('not_spicy', 'غير حار', 'Not spicy', 0),
  ('mild', 'حار خفيف', 'Mild', 1),
  ('medium', 'حار متوسط', 'Medium', 2),
  ('hot', 'حار', 'Hot', 3),
  ('extra_hot', 'حار جدًا', 'Extra hot', 4)) v(code, ar, en, sort)
 where d.code = 'spice_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'spice_or_blend_name' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cumin', 'كمون', 'Cumin', 0),
  ('black_pepper', 'فلفل أسود', 'Black pepper', 1),
  ('coriander', 'كزبرة', 'Coriander', 2),
  ('paprika', 'بابريكا', 'Paprika', 3),
  ('chili', 'شطة / فلفل حار', 'Chili', 4),
  ('turmeric', 'كركم', 'Turmeric', 5),
  ('cinnamon', 'قرفة', 'Cinnamon', 6),
  ('cardamom', 'حبهان', 'Cardamom', 7),
  ('ginger', 'جنزبيل', 'Ginger', 8),
  ('cloves', 'قرنفل', 'Cloves', 9),
  ('bay_leaves', 'ورق لورا', 'Bay leaves', 10),
  ('nutmeg', 'جوزة الطيب', 'Nutmeg', 11),
  ('oregano', 'أوريجانو', 'Oregano', 12),
  ('sumac', 'سماق', 'Sumac', 13),
  ('zaatar', 'زعتر', 'Za''atar', 14),
  ('seven_spices', 'سبع بهارات', 'Seven spices', 15),
  ('mixed_spices', 'بهارات مشكلة', 'Mixed spices', 16),
  ('kofta_meat', 'بهارات كفتة ولحوم', 'Kofta / meat spices', 17),
  ('chicken', 'بهارات فراخ', 'Chicken seasoning', 18),
  ('fish', 'بهارات سمك', 'Fish seasoning', 19),
  ('kabsa_mandi', 'بهارات كبسة / مندي', 'Kabsa / mandi', 20),
  ('shawarma', 'بهارات شاورما', 'Shawarma', 21),
  ('curry', 'كاري', 'Curry', 22),
  ('dukkah', 'دقة', 'Dukkah', 23),
  ('other', 'أخرى', 'Other', 24)) v(code, ar, en, sort)
 where d.code = 'spice_or_blend_name' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'spindle_thread' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('m14', 'M14', 'M14', 0),
  ('m10', 'M10', 'M10', 1),
  ('m16', 'M16', 'M16', 2),
  ('unc_5_8', '5/8-11 UNC', '5/8-11 UNC', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'spindle_thread' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'sport' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('football', 'كرة قدم', 'Football', 0),
  ('futsal', 'كرة صالات / نجيلة صناعي', 'Futsal / turf', 1),
  ('tennis', 'تنس', 'Tennis', 2),
  ('padel', 'بادل', 'Padel', 3),
  ('squash', 'إسكواش', 'Squash', 4),
  ('basketball', 'كرة سلة', 'Basketball', 5),
  ('volleyball', 'كرة طائرة', 'Volleyball', 6),
  ('handball', 'كرة يد', 'Handball', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'sport' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sport_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gym_training', 'جيم وتمارين', 'Gym & Training', 0),
  ('running', 'جري', 'Running', 1),
  ('football', 'كرة قدم', 'Football', 2),
  ('basketball', 'كرة سلة', 'Basketball', 3),
  ('tennis_padel', 'تنس / بادل', 'Tennis / Padel', 4),
  ('cycling', 'دراجات', 'Cycling', 5),
  ('yoga', 'يوجا / بيلاتس', 'Yoga / Pilates', 6),
  ('martial_arts', 'فنون قتالية / ملاكمة', 'Martial Arts / Boxing', 7),
  ('swimming', 'سباحة', 'Swimming', 8),
  ('multi_sport', 'متعدد الرياضات', 'Multi-sport', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'sport_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'spray_pattern' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('continuous_mist', 'رذاذ مستمر ناعم', 'Continuous fine mist', 0),
  ('fine_mist', 'رذاذ ناعم', 'Fine mist', 1),
  ('jet', 'رشة مباشرة', 'Jet / stream', 2),
  ('adjustable', 'قابل للتعديل', 'Adjustable', 3)) v(code, ar, en, sort)
 where d.code = 'spray_pattern' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'squeegee_blade_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('rubber', 'كاوتش (مطاط)', 'Rubber', 0),
  ('silicone', 'سيليكون', 'Silicone', 1),
  ('plastic_pvc', 'بلاستيك PVC', 'PVC Plastic', 2),
  ('microfiber_combo', 'مطاط + سفنجة مايكروفايبر', 'Rubber + Microfiber Pad', 3)) v(code, ar, en, sort)
 where d.code = 'squeegee_blade_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'start_stop_compatibility' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير متوافقة', 'Not compatible', 0),
  ('efb', 'متوافقة (EFB)', 'Compatible (EFB)', 1),
  ('agm', 'متوافقة (AGM)', 'Compatible (AGM)', 2)) v(code, ar, en, sort)
 where d.code = 'start_stop_compatibility' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'steam_release_mechanism' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('weighted', 'صفارة بثقل (تقليدي)', 'Weighted valve (jiggler)', 0),
  ('spring_adjustable', 'صمام زنبركي بدرجات', 'Adjustable spring valve', 1),
  ('quick_release', 'زر تفريغ سريع', 'Quick-release button', 2),
  ('natural', 'تفريغ طبيعي فقط', 'Natural release only', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'steam_release_mechanism' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'steam_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hot', 'بخار ساخن', 'Hot steam', 0),
  ('cold', 'رذاذ بارد', 'Cold mist', 1),
  ('nano_ionic', 'نانو أيوني', 'Nano ionic', 2),
  ('ozone', 'أوزون', 'Ozone', 3),
  ('aromatherapy', 'أروما (زيوت عطرية)', 'Aromatherapy', 4)) v(code, ar, en, sort)
 where d.code = 'steam_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'steamer_design' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('handheld', 'محمول باليد', 'Handheld', 0),
  ('standing_pole', 'واقف بعمود وشماعة', 'Standing with Pole', 1),
  ('steam_station', 'محطة بخار بلوح كي', 'Steam Station with Board', 2)) v(code, ar, en, sort)
 where d.code = 'steamer_design' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'steamer_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('standing_hood', 'بخار على حامل (صالونات)', 'Standing hood', 0),
  ('tabletop', 'على الترابيزة', 'Tabletop', 1),
  ('cap', 'كاب بخار حراري', 'Thermal cap', 2),
  ('handheld', 'محمول باليد', 'Handheld', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'steamer_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'sterilization_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('electric_steam', 'بخار كهربائي', 'Electric Steam', 0),
  ('microwave_steam', 'بخار في الميكروويف', 'Microwave Steam', 1),
  ('uv', 'أشعة UV', 'UV Light', 2),
  ('boiling', 'غلي', 'Boiling', 3),
  ('cold_water', 'أقراص / سائل تعقيم', 'Cold-water Tablets', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'sterilization_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'stone_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون أحجار', 'No Stones', 0),
  ('zircon', 'زركون', 'Zircon (CZ)', 1),
  ('crystal', 'كريستال', 'Crystal', 2),
  ('diamond', 'ألماظ', 'Diamond', 3),
  ('moissanite', 'مويسانيت', 'Moissanite', 4),
  ('pearl', 'لؤلؤ', 'Pearl', 5),
  ('turquoise', 'فيروز', 'Turquoise', 6),
  ('emerald', 'زمرد', 'Emerald', 7),
  ('ruby', 'ياقوت أحمر', 'Ruby', 8),
  ('sapphire', 'ياقوت أزرق (صفير)', 'Sapphire', 9),
  ('amethyst', 'جمشت (أميثيست)', 'Amethyst', 10),
  ('agate', 'عقيق', 'Agate', 11),
  ('onyx', 'أونيكس', 'Onyx', 12),
  ('opal', 'أوبال', 'Opal', 13),
  ('coral', 'مرجان', 'Coral', 14),
  ('amber', 'كهرمان', 'Amber', 15),
  ('lapis', 'لازورد', 'Lapis Lazuli', 16),
  ('tiger_eye', 'عين النمر', 'Tiger''s Eye', 17),
  ('rhinestone', 'فصوص لامعة (راينستون)', 'Rhinestone', 18),
  ('glass', 'زجاج', 'Glass', 19),
  ('other', 'أخرى', 'Other', 20)) v(code, ar, en, sort)
 where d.code = 'stone_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'storage' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gb_32', '32 جيجا', '32 GB', 0),
  ('gb_64', '64 جيجا', '64 GB', 1),
  ('gb_128', '128 جيجا', '128 GB', 2),
  ('gb_256', '256 جيجا', '256 GB', 3),
  ('gb_512', '512 جيجا', '512 GB', 4),
  ('tb_1', '1 تيرا', '1 TB', 5),
  ('tb_2', '2 تيرا', '2 TB', 6),
  ('tb_4', '4 تيرا', '4 TB', 7),
  ('tb_8', '8 تيرا وأكثر', '8 TB+', 8),
  ('gb_16', '16 جيجا', '16 GB', 9),
  ('gb_8', '8 جيجا أو أقل', '8 GB or less', 10),
  ('gb_825', '825 جيجا', '825 GB', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'storage' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'storage_condition_before_opening' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('room_temperature', 'درجة حرارة الغرفة', 'Room temperature', 0),
  ('refrigerated', 'في التلاجة', 'Refrigerated', 1),
  ('frozen', 'مجمد', 'Frozen', 2)) v(code, ar, en, sort)
 where d.code = 'storage_condition_before_opening' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'storage_conditions' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cool_dry', 'مكان بارد وجاف', 'Cool dry place', 0),
  ('room_temperature', 'درجة حرارة الغرفة', 'Room temperature', 1),
  ('away_from_sunlight', 'بعيدًا عن الشمس', 'Away from direct sunlight', 2),
  ('refrigerated', 'في التلاجة (2-8°م)', 'Refrigerated (2-8°C)', 3),
  ('frozen', 'في الفريزر (-18°م)', 'Frozen (-18°C)', 4),
  ('refrigerate_after_opening', 'يحفظ في التلاجة بعد الفتح', 'Refrigerate after opening', 5),
  ('airtight_after_opening', 'يقفل كويس بعد الفتح', 'Keep sealed after opening', 6),
  ('away_from_children', 'بعيدًا عن متناول الأطفال', 'Keep out of reach of children', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'storage_conditions' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'storage_drive_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ssd_nvme', 'SSD NVMe', 'NVMe SSD', 0),
  ('ssd_sata', 'SSD SATA', 'SATA SSD', 1),
  ('hdd', 'HDD', 'HDD', 2),
  ('ssd_hdd', 'SSD + HDD', 'SSD + HDD', 3),
  ('emmc', 'eMMC', 'eMMC', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'storage_drive_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true, label_ar = 'طريقة التخزين' where code = 'storage_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('micro_sd', 'كارت microSD', 'microSD Card', 0),
  ('cloud', 'تخزين سحابي', 'Cloud', 1),
  ('nvr_dvr', 'على جهاز التسجيل', 'NVR / DVR', 2),
  ('built_in', 'ذاكرة داخلية', 'Built-in Storage', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'storage_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'storage_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ssd_nvme', 'SSD NVMe (M.2)', 'NVMe SSD (M.2)', 0),
  ('ssd_sata', 'SSD SATA', 'SATA SSD', 1),
  ('hdd', 'هارد ديسك HDD', 'HDD', 2),
  ('sshd', 'هجين SSHD', 'SSHD (hybrid)', 3),
  ('emmc', 'eMMC', 'eMMC', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'storage_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'strap_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('leather', 'جلد طبيعي', 'Genuine Leather', 0),
  ('faux_leather', 'جلد صناعي', 'Faux Leather', 1),
  ('stainless_steel', 'ستانلس ستيل', 'Stainless Steel', 2),
  ('metal_mesh', 'شبك معدن (ميش)', 'Metal Mesh', 3),
  ('silicone', 'سيليكون', 'Silicone', 4),
  ('rubber', 'مطاط', 'Rubber', 5),
  ('nylon', 'نايلون', 'Nylon', 6),
  ('fabric', 'قماش', 'Fabric', 7),
  ('titanium', 'تيتانيوم', 'Titanium', 8),
  ('ceramic', 'سيراميك', 'Ceramic', 9),
  ('plastic', 'بلاستيك', 'Plastic', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'strap_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'strap_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('top_handle', 'يد علوية', 'Top Handle', 0),
  ('adjustable_shoulder', 'حمالة كتف قابلة للضبط', 'Adjustable Shoulder Strap', 1),
  ('fixed_shoulder', 'حمالة كتف ثابتة', 'Fixed Shoulder Strap', 2),
  ('detachable', 'حمالة تتشال', 'Detachable Strap', 3),
  ('chain', 'سلسلة', 'Chain Strap', 4),
  ('crossbody', 'حمالة كروس', 'Crossbody Strap', 5),
  ('backpack', 'حمالات ظهر', 'Backpack Straps', 6),
  ('wristlet', 'حمالة معصم', 'Wrist Strap', 7),
  ('convertible', 'قابلة للتحويل', 'Convertible', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'strap_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'strength_as_labeled' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('p60', '60% كحول', '60% alcohol', 0),
  ('p70', '70% كحول', '70% alcohol', 1),
  ('p75', '75% كحول', '75% alcohol', 2),
  ('p80', '80% كحول', '80% alcohol', 3),
  ('vol10', '10 فوليوم (3%)', '10 vol (3%)', 4),
  ('vol20', '20 فوليوم (6%)', '20 vol (6%)', 5),
  ('vol30', '30 فوليوم (9%)', '30 vol (9%)', 6),
  ('vol40', '40 فوليوم (12%)', '40 vol (12%)', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'strength_as_labeled' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'stretchable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stretchable', 'مطاط (يتمدد)', 'Stretchable', 0),
  ('not_stretchable', 'غير قابل للتمدد', 'Not Stretchable', 1)) v(code, ar, en, sort)
 where d.code = 'stretchable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'stroller_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('full_size', 'عربية عادية (كاملة)', 'Full-size', 0),
  ('lightweight_umbrella', 'خفيفة (شمسية)', 'Lightweight / umbrella', 1),
  ('travel_system', 'ترافل سيستم (مع كاري)', 'Travel system', 2),
  ('pram', 'عربية بسرير (برام)', 'Pram / bassinet', 3),
  ('compact_cabin', 'صغيرة (مقاس الطيارة)', 'Compact / cabin', 4),
  ('jogging', 'جري (3 عجل)', 'Jogging', 5),
  ('double', 'توأم', 'Double / twin', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'stroller_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'styling_functions' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dry', 'تجفيف', 'Dry', 0),
  ('straighten', 'فرد', 'Straighten', 1),
  ('curl', 'تجعيد / كيرلي', 'Curl', 2),
  ('wave', 'تمويج', 'Wave', 3),
  ('volume', 'حجم', 'Volume', 4),
  ('smooth', 'تنعيم', 'Smooth', 5),
  ('crimp', 'تجعيد صغير (كريمب)', 'Crimp', 6)) v(code, ar, en, sort)
 where d.code = 'styling_functions' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'styling_technology' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('air_wrap', 'لف بالهواء (كواندا)', 'Air wrap / Coanda', 0),
  ('ionic', 'أيونات', 'Ionic', 1),
  ('ceramic', 'سيراميك', 'Ceramic', 2),
  ('tourmaline', 'تورمالين', 'Tourmaline', 3),
  ('smart_heat', 'تحكم ذكي في الحرارة', 'Smart heat control', 4),
  ('heated_plates', 'ألواح حرارية', 'Heated plates', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'styling_technology' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'suction_base' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'suction_base' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sugar_form' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('granulated', 'سكر حبيبات', 'Granulated', 0),
  ('cubes', 'مكعبات', 'Cubes', 1),
  ('powdered', 'سكر بودرة', 'Powdered / icing', 2),
  ('sticks_sachets', 'أصابع / أكياس فردية', 'Sticks / sachets', 3),
  ('syrup', 'سائل (شراب)', 'Liquid syrup', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'sugar_form' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'sugar_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('white_cane', 'سكر أبيض قصب', 'White cane sugar', 0),
  ('white_beet', 'سكر أبيض بنجر', 'White beet sugar', 1),
  ('brown', 'سكر بني', 'Brown sugar', 2),
  ('demerara', 'ديميرارا', 'Demerara', 3),
  ('coconut', 'سكر جوز الهند', 'Coconut sugar', 4),
  ('stevia', 'ستيفيا', 'Stevia', 5),
  ('artificial_sweetener', 'محلي صناعي (دايت)', 'Artificial sweetener', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'sugar_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_floor_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all', 'كل الأرضيات', 'All floors', 0),
  ('ceramic', 'سيراميك', 'Ceramic', 1),
  ('porcelain', 'بورسلين', 'Porcelain', 2),
  ('marble', 'رخام', 'Marble', 3),
  ('granite', 'جرانيت', 'Granite', 4),
  ('tiles', 'بلاط', 'Tiles', 5),
  ('parquet', 'باركيه / خشب', 'Parquet / Wood', 6),
  ('laminate', 'HDF / لامينيت', 'Laminate', 7),
  ('vinyl', 'فينيل', 'Vinyl', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'suitable_floor_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_hair_colors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all', 'كل ألوان الشعر', 'All hair colors', 0),
  ('blonde', 'أشقر / فاتح', 'Blonde / light', 1),
  ('brunette', 'بني / غامق', 'Brunette / dark', 2),
  ('black', 'أسود', 'Black', 3),
  ('red', 'أحمر', 'Red', 4)) v(code, ar, en, sort)
 where d.code = 'suitable_hair_colors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_hair_length' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('short', 'قصير', 'Short', 0),
  ('medium', 'متوسط', 'Medium', 1),
  ('long', 'طويل', 'Long', 2),
  ('extra_long', 'طويل جداً', 'Extra long', 3)) v(code, ar, en, sort)
 where d.code = 'suitable_hair_length' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_hair_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all', 'كل أنواع الشعر', 'All hair types', 0),
  ('normal', 'عادي', 'Normal', 1),
  ('dry', 'جاف', 'Dry', 2),
  ('oily', 'دهني', 'Oily', 3),
  ('damaged', 'تالف / متقصف', 'Damaged', 4),
  ('colored', 'مصبوغ', 'Color-treated', 5),
  ('frizzy', 'هايش', 'Frizzy', 6),
  ('curly', 'كيرلي', 'Curly', 7),
  ('wavy', 'مموج', 'Wavy', 8),
  ('straight', 'ناعم / سايح', 'Straight', 9),
  ('fine', 'خفيف / رفيع', 'Fine', 10),
  ('thick', 'كثيف', 'Thick', 11),
  ('falling', 'متساقط', 'Thinning / hair fall', 12)) v(code, ar, en, sort)
 where d.code = 'suitable_hair_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_playing_surface' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('natural_grass', 'نجيلة طبيعية', 'Natural Grass', 0),
  ('artificial_grass', 'نجيلة صناعية', 'Artificial Turf', 1),
  ('indoor_hard', 'صالات (أرضية صلبة)', 'Indoor Hard Court', 2),
  ('street_asphalt', 'شارع / أسفلت', 'Street / Asphalt', 3),
  ('sand', 'رمل / شاطئ', 'Sand / Beach', 4)) v(code, ar, en, sort)
 where d.code = 'suitable_playing_surface' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_scalp_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all', 'كل الأنواع', 'All', 0),
  ('normal', 'عادية', 'Normal', 1),
  ('oily', 'دهنية', 'Oily', 2),
  ('dry', 'جافة', 'Dry', 3),
  ('sensitive', 'حساسة', 'Sensitive', 4),
  ('dandruff', 'فيها قشرة', 'Dandruff-prone', 5)) v(code, ar, en, sort)
 where d.code = 'suitable_scalp_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_surfaces' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dishes', 'أطباق وأكواب', 'Dishes / Glasses', 0),
  ('pots_pans', 'حلل وطاسات', 'Pots / Pans', 1),
  ('non_stick', 'تيفال / غير لاصق', 'Non-stick', 2),
  ('glass_mirrors', 'زجاج ومرايات', 'Glass / Mirrors', 3),
  ('windows', 'شبابيك', 'Windows', 4),
  ('car_glass', 'زجاج السيارة', 'Car glass', 5),
  ('screens', 'شاشات', 'Screens', 6),
  ('tiles', 'سيراميك وبلاط', 'Tiles', 7),
  ('marble', 'رخام', 'Marble', 8),
  ('wood', 'خشب / باركيه', 'Wood / Parquet', 9),
  ('stainless', 'ستانلس ستيل', 'Stainless steel', 10),
  ('upholstery', 'مفروشات وأقمشة', 'Upholstery / Fabric', 11),
  ('carpet', 'سجاد', 'Carpet', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'suitable_surfaces' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'suitable_washing_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front_load', 'غسالة فول أوتوماتيك أمامي', 'Front-load automatic', 0),
  ('top_load', 'غسالة فول أوتوماتيك علوي', 'Top-load automatic', 1),
  ('semi_auto', 'غسالة عادية / نص أوتوماتيك', 'Semi-automatic / Twin tub', 2),
  ('hand_wash', 'غسيل يدوي', 'Hand wash', 3)) v(code, ar, en, sort)
 where d.code = 'suitable_washing_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'supplied_component' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('front_sprocket', 'ترس أمامي (صغير) فقط', 'Front sprocket only', 0),
  ('rear_sprocket', 'ترس خلفي (كبير) فقط', 'Rear sprocket only', 1),
  ('front_rear_set', 'طقم ترس أمامي وخلفي', 'Front + rear sprocket set', 2),
  ('chain_sprocket_kit', 'طقم جنزير وتروس كامل', 'Chain and sprocket kit', 3)) v(code, ar, en, sort)
 where d.code = 'supplied_component' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'support_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('low', 'دعم خفيف (يوجا / مشي)', 'Low Support', 0),
  ('medium', 'دعم متوسط (جيم / دراجات)', 'Medium Support', 1),
  ('high', 'دعم عالي (جري / قفز)', 'High Support', 2)) v(code, ar, en, sort)
 where d.code = 'support_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'supported_memory_generation' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('ddr4', 'DDR4', 'DDR4', 0),
  ('ddr5', 'DDR5', 'DDR5', 1),
  ('ddr3', 'DDR3', 'DDR3', 2)) v(code, ar, en, sort)
 where d.code = 'supported_memory_generation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'supported_motherboard_form_factors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('atx', 'ATX', 'ATX', 0),
  ('micro_atx', 'Micro-ATX', 'Micro-ATX', 1),
  ('mini_itx', 'Mini-ITX', 'Mini-ITX', 2),
  ('e_atx', 'E-ATX', 'E-ATX', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'supported_motherboard_form_factors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'supported_psu_form_factors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('atx', 'ATX', 'ATX', 0),
  ('sfx', 'SFX', 'SFX', 1),
  ('sfx_l', 'SFX-L', 'SFX-L', 2),
  ('tfx', 'TFX', 'TFX', 3),
  ('included', 'باور مرفق مع الكيسة', 'PSU included', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'supported_psu_form_factors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true, label_ar = 'الأسطح المناسبة' where code = 'surface' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('multi_surface', 'كل الأسطح', 'Multi-surface', 0),
  ('kitchen', 'مطبخ ورخامة', 'Kitchen / Countertops', 1),
  ('bathroom', 'حمام', 'Bathroom', 2),
  ('toilet', 'مرحاض', 'Toilet', 3),
  ('floors', 'أرضيات', 'Floors', 4),
  ('glass', 'زجاج ومرايات', 'Glass / Mirrors', 5),
  ('tiles', 'سيراميك وبلاط', 'Tiles', 6),
  ('stainless', 'ستانلس ستيل', 'Stainless steel', 7),
  ('wood', 'خشب', 'Wood', 8),
  ('plastic', 'بلاستيك', 'Plastic', 9),
  ('fabrics', 'أقمشة', 'Fabrics', 10),
  ('hands_skin', 'اليدين والبشرة', 'Hands / Skin', 11),
  ('other', 'أخرى', 'Other', 12)) v(code, ar, en, sort)
 where d.code = 'surface' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'surface_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('stainless', 'ستانلس ستيل', 'Stainless steel', 0),
  ('tempered_glass', 'زجاج سيكوريت', 'Tempered glass', 1),
  ('ceramic_glass', 'زجاج سيراميك', 'Ceramic glass', 2),
  ('enamel', 'صاج مطلي (إنامل)', 'Enamel', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'surface_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'system_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('compressor_kit', 'طقم بكمبروسر', 'Compressor kit', 0),
  ('cordless', 'لاسلكي محمول', 'Cordless portable', 1),
  ('pro', 'احترافي', 'Professional', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'system_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'target_fabrics_or_colors' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('all', 'كل الأقمشة', 'All fabrics', 0),
  ('whites', 'ملابس بيضاء', 'Whites', 1),
  ('colors', 'ملابس ملونة', 'Colors', 2),
  ('darks', 'ملابس سوداء وغامقة', 'Darks / Black', 3),
  ('delicates', 'أقمشة رقيقة', 'Delicates', 4),
  ('wool', 'صوف', 'Wool', 5),
  ('baby', 'ملابس أطفال', 'Baby clothes', 6),
  ('sportswear', 'ملابس رياضية', 'Sportswear', 7),
  ('abaya', 'عبايات', 'Abayas', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'target_fabrics_or_colors' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tea_format' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('loose_coarse', 'شاي خشن (أوراق)', 'Loose leaf (coarse)', 0),
  ('loose_fine', 'شاي ناعم', 'Loose fine / dust', 1),
  ('tea_bags', 'فتلة (أكياس)', 'Tea bags', 2),
  ('pyramid_bags', 'أكياس هرمية', 'Pyramid bags', 3),
  ('instant_powder', 'بودرة سريعة الذوبان', 'Instant powder', 4),
  ('ready_to_drink', 'جاهز للشرب', 'Ready to drink', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'tea_format' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tea_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('black', 'شاي أسود', 'Black tea', 0),
  ('green', 'شاي أخضر', 'Green tea', 1),
  ('white', 'شاي أبيض', 'White tea', 2),
  ('oolong', 'أولونج', 'Oolong', 3),
  ('matcha', 'ماتشا', 'Matcha', 4),
  ('herbal', 'أعشاب', 'Herbal infusion', 5),
  ('rooibos', 'روبوس', 'Rooibos', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'tea_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'teat_flow_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('newborn', 'حديثي الولادة (بطيء جدًا)', 'Newborn', 0),
  ('slow', 'بطيء', 'Slow', 1),
  ('medium', 'متوسط', 'Medium', 2),
  ('fast', 'سريع', 'Fast', 3),
  ('variable', 'متغير', 'Variable', 4),
  ('y_cut', 'فتحة Y (للسوائل الثقيلة)', 'Y-cut', 5)) v(code, ar, en, sort)
 where d.code = 'teat_flow_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'teat_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('silicone', 'سيليكون', 'Silicone', 0),
  ('latex', 'كاوتش طبيعي (لاتكس)', 'Latex', 1),
  ('natural_rubber', 'مطاط طبيعي', 'Natural Rubber', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'teat_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'teat_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('orthodontic', 'تقويمي (أورثودنتك)', 'Orthodontic', 0),
  ('cherry', 'كرزة (مدورة)', 'Cherry', 1),
  ('symmetrical', 'متماثل', 'Symmetrical', 2),
  ('flat', 'مفلطح', 'Flat', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'teat_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'التحكم في درجة الحرارة' where code = 'temperature_control' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون تحكم', 'None', 0),
  ('fixed', 'درجة ثابتة', 'Fixed Temperature', 1),
  ('two_levels', 'مستويين', '2 Levels', 2),
  ('three_levels', '3 مستويات', '3 Levels', 3),
  ('multi_levels', 'مستويات متعددة', 'Multiple Levels', 4),
  ('digital', 'تحكم ديجيتال بالدرجة', 'Digital Precise Control', 5)) v(code, ar, en, sort)
 where d.code = 'temperature_control' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'terminal_layout' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('right_positive', 'الموجب يمين (0)', 'Positive right (0)', 0),
  ('left_positive', 'الموجب شمال (1)', 'Positive left (1)', 1),
  ('asian_thin', 'أقطاب آسيوية رفيعة', 'Asian thin terminals', 2),
  ('side', 'أقطاب جانبية', 'Side terminals', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'terminal_layout' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'theme_or_picture' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('landscape_nature', 'مناظر طبيعية', 'Landscapes & Nature', 0),
  ('animals', 'حيوانات', 'Animals', 1),
  ('cartoon', 'شخصيات كرتون', 'Cartoon Characters', 2),
  ('cities_landmarks', 'مدن ومعالم', 'Cities & Landmarks', 3),
  ('maps', 'خرائط', 'Maps', 4),
  ('art', 'لوحات فنية', 'Famous Art', 5),
  ('vehicles', 'عربيات ومركبات', 'Vehicles', 6),
  ('flowers', 'ورد', 'Flowers', 7),
  ('space', 'فضاء', 'Space', 8),
  ('islamic', 'إسلامي / زخارف', 'Islamic / Patterns', 9),
  ('educational', 'تعليمي (حروف / أرقام)', 'Educational', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'theme_or_picture' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'thermostat' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('adjustable', 'ترموستات قابل للضبط', 'Adjustable thermostat', 0),
  ('digital', 'ترموستات ديجيتال', 'Digital thermostat', 1),
  ('none', 'بدون ترموستات', 'No thermostat', 2)) v(code, ar, en, sort)
 where d.code = 'thermostat' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'timer_settings' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('s10', '10 ثواني', '10 s', 0),
  ('s30', '30 ثانية', '30 s', 1),
  ('s60', '60 ثانية', '60 s', 2),
  ('s90', '90 ثانية', '90 s', 3),
  ('s99_low_heat', '99 ثانية (حرارة منخفضة)', '99 s low heat', 4),
  ('s120', '120 ثانية', '120 s', 5),
  ('auto_sensor', 'تشغيل تلقائي بالحساس', 'Auto sensor', 6),
  ('no_timer', 'بدون مؤقت', 'No timer', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'timer_settings' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tint_or_shade' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('clear', 'شفاف / بدون لون', 'Clear / untinted', 0),
  ('tinted_universal', 'ملون يناسب كل البشرات', 'Tinted universal', 1),
  ('light', 'فاتح', 'Light', 2),
  ('medium', 'متوسط', 'Medium', 3),
  ('dark', 'غامق', 'Dark', 4),
  ('pink', 'وردي', 'Pink', 5),
  ('red', 'أحمر', 'Red', 6),
  ('nude', 'نود', 'Nude', 7),
  ('berry', 'توتي', 'Berry', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'tint_or_shade' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tip_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('cotton', 'قطن', 'Cotton', 0),
  ('organic_cotton', 'قطن عضوي', 'Organic cotton', 1),
  ('viscose', 'فيسكوز', 'Viscose', 2),
  ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'tip_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tip_over_protection' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('yes_alert', 'نعم مع تنبيه', 'Yes, with alert', 1),
  ('no', 'لا', 'No', 2)) v(code, ar, en, sort)
 where d.code = 'tip_over_protection' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tip_shape' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('slanted', 'مائل', 'Slanted', 0),
  ('pointed', 'مدبب', 'Pointed', 1),
  ('flat', 'مستقيم / مسطح', 'Flat', 2),
  ('round', 'دائري', 'Round', 3),
  ('spiral', 'حلزوني', 'Spiral', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'tip_shape' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'tip_shapes' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('liner', 'لاينر رفيع', 'Liner', 0),
  ('striper', 'خطوط طويلة (سترايبر)', 'Striper', 1),
  ('detail', 'تفاصيل دقيقة', 'Detail', 2),
  ('flat', 'مسطح', 'Flat', 3),
  ('round', 'دائري', 'Round', 4),
  ('oval', 'بيضاوي', 'Oval', 5),
  ('angled', 'مائل', 'Angled', 6),
  ('fan', 'مروحة', 'Fan', 7),
  ('ombre', 'أومبري', 'Ombre', 8),
  ('dotting', 'قلم تنقيط', 'Dotting tool', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'tip_shapes' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'tip_types' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('large_round', 'دائري كبير', 'Large round', 0),
  ('small_round', 'دائري صغير', 'Small round', 1),
  ('oval', 'بيضاوي', 'Oval', 2),
  ('micro', 'ميكرو', 'Micro', 3),
  ('slanted', 'مائل', 'Slanted', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'tip_types' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tool_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tongue_scraper', 'كاشط لسان', 'Tongue scraper', 0),
  ('tongue_brush', 'فرشاة لسان', 'Tongue brush', 1),
  ('facial_roller', 'رولر وجه', 'Facial roller', 2),
  ('gua_sha', 'جوا شا', 'Gua sha', 3),
  ('ice_roller', 'رولر تلج', 'Ice roller', 4),
  ('comb', 'مشط', 'Comb', 5),
  ('paddle_brush', 'فرشاة مسطحة', 'Paddle brush', 6),
  ('round_brush', 'فرشاة دائرية', 'Round brush', 7),
  ('detangling_brush', 'فرشاة فك التشابك', 'Detangling brush', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'tool_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'tools_in_set' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('nail_clipper', 'قصافة أظافر', 'Nail clipper', 0),
  ('toenail_clipper', 'قصافة أظافر القدم', 'Toenail clipper', 1),
  ('nail_scissors', 'مقص أظافر', 'Nail scissors', 2),
  ('cuticle_nipper', 'قصافة جلد', 'Cuticle nipper', 3),
  ('cuticle_pusher', 'دافع الجلد', 'Cuticle pusher', 4),
  ('nail_file', 'مبرد', 'Nail file', 5),
  ('buffer', 'بافر تلميع', 'Buffer', 6),
  ('tweezers', 'ملقط', 'Tweezers', 7),
  ('ear_pick', 'منظف أذن', 'Ear pick', 8),
  ('blackhead_remover', 'أداة الرؤوس السوداء', 'Blackhead remover', 9),
  ('case', 'شنطة / جراب', 'Case', 10),
  ('other', 'أخرى', 'Other', 11)) v(code, ar, en, sort)
 where d.code = 'tools_in_set' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tools_included' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('empty', 'صندوق فاضي', 'Empty box', 0),
  ('basic_set', 'طقم عدة أساسي', 'Basic tool set', 1),
  ('full_set', 'طقم عدة كامل', 'Full tool set', 2)) v(code, ar, en, sort)
 where d.code = 'tools_included' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tooth_or_bristle_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('boar', 'شعر خنزير طبيعي', 'Boar bristle', 0),
  ('boar_nylon', 'خنزير ونايلون', 'Boar and nylon', 1),
  ('nylon', 'نايلون', 'Nylon', 2),
  ('plastic', 'بلاستيك', 'Plastic', 3),
  ('silicone', 'سيليكون', 'Silicone', 4),
  ('wood', 'خشب', 'Wood', 5),
  ('bamboo', 'بامبو', 'Bamboo', 6),
  ('metal', 'معدن', 'Metal', 7),
  ('carbon', 'كاربون', 'Carbon', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'tooth_or_bristle_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'top_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fleece', 'فليس', 'Fleece', 0),
  ('polyester', 'بوليستر', 'Polyester', 1),
  ('cotton', 'قطن', 'Cotton', 2),
  ('acrylic', 'أكريليك', 'Acrylic', 3),
  ('oxford', 'قماش أكسفورد', 'Oxford', 4),
  ('nylon', 'نايلون', 'Nylon', 5),
  ('straw', 'حصير / سمار', 'Straw', 6),
  ('plastic_woven', 'بلاستيك منسوج', 'Woven plastic', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'top_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'touchscreen' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'بدون شاشة لمس', 'No touchscreen', 0),
  ('touch', 'شاشة لمس', 'Touchscreen', 1),
  ('touch_pen', 'شاشة لمس تدعم القلم', 'Touchscreen with stylus support', 2)) v(code, ar, en, sort)
 where d.code = 'touchscreen' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'tube_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('tubeless', 'تيوبلس (بدون شمبر)', 'Tubeless', 0),
  ('tube_included', 'بشمبر (الشمبر مرفق)', 'Tube type, tube included', 1),
  ('tube_not_included', 'بشمبر (الشمبر غير مرفق)', 'Tube type, tube not included', 2)) v(code, ar, en, sort)
 where d.code = 'tube_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'two_way_audio' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'two_way_audio' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'umbrella_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('compact_folding', 'شمسية تطبق', 'Compact Folding', 0),
  ('straight', 'شمسية طويلة', 'Straight / Long', 1),
  ('golf', 'جولف (كبيرة)', 'Golf', 2),
  ('inverted', 'مقلوبة', 'Inverted', 3),
  ('bubble', 'فقاعة شفافة', 'Bubble', 4),
  ('kids', 'أطفال', 'Kids', 5),
  ('beach', 'شمسية شاطئ', 'Beach', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'umbrella_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'underwired' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('underwired', 'بسلك', 'Underwired', 0),
  ('wire_free', 'بدون سلك', 'Wire-free', 1)) v(code, ar, en, sort)
 where d.code = 'underwired' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'unlocking_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('combination', 'أرقام', 'Combination', 0),
  ('key', 'مفتاح', 'Key', 1),
  ('tsa', 'TSA (أرقام ومفتاح جمارك)', 'TSA', 2),
  ('fingerprint', 'بصمة', 'Fingerprint', 3),
  ('bluetooth_app', 'تطبيق Bluetooth', 'Bluetooth App', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'unlocking_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false, label_ar = 'خامة التنجيد' where code = 'upholstery_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fabric', 'قماش', 'Fabric', 0),
  ('velvet', 'قطيفة', 'Velvet', 1),
  ('chenille', 'شانيل', 'Chenille', 2),
  ('linen', 'كتان', 'Linen', 3),
  ('boucle', 'بوكليه', 'Bouclé', 4),
  ('microfiber', 'مايكروفايبر', 'Microfiber', 5),
  ('faux_leather', 'جلد صناعي', 'Faux leather', 6),
  ('leather', 'جلد طبيعي', 'Genuine leather', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'upholstery_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'upper_material' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('genuine_leather', 'جلد طبيعي', 'Genuine leather', 0),
  ('synthetic_leather', 'جلد صناعي', 'Synthetic leather', 1),
  ('suede', 'شمواه', 'Suede', 2),
  ('nubuck', 'نوباك', 'Nubuck', 3),
  ('patent', 'جلد لامع (ورنيش)', 'Patent leather', 4),
  ('mesh', 'شبك (ميش)', 'Mesh', 5),
  ('knit', 'تريكو / نيت', 'Knit', 6),
  ('canvas', 'كانفاس', 'Canvas', 7),
  ('textile', 'قماش', 'Textile', 8),
  ('rubber_pvc', 'مطاط / PVC', 'Rubber / PVC', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'upper_material' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'usage' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('home', 'استخدام منزلي', 'Home use', 0),
  ('daily_protection', 'وقاية يومية', 'Daily protection', 1),
  ('hospital_clinic', 'مستشفيات وعيادات', 'Hospital / clinic', 2),
  ('professional', 'استخدام مهني', 'Professional', 3),
  ('first_aid', 'إسعافات أولية', 'First aid', 4),
  ('relaxation', 'استرخاء', 'Relaxation', 5),
  ('travel', 'سفر', 'Travel', 6),
  ('kids', 'أطفال', 'Kids', 7),
  ('elderly', 'كبار السن', 'Elderly', 8),
  ('pets', 'حيوانات أليفة', 'Pets', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'usage' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'usb_connector_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_a', 'USB-A', 'USB-A', 0),
  ('usb_c', 'USB-C', 'USB-C', 1),
  ('micro_usb', 'Micro-USB', 'Micro-USB', 2),
  ('lightning', 'Lightning (آيفون)', 'Lightning', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'usb_connector_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'usb_standard' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('usb_2_0', 'USB 2.0', 'USB 2.0', 0),
  ('usb_3_0', 'USB 3.0 / 3.1 Gen 1', 'USB 3.0 / 3.1 Gen 1', 1),
  ('usb_3_2_gen1', 'USB 3.2 Gen 1', 'USB 3.2 Gen 1', 2),
  ('usb_3_2_gen2', 'USB 3.2 Gen 2', 'USB 3.2 Gen 2', 3),
  ('usb_3_2_gen2x2', 'USB 3.2 Gen 2x2', 'USB 3.2 Gen 2x2', 4),
  ('usb4', 'USB4', 'USB4', 5)) v(code, ar, en, sort)
 where d.code = 'usb_standard' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'uv_protection' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('uv400', 'UV400 (حماية 100%)', 'UV400 (100%)', 0),
  ('uv380', 'UV380', 'UV380', 1),
  ('partial', 'حماية جزئية', 'Partial protection', 2),
  ('ansi_z87', 'حماية صناعية ANSI Z87.1', 'ANSI Z87.1', 3),
  ('none', 'بدون حماية', 'None', 4)) v(code, ar, en, sort)
 where d.code = 'uv_protection' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'uva_protection_label' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'غير مذكور', 'Not stated', 0),
  ('broad_spectrum', 'واسع الطيف (Broad Spectrum)', 'Broad spectrum', 1),
  ('uva_circle', 'شعار UVA في دائرة', 'UVA circle logo', 2),
  ('pa_plus', 'PA+', 'PA+', 3),
  ('pa_2', 'PA++', 'PA++', 4),
  ('pa_3', 'PA+++', 'PA+++', 5),
  ('pa_4', 'PA++++', 'PA++++', 6)) v(code, ar, en, sort)
 where d.code = 'uva_protection_label' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'vacuum_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('canister', 'مكنسة أرضية (كانيستر)', 'Canister', 0),
  ('upright', 'مكنسة رأسية', 'Upright', 1),
  ('stick_cordless', 'مكنسة عصا لاسلكية', 'Cordless Stick', 2),
  ('handheld', 'مكنسة يدوية', 'Handheld', 3),
  ('robot', 'مكنسة روبوت', 'Robot', 4),
  ('wet_dry_drum', 'مكنسة برميل رطب وجاف', 'Wet & Dry Drum', 5),
  ('wet_dry_floor_washer', 'مكنسة غسيل أرضيات (رطب وجاف)', 'Wet & Dry Floor Washer', 6),
  ('backpack', 'مكنسة ظهر', 'Backpack', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'vacuum_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'vegetable_or_fruit_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('peas', 'بسلة', 'Peas', 0),
  ('peas_carrots', 'بسلة بالجزر', 'Peas & carrots', 1),
  ('okra', 'بامية', 'Okra', 2),
  ('molokhia', 'ملوخية', 'Molokhia', 3),
  ('green_beans', 'فاصوليا خضراء', 'Green beans', 4),
  ('mixed_vegetables', 'خضار مشكل', 'Mixed vegetables', 5),
  ('spinach', 'سبانخ', 'Spinach', 6),
  ('colocasia', 'قلقاس', 'Colocasia', 7),
  ('artichoke', 'خرشوف', 'Artichoke', 8),
  ('corn', 'ذرة', 'Corn', 9),
  ('broccoli', 'بروكلي', 'Broccoli', 10),
  ('cauliflower', 'قرنبيط', 'Cauliflower', 11),
  ('potato_fries', 'بطاطس (صوابع)', 'Potato fries', 12),
  ('vine_leaves', 'ورق عنب', 'Vine leaves', 13),
  ('strawberry', 'فراولة', 'Strawberry', 14),
  ('mango', 'مانجو', 'Mango', 15),
  ('mixed_berries', 'توت مشكل', 'Mixed berries', 16),
  ('other', 'أخرى', 'Other', 17)) v(code, ar, en, sort)
 where d.code = 'vegetable_or_fruit_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'vehicle_category' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('car', 'ملاكي (سيدان / هاتشباك)', 'Passenger car', 0),
  ('suv', 'SUV / جيب 4×4', 'SUV / 4x4', 1),
  ('pickup', 'نص نقل / بيك أب', 'Pickup / light truck', 2),
  ('van', 'ميكروباص / فان', 'Van / minibus', 3),
  ('truck', 'نقل ثقيل', 'Truck', 4),
  ('motorcycle', 'موتوسيكل', 'Motorcycle', 5),
  ('scooter', 'سكوتر', 'Scooter', 6),
  ('tuk_tuk', 'توك توك', 'Tuk-tuk', 7),
  ('bicycle', 'عجلة (دراجة)', 'Bicycle', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'vehicle_category' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'vehicle_power_source' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('aa_batteries', 'بطاريات AA', 'AA Batteries', 0),
  ('rechargeable_pack', 'بطارية قابلة للشحن (Ni-MH)', 'Rechargeable Ni-MH Pack', 1),
  ('lithium', 'بطارية ليثيوم قابلة للشحن', 'Rechargeable Li-ion / LiPo', 2),
  ('usb_rechargeable', 'بطارية تشحن بكابل USB', 'USB Rechargeable', 3),
  ('nitro', 'بنزين / نيترو', 'Nitro / Fuel', 4)) v(code, ar, en, sort)
 where d.code = 'vehicle_power_source' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'vehicle_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('car', 'سيارة', 'Car', 0),
  ('racing_car', 'سيارة سباق', 'Racing Car', 1),
  ('police_car', 'سيارة شرطة', 'Police Car', 2),
  ('fire_truck', 'عربية مطافي', 'Fire Truck', 3),
  ('truck', 'شاحنة / تريلا', 'Truck', 4),
  ('construction', 'معدات بناء (لودر / حفار)', 'Construction Vehicle', 5),
  ('bus', 'أتوبيس', 'Bus', 6),
  ('motorcycle', 'موتوسيكل', 'Motorcycle', 7),
  ('airplane', 'طيارة', 'Airplane', 8),
  ('helicopter', 'هليكوبتر', 'Helicopter', 9),
  ('train', 'قطر', 'Train', 10),
  ('boat_ship', 'مركب / سفينة', 'Boat / Ship', 11),
  ('military_tank', 'دبابة / عسكري', 'Military / Tank', 12),
  ('other', 'أخرى', 'Other', 13)) v(code, ar, en, sort)
 where d.code = 'vehicle_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'video_inputs' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hdmi', 'HDMI', 'HDMI', 0),
  ('displayport', 'DisplayPort', 'DisplayPort', 1),
  ('usb_c', 'USB-C (DP Alt Mode)', 'USB-C (DP Alt Mode)', 2),
  ('vga', 'VGA', 'VGA', 3),
  ('dvi', 'DVI', 'DVI', 4),
  ('mini_dp', 'Mini DisplayPort', 'Mini DisplayPort', 5),
  ('thunderbolt', 'Thunderbolt', 'Thunderbolt', 6),
  ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'video_inputs' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'video_memory_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('gddr6', 'GDDR6', 'GDDR6', 0),
  ('gddr6x', 'GDDR6X', 'GDDR6X', 1),
  ('gddr7', 'GDDR7', 'GDDR7', 2),
  ('gddr5', 'GDDR5', 'GDDR5', 3),
  ('gddr5x', 'GDDR5X', 'GDDR5X', 4),
  ('ddr4', 'DDR4', 'DDR4', 5),
  ('ddr3', 'DDR3', 'DDR3', 6),
  ('hbm', 'HBM2 / HBM3', 'HBM2 / HBM3', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'video_memory_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'video_resolution' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('p480', '480p', '480p', 0),
  ('p720', '720p (HD)', '720p HD', 1),
  ('p1080', '1080p (فل HD)', '1080p Full HD', 2),
  ('k2', '2K', '2K', 3),
  ('k4', '4K', '4K', 4),
  ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'video_resolution' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'waist_rise' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('low', 'وسط واطي', 'Low rise', 0),
  ('mid', 'وسط عادي', 'Mid rise', 1),
  ('high', 'وسط عالي', 'High rise', 2),
  ('extra_high', 'وسط عالي جداً', 'Extra high rise', 3)) v(code, ar, en, sort)
 where d.code = 'waist_rise' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wallet_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('bifold', 'محفظة طبقتين', 'Bifold', 0),
  ('trifold', 'محفظة 3 طبقات', 'Trifold', 1),
  ('card_holder', 'حامل كروت', 'Card Holder', 2),
  ('long', 'محفظة طويلة', 'Long Wallet', 3),
  ('zip_around', 'محفظة بسوستة', 'Zip-around', 4),
  ('coin_purse', 'بوك فكة', 'Coin Purse', 5),
  ('money_clip', 'مشبك فلوس', 'Money Clip', 6),
  ('phone_wallet', 'محفظة موبايل', 'Phone Wallet', 7),
  ('travel', 'محفظة سفر', 'Travel Wallet', 8),
  ('other', 'أخرى', 'Other', 9)) v(code, ar, en, sort)
 where d.code = 'wallet_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'warmer_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single_pot', 'سخان علبة واحدة', 'Single Pot Warmer', 0),
  ('double_pot', 'سخان علبتين (مزدوج)', 'Double Pot Warmer', 1),
  ('roll_on_cartridge', 'سخان رول أون (كارتريدج)', 'Roll-on Cartridge Heater', 2),
  ('can_warmer', 'سخان علبة الشمع الجاهزة', 'Wax Can Warmer', 3),
  ('paraffin_bath', 'حوض شمع البارافين', 'Paraffin Wax Bath', 4),
  ('combo_kit', 'طقم سخان + شمع', 'Warmer and Wax Kit', 5),
  ('other', 'أخرى', 'Other', 6)) v(code, ar, en, sort)
 where d.code = 'warmer_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'warming_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('steam', 'بخار', 'Steam', 0),
  ('water_bath', 'حمام مائي', 'Water Bath', 1),
  ('dry_heat', 'تسخين جاف', 'Dry Heat', 2),
  ('portable', 'محمول (USB / بطارية)', 'Portable', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'warming_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'warmth_level' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('light_summer', 'خفيف (صيفي)', 'Light (summer)', 0),
  ('all_season', 'متوسط (كل المواسم)', 'All-season', 1),
  ('warm_winter', 'دافي (شتوي)', 'Warm (winter)', 2),
  ('extra_warm', 'دافي جدًا', 'Extra warm', 3)) v(code, ar, en, sort)
 where d.code = 'warmth_level' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'washability' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fully_washable', 'الجهاز كله يتغسل', 'Fully washable', 0),
  ('rinsable_head', 'الرأس بس يتغسل', 'Rinsable head', 1),
  ('not_washable', 'لا يتغسل', 'Not washable', 2)) v(code, ar, en, sort)
 where d.code = 'washability' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'washable_head' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('fully_washable', 'الماكينة كلها تتغسل', 'Fully washable', 0),
  ('rinsable_head', 'الرأس بس يتغسل', 'Rinsable head', 1),
  ('not_washable', 'لا يتغسل', 'Not washable', 2)) v(code, ar, en, sort)
 where d.code = 'washable_head' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'water_heating_function' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('heats', 'يسخن المياه', 'Heats water', 0),
  ('keeps_warm', 'يحافظ على حرارة المياه', 'Keeps water warm', 1),
  ('none', 'بدون تسخين', 'No heating', 2)) v(code, ar, en, sort)
 where d.code = 'water_heating_function' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'water_resistance' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'غير مقاوم', 'Not Water Resistant', 0),
  ('water_repellent', 'طارد للماء (خامة)', 'Water Repellent', 1),
  ('splash_ipx4', 'مقاوم للرذاذ IPX4', 'Splash Resistant IPX4', 2),
  ('ipx5_6', 'مقاوم لرش المياه IPX5 / IPX6', 'Water Jet Resistant IPX5/IPX6', 3),
  ('ipx7', 'مقاوم للماء IPX7 (غمر مؤقت)', 'Waterproof IPX7', 4),
  ('ip67', 'ضد الماء والغبار IP67', 'IP67', 5),
  ('ip68', 'ضد الماء IP68', 'IP68', 6),
  ('5atm', '5 ATM (سباحة)', '5 ATM (Swim-proof)', 7),
  ('fully_waterproof', 'ضد الماء بالكامل (خامة وخياطة ملحومة)', 'Fully Waterproof (Sealed Seams)', 8)) v(code, ar, en, sort)
 where d.code = 'water_resistance' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'water_resistance_rating' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'غير مقاومة للماء', 'Not Water Resistant', 0),
  ('splash', 'مقاومة للرذاذ فقط', 'Splash Resistant', 1),
  ('3atm', '3 ATM (30 متر)', '3 ATM (30 m)', 2),
  ('5atm', '5 ATM (50 متر)', '5 ATM (50 m)', 3),
  ('10atm', '10 ATM (100 متر)', '10 ATM (100 m)', 4),
  ('20atm', '20 ATM (200 متر)', '20 ATM (200 m)', 5),
  ('ip67', 'IP67', 'IP67', 6),
  ('ip68', 'IP68', 'IP68', 7),
  ('ip68_5atm', 'IP68 + 5 ATM', 'IP68 + 5 ATM', 8),
  ('diver_iso', 'ساعة غطس ISO 6425', 'Diver ISO 6425', 9)) v(code, ar, en, sort)
 where d.code = 'water_resistance_rating' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'water_resistant_backing' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('no', 'غير مقاومة', 'Not water-resistant', 0),
  ('resistant', 'مقاومة للرطوبة', 'Water-resistant', 1),
  ('waterproof', 'ضد الماء تماماً', 'Waterproof', 2)) v(code, ar, en, sort)
 where d.code = 'water_resistant_backing' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'waterproof' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('not_waterproof', 'غير مقاوم للماء', 'Not waterproof', 0),
  ('water_resistant', 'مقاوم للماء والعرق', 'Water resistant', 1),
  ('waterproof', 'ووتربروف (ضد الماء)', 'Waterproof', 2),
  ('smudge_proof', 'ثابت لا يتلطخ', 'Smudge-proof', 3)) v(code, ar, en, sort)
 where d.code = 'waterproof' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wax_or_strip_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('hard_wax_beads', 'شمع حبيبات (هارد واكس)', 'Hard Wax Beads', 0),
  ('soft_wax_can', 'شمع طري (علبة)', 'Soft Wax (Can)', 1),
  ('roll_on_cartridge', 'شمع رول أون (كارتريدج)', 'Roll-on Cartridge Wax', 2),
  ('ready_strips', 'شرائح شمع جاهزة', 'Ready-to-use Wax Strips', 3),
  ('sugar_wax', 'حلاوة (سكر)', 'Sugar Wax', 4),
  ('cold_wax', 'شمع بارد', 'Cold Wax', 5),
  ('paraffin_wax', 'شمع بارافين', 'Paraffin Wax', 6),
  ('fabric_strips_roll', 'رول شرائح قماش (بدون شمع)', 'Fabric Strips Roll', 7),
  ('other', 'أخرى', 'Other', 8)) v(code, ar, en, sort)
 where d.code = 'wax_or_strip_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wear_indicator_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون مؤشر', 'None', 0),
  ('acoustic', 'صوتي (ريشة معدنية)', 'Acoustic (metal tab)', 1),
  ('electronic', 'حساس إلكتروني (بسلك)', 'Electronic sensor (wired)', 2),
  ('sensor_prepared', 'مجهز لحساس (الحساس غير مرفق)', 'Sensor prepared (sensor not included)', 3)) v(code, ar, en, sort)
 where d.code = 'wear_indicator_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wearable' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('yes', 'نعم', 'Yes', 0),
  ('no', 'لا', 'No', 1)) v(code, ar, en, sort)
 where d.code = 'wearable' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wet_and_dry_use' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('dry_only', 'استخدام جاف فقط', 'Dry Use Only', 0),
  ('wet_and_dry', 'رطب وجاف (ينفع تحت الدش)', 'Wet & Dry', 1),
  ('washable_head_only', 'جاف فقط - الرأس قابل للغسيل', 'Dry Only, Washable Head', 2)) v(code, ar, en, sort)
 where d.code = 'wet_and_dry_use' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wheels' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('none', 'بدون عجل', 'No Wheels', 0),
  ('two', 'عجلتين', '2 Wheels', 1),
  ('four_spinner', '4 عجلات دوارة', '4 Spinner Wheels', 2),
  ('eight_spinner', '8 عجلات (مزدوجة)', '8 Double Spinner Wheels', 3)) v(code, ar, en, sort)
 where d.code = 'wheels' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wi_fi_frequency_bands' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('single_2_4', 'نطاق واحد 2.4 GHz', 'Single band 2.4 GHz', 0),
  ('dual_band', 'ثنائي النطاق 2.4 + 5 GHz', 'Dual band 2.4 + 5 GHz', 1),
  ('tri_band_5', 'ثلاثي النطاق 2.4 + 5 + 5 GHz', 'Tri band 2.4 + 5 + 5 GHz', 2),
  ('tri_band_6', 'ثلاثي النطاق 2.4 + 5 + 6 GHz', 'Tri band 2.4 + 5 + 6 GHz', 3),
  ('quad_band', 'رباعي النطاق', 'Quad band', 4)) v(code, ar, en, sort)
 where d.code = 'wi_fi_frequency_bands' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wi_fi_speed_class' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('n300', 'N300', 'N300', 0),
  ('ac750', 'AC750', 'AC750', 1),
  ('ac1200', 'AC1200', 'AC1200', 2),
  ('ac1900', 'AC1900', 'AC1900', 3),
  ('ac2100', 'AC2100 / AC2600', 'AC2100 / AC2600', 4),
  ('ax1500', 'AX1500', 'AX1500', 5),
  ('ax1800', 'AX1800', 'AX1800', 6),
  ('ax3000', 'AX3000', 'AX3000', 7),
  ('ax3600', 'AX3600', 'AX3600', 8),
  ('ax5400', 'AX5400', 'AX5400', 9),
  ('ax6000', 'AX6000 وأعلى', 'AX6000+', 10),
  ('be3600', 'BE3600', 'BE3600', 11),
  ('be5000', 'BE5000', 'BE5000', 12),
  ('be9300', 'BE9300 وأعلى', 'BE9300+', 13),
  ('other', 'أخرى', 'Other', 14)) v(code, ar, en, sort)
 where d.code = 'wi_fi_speed_class' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wi_fi_standard' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('wifi_4', 'Wi-Fi 4 (802.11n)', 'Wi-Fi 4 (802.11n)', 0),
  ('wifi_5', 'Wi-Fi 5 (802.11ac)', 'Wi-Fi 5 (802.11ac)', 1),
  ('wifi_6', 'Wi-Fi 6 (802.11ax)', 'Wi-Fi 6 (802.11ax)', 2),
  ('wifi_6e', 'Wi-Fi 6E', 'Wi-Fi 6E', 3),
  ('wifi_7', 'Wi-Fi 7 (802.11be)', 'Wi-Fi 7 (802.11be)', 4)) v(code, ar, en, sort)
 where d.code = 'wi_fi_standard' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = true where code = 'window_position' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('windshield', 'الزجاج الأمامي', 'Windshield', 0),
  ('rear', 'الزجاج الخلفي', 'Rear window', 1),
  ('side_front', 'الشبابيك الأمامية', 'Front side windows', 2),
  ('side_rear', 'الشبابيك الخلفية', 'Rear side windows', 3),
  ('full_set', 'طقم كامل', 'Full set', 4)) v(code, ar, en, sort)
 where d.code = 'window_position' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wings' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('with_wings', 'بأجنحة', 'With wings', 0),
  ('without_wings', 'بدون أجنحة', 'Without wings', 1)) v(code, ar, en, sort)
 where d.code = 'wings' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wiper_blade_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('conventional', 'عادية بالهيكل المعدني', 'Conventional (framed)', 0),
  ('flat', 'فلات (بدون هيكل)', 'Flat / beam', 1),
  ('hybrid', 'هايبرد', 'Hybrid', 2),
  ('rear', 'مساحة خلفية', 'Rear blade', 3),
  ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'wiper_blade_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wrench_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('combination', 'مفتاح بلدي (شوكة + عين)', 'Combination', 0),
  ('open_end', 'مفتاح شوكة', 'Open-end', 1),
  ('ring', 'مفتاح عين', 'Ring / box', 2),
  ('ratcheting', 'مفتاح سقاطة', 'Ratcheting', 3),
  ('adjustable', 'مفتاح فرنساوي', 'Adjustable', 4),
  ('pipe', 'مفتاح مواسير (أمريكاني)', 'Pipe wrench', 5),
  ('hex_key', 'مفتاح ألن', 'Hex / Allen key', 6),
  ('socket', 'لقم وسقاطة', 'Socket set', 7),
  ('torque', 'مفتاح عزم', 'Torque wrench', 8),
  ('flare_nut', 'مفتاح ماسورة فرامل', 'Flare nut', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'wrench_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'wringing_method' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('spin_pedal', 'عصر دوار بدواسة', 'Spin with Foot Pedal', 0),
  ('spin_push', 'عصر دوار بالضغط على اليد', 'Push Spin', 1),
  ('press_wringer', 'عصارة ضغط', 'Press Wringer', 2),
  ('self_wring_twist', 'عصر ذاتي باللف', 'Self-wringing Twist', 3),
  ('butterfly_squeeze', 'عصر فراشة (طي)', 'Butterfly Squeeze', 4),
  ('roller', 'عصر بالرول', 'Roller Wringer', 5),
  ('manual', 'عصر يدوي', 'Manual Wringing', 6)) v(code, ar, en, sort)
 where d.code = 'wringing_method' and d.category_id is null
on conflict (attribute_id, code) do nothing;
update public.attribute_defs set type = 'enum', is_multi = false where code = 'yogurt_type' and category_id is null and type = 'text';
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d,
 (values ('plain', 'زبادي سادة', 'Plain set yogurt', 0),
  ('greek', 'زبادي يوناني', 'Greek', 1),
  ('fruit', 'بالفواكه', 'Fruit', 2),
  ('flavored', 'بنكهات', 'Flavored', 3),
  ('drinkable', 'زبادي شرب', 'Drinkable', 4),
  ('rayeb', 'رايب', 'Rayeb', 5),
  ('low_fat', 'لايت (قليل الدسم)', 'Low fat', 6),
  ('probiotic', 'بروبيوتيك (بيو)', 'Probiotic', 7),
  ('lactose_free', 'خالي من اللاكتوز', 'Lactose free', 8),
  ('plant_based', 'نباتي', 'Plant based', 9),
  ('other', 'أخرى', 'Other', 10)) v(code, ar, en, sort)
 where d.code = 'yogurt_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
-- 2. categories with no real choice
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'extension_cord_type', 'enum', '', 'نوع المشترك', 'Extension Cord Type', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'extension_cord_type' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('plain', 'مشترك عادي', 'Standard', 0), ('switched', 'بمفتاح لكل بريزة', 'Individually Switched', 1), ('surge', 'بحماية من الزيادة (Surge)', 'Surge Protected', 2), ('usb', 'بمنافذ USB', 'With USB Ports', 3), ('reel', 'بكرة سلك', 'Cable Reel', 4), ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'extension_cord_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.unlink('extension-cords', array['type']::text[]);
select pg_temp.link('extension-cords', array['extension_cord_type']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'film_camera_type', 'enum', '', 'نوع الكاميرا', 'Film Camera Type', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'film_camera_type' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('f35mm', 'فيلم 35 مم', '35mm Film', 0), ('instant', 'فورية (تطبع الصورة)', 'Instant', 1), ('medium_format', 'فيلم 120 (ميديم فورمات)', 'Medium Format (120)', 2), ('disposable', 'استخدام مرة واحدة', 'Disposable', 3), ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'film_camera_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.link('film-cameras', array['film_camera_type']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'contact_product_type', 'enum', '', 'نوع المنتج', 'Product Type', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'contact_product_type' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('clear_rx', 'عدسات طبية شفافة', 'Clear Prescription Lenses', 0), ('colored', 'عدسات ملونة بدون مقاس', 'Colored Lenses (Plano)', 1), ('colored_rx', 'عدسات ملونة بمقاس', 'Colored Prescription Lenses', 2), ('solution', 'محلول عدسات', 'Lens Solution', 3), ('drops', 'قطرة مرطبة', 'Rewetting Drops', 4), ('case', 'جراب / حافظة عدسات', 'Lens Case', 5)) v(code, ar, en, sort)
 where d.code = 'contact_product_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'lens_wear_period', 'enum', '', 'مدة الاستخدام', 'Replacement Period', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'lens_wear_period' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('daily', 'يومي', 'Daily', 0), ('biweekly', 'أسبوعين', 'Two-Weekly', 1), ('monthly', 'شهري', 'Monthly', 2), ('quarterly', '3 شهور', 'Quarterly', 3), ('yearly', 'سنوي', 'Yearly', 4), ('na', 'لا ينطبق (محلول / قطرة)', 'Not Applicable', 5)) v(code, ar, en, sort)
 where d.code = 'lens_wear_period' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.unlink('contact-lenses-and-solutions', array['type']::text[]);
select pg_temp.link('contact-lenses-and-solutions', array['contact_product_type','lens_wear_period']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'ro_installation', 'enum', '', 'طريقة التركيب', 'Installation', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'ro_installation' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('under_sink', 'تحت الحوض', 'Under Sink', 0), ('countertop', 'على الرخامة', 'Countertop', 1), ('wall', 'على الحائط', 'Wall Mounted', 2), ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'ro_installation' and d.category_id is null
on conflict (attribute_id, code) do nothing;
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'ro_features', 'enum', '', 'مميزات إضافية', 'Extra Features', true, 10
 where not exists (select 1 from public.attribute_defs where code = 'ro_features' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('pump', 'بموتور (مضخة)', 'Booster Pump', 0), ('tank', 'بتانك تخزين', 'Storage Tank', 1), ('tankless', 'بدون تانك', 'Tankless', 2), ('mineral', 'مرحلة معادن', 'Mineral Stage', 3), ('alkaline', 'مرحلة قلوية (Alkaline)', 'Alkaline Stage', 4), ('uv', 'تعقيم UV', 'UV Sterilizer', 5), ('tds', 'عداد TDS', 'TDS Meter', 6)) v(code, ar, en, sort)
 where d.code = 'ro_features' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.link('ro-water-purifiers', array['ro_installation','ro_features']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'napkin_design', 'enum', '', 'التصميم', 'Design', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'napkin_design' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('plain_white', 'سادة أبيض', 'Plain White', 0), ('colored', 'ملون', 'Colored', 1), ('printed', 'مطبوع / مزخرف', 'Printed', 2), ('occasions', 'تصميم مناسبات', 'Occasion Design', 3), ('other', 'أخرى', 'Other', 4)) v(code, ar, en, sort)
 where d.code = 'napkin_design' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.link('paper-napkins', array['napkin_design']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'trash_bag_closure', 'enum', '', 'طريقة الربط', 'Closure', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'trash_bag_closure' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('drawstring', 'برباط شد', 'Drawstring', 0), ('handles', 'بمقابض (يد)', 'Tie Handles', 1), ('flat', 'عادي بدون رباط', 'Flat Top', 2), ('other', 'أخرى', 'Other', 3)) v(code, ar, en, sort)
 where d.code = 'trash_bag_closure' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.link('trash-bags', array['trash_bag_closure']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'camera_battery_type', 'enum', '', 'نوع البطارية', 'Battery Type', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'camera_battery_type' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('li_ion', 'ليثيوم أيون قابلة للشحن', 'Rechargeable Li-ion', 0), ('lithium', 'ليثيوم غير قابلة للشحن', 'Lithium (Non-rechargeable)', 1), ('nimh', 'NiMH قابلة للشحن', 'Rechargeable NiMH', 2), ('alkaline', 'قلوية (ألكالاين)', 'Alkaline', 3), ('grip', 'قبضة بطارية (Battery Grip)', 'Battery Grip', 4), ('other', 'أخرى', 'Other', 5)) v(code, ar, en, sort)
 where d.code = 'camera_battery_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.unlink('camera-batteries', array['type']::text[]);
select pg_temp.link('camera-batteries', array['camera_battery_type']::text[]);
insert into public.attribute_defs (code, type, unit, label_ar, label_en, is_multi, sort)
select 'car_fluid_type', 'enum', '', 'نوع السائل', 'Fluid Type', false, 10
 where not exists (select 1 from public.attribute_defs where code = 'car_fluid_type' and category_id is null);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, v.code, v.ar, v.en, v.sort from public.attribute_defs d, (values ('engine_oil', 'زيت موتور', 'Engine Oil', 0), ('gear_oil', 'زيت فتيس', 'Transmission Oil', 1), ('brake_fluid', 'زيت فرامل', 'Brake Fluid', 2), ('coolant', 'مياه رادياتير (كولانت)', 'Coolant', 3), ('power_steering', 'زيت باور', 'Power Steering Fluid', 4), ('washer', 'مياه مساحات', 'Washer Fluid', 5), ('distilled', 'مياه مقطرة للبطارية', 'Distilled Water', 6), ('other', 'أخرى', 'Other', 7)) v(code, ar, en, sort)
 where d.code = 'car_fluid_type' and d.category_id is null
on conflict (attribute_id, code) do nothing;
select pg_temp.link('car-fluids', array['car_fluid_type']::text[]);
