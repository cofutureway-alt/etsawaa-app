-- ============================================================================
-- KYC document integrity + admin-only usage RPCs
--
-- Found while running the end-to-end suite against a fresh database:
--
-- 1) vendor_documents: `authenticated` held INSERT on every column, including
--    status / reviewed_by / reviewed_at / review_note. RLS only checks that
--    the row belongs to the caller's store, so a vendor could POST straight
--    to PostgREST and insert their own document as status='verified'.
--    INSERT is narrowed to the columns an upload actually writes; status
--    falls back to its 'pending' default.
--
-- 2) Replacing a document (UPDATE of path, which vendors may do) kept the
--    previous review outcome, so a verified document could be swapped for
--    any file and stay verified. A new file now always goes back to
--    'pending' with the review fields cleared.
--
-- 3) fn_attribute_usage / fn_attribute_option_usage were documented as
--    "admins only; these reveal product names" but had no role check and
--    are executable by every signed-in user, exposing other vendors'
--    (including unapproved) product names. They now raise for non-admins.
--
-- Re-running is safe (grants are absolute, create or replace).
-- ============================================================================
begin;

-- 1) column-scoped INSERT
revoke insert on public.vendor_documents from authenticated;
grant insert (vendor_id, type, bucket, path, original_name, mime, size_bytes)
  on public.vendor_documents to authenticated;

-- 2) a replaced file must be reviewed again
create or replace function public.fn_vendor_documents_rereview()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.path is distinct from old.path then
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_vendor_documents_rereview on public.vendor_documents;
create trigger trg_vendor_documents_rereview
  before update on public.vendor_documents
  for each row execute function public.fn_vendor_documents_rereview();

-- 3) admin guard on the usage RPCs (bodies unchanged from 20261103000007)
create or replace function public.fn_attribute_usage(p_attribute_id uuid)
returns table (ref_type text, ref_label text, ref_id uuid)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  return query
  select 'product'::text, coalesce(nullif(p.name_ar, ''), p.name_en), p.id
    from public.product_attribute_values v
    join public.products p on p.id = v.product_id
   where v.attribute_id = p_attribute_id and p.deleted_at is null
  union all
  select 'variant_product'::text, coalesce(nullif(p.name_ar, ''), p.name_en), p.id
    from public.variants var
    join public.products p on p.id = var.product_id
    join public.attribute_options o on o.attribute_id = p_attribute_id
   where o.id = any(var.option_ids) and var.deleted_at is null and p.deleted_at is null
  limit 50;
end $$;

create or replace function public.fn_attribute_option_usage(p_option_id uuid)
returns table (ref_type text, ref_label text, ref_id uuid)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  return query
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
end $$;

revoke all on function public.fn_attribute_usage(uuid) from public, anon;
revoke all on function public.fn_attribute_option_usage(uuid) from public, anon;
grant execute on function public.fn_attribute_usage(uuid) to authenticated;
grant execute on function public.fn_attribute_option_usage(uuid) to authenticated;

commit;
