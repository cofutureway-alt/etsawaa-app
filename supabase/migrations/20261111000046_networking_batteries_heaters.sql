-- Product types in the places a seller looks for them:
--  1. Routers & networking: one clear group under Electronics › Computing & Gaming
--     ("الشبكات والإنترنت") instead of being split between "computer components"
--     and "printers & accessories". The second router type (under printers)
--     becomes the landline ADSL/VDSL router.
--  2. Batteries: their own sub-category under Electronics ("البطاريات والشواحن")
--     instead of Home › Electrical & lighting; battery brands linked to it.
--  3. Water heaters: gas and solar heaters next to instant / storage heaters.
-- None of the moved types holds a product yet (checked 2026-11-11).

create or replace function pg_temp.slug_ar(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(btrim(p), '[()/،,]+', ' ', 'g'), '\s+', '-', 'g'), '-')
$$;

-- a browse node (depth 2 or 3) with the commission of a reference node
create or replace function pg_temp.add_node(p_parent text, p_slug text, p_ar text, p_en text, p_icon text, p_commission_from text)
returns uuid language plpgsql as $$
declare v_parent public.categories%rowtype; v_id uuid;
begin
  select id into v_id from public.categories where slug_en = p_slug and deleted_at is null;
  if v_id is not null then return v_id; end if;
  select * into v_parent from public.categories where slug_en = p_parent and deleted_at is null;
  if v_parent.id is null then raise exception 'parent % missing', p_parent; end if;
  insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, sort, icon, source_key)
  values (v_parent.id, pg_temp.slug_ar(p_ar), p_slug, p_ar, p_en,
          coalesce((select max(sort) + 1 from public.categories where parent_id = v_parent.id), 1), p_icon,
          case when v_parent.source_key is null then null else v_parent.source_key || '/' || p_slug end)
  returning id into v_id;
  insert into public.category_commissions (category_id, percent)
  select v_id, cc.percent from public.category_commissions cc join public.categories c on c.id = cc.category_id
   where c.slug_en = p_commission_from and c.deleted_at is null
  on conflict do nothing;
  return v_id;
end $$;

-- move a product type under another group (the path trigger repaths it)
create or replace function pg_temp.move_leaf(p_slug text, p_group uuid, p_sort int) returns void language plpgsql as $$
begin
  update public.categories set parent_id = p_group, sort = p_sort
   where slug_en = p_slug and deleted_at is null and parent_id is distinct from p_group;
end $$;

create or replace function pg_temp.add_leaf(p_group uuid, p_slug text, p_ar text, p_en text, p_template text, p_sort int)
returns void language plpgsql as $$
declare v_tpl public.categories%rowtype; v_id uuid;
begin
  if exists (select 1 from public.categories where slug_en = p_slug and deleted_at is null) then return; end if;
  select * into v_tpl from public.categories where slug_en = p_template and deleted_at is null;
  if v_tpl.id is null then raise exception 'template % missing', p_template; end if;
  insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, sort, icon)
  values (p_group, pg_temp.slug_ar(p_ar), p_slug, p_ar, p_en, p_sort, v_tpl.icon) returning id into v_id;
  insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
  select v_id, attribute_id, sort, allowed_option_ids, is_required from public.category_attributes where category_id = v_tpl.id;
  insert into public.size_type_categories (size_type_id, category_id)
  select size_type_id, v_id from public.size_type_categories where category_id = v_tpl.id;
end $$;

do $$
declare v_net uuid; v_bsub uuid; v_bat uuid; v_heat uuid;
begin
  -- 1. networking
  v_net := pg_temp.add_node('computing-and-gaming', 'networking-and-internet', 'الشبكات والإنترنت (راوتر وواي فاي)', 'Networking & Internet (Routers & Wi-Fi)', 'monitor', 'computer-components-and-accessories');
  update public.categories set name_ar = 'راوتر واي فاي', name_en = 'Wi-Fi Routers' where slug_en = 'wi-fi-routers' and deleted_at is null;
  -- the duplicate router type becomes the landline (ADSL / VDSL) router, with the router form
  update public.categories set name_ar = 'راوتر أرضي ADSL / VDSL', name_en = 'ADSL / VDSL Landline Routers',
         slug_ar = pg_temp.slug_ar('راوتر أرضي ADSL VDSL')
   where slug_en = 'routers-and-cables' and deleted_at is null;
  delete from public.category_attributes where category_id = (select id from public.categories where slug_en = 'routers-and-cables' and deleted_at is null);
  insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
  select (select id from public.categories where slug_en = 'routers-and-cables' and deleted_at is null), attribute_id, sort, allowed_option_ids, is_required
    from public.category_attributes where category_id = (select id from public.categories where slug_en = 'wi-fi-routers' and deleted_at is null);
  perform pg_temp.move_leaf('wi-fi-routers', v_net, 1);
  perform pg_temp.move_leaf('routers-and-cables', v_net, 2);
  perform pg_temp.move_leaf('4g-and-5g-routers-and-mifi', v_net, 3);
  perform pg_temp.move_leaf('wi-fi-range-extenders', v_net, 4);
  perform pg_temp.move_leaf('access-points', v_net, 5);
  perform pg_temp.move_leaf('network-switches', v_net, 6);
  perform pg_temp.move_leaf('network-cables', v_net, 7);

  -- 2. batteries
  v_bsub := pg_temp.add_node('electronics-and-mobiles', 'batteries-and-chargers', 'البطاريات والشواحن', 'Batteries & Chargers', 'plug', 'computing-and-gaming');
  v_bat := pg_temp.add_node('batteries-and-chargers', 'batteries', 'بطاريات', 'Batteries', 'plug', 'electrical-lighting-and-power-tools');
  perform pg_temp.move_leaf('household-batteries-aa-aaa-remote', v_bat, 1);
  perform pg_temp.move_leaf('rechargeable-batteries-and-chargers', v_bat, 2);
  perform pg_temp.move_leaf('coin-and-watch-batteries', v_bat, 3);
  insert into public.brand_categories (brand_id, category_id)
  select b.id, v_bsub from public.brands b
   where b.deleted_at is null and b.name_en in ('Duracell', 'Energizer', 'Varta', 'GP Batteries', 'Camelion', 'Panasonic', 'Sony', 'Philips', 'Xiaomi', 'Anker')
  on conflict do nothing;

  -- 3. water heaters
  select id into v_heat from public.categories where slug_en = 'water-heaters' and depth = 3 and deleted_at is null;
  perform pg_temp.add_leaf(v_heat, 'gas-water-heaters', 'سخان غاز', 'Gas Water Heaters',
    (select slug_en from public.categories where parent_id = v_heat and name_ar = 'سخان فوري' and deleted_at is null), 10);
  perform pg_temp.add_leaf(v_heat, 'solar-water-heaters', 'سخان شمسي', 'Solar Water Heaters',
    (select slug_en from public.categories where parent_id = v_heat and name_ar = 'سخان تخزين' and deleted_at is null), 11);
end $$;

notify pgrst, 'reload schema';
