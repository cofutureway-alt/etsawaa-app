-- ============================================================================
-- Seller-facing achievements
--   * v_storefront_stores exposes the level colour (store header shows the
--     level icon in its colour).
--   * fn_my_achievements(): the signed-in seller's level, next level with
--     per-goal progress, earned badges and active rewards — for the seller
--     dashboard, without exposing other stores' metrics.
-- ============================================================================
begin;

create or replace view public.v_storefront_stores as
SELECT v.id,
    v.slug,
    v.store_name_ar,
    v.store_name_en,
    v.short_desc_ar,
    v.short_desc_en,
    v.logo_path,
    v.banner_path,
    v.status,
    v.is_featured,
    v.hidden_from_listings,
    ((v.status = 'active'::text) AND (NOT v.hidden_from_listings)) AS is_listable,
    v.category_ids,
    lvl.name_ar AS level_name_ar,
    lvl.name_en AS level_name_en,
    lvl.icon AS level_icon,
    r.rating_avg,
    r.rating_count,
    pc.product_count,
    aev.event_id AS refused_event_id,
    aev.name_ar AS refused_event_name_ar,
    aev.name_en AS refused_event_name_en,
    lvl.color AS level_color
   FROM ((((vendors v
     LEFT JOIN vendor_levels lvl ON ((lvl.id = v.level_id)))
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            (count(*))::integer AS rating_count
           FROM reviews rw
          WHERE ((rw.vendor_id = v.id) AND (rw.status = 'published'::text))) r ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS product_count
           FROM products p
          WHERE ((p.vendor_id = v.id) AND (p.status = 'approved'::text) AND (p.deleted_at IS NULL))) pc ON (true))
     LEFT JOIN v_active_event_vendors aev ON (((aev.vendor_id = v.id) AND (aev.status = 'refused'::text))))
  WHERE (v.status = ANY (ARRAY['active'::text, 'suspended'::text]));

create or replace function public.fn_my_achievements()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_vendor uuid := public.own_vendor_id();
  v_level public.vendor_levels%rowtype;
  v_next public.vendor_levels%rowtype;
  v_goals jsonb := '[]'::jsonb;
begin
  if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'no_store'); end if;
  select l.* into v_level from public.vendor_levels l join public.vendors v on v.level_id = l.id where v.id = v_vendor;
  select * into v_next from public.vendor_levels
   where is_active and sort > coalesce(v_level.sort, -1) order by sort limit 1;
  if v_next.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'goal_type', g.goal_type, 'target', g.target, 'min_rating', g.min_rating, 'duration_unit', g.duration_unit,
             'progress', public.fn_goal_progress(v_vendor, g.goal_type, g.min_rating),
             'required', public.fn_goal_required(g.goal_type, g.target, g.duration_unit)) order by g.sort), '[]'::jsonb)
      into v_goals
      from public.achievement_goals g where g.level_id = v_next.id;
  end if;
  return jsonb_build_object(
    'ok', true,
    'level', case when v_level.id is null then null else jsonb_build_object(
      'id', v_level.id, 'name_ar', v_level.name_ar, 'name_en', v_level.name_en, 'icon', v_level.icon, 'color', v_level.color) end,
    'next', case when v_next.id is null then null else jsonb_build_object(
      'id', v_next.id, 'name_ar', v_next.name_ar, 'name_en', v_next.name_en, 'icon', v_next.icon, 'color', v_next.color,
      'goals', v_goals) end,
    'badges', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en,
                 'description_ar', b.description_ar, 'description_en', b.description_en, 'icon', b.icon, 'color', b.color) order by b.sort)
               from public.vendor_badges vb join public.badges b on b.id = vb.badge_id
              where vb.vendor_id = v_vendor and b.is_active), '[]'::jsonb),
    'commission_reduction', public.fn_vendor_commission_reduction(v_vendor),
    'featured_slots', public.fn_vendor_featured_slots(v_vendor),
    'featured_used', (select count(*) from public.products where vendor_id = v_vendor and featured_by_vendor));
end
$function$;

revoke execute on function public.fn_my_achievements() from public, anon;
grant execute on function public.fn_my_achievements() to authenticated;

commit;
