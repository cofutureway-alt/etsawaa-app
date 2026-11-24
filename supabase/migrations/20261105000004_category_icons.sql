-- Icons for every sub-category (only the 10 roots had one). Keys must exist in
-- app/components/catalog/CategoryIcon.tsx. Rules are matched against the
-- English name, most specific first; a category with no matching rule inherits
-- its parent's icon. Only empty icons are filled — admin choices are kept.

create temporary table _icon_rules (ord int, pattern text, icon text);
insert into _icon_rules (ord, pattern, icon) values
  (10, 'perfume|fragrance|body splash|scented', 'perfume'),
  (11, 'smartwatch|wearable', 'watch'),
  (12, '\mwatch|clock', 'watch'),
  (13, 'eyewear|glasses', 'glasses'),
  (14, 'jewel|precious|\mrings?\M|necklace|bracelet|earring', 'gem'),
  (15, 'handbag|backpack|luggage|wallet|leather|travel gear|\mbags?\M', 'bag'),
  (16, 'flip flop|slipper|sandal|boot|shoe|sneaker', 'shoe'),
  (17, 'sock|underwear|lingerie|nightwear|loungewear', 'sock'),
  (18, 'abaya|jalabiya|soiree|dress|hijab|scar(f|ves)|women''s fashion|girls', 'dress'),
  (19, 'stroller|car seat|walker', 'stroller'),
  (20, 'crib|cradle|newborn|baby|diaper|infant', 'baby'),
  (21, 'tablet', 'tablet'),
  (22, 'phone|mobile', 'smartphone'),
  (23, 'laptop|notebook computer', 'laptop'),
  (24, 'printer|scanner', 'printer'),
  (25, 'computer|desktop|monitor|keyboard\M(?! instrument)|mouse|networking|storage device', 'monitor'),
  (26, 'gaming|console|video game', 'gamepad'),
  (27, 'screen|tv|television|receiver|projector', 'tv'),
  (28, 'headphone|earbud|speaker|audio|home theater|sound', 'headphones'),
  (29, 'camera|photo|security system', 'camera'),
  (30, 'instrument|guitar|piano|drum|string|percussion|wind\M', 'music'),
  (31, 'smart home', 'home'),
  (32, 'refrigerator|freezer|cooker|cooktop|oven|range hood|dishwasher|large appliance', 'fridge'),
  (33, 'washer|dryer|laundry', 'washer'),
  (34, 'air condition|cooling', 'snowflake'),
  (35, 'heater|heating', 'flame'),
  (36, '\mfan', 'fan'),
  (37, 'water dispenser|water cooler|filter|purifier|humidifier|aquarium heater', 'droplet'),
  (38, 'coffee|tea\M|kettle|juicer|beverage|drink', 'coffee'),
  (39, 'blender|mixer|chopper|processor|toaster|fryer|grill|waffle|sandwich maker|microwave|rice cooker|iron|steamer|vacuum|small appliance|sewing', 'plug'),
  (40, 'kitchen|cook|dining|utensil|cutlery|container|organizer|bowl', 'utensils'),
  (41, 'clean|detergent|tissue|disposable|pest', 'spray'),
  (42, 'dairy|egg|snack|sweet|breakfast|pantry|food|frozen|canned|grocer|condiment|fruit|vegetable', 'apple'),
  (43, 'bedding|mattress|pillow|blanket|\mbed', 'bed'),
  (44, 'furniture|sofa|chair', 'sofa'),
  (45, 'lighting|lamp|electrical|power tool', 'lamp'),
  (46, 'garden|outdoor|plant', 'leaf'),
  (47, 'tool|maintenance|hardware|industrial|scientific|emergency', 'wrench'),
  (48, 'packag|shipping|box|tape|bubble wrap|storage', 'package'),
  (49, 'motorcycle|bike|bicycle|cycling', 'bike'),
  (50, 'car\M|vehicle|tire|tyre|auto|motor oil|oils', 'car'),
  (51, 'aquarium|fish|bird', 'fish'),
  (52, '\mpet|\mdog|\mcat\M|\mcats\M', 'paw'),
  (53, 'swim|diving|beach|pool|water sport', 'waves'),
  (54, 'gym|weight|fitness|dumbbell|yoga|exercise', 'dumbbell'),
  (55, 'sport|ball|football|tennis|racket', 'ball'),
  (56, 'toy|game|puzzle|block|montessori|tent|doll|plush|lego', 'puzzle'),
  (57, 'gift|party|balloon|costume|favor|event|giveaway|wrapping', 'gift'),
  (58, 'art|craft|handmade|artisan|paint|decor', 'palette'),
  (59, 'book|novel|magazine|media', 'book'),
  (60, 'stationery|office|school|planner|pen\M|pencil', 'pen'),
  (61, 'shav|razor|trimmer|hair removal|hair care|hair accessor', 'scissors'),
  (62, 'medical|health|wellness|first aid|vitamin|supplement|dental|oral', 'stethoscope'),
  (63, 'makeup|cosmetic|skin|beauty|nail|lip', 'sparkles'),
  (64, 'shirt|cloth|wear|fashion|suit|casual|formal|unisex|jacket|pants|jeans|kids', 'shirt'),
  (65, 'essential|home', 'home');

update public.categories c
   set icon = r.icon
  from (
    select distinct on (c2.id) c2.id, ir.icon
      from public.categories c2
      join _icon_rules ir on c2.name_en ~* ir.pattern
     where c2.icon is null and c2.depth > 1
     order by c2.id, ir.ord
  ) r
 where c.id = r.id;

-- no rule matched → parent's icon (depth by depth so it cascades)
do $$
declare d int;
begin
  for d in 2..6 loop
    update public.categories c set icon = p.icon
      from public.categories p
     where c.parent_id = p.id and c.depth = d and c.icon is null and p.icon is not null;
  end loop;
end $$;

drop table _icon_rules;

-- hand fixes for names the generic rules misread
update public.categories c set icon = 'music'
  where c.icon = 'gem' and (c.name_en ~* 'string instrument' or exists (select 1 from public.categories p where p.id = c.parent_id and p.name_en ~* 'string instrument'));
update public.categories set icon = 'flame' where name_en ~* '^(ovens|cookers|cooktop|rice cookers)$';
update public.categories c set icon = 'car'
  where c.name_en ~* 'interior & exterior' or exists (select 1 from public.categories p where p.id = c.parent_id and p.name_en ~* 'interior & exterior');
