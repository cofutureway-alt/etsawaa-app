-- Admin products: bulk permanent delete / archive.
-- p_mode 'delete': a product that was NEVER sold (no order line) is deleted for good —
--   its media rows, variants, specs, cart / wishlist entries go with it (FK cascades).
--   A product that WAS sold is archived instead (soft delete), because orders,
--   invoices and returns must keep pointing at it (order_items → products is RESTRICT).
-- p_mode 'archive': every selected product is archived.
-- Every product is audited with the reason. Admin only.
create or replace function public.fn_admin_delete_products(p_ids uuid[], p_reason text, p_mode text default 'delete')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_before jsonb;
  v_deleted int := 0;
  v_archived int := 0;
  v_sold_archived int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_mode not in ('delete', 'archive') then return jsonb_build_object('ok', false, 'reason', 'bad_mode'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad_selection');
  end if;

  foreach v_id in array p_ids loop
    select to_jsonb(p) into v_before from public.products p where p.id = v_id;
    continue when v_before is null;

    if p_mode = 'delete' and not exists (select 1 from public.order_items oi where oi.product_id = v_id) then
      delete from public.products where id = v_id;
      perform public.fn_audit('product.deleted', 'products', v_id::text,
        jsonb_build_object('name_ar', v_before->>'name_ar', 'name_en', v_before->>'name_en', 'vendor_id', v_before->>'vendor_id', 'status', v_before->>'status'),
        jsonb_build_object('reason', p_reason, 'deleted', true));
      v_deleted := v_deleted + 1;
    else
      if (v_before->>'deleted_at') is null then
        update public.products set deleted_at = now(), updated_at = now() where id = v_id;
        perform public.fn_audit('product.archived', 'products', v_id::text,
          jsonb_build_object('deleted_at', null),
          jsonb_build_object('reason', p_reason, 'archived', true, 'sold_before', p_mode = 'delete'));
      end if;
      v_archived := v_archived + 1;
      if p_mode = 'delete' then v_sold_archived := v_sold_archived + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'archived', v_archived, 'sold_archived', v_sold_archived);
end $$;

revoke all on function public.fn_admin_delete_products(uuid[], text, text) from public, anon;
grant execute on function public.fn_admin_delete_products(uuid[], text, text) to authenticated;
