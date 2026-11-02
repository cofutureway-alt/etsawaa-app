-- Phase 08: grants repair — fn_cancel_order_admin / fn_admin_set_order_status /
-- fn_admin_bulk_order_status were created but never granted to authenticated
-- (found by the phase-08 e2e W1 check).
grant execute on function
  public.fn_cancel_order_admin(uuid, text),
  public.fn_admin_set_order_status(uuid, text, text),
  public.fn_admin_bulk_order_status(uuid[], text, text)
  to authenticated;
