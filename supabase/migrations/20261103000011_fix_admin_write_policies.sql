-- ============================================================================
-- Fix 11 — four tables had a SELECT policy and nothing else
--
-- Fix 10 restored the table GRANTs, but Postgres still refused because RLS
-- had no INSERT/UPDATE/DELETE policy to evaluate: `vendor_levels`,
-- `governorates`, `areas` and `banners` were read-only for every role, so
-- creating a level, a governorate, an area or a banner was impossible from the
-- admin UI and always raised 42501 "new row violates row-level security".
--
-- These add the missing admin write policy to each, matching the pattern the
-- other catalog tables already use (`<table>_write_admin`, is_admin()).
-- Public read policies are untouched.
-- ============================================================================
begin;

-- vendor_levels — levels/badges editor (levels.tsx)
drop policy if exists vendor_levels_write_admin on public.vendor_levels;
create policy vendor_levels_write_admin on public.vendor_levels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- governorates + areas — shipping zones editor (zones.tsx)
drop policy if exists governorates_write_admin on public.governorates;
create policy governorates_write_admin on public.governorates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists areas_write_admin on public.areas;
create policy areas_write_admin on public.areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- banners — banners manager (banners.tsx)
drop policy if exists banners_write_admin on public.banners;
create policy banners_write_admin on public.banners
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;
