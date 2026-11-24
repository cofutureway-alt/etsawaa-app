-- Vendor → Categories & commissions: the rate this store pays in every
-- subcategory (overrides, fixed mode, level reductions all applied).
create or replace function public.fn_vendor_category_rates()
returns table (category_id uuid, percent numeric)
language sql stable security definer set search_path to 'public' as $$
  select c.id, public.fn_vendor_line_commission(v.id, c.id)
    from public.vendors v
    cross join public.categories c
   where v.owner_id = auth.uid()
     and c.depth in (2, 3) and c.is_active and c.deleted_at is null;
$$;
revoke all on function public.fn_vendor_category_rates() from public;
grant execute on function public.fn_vendor_category_rates() to authenticated;
