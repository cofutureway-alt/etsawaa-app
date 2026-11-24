-- New product types for toys, missing electronics pieces, and the shared
-- fashion "strap / shoulder style" spec.
-- Idempotent: no duplicate category, option or category_attributes link.

create or replace function pg_temp.add_leaf(
  p_parent_slug text,
  p_slug_en text,
  p_name_ar text,
  p_name_en text,
  p_template_slug text,
  p_sort int
) returns uuid
language plpgsql as $fn$
declare
  v_parent public.categories%rowtype;
  v_template public.categories%rowtype;
  v_leaf_id uuid;
  v_slug_ar text;
  v_suffix int := 2;
  v_source_key text;
begin
  select * into v_parent
    from public.categories
   where slug_en = p_parent_slug
     and deleted_at is null
   limit 1;
  if not found then
    raise exception 'add_leaf: parent category % not found', p_parent_slug;
  end if;

  select * into v_template
    from public.categories
   where slug_en = p_template_slug
     and deleted_at is null
   limit 1;
  if not found then
    raise exception 'add_leaf: template leaf % not found', p_template_slug;
  end if;

  if exists (
    select 1 from public.categories
     where slug_en = p_slug_en
       and deleted_at is null
  ) then
    return null;
  end if;

  -- URL-safe: no parentheses, slashes or commas in the slug
  v_slug_ar := btrim(regexp_replace(regexp_replace(btrim(p_name_ar), '[()/،,]+', ' ', 'g'), '\s+', '-', 'g'), '-');
  while exists (
    select 1 from public.categories
     where slug_ar = v_slug_ar
       and deleted_at is null
  ) loop
    v_slug_ar := btrim(regexp_replace(regexp_replace(btrim(p_name_ar), '[()/،,]+', ' ', 'g'), '\s+', '-', 'g'), '-') || '-' || v_suffix;
    v_suffix := v_suffix + 1;
  end loop;

  v_source_key := case
    when v_parent.source_key is null then null
    else v_parent.source_key || '/' || p_slug_en
  end;
  -- source_key is unique even for soft-deleted rows; keep the insert safe.
  if v_source_key is not null and exists (
    select 1 from public.categories where source_key = v_source_key
  ) then
    v_source_key := null;
  end if;

  insert into public.categories (
    parent_id, slug_ar, slug_en, name_ar, name_en, sort, icon, source_key
  ) values (
    v_parent.id, v_slug_ar, p_slug_en, btrim(p_name_ar), p_name_en,
    p_sort, v_template.icon, v_source_key
  )
  returning id into v_leaf_id;

  insert into public.category_attributes (
    category_id, attribute_id, sort, allowed_option_ids, is_required
  )
  select v_leaf_id, ca.attribute_id, ca.sort, ca.allowed_option_ids, ca.is_required
    from public.category_attributes ca
   where ca.category_id = v_template.id
  on conflict do nothing;

  insert into public.size_type_categories (size_type_id, category_id)
  select st.size_type_id, v_leaf_id
    from public.size_type_categories st
   where st.category_id = v_template.id
  on conflict do nothing;

  return v_leaf_id;
end;
$fn$;

-- 1a) group names that now match their contents
update public.categories
   set name_ar = 'عرايس ودمى وألعاب تقمّص الأدوار',
       name_en = 'Dolls, Plush & Pretend Play'
 where slug_en = 'plush-toys'
   and deleted_at is null;

update public.categories
   set name_ar = 'مكعبات وألعاب تركيب',
       name_en = 'Blocks & Construction Toys'
 where slug_en = 'blocks'
   and deleted_at is null;

-- 1b) toy product types, all using the generic yo-yos toy template
do $$ begin
  perform pg_temp.add_leaf('plush-toys', 'doll-strollers-and-beds', 'عربات وأسرّة العرايس', 'Doll Strollers & Beds', 'yo-yos', 2000);
  perform pg_temp.add_leaf('plush-toys', 'doll-clothes-and-accessories', 'ملابس وإكسسوارات العرايس', 'Doll Clothes & Accessories', 'yo-yos', 2001);
  perform pg_temp.add_leaf('plush-toys', 'hand-and-finger-puppets', 'عرائس اليد والأصابع', 'Hand & Finger Puppets', 'yo-yos', 2002);
  perform pg_temp.add_leaf('plush-toys', 'toy-animals-and-dinosaurs', 'حيوانات وديناصورات لعبة', 'Toy Animals & Dinosaurs', 'yo-yos', 2003);
  perform pg_temp.add_leaf('plush-toys', 'toy-shops-and-cash-registers', 'ألعاب السوبر ماركت والكاشير', 'Toy Shops & Cash Registers', 'yo-yos', 2004);
  perform pg_temp.add_leaf('plush-toys', 'toy-tea-and-cookware-sets', 'أطقم شاي وأواني لعبة', 'Toy Tea & Cookware Sets', 'yo-yos', 2005);
  perform pg_temp.add_leaf('plush-toys', 'costumes-and-dress-up', 'أزياء تنكرية وملابس شخصيات', 'Costumes & Dress-Up', 'yo-yos', 2006);
  perform pg_temp.add_leaf('plush-toys', 'toy-blasters-and-water-guns', 'مسدسات لعبة ومسدسات مياه', 'Toy Blasters & Water Guns', 'yo-yos', 2007);
  perform pg_temp.add_leaf('plush-toys', 'toy-swords-and-shields', 'سيوف ودروع لعبة', 'Toy Swords & Shields', 'yo-yos', 2008);
  perform pg_temp.add_leaf('plush-toys', 'fidget-toys-and-spinners', 'ألعاب فيدجيت وسبينر', 'Fidget Toys & Spinners', 'yo-yos', 2009);
  perform pg_temp.add_leaf('plush-toys', 'surprise-toys-and-blind-boxes', 'ألعاب مفاجآت وبيض مفاجآت', 'Surprise Toys & Blind Boxes', 'yo-yos', 2010);
  perform pg_temp.add_leaf('plush-toys', 'balloons-and-party-toys', 'بالونات وألعاب الحفلات', 'Balloons & Party Toys', 'yo-yos', 2011);
  perform pg_temp.add_leaf('plush-toys', 'other-dolls-and-pretend-play', 'ألعاب أخرى (عرايس وتقمّص أدوار)', 'Other Dolls & Pretend Play', 'yo-yos', 2990);

  perform pg_temp.add_leaf('blocks', 'magnetic-tiles-and-blocks', 'مكعبات مغناطيسية', 'Magnetic Tiles & Blocks', 'yo-yos', 2000);
  perform pg_temp.add_leaf('blocks', 'wooden-blocks', 'مكعبات خشبية', 'Wooden Blocks', 'yo-yos', 2001);
  perform pg_temp.add_leaf('blocks', 'construction-and-engineering-sets', 'ألعاب ميكانو وتركيب بالمسامير', 'Construction & Engineering Sets', 'yo-yos', 2002);
  perform pg_temp.add_leaf('blocks', 'large-toddler-blocks', 'مكعبات كبيرة للصغار', 'Large Toddler Blocks', 'yo-yos', 2003);
  perform pg_temp.add_leaf('blocks', 'other-construction-toys', 'ألعاب تركيب أخرى', 'Other Construction Toys', 'yo-yos', 2990);

  perform pg_temp.add_leaf('card-games', 'trading-and-collectible-cards', 'كروت تجميع وتبادل', 'Trading & Collectible Cards', 'yo-yos', 2000);
  perform pg_temp.add_leaf('card-games', 'family-card-games', 'أونو وألعاب الكروت العائلية', 'Family Card Games', 'yo-yos', 2001);
  perform pg_temp.add_leaf('card-games', 'flash-cards', 'كروت تعليمية (فلاش كارد)', 'Flash Cards', 'yo-yos', 2002);
  perform pg_temp.add_leaf('card-games', 'other-card-games', 'ألعاب ورق أخرى', 'Other Card Games', 'yo-yos', 2990);

  perform pg_temp.add_leaf('board-games', 'dominoes', 'دومينو', 'Dominoes', 'yo-yos', 2000);
  perform pg_temp.add_leaf('board-games', 'backgammon-sets', 'طاولة (باك جامون)', 'Backgammon Sets', 'yo-yos', 2001);
  perform pg_temp.add_leaf('board-games', 'rubiks-cubes-and-brain-teasers', 'مكعب روبيك وألغاز الذكاء', 'Rubik''s Cubes & Brain Teasers', 'yo-yos', 2002);
  perform pg_temp.add_leaf('board-games', 'party-games', 'ألعاب جماعية للحفلات', 'Party Games', 'yo-yos', 2003);
  perform pg_temp.add_leaf('board-games', 'monopoly-and-strategy-games', 'بنك الحظ وألعاب الاستراتيجية', 'Monopoly & Strategy Games', 'yo-yos', 2004);
  perform pg_temp.add_leaf('board-games', 'dart-boards-and-target-games', 'دارت وألعاب تصويب', 'Dart Boards & Target Games', 'yo-yos', 2005);
  perform pg_temp.add_leaf('board-games', 'foosball-and-tabletop-sports', 'بيبي فوت وألعاب طاولة رياضية', 'Foosball & Tabletop Sports', 'yo-yos', 2006);
  perform pg_temp.add_leaf('board-games', 'other-board-games', 'ألعاب طاولة أخرى', 'Other Board Games', 'yo-yos', 2990);

  perform pg_temp.add_leaf('learning-and-montessori-games', 'drawing-and-writing-boards', 'سبورات ولوحات رسم', 'Drawing & Writing Boards', 'yo-yos', 2000);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'kids-colouring-and-art-sets', 'أطقم تلوين ورسم للأطفال', 'Kids'' Colouring & Art Sets', 'yo-yos', 2001);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'science-and-stem-kits', 'ألعاب علمية وتجارب', 'Science & STEM Kits', 'yo-yos', 2002);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'kids-learning-tablets-and-laptops', 'تابلت ولاب توب تعليمي للأطفال', 'Kids'' Learning Tablets & Laptops', 'yo-yos', 2003);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'beads-and-craft-kits', 'ألعاب خرز وأشغال يدوية', 'Beads & Craft Kits', 'yo-yos', 2004);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'abacus-and-counting-toys', 'عدّاد وألعاب الحساب', 'Abacus & Counting Toys', 'yo-yos', 2005);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'bath-toys', 'ألعاب الاستحمام', 'Bath Toys', 'yo-yos', 2006);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'push-and-pull-toys', 'ألعاب الدفع والسحب', 'Push & Pull Toys', 'yo-yos', 2007);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'musical-light-up-toys', 'ألعاب موسيقية بالأضواء', 'Musical Light-Up Toys', 'yo-yos', 2008);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'wooden-montessori-toys', 'ألعاب خشبية مونتيسوري', 'Wooden Montessori Toys', 'yo-yos', 2009);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'cloth-and-sound-books', 'كتب قماش وكتب صوتية', 'Cloth & Sound Books', 'yo-yos', 2010);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'kids-microscopes-and-telescopes', 'ميكروسكوب وتلسكوب للأطفال', 'Kids'' Microscopes & Telescopes', 'yo-yos', 2011);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'stickers-and-kids-tattoos', 'ستيكرز وتاتو أطفال', 'Stickers & Kids'' Tattoos', 'yo-yos', 2012);
  perform pg_temp.add_leaf('learning-and-montessori-games', 'other-learning-toys', 'ألعاب تعليمية أخرى', 'Other Learning Toys', 'yo-yos', 2990);

  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'tricycles', 'تروسيكل (دراجة ثلاثية)', 'Tricycles', 'yo-yos', 2000);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'push-cars', 'عربية دفع (بوش كار)', 'Push Cars', 'yo-yos', 2001);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'kids-electric-motorcycles', 'موتوسيكل كهربائي للأطفال', 'Kids'' Electric Motorcycles', 'yo-yos', 2002);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'hoverboards-and-kids-electric-scooters', 'هوفر بورد وسكوتر كهربائي للأطفال', 'Hoverboards & Kids'' Electric Scooters', 'yo-yos', 2003);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'race-tracks-and-garages', 'حلبات سباق وجراجات', 'Race Tracks & Garages', 'yo-yos', 2004);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'toy-trucks-and-construction-vehicles', 'شاحنات ومعدات بناء لعبة', 'Toy Trucks & Construction Vehicles', 'yo-yos', 2005);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'remote-control-planes-and-helicopters', 'طائرات وهليكوبتر بالريموت', 'Remote-Control Planes & Helicopters', 'yo-yos', 2006);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'remote-control-boats', 'مراكب بالريموت', 'Remote-Control Boats', 'yo-yos', 2007);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'balance-bikes', 'عجل توازن (بدون بدال)', 'Balance Bikes', 'yo-yos', 2008);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'kids-helmets-and-protective-pads', 'واقيات ركبة وخوذة للأطفال', 'Kids'' Helmets & Protective Pads', 'yo-yos', 2009);
  perform pg_temp.add_leaf('toy-remote-control-and-play-vehicles', 'other-toy-vehicles', 'ألعاب مركبات أخرى', 'Other Toy Vehicles', 'yo-yos', 2990);

  perform pg_temp.add_leaf('outdoor-play-and-tents', 'inflatable-kids-pools', 'حمامات سباحة نفخ للأطفال', 'Inflatable Kids'' Pools', 'yo-yos', 2000);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'ball-pits-and-play-balls', 'حوض وكور ملونة', 'Ball Pits & Play Balls', 'yo-yos', 2001);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'bouncy-castles-and-inflatables', 'نطاطات ومنفوخات', 'Bouncy Castles & Inflatables', 'yo-yos', 2002);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'sand-and-beach-toys', 'ألعاب رمل وشاطئ', 'Sand & Beach Toys', 'yo-yos', 2003);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'bubble-toys', 'ألعاب فقاعات الصابون', 'Bubble Toys', 'yo-yos', 2004);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'kids-sports-sets', 'ألعاب رياضية للأطفال (سلة وبولينج وكورة)', 'Kids'' Sports Sets', 'yo-yos', 2005);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'playhouses', 'بيت لعب للأطفال', 'Playhouses', 'yo-yos', 2006);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'jump-ropes-and-hula-hoops', 'حبل نط وهولا هوب', 'Jump Ropes & Hula Hoops', 'yo-yos', 2007);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'pool-floats-and-water-toys', 'عوامات وألعاب مياه', 'Pool Floats & Water Toys', 'yo-yos', 2008);
  perform pg_temp.add_leaf('outdoor-play-and-tents', 'other-outdoor-toys', 'ألعاب خارجية أخرى', 'Other Outdoor Toys', 'yo-yos', 2990);
end $$;

-- 2) product types sellers could not find
do $$ begin
  perform pg_temp.add_leaf('electrical-lighting-and-power-tools', 'household-batteries-aa-aaa-remote', 'بطاريات جافة وحجر ريموت (AA / AAA)', 'Household Batteries (AA, AAA, Remote)', 'mobile-phone-batteries', 2000);
  perform pg_temp.add_leaf('electrical-lighting-and-power-tools', 'rechargeable-batteries-and-chargers', 'بطاريات قابلة للشحن وشواحنها', 'Rechargeable Batteries & Chargers', 'mobile-phone-batteries', 2001);
  perform pg_temp.add_leaf('electrical-lighting-and-power-tools', 'coin-and-watch-batteries', 'بطاريات ساعات وكوين', 'Coin & Watch Batteries', 'mobile-phone-batteries', 2002);

  perform pg_temp.add_leaf('computer-components-and-accessories', 'wi-fi-range-extenders', 'مقوي إشارة الواي فاي (إكستندر)', 'Wi-Fi Range Extenders', 'wi-fi-routers', 2000);
  perform pg_temp.add_leaf('computer-components-and-accessories', '4g-and-5g-routers-and-mifi', 'راوتر هوائي ومودم 4G / 5G (ماي فاي)', '4G & 5G Routers and MiFi', 'wi-fi-routers', 2001);
  perform pg_temp.add_leaf('computer-components-and-accessories', 'access-points', 'أكسس بوينت', 'Access Points', 'wi-fi-routers', 2002);

  if not exists (
    select 1
      from public.categories c
      join public.categories p on p.id = c.parent_id
     where c.slug_en = 'charger-adapters'
       and c.deleted_at is null
       and p.slug_en = 'mobile-accessories'
       and p.deleted_at is null
  ) then
    perform pg_temp.add_leaf('mobile-accessories', 'charger-adapters-and-multi-port-chargers', 'شواحن متعددة ورأس شاحن', 'Charger Adapters & Multi-Port Chargers', 'mobile-chargers', 2000);
  end if;

  -- screens-and-tvs-and-receivers-and-projectors: nothing to add (remote
  -- controls already exist there).
end $$;

-- 3) shared "strap / shoulder style" fashion spec
do $shoulder$
declare
  v_attr uuid;
  v_men uuid[];
  v_women uuid[];
  v_kids uuid[];
begin
  insert into public.attribute_defs (
    category_id, code, type, unit, is_required, is_filterable,
    is_variant_axis, sort, label_ar, label_en, is_multi
  )
  select
    null, 'shoulder_style', 'enum', '', false, true, false,
    coalesce((
      select min(sort) from public.attribute_defs
       where code = 'sleeve_length' and deleted_at is null
    ), 0) + 1,
    'نوع الحمالة / الكتف', 'Strap / Shoulder Style', false
  where not exists (
    select 1 from public.attribute_defs where code = 'shoulder_style'
  );

  select id into v_attr
    from public.attribute_defs
   where code = 'shoulder_style'
     and category_id is null
     and deleted_at is null
   order by created_at
   limit 1;

  if v_attr is null then
    raise exception 'shoulder_style attribute not found after insert';
  end if;

  insert into public.attribute_options (
    attribute_id, code, label_ar, label_en, sort
  )
  select v_attr, v.code, v.label_ar, v.label_en, v.sort
    from (values
      ('with_sleeves', 'بأكمام', 'With sleeves', 0),
      ('sleeveless', 'كت (بدون أكمام)', 'Sleeveless', 1),
      ('two_straps', 'حمالتين', 'Two straps', 2),
      ('one_shoulder', 'حمالة واحدة (كتف واحد)', 'One strap / one shoulder', 3),
      ('strapless', 'بدون حمالات', 'Strapless', 4),
      ('off_shoulder', 'أوف شولدر (كتف مكشوف)', 'Off shoulder', 5),
      ('halter', 'هالتر (حمالة رقبة)', 'Halter neck', 6),
      ('salopette', 'سالوبيت', 'Salopette / dungarees', 7)
    ) as v(code, label_ar, label_en, sort)
   where not exists (
     select 1 from public.attribute_options o
      where o.attribute_id = v_attr and o.code = v.code
   )
  on conflict (attribute_id, code) do nothing;

  select array_agg(id order by array_position(
           array['with_sleeves', 'sleeveless', 'two_straps']::text[], code))
    into v_men
    from public.attribute_options
   where attribute_id = v_attr
     and code = any (array['with_sleeves', 'sleeveless', 'two_straps']::text[]);

  select array_agg(id order by array_position(
           array['with_sleeves', 'sleeveless', 'two_straps', 'one_shoulder',
                 'strapless', 'off_shoulder', 'halter']::text[], code))
    into v_women
    from public.attribute_options
   where attribute_id = v_attr
     and code = any (array['with_sleeves', 'sleeveless', 'two_straps',
                           'one_shoulder', 'strapless', 'off_shoulder',
                           'halter']::text[]);

  select array_agg(id order by array_position(
           array['with_sleeves', 'sleeveless', 'two_straps', 'one_shoulder',
                 'salopette']::text[], code))
    into v_kids
    from public.attribute_options
   where attribute_id = v_attr
     and code = any (array['with_sleeves', 'sleeveless', 'two_straps',
                           'one_shoulder', 'salopette']::text[]);

  if v_men is null or v_women is null or v_kids is null then
    raise exception 'shoulder_style options are incomplete';
  end if;

  with subs as (
    select id, slug_en
      from public.categories
     where slug_en in ('mens-fashion', 'womens-fashion', 'kids-and-baby-fashion')
       and deleted_at is null
  ),
  leaves as (
    select
      c.id,
      c.name_ar,
      case
        when exists (
          select 1 from subs s
           where s.slug_en = 'mens-fashion'
             and s.id::text = any (string_to_array(c.path, '/'))
        ) then 'men'
        when exists (
          select 1 from subs s
           where s.slug_en = 'womens-fashion'
             and s.id::text = any (string_to_array(c.path, '/'))
        ) then 'women'
        when exists (
          select 1 from subs s
           where s.slug_en = 'kids-and-baby-fashion'
             and s.id::text = any (string_to_array(c.path, '/'))
        ) then 'kids'
      end as branch
      from public.categories c
     where c.deleted_at is null
       and c.depth = 4
       and exists (
         select 1 from subs s
          where s.id::text = any (string_to_array(c.path, '/'))
       )
  ),
  core as (
    select distinct ca.category_id
      from public.category_attributes ca
      join public.attribute_defs d on d.id = ca.attribute_id
     where d.code in ('sleeve_length', 'neckline', 'dress_length')
       and d.deleted_at is null
  ),
  candidates as (
    select l.id, l.branch
      from leaves l
      left join core k on k.category_id = l.id
     where l.branch is not null
       and (
         k.category_id is not null
         or (
           l.branch = 'kids'
           and (
             l.name_ar like '%سالوبيت%'
             or l.name_ar like '%بادي%'
             or l.name_ar like '%طقم%'
             or l.name_ar like '%تانك%'
             or l.name_ar like '%فستان%'
           )
         )
         or (
           l.branch = 'women'
           and (
             l.name_ar like '%كاميسول%'
             or l.name_ar like '%ملابس نوم%'
             or l.name_ar like '%اللانجري%'
             or l.name_ar like '%البوركيني%'
           )
         )
       )
  )
  insert into public.category_attributes (
    category_id, attribute_id, sort, allowed_option_ids
  )
  select
    c.id,
    v_attr,
    coalesce((
      select max(x.sort) from public.category_attributes x
       where x.category_id = c.id
    ), 0) + 1,
    case c.branch
      when 'men' then v_men
      when 'women' then v_women
      else v_kids
    end
   from candidates c
  on conflict (category_id, attribute_id) do update
    set allowed_option_ids = excluded.allowed_option_ids;
end;
$shoulder$;

notify pgrst, 'reload schema';
