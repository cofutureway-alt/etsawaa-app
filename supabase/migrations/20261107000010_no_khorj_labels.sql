-- «خرج / مخرج / مخارج» are not words buyers use; say بريزة (socket) or منفذ (port) (2026-11-07)
update public.attribute_defs set label_ar = 'عدد البرايز', label_en = 'Number of Sockets'
 where code = 'ac_outlet_count' and category_id is null;          -- power strips, was «عدد مخارج الكهرباء»
update public.attribute_defs set label_ar = 'نوع البرايز', label_en = 'Socket Type'
 where code = 'outlet_type' and category_id is null;              -- power strips, was «نوع مخارج الكهرباء»
update public.attribute_defs set label_ar = 'عدد البرايز', label_en = 'Number of Sockets'
 where code = 'outlets' and category_id is null;                  -- extension cords, was «عدد المخارج»
update public.attribute_defs set label_ar = 'أنواع البرايز المتوافقة', label_en = 'Compatible Socket Types'
 where code = 'compatible_socket_types' and category_id is null;  -- plug adapters, was «أنواع المخارج المتوافقة»
update public.attribute_defs set label_ar = 'منافذ توصيل الشاشة (HDMI / DisplayPort)', label_en = 'Display Ports'
 where code = 'display_outputs' and category_id is null;          -- graphics cards, was «مخارج الصورة»
update public.attribute_defs set label_ar = 'منفذ HDMI', label_en = 'HDMI Port'
 where code = 'hdmi_output' and category_id is null;              -- was «مخرج HDMI»
