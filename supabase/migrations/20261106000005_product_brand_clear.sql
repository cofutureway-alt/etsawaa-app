-- fn_save_product: a seller can clear a product's brand, and the
-- brand ↔ category rule checks the EFFECTIVE values (2026-11-06).
--
-- Before: brand_id = coalesce(new, old) — sending "" (no brand) kept the old
-- brand, so a brand could never be removed. With the new category-filtered
-- picker this also broke saving: changing the category cleared the brand in
-- the form, the old brand stayed, and the save failed brand_not_in_category.
-- Now: key present → that value ("" = no brand); key absent → unchanged.
-- The category rule uses (new or existing brand) × (new or existing category).

do $$
declare src text; n text; a text; b text;
begin
  src := pg_get_functiondef('public.fn_save_product'::regproc);

  a := $x$brand_id = coalesce(nullif(p_product ->> 'brand_id', '')::uuid, v_product.brand_id),$x$;
  b := $x$brand_id = case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end,$x$;
  n := replace(src, a, b);
  if n = src then raise exception 'brand assignment anchor not found'; end if;
  src := n;

  a := $x$  if coalesce(p_product ->> 'brand_id', '') <> '' and v_cat is not null
     and exists (select 1 from public.brand_categories x where x.brand_id = (p_product ->> 'brand_id')::uuid)
     and not exists (
       select 1 from public.brand_categories x
         join public.categories c on c.id = v_cat
        where x.brand_id = (p_product ->> 'brand_id')::uuid
          and (c.id = x.category_id or c.path like '%' || x.category_id::text || '%')) then$x$;
  b := $x$  if (case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end) is not null
     and coalesce(v_cat, v_product.leaf_category_id) is not null
     and exists (select 1 from public.brand_categories x
                  where x.brand_id = (case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end))
     and not exists (
       select 1 from public.brand_categories x
         join public.categories c on c.id = coalesce(v_cat, v_product.leaf_category_id)
        where x.brand_id = (case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end)
          and (c.id = x.category_id or c.path like '%' || x.category_id::text || '%')) then$x$;
  n := replace(src, a, b);
  if n = src then raise exception 'category rule anchor not found'; end if;

  execute n;
end $$;
