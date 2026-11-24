-- Profile cover image (owner round 2026-11-19): a customer had an avatar but
-- no banner. Same shape as avatar_url — a `media` bucket object path under
-- u/{uid}/, written by the profile page action, never a raw URL.

alter table public.profiles add column if not exists banner_url text;

-- The column-level UPDATE grant is the write path (phase-01 granted
-- full_name, phone, avatar_url, locale; phase-05 added phone_alternate).
-- Without this the action fails with "permission denied", exactly like the
-- alternate-phone bug in 20261105000005.
grant update (banner_url) on public.profiles to authenticated;

-- fn_viewer_context returns the signed-in person's row; the account layout
-- renders the banner from this one call, so the column has to ride along.
create or replace function public.fn_viewer_context()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select id, full_name, role, status, locale, phone, phone_alternate, avatar_url, banner_url
      from public.profiles
     where id = auth.uid()
  ),
  shop as (
    select v.id, v.slug, v.store_name_ar, v.store_name_en, v.short_desc_ar, v.short_desc_en,
           v.welcome_msg_ar, v.welcome_msg_en, v.logo_path, v.banner_path, v.category_ids,
           v.first_name, v.last_name, v.phone, v.governorate_id, v.area_id, v.address1, v.address2,
           v.postal_code, v.socials, v.status, v.rejection_reason, v.verification_status,
           v.verification_note, v.grace_until, v.onboarding_step, v.terms_version,
           v.terms_accepted_at, v.terms_signature, v.suspension_reason,
           (select count(*)::int from public.products pr
             where pr.vendor_id = v.id and pr.status = 'rejected'
               and pr.rejected_final = false and pr.deleted_at is null) as needs_changes
      from public.vendors v
     where v.owner_id = auth.uid()
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'profile', (select to_jsonb(me) from me),
    'legal', public.fn_legal_status(),
    'permissions', case when (select role from me) in ('admin', 'staff')
                        then coalesce(public.fn_my_permissions() -> 'permissions', '[]'::jsonb)
                        else '[]'::jsonb end,
    'vendor', (select to_jsonb(shop) from shop),
    'unread', (select count(*)::int from public.notifications n where n.user_id = auth.uid() and n.read_at is null)
  ) end
$$;

-- "Is this file in use?" — the media library refuses to delete a referenced
-- object. A replaced banner is only collectable if this reports it.
create or replace function public.fn_media_usage(p_path text)
returns table (ref_type text, ref_label text)
language sql security definer set search_path = 'public' as
$function$
  select 'category' as ref_type, coalesce(name_ar, slug_ar) as ref_label
    from public.categories where thumb_path = p_path and deleted_at is null
  union all
  select 'brand', coalesce(name_ar, slug_ar)
    from public.brands where thumb_path = p_path and deleted_at is null
  union all
  select 'attribute_option', coalesce(label_ar, code)
    from public.attribute_options where image_path = p_path and deleted_at is null
  union all
  select 'product', coalesce(nullif(name_ar, ''), name_en)
    from public.products where deleted_at is null
     and id in (select product_id from public.product_media where path = p_path)
  union all
  select 'variant_image', coalesce(nullif(name_ar, ''), name_en)
    from public.products where deleted_at is null
     and id in (select v.product_id from public.variants v where v.image_path = p_path and v.deleted_at is null)
  union all
  select 'blog_post', coalesce(nullif(title_ar, ''), title_en)
    from public.blog_posts where coalesce(cover_path, '') = p_path
  union all
  select 'banner', coalesce(nullif(title_ar, ''), title_en, image_path)
    from public.banners where image_path = p_path
  union all
  select 'profile_avatar', coalesce(nullif(full_name, ''), 'user')
    from public.profiles where avatar_url = p_path
  union all
  select 'profile_banner', coalesce(nullif(full_name, ''), 'user')
    from public.profiles where banner_url = p_path
  union all
  select 'vendor_logo', coalesce(store_name_ar, store_name_en)
    from public.vendors where coalesce(logo_path, '') = p_path or coalesce(banner_path, '') = p_path
  limit 50;
$function$;
