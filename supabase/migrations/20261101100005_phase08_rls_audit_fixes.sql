-- ============================================================================
-- Etsawaa — Phase 08 L-13 RLS audit fixes:
--   order_sequences          → enable RLS + admin read + nextval via definer
--   email_logs/email_templates → RLS + admin-only policies (reads via definer
--                                functions stay unaffected; write paths use
--                                service-role which bypasses RLS by design)
--   roles                    → RLS + read-for-authenticated (has_permission
--                                already reads it via definer), admin write
--   FORCE ROW LEVEL SECURITY on the ledger + audit trail + mail logs so even
--   the table owner cannot read rows without going through the policies.
-- ============================================================================

alter table public.order_sequences  enable row level security;
alter table public.email_logs       enable row level security;
alter table public.email_templates  enable row level security;
alter table public.roles            enable row level security;

drop policy if exists order_sequences_admin on public.order_sequences;
create policy order_sequences_admin on public.order_sequences
  for select to authenticated using (public.is_admin());

drop policy if exists email_logs_admin on public.email_logs;
create policy email_logs_admin on public.email_logs
  for select to authenticated using (public.is_admin());

drop policy if exists email_templates_admin on public.email_templates;
create policy email_templates_admin on public.email_templates
  for select to authenticated using (public.is_admin());

drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles
  for select to authenticated using (true);
drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.wallet_transactions force row level security;
alter table public.audit_logs        force row level security;
alter table public.email_logs        force row level security;

-- grants stay aligned with policies (anon gets nothing extra)
revoke all on public.order_sequences from anon;
revoke all on public.email_logs, public.email_templates from anon;
