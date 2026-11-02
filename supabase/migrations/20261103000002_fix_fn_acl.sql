-- ============================================================================
-- Fix 02 — tighten EXECUTE on the admin-only RPCs
--
-- The guards from fix01 are the real fix; this closes the door for roles that
-- should never reach them at all. Split from fix01 so a compile error in a
-- body cannot cut off legitimate callers before the guards exist.
--
--   fn_notify            — anon + authenticated → revoked (triggers/RPCs only)
--   fn_release_earnings  — cron/JWT-admin only
--   fn_expire_grace      — cron/JWT-admin only
--   fn_cancel_order_admin, fn_admin_set_order_status,
--   fn_promote_vendor_level — admin UI (authenticated, guarded)
--   fn_post_transaction  — server RPCs (SECURITY DEFINER chain)
--
-- service_role keeps everything so cron/edge/service paths keep working.
-- Re-running is safe: revoke/grant are idempotent.
-- ============================================================================
begin;

revoke all on function public.fn_notify(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_notify(uuid, text, jsonb) to service_role;

revoke all on function public.fn_release_earnings() from public, anon, authenticated;
grant execute on function public.fn_release_earnings() to service_role;

revoke all on function public.fn_expire_grace() from public, anon, authenticated;
grant execute on function public.fn_expire_grace() to service_role;

revoke all on function public.fn_cancel_order_admin(uuid, text) from public, anon;
revoke all on function public.fn_admin_set_order_status(uuid, text, text) from public, anon;
revoke all on function public.fn_promote_vendor_level(uuid, uuid, text) from public, anon;
revoke all on function public.fn_post_transaction(uuid, text, bigint, text, text, uuid, uuid) from public, anon;

commit;
