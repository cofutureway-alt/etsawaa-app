-- Attributes: multi-select specs + per-category option scoping (2026-11-07).
--
-- Problems found on a live shirt product:
--  * options are global per attribute → a shirt's «الخامة» offered plastic,
--    metal, marble… (48 options shared by 841 categories); «قصة البنطلون»
--    (pants cuts) was linked to shirts, watches, belts, shoes…
--  * product_attribute_values PK (product, attribute) → one value per spec,
--    so "cotton + elastane" or "casual + work" was impossible.
--
-- Model after this migration:
--  * attribute_defs.is_multi            → the spec accepts several options
--  * category_attributes.allowed_option_ids → options offered in THAT category
--                                          (null = every option of the attribute)
--  * product_attribute_values.option_ids → every chosen option (option_id stays
--                                          the first one, for older readers)
--  * fn_save_product validates scope + multi, writes one facet row per option and
--    a `values` array into the specs snapshot for multi specs.

alter table public.attribute_defs add column if not exists is_multi boolean not null default false;
alter table public.category_attributes add column if not exists allowed_option_ids uuid[];
alter table public.product_attribute_values add column if not exists option_ids uuid[];

update public.product_attribute_values set option_ids = array[option_id]
 where option_id is not null and option_ids is null;

comment on column public.attribute_defs.is_multi is 'enum spec that accepts several options per product';
comment on column public.category_attributes.allowed_option_ids is 'options offered for this attribute in this category; null = all options';
comment on column public.product_attribute_values.option_ids is 'every chosen option (multi specs); option_id = option_ids[1]';

-- ── fn_save_product: attribute block ─────────────────────────────────────────
do $$
declare src text; n text; old_block text; new_block text;
begin
  src := pg_get_functiondef('public.fn_save_product'::regproc);

  old_block := $o$      v_opt := nullif(v_val ->> 'option_id', '')::uuid;
      if v_attr.type in ('enum', 'color') then
        if v_opt is null or not exists (
          select 1 from public.attribute_options where id = v_opt and attribute_id = v_attr.id and deleted_at is null
        ) then
          raise exception 'value for % must come from the admin options', v_attr.code;
        end if;
      end if;
      insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
      values (
        v_product.id, v_attr.id, v_opt,
        nullif(v_val ->> 'value_text', ''),
        nullif(v_val ->> 'value_number', '')::numeric,
        nullif(v_val ->> 'value_bool', '')::boolean
      );$o$;

  new_block := $n$      -- option_ids (multi) or option_id (single); de-duplicated, order kept
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
      );$n$;

  n := replace(src, old_block, new_block);
  if n = src then raise exception 'fn_save_product: attribute block anchor not found'; end if;

  -- facets: one row per chosen option
  src := n;
  n := replace(src,
    $o$    select v_product.id, pav.attribute_id, pav.option_id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;$o$,
    $n$    select distinct v_product.id, pav.attribute_id, o.id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    cross join lateral unnest(coalesce(pav.option_ids, array[pav.option_id])) o(id)
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;$n$);
  if n = src then raise exception 'fn_save_product: facets anchor not found'; end if;

  -- specs snapshot: multi specs also carry every option under `values`
  src := n;
  n := replace(src,
    $o$        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)$o$,
    $n$        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)
          || case when ad.is_multi then jsonb_build_object('values', (
               select coalesce(jsonb_agg(jsonb_build_object('option_id', mo.id, 'label_ar', mo.label_ar,
                        'label_en', mo.label_en, 'color_hex', mo.color_hex) order by t.ord), '[]'::jsonb)
                 from unnest(coalesce(pav.option_ids, array[pav.option_id])) with ordinality t(id, ord)
                 join public.attribute_options mo on mo.id = t.id)) else '{}'::jsonb end$n$);
  if n = src then raise exception 'fn_save_product: specs anchor not found'; end if;

  -- new locals
  src := n;
  n := replace(src, $o$  v_specs     jsonb := '{}'::jsonb;$o$,
    $n$  v_specs     jsonb := '{}'::jsonb;
  v_opts      uuid[];
  v_allowed   uuid[];$n$);
  if n = src then raise exception 'fn_save_product: declare anchor not found'; end if;

  execute n;
end $$;

-- ── fn_clone_product: copy option_ids too ────────────────────────────────────
do $$
declare src text; n text;
begin
  src := pg_get_functiondef('public.fn_clone_product'::regproc);
  n := replace(src,
    $o$insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
  select v_new.id, attribute_id, option_id, value_text, value_number, value_bool$o$,
    $n$insert into public.product_attribute_values (product_id, attribute_id, option_id, option_ids, value_text, value_number, value_bool)
  select v_new.id, attribute_id, option_id, option_ids, value_text, value_number, value_bool$n$);
  if n = src then raise exception 'fn_clone_product: anchor not found'; end if;
  execute n;
end $$;
