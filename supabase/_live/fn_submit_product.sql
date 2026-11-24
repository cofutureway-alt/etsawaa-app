CREATE OR REPLACE FUNCTION public.fn_submit_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_product public.products%rowtype;
  v_vendor  public.vendors%rowtype;
  v_config  jsonb := public.fn_vendor_config();
  v_target  text;
  v_missing text[] := '{}'::text[];
  v_attr    record;
  v_is_leaf boolean;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then
    raise exception 'product not found';
  end if;
  select * into v_vendor from public.vendors where id = v_product.vendor_id;
  if v_vendor.owner_id <> v_user then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if v_product.rejected_final then
    raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
  end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is not submittable in status %', v_product.status;
  end if;

  -- selling gate (grace expiry / suspension blocks publish at API level)
  if not public.vendor_can_sell(v_vendor.id) then
    raise exception 'selling is blocked for this store (% / %)', v_vendor.status, v_vendor.verification_status
      using errcode = 'P0001';
  end if;

  -- completeness validation
  if coalesce(v_product.name_ar, '') = '' or coalesce(v_product.name_en, '') = '' then
    v_missing := array_append(v_missing, ('name')::text);
  end if;
  if v_product.leaf_category_id is null then
    v_missing := array_append(v_missing, ('category')::text);
  else
    select not exists (
      select 1 from public.categories c where c.parent_id = v_product.leaf_category_id and c.deleted_at is null
    ) into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be a leaf category';
    end if;
  end if;
  if not exists (select 1 from public.product_media where product_id = v_product.id) then
    v_missing := array_append(v_missing, ('media')::text);
  end if;
  if not exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and sku is not null and price_piastres is not null and price_piastres > 0
  ) then
    v_missing := array_append(v_missing, ('variants')::text);
  end if;
  if exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and (sku is null or price_piastres is null or price_piastres <= 0)
  ) then
    v_missing := array_append(v_missing, ('variants_incomplete')::text);
  end if;
  for v_attr in
    select ad.code from public.attribute_defs ad
    where (ad.is_required or exists (select 1 from public.category_attributes ca_req
              where ca_req.attribute_id = ad.id and ca_req.category_id = v_product.leaf_category_id and ca_req.is_required))
        and ad.deleted_at is null
      and not ad.is_variant_axis -- axis attrs live in the variant combos
      and public.fn_attr_in_template(ad.id, v_product.leaf_category_id)
      and not exists (
        select 1 from public.product_attribute_values pav
        where pav.product_id = v_product.id and pav.attribute_id = ad.id
      )
  loop
    v_missing := array_append(v_missing, (('attribute:' || v_attr.code))::text);
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'product is incomplete: %', array_to_string(v_missing, ', ');
  end if;

  if coalesce(v_config ->> 'review_required', 'true') = 'true' then
    v_target := 'pending';
  else
    v_target := 'approved';
  end if;

  update public.products set
    status = v_target,
    rejection_reason = null,
    submitted_at = now(),
    published_at = case when v_target = 'approved' then now() else null end
  where id = v_product.id
  returning * into v_product;

  if v_target = 'pending' then
    perform public.fn_notify(a.id, 'product.pending', jsonb_build_object(
      'product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
      'vendor', v_vendor.store_name_ar
    ))
    from public.profiles a where a.role = 'admin';
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'product.submit', 'products', v_product.id::text, jsonb_build_object('status', v_target));

  return jsonb_build_object('status', v_target);
end $function$
;
