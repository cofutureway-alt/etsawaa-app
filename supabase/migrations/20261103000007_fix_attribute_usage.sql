-- ============================================================================
-- Fix 07 — report what actually uses an attribute / option before deletion
--
-- product_attribute_values and variants.option_ids are guarded by
-- ON DELETE RESTRICT, but the admin UI soft-deletes (sets deleted_at), which
-- bypasses the FK entirely: the attribute vanishes from the vendor form while
-- products keep rows pointing at it, with no warning to the admin.
--
-- Mirrors the existing fn_media_usage pattern so the UI can show
-- "used by N products: …" before archiving.
-- ============================================================================
begin;

create or replace function public.fn_attribute_usage(p_attribute_id uuid)
returns table (ref_type text, ref_label text, ref_id uuid)
language sql stable security definer set search_path = 'public' as $$
  select 'product'::text, coalesce(nullif(p.name_ar, ''), p.name_en), p.id
    from public.product_attribute_values v
    join public.products p on p.id = v.product_id
   where v.attribute_id = p_attribute_id and p.deleted_at is null
  union all
  -- a variant that stores this attribute's option in its option_ids array
  select 'variant_product'::text, coalesce(nullif(p.name_ar, ''), p.name_en), p.id
    from public.variants var
    join public.products p on p.id = var.product_id
    join public.attribute_options o on o.attribute_id = p_attribute_id
   where o.id = any(var.option_ids) and var.deleted_at is null and p.deleted_at is null
  limit 50;
$$;

create or replace function public.fn_attribute_option_usage(p_option_id uuid)
returns table (ref_type text, ref_label text, ref_id uuid)
language sql stable security definer set search_path = 'public' as $$
  select 'product'::text, coalesce(nullif(p.name_ar, ''), p.name_en), p.id
    from public.product_attribute_values v
    join public.products p on p.id = v.product_id
   where v.option_id = p_option_id and p.deleted_at is null
  union all
  select 'variant'::text, coalesce(nullif(p.name_ar, ''), p.name_en), p.id
    from public.variants var
    join public.products p on p.id = var.product_id
   where p_option_id = any(var.option_ids) and var.deleted_at is null and p.deleted_at is null
  limit 50;
$$;

-- Admins only; these reveal product names.
revoke all on function public.fn_attribute_usage(uuid) from public, anon;
revoke all on function public.fn_attribute_option_usage(uuid) from public, anon;
grant execute on function public.fn_attribute_usage(uuid) to authenticated;
grant execute on function public.fn_attribute_option_usage(uuid) to authenticated;

commit;
