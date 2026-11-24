-- Duplicate product type in the same group: "واقي الشمس" (sunscreens) and
-- "واقي شمس" (sunscreen), both empty → one type with the fields of both.
do $$
declare v_keep uuid; v_drop uuid;
begin
  select id into v_keep from public.categories where slug_en = 'sunscreens' and deleted_at is null;
  select id into v_drop from public.categories where slug_en = 'sunscreen' and deleted_at is null;
  if v_keep is null or v_drop is null then return; end if;
  if exists (select 1 from public.products where leaf_category_id = v_drop) then raise exception 'sunscreen has products'; end if;
  insert into public.category_attributes (category_id, attribute_id, sort, allowed_option_ids, is_required)
  select v_keep, ca.attribute_id, ca.sort, ca.allowed_option_ids, false from public.category_attributes ca
   where ca.category_id = v_drop and not exists (select 1 from public.category_attributes x where x.category_id = v_keep and x.attribute_id = ca.attribute_id);
  insert into public.size_type_categories (size_type_id, category_id)
  select size_type_id, v_keep from public.size_type_categories where category_id = v_drop on conflict do nothing;
  update public.categories set is_active = false, deleted_at = now(), slug_en = slug_en || '-merged', slug_ar = slug_ar || '-مدمج' where id = v_drop;
end $$;
