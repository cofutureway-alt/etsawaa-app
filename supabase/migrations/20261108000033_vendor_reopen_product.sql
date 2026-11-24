-- Sellers edit a submitted / published product by reopening it: it goes back
-- to draft (off the store, out of the review queue), they edit it and submit
-- it again; it reappears once an admin approves it. Every edit is reviewed.
create or replace function public.fn_vendor_reopen_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
begin
  -- a suspended store can look but not act
  perform public.fn_assert_my_store_operational();
  if v_user is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.* into v_product from public.products p
   where p.id = p_product_id and p.deleted_at is null
     and (exists (select 1 from public.vendors v where v.id = p.vendor_id and v.owner_id = v_user)
          or exists (select 1 from public.store_members m where m.vendor_id = p.vendor_id and m.user_id = v_user));
  if v_product.id is null then raise exception 'not allowed: not your product' using errcode = '42501'; end if;
  if v_product.status not in ('approved', 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'not_reopenable', 'status', v_product.status);
  end if;

  update public.products set status = 'draft', submitted_at = null, updated_at = now() where id = p_product_id;
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (v_user, 'product.reopened', 'products', p_product_id::text,
          jsonb_build_object('status', v_product.status),
          jsonb_build_object('status', 'draft', 'was_live', v_product.status = 'approved'));
  return jsonb_build_object('ok', true, 'from', v_product.status);
end $$;
revoke all on function public.fn_vendor_reopen_product(uuid) from public, anon;
grant execute on function public.fn_vendor_reopen_product(uuid) to authenticated;
