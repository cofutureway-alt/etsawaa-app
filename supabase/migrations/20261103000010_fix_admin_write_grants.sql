-- ============================================================================
-- Fix 10 — admin writes were impossible on six tables
--
-- RLS policies exist (is_admin()), but the underlying table GRANT was never
-- issued to `authenticated`. RLS cannot grant a privilege it is asked to
-- filter — Postgres denies at the GRANT layer first (42501 "permission denied
-- for table X"), so these admin features could never have worked from the UI:
--
--   vendor_levels  → creating/editing a level      (levels.tsx)
--   penalty_rules  → was granted (verified) — listed for completeness only
--   governorates   → creating/editing a governorate (zones.tsx)
--   areas          → creating/editing an area       (zones.tsx)
--   banners        → banner CRUD                    (banners.tsx)
--   static_pages   → page CRUD                      (pages.tsx)
--   ad_packages    → package CRUD                   (ads.tsx)
--
-- Only the missing GRANTs are added; every write stays gated by the existing
-- `*_write_admin` / is_admin() policies on each table, and anon keeps nothing.
-- ============================================================================
begin;

grant insert, update, delete on public.vendor_levels   to authenticated;
grant insert, update, delete on public.penalty_rules   to authenticated;
grant insert, update, delete on public.governorates    to authenticated;
grant insert, update, delete on public.areas           to authenticated;
grant insert, update, delete on public.banners         to authenticated;
grant insert, update, delete on public.static_pages    to authenticated;
grant insert, update, delete on public.ad_packages     to authenticated;

-- belt and braces: nothing here is ever anonymous-writable
revoke insert, update, delete on public.vendor_levels, public.penalty_rules,
  public.governorates, public.areas, public.banners, public.static_pages,
  public.ad_packages from anon;

commit;
