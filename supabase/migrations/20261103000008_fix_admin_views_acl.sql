-- ============================================================================
-- Fix 08 — v_admin_* leaked marketplace money to every signed-in user
--
-- The four dashboard views were created without `security_invoker`, so they
-- run with the OWNER's rights and bypass RLS on orders /
-- order_vendor_groups / vendors. They were then granted to `authenticated`,
-- which means any customer holding a session could read total GMV, platform
-- commission, per-vendor revenue and the customer/vendor counts.
--
-- Two layers, both needed:
--   1. security_invoker = true  → the caller's RLS applies
--   2. revoke from authenticated → only admins can call them at all
--
-- `security_invoker` requires Postgres 15+ (project runs 17). Re-running is
-- safe. Reverting means dropping the flag and re-granting; see
-- backups/rollback note in the commit message.
-- ============================================================================
begin;

alter view public.v_admin_kpis          set (security_invoker = true);
alter view public.v_admin_daily_sales   set (security_invoker = true);
alter view public.v_admin_top_vendors   set (security_invoker = true);
alter view public.v_admin_top_products  set (security_invoker = true);

revoke all on public.v_admin_kpis         from public, anon, authenticated;
revoke all on public.v_admin_daily_sales  from public, anon, authenticated;
revoke all on public.v_admin_top_vendors  from public, anon, authenticated;
revoke all on public.v_admin_top_products from public, anon, authenticated;

-- Grants stay with `authenticated` because the dashboard reads these with the
-- admin's own JWT and Postgres has no "admin-only" grant. security_invoker is
-- therefore the actual fix: the view now runs under the caller's RLS, and every
-- underlying table (orders, order_vendor_groups, vendors, profiles) is
-- is_admin()-gated for reads — so a non-admin gets zero rows, not a 403.
--
-- v_admin_top_products only touches products + published reviews, both of which
-- are public by design, so it is harmless either way. It keeps its grant.
grant select on public.v_admin_kpis         to authenticated;
grant select on public.v_admin_daily_sales  to authenticated;
grant select on public.v_admin_top_vendors  to authenticated;
grant select on public.v_admin_top_products to authenticated;

commit;
