-- Main choices are required per category (2026-11-07). The owner wants no product
-- listed without its choices. A spec's global is_required is too blunt (one spec serves
-- hundreds of categories), so a category link gets its own flag:
--   category_attributes.is_required — the seller must answer this spec in THIS category.
-- fn_submit_product refuses a product while a required spec of its category is empty.
-- Seeded: in every category, its first 3 choice specs in template order (not the
-- colour/size variant axes, made-in country, occasion, pattern or sizing system, which
-- stay optional). Re-runnable.

alter table public.category_attributes add column if not exists is_required boolean not null default false;

-- submit check: global flag OR the category link's flag
do $$
declare src text; n text;
begin
  src := pg_get_functiondef('public.fn_submit_product'::regproc);
  if position('ca_req.is_required' in src) > 0 then return; end if;
  n := replace(src, 'where ad.is_required and ad.deleted_at is null',
    'where (ad.is_required or exists (select 1 from public.category_attributes ca_req
              where ca_req.attribute_id = ad.id and ca_req.category_id = v_product.leaf_category_id and ca_req.is_required))
        and ad.deleted_at is null');
  if n = src then raise exception 'required check not found in fn_submit_product'; end if;
  execute n;
end $$;

-- seed: first 3 main choice specs of every category
update public.category_attributes ca set is_required = true
  from (
    select ca2.category_id, ca2.attribute_id,
           row_number() over (partition by ca2.category_id order by ca2.sort, d.code) rn
      from public.category_attributes ca2
      join public.attribute_defs d on d.id = ca2.attribute_id
     where d.type = 'enum' and d.deleted_at is null and not d.is_variant_axis
       and d.code not in ('country', 'made_in', 'occasion', 'pattern', 'sizing_system')
  ) pick
 where pick.category_id = ca.category_id and pick.attribute_id = ca.attribute_id and pick.rn <= 3
   and not exists (select 1 from public.category_attributes x where x.category_id = ca.category_id and x.is_required);
