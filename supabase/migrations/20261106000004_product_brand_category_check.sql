-- Product brand must belong to the product's category (2026-11-06).
-- The seller wizard only offers brands linked (brand_categories) to the
-- chosen category or one of its ancestors; fn_save_product now enforces the
-- same rule so a hand-made request cannot attach an unrelated brand.
-- Brands with no category links at all stay usable everywhere.
-- Patched in place from the live definition.

do $$
declare src text; n text;
begin
  src := pg_get_functiondef('public.fn_save_product'::regproc);
  n := replace(src,
    $a$raise exception 'brand not found';$a$,
    $b$raise exception 'brand not found';
  end if;
  if coalesce(p_product ->> 'brand_id', '') <> '' and v_cat is not null
     and exists (select 1 from public.brand_categories x where x.brand_id = (p_product ->> 'brand_id')::uuid)
     and not exists (
       select 1 from public.brand_categories x
         join public.categories c on c.id = v_cat
        where x.brand_id = (p_product ->> 'brand_id')::uuid
          and (c.id = x.category_id or c.path like '%' || x.category_id::text || '%')) then
    raise exception 'brand_not_in_category';$b$);
  if n = src then raise exception 'anchor not found'; end if;
  execute n;
end $$;
