-- ============================================================================
-- Two holes reachable with the public anon key (confirmed live 2026-11-04)
--
-- 1. Views were writable. Supabase's default privileges granted INSERT/
--    UPDATE/DELETE on every view to anon and authenticated. Views run with
--    their owner's (postgres) rights, and v_storefront_categories is a simple
--    single-table view, so it was automatically updatable: an anonymous PATCH
--    on /rest/v1/v_storefront_categories rewrote categories past RLS.
--    Views are read models — revoke all writes, and stop postgres-created
--    relations from inheriting client write grants in future. Every existing
--    migration grants table writes explicitly, so this changes nothing else;
--    a future table that clients write to must `grant insert/update/delete`
--    explicitly (as all current ones do).
--
-- 2. fn_resolve_email_from_phone was executable by anon, turning any phone
--    number into the account's email. The app now calls it with the service
--    client only (app/features/auth/phone-email.server.ts).
-- ============================================================================
begin;

do $$
declare v record;
begin
  for v in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated, public', v.relname);
  end loop;
end $$;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

revoke execute on function public.fn_resolve_email_from_phone(text) from public, anon, authenticated;
grant execute on function public.fn_resolve_email_from_phone(text) to service_role;

commit;
