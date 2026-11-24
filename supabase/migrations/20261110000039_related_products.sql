-- "Similar products" must always have something to show. Ranking by category
-- closeness: same leaf → same parent → same sub-category → same main category
-- → everything else, using the common prefix of categories.path.
create or replace function public.fn_related_products(p_product uuid, p_limit int default 16)
returns setof public.v_storefront_products
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select p.id, p.brand_id, coalesce(c.path, '') as path
      from public.products p
      left join public.categories c on c.id = p.leaf_category_id
     where p.id = p_product
  )
  select v.*
    from public.v_storefront_products v
    left join public.categories c on c.id = v.leaf_category_id
    cross join src
   where v.is_listable
     and v.min_price_piastres is not null
     and v.id <> src.id
   order by
     case
       when src.path = '' or coalesce(c.path, '') = '' then 4
       when c.path = src.path then 0
       when split_part(c.path, '/', 1) = split_part(src.path, '/', 1)
        and split_part(c.path, '/', 2) = split_part(src.path, '/', 2)
        and split_part(c.path, '/', 3) = split_part(src.path, '/', 3) then 1
       when split_part(c.path, '/', 1) = split_part(src.path, '/', 1)
        and split_part(c.path, '/', 2) = split_part(src.path, '/', 2) then 2
       when split_part(c.path, '/', 1) = split_part(src.path, '/', 1) then 3
       else 4
     end,
     case when v.brand_id is not null and v.brand_id = src.brand_id then 0 else 1 end,
     v.rating_count desc,
     v.published_at desc nulls last
   limit least(coalesce(p_limit, 16), 40);
$$;
revoke all on function public.fn_related_products(uuid, int) from public;
grant execute on function public.fn_related_products(uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
