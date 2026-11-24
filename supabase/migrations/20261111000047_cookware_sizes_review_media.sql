-- 1. Cookware sizes: pots, pans, woks and trays are sold by diameter (cm);
--    pressure cookers and kettles by capacity (L). New size types "cookware"
--    (diameter) and "capacity" (litres), options of the shared `size` axis.
-- 2. A product with a single offer may carry a colour / size: the card still
--    adds that one variant to the cart directly (single_variant_id no longer
--    requires "no options").
-- 3. Reviews may carry photos / videos (up to 5, at most 2 videos), uploaded by
--    the buyer under their own storage folder; shown once the review is published.

-- ── 1. cookware sizes
insert into public.size_types (code, name_ar, name_en, sort)
values ('cookware', 'قطر الحلة / المقلاة', 'Cookware diameter', 12)
on conflict (code) do nothing;

insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, 'dia_' || o.cm || 'cm', o.cm || ' سم', o.cm || ' cm', 300 + o.ord, st.id
  from (values (12,0),(14,1),(16,2),(18,3),(20,4),(22,5),(24,6),(26,7),(28,8),(30,9),(32,10),(34,11),(36,12),(38,13),(40,14),(45,15),(50,16),(55,17),(60,18)) o(cm, ord)
  cross join public.attribute_defs d
  cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'cookware'
on conflict (attribute_id, code) do nothing;

insert into public.size_types (code, name_ar, name_en, sort)
values ('capacity', 'سعة الحلة / البراد', 'Cookware capacity', 13)
on conflict (code) do nothing;

insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, 'cap_' || replace(o.l, '.', '_') || 'l', o.l || ' لتر', o.l || ' L', 400 + o.ord, st.id
  from (values ('0.5',0),('0.75',1),('1',2),('1.5',3),('2',4),('2.5',5),('3',6),('4',7),('5',8),('6',9),('7',10),('8',11),('9',12),('10',13),('12',14),('15',15),('20',16),('25',17),('30',18)) o(l, ord)
  cross join public.attribute_defs d
  cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'capacity'
on conflict (attribute_id, code) do nothing;

-- link the size axis + the size types to the cookware product types
do $$
declare
  v_size uuid := (select id from public.attribute_defs where code = 'size' and is_variant_axis and category_id is null and deleted_at is null);
  r record;
begin
  for r in
    select c.id, l.types
      from (values
        ('cooking-pots', array['cookware', 'capacity']),
        ('sauce-pans', array['cookware']),
        ('frying-pans', array['cookware']),
        ('woks', array['cookware']),
        ('baking-sheets', array['cookware']),
        ('baking-and-roasting-trays', array['cookware']),
        ('stovetop-pressure-cookers', array['capacity']),
        ('stovetop-tea-kettles', array['capacity'])
      ) l(slug, types)
      join public.categories c on c.slug_en = l.slug and c.deleted_at is null
  loop
    insert into public.category_attributes (category_id, attribute_id, sort, is_required)
    values (r.id, v_size, coalesce((select max(sort) + 1 from public.category_attributes where category_id = r.id), 1), false)
    on conflict (category_id, attribute_id) do nothing;
    insert into public.size_type_categories (size_type_id, category_id)
    select st.id, r.id from public.size_types st where st.code = any (r.types)
    on conflict do nothing;
  end loop;
end $$;

-- ── 2. single offer with options still adds to cart from the card
do $$
declare v_def text := pg_get_viewdef('public.v_storefront_products'::regclass, true);
begin
  if position('COALESCE(cardinality(sv.option_ids), 0) = 0' in v_def) > 0 then
    v_def := replace(v_def, 'AND COALESCE(cardinality(sv.option_ids), 0) = 0', '');
    execute 'create or replace view public.v_storefront_products as ' || v_def;
  end if;
end $$;

-- ── 3. review photos / videos
alter table public.reviews add column if not exists media jsonb not null default '[]'::jsonb;


create or replace view public.v_storefront_reviews as
 SELECT rw.id,
    rw.product_id,
    rw.vendor_id,
    rw.rating,
    rw.title,
    rw.body,
    rw.created_at,
    pr.full_name AS author_name,
    rw.media
   FROM reviews rw
     JOIN profiles pr ON pr.id = rw.customer_id
  WHERE rw.status = 'published'::text;
grant select on public.v_storefront_reviews to anon, authenticated;

-- a buyer's media list: only files under their own upload folder, images or
-- the three video formats, max 5 items / 2 videos
create or replace function public.fn_review_media_ok(p_media jsonb, p_uid uuid) returns boolean
language sql immutable as $$
  select jsonb_typeof(coalesce(p_media, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p_media, '[]'::jsonb)) <= 5
     and (select count(*) from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) e where e->>'kind' = 'video') <= 2
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) e
        where coalesce(e->>'kind', '') not in ('image', 'video')
           or coalesce(e->>'path', '') not like 'u/' || p_uid::text || '/%'
           or (e->>'path') ~ '\.\.')
$$;

drop function if exists public.fn_submit_review(uuid, numeric, text, text);
create or replace function public.fn_submit_review(p_order_item_id uuid, p_rating numeric, p_title text, p_body text, p_media jsonb default '[]'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_oi order_items%rowtype;
  v_rating numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  select * into v_oi from public.order_items where id = p_order_item_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not exists (select 1 from public.orders o
                 where o.id = v_oi.order_id and o.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from public.orders o
                 where o.id = v_oi.order_id and o.delivered_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;
  if exists (select 1 from public.reviews rw where rw.order_item_id = p_order_item_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;
  if p_rating is null or p_rating < 0.5 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_rating');
  end if;
  if not public.fn_review_media_ok(p_media, v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'bad_media');
  end if;
  v_rating := round(p_rating * 2) / 2;
  insert into public.reviews (product_id, vendor_id, customer_id, order_item_id,
      rating, title, body, status, media)
  values (v_oi.product_id, v_oi.vendor_id, v_uid, p_order_item_id, v_rating,
      left(coalesce(p_title, ''), 200), left(coalesce(p_body, ''), 2000), 'pending',
      coalesce(p_media, '[]'::jsonb));
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.fn_submit_review(uuid, numeric, text, text, jsonb) from public, anon;
grant execute on function public.fn_submit_review(uuid, numeric, text, text, jsonb) to authenticated;

-- the buyer edits a pending/published review (rating, text, media): media stays theirs
alter table public.reviews drop constraint if exists reviews_media_owned;
alter table public.reviews add constraint reviews_media_owned check (public.fn_review_media_ok(media, customer_id)) not valid;

notify pgrst, 'reload schema';
