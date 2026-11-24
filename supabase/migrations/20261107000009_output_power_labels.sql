-- «قدرة الخرج» is engineering jargon; say what the buyer is comparing (2026-11-07)
update public.attribute_defs set label_ar = 'قوة الصوت (وات)', label_en = 'Sound Power (W)', unit = 'W'
 where code = 'power_output' and category_id is null;                  -- speakers, amplifiers, subwoofers, soundbars
update public.attribute_defs set label_ar = 'أقصى قوة شحن (وات)', label_en = 'Max Charging Power (W)'
 where code = 'maximum_total_output_power' and category_id is null;    -- power banks, chargers
update public.attribute_defs set label_ar = 'قدرة الباور سبلاي (وات)', label_en = 'Power Supply Wattage (W)'
 where code = 'rated_output_power' and category_id is null;            -- PC power supplies
update public.attribute_defs set label_ar = 'قوة الميكروويف (وات)', label_en = 'Microwave Power (W)'
 where code = 'microwave_output_power' and category_id is null;
update public.attribute_defs set label_ar = 'أنواع منافذ الشحن (USB-C / USB-A)', label_en = 'Charging Port Types' where label_ar = 'أنواع منافذ الخرج' and category_id is null;  -- chargers, power banks
