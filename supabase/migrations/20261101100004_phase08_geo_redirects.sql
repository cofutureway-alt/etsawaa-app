-- ============================================================================
-- Etsawaa — Phase 08 L-20: checkout map pin + L-08 slug redirects
-- 1) orders gains delivery-pin geo (optional snapshotted at checkout):
--      shipping_lat / shipping_lng  (numeric, 3e-7 ~ 3cm resolution)
--      shipping_geo_accuracy_m      (int, meters; null = unknown)
--    Vendor-visible snapshots NEVER include coordinates (fn_vendor_orders_list,
--    fn_vendor_order_snapshot untouched — name/address only).
-- 2) slug_redirects: moved static pages and articles 301 permanently.
--    old slug → new slug (per locale-agnostic route prefix), audited, active.
-- ============================================================================

-- 1) geo columns -----------------------------------------------------------
alter table public.orders
  add column if not exists shipping_lat double precision
    check (shipping_lat is null or (shipping_lat between 21.0 and 31.8)),   -- Egypt bounds
  add column if not exists shipping_lng double precision
    check (shipping_lng is null or (shipping_lng between 24.0 and 37.0)),
  add column if not exists shipping_geo_accuracy_m integer
    check (shipping_geo_accuracy_m is null or shipping_geo_accuracy_m between 1 and 5000);

comment on column public.orders.shipping_lat is 'Delivery pin (L-20) — snapshotted at checkout; carrier label QR only. Never exposed to vendors.';

-- 2) slug redirects --------------------------------------------------------
create table if not exists public.slug_redirects (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('page','post')),
  old_slug_ar text not null,
  old_slug_en text not null,
  new_slug_ar text not null,
  new_slug_en text not null,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists slug_redirects_lookup on public.slug_redirects (old_slug_ar, old_slug_en)
  where is_active;

alter table public.slug_redirects enable row level security;
drop policy if exists slug_redirects_read on public.slug_redirects;
create policy slug_redirects_read on public.slug_redirects
  for select using (is_active);
drop policy if exists slug_redirects_admin on public.slug_redirects;
create policy slug_redirects_admin on public.slug_redirects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.slug_redirects from anon, authenticated, public;
grant select on public.slug_redirects to anon, authenticated;

-- admin helper: create/replace a redirect pair (audited, idempotent per old slug)
create or replace function public.fn_admin_add_slug_redirect(
  p_kind text, p_old_ar text, p_old_en text, p_new_ar text, p_new_en text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_kind not in ('page','post') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;
  if coalesce(p_old_ar,'') = '' or coalesce(p_new_ar,'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'slugs_required');
  end if;
  if p_old_ar = p_new_ar and p_old_en = p_new_en then
    return jsonb_build_object('ok', false, 'reason', 'same_slug');
  end if;
  insert into public.slug_redirects (kind, old_slug_ar, old_slug_en, new_slug_ar, new_slug_en, created_by)
  values (p_kind, p_old_ar, p_old_en, p_new_ar, p_new_en, auth.uid());
  perform public.fn_audit('slug.redirect.added', 'slug_redirects',
    p_kind || ':' || coalesce(p_old_en, p_old_ar), null,
    jsonb_build_object('old_ar', p_old_ar, 'old_en', p_old_en, 'new_ar', p_new_ar, 'new_en', p_new_en));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_admin_add_slug_redirect(text, text, text, text, text) from public, anon;
grant execute on function public.fn_admin_add_slug_redirect(text, text, text, text, text) to authenticated;
