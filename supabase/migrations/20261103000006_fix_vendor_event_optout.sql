-- ============================================================================
-- Fix 06 — vendors can actually accept/refuse an event
--
-- AGENT §21: vendors are auto-enrolled and MAY REFUSE; refusal hides their
-- products from home/listings and excludes them from event discounts. Only
-- fn_event_set_vendor existed, and it is admin-only — a vendor had no path at
-- all. This is the vendor-side counterpart: it pins p_vendor_id to the
-- caller's own store, so a vendor can only ever change their own row.
-- ============================================================================
begin;

create or replace function public.fn_vendor_event_opt(p_event_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = 'public' as $function$
declare
  v_vendor uuid := public.own_vendor_id();
  v_event  public.events;
begin
  if v_vendor is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vendor');
  end if;
  if p_status not in ('accepted', 'refused') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- No changing your mind after the event ended.
  if v_event.ends_at is not null and v_event.ends_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'event_ended');
  end if;

  -- event_vendors has no responded_at column; the audit row below records when.
  insert into public.event_vendors (event_id, vendor_id, status)
  values (p_event_id, v_vendor, p_status)
  on conflict (event_id, vendor_id)
  do update set status = excluded.status;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'vendor.event.' || p_status, 'event_vendors',
          p_event_id::text, jsonb_build_object('vendor_id', v_vendor, 'status', p_status));

  return jsonb_build_object('ok', true, 'status', p_status);
end $function$;

revoke all on function public.fn_vendor_event_opt(uuid, text) from public, anon;
grant execute on function public.fn_vendor_event_opt(uuid, text) to authenticated;

commit;
