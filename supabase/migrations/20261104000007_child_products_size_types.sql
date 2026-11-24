-- ============================================================================
-- Child products (variant groups) + size types
--
-- A product now has CHILD PRODUCTS (variant_groups). Each child has its own
-- colour, price, discounted price, discount window and images. Under a child,
-- every selected size is one sellable row in `variants` with its own stock
-- and an auto-generated SKU (stock is per size). Cart, orders, stock and
-- refunds keep working on `variants` unchanged; a variant now carries its
-- child's discount window, which cart/checkout/storefront read first.
--
-- Sizes are grouped into SIZE TYPES (clothing, shoes, bedding…) and a type is
-- offered only in the categories it is assigned to (or their descendants).
-- ============================================================================
begin;

-- ── child products ──────────────────────────────────────────────────────────
create table if not exists public.variant_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  color_option_id uuid references public.attribute_options(id) on delete restrict,
  price_piastres integer,
  sale_price_piastres integer,
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  sort integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variant_groups_price_check check (price_piastres is null or price_piastres > 0),
  constraint variant_groups_sale_check check (sale_price_piastres is null or sale_price_piastres > 0),
  constraint variant_groups_window_check check (sale_ends_at is null or sale_starts_at is null or sale_ends_at > sale_starts_at)
);
create index if not exists variant_groups_product_idx on public.variant_groups (product_id) where deleted_at is null;

create table if not exists public.variant_group_media (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.variant_groups(id) on delete cascade,
  path text not null,
  position smallint not null default 0
);
create index if not exists variant_group_media_group_idx on public.variant_group_media (group_id, position);

alter table public.variants
  add column if not exists group_id uuid references public.variant_groups(id) on delete set null,
  add column if not exists size_option_id uuid references public.attribute_options(id) on delete restrict,
  add column if not exists sale_starts_at timestamptz,
  add column if not exists sale_ends_at timestamptz;
create index if not exists variants_group_idx on public.variants (group_id);

drop trigger if exists variant_groups_touch on public.variant_groups;
create trigger variant_groups_touch before update on public.variant_groups
  for each row execute function public.touch_updated_at();

-- read like variants; writes only through fn_save_children
grant select on public.variant_groups, public.variant_group_media to anon, authenticated;
alter table public.variant_groups enable row level security;
alter table public.variant_group_media enable row level security;
drop policy if exists variant_groups_read on public.variant_groups;
create policy variant_groups_read on public.variant_groups for select to anon, authenticated
  using ((deleted_at is null and public.product_is_public(product_id)) or public.product_owned_or_admin(product_id));
drop policy if exists variant_group_media_read on public.variant_group_media;
create policy variant_group_media_read on public.variant_group_media for select to anon, authenticated
  using (exists (select 1 from public.variant_groups g where g.id = group_id
                 and ((g.deleted_at is null and public.product_is_public(g.product_id)) or public.product_owned_or_admin(g.product_id))));

-- ── size types ──────────────────────────────────────────────────────────────
create table if not exists public.size_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.size_type_categories (
  size_type_id uuid not null references public.size_types(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (size_type_id, category_id)
);
alter table public.attribute_options
  add column if not exists size_type_id uuid references public.size_types(id) on delete set null;

grant select on public.size_types, public.size_type_categories to anon, authenticated;
grant insert, update, delete on public.size_types, public.size_type_categories to authenticated;
alter table public.size_types enable row level security;
alter table public.size_type_categories enable row level security;
drop policy if exists size_types_read on public.size_types;
create policy size_types_read on public.size_types for select to anon, authenticated using (true);
drop policy if exists size_types_admin on public.size_types;
create policy size_types_admin on public.size_types for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists size_type_categories_read on public.size_type_categories;
create policy size_type_categories_read on public.size_type_categories for select to anon, authenticated using (true);
drop policy if exists size_type_categories_admin on public.size_type_categories;
create policy size_type_categories_admin on public.size_type_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.size_types (code, name_ar, name_en, sort) values
  ('clothing', 'مقاسات الملابس', 'Clothing sizes', 10),
  ('shoes', 'مقاسات الأحذية', 'Shoe sizes', 20),
  ('bedding', 'مقاسات المفروشات', 'Bedding sizes', 30)
on conflict (code) do nothing;

update public.attribute_options o set size_type_id = st.id
from public.size_types st, public.attribute_defs d
where d.id = o.attribute_id and d.code = 'size' and o.size_type_id is null
  and st.code = case
    when o.code like 'eu\_%' then 'shoes'
    when o.code like 'bed\_%' then 'bedding'
    else 'clothing' end;

-- default assignments: shoes → every category named "…Shoes…"; bedding →
-- "Bedding"; clothing → the fashion branches that are not shoe branches
insert into public.size_type_categories (size_type_id, category_id)
select st.id, c.id from public.size_types st, public.categories c
where st.code = 'shoes' and c.deleted_at is null and c.depth <= 3 and c.name_en ilike '%shoe%'
on conflict do nothing;
insert into public.size_type_categories (size_type_id, category_id)
select st.id, c.id from public.size_types st, public.categories c
where st.code = 'bedding' and c.deleted_at is null and c.depth <= 3 and c.name_en ilike 'bedding%'
on conflict do nothing;
insert into public.size_type_categories (size_type_id, category_id)
select st.id, c.id from public.size_types st, public.categories c
where st.code = 'clothing' and c.deleted_at is null and c.depth = 2
  and c.name_en in ('Men''s Fashion', 'Women''s Fashion', 'Kids & Baby Fashion', 'Sportswear & Shoes & Accessories')
on conflict do nothing;

/** Size options offered for a leaf: types assigned to the leaf or any ancestor. */
create or replace function public.fn_size_options_for(p_leaf uuid)
returns table (option_id uuid, code text, label_ar text, label_en text, size_type_id uuid, type_name_ar text, type_name_en text, sort integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select o.id, o.code, o.label_ar, o.label_en, st.id, st.name_ar, st.name_en, o.sort
  from public.attribute_options o
  join public.size_types st on st.id = o.size_type_id
  where o.deleted_at is null
    and exists (
      select 1 from public.size_type_categories sc
      where sc.size_type_id = st.id and public.fn_category_within(p_leaf, sc.category_id))
  order by st.sort, o.sort;
$function$;
grant execute on function public.fn_size_options_for(uuid) to anon, authenticated;

-- ── existing rows → one child per colour (or one plain child) ───────────────
do $$
declare r record; v_group uuid; v_color_attr uuid; v_size_attr uuid;
begin
  select id into v_color_attr from public.attribute_defs where code = 'color' and deleted_at is null limit 1;
  select id into v_size_attr from public.attribute_defs where code = 'size' and deleted_at is null limit 1;
  for r in
    select v.product_id,
           (select o.id from public.attribute_options o where o.id = any(v.option_ids) and o.attribute_id = v_color_attr limit 1) as color_id,
           min(v.price_piastres) as price, min(v.sale_price_piastres) as sale,
           min(p.sale_starts_at) as s0, min(p.sale_ends_at) as s1
    from public.variants v join public.products p on p.id = v.product_id
    where v.group_id is null and v.deleted_at is null
    group by v.product_id, 2
  loop
    insert into public.variant_groups (product_id, color_option_id, price_piastres, sale_price_piastres, sale_starts_at, sale_ends_at)
    values (r.product_id, r.color_id, r.price, r.sale, r.s0, r.s1) returning id into v_group;
    update public.variants v set
      group_id = v_group,
      size_option_id = (select o.id from public.attribute_options o where o.id = any(v.option_ids) and o.attribute_id = v_size_attr limit 1),
      sale_starts_at = r.s0, sale_ends_at = r.s1
    where v.product_id = r.product_id and v.group_id is null and v.deleted_at is null
      and (select o.id from public.attribute_options o where o.id = any(v.option_ids) and o.attribute_id = v_color_attr limit 1)
          is not distinct from r.color_id;
    insert into public.variant_group_media (group_id, path, position)
    select v_group, x.path, row_number() over () - 1
    from (select distinct v.image_path as path from public.variants v
          where v.group_id = v_group and v.image_path is not null) x;
  end loop;
end $$;

-- ── seller save: the whole child list of one product ────────────────────────
/**
 * p_children = [{ id?, color_option_id?, price_piastres?, sale_price_piastres?,
 *                 sale_starts_at?, sale_ends_at?, images: [path…],
 *                 sizes: [{ size_option_id?, stock }] }]
 * Lenient for drafts (price may be empty); fn_submit_product enforces
 * completeness. Children/sizes missing from the list are soft-deleted (order
 * history keeps its variant rows). Returns the saved list with ids and SKUs.
 */
create or replace function public.fn_save_children(p_product_id uuid, p_children jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  c jsonb; s jsonb; img text;
  v_group uuid; v_variant uuid;
  v_keep_groups uuid[] := '{}'; v_keep_variants uuid[] := '{}';
  v_keys text[] := '{}';
  v_key text; v_ids uuid[]; v_sku text; v_color_code text; v_size_code text; v_i integer;
  v_price integer; v_sale integer; v_s0 timestamptz; v_s1 timestamptz;
  v_prefix text;
begin
  if v_user is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.* into v_product from public.products p join public.vendors v on v.id = p.vendor_id
   where p.id = p_product_id and v.owner_id = v_user;
  if v_product.id is null then raise exception 'not allowed: product not found' using errcode = '42501'; end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is locked in status %', v_product.status;
  end if;
  v_prefix := 'ET-' || upper(substr(replace(p_product_id::text, '-', ''), 1, 6));

  for c in select * from jsonb_array_elements(coalesce(p_children, '[]'::jsonb)) loop
    v_price := nullif(c->>'price_piastres', '')::integer;
    v_sale := nullif(c->>'sale_price_piastres', '')::integer;
    if v_price is not null and v_price <= 0 then raise exception 'price must be positive'; end if;
    if v_sale is not null and (v_price is null or v_sale >= v_price) then
      raise exception 'sale price must be lower than the price';
    end if;
    v_s0 := nullif(c->>'sale_starts_at', '')::timestamptz;
    v_s1 := nullif(c->>'sale_ends_at', '')::timestamptz;
    -- a discount with no start date starts now
    if v_sale is not null and v_s0 is null then v_s0 := now(); end if;
    if v_sale is null then v_s0 := null; v_s1 := null; end if;
    if v_s0 is not null and v_s1 is not null and v_s1 <= v_s0 then
      raise exception 'sale schedule end must be after the start';
    end if;

    v_group := nullif(c->>'id', '')::uuid;
    if v_group is not null and not exists (select 1 from public.variant_groups where id = v_group and product_id = p_product_id) then
      v_group := null;
    end if;
    if v_group is null then
      insert into public.variant_groups (product_id) values (p_product_id) returning id into v_group;
    end if;
    update public.variant_groups set
      color_option_id = nullif(c->>'color_option_id', '')::uuid,
      price_piastres = v_price, sale_price_piastres = v_sale,
      sale_starts_at = v_s0, sale_ends_at = v_s1,
      sort = coalesce(array_length(v_keep_groups, 1), 0), deleted_at = null
    where id = v_group;
    v_keep_groups := v_keep_groups || v_group;

    delete from public.variant_group_media where group_id = v_group;
    v_i := 0;
    for img in select jsonb_array_elements_text(coalesce(c->'images', '[]'::jsonb)) loop
      insert into public.variant_group_media (group_id, path, position) values (v_group, img, v_i);
      v_i := v_i + 1;
      exit when v_i >= 12;
    end loop;

    select coalesce(upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g')), '')
      into v_color_code from public.attribute_options o where o.id = nullif(c->>'color_option_id', '')::uuid;

    for s in select * from jsonb_array_elements(case when jsonb_array_length(coalesce(c->'sizes', '[]'::jsonb)) = 0
                                                    then '[{}]'::jsonb else c->'sizes' end) loop
      v_ids := array_remove(array[nullif(c->>'color_option_id', '')::uuid, nullif(s->>'size_option_id', '')::uuid], null);
      select coalesce(string_agg(x::text, ',' order by x::text), '') into v_key from unnest(v_ids) x;
      if v_key = any(v_keys) then
        raise exception 'duplicate colour/size combination';
      end if;
      v_keys := v_keys || v_key;
      if coalesce((s->>'stock')::integer, 0) < 0 then raise exception 'stock cannot be negative'; end if;

      select upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g'))
        into v_size_code from public.attribute_options o where o.id = nullif(s->>'size_option_id', '')::uuid;
      v_sku := v_prefix || coalesce('-' || nullif(left(v_color_code, 6), ''), '') || coalesce('-' || nullif(left(v_size_code, 6), ''), '');

      -- reuse the live row for this combination (keeps cart/order references)
      select id into v_variant from public.variants
       where product_id = p_product_id and option_key = v_key and deleted_at is null;
      if v_variant is null then
        -- a tombstoned row for the same combination is revived instead of duplicated
        select id into v_variant from public.variants
         where product_id = p_product_id and option_key = v_key order by updated_at desc limit 1;
      end if;
      if v_variant is null then
        insert into public.variants (product_id, option_key, option_ids) values (p_product_id, v_key, v_ids)
        returning id into v_variant;
      end if;
      -- SKU must stay unique store-wide; suffix if another product took it
      if exists (select 1 from public.variants where sku = v_sku and deleted_at is null and id <> v_variant) then
        v_sku := v_sku || '-' || upper(substr(replace(v_variant::text, '-', ''), 1, 4));
      end if;
      update public.variants set
        group_id = v_group, option_key = v_key, option_ids = v_ids,
        size_option_id = nullif(s->>'size_option_id', '')::uuid,
        sku = v_sku, price_piastres = v_price, sale_price_piastres = v_sale,
        sale_starts_at = v_s0, sale_ends_at = v_s1,
        stock = coalesce((s->>'stock')::integer, 0),
        image_path = (select path from public.variant_group_media where group_id = v_group order by position limit 1),
        is_active = true, deleted_at = null
      where id = v_variant;
      v_keep_variants := v_keep_variants || v_variant;
    end loop;
  end loop;

  update public.variants set deleted_at = now(), is_active = false
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_variants));
  update public.variant_groups set deleted_at = now()
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_groups));
  update public.products set updated_at = now() where id = p_product_id;

  return jsonb_build_object('ok', true, 'children', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'sizes', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'size_option_id', v.size_option_id, 'sku', v.sku, 'stock', v.stock)
                                          order by v.option_key), '[]'::jsonb)
                  from public.variants v where v.group_id = g.id and v.deleted_at is null)) order by g.sort), '[]'::jsonb)
    from public.variant_groups g where g.product_id = p_product_id and g.deleted_at is null));
end
$function$;
revoke execute on function public.fn_save_children(uuid, jsonb) from public, anon;
grant execute on function public.fn_save_children(uuid, jsonb) to authenticated;


-- ── discount window: the child's (variant) window first ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_cart_get()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', c.variant_id,
    'product_id', c.product_id,
    'qty', c.qty,
    'vendor_id', p.vendor_id,
    'leaf_category_id', p.leaf_category_id,
    'brand_id', p.brand_id,
    'stock', v.stock,
    'sku', v.sku,
    'option_key', v.option_key,
    'price_piastres', coalesce(
      case when coalesce(v.sale_starts_at, p.sale_starts_at) is not null and coalesce(v.sale_starts_at, p.sale_starts_at) <= now()
             and (coalesce(v.sale_ends_at, p.sale_ends_at) is null or coalesce(v.sale_ends_at, p.sale_ends_at) > now())
           then v.sale_price_piastres end,
      v.price_piastres),
    'regular_price_piastres', v.price_piastres,
    'on_sale', coalesce(v.sale_starts_at, p.sale_starts_at) is not null and coalesce(v.sale_starts_at, p.sale_starts_at) <= now()
               and (coalesce(v.sale_ends_at, p.sale_ends_at) is null or coalesce(v.sale_ends_at, p.sale_ends_at) > now())
               and v.sale_price_piastres is not null,
    'name_ar', p.name_ar, 'name_en', p.name_en,
    'slug_ar', p.slug_ar, 'slug_en', p.slug_en,
    'image_path', img.path,
    'vendor_id', p.vendor_id,
    'store_name_ar', vd.store_name_ar, 'store_name_en', vd.store_name_en,
    'capped', c.qty > v.stock
  ) order by c.updated_at desc), '[]'::jsonb)
  from public.cart_items c
  join public.products p on p.id = c.product_id
  join public.variants v on v.id = c.variant_id
  join public.vendors vd on vd.id = p.vendor_id
  left join lateral (
    select pm.path from public.product_media pm
    where pm.product_id = p.id and pm.kind = 'image'
    order by pm.position limit 1
  ) img on true
  where c.user_id = auth.uid()
$function$;

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
           p.vendor_id, coalesce(v.sale_starts_at, p.sale_starts_at) as sale_starts_at, coalesce(v.sale_ends_at, p.sale_ends_at) as sale_ends_at, p.event_hidden
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
          public.fn_vendor_line_commission((r.ln->>'vendor_id')::uuid, (r.ln->>'leaf_category_id')::uuid) * 100,
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
            public.fn_vendor_line_commission((v_it.ln->>'vendor_id')::uuid, (v_it.ln->>'leaf_category_id')::uuid) * 100,
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
            public.fn_vendor_line_commission((v_row->>'vendor_id')::uuid, (v_row->>'leaf_category_id')::uuid) * 100,
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
          (select round(public.fn_vendor_line_commission((v_row->>'vendor_id')::uuid, (v_row->>'leaf_category_id')::uuid) * 100)::integer),
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

CREATE OR REPLACE FUNCTION public.fn_clone_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g public.variant_groups%rowtype;
  v_new_group uuid;
  v_user    uuid := auth.uid();
  v_src     public.products%rowtype;
  v_new     public.products%rowtype;
  v_variant record;
  v_new_sku text;
  v_n       integer := 0;
  v_drift   text[] := '{}'::text[];
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_src from public.products where id = p_product_id;
  if v_src.id is null then
    raise exception 'product not found';
  end if;
  -- Admin may clone any product (the admin products page calls this); a vendor
  -- only its own. Without the is_admin() branch the admin button always failed.
  if not public.is_admin()
     and not exists (select 1 from public.vendors where id = v_src.vendor_id and owner_id = v_user) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if coalesce((public.fn_vendor_config() ->> 'allow_clone'), 'true') <> 'true' then
    raise exception 'cloning is disabled';
  end if;

  insert into public.products (
    vendor_id, leaf_category_id, brand_id, name_ar, name_en, desc_ar, desc_en, short_ar, short_en,
    is_fragile, shipping_mode, shipping_class, weight_g, dims, status, sale_starts_at, sale_ends_at
  ) values (
    v_src.vendor_id, v_src.leaf_category_id, v_src.brand_id,
    v_src.name_ar || ' (نسخة)', v_src.name_en || ' (copy)',
    v_src.desc_ar, v_src.desc_en, v_src.short_ar, v_src.short_en,
    v_src.is_fragile, v_src.shipping_mode, v_src.shipping_class, v_src.weight_g, v_src.dims,
    'draft', v_src.sale_starts_at, v_src.sale_ends_at
  ) returning * into v_new;

  update public.products set
    slug_ar = public.fn_product_slug(v_new.name_ar),
    slug_en = public.fn_product_slug(v_new.name_en)
  where id = v_new.id;

  insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
  select v_new.id, attribute_id, option_id, value_text, value_number, value_bool
  from public.product_attribute_values where product_id = v_src.id;

  insert into public.product_facets (product_id, attribute_id, option_id)
  select v_new.id, attribute_id, option_id from public.product_facets where product_id = v_src.id;

  insert into public.product_media (product_id, kind, path, position)
  select v_new.id, kind, path, position from public.product_media where product_id = v_src.id;

  insert into public.product_tags (product_id, tag_id)
  select v_new.id, tag_id from public.product_tags where product_id = v_src.id;

  -- child products first, then their per-size rows (SKUs get a -C<n> suffix)
  for v_g in select * from public.variant_groups where product_id = v_src.id and deleted_at is null loop
    insert into public.variant_groups (product_id, color_option_id, price_piastres, sale_price_piastres, sale_starts_at, sale_ends_at, sort)
    values (v_new.id, v_g.color_option_id, v_g.price_piastres, v_g.sale_price_piastres, v_g.sale_starts_at, v_g.sale_ends_at, v_g.sort)
    returning id into v_new_group;
    insert into public.variant_group_media (group_id, path, position)
    select v_new_group, path, position from public.variant_group_media where group_id = v_g.id;
    for v_variant in select * from public.variants where group_id = v_g.id and deleted_at is null loop
      v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C1';
      while exists (select 1 from public.variants where sku = v_new_sku and deleted_at is null) loop
        v_n := v_n + 1;
        v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C' || (v_n + 1)::text;
      end loop;
      v_n := 0;
      insert into public.variants (product_id, group_id, size_option_id, sku, option_key, option_ids, price_piastres, sale_price_piastres,
                                   sale_starts_at, sale_ends_at, stock, image_path, is_active)
      values (v_new.id, v_new_group, v_variant.size_option_id, v_new_sku, v_variant.option_key, v_variant.option_ids,
              v_variant.price_piastres, v_variant.sale_price_piastres, v_variant.sale_starts_at, v_variant.sale_ends_at,
              v_variant.stock, v_variant.image_path, v_variant.is_active);
    end loop;
  end loop;

  -- template drift warning: attributes no longer in the current template
  select coalesce(array_agg(pav.attribute_id::text), '{}'::text[]) into v_drift
  from public.product_attribute_values pav
  where pav.product_id = v_new.id
    and not exists (
      select 1 from public.category_attributes ca
      where ca.category_id = v_new.leaf_category_id and ca.attribute_id = pav.attribute_id
    );

  return jsonb_build_object('id', v_new.id, 'name_en', v_new.name_en, 'drifted_attributes', to_jsonb(v_drift));
end $function$;

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
            WHEN (COALESCE(evp.percent, 0) >= COALESCE(evc.percent, 0)) THEN evp.max_piastres
            ELSE evc.max_piastres
        END AS event_max_piastres,
    st.stock_total,
    r.rating_avg,
    r.rating_count,
    (p.featured_permanent OR ((p.featured_until IS NOT NULL) AND (p.featured_until > now())) OR (p.featured_by_vendor AND (fn_vendor_featured_slots(p.vendor_id) > 0)) OR (EXISTS ( SELECT 1
           FROM (ad_campaigns ac
             JOIN ad_packages ap ON ((ap.id = ac.package_id)))
          WHERE ((ac.product_id = p.id) AND (ac.status = 'active'::text) AND (ac.ends_at > now()) AND (ap.placement = 'featured_product'::text))))) AS is_featured,
    p.event_hidden AS is_event_hidden,
    (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))) AS vendor_event_refused,
    ((NOT p.event_hidden) AND (NOT (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))))) AS is_listable,
    p.published_at,
    p.created_at
   FROM ((((((((((products p
     JOIN vendors v ON ((v.id = p.vendor_id)))
     LEFT JOIN categories cat ON ((cat.id = p.leaf_category_id)))
     LEFT JOIN brands b ON ((b.id = p.brand_id)))
     LEFT JOIN vendor_levels lvl ON ((lvl.id = v.level_id)))
     LEFT JOIN LATERAL ( SELECT pm.path
           FROM product_media pm
          WHERE ((pm.product_id = p.id) AND (pm.kind = 'image'::text))
          ORDER BY pm."position"
         LIMIT 1) img ON (true))
     LEFT JOIN LATERAL ( SELECT min(
                CASE
                    WHEN ((COALESCE(v2.sale_starts_at, p.sale_starts_at) IS NOT NULL) AND (COALESCE(v2.sale_starts_at, p.sale_starts_at) <= now()) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN LEAST(v2.price_piastres, v2.sale_price_piastres)
                    ELSE v2.price_piastres
                END) AS min_price_piastres,
            min(
                CASE
                    WHEN ((COALESCE(v2.sale_starts_at, p.sale_starts_at) IS NOT NULL) AND (COALESCE(v2.sale_starts_at, p.sale_starts_at) <= now()) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN v2.sale_price_piastres
                    ELSE NULL::integer
                END) AS min_sale_price_piastres,
            bool_or(((COALESCE(v2.sale_starts_at, p.sale_starts_at) IS NOT NULL) AND (COALESCE(v2.sale_starts_at, p.sale_starts_at) <= now()) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL))) AS has_sale,
            min(v2.price_piastres) AS min_regular_piastres
           FROM variants v2
          WHERE ((v2.product_id = p.id) AND (v2.deleted_at IS NULL) AND v2.is_active AND (v2.price_piastres IS NOT NULL))) pr ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(v3.stock), (0)::bigint) AS stock_total
           FROM variants v3
          WHERE ((v3.product_id = p.id) AND (v3.deleted_at IS NULL) AND v3.is_active)) st ON (true))
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            (count(*))::integer AS rating_count
           FROM reviews rw
          WHERE ((rw.product_id = p.id) AND (rw.status = 'published'::text))) r ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'product'::text) AND (d.ref_id = p.id))
          ORDER BY d.percent DESC
         LIMIT 1) evp ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'category'::text) AND fn_category_within(p.leaf_category_id, d.ref_id))
          ORDER BY d.percent DESC
         LIMIT 1) evc ON (true))
  WHERE ((p.status = 'approved'::text) AND (p.deleted_at IS NULL) AND (v.status = 'active'::text) AND (v.verification_status <> 'grace_expired'::text) AND (NOT v.hidden_from_listings));

commit;
