-- Stores run by the team (owner is an admin or a staff member, supervisors included)
-- stay off the home page and the stores page until the owner chooses to list them.
-- Their products stay on the site unless the owner also chooses to hide them.
-- The store page itself stays reachable by its link.
begin;

alter table public.vendors
  add column if not exists team_listed boolean not null default false,
  add column if not exists team_products_hidden boolean not null default false;

-- is the store owner part of the team (admin or staff)?
create or replace function public.fn_vendor_team_owned(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_owner and p.role in ('admin', 'staff'));
$$;
revoke all on function public.fn_vendor_team_owned(uuid) from public;
grant execute on function public.fn_vendor_team_owned(uuid) to anon, authenticated, service_role;

-- stores: a new column at the end, in_store_lists (home + stores page)
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
    v.is_featured OR v.featured_permanent OR v.featured_until IS NOT NULL AND v.featured_until > now() OR (EXISTS ( SELECT 1
           FROM ad_campaigns ac
          WHERE ac.vendor_id = v.id AND ac.status = 'active'::text AND ac.ends_at > now())) AS is_featured,
    v.hidden_from_listings,
    v.status = 'active'::text AND NOT v.hidden_from_listings AS is_listable,
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
    lvl.color AS level_color,
    v.status = 'active'::text AND NOT v.hidden_from_listings
      AND (v.team_listed OR NOT public.fn_vendor_team_owned(v.owner_id)) AS in_store_lists
   FROM vendors v
     LEFT JOIN vendor_levels lvl ON lvl.id = v.level_id
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            count(*)::integer AS rating_count
           FROM reviews rw
          WHERE rw.vendor_id = v.id AND rw.status = 'published'::text) r ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS product_count
           FROM products p
          WHERE p.vendor_id = v.id AND p.status = 'approved'::text AND p.deleted_at IS NULL) pc ON true
     LEFT JOIN v_active_event_vendors aev ON aev.vendor_id = v.id AND aev.status = 'refused'::text
  WHERE v.status = ANY (ARRAY['active'::text, 'suspended'::text]);

-- products view: same rule added to its WHERE (the view body is kept as is)
do $do$
declare
  d text := pg_get_viewdef('public.v_storefront_products'::regclass, true);
  k text := 'AND NOT v.hidden_from_listings';
begin
  if d like '%team_products_hidden%' then return; end if;
  if (length(d) - length(replace(d, k, ''))) / length(k) <> 1 then
    raise exception 'v_storefront_products: expected one "%"', k;
  end if;
  d := replace(d, k, k || ' AND NOT (v.team_products_hidden AND public.fn_vendor_team_owned(v.owner_id))');
  execute 'create or replace view public.v_storefront_products as ' || d;
end $do$;

-- products: the public check also drops products the team owner chose to hide
create or replace function public.product_is_public(p_product_id uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.products p
    join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id
      and p.status = 'approved' and p.deleted_at is null
      and v.status = 'active'
      and v.verification_status <> 'grace_expired'
      and not v.hidden_from_listings
      and not (v.team_products_hidden and public.fn_vendor_team_owned(v.owner_id))
  );
$function$;

-- the owner (admin or staff) sets both choices for their own store
create or replace function public.fn_vendor_set_team_listing(p_listed boolean, p_hide_products boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.vendors;
begin
  select * into v from public.vendors where owner_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_store'); end if;
  if not public.fn_vendor_team_owned(v.owner_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.vendors
     set team_listed = coalesce(p_listed, false),
         team_products_hidden = coalesce(p_hide_products, false)
   where id = v.id;
  perform public.fn_audit('vendor.team_listing', 'vendors', v.id::text,
    jsonb_build_object('team_listed', v.team_listed, 'team_products_hidden', v.team_products_hidden),
    jsonb_build_object('team_listed', coalesce(p_listed, false), 'team_products_hidden', coalesce(p_hide_products, false)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fn_vendor_set_team_listing(boolean, boolean) from public, anon;
grant execute on function public.fn_vendor_set_team_listing(boolean, boolean) to authenticated;

commit;
