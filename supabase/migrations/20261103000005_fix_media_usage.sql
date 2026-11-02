-- ============================================================================
-- Fix 05 — fn_media_usage actually finds references
--
-- The old body had a `where false` stub arm and never looked at products,
-- blog covers, banners or avatars — so the safe-delete check passed on files
-- that were still in use and the storefront ended up with broken images.
-- ============================================================================
begin;

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
  select 'vendor_logo', coalesce(store_name_ar, store_name_en)
    from public.vendors where coalesce(logo_path, '') = p_path or coalesce(banner_path, '') = p_path
  limit 50;
$function$;

commit;
