-- Fit option "slim": «سليم» reads as "healthy/intact" in Arabic, not a cut.
update public.attribute_options o
   set label_ar = 'سليم فيت (ضيق)', label_en = 'Slim fit'
  from public.attribute_defs d
 where d.id = o.attribute_id and d.code = 'fit' and d.category_id is null and o.code = 'slim';
