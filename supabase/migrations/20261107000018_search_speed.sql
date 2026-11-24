-- fn_search_products speed + paging fix (2026-11-07)
--
-- 1. Attribute facets: the defs view lists every (leaf category × attribute)
--    pair (~3,700 rows); joining that with every option and DISTINCT-ing the
--    product took ~1.1 s on EVERY /products, /search, category and brand page,
--    even with zero products. Defs are now narrowed to the scope and
--    de-duplicated BEFORE the option join (same result, ~100× less work).
-- 2. Paging bug: OFFSET/LIMIT ran on an unordered subquery and the sort was
--    applied only inside jsonb_agg, so page 2 could repeat or skip products.
--    The page is now cut from the sorted list.

create or replace function pg_temp.patch(p_fn regprocedure, p_old text, p_new text, p_marker text)
returns void language plpgsql as $$
declare src text; n text;
begin
  src := pg_get_functiondef(p_fn);
  if position(p_marker in src) > 0 then return; end if;
  n := replace(src, p_old, p_new);
  if n = src then raise exception 'patch anchor not found in %: %', p_fn, left(p_old, 60); end if;
  execute n;
end $$;

-- 2. ordered paging
select pg_temp.patch('public.fn_search_products(text,uuid,uuid,jsonb,integer,integer,numeric,boolean,text,integer,integer)'::regprocedure,
  'offset %s limit %s', 'order by %s offset %s limit %s', 'order by %s offset %s limit %s');
select pg_temp.patch('public.fn_search_products(text,uuid,uuid,jsonb,integer,integer,numeric,boolean,text,integer,integer)'::regprocedure,
  'v_where, v_off::text', 'v_where, v_order, v_off::text', 'v_where, v_order, v_off::text');

-- 1. scoped, de-duplicated facet defs (positional format args)
select pg_temp.patch('public.fn_search_products(text,uuid,uuid,jsonb,integer,integer,numeric,boolean,text,integer,integer)'::regprocedure,
  'from public.v_storefront_facet_defs fd',
  'from (select distinct fd.attribute_id, fd.code, fd.label_ar, fd.label_en, fd.type, fd.unit, fd.sort from public.v_storefront_facet_defs fd where %2$s) fd',
  'from public.v_storefront_facet_defs fd where %2$s');
select pg_temp.patch('public.fn_search_products(text,uuid,uuid,jsonb,integer,integer,numeric,boolean,text,integer,integer)'::regprocedure,
  'pf.product_id and (%s)', 'pf.product_id and (%1$s)', 'pf.product_id and (%1$s)');
select pg_temp.patch('public.fn_search_products(text,uuid,uuid,jsonb,integer,integer,numeric,boolean,text,integer,integer)'::regprocedure,
  'where %s', 'where true', 'where true');
