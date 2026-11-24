-- ============================================================================
-- fn_notify: internal helper, guarded by grants (not by caller role)
--
-- An earlier hardening added "if auth.uid() is not null and not is_admin()
-- then raise forbidden_admin_only" to fn_notify. But fn_notify is only
-- EXECUTE-able by postgres/service_role — users can't call it directly — and
-- it is called from SECURITY DEFINER flows a seller or customer starts
-- (fn_submit_product, fn_vendor_onboard, fn_cancel_order, fn_request_refund,
-- fn_update_group_status, fn_vendor_request_store_change …). The check made
-- every one of those fail for non-admins. The grant is the guard.
-- ============================================================================
begin;

create or replace function public.fn_notify(p_user uuid, p_type text, p_payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, payload) values (p_user, p_type, p_payload);
end $$;

revoke all on function public.fn_notify(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_notify(uuid, text, jsonb) to service_role;

commit;
