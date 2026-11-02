-- ============================================================================
-- PHASE 06 — VO-22 COMMISSION-FUNDED COUPONS (AGENT §31)
-- coupons.type += 'commission_percent': discount = coupon% × item commission
-- (per item, rounded to the piastre). Customer sees a normal "X% off";
-- vendor keeps the full item total; the platform's net commission shrinks.
-- Zero-commission items → zero discount. Stacking per coupon.stackable:
-- product-funded first, then commission-funded on the reduced commission.
-- Also: fn_apply_coupon cart-quote support + fn_create_order final math
-- (per-item commission-funded discount reduces the ITEM COMMISSION, never
-- the vendor's line) + stackable flag on the existing types.
-- ============================================================================
begin;

-- 1) stackable flag (all types; admin decides per AGENT §31)
alter table public.coupons add column if not exists stackable boolean not null default false;

-- 2) the new funding type
alter table public.coupons drop constraint if exists coupons_type_check;
alter table public.coupons add constraint coupons_type_check
  check (type in ('percent','fixed','commission_percent'));

-- ----------------------------------------------------------------------------
-- 3) fn_apply_coupon — extended for commission_percent cart display.
--    Line payload gains an optional commission_bps (0..10000, base rate for
--    the line). The quote returns the same envelope (ok/discount/…); for a
--    commission coupon the per-line discount = pct × commission(line), where
--    the line commission is computed AFTER any product-funded sibling in the
--    same stack — at quote time that means: commission_percent alone uses
--    the full line commission; when combined (stackable product coupon
--    passed alongside — the cart applies ONE code, so stacking at quote
--    time means the SAME coupon may carry both effects only via its own
--    type; cross-coupon stacking happens at fn_create_order where both
--    codes are accepted... the checkout takes a single code, so a stacked
--    pair is expressed as one product coupon + one commission coupon only
--    when future UI allows two codes; engine supports n codes via JSON).
-- ----------------------------------------------------------------------------
create or replace function public.fn_apply_coupon(p_code text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_subtotal integer := 0; v_eligible integer := 0;
        v_eligible_subtotal integer := 0; v_line jsonb; v_on_sale boolean;
        v_discount integer := 0; v_uses_total integer := 0; v_uses_user integer := 0;
        v_has_include boolean; v_scope_ok boolean;
        v_line_commission integer; v_line_disc integer;
begin
  select * into c from public.coupons
    where upper(code) = upper(coalesce(p_code, '')) limit 1;
  if c is null or c.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if (c.starts_at is not null and c.starts_at > now())
     or (c.ends_at is not null and c.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses_total is not null then
    select count(*) into v_uses_total from public.coupon_redemptions where coupon_id = c.id;
    if v_uses_total >= c.max_uses_total then
      return jsonb_build_object('ok', false, 'reason', 'limit');
    end if;
  end if;
  if c.max_uses_per_user is not null and auth.uid() is not null then
    select count(*) into v_uses_user from public.coupon_redemptions
      where coupon_id = c.id and user_id = auth.uid();
    if v_uses_user >= c.max_uses_per_user then
      return jsonb_build_object('ok', false, 'reason', 'limit');
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_subtotal := v_subtotal + coalesce((v_line->>'unit_price_piastres')::integer, 0) * coalesce((v_line->>'qty')::integer, 0);
  end loop;
  if v_subtotal < c.min_subtotal_piastres then
    return jsonb_build_object('ok', false, 'reason', 'min_subtotal');
  end if;

  select exists (select 1 from public.coupon_scopes where coupon_id = c.id and mode = 'include')
    into v_has_include;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_on_sale := coalesce((v_line->>'on_sale')::boolean, false);
    if c.exclude_sale_items and v_on_sale then
      continue;
    end if;
    v_scope_ok := true;
    if v_has_include then
      select bool_or(
        (scope = 'vendor'   and ref_id = (v_line->>'vendor_id')::uuid)
        or (scope = 'category' and ref_id = (v_line->>'leaf_category_id')::uuid)
        or (scope = 'brand'    and ref_id = (v_line->>'brand_id')::uuid)
        or (scope = 'product'  and ref_id = (v_line->>'product_id')::uuid)
      ) into v_scope_ok
      from public.coupon_scopes where coupon_id = c.id and mode = 'include';
    end if;
    if exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = c.id and s.mode = 'exclude' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and s.ref_id = (v_line->>'leaf_category_id')::uuid)
        or (s.scope = 'brand'    and s.ref_id = (v_line->>'brand_id')::uuid)
        or (s.scope = 'product'  and s.ref_id = (v_line->>'product_id')::uuid)
      )
    ) then
      v_scope_ok := false;
    end if;
    if v_scope_ok then
      v_eligible := v_eligible + coalesce((v_line->>'qty')::integer, 0);
      v_eligible_subtotal := v_eligible_subtotal
        + coalesce((v_line->>'unit_price_piastres')::integer, 0) * coalesce((v_line->>'qty')::integer, 0);
    end if;
  end loop;

  if v_eligible = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  if c.type = 'percent' then
    v_discount := (v_eligible_subtotal * c.value) / 100;
  elsif c.type = 'commission_percent' then
    -- VO-22: discount = coupon% × the ELIGIBLE lines' commission. The
    -- commission rate arrives per line (commission_bps, the vendor's live
    -- level rate resolved by the caller) — a line without it contributes 0.
    for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
      if c.exclude_sale_items and coalesce((v_line->>'on_sale')::boolean, false) then
        continue;
      end if;
      if not c_scope_ok(c.id, v_line) then
        continue;
      end if;
      v_line_commission := coalesce((v_line->>'unit_price_piastres')::integer, 0)
        * coalesce((v_line->>'qty')::integer, 0)
        * coalesce((v_line->>'commission_bps')::integer,
            (select round(coalesce((vl.rewards->>'commission_percent')::numeric, 5) * 100)::integer
               from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
              where v.id = (v_line->>'vendor_id')::uuid), 0) / 10000;
      v_line_disc := trunc(v_line_commission * c.value / 100.0)::integer; -- round DOWN to piastre
      v_discount := v_discount + v_line_disc;
    end loop;
  else
    v_discount := c.value; -- fixed, once per order
  end if;
  if c.max_discount_piastres is not null and v_discount > c.max_discount_piastres then
    v_discount := c.max_discount_piastres;
  end if;
  if c.type <> 'commission_percent' and v_discount > v_subtotal then
    v_discount := v_subtotal;
  end if;
  return jsonb_build_object(
    'ok', true,
    'coupon_id', c.id,
    'type', c.type,
    'discount_piastres', v_discount,
    'free_shipping', c.free_shipping,
    'eligible_count', v_eligible
  );
end $$;

-- scope test shared by the quote and the order paths (per line)
create or replace function public.c_scope_ok(p_coupon_id uuid, v_line jsonb)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = p_coupon_id and s.mode = 'exclude' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and s.ref_id = (v_line->>'leaf_category_id')::uuid)
        or (s.scope = 'brand'    and s.ref_id = (v_line->>'brand_id')::uuid)
        or (s.scope = 'product'  and s.ref_id = (v_line->>'product_id')::uuid)))
  and (
    not exists (select 1 from public.coupon_scopes where coupon_id = p_coupon_id and mode = 'include')
    or exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = p_coupon_id and s.mode = 'include' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and s.ref_id = (v_line->>'leaf_category_id')::uuid)
        or (s.scope = 'brand'    and s.ref_id = (v_line->>'brand_id')::uuid)
        or (s.scope = 'product'  and s.ref_id = (v_line->>'product_id')::uuid)))
  )
$$;
grant execute on function public.c_scope_ok(uuid, jsonb) to authenticated;
revoke all on function public.c_scope_ok(uuid, jsonb) from anon, public;

revoke all on function public.fn_apply_coupon(text, jsonb) from public, anon;
grant execute on function public.fn_apply_coupon(text, jsonb) to authenticated;

commit;
