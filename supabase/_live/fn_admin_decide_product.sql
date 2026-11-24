CREATE OR REPLACE FUNCTION public.fn_admin_decide_product(p_product uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_product public.products%rowtype;
  v_owner   uuid;
  v_note    text := nullif(trim(coalesce(p_note, '')), '');
  v_before  text;
begin
  if not (public.has_permission('products.review') or public.has_permission('products.review')) then
    raise exception 'not allowed: reviewer permission required' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'approve_notes', 'reject', 'reject_final') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  select * into v_product from public.products where id = p_product and deleted_at is null for update;
  if v_product.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_product.rejected_final then
    return jsonb_build_object('ok', false, 'reason', 'rejected_final');
  end if;
  if p_decision = 'reject_final' then
    if v_product.status not in ('pending', 'rejected', 'approved') then
      return jsonb_build_object('ok', false, 'reason', 'bad_status');
    end if;
  elsif p_decision = 'reject' and v_product.status in ('pending', 'approved') then
    null; -- return-for-changes: an approved product can be sent back as well
  elsif v_product.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  if p_decision in ('approve_notes', 'reject', 'reject_final') and coalesce(length(v_note), 0) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;

  v_before := v_product.status;
  update public.products set
    status = case when p_decision like 'approve%' then 'approved' else 'rejected' end,
    rejection_reason = case when p_decision like 'reject%' then v_note else null end,
    review_note = case when p_decision = 'approve_notes' then v_note else null end,
    rejected_final = (p_decision = 'reject_final'),
    published_at = case when p_decision like 'approve%' then now() else null end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = v_product.id
  returning * into v_product;

  select owner_id into v_owner from public.vendors where id = v_product.vendor_id;
  perform public.fn_notify(v_owner,
    case when p_decision like 'approve%' then 'product.approved' else 'product.rejected' end,
    jsonb_build_object('product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
                       'reason', v_note, 'final', p_decision = 'reject_final'));

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'product.review', 'products', v_product.id::text,
          jsonb_build_object('status', v_before),
          jsonb_build_object('status', v_product.status, 'decision', p_decision, 'note', v_note));

  return jsonb_build_object('ok', true, 'status', v_product.status);
end $function$
;
