-- Owner asked to keep these labels as they were: reverts 20261107000010 (2026-11-07)
update public.attribute_defs set label_ar = 'عدد مخارج الكهرباء', label_en = 'AC Outlet Count'   where code = 'ac_outlet_count' and category_id is null;
update public.attribute_defs set label_ar = 'نوع مخارج الكهرباء', label_en = 'Outlet Type'      where code = 'outlet_type' and category_id is null;
update public.attribute_defs set label_ar = 'عدد المخارج', label_en = 'Outlets'                  where code = 'outlets' and category_id is null;
update public.attribute_defs set label_ar = 'أنواع المخارج المتوافقة', label_en = 'Compatible Socket Types' where code = 'compatible_socket_types' and category_id is null;
update public.attribute_defs set label_ar = 'مخارج الصورة', label_en = 'Display Outputs'          where code = 'display_outputs' and category_id is null;
update public.attribute_defs set label_ar = 'مخرج HDMI', label_en = 'HDMI Output'                where code = 'hdmi_output' and category_id is null;
