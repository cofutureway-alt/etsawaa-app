-- Seller ("vendor") shipping is now OPT-IN per category: it is offered only in
-- the categories listed in settings.shipping_rules.vendor_allowed_category_ids
-- (air conditioners, water filters, …) and every other category ships with the
-- platform. Replaces the earlier block-list (vendor_blocked_category_ids), whose
-- ids carry over as the starting allow-list. A listed category covers all of its
-- sub-categories (matched through categories.path).

update public.settings
   set value = jsonb_build_object('vendor_allowed_category_ids',
         coalesce(value -> 'vendor_allowed_category_ids', value -> 'vendor_blocked_category_ids', '[]'::jsonb))
 where key = 'shipping_rules';

insert into public.settings (key, value)
values ('shipping_rules', jsonb_build_object('vendor_allowed_category_ids', coalesce((
  select jsonb_agg(id) from public.categories
   where deleted_at is null and slug_en in ('air-conditioners', 'water-coolers-and-filters')), '[]'::jsonb)))
on conflict (key) do nothing;

-- name kept (callers: product wizard, fn_save_product): true = seller shipping NOT allowed
create or replace function public.fn_vendor_shipping_blocked(p_category uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce(exists (
    select 1 from public.categories c,
           jsonb_array_elements_text(coalesce((select value -> 'vendor_allowed_category_ids' from public.settings where key = 'shipping_rules'), '[]'::jsonb)) a(id)
     where c.id = p_category and (c.id::text = a.id or c.path like '%' || a.id || '%')), false);
$$;
grant execute on function public.fn_vendor_shipping_blocked(uuid) to authenticated;

-- existing products outside the allowed categories go back to platform shipping
update public.products p
   set shipping_mode = 'platform'
 where p.shipping_mode = 'vendor' and public.fn_vendor_shipping_blocked(p.leaf_category_id);
