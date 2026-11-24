-- Attribute dictionary curation (2026-11-07): each category now offers only the
-- options that make sense for it, labels are generic where the spec is shared,
-- links that made no sense (pants cut on watches, belts, shoes…) are removed,
-- and specs that naturally take several values are multi-select.
-- Data-only; depends on 20261107000001 (allowed_option_ids / is_multi).

-- ── classify every linked category ───────────────────────────────────────────
create temp table _leaf as
select c.id, c.slug_en as slug, coalesce(s.slug_en, '') as sub
  from public.categories c
  left join public.categories s on s.id = nullif(split_part(c.path, '/', 2), '')::uuid
 where c.deleted_at is null and c.id in (select category_id from public.category_attributes);

alter table _leaf add column shoe boolean, add column apparel boolean, add column acc boolean,
  add column bottom boolean, add column outer_ boolean, add column shirt boolean;

update _leaf set shoe = sub in ('mens-shoes', 'womens-shoes', 'kids-shoes')
  or slug ~ '(shoe|sneaker|boot|sandal|slipper|heels|flats|wedge|loafer|clog|moccasin|brogue|oxford|derby)';
update _leaf set apparel = not shoe and (
     sub in ('mens-fashion', 'womens-fashion', 'kids-and-baby-fashion', 'sportswear-and-shoes-and-accessories')
  or slug in ('motorcycle-jackets', 'halloween-costumes', 'party-costumes', 'travel-raincoats', 'aprons'));
-- garments vs. textile accessories inside the fashion branches
update _leaf set acc = apparel and slug ~ '(sock|hosiery|stocking|tights|scar(f|ves)|shawl|pashmina|(^|-)wraps$|headband|pocket-square|(^|-)ties|belt|watch|glasses|eyewear|clip|glove|cap|hat)';
update _leaf set bottom = apparel and not acc and slug ~ '(jean|trouser|pants|short|chino|culotte|skirt|jogger|legging|palazzo)';
update _leaf set outer_ = apparel and not acc and slug ~ '(jacket|coat|vest|blazer|waistcoat|gilet|bolero|suit)';
update _leaf set shirt = apparel and not acc and slug ~ 'shirt' and slug !~ '(t-shirt|sweatshirt|polo|undershirt)';

-- set allowed options for (attribute code, matching categories)
create or replace function pg_temp.scope(p_code text, p_where text, p_opts text[]) returns void
language plpgsql as $f$
begin
  execute format($q$
    update public.category_attributes ca
       set allowed_option_ids = (
         select array_agg(o.id order by o.sort, o.id) from public.attribute_options o
          where o.attribute_id = ca.attribute_id and o.deleted_at is null and o.code = any($1))
      from _leaf l
     where l.id = ca.category_id
       and ca.attribute_id = (select id from public.attribute_defs where code = $2 and category_id is null and deleted_at is null)
       and (%s)$q$, p_where)
  using p_opts, p_code;
end $f$;

-- remove a link unless a product in that category already stores a value for it
create or replace function pg_temp.unlink(p_code text, p_where text) returns void
language plpgsql as $f$
begin
  execute format($q$
    delete from public.category_attributes ca
     using _leaf l
     where l.id = ca.category_id
       and ca.attribute_id = (select id from public.attribute_defs where code = $1 and category_id is null and deleted_at is null)
       and (%s)
       and not exists (select 1 from public.product_attribute_values pav join public.products p on p.id = pav.product_id
                        where pav.attribute_id = ca.attribute_id and p.leaf_category_id = ca.category_id)$q$, p_where)
  using p_code;
end $f$;

-- ── material families ────────────────────────────────────────────────────────
do $$
declare
  tex text[] := array['cotton','polyester','cotton_blend','linen','wool','silk','denim','nylon','elastane','viscose',
                      'acrylic','fleece','velvet','satin','chiffon','knit','canvas','mixed','other'];
  lea text[] := array['leather','faux_leather','suede'];
  tex_acc text[] := array['cotton','polyester','cotton_blend','linen','wool','silk','nylon','elastane','viscose','acrylic',
                          'fleece','velvet','satin','chiffon','knit','mixed','other'];
  shoes text[] := array['leather','faux_leather','suede','canvas','rubber','eva','knit','nylon','polyester','cotton','denim',
                        'velvet','satin','wool','fleece','foam','plastic','silicone','mixed','other'];
  bags text[] := array['leather','faux_leather','suede','canvas','nylon','polyester','cotton','denim','linen','velvet','satin',
                       'knit','plastic','silicone','metal','stainless_steel','mixed','other'];
  jewel text[] := array['gold','silver','stainless_steel','metal','brass','copper','aluminum','leather','faux_leather','plastic',
                        'abs','silicone','rubber','glass','tempered_glass','stone','wood','ceramic','silk','cotton','polyester',
                        'satin','velvet','nylon','mixed','other'];
  kitchen text[] := array['stainless_steel','aluminum','iron','copper','brass','metal','glass','tempered_glass','ceramic','porcelain',
                          'stone','marble','granite','wood','bamboo','plastic','abs','silicone','rubber','cotton','linen','polyester',
                          'paper','cardboard','mixed','other'];
  home text[] := array['cotton','polyester','cotton_blend','linen','wool','silk','nylon','acrylic','fleece','velvet','satin','knit',
                       'canvas','leather','faux_leather','suede','rubber','plastic','abs','silicone','metal','stainless_steel',
                       'aluminum','iron','copper','brass','gold','silver','glass','tempered_glass','ceramic','porcelain','wood',
                       'mdf','bamboo','paper','cardboard','stone','marble','granite','foam','mixed','other'];
  elec text[] := array['plastic','abs','metal','aluminum','stainless_steel','iron','copper','glass','tempered_glass','ceramic',
                       'silicone','rubber','leather','faux_leather','nylon','polyester','canvas','wood','mixed','other'];
  kids text[] := array['plastic','abs','wood','bamboo','cotton','polyester','fleece','velvet','nylon','silicone','rubber','foam',
                       'eva','metal','aluminum','stainless_steel','glass','paper','cardboard','canvas','mixed','other'];
  office text[] := array['paper','cardboard','plastic','abs','metal','aluminum','stainless_steel','wood','mdf','bamboo','leather',
                         'faux_leather','canvas','glass','silicone','rubber','mixed','other'];
  care text[] := array['plastic','abs','metal','stainless_steel','aluminum','glass','ceramic','wood','bamboo','silicone','rubber',
                       'nylon','cotton','foam','leather','faux_leather','mixed','other'];
  sport text[] := array['rubber','foam','eva','plastic','abs','metal','iron','stainless_steel','aluminum','nylon','polyester','cotton',
                        'elastane','leather','faux_leather','silicone','wood','canvas','mixed','other'];
  pet text[] := array['plastic','abs','stainless_steel','metal','ceramic','glass','wood','cotton','polyester','fleece','nylon','rubber',
                      'silicone','leather','faux_leather','canvas','mixed','other'];
  clean text[] := array['plastic','abs','metal','stainless_steel','aluminum','rubber','silicone','nylon','polyester','cotton','foam',
                        'wood','bamboo','mixed','other'];
  code text;
begin
  foreach code in array array['material', 'main_material'] loop
    perform pg_temp.scope(code, 'l.apparel and not l.acc and not (l.outer_ or l.bottom)', tex);
    perform pg_temp.scope(code, 'l.apparel and not l.acc and (l.outer_ or l.bottom)', tex || lea);
    perform pg_temp.scope(code, 'l.apparel and l.acc', tex_acc || lea);
    perform pg_temp.scope(code, 'l.shoe', shoes);
    perform pg_temp.scope(code, $w$not l.apparel and not l.shoe and l.sub = 'bags-and-leather-goods'$w$, bags);
    perform pg_temp.scope(code, $w$not l.apparel and not l.shoe and l.sub = 'accessories-and-jewellery'$w$, jewel);
    perform pg_temp.scope(code, $w$l.sub = 'kitchen-and-dining' and not l.apparel$w$, kitchen);
    perform pg_temp.scope(code, $w$l.sub = 'home-essentials'$w$, home);
    perform pg_temp.scope(code, $w$l.sub in ('computing-and-gaming','phones-and-tablets','televisions-and-audio','cameras-and-photography',
                                               'small-appliances','large-appliances','cooling-and-heating-appliances')$w$, elec);
    perform pg_temp.scope(code, $w$l.sub in ('toys-and-games','baby-care','gear-and-strollers-and-accessories')$w$, kids);
    perform pg_temp.scope(code, $w$l.sub = 'stationery-and-office'$w$, office);
    perform pg_temp.scope(code, $w$l.sub in ('personal-and-hair-care','makeup-and-cosmetics','men-and-women-perfumes','health-and-medical')$w$, care);
    perform pg_temp.scope(code, $w$not l.apparel and not l.shoe and l.sub in ('fitness-and-sports','water-sports-and-beach','sportswear-and-shoes-and-accessories')$w$, sport);
    perform pg_temp.scope(code, $w$l.sub = 'pet-supplies'$w$, pet);
    perform pg_temp.scope(code, $w$l.sub = 'household-cleaning'$w$, clean);
  end loop;
  -- fabric = textiles (+ leathers for outerwear/bottoms), wherever it is used
  perform pg_temp.scope('fabric_material', 'not (l.outer_ or l.bottom)', tex);
  perform pg_temp.scope('fabric_material', 'l.outer_ or l.bottom', tex || lea);
  perform pg_temp.scope('body_material', $w$l.sub = 'musical-instruments'$w$,
    array['wood','metal','plastic','abs','aluminum','brass','copper','stainless_steel','mixed','other']);
end $$;

-- ── fit: a garment spec — generic label, cuts that match the garment ─────────
update public.attribute_defs set label_ar = 'القصة', label_en = 'Fit'
 where code = 'fit' and category_id is null;
select pg_temp.unlink('fit', 'not l.apparel or l.acc');
select pg_temp.scope('fit', 'l.apparel and not l.acc and not l.bottom',
  array['regular','slim','relaxed','oversized','athletic']);
select pg_temp.scope('fit', 'l.apparel and l.bottom',
  array['regular','slim','skinny','relaxed','oversized','straight','tapered','wide_leg','bootcut','athletic']);

-- «فئة طول البنطلون» is linked to coats, cardigans, nightdresses… → generic "length"
update public.attribute_defs set label_ar = 'الطول', label_en = 'Length'
 where code = 'length_style' and category_id is null;

-- ── sleeve length: tops only; it is a choice, not centimetres ────────────────
update public.attribute_defs set unit = '' where code = 'sleeve_length' and category_id is null;
select pg_temp.unlink('sleeve_length', 'l.bottom or l.acc or l.shoe');
insert into public.category_attributes (category_id, attribute_id, sort)
select l.id, d.id, coalesce((select max(sort) + 1 from public.category_attributes x where x.category_id = l.id), 0)
  from _leaf l cross join public.attribute_defs d
 where d.code = 'sleeve_length' and d.category_id is null and d.deleted_at is null
   and l.apparel and not l.acc and not l.bottom
   and l.slug ~ '(shirt|blouse|top|sweater|pullover|hoodie|cardigan|dress|abaya|jalabiya|kaftan|tunic|jacket|blazer|coat|bodysuit|romper|pyjama|nightgown)'
on conflict do nothing;

-- ── neckline / collar: an option list instead of free text, on tops ──────────
update public.attribute_defs set type = 'enum', is_filterable = true, label_ar = 'الياقة / فتحة الرقبة', label_en = 'Neckline / Collar'
 where code = 'neckline' and category_id is null
   and not exists (select 1 from public.product_attribute_values v where v.attribute_id = attribute_defs.id);
insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort)
select d.id, o.code, o.ar, o.en, o.sort
  from public.attribute_defs d
  cross join (values
    ('classic_collar', 'ياقة قميص كلاسيك', 'Classic collar', 1),
    ('button_down', 'ياقة بزراير', 'Button-down collar', 2),
    ('mandarin', 'ياقة صيني (ماندارين)', 'Mandarin collar', 3),
    ('cuban', 'ياقة كوبي (مفتوحة)', 'Cuban / camp collar', 4),
    ('polo', 'ياقة بولو', 'Polo collar', 5),
    ('round', 'رقبة دائرية', 'Crew / round neck', 6),
    ('v_neck', 'رقبة V', 'V-neck', 7),
    ('henley', 'هينلي (بزراير)', 'Henley', 8),
    ('turtleneck', 'رقبة عالية (هاي نك)', 'Turtleneck', 9),
    ('hooded', 'بكابيشون', 'Hooded', 10),
    ('square', 'رقبة مربعة', 'Square neck', 11),
    ('boat', 'رقبة قارب', 'Boat neck', 12),
    ('sweetheart', 'رقبة قلب', 'Sweetheart', 13),
    ('halter', 'هالتر', 'Halter', 14),
    ('off_shoulder', 'أوف شولدر', 'Off-shoulder', 15),
    ('other', 'أخرى', 'Other', 16)
  ) o(code, ar, en, sort)
 where d.code = 'neckline' and d.category_id is null and d.type = 'enum'
   and not exists (select 1 from public.attribute_options x where x.attribute_id = d.id and x.code = o.code);
insert into public.category_attributes (category_id, attribute_id, sort)
select l.id, d.id, coalesce((select max(sort) + 1 from public.category_attributes x where x.category_id = l.id), 0)
  from _leaf l cross join public.attribute_defs d
 where d.code = 'neckline' and d.category_id is null and d.type = 'enum' and d.deleted_at is null
   and l.apparel and not l.acc and not l.bottom
   and l.slug ~ '(shirt|blouse|top|sweater|pullover|hoodie|cardigan|dress|bodysuit|tunic)'
on conflict do nothing;
select pg_temp.scope('neckline', 'l.shirt', array['classic_collar','button_down','mandarin','cuban','other']);
select pg_temp.scope('neckline', $w$l.slug ~ 'polo'$w$, array['polo','other']);
select pg_temp.scope('neckline', $w$l.slug ~ '(t-shirt|tank|undershirt|sweatshirt|hoodie|sweater|pullover)'$w$,
  array['round','v_neck','henley','turtleneck','hooded','polo','other']);

-- ── closure: drop it from packing tape, bubble wrap, trash bags… ─────────────
select pg_temp.unlink('closure_type', $w$l.slug ~ '(tape|bubble|trash|shipping-box|luggage-tag)'$w$);
select pg_temp.scope('closure_type', 'l.bottom', array['zipper','buttons','snap','drawstring','elastic','none']);
select pg_temp.scope('closure_type', 'l.shoe', array['lace_up','slip_on','velcro','buckle','zipper','elastic','none']);

-- ── power source unit was "W" ────────────────────────────────────────────────
update public.attribute_defs set unit = '' where code = 'power_source' and category_id is null;

-- ── multi-select specs ───────────────────────────────────────────────────────
update public.attribute_defs set is_multi = true
 where category_id is null and type = 'enum'
   and code in ('material', 'fabric_material', 'occasion', 'suitable_skin_type', 'age_group',
                'suitable_age_group', 'power_source', 'pattern');

-- ── label spelling (ه → ة) ───────────────────────────────────────────────────
update public.attribute_defs set label_ar = 'الخامة' where code = 'material' and category_id is null and label_ar = 'الخامه';
update public.attribute_defs set label_ar = 'الفئة العمرية' where code = 'age_group' and category_id is null and label_ar = 'الفئه العمريه';
update public.attribute_defs set label_ar = 'نوع البشرة المناسب' where code = 'suitable_skin_type' and category_id is null and label_ar = 'نوع البشره المناسب';
update public.attribute_defs set label_ar = 'طريقة الإغلاق' where code = 'closure_type' and category_id is null and label_ar = 'طريقه الإغلاق';
