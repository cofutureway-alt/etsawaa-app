-- Phase 02 addendum: media usage check (M-07) + QA seed toggle helpers (M-17).
-- Scans the tables that reference media object paths. Products/posts/etc.
-- (phase 03+) extend the UNION below.

create or replace function public.fn_media_usage(p_path text)
returns table (ref_type text, ref_label text)
language sql security definer set search_path = public as $$
  select 'category' as ref_type, coalesce(name_ar, slug_ar) as ref_label
    from public.categories where thumb_path = p_path and deleted_at is null
  union all
  select 'brand', coalesce(name_ar, slug_ar)
    from public.brands where thumb_path = p_path and deleted_at is null
  union all
  select 'attribute_option', coalesce(label_ar, code)
    from public.attribute_options where image_path = p_path and deleted_at is null
  union all
  select 'media_folder_cover', name
    from public.media_folders where false  -- future: folder covers
  limit 50;
$$;

revoke all on function public.fn_media_usage(text) from anon;
grant execute on function public.fn_media_usage(text) to authenticated;
