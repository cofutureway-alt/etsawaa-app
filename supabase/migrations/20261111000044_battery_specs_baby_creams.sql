-- 1. The three household battery types (added in 042) copied the phone-battery
--    form, so sellers saw "compatible phone models", dimensions and weight.
--    They get a battery form of their own: size (AA/AAA/9V/coin…), type
--    (alkaline / lithium / rechargeable NiMH…), voltage, pieces per pack,
--    capacity, warranty, country of origin.
-- 2. Baby creams had no product type (sellers fell back to "baby lotion").

do $$
declare
  v_leaf uuid;
  v_codes text[] := array['battery_size', 'battery_type', 'voltage', 'pieces_per_pack', 'battery_capacity', 'warranty_period', 'country'];
  v_i int;
begin
  for v_leaf in
    select id from public.categories
     where slug_en in ('household-batteries-aa-aaa-remote', 'rechargeable-batteries-and-chargers', 'coin-and-watch-batteries')
       and deleted_at is null
  loop
    -- only attributes no product has a value for (these types are new)
    delete from public.category_attributes ca
     where ca.category_id = v_leaf
       and not exists (select 1 from public.product_attribute_values pav
                         join public.products p on p.id = pav.product_id
                        where p.leaf_category_id = v_leaf and pav.attribute_id = ca.attribute_id);
    for v_i in 1 .. array_length(v_codes, 1) loop
      insert into public.category_attributes (category_id, attribute_id, sort, is_required)
      select v_leaf, d.id, v_i, d.code = 'battery_size'
        from public.attribute_defs d
       where d.code = v_codes[v_i] and d.category_id is null and d.deleted_at is null
      on conflict (category_id, attribute_id) do update set sort = excluded.sort, is_required = excluded.is_required;
    end loop;
  end loop;
end $$;

-- baby creams, same form as baby lotion (skin type, fragrance, age group, pack volume)
create or replace function pg_temp.add_leaf_like(p_parent text, p_slug text, p_name_ar text, p_name_en text, p_template text, p_sort int)
returns void language plpgsql as $$
declare v_parent public.categories%rowtype; v_tpl public.categories%rowtype; v_id uuid;
begin
  if exists (select 1 from public.categories where slug_en = p_slug and deleted_at is null) then return; end if;
  select * into v_parent from public.categories where slug_en = p_parent and deleted_at is null;
  select * into v_tpl from public.categories where slug_en = p_template and deleted_at is null;
  if v_parent.id is null or v_tpl.id is null then raise exception 'missing parent/template %/%', p_parent, p_template; end if;
  insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, sort, icon, source_key)
  values (v_parent.id, btrim(regexp_replace(regexp_replace(p_name_ar, '[()/،,]+', ' ', 'g'), '\s+', '-', 'g'), '-'), p_slug, p_name_ar, p_name_en, p_sort, v_tpl.icon,
          case when v_parent.source_key is null then null else v_parent.source_key || '/' || p_slug end)
  returning id into v_id;
  insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
  select v_id, attribute_id, sort, allowed_option_ids, is_required from public.category_attributes where category_id = v_tpl.id;
  insert into public.size_type_categories (size_type_id, category_id)
  select size_type_id, v_id from public.size_type_categories where category_id = v_tpl.id;
end $$;

select pg_temp.add_leaf_like('baby-care-essentials', 'baby-creams', 'كريم الأطفال', 'Baby Creams', 'baby-lotions', 2000);
select pg_temp.add_leaf_like('baby-care-essentials', 'diaper-rash-creams', 'كريم الحفاض (التسلخات)', 'Diaper Rash Creams', 'baby-lotions', 2001);

notify pgrst, 'reload schema';
