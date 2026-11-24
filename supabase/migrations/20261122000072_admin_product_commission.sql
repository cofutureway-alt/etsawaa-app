-- 2026-11-22 (owner request): the platform commission on a product, shown on
-- the admin review page (admin and staff only; never to sellers or shoppers).
-- Mirrors fn_vendor_line_commission (the rate checkout charges) step by step
-- and also says which rule produced it. `rate` is fn_vendor_line_commission
-- itself, so the page can never show a different number than checkout uses.
create or replace function public.fn_admin_product_commission(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_vendor uuid; v_leaf uuid; v_mode text; v_fixed numeric; v_level_name_ar text; v_level_name_en text; v_level_pct numeric;
  v_override numeric; v_override_cat uuid; v_cat_pct numeric; v_cat_from uuid; v_base numeric; v_source text; v_from uuid;
  v_reduction numeric;
begin
  if not (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'staff' and status <> 'blocked')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select p.vendor_id, p.leaf_category_id into v_vendor, v_leaf from public.products p where p.id = p_product;
  if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select v.commission_mode, v.commission_fixed_percent, lvl.name_ar, lvl.name_en, (lvl.rewards->>'commission_percent')::numeric
    into v_mode, v_fixed, v_level_name_ar, v_level_name_en, v_level_pct
    from public.vendors v left join public.vendor_levels lvl on lvl.id = v.level_id where v.id = v_vendor;

  -- 1. a special rate agreed with this store for the category (deepest wins)
  if v_leaf is not null then
    select o.percent, o.category_id into v_override, v_override_cat
      from public.vendor_commission_overrides o join public.categories oc on oc.id = o.category_id
     where o.vendor_id = v_vendor and public.fn_category_within(v_leaf, o.category_id)
     order by oc.depth desc limit 1;
    -- 3. the category's own rate, or the nearest parent's
    with recursive up(cat, parent, depth) as (
      select c.id, c.parent_id, 0 from public.categories c where c.id = v_leaf
      union all select c.id, c.parent_id, up.depth + 1 from public.categories c join up on c.id = up.parent)
    select cc.percent, cc.category_id into v_cat_pct, v_cat_from
      from up join public.category_commissions cc on cc.category_id = up.cat order by up.depth limit 1;
  end if;

  if v_override is not null then v_base := v_override; v_source := 'vendor_category'; v_from := v_override_cat;
  elsif v_mode = 'fixed' and v_fixed is not null then v_base := v_fixed; v_source := 'vendor_fixed';
  elsif v_cat_pct is not null then v_base := v_cat_pct; v_source := case when v_cat_from = v_leaf then 'category' else 'parent_category' end; v_from := v_cat_from;
  elsif v_level_pct is not null then v_base := v_level_pct; v_source := 'level';
  else v_base := 5; v_source := 'default';
  end if;
  v_reduction := public.fn_vendor_commission_reduction(v_vendor);

  return jsonb_build_object(
    'ok', true,
    'rate', public.fn_vendor_line_commission(v_vendor, v_leaf),
    'base', v_base,
    'reduction', v_reduction,
    'source', v_source,
    'from_category_ar', (select name_ar from public.categories where id = v_from),
    'from_category_en', (select name_en from public.categories where id = v_from),
    'level_ar', v_level_name_ar,
    'level_en', v_level_name_en,
    'has_leaf', v_leaf is not null);
end $$;
revoke all on function public.fn_admin_product_commission(uuid) from public, anon;
grant execute on function public.fn_admin_product_commission(uuid) to authenticated;
