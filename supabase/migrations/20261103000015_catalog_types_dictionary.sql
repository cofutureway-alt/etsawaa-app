-- ============================================================================
-- Catalog model for the Phase 09 data (product types + shared spec dictionary)
--
-- Phase 09 brings 10/38/170 browse categories, 1,354 product types (1,391
-- placements) and a 1,269-spec dictionary whose templates reuse the same
-- specs across types. Fitted onto the existing catalog machinery instead of a
-- parallel one, so every existing screen (admin categories / attributes,
-- vendor wizard, storefront listing, facets, commissions) keeps working:
--
-- 1) Product types are level-4 categories under their L3 browse leaf. Header
--    menus keep showing L1-L3; listing, breadcrumbs, commissions and the
--    product wizard already walk categories by path.
-- 2) categories.source_key - stable natural key of imported nodes so a
--    re-import updates in place even after an admin edits a slug.
-- 3) Global dictionary attributes: attribute_defs.category_id may be NULL
--    (owned by no leaf) and are attached to type leaves through
--    category_attributes (the existing "linked attribute" mechanism the wizard
--    and fn_attr_in_template already honour). One spec = one row, edited once.
-- 4) Category-scoped rules match the subtree, not only the exact leaf:
--    coupon scopes, event discounts and vendor commission overrides set on an
--    L1-L3 node now apply to products filed under its product types
--    (fn_category_within). Exact-leaf matching would make every such rule
--    silently dead once products live one level deeper.
-- 5) Facets: global attributes linked to a leaf surface as storefront
--    facets; the search RPC de-duplicates them (one global attribute is linked
--    to many leaves), and fn_storefront_facet_defs returns the distinct
--    filterable attributes of a subtree for the listing loader.
-- 6) areas: one area name per governorate (the Phase 09 rule), enforced.
--
-- Function/view bodies below are the live definitions with only the marked
-- predicates changed. Re-running is safe.
-- ============================================================================
begin;

-- 1) depth 4 -------------------------------------------------------------------
alter table public.categories drop constraint if exists categories_depth_check;
alter table public.categories add constraint categories_depth_check check (depth between 1 and 4);

CREATE OR REPLACE FUNCTION public.fn_category_path()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare parent record;
begin
  if new.parent_id is null then
    new.depth := 1;
    new.path  := new.id::text;
  else
    -- cycle guard: a node can never be moved under its own descendant
    if exists (select 1 from public.categories where id = new.parent_id and path like new.id::text || '/%') then
      raise exception 'category_parent_cycle: cannot nest a category under its own descendant';
    end if;
    select id, depth, path into parent from public.categories where id = new.parent_id;
    if parent.id is null then
      raise exception 'category_parent_not_found';
    end if;
    if parent.depth >= 4 then
      raise exception 'category_depth_limit: categories nest at most 4 levels (L1-L3 browse + product type)';
    end if;
    new.depth := parent.depth + 1;
    new.path  := parent.path || '/' || new.id::text;
  end if;
  return new;
end;
$function$;

-- 2) stable import key ---------------------------------------------------------
alter table public.categories add column if not exists source_key text;
create unique index if not exists categories_source_key_unique
  on public.categories (source_key) where source_key is not null;
comment on column public.categories.source_key is
  'Natural key of imported nodes (EN path slug, e.g. fashion/mens-fashion/casual/mens-t-shirts). NULL for nodes created in the admin.';

-- 3) global dictionary attributes ---------------------------------------------
alter table public.attribute_defs alter column category_id drop not null;
create unique index if not exists attribute_defs_global_code_unique
  on public.attribute_defs (code) where category_id is null and deleted_at is null;
comment on column public.attribute_defs.category_id is
  'Owning leaf category, or NULL for a global dictionary attribute shared by many leaves via category_attributes.';

CREATE OR REPLACE FUNCTION public.fn_attribute_leaf_category()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare kids int;
begin
  -- global dictionary attribute (no owner): linked to leaves via category_attributes
  if new.category_id is null then
    return new;
  end if;
  select count(*) into kids from public.categories where parent_id = new.category_id and deleted_at is null;
  if kids > 0 then
    raise exception 'attribute_category_not_leaf: attributes attach to leaf categories only';
  end if;
  return new;
end;
$function$;

-- 4) subtree matching ----------------------------------------------------------
-- true when p_leaf is p_ref or sits anywhere below it (categories.path is the
-- '/'-joined chain of ancestor ids)
create or replace function public.fn_category_within(p_leaf uuid, p_ref uuid)
returns boolean language sql stable set search_path = 'public' as $$
  select p_leaf = p_ref or exists (
    select 1 from public.categories c
     where c.id = p_leaf and p_ref::text = any (string_to_array(c.path, '/'))
  );
$$;
revoke all on function public.fn_category_within(uuid, uuid) from public;
grant execute on function public.fn_category_within(uuid, uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.c_scope_ok(p_coupon_id uuid, v_line jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = p_coupon_id and s.mode = 'exclude' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and public.fn_category_within((v_line->>'leaf_category_id')::uuid, s.ref_id))
        or (s.scope = 'brand'    and s.ref_id = (v_line->>'brand_id')::uuid)
        or (s.scope = 'product'  and s.ref_id = (v_line->>'product_id')::uuid)))
  and (
    not exists (select 1 from public.coupon_scopes where coupon_id = p_coupon_id and mode = 'include')
    or exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = p_coupon_id and s.mode = 'include' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and public.fn_category_within((v_line->>'leaf_category_id')::uuid, s.ref_id))
        or (s.scope = 'brand'    and s.ref_id = (v_line->>'brand_id')::uuid)
        or (s.scope = 'product'  and s.ref_id = (v_line->>'product_id')::uuid)))
  )
$function$;

CREATE OR REPLACE FUNCTION public.fn_apply_coupon(p_code text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        or (scope = 'category' and public.fn_category_within((v_line->>'leaf_category_id')::uuid, ref_id))
        or (scope = 'brand'    and ref_id = (v_line->>'brand_id')::uuid)
        or (scope = 'product'  and ref_id = (v_line->>'product_id')::uuid)
      ) into v_scope_ok
      from public.coupon_scopes where coupon_id = c.id and mode = 'include';
    end if;
    if exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = c.id and s.mode = 'exclude' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and public.fn_category_within((v_line->>'leaf_category_id')::uuid, s.ref_id))
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
end $function$;

CREATE OR REPLACE FUNCTION public.fn_create_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_addr jsonb := p_payload->'address';
  v_method text := p_payload->>'payment_method';
  v_coupon_code text := nullif(trim(coalesce(p_payload->>'coupon_code', '')), '');
  v_attempt uuid := nullif(p_payload->>'attempt_key', '')::uuid;
  v_existing orders%rowtype;
  v_profile record;
  v_area record;
  r record;
  x record;
  v_it record;

  v_cod_cap integer := 500000;
  v_shipping integer;
  v_lines jsonb := '[]'::jsonb;          -- coupon validation lines
  v_rows jsonb := '[]'::jsonb;           -- priced rows for insertion
  v_row jsonb;
  v_subtotal integer := 0;

  v_vendor_ids uuid[] := '{}'::uuid[];
  v_vendor_mode boolean := false;        -- any vendor-shipped item

  v_coupon_row public.coupons%rowtype;
  v_coupon jsonb;
  v_discount integer := 0;               -- product-funded
  v_cd_discount integer := 0;            -- commission-funded (VO-22)
  v_free_shipping boolean := false;
  v_eligible_subtotal integer := 0;
  v_line_discount integer;
  v_running integer := 0;
  v_last_eligible integer := -1;

  v_total integer;
  v_order_id uuid;
  v_number text;
  v_yy smallint;
  v_seq integer;
  v_group_id uuid;
  v_group_subtotal integer;
  v_group_discount integer;
  v_group_commission integer;
  v_commission_bps integer;
  v_rate numeric;
  v_event record;
  v_event_percent integer := 0;
  v_event_cap integer;
  v_unit integer;
  v_unavailable text := '';
  v_order_status text;
  v_vid uuid;
  v_i integer;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;

  -- idempotency: the same attempt key resolves to the same order (no dupes)
  if v_attempt is not null then
    select * into v_existing from public.orders where attempt_key = v_attempt;
    if found then
      return jsonb_build_object('ok', true, 'order_id', v_existing.id,
        'number', v_existing.number, 'payment_method', v_existing.payment_method,
        'duplicate', true);
    end if;
  end if;

  if v_method not in ('kashier', 'cod') then
    return jsonb_build_object('ok', false, 'reason', 'bad_payment_method');
  end if;

  -- account email is the order email — taken from the profile, never the payload
  select email, coalesce(phone, '') into v_profile from public.profiles where id = v_uid;
  if v_profile.email is null or v_profile.email = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_missing');
  end if;

  -- address validation (AGENT §29: email read-only, alternate required ≠ primary)
  if coalesce(trim(v_addr->>'full_name'), '') = ''
     or coalesce(trim(v_addr->>'address1'), '') = ''
     or coalesce(trim(v_addr->>'phone_primary'), '') = ''
     or coalesce(trim(v_addr->>'phone_alternate'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'address_incomplete');
  end if;
  if (v_addr->>'phone_primary') = (v_addr->>'phone_alternate') then
    return jsonb_build_object('ok', false, 'reason', 'phones_equal');
  end if;
  if (v_addr->>'phone_primary') !~ '^\+201(0|1|2|5)[0-9]{8}$'
     or (v_addr->>'phone_alternate') !~ '^\+201(0|1|2|5)[0-9]{8}$' then
    return jsonb_build_object('ok', false, 'reason', 'phone_invalid');
  end if;

  select a.id, a.governorate_id, a.is_active, a.name_ar, a.name_en,
         g.is_active as gov_active, g.shipping_fee_piastres, g.name_ar as gov_ar, g.name_en as gov_en
    into v_area
    from public.areas a join public.governorates g on g.id = a.governorate_id
    where a.id = (v_addr->>'area_id')::bigint
      and a.governorate_id = (v_addr->>'governorate_id')::smallint;
  if not found or not v_area.is_active or not v_area.gov_active then
    return jsonb_build_object('ok', false, 'reason', 'area_unavailable');
  end if;
  v_shipping := v_area.shipping_fee_piastres;

  -- COD cap from settings (default 5,000 EGP)
  select coalesce((s.value->>'cod_max_total_piastres')::integer, 500000) into v_cod_cap
    from public.settings s where s.key = 'checkout';

  -- lock the cart + the variants (deterministic order avoids deadlocks)
  for r in
    select ci.variant_id, ci.qty, ci.product_id,
           v.stock, v.is_active, v.deleted_at as v_deleted, v.price_piastres,
           v.sale_price_piastres, v.option_key, v.sku, v.image_path,
           p.name_ar, p.name_en, p.status as p_status, p.deleted_at as p_deleted,
           p.shipping_mode, p.is_fragile, p.leaf_category_id, p.brand_id,
           p.vendor_id, p.sale_starts_at, p.sale_ends_at, p.event_hidden
      from public.cart_items ci
      join public.variants v on v.id = ci.variant_id
      join public.products p on p.id = ci.product_id
      where ci.user_id = v_uid
      order by ci.variant_id
        for update of ci, v
  loop
    if r.p_deleted is not null or r.p_status <> 'approved'
       or r.v_deleted is not null or not r.is_active or r.price_piastres is null
       or not public.vendor_can_sell(r.vendor_id)
       or r.event_hidden
       or exists (select 1 from public.v_active_event_vendors aev
                  where aev.vendor_id = r.vendor_id and aev.status = 'refused') then
      v_unavailable := v_unavailable || case when v_unavailable = '' then '' else '، ' end || coalesce(nullif(r.name_ar, ''), r.name_en);
      continue;
    end if;
    if r.stock < r.qty then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_stock',
        'variant_id', r.variant_id, 'stock', r.stock, 'name', r.name_ar);
    end if;

    -- unit price: variant sale (product-level window) then event discount —
    -- identical rules to v_storefront_products
    v_unit := r.price_piastres;
    if r.sale_price_piastres is not null
       and r.sale_starts_at is not null and r.sale_starts_at <= now()
       and (r.sale_ends_at is null or r.sale_ends_at > now()) then
      v_unit := least(r.price_piastres, r.sale_price_piastres);
    end if;
    select d.percent, d.max_discount_piastres into v_event_percent, v_event_cap
      from public.v_active_event_vendors aev
      join public.event_discounts d on d.event_id = aev.event_id
      where aev.vendor_id = r.vendor_id and aev.status = 'accepted'
        and ((d.scope = 'product' and d.ref_id = r.product_id)
          or (d.scope = 'category' and public.fn_category_within(r.leaf_category_id, d.ref_id)))
      order by (d.scope = 'product') desc, d.percent desc
      limit 1;
    if found and v_event_percent > 0 then
      -- max_discount_piastres caps the DISCOUNT, not the resulting price.
      -- (Previously this raised v_unit up to the cap, overcharging the customer
      -- whenever the discount exceeded it; least() also bounds the subtraction
      -- so int4 cannot overflow on ~21.5M+ EGP lines.)
      v_unit := v_unit - least(
        trunc(v_unit * v_event_percent / 100),
        coalesce(v_event_cap, v_unit)
      );
    end if;
    v_event_percent := 0; v_event_cap := null;

    v_rows := v_rows || jsonb_build_object(
      'variant_id', r.variant_id, 'product_id', r.product_id,
      'vendor_id', r.vendor_id, 'leaf_category_id', r.leaf_category_id,
      'brand_id', r.brand_id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'option_key', r.option_key, 'sku', r.sku,
      'image_path', coalesce(nullif(r.image_path, ''),
        (select pm.path from public.product_media pm
          where pm.product_id = r.product_id and pm.kind = 'image'
          order by pm.position limit 1)),
      'unit', v_unit, 'qty', r.qty, 'on_sale', v_unit < r.price_piastres,
      'shipping_mode', r.shipping_mode, 'is_fragile', r.is_fragile);
    v_subtotal := v_subtotal + v_unit * r.qty;
  end loop;

  if jsonb_array_length(v_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;
  if v_unavailable <> '' then
    return jsonb_build_object('ok', false, 'reason', 'items_unavailable', 'names', v_unavailable);
  end if;

  -- vendor groups + vendor-shipped detection
  for x in select distinct (e->>'vendor_id')::uuid as vid,
                  bool_or((e->>'shipping_mode') = 'vendor') as is_vendor_mode
           from jsonb_array_elements(v_rows) e group by 1
  loop
    v_vendor_ids := v_vendor_ids || x.vid;
    if x.is_vendor_mode then v_vendor_mode := true; end if;
  end loop;

  -- coupon (same engine as the cart — server-side recalculation; lines carry
  -- the vendor's live commission rate for commission_percent quoting)
  if v_coupon_code is not null then
    for r in select je as ln from jsonb_array_elements(v_rows) je loop
      select coalesce(
          public.fn_effective_commission((r.ln->>'leaf_category_id')::uuid) * 100,
          (vl.rewards->>'commission_percent')::numeric * 100,
          500
        ) into v_commission_bps
        from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
       where v.id = (r.ln->>'vendor_id')::uuid;
      v_lines := v_lines || jsonb_build_object(
        'product_id', r.ln->>'product_id', 'vendor_id', r.ln->>'vendor_id',
        'leaf_category_id', r.ln->>'leaf_category_id', 'brand_id', r.ln->>'brand_id',
        'unit_price_piastres', (r.ln->>'unit')::integer, 'qty', (r.ln->>'qty')::integer,
        'on_sale', (r.ln->>'on_sale')::boolean,
        'commission_bps', v_commission_bps);
    end loop;
    v_coupon := public.fn_apply_coupon(v_coupon_code, v_lines);
    if not coalesce((v_coupon->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'coupon_' || coalesce(v_coupon->>'reason', 'invalid'));
    end if;
    select * into v_coupon_row from public.coupons c where upper(c.code) = upper(v_coupon_code);
    if (v_coupon->>'type') = 'commission_percent' then
      v_cd_discount := (v_coupon->>'discount_piastres')::integer;
    else
      v_discount := (v_coupon->>'discount_piastres')::integer;
    end if;
    v_free_shipping := coalesce((v_coupon->>'free_shipping')::boolean, false);

    -- companion product coupon (stacking, AGENT §31): product-funded first,
    -- then the commission-funded one on the reduced commission.
    if v_coupon_row.type = 'commission_percent'
       and coalesce(v_coupon_row.pairs_with, '') <> '' then
      declare
        v_pair public.coupons%rowtype;
        v_pair_res jsonb;
      begin
        select * into v_pair from public.coupons c2 where upper(c2.code) = upper(v_coupon_row.pairs_with);
        if v_pair.id is not null and v_pair.status = 'active' and v_pair.stackable
           and v_pair.type in ('percent','fixed') then
          v_pair_res := public.fn_apply_coupon(v_pair.code, v_lines);
          if coalesce((v_pair_res->>'ok')::boolean, false) then
            v_discount := (v_pair_res->>'discount_piastres')::integer;
            if coalesce((v_pair_res->>'free_shipping')::boolean, false) then v_free_shipping := true; end if;
          end if;
        end if;
      end;
    end if;

    -- per-line eligibility for proportional allocation (same rules as the engine)
    v_i := 0;
    for r in select je as ln from jsonb_array_elements(v_lines) je loop
      if public.c_scope_ok(v_coupon_row, r.ln)
         and not (v_coupon_row.exclude_sale_items and (r.ln->>'on_sale')::boolean) then
        v_eligible_subtotal := v_eligible_subtotal + (r.ln->>'unit_price_piastres')::integer * (r.ln->>'qty')::integer;
        v_last_eligible := v_i;
      end if;
      v_i := v_i + 1;
    end loop;
    if v_free_shipping then v_shipping := 0; end if;
  end if;

  -- allocate the PRODUCT coupon across eligible lines proportionally; the
  -- remainder lands on the last eligible line so the sum matches exactly
  v_running := 0;
  v_i := 0;
  if v_discount > 0 and v_eligible_subtotal > 0 then
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_row := v_it.ln;
      v_line_discount := 0;
      declare
        v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
        v_is_eligible boolean;
      begin
        select public.c_scope_ok(v_coupon_row, jsonb_build_object(
                 'vendor_id', v_row->>'vendor_id', 'leaf_category_id', v_row->>'leaf_category_id',
                 'brand_id', v_row->>'brand_id', 'product_id', v_row->>'product_id'))
             and not (v_coupon_row.exclude_sale_items and (v_row->>'on_sale')::boolean)
          into v_is_eligible;
        if v_is_eligible and v_eligible_subtotal > 0 then
          if v_i = v_last_eligible then
            v_line_discount := v_discount - v_running; -- remainder on the last eligible line
          else
            v_line_discount := trunc(v_discount::numeric * v_line_total / v_eligible_subtotal)::integer;
          end if;
        end if;
      end;
      v_rows := jsonb_set(v_rows, array[v_i::text, 'coupon_discount'], to_jsonb(v_line_discount));
      v_running := v_running + v_line_discount;
      v_i := v_i + 1;
    end loop;
  else
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_rows := jsonb_set(v_rows, array[v_i::text, 'coupon_discount'], to_jsonb(0));
      v_i := v_i + 1;
    end loop;
  end if;

  -- VO-22: allocate the COMMISSION-FUNDED discount per line —
  -- line_cd = trunc(coupon% × commission_bps × (line_total − product_discount) / 10000 / 100)
  -- capped so commission never goes negative; remainder lands on the last
  -- commission-eligible (rate > 0) line so the sum matches the engine quote.
  if v_coupon_row.type = 'commission_percent' and v_cd_discount > 0 then
    declare
      v_line_commission integer := 0;
      v_line_cd integer := 0;
      v_cd_running integer := 0;
      v_j integer := 0;
    begin
      -- find the last line with a positive rate (remainder target)
      v_j := 0;
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        select coalesce(
            public.fn_effective_commission((v_it.ln->>'leaf_category_id')::uuid) * 100,
            (vl.rewards->>'commission_percent')::numeric * 100,
            500
          ) into v_commission_bps
          from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
         where v.id = (v_it.ln->>'vendor_id')::uuid;
        v_j := v_j + 1;
      end loop;
      v_j := 0;
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        v_row := v_it.ln;
        select coalesce(
            public.fn_effective_commission((v_row->>'leaf_category_id')::uuid) * 100,
            (vl.rewards->>'commission_percent')::numeric * 100,
            500
          ) into v_commission_bps
          from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
         where v.id = (v_row->>'vendor_id')::uuid;
        v_line_commission := greatest(
          trunc(((v_row->>'unit')::integer * (v_row->>'qty')::integer
                 - coalesce((v_row->>'coupon_discount')::integer, 0))
                * coalesce(v_commission_bps, 0) / 10000.0)::integer, 0);
        v_line_cd := least(trunc(v_line_commission * v_coupon_row.value / 100.0)::integer, v_line_commission);
        if coalesce(v_commission_bps, 0) = 0 then
          v_line_cd := 0; -- zero-commission items produce zero discount
        end if;
        -- the per-line sum IS the order discount (AGENT §31 rounding: per item
        -- to the nearest piastre) — no remainder juggling on top of the quote
        v_rows := jsonb_set(v_rows, array[v_j::text, 'cd_discount'], to_jsonb(v_line_cd));
        v_cd_running := v_cd_running + v_line_cd;
        v_j := v_j + 1;
      end loop;
      v_cd_discount := v_cd_running;
    end;
  else
    declare
      v_j integer := 0;
    begin
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        v_rows := jsonb_set(v_rows, array[v_j::text, 'cd_discount'], to_jsonb(0));
        v_j := v_j + 1;
      end loop;
    end;
  end if;

  v_total := v_subtotal - v_discount - v_cd_discount + v_shipping;

  -- COD rules (US-05/US-06): cap + vendor-shipped — decided here, server-side
  if v_method = 'cod' then
    if v_vendor_mode then
      return jsonb_build_object('ok', false, 'reason', 'cod_vendor_ship');
    end if;
    if v_total > v_cod_cap then
      return jsonb_build_object('ok', false, 'reason', 'cod_cap', 'cap_piastres', v_cod_cap);
    end if;
  end if;

  -- shipment number ETS-YY-### — one per order, assigned exactly once
  v_yy := (extract(year from now())::integer % 100)::smallint;
  insert into public.order_sequences (year, last_seq) values (v_yy, 0)
    on conflict (year) do nothing;
  update public.order_sequences set last_seq = last_seq + 1
    where year = v_yy returning last_seq into v_seq;
  v_number := 'ETS-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 3, '0');

  v_order_status := case when v_method = 'cod' then 'processing'::text
                         when v_vendor_mode then 'on_hold'
                         else 'pending_payment' end;

  insert into public.orders (number, attempt_key, user_id, email,
      phone_primary, phone_alternate, ship_name, governorate_id, area_id,
      address1, address2, postal_code, status, payment_method, payment_status,
      subtotal_piastres, discount_piastres, shipping_fee_piastres, total_piastres,
      coupon_id, coupon_code,
      -- L-20 delivery pin (optional; Egypt-bounds CHECKs guard values;
      -- coordinates are ADMIN/CARRIER-only — vendor snapshots never select them)
      shipping_lat, shipping_lng, shipping_geo_accuracy_m)
  values (v_number, v_attempt, v_uid, v_profile.email,
      v_addr->>'phone_primary', v_addr->>'phone_alternate', v_addr->>'full_name',
      (v_addr->>'governorate_id')::smallint, (v_addr->>'area_id')::bigint,
      v_addr->>'address1', nullif(trim(coalesce(v_addr->>'address2', '')), ''),
      nullif(trim(coalesce(v_addr->>'postal_code', '')), ''),
      -- pin (only when both coordinates are numeric and inside Egypt)
      v_order_status, v_method,
      case when v_method = 'cod' then 'cod_pending' else 'unpaid' end,
      v_subtotal, v_discount + v_cd_discount, v_shipping, v_total,
      case when v_coupon_row.id is not null then v_coupon_row.id end,
      trim(coalesce(v_coupon_code, '')
        || case when v_coupon_row.type = 'commission_percent'
                and coalesce(v_coupon_row.pairs_with, '') <> '' then '+' || v_coupon_row.pairs_with else '' end),
      -- L-20 delivery pin (optional; Egypt-bounds CHECKs guard the values;
      -- coordinates are ADMIN/CARRIER-only — vendor snapshots never select them)
      case when jsonb_typeof(v_addr->'lat') = 'number'
           and jsonb_typeof(v_addr->'lng') = 'number'
           and (v_addr->>'lat')::double precision between 21.0 and 31.8
           and (v_addr->>'lng')::double precision between 24.0 and 37.0
          then (v_addr->>'lat')::double precision end,
      case when jsonb_typeof(v_addr->'lat') = 'number'
           and jsonb_typeof(v_addr->'lng') = 'number'
           and (v_addr->>'lat')::double precision between 21.0 and 31.8
           and (v_addr->>'lng')::double precision between 24.0 and 37.0
          then (v_addr->>'lng')::double precision end,
      case when jsonb_typeof(v_addr->'geo_accuracy') = 'number'
           and (v_addr->>'geo_accuracy')::int between 1 and 5000
          then (v_addr->>'geo_accuracy')::int end)
  returning id into v_order_id;

  -- one group per vendor; commission from the vendor's level rewards (bps)
  foreach v_vid in array v_vendor_ids loop
    v_group_subtotal := 0; v_group_discount := 0; v_group_commission := 0;
    select coalesce((vl.rewards->>'commission_percent')::numeric, 5) into v_rate
      from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
      where v.id = v_vid;
    v_commission_bps := round(coalesce(v_rate, 5) * 100)::integer;

    insert into public.order_vendor_groups (order_id, vendor_id, status,
        shipping_mode, vendor_ship_status)
    values (v_order_id, v_vid,
        case when v_method = 'cod' then 'preparing' else 'pending' end,
        case when exists (
          select 1 from jsonb_array_elements(v_rows) e
          where (e->>'vendor_id')::uuid = v_vid and (e->>'shipping_mode') = 'vendor'
        ) then 'vendor' else 'platform' end,
        case when exists (
          select 1 from jsonb_array_elements(v_rows) e
          where (e->>'vendor_id')::uuid = v_vid and (e->>'shipping_mode') = 'vendor'
        ) then 'pending_admin' else 'not_required' end)
    returning id into v_group_id;

    for v_it in select je as ln from jsonb_array_elements(v_rows) je where (je->>'vendor_id')::uuid = v_vid loop
      v_row := v_it.ln;
      declare
        v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
        v_line_discount integer := coalesce((v_row->>'coupon_discount')::integer, 0);
        v_line_cd integer := coalesce((v_row->>'cd_discount')::integer, 0);
        -- commission on the price after the PRODUCT discount; the
        -- commission-funded coupon eats FROM that commission (vendor keeps
        -- the full net line — VO-22)
        -- H-08: the LEAF's effective percent (its own row, else the nearest
        -- ancestor override) beats the vendor level default for THIS line
        v_line_bps integer := coalesce(
          (select round(public.fn_effective_commission((v_row->>'leaf_category_id')::uuid) * 100)::integer),
          v_commission_bps,
          500
        );
        v_commission integer := greatest(
          trunc((v_line_total - v_line_discount) * v_line_bps / 10000)::integer
            - v_line_cd, 0);
      begin
        insert into public.order_items (order_id, group_id, vendor_id, variant_id,
            product_id, leaf_category_id, product_name_ar, product_name_en,
            option_key, sku, image_path, unit_price_piastres, qty,
            line_total_piastres, coupon_discount_piastres, commission_piastres,
            commission_rate_bps, is_fragile)
        values (v_order_id, v_group_id, v_vid, (v_row->>'variant_id')::uuid,
            (v_row->>'product_id')::uuid, (v_row->>'leaf_category_id')::uuid,
            coalesce(v_row->>'name_ar', ''), coalesce(v_row->>'name_en', ''),
            coalesce(v_row->>'option_key', ''), v_row->>'sku', v_row->>'image_path',
            (v_row->>'unit')::integer, (v_row->>'qty')::integer,
            v_line_total, v_line_discount + v_line_cd, v_commission, v_line_bps,
            coalesce((v_row->>'is_fragile')::boolean, false));

        v_group_subtotal := v_group_subtotal + v_line_total;
        v_group_discount := v_group_discount + v_line_discount + v_line_cd;
        v_group_commission := v_group_commission + v_commission;

        -- stock decrement (variant rows are locked above)
        update public.variants set stock = stock - (v_row->>'qty')::integer
          where id = (v_row->>'variant_id')::uuid;
      end;
    end loop;

    update public.order_vendor_groups
      set items_subtotal_piastres = v_group_subtotal,
          discount_piastres = v_group_discount,
          commission_piastres = v_group_commission
      where id = v_group_id;
  end loop;

  -- coupon redemption (counts toward max_uses inside the transaction)
  if v_coupon_row.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id)
    values (v_coupon_row.id, v_uid, v_order_id);
  end if;

  -- purchased lines leave the cart
  delete from public.cart_items where user_id = v_uid;

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order_id, v_order_status, 'order_created', v_uid);

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'number', v_number,
    'payment_method', v_method, 'status', v_order_status);
exception
  when others then
    -- transaction rolls back automatically; surface the real cause
    return jsonb_build_object('ok', false, 'reason', 'server_error',
      'detail', sqlerrm);
end $function$;

-- vendor commission override: the deepest override on the product's path wins
create or replace function public.fn_vendor_effective_commission(p_vendor_id uuid, p_category_id uuid default null::uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case v.commission_mode
    when 'fixed' then coalesce(v.commission_fixed_percent, 0)
    when 'category' then coalesce(
      (select o.percent from public.vendor_commission_overrides o
         join public.categories oc on oc.id = o.category_id
        where o.vendor_id = v.id
          and public.fn_category_within(coalesce(p_category_id, v.category_ids[1]), o.category_id)
        order by oc.depth desc
        limit 1),
      (select coalesce((lvl.rewards->>'commission_percent')::numeric, 5)
         from public.vendor_levels lvl where lvl.id = v.level_id))
    else coalesce((lvl.rewards->>'commission_percent')::numeric, 5)
  end
  from public.vendors v left join public.vendor_levels lvl on lvl.id = v.level_id
  where v.id = p_vendor_id;
$function$;

create or replace view public.v_storefront_products as
 SELECT p.id,
    p.slug_ar,
    p.slug_en,
    p.name_ar,
    p.name_en,
    p.short_ar,
    p.short_en,
    p.leaf_category_id,
    cat.name_ar AS category_name_ar,
    cat.name_en AS category_name_en,
    cat.slug_ar AS category_slug_ar,
    cat.slug_en AS category_slug_en,
    p.brand_id,
    b.name_ar AS brand_name_ar,
    b.name_en AS brand_name_en,
    p.vendor_id,
    v.slug AS vendor_slug,
    v.store_name_ar,
    v.store_name_en,
    v.logo_path AS vendor_logo_path,
    lvl.name_ar AS level_name_ar,
    lvl.name_en AS level_name_en,
    lvl.icon AS level_icon,
    img.path AS main_image_path,
    pr.min_price_piastres,
    pr.min_sale_price_piastres,
    pr.has_sale,
    GREATEST(COALESCE(evp.percent, 0), COALESCE(evc.percent, 0)) AS event_percent,
        CASE
            WHEN COALESCE(evp.percent, 0) >= COALESCE(evc.percent, 0) THEN evp.max_piastres
            ELSE evc.max_piastres
        END AS event_max_piastres,
    st.stock_total,
    r.rating_avg,
    r.rating_count,
    p.featured_permanent OR p.featured_until IS NOT NULL AND p.featured_until > now() AS is_featured,
    p.event_hidden AS is_event_hidden,
    (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE aev.vendor_id = v.id AND aev.status = 'refused'::text)) AS vendor_event_refused,
    NOT p.event_hidden AND NOT (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE aev.vendor_id = v.id AND aev.status = 'refused'::text)) AS is_listable,
    p.published_at,
    p.created_at
   FROM products p
     JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN categories cat ON cat.id = p.leaf_category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN vendor_levels lvl ON lvl.id = v.level_id
     LEFT JOIN LATERAL ( SELECT pm.path
           FROM product_media pm
          WHERE pm.product_id = p.id AND pm.kind = 'image'::text
          ORDER BY pm."position"
         LIMIT 1) img ON true
     LEFT JOIN LATERAL ( SELECT min(
                CASE
                    WHEN p.sale_starts_at IS NOT NULL AND p.sale_starts_at <= now() AND (p.sale_ends_at IS NULL OR p.sale_ends_at > now()) AND v2.sale_price_piastres IS NOT NULL THEN LEAST(v2.price_piastres, v2.sale_price_piastres)
                    ELSE v2.price_piastres
                END) AS min_price_piastres,
            min(
                CASE
                    WHEN p.sale_starts_at IS NOT NULL AND p.sale_starts_at <= now() AND (p.sale_ends_at IS NULL OR p.sale_ends_at > now()) AND v2.sale_price_piastres IS NOT NULL THEN v2.sale_price_piastres
                    ELSE NULL::integer
                END) AS min_sale_price_piastres,
            bool_or(p.sale_starts_at IS NOT NULL AND p.sale_starts_at <= now() AND (p.sale_ends_at IS NULL OR p.sale_ends_at > now()) AND v2.sale_price_piastres IS NOT NULL) AS has_sale,
            min(v2.price_piastres) AS min_regular_piastres
           FROM variants v2
          WHERE v2.product_id = p.id AND v2.deleted_at IS NULL AND v2.is_active AND v2.price_piastres IS NOT NULL) pr ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(v3.stock), 0::bigint) AS stock_total
           FROM variants v3
          WHERE v3.product_id = p.id AND v3.deleted_at IS NULL AND v3.is_active) st ON true
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            count(*)::integer AS rating_count
           FROM reviews rw
          WHERE rw.product_id = p.id AND rw.status = 'published'::text) r ON true
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM v_active_event_vendors aev
             JOIN event_discounts d ON d.event_id = aev.event_id
          WHERE aev.vendor_id = p.vendor_id AND aev.status = 'accepted'::text AND d.scope = 'product'::text AND d.ref_id = p.id
          ORDER BY d.percent DESC
         LIMIT 1) evp ON true
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM v_active_event_vendors aev
             JOIN event_discounts d ON d.event_id = aev.event_id
          WHERE aev.vendor_id = p.vendor_id AND aev.status = 'accepted'::text AND d.scope = 'category'::text AND fn_category_within(p.leaf_category_id, d.ref_id)
          ORDER BY d.percent DESC
         LIMIT 1) evc ON true
  WHERE p.status = 'approved'::text AND p.deleted_at IS NULL AND v.status = 'active'::text AND v.verification_status <> 'grace_expired'::text AND NOT v.hidden_from_listings;

-- 5) facets ----------------------------------------------------------------------
create or replace view public.v_storefront_facet_defs as
( SELECT DISTINCT ON (d.id) d.id AS attribute_id,
    d.code,
    d.type,
    d.unit,
    d.sort,
    COALESCE(d.label_ar, d.code) AS label_ar,
    COALESCE(d.label_en, d.code) AS label_en,
    d.category_id AS leaf_category_id
   FROM attribute_defs d
     JOIN categories leaf ON leaf.id = d.category_id AND leaf.is_active AND leaf.deleted_at IS NULL
  WHERE d.is_filterable AND ((EXISTS ( SELECT 1
           FROM category_attributes ca
          WHERE ca.attribute_id = d.id AND ca.category_id = d.category_id)) OR NOT (EXISTS ( SELECT 1
           FROM category_attributes ca
          WHERE ca.category_id = d.category_id))))
union all
(SELECT DISTINCT ON (d.id, ca.category_id) d.id AS attribute_id,
    d.code,
    d.type,
    d.unit,
    d.sort,
    COALESCE(d.label_ar, d.code) AS label_ar,
    COALESCE(d.label_en, d.code) AS label_en,
    ca.category_id AS leaf_category_id
   FROM category_attributes ca
     JOIN attribute_defs d ON d.id = ca.attribute_id AND d.category_id IS NULL AND d.deleted_at IS NULL
     JOIN categories leaf ON leaf.id = ca.category_id AND leaf.is_active AND leaf.deleted_at IS NULL
  WHERE d.is_filterable);

create or replace view public.v_storefront_facet_options as
 SELECT o.id AS option_id,
    o.attribute_id,
    o.label_ar,
    o.label_en,
    o.color_hex,
    o.sort
   FROM attribute_options o
     JOIN attribute_defs d ON d.id = o.attribute_id
     LEFT JOIN categories leaf ON leaf.id = d.category_id
  WHERE d.is_filterable AND o.deleted_at IS NULL AND d.deleted_at IS NULL
    AND (d.category_id IS NULL OR (leaf.is_active AND leaf.deleted_at IS NULL));

-- distinct filterable attributes effective anywhere in a category subtree
create or replace function public.fn_storefront_facet_defs(p_category uuid)
returns table (attribute_id uuid, code text, type text, unit text, sort integer, label_ar text, label_en text)
language sql stable set search_path = 'public' as $$
  select distinct on (fd.attribute_id)
         fd.attribute_id, fd.code, fd.type, fd.unit, fd.sort, fd.label_ar, fd.label_en
    from public.v_storefront_facet_defs fd
   where public.fn_category_within(fd.leaf_category_id, p_category)
   order by fd.attribute_id;
$$;
revoke all on function public.fn_storefront_facet_defs(uuid) from public;
grant execute on function public.fn_storefront_facet_defs(uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_search_products(p_q text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_brand uuid DEFAULT NULL::uuid, p_attrs jsonb DEFAULT NULL::jsonb, p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_rating numeric DEFAULT NULL::numeric, p_in_stock boolean DEFAULT NULL::boolean, p_sort text DEFAULT 'newest'::text, p_page integer DEFAULT 1, p_per_page integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q text;
  v_norm text;
  v_cat_path text;
  v_total integer := 0;
  v_where_core text;
  v_items jsonb;
  v_facet_brands jsonb;
  v_facet_categories jsonb;
  v_facet_attrs jsonb;
  v_where text;
  v_cat_cond text := '';
  v_brand_cond text := '';
  v_price_cond text := '';
  v_rating_cond text := '';
  v_stock_cond text := '';
  v_attr_cond text := '';
  v_price_expr text := 'coalesce(case when has_sale then min_sale_price_piastres end, min_price_piastres)';
  v_event_price_expr text := 'case when event_percent > 0 then least('
    || v_price_expr || ' - (' || v_price_expr || ' * event_percent / 100),'
    || ' coalesce(event_max_piastres, 9223372036854775807)) else '
    || v_price_expr || ' end';
  v_attrs jsonb := coalesce(p_attrs, '[]'::jsonb);
  v_attr_elem jsonb;
  v_off integer := greatest(coalesce(p_page, 1) - 1, 0) * least(coalesce(p_per_page, 24), 60);
  v_limit integer := least(coalesce(p_per_page, 24), 60);
  v_order text;
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) > 80 then
    v_q := left(v_q, 80);
  end if;
  v_norm := public.ar_norm(v_q);

  if p_category is not null then
    select path into v_cat_path from public.categories where id = p_category;
    if v_cat_path is null then
      return jsonb_build_object('total', 0, 'page', greatest(coalesce(p_page,1),1), 'per_page', v_limit,
        'items', '[]'::jsonb, 'facets', jsonb_build_object());
    end if;
  end if;

  v_where_core := ' min_price_piastres is not null and is_listable';
  v_where := v_where_core;

  if v_q <> '' then
    v_where := v_where || format(' and (
      public.fn_tsv_match(id, %L)
      or public.ar_norm(name_ar) like %L
      or name_en ilike %L
      or name_ar %% %L
      or name_en %% %L
    )', v_q, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q);
  end if;
  if p_category is not null then
    v_cat_cond := format(
      ' (leaf_category_id = %L::uuid or exists (
         select 1 from public.categories sc
         where sc.id = leaf_category_id and sc.path like %L))',
      p_category::text, v_cat_path || '/%');
    v_where := v_where || ' and' || v_cat_cond;
  end if;
  if p_brand is not null then
    v_brand_cond := format(' and brand_id = %L::uuid', p_brand::text);
    v_where := v_where || v_brand_cond;
  end if;
  if p_price_min is not null or p_price_max is not null then
    if p_price_min is not null then
      v_price_cond := v_price_cond || format(' %s >= %s', v_price_expr, p_price_min::text);
    end if;
    if p_price_max is not null then
      v_price_cond := v_price_cond || (case when v_price_cond <> '' then ' and' else '' end)
        || format(' %s <= %s', v_price_expr, p_price_max::text);
    end if;
    v_where := v_where || ' and' || v_price_cond;
  end if;
  if p_rating is not null and p_rating >= 1 then
    v_rating_cond := format(' (rating_avg >= %s and rating_count > 0)', p_rating::text);
    v_where := v_where || ' and' || v_rating_cond;
  end if;
  if coalesce(p_in_stock, false) then
    v_stock_cond := ' stock_total > 0';
    v_where := v_where || ' and' || v_stock_cond;
  end if;

  -- attribute facet conditions: every selected attribute must have ≥1 match
  for v_attr_elem in select * from jsonb_array_elements(v_attrs) loop
    if jsonb_typeof(v_attr_elem->'option_ids') = 'array'
       and jsonb_array_length(v_attr_elem->'option_ids') > 0 then
      v_attr_cond := v_attr_cond || format(
        ' exists (select 1 from public.product_facets pf
           where pf.product_id = id and pf.attribute_id = %L::uuid
             and pf.option_id::text = any(array(select jsonb_array_elements_text(%L))))',
        v_attr_elem->>'attribute_id', v_attr_elem->'option_ids');
    end if;
  end loop;
  if v_attr_cond <> '' then
    v_attr_cond := ' and' || v_attr_cond;
    v_where := v_where || v_attr_cond;
  end if;

  execute 'select count(*) from public.v_storefront_products where' || v_where into v_total;

  v_order := case p_sort
    when 'price_asc'  then v_event_price_expr || ' asc nulls last, published_at desc'
    when 'price_desc' then v_event_price_expr || ' desc nulls last, published_at desc'
    when 'rating'     then 'rating_count desc, rating_avg desc nulls last, published_at desc'
    else 'is_featured desc, published_at desc nulls last'
  end;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*) order by %s), '[]'::jsonb)
    from (
      select vp.*, %s as event_price_piastres
      from public.v_storefront_products vp
      where%s
      offset %s limit %s
    ) t
  $f$, v_order, v_event_price_expr, v_where, v_off::text, v_limit::text)
    into v_items;

  -- ---- facets -------------------------------------------------------------
  -- brands: base minus the brand filter
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select brand_id as id, brand_name_ar as name_ar, brand_name_en as name_en, count(*)::int as count
      from public.v_storefront_products
      where%s
      group by brand_id, brand_name_ar, brand_name_en
      having brand_id is not null
    ) f
  $f$, v_where_core || v_attr_cond)
    into v_facet_brands;

  -- categories: children of the current node (or level-1 roots), unfiltered
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select sc.id, sc.name_ar as name_ar, sc.name_en as name_en, sc.slug_ar, sc.slug_en,
             count(vp.id)::int as count
      from (%s) sc
      left join public.v_storefront_products vp
        on vp.min_price_piastres is not null and vp.is_listable
       and (vp.leaf_category_id = sc.id
            or exists (select 1 from public.categories dsc
                       where dsc.id = vp.leaf_category_id and dsc.path like sc.path || '/%%'))
      group by sc.id, sc.name_ar, sc.name_en, sc.slug_ar, sc.slug_en
    ) f
  $f$,
    case when p_category is null
      then 'select * from public.v_storefront_categories where depth = 1'
      else format('select * from public.categories c where c.is_active and c.deleted_at is null and c.parent_id = %L::uuid', p_category::text)
    end
  ) into v_facet_categories;

  -- attribute options: defs effective for the scope; counts on the base
  -- minus ALL attribute filters (stable counts while multi-selecting)
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.attribute_sort, f.option_sort), '[]'::jsonb)
    from (
      select distinct fd.attribute_id, fd.code, fd.label_ar, fd.label_en, fd.type, fd.unit, fd.sort as attribute_sort,
             fo.option_id, fo.label_ar as option_label_ar, fo.label_en as option_label_en,
             fo.color_hex, fo.sort as option_sort, coalesce(fc.count, 0)::int as count
      from public.v_storefront_facet_defs fd
      join public.v_storefront_facet_options fo on fo.attribute_id = fd.attribute_id
      left join (
        select pf.attribute_id, pf.option_id, count(*)::int as count
        from public.product_facets pf
        where exists (
          select 1 from public.v_storefront_products vp2
          where vp2.id = pf.product_id and (%s)
        )
        group by pf.attribute_id, pf.option_id
      ) fc on fc.attribute_id = fd.attribute_id and fc.option_id = fo.option_id
      where %s
    ) f
  $f$,
    v_where_core || v_brand_cond,
    case when p_category is null then 'true' else
      format('(fd.leaf_category_id = %L::uuid or exists (
        select 1 from public.categories sc2
        where sc2.id = fd.leaf_category_id and sc2.path like %L))',
        p_category::text, v_cat_path || '/%')
    end
  ) into v_facet_attrs;

  return jsonb_build_object(
    'total', v_total,
    'page', greatest(coalesce(p_page, 1), 1),
    'per_page', v_limit,
    'items', coalesce(v_items, '[]'::jsonb),
    'facets', jsonb_build_object(
      'brands', coalesce(v_facet_brands, '[]'::jsonb),
      'categories', coalesce(v_facet_categories, '[]'::jsonb),
      'attributes', coalesce(v_facet_attrs, '[]'::jsonb)
    )
  );
end $function$;

-- 6) areas ------------------------------------------------------------------------
create unique index if not exists areas_governorate_name_ar_unique
  on public.areas (governorate_id, name_ar);

commit;
