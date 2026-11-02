-- ============================================================================
-- Fix 04 — admin withdrawal decision accepts a reason
--
-- The cancel dialog collected `reason` but the action discarded it and the RPC
-- hardcoded 'admin_cancelled'. p_reason is optional (existing callers keep
-- working) and lands in withdrawal_requests.cancel_reason.
-- ============================================================================
begin;

-- Drop the 2-arg signature: keeping both creates an overload that PostgREST
-- rejects with PGRST203 ("could not choose the best candidate function").
drop function if exists public.fn_admin_withdrawal_decision(uuid, text);

create or replace function public.fn_admin_withdrawal_decision(
  p_id uuid,
  p_decision text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_w withdrawal_requests%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_decision not in ('approve','cancel') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  select * into v_w from public.withdrawal_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if p_decision = 'approve' then
    update public.withdrawal_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), paid_at = now()
     where id = p_id;
  else
    update public.withdrawal_requests
       set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now(),
           cancel_reason = left(coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'admin_cancelled'), 300)
     where id = p_id;
    if not exists (select 1 from public.wallet_transactions
                   where vendor_id = v_w.vendor_id and type = 'withdrawal_refund'
                     and reference = 'withdrawal:' || p_id::text) then
      insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
      values (v_w.vendor_id, 'withdrawal_refund', v_w.amount_piastres, 'withdrawal:' || p_id::text,
              'Withdrawal cancelled by admin — hold restored', auth.uid());
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

commit;
