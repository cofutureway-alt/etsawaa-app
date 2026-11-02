-- ============================================================================
-- Etsawaa — Phase 08.5 H-06: missing authenticated grants (500 root fix)
-- `roles` was never granted to authenticated; the roles page (admin-only UI,
-- RLS-gated by fn panel guards) failed with `permission denied for table
-- roles` → 500. Only SELECT is granted here: writes to roles stay
-- service-role/owner-only (fn_admin_set_role_permissions is SECURITY DEFINER).
-- Also: grant SELECT on staging import tables to authenticated so the
-- admin/import UI can read them under its RLS policy (is_admin) — no write
-- grants (CLI/service only, phase-09 rule preserved).
-- Apply: node --env-file=.env scripts/apply-migration.mjs <this file>
-- ============================================================================
grant select on public.roles to authenticated;

grant select on public.import_batches, public.staging_categories, public.staging_types,
  public.staging_specs, public.staging_groups, public.staging_group_links,
  public.staging_templates, public.staging_areas, public.staging_shared_products,
  public.import_rejects
  to authenticated;
