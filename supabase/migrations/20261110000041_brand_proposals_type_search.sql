-- Brand proposals + product-type search (2026-11-10)
--  * a seller may propose a brand that is missing from the catalogue; the brand
--    is stored inactive/pending, linked to the seller's sub-category and shown
--    inside the product form until a reviewer accepts or rejects it
--  * accepting completes the brand data and publishes it; rejecting swaps the
--    product over to another brand (or none) and tells the seller
--  * approving a product whose brand is still pending is refused
--  * product-type search: sellers who do not know the branch can type the type
--    name and jump straight to the leaf (router, battery, charger, doll…)

-- ----------------------------------------------------------------- brand columns
alter table public.brands
  add column if not exists review_status text not null default 'approved'
    check (review_status in ('approved', 'pending', 'rejected')),
  add column if not exists proposed_by uuid,
  add column if not exists proposed_vendor_id uuid,
  add column if not exists proposed_at timestamptz,
  add column if not exists review_note text;

-- --------------------------------------------------------------- brand policies
-- the proposer keeps seeing the brand while it waits for a decision
drop policy if exists brands_read_own_proposed on public.brands;
create policy brands_read_own_proposed on public.brands
  for select to authenticated
  -- any signed-in seller: a second seller typing the same new name is handed
  -- the existing proposal and must be able to see its name on their product
  using (deleted_at is null and (proposed_by = auth.uid() or review_status = 'pending'));

-- reviewers open the product page and need the whole pending proposal
drop policy if exists brands_read_reviewers on public.brands;
create policy brands_read_reviewers on public.brands
  for select to authenticated
  using (public.has_permission('products.review') or public.has_permission('products.view'));

-- ------------------------------------------------------- fn_vendor_propose_brand
create or replace function public.fn_vendor_propose_brand(p_name_ar text, p_name_en text, p_category uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user   uuid := auth.uid();
  v_vendor uuid;
  v_ar     text := btrim(coalesce(p_name_ar, ''));
  v_en     text := btrim(coalesce(p_name_en, ''));
  v_cat    record;
  v_target uuid;
  v_exist  public.brands%rowtype;
  v_id     uuid := gen_random_uuid();
  v_suffix text;
  v_count  integer;
  v_admin  uuid;
begin
  select id into v_vendor from public.vendors where owner_id = v_user;
  if v_vendor is null then
    raise exception 'not allowed: no store' using errcode = '42501';
  end if;
  if char_length(v_ar) < 2 or char_length(v_ar) > 60
     or char_length(v_en) < 2 or char_length(v_en) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'bad_name');
  end if;

  select id, depth, path into v_cat
    from public.categories
   where id = p_category and is_active and deleted_at is null;
  if v_cat.id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_category');
  end if;
  -- brands link to sub-categories (depth 2); shallow categories link themselves
  v_target := case when v_cat.depth <= 2 then v_cat.id else split_part(v_cat.path, '/', 2)::uuid end;

  select * into v_exist
    from public.brands
   where deleted_at is null
     and (public.ar_norm(name_ar) = public.ar_norm(v_ar)
          or lower(btrim(name_en)) = lower(v_en))
   order by (is_active and review_status = 'approved') desc, proposed_at nulls last
   limit 1;

  if v_exist.id is not null then
    if v_exist.is_active and v_exist.review_status = 'approved' then
      -- the seller evidently sells it there: link it for next time
      insert into public.brand_categories (brand_id, category_id)
      values (v_exist.id, v_target)
      on conflict do nothing;
      return jsonb_build_object('ok', true, 'existing', true, 'id', v_exist.id,
                                'name_ar', v_exist.name_ar, 'name_en', v_exist.name_en,
                                'thumb_path', v_exist.thumb_path);
    elsif v_exist.review_status = 'pending' then
      insert into public.brand_categories (brand_id, category_id)
      values (v_exist.id, v_target)
      on conflict do nothing;
      return jsonb_build_object('ok', true, 'pending', true, 'id', v_exist.id,
                                'name_ar', v_exist.name_ar, 'name_en', v_exist.name_en);
    end if;
  end if;

  select count(*) into v_count
    from public.brands
   where review_status = 'pending' and proposed_vendor_id = v_vendor and deleted_at is null;
  if v_count >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  v_suffix := '-' || substr(replace(v_id::text, '-', ''), 1, 6);

  insert into public.brands (id, name_ar, name_en, slug_ar, slug_en, is_active,
                             review_status, proposed_by, proposed_vendor_id, proposed_at, sort)
  values (v_id, v_ar, v_en,
          regexp_replace(v_ar, '\s+', '-', 'g') || v_suffix,
          regexp_replace(lower(v_en), '[^a-z0-9]+', '-', 'g') || v_suffix,
          false, 'pending', v_user, v_vendor, now(), 0);
  insert into public.brand_categories (brand_id, category_id) values (v_id, v_target);

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'brand.proposed', 'brands', v_id::text,
          jsonb_build_object('name_ar', v_ar, 'name_en', v_en, 'category_id', v_target));

  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.fn_notify(v_admin, 'brand.proposed',
      jsonb_build_object('brand_id', v_id, 'name_ar', v_ar, 'name_en', v_en));
  end loop;

  return jsonb_build_object('ok', true, 'pending', true, 'id', v_id, 'name_ar', v_ar, 'name_en', v_en);
end $function$
;

revoke all on function public.fn_vendor_propose_brand(text, text, uuid) from public, anon;
grant execute on function public.fn_vendor_propose_brand(text, text, uuid) to authenticated;

-- ---------------------------------------------------- fn_search_leaf_categories
create or replace function public.fn_search_leaf_categories(p_q text, p_limit integer default 20)
 returns table (id uuid, name_ar text, name_en text, path_ar text, path_en text, ids uuid[])
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with term as (select btrim(coalesce(p_q, '')) as q)
  select c.id, c.name_ar, c.name_en,
         (select string_agg(p.name_ar, ' › ' order by t.ord)
            from unnest(string_to_array(c.path, '/')) with ordinality as t(cid, ord)
            join public.categories p on p.id = t.cid::uuid
           where t.ord < cardinality(string_to_array(c.path, '/'))) as path_ar,
         (select string_agg(p.name_en, ' › ' order by t.ord)
            from unnest(string_to_array(c.path, '/')) with ordinality as t(cid, ord)
            join public.categories p on p.id = t.cid::uuid
           where t.ord < cardinality(string_to_array(c.path, '/'))) as path_en,
         string_to_array(c.path, '/')::uuid[] as ids
    from public.categories c, term
   where char_length(term.q) >= 2
     and c.is_active and c.deleted_at is null
     and not exists (select 1 from public.categories ch
                      where ch.parent_id = c.id and ch.is_active and ch.deleted_at is null)
     and public.fn_search_match(c.name_ar || ' ' || c.name_en, term.q)
   order by (public.ar_norm(c.name_ar) like public.ar_norm(term.q) || '%'
             or lower(c.name_en) like lower(term.q) || '%') desc,
            c.name_ar
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$function$
;

revoke all on function public.fn_search_leaf_categories(text, integer) from public, anon;
grant execute on function public.fn_search_leaf_categories(text, integer) to authenticated;

-- --------------------------------------------------------------- fn_save_product
create or replace function public.fn_save_product(p_product jsonb, p_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user      uuid := auth.uid();
  v_vendor    uuid;
  v_product   public.products%rowtype;
  v_is_new    boolean := p_id is null;
  v_is_admin  boolean := false;
  v_was_live  boolean := false;
  v_cat       uuid := nullif(p_product ->> 'leaf_category_id', '')::uuid;
  v_is_leaf   boolean;
  v_attr      record;
  v_val       jsonb;
  v_opt       uuid;
  v_specs     jsonb := '{}'::jsonb;
  v_opts      uuid[];
  v_allowed   uuid[];
  v_media     jsonb;
  v_i         integer;
  v_brand     uuid;
  v_sale_s    timestamptz;
  v_sale_e    timestamptz;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;

  if v_is_new then
    -- a suspended store can look but not act (enforced here, not only in the UI)
    perform public.fn_assert_my_store_operational();
    select id into v_vendor from public.vendors where owner_id = v_user;
    if v_vendor is null then
      raise exception 'not allowed: no store' using errcode = '42501';
    end if;
    if exists (select 1 from public.vendors where id = v_vendor and status = 'pending') then
      raise exception 'vendor_under_review: the store is still under review' using errcode = 'P0001';
    end if;
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;
  else
    select * into v_product from public.products where id = p_id and deleted_at is null;
    if v_product.id is null then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
    select id into v_vendor from public.vendors where id = v_product.vendor_id and owner_id = v_user;
    if v_vendor is null then
      -- staff editing someone else's product: no status change, no store gate
      if not public.has_permission('products.edit') then
        raise exception 'not allowed: product not found' using errcode = '42501';
      end if;
      v_is_admin := true;
      v_vendor := v_product.vendor_id;
    else
      -- a suspended store can look but not act (enforced here, not only in the UI)
      perform public.fn_assert_my_store_operational();
      if v_product.rejected_final then
        raise exception 'product_rejected_final: this product was rejected permanently' using errcode = 'P0001';
      end if;
      -- under review or live: the first change pulls it back to draft so the
      -- seller never hits a lock when a reviewer decided at the same moment
      if v_product.status in ('pending', 'approved') then
        v_was_live := v_product.status = 'approved';
        update public.products
           set status = 'draft', submitted_at = null, published_at = null
         where id = v_product.id
         returning * into v_product;
        insert into public.audit_logs (actor, action, entity, entity_id, after)
        values (v_user, 'product.reopened', 'products', v_product.id::text,
                jsonb_build_object('status', 'draft', 'auto', true, 'was_live', v_was_live));
      elsif v_product.status not in ('draft', 'rejected') then
        raise exception 'product is locked in status %', v_product.status;
      end if;
    end if;
  end if;

  -- category: must be an active leaf
  if v_cat is not null then
    select not exists (select 1 from public.categories c where c.parent_id = v_cat and c.deleted_at is null)
      and exists (select 1 from public.categories c where c.id = v_cat and c.is_active and c.deleted_at is null)
      into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be an active leaf category';
    end if;
  end if;

  -- a brand is usable when it is published, or when it is the pending proposal
  -- of this product's store (or staff is editing)
  v_brand := case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end;
  if v_brand is not null and not exists (
       select 1 from public.brands b
        where b.id = v_brand
          and b.deleted_at is null
          and (
            (b.is_active and b.review_status = 'approved')
            or (not b.is_active and b.review_status = 'pending')
          )
     ) then
    raise exception 'brand not found';
  end if;
  if v_brand is not null
     and coalesce(v_cat, v_product.leaf_category_id) is not null
     and exists (select 1 from public.brand_categories x where x.brand_id = v_brand)
     and not exists (
       select 1 from public.brand_categories x
         join public.categories c on c.id = coalesce(v_cat, v_product.leaf_category_id)
        where x.brand_id = v_brand
          and (c.id = x.category_id or c.path like '%' || x.category_id::text || '%')) then
    raise exception 'brand_not_in_category';
  end if;

  v_sale_s := nullif(p_product ->> 'sale_starts_at', '')::timestamptz;
  v_sale_e := nullif(p_product ->> 'sale_ends_at', '')::timestamptz;
  if v_sale_s is not null and v_sale_e is not null and v_sale_e <= v_sale_s then
    raise exception 'sale schedule end must be after the start';
  end if;

  update public.products set
    name_ar  = coalesce(p_product ->> 'name_ar',  v_product.name_ar),
    name_en  = coalesce(p_product ->> 'name_en',  v_product.name_en),
    desc_ar  = coalesce(p_product ->> 'desc_ar',  v_product.desc_ar),
    desc_en  = coalesce(p_product ->> 'desc_en',  v_product.desc_en),
    short_ar = coalesce(p_product ->> 'short_ar', v_product.short_ar),
    short_en = coalesce(p_product ->> 'short_en', v_product.short_en),
    leaf_category_id = coalesce(v_cat, v_product.leaf_category_id),
    brand_id = case when p_product ? 'brand_id' then nullif(p_product ->> 'brand_id', '')::uuid else v_product.brand_id end,
    is_fragile = coalesce((p_product ->> 'is_fragile')::boolean, v_product.is_fragile),
    shipping_mode = coalesce(p_product ->> 'shipping_mode', v_product.shipping_mode),
    shipping_class = coalesce(p_product ->> 'shipping_class', v_product.shipping_class),
    weight_g = coalesce((p_product ->> 'weight_g')::int, v_product.weight_g),
    dims = coalesce(p_product -> 'dims', v_product.dims),
    size_chart = case when p_product ? 'size_chart' then nullif(p_product -> 'size_chart', 'null'::jsonb) else v_product.size_chart end,
    sale_starts_at = coalesce(v_sale_s, v_product.sale_starts_at),
    sale_ends_at = coalesce(v_sale_e, v_product.sale_ends_at)
  where id = v_product.id
  returning * into v_product;

  -- some categories ship with the platform only (settings.shipping_rules) — shipping-rule
  if v_product.shipping_mode = 'vendor' and public.fn_vendor_shipping_blocked(v_product.leaf_category_id) then
    update public.products set shipping_mode = 'platform' where id = v_product.id returning * into v_product;
  end if;

  if coalesce(v_product.slug_ar, '') = '' and coalesce(v_product.name_ar, '') <> '' then
    update public.products set slug_ar = public.fn_product_slug(v_product.name_ar) where id = v_product.id;
  end if;
  if coalesce(v_product.slug_en, '') = '' and coalesce(v_product.name_en, '') <> '' then
    update public.products set slug_en = public.fn_product_slug(v_product.name_en) where id = v_product.id;
  end if;

  if p_product ? 'attributes' then
    delete from public.product_attribute_values where product_id = v_product.id;
    for v_val in select * from jsonb_array_elements(coalesce(p_product -> 'attributes', '[]'::jsonb)) loop
      select * into v_attr from public.attribute_defs
        where id = (v_val ->> 'attribute_id')::uuid and deleted_at is null;
      if v_attr.id is null then
        raise exception 'attribute % not found', v_val ->> 'attribute_id';
      end if;
      if v_product.leaf_category_id is null
         or not public.fn_attr_in_template(v_attr.id, v_product.leaf_category_id) then
        raise exception 'attribute % does not belong to the product category', v_attr.code;
      end if;
      -- option_ids (multi) or option_id (single); de-duplicated, order kept
      select coalesce(array_agg(x.id order by x.ord), '{}'::uuid[]) into v_opts
        from (select distinct on (e.v) nullif(e.v, '')::uuid id, e.ord
                from jsonb_array_elements_text(
                       case when jsonb_typeof(v_val -> 'option_ids') = 'array' then v_val -> 'option_ids'
                            when coalesce(v_val ->> 'option_id', '') <> '' then jsonb_build_array(v_val ->> 'option_id')
                            else '[]'::jsonb end) with ordinality e(v, ord)
               where nullif(e.v, '') is not null
               order by e.v, e.ord) x;
      v_opt := v_opts[1];
      if v_attr.type in ('enum', 'color') then
        if cardinality(v_opts) = 0 then
          continue; -- nothing chosen: no row (required specs are checked on submit)
        end if;
        if cardinality(v_opts) > 1 and not v_attr.is_multi then
          raise exception 'attribute % accepts a single option', v_attr.code;
        end if;
        if exists (
          select 1 from unnest(v_opts) o(id)
           where not exists (select 1 from public.attribute_options ao
                              where ao.id = o.id and ao.attribute_id = v_attr.id and ao.deleted_at is null)
        ) then
          raise exception 'value for % must come from the admin options', v_attr.code;
        end if;
        -- category scope: only the options the admin allowed for this category
        select ca.allowed_option_ids into v_allowed from public.category_attributes ca
         where ca.category_id = v_product.leaf_category_id and ca.attribute_id = v_attr.id;
        if v_allowed is not null and not (v_opts <@ v_allowed) then
          raise exception 'value for % is not offered in this category', v_attr.code;
        end if;
      else
        v_opts := null;
        if nullif(v_val ->> 'value_text', '') is null and nullif(v_val ->> 'value_number', '') is null
           and nullif(v_val ->> 'value_bool', '') is null then
          continue; -- empty free-text / number: no row
        end if;
      end if;
      insert into public.product_attribute_values (product_id, attribute_id, option_id, option_ids, value_text, value_number, value_bool)
      values (
        v_product.id, v_attr.id, v_opt, case when v_opt is null then null else v_opts end,
        nullif(v_val ->> 'value_text', ''),
        nullif(v_val ->> 'value_number', '')::numeric,
        nullif(v_val ->> 'value_bool', '')::boolean
      );
    end loop;

    delete from public.product_facets where product_id = v_product.id;
    insert into public.product_facets (product_id, attribute_id, option_id)
    select distinct v_product.id, pav.attribute_id, o.id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    cross join lateral unnest(coalesce(pav.option_ids, array[pav.option_id])) o(id)
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;

    select coalesce(jsonb_object_agg(ad.code, jsonb_build_object(
      'type', ad.type,
      'unit', ad.unit,
      'value', case
        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)
          || case when ad.is_multi then jsonb_build_object('values', (
               select coalesce(jsonb_agg(jsonb_build_object('option_id', mo.id, 'label_ar', mo.label_ar,
                        'label_en', mo.label_en, 'color_hex', mo.color_hex) order by t.ord), '[]'::jsonb)
                 from unnest(coalesce(pav.option_ids, array[pav.option_id])) with ordinality t(id, ord)
                 join public.attribute_options mo on mo.id = t.id)) else '{}'::jsonb end
        when ad.type = 'number' then to_jsonb(pav.value_number)
        when ad.type = 'bool' then to_jsonb(pav.value_bool)
        else to_jsonb(pav.value_text) end
    )), '{}'::jsonb)
    into v_specs
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    left join public.attribute_options ao on ao.id = pav.option_id
    where pav.product_id = v_product.id;
    update public.products set specs = v_specs where id = v_product.id;
  end if;

  if p_product ? 'media' then
    delete from public.product_media where product_id = v_product.id;
    v_i := 0;
    for v_media in select * from jsonb_array_elements(coalesce(p_product -> 'media', '[]'::jsonb)) loop
      insert into public.product_media (product_id, kind, path, position)
      values (v_product.id, coalesce(v_media ->> 'kind', 'image'), v_media ->> 'path', v_i)
      on conflict (product_id, path) do nothing; -- dedupe-media
      v_i := v_i + 1;
    end loop;
  end if;

  if p_product ? 'tag_ids' then
    delete from public.product_tags where product_id = v_product.id;
    insert into public.product_tags (product_id, tag_id)
    select v_product.id, value::uuid
    from jsonb_array_elements_text(coalesce(p_product -> 'tag_ids', '[]'::jsonb)) value
    where exists (select 1 from public.tags where id = value::uuid and deleted_at is null);
  end if;

  if coalesce((p_product -> 'apply_defaults')::boolean, false) then
    update public.variants set
      price_piastres = coalesce(nullif(p_product ->> 'default_price_piastres', '')::int, price_piastres),
      sale_price_piastres = coalesce(nullif(p_product ->> 'default_sale_piastres', '')::int, sale_price_piastres)
    where product_id = v_product.id and deleted_at is null;
  end if;

  select * into v_product from public.products where id = v_product.id;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, case when v_is_new then 'product.create' when v_is_admin then 'product.admin_update' else 'product.update' end,
          'products', v_product.id::text,
          jsonb_build_object('status', v_product.status, 'name_ar', v_product.name_ar));

  return jsonb_build_object(
    'id', v_product.id,
    'slug_ar', v_product.slug_ar,
    'slug_en', v_product.slug_en,
    'status', v_product.status,
    'updated_at', v_product.updated_at
  );
end $function$
;

-- --------------------------------------------------------- fn_admin_decide_product
drop function if exists public.fn_admin_decide_product(uuid, text, text);

create or replace function public.fn_admin_decide_product(
  p_product uuid,
  p_decision text,
  p_note text default null::text,
  p_expected_submitted_at timestamptz default null::timestamptz
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- the seller sent a new version (or withdrew it for editing) meanwhile
  if p_expected_submitted_at is not null and v_product.submitted_at is distinct from p_expected_submitted_at then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  if p_decision in ('approve_notes', 'reject', 'reject_final') and coalesce(length(v_note), 0) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;
  -- the seller's brand is still an unaccepted proposal: decide the brand first
  if p_decision like 'approve%' and exists (
    select 1 from public.brands
     where id = v_product.brand_id and review_status = 'pending' and deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'brand_pending');
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

revoke all on function public.fn_admin_decide_product(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.fn_admin_decide_product(uuid, text, text, timestamptz) to authenticated;

-- --------------------------------------------------------- fn_admin_accept_brand
create or replace function public.fn_admin_accept_brand(
  p_brand uuid,
  p_name_ar text,
  p_name_en text,
  p_thumb_path text,
  p_description_ar text,
  p_description_en text,
  p_country_ar text,
  p_country_en text,
  p_founded_year integer,
  p_category_ids uuid[]
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_brand  public.brands%rowtype;
  v_ar     text := btrim(coalesce(p_name_ar, ''));
  v_en     text := btrim(coalesce(p_name_en, ''));
  v_slug_en text;
  v_slug_ar text;
begin
  if not (public.has_permission('catalog.manage') or public.has_permission('products.review')) then
    raise exception 'not allowed: catalog permission required' using errcode = '42501';
  end if;
  select * into v_brand from public.brands
   where id = p_brand and deleted_at is null for update;
  if v_brand.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_brand.review_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  if char_length(v_ar) < 2 or char_length(v_ar) > 60
     or char_length(v_en) < 2 or char_length(v_en) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'bad_name');
  end if;
  if exists (
    select 1 from public.brands b
     where b.id <> v_brand.id and b.deleted_at is null
       and b.is_active and b.review_status = 'approved'
       and (public.ar_norm(b.name_ar) = public.ar_norm(v_ar)
            or lower(btrim(b.name_en)) = lower(v_en))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  -- clean slugs when free; otherwise keep the collision-safe suffixed ones
  v_slug_en := trim(both '-' from regexp_replace(lower(v_en), '[^a-z0-9]+', '-', 'g'));
  if v_slug_en <> '' and exists (
    select 1 from public.brands where slug_en = v_slug_en and id <> v_brand.id and deleted_at is null
  ) then
    v_slug_en := v_brand.slug_en;
  end if;
  if v_slug_en = '' then v_slug_en := v_brand.slug_en; end if;

  v_slug_ar := trim(both '-' from regexp_replace(v_ar, '\s+', '-', 'g'));
  if v_slug_ar <> '' and exists (
    select 1 from public.brands where slug_ar = v_slug_ar and id <> v_brand.id and deleted_at is null
  ) then
    v_slug_ar := v_brand.slug_ar;
  end if;
  if v_slug_ar = '' then v_slug_ar := v_brand.slug_ar; end if;

  update public.brands set
    name_ar = v_ar,
    name_en = v_en,
    slug_ar = v_slug_ar,
    slug_en = v_slug_en,
    thumb_path = nullif(btrim(coalesce(p_thumb_path, '')), ''),
    description_ar = coalesce(btrim(coalesce(p_description_ar, '')), ''),
    description_en = coalesce(btrim(coalesce(p_description_en, '')), ''),
    country_ar = coalesce(btrim(coalesce(p_country_ar, '')), ''),
    country_en = coalesce(btrim(coalesce(p_country_en, '')), ''),
    founded_year = case when p_founded_year between 1500 and 2100 then p_founded_year else null end,
    is_active = true,
    review_status = 'approved',
    review_note = null
  where id = v_brand.id
  returning * into v_brand;

  if coalesce(cardinality(p_category_ids), 0) > 0 then
    delete from public.brand_categories where brand_id = v_brand.id;
    insert into public.brand_categories (brand_id, category_id)
    select distinct v_brand.id, c.id
      from public.categories c
     where c.id = any(p_category_ids)
       and c.depth = 2
       and c.is_active and c.deleted_at is null;
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'brand.accepted', 'brands', v_brand.id::text,
          jsonb_build_object('name_ar', v_brand.name_ar, 'name_en', v_brand.name_en));

  if v_brand.proposed_by is not null then
    perform public.fn_notify(v_brand.proposed_by, 'brand.approved', jsonb_build_object(
      'brand_id', v_brand.id, 'name_ar', v_brand.name_ar, 'name_en', v_brand.name_en));
  end if;

  return jsonb_build_object('ok', true);
end $function$
;

revoke all on function public.fn_admin_accept_brand(uuid, text, text, text, text, text, text, text, integer, uuid[]) from public, anon;
grant execute on function public.fn_admin_accept_brand(uuid, text, text, text, text, text, text, text, integer, uuid[]) to authenticated;

-- --------------------------------------------------------- fn_admin_reject_brand
create or replace function public.fn_admin_reject_brand(p_brand uuid, p_replacement uuid, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_brand   public.brands%rowtype;
  v_rep     public.brands%rowtype;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_first   uuid;
  v_count   integer := 0;
begin
  if not (public.has_permission('catalog.manage') or public.has_permission('products.review')) then
    raise exception 'not allowed: catalog permission required' using errcode = '42501';
  end if;
  select * into v_brand from public.brands
   where id = p_brand and deleted_at is null for update;
  if v_brand.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_brand.review_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if p_replacement is not null then
    select * into v_rep from public.brands
     where id = p_replacement and deleted_at is null
       and is_active and review_status = 'approved';
    if v_rep.id is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_replacement');
    end if;
  end if;

  select p.id into v_first
    from public.products p
    join public.vendors v on v.id = p.vendor_id
   where p.brand_id = v_brand.id and p.deleted_at is null
     and v.owner_id = v_brand.proposed_by
   order by p.updated_at desc limit 1;

  -- the replacement must be offered in the sub-categories of the products it
  -- lands on, or the seller's next save would fail with brand_not_in_category
  if p_replacement is not null then
    insert into public.brand_categories (brand_id, category_id)
    select distinct p_replacement, split_part(c.path, '/', 2)::uuid
      from public.products p
      join public.categories c on c.id = p.leaf_category_id
     where p.brand_id = v_brand.id and p.deleted_at is null
       and split_part(c.path, '/', 2) <> ''
    on conflict do nothing;
  end if;

  update public.products set brand_id = p_replacement where brand_id = v_brand.id;
  get diagnostics v_count = row_count;

  update public.brands set
    review_status = 'rejected',
    review_note = v_note,
    is_active = false,
    deleted_at = now()
  where id = v_brand.id;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'brand.rejected', 'brands', v_brand.id::text,
          jsonb_build_object('name_ar', v_brand.name_ar, 'name_en', v_brand.name_en,
                             'replacement', p_replacement, 'note', v_note, 'products', v_count));

  if v_brand.proposed_by is not null then
    perform public.fn_notify(v_brand.proposed_by, 'brand.rejected', jsonb_build_object(
      'brand_id', v_brand.id, 'name_ar', v_brand.name_ar, 'name_en', v_brand.name_en,
      'replacement_ar', v_rep.name_ar, 'replacement_en', v_rep.name_en,
      'note', v_note, 'product_id', v_first));
  end if;

  return jsonb_build_object('ok', true, 'products', v_count);
end $function$
;

revoke all on function public.fn_admin_reject_brand(uuid, uuid, text) from public, anon;
grant execute on function public.fn_admin_reject_brand(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
