-- Brands: extra details + category links (brand catalogue import, 2026-11-06).
--
-- * brands.country_ar / country_en / founded_year — shown on the admin form,
--   the storefront brand page and the brands directory.
-- * brand_categories — which categories a brand sells in (main or sub
--   level). Drives the category filter on /brands + the admin list, the
--   "sells in" chips on the brand page and the brand suggestions in the
--   seller product wizard.
-- * v_storefront_brands gains the new columns plus category_ids (linked
--   categories) and root_category_ids (their main categories) for filtering.

alter table public.brands
  add column if not exists country_ar text not null default '',
  add column if not exists country_en text not null default '',
  add column if not exists founded_year integer;

do $$ begin
  alter table public.brands add constraint brands_founded_year_check
    check (founded_year is null or founded_year between 1500 and 2100);
exception when duplicate_object then null; end $$;

create table if not exists public.brand_categories (
  brand_id    uuid not null references public.brands(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (brand_id, category_id)
);
create index if not exists brand_categories_category on public.brand_categories (category_id);

alter table public.brand_categories enable row level security;

drop policy if exists brand_categories_read on public.brand_categories;
create policy brand_categories_read on public.brand_categories
  for select to anon, authenticated using (true);

drop policy if exists brand_categories_write on public.brand_categories;
create policy brand_categories_write on public.brand_categories
  for all to authenticated
  using (public.has_permission('catalog.manage'))
  with check (public.has_permission('catalog.manage'));

grant select on public.brand_categories to anon, authenticated;
grant insert, update, delete on public.brand_categories to authenticated;


create or replace view public.v_storefront_brands as
  select b.id,
         b.slug_ar,
         b.slug_en,
         b.name_ar,
         b.name_en,
         b.thumb_path,
         b.sort,
         coalesce(pc.product_count, 0) as product_count,
         b.description_ar,
         b.description_en,
         b.country_ar,
         b.country_en,
         b.founded_year,
         coalesce(bc.category_ids, '{}'::uuid[]) as category_ids,
         coalesce(bc.root_category_ids, '{}'::uuid[]) as root_category_ids
    from public.brands b
    left join lateral (
      select count(*)::integer as product_count
        from public.products p
       where p.brand_id = b.id and p.status = 'approved' and p.deleted_at is null
    ) pc on true
    left join lateral (
      select array_agg(distinct c.id) as category_ids,
             array_agg(distinct split_part(c.path, '/', 1)::uuid) as root_category_ids
        from public.brand_categories x
        join public.categories c on c.id = x.category_id and c.deleted_at is null and c.is_active
       where x.brand_id = b.id
    ) bc on true
   where b.is_active and b.deleted_at is null;

grant select on public.v_storefront_brands to anon, authenticated;
