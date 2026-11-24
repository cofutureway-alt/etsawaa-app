-- 1) Duplicate product types in electronics: merge each into its twin (no
--    product sits in the removed ones; anything that did is moved).
-- 2) Phones, tablets, computers and storage devices: storage (and RAM + storage)
--    become variant options like sizes, so each capacity has its own price/stock.

-- ── 1. merge duplicates ─────────────────────────────────────────────
create or replace function pg_temp.merge_category(p_from uuid, p_to uuid) returns void language plpgsql as $$
begin
  if not exists (select 1 from public.categories where id = p_from and deleted_at is null)
     or not exists (select 1 from public.categories where id = p_to and deleted_at is null) then
    return;
  end if;
  update public.products set leaf_category_id = p_to where leaf_category_id = p_from;
  insert into public.brand_categories (brand_id, category_id)
    select brand_id, p_to from public.brand_categories where category_id = p_from
  on conflict do nothing;
  update public.vendors set category_ids = (select array_agg(distinct x) from unnest(array_replace(category_ids, p_from, p_to)) x)
   where p_from = any(category_ids);
  update public.categories set deleted_at = now(), is_active = false where id = p_from;
end $$;

select pg_temp.merge_category('4c15580e-60d7-4d4a-b535-1842efa20760', 'd050f77f-61c8-48eb-92b5-cfbe70e77462'); -- هواتف ذكية → الموبايل
select pg_temp.merge_category('ce342e2e-80ec-4e3b-87cf-82261242944a', '8beac8af-b9f2-43ce-9ad3-affe9f6123b0'); -- التابلت → أجهزة تابلت وآيباد
select pg_temp.merge_category('9cc7735d-65f5-4539-9194-147bcad44f3d', '7efc4328-dbeb-4503-984a-40b8306030a1'); -- جرابات → جراب الموبايل
select pg_temp.merge_category('25826c0a-230f-4eb0-86e9-98bc9c420459', '7f36bb03-d691-4fc6-be4b-39743caed316'); -- واقي الشاشة → واقي شاشة الموبايل
select pg_temp.merge_category('e510c54c-e864-47af-803f-e9bc5e149ce9', '1a9600e2-6750-4f60-a8de-c0fef3f11cd3'); -- كمبيوتر مكتبي (PC) → الكمبيوتر المكتبي
select pg_temp.merge_category('e5bf0338-1fb5-43d5-85fc-04f2c3042152', '0426af85-ca7a-45c1-9c1b-d3d155218085'); -- شاشات → شاشة الكمبيوتر
select pg_temp.merge_category('9ae2b306-70cf-4158-9598-2690425448ab', 'eb7f62be-7e71-4b90-b28f-beb28da7ddac'); -- حوامل لابتوب → حامل اللابتوب

-- ── 2. storage size types ───────────────────────────────────────────
insert into public.size_types (code, name_ar, name_en, sort) values
  ('storage', 'المساحة', 'Storage', 20),
  ('ram_storage', 'الرام + المساحة', 'RAM + storage', 21)
on conflict (code) do nothing;

insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, o.code, o.label_ar, o.label_en, 300 + o.ord, st.id
  from (values
  ('st_8gb', '8 جيجا', '8 GB', 0), ('st_16gb', '16 جيجا', '16 GB', 1), ('st_32gb', '32 جيجا', '32 GB', 2),
  ('st_64gb', '64 جيجا', '64 GB', 3), ('st_128gb', '128 جيجا', '128 GB', 4), ('st_256gb', '256 جيجا', '256 GB', 5),
  ('st_512gb', '512 جيجا', '512 GB', 6), ('st_1tb', '1 تيرا', '1 TB', 7), ('st_2tb', '2 تيرا', '2 TB', 8), ('st_4tb', '4 تيرا', '4 TB', 9)
  ) o(code, label_ar, label_en, ord)
  cross join public.attribute_defs d cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'storage'
on conflict (attribute_id, code) do nothing;

insert into public.attribute_options (attribute_id, code, label_ar, label_en, sort, size_type_id)
select d.id, o.code, o.label_ar, o.label_en, 400 + o.ord, st.id
  from (values
  ('rs_2_32', '2 جيجا رام / 32 جيجا', '2 GB RAM / 32 GB', 0), ('rs_3_32', '3 جيجا رام / 32 جيجا', '3 GB RAM / 32 GB', 1),
  ('rs_3_64', '3 جيجا رام / 64 جيجا', '3 GB RAM / 64 GB', 2), ('rs_4_64', '4 جيجا رام / 64 جيجا', '4 GB RAM / 64 GB', 3),
  ('rs_4_128', '4 جيجا رام / 128 جيجا', '4 GB RAM / 128 GB', 4), ('rs_6_128', '6 جيجا رام / 128 جيجا', '6 GB RAM / 128 GB', 5),
  ('rs_8_128', '8 جيجا رام / 128 جيجا', '8 GB RAM / 128 GB', 6), ('rs_8_256', '8 جيجا رام / 256 جيجا', '8 GB RAM / 256 GB', 7),
  ('rs_8_512', '8 جيجا رام / 512 جيجا', '8 GB RAM / 512 GB', 8), ('rs_12_256', '12 جيجا رام / 256 جيجا', '12 GB RAM / 256 GB', 9),
  ('rs_12_512', '12 جيجا رام / 512 جيجا', '12 GB RAM / 512 GB', 10), ('rs_16_256', '16 جيجا رام / 256 جيجا', '16 GB RAM / 256 GB', 11),
  ('rs_16_512', '16 جيجا رام / 512 جيجا', '16 GB RAM / 512 GB', 12), ('rs_16_1tb', '16 جيجا رام / 1 تيرا', '16 GB RAM / 1 TB', 13),
  ('rs_32_1tb', '32 جيجا رام / 1 تيرا', '32 GB RAM / 1 TB', 14)
  ) o(code, label_ar, label_en, ord)
  cross join public.attribute_defs d cross join public.size_types st
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null and st.code = 'ram_storage'
on conflict (attribute_id, code) do nothing;

-- which product types offer them
create temp table storage_leaves (id uuid, types text[]) ;
insert into storage_leaves values
  -- phones and tablets
  ('d050f77f-61c8-48eb-92b5-cfbe70e77462', array['storage','ram_storage']),
  ('369ac3dc-710b-413c-a4d0-fbca7daec526', array['storage','ram_storage']),
  ('f1ca2dbd-cb3d-48d1-af8b-f286f3963bb5', array['storage','ram_storage']),
  ('3c9d0b53-88e3-4a09-8fa4-5cd49dbe90d2', array['storage','ram_storage']),
  ('8beac8af-b9f2-43ce-9ad3-affe9f6123b0', array['storage','ram_storage']),
  ('d3f6c0c1-ff6d-478a-95a5-234141555649', array['storage']),
  -- laptops and computers
  ('c22371bf-ef93-41f1-bfdd-a5670a33b666', array['ram_storage','storage']),
  ('9ea7a178-33de-4336-8e0e-db3af572ac03', array['ram_storage','storage']),
  ('4633e331-39d8-45c8-9944-9a225ea1ec83', array['ram_storage','storage']),
  ('f4728ebc-6caf-4f1a-a03d-c699e92ee946', array['ram_storage','storage']),
  ('17b27955-18dc-4502-bb7f-15f73a3df1c9', array['ram_storage','storage']),
  ('1a9600e2-6750-4f60-a8de-c0fef3f11cd3', array['ram_storage','storage']),
  ('029c7817-7f7c-4126-a489-86f251265832', array['ram_storage','storage']),
  -- storage devices
  ('4bb3a70b-6d85-4d1e-bccc-742c38431a7e', array['storage']),
  ('832e5d27-2e5e-44e8-934e-1bb86342c402', array['storage']),
  ('d43ae937-8115-4d57-ac5f-fe2cc3795687', array['storage']),
  ('31c06d61-0dfc-4e08-bdb7-22b75f9fc508', array['storage']),
  ('094d0b61-814c-4936-929d-b032a379e038', array['storage']),
  ('7378edbd-fbdb-457b-82e1-099dc64e0170', array['storage']),
  ('30de8331-d698-457c-974b-6d2ed5a92570', array['storage']),
  ('497a6283-4973-4d33-b361-a287f22fc672', array['storage']);

-- link the size axis (the variant picker shows it as "Storage")
insert into public.category_attributes (category_id, attribute_id, sort)
select l.id, d.id, coalesce((select max(sort) from public.category_attributes y where y.category_id = l.id), 0) + 2
  from storage_leaves l join public.categories c on c.id = l.id and c.deleted_at is null
  cross join public.attribute_defs d
 where d.code = 'size' and d.is_variant_axis and d.category_id is null and d.deleted_at is null
on conflict do nothing;

insert into public.size_type_categories (size_type_id, category_id)
select st.id, l.id from storage_leaves l join public.size_types st on st.code = any(l.types)
on conflict do nothing;

-- the old one-value storage / RAM specs stay (filters), but never as required:
-- the capacity now comes from the variant
update public.category_attributes ca set is_required = false
  from public.attribute_defs d, storage_leaves l
 where d.id = ca.attribute_id and ca.category_id = l.id
   and d.code in ('storage', 'ram', 'ram_capacity', 'internal_storage_capacity', 'storage_capacity', 'total_storage_capacity');
