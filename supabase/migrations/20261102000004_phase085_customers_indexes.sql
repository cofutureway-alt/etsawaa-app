-- ============================================================================
-- Etsawaa — Phase 08.5 H-07: customers pagination indexes
-- admin/customers pages profiles server-side (20/page) and searches by
-- name/email/phone — these indexes keep those queries out of seq scans.
-- ============================================================================
create index if not exists profiles_created_idx on public.profiles (created_at desc);
create index if not exists profiles_role_status_idx on public.profiles (role, status, created_at desc);
-- orders rollup scanned per listed customer page
create index if not exists orders_user_status_idx on public.orders (user_id, status);
