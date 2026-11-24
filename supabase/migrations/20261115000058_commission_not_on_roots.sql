-- Owner request: commission is charged on the subcategory a product is listed
-- in, never on a top-level category. Every level-3 category already has its
-- own rate, so the level-1 rows were never applied; they are removed and a
-- top-level rate can no longer be set.
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
   where proname = 'fn_admin_set_commission' and pg_get_function_identity_arguments(p.oid) = 'p_category uuid, p_percent numeric';
  if position('root_category' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    'if not found then raise exception ''category_not_found''; end if;',
    'if not found then raise exception ''category_not_found''; end if;
  if v_cat.depth = 1 then raise exception ''root_category''; end if;');
  if v_new = v_src then raise exception 'fn_admin_set_commission changed shape'; end if;
  execute v_new;
end $$;

insert into public.audit_logs (actor, action, entity, entity_id, before, after)
select null, 'admin.commission.clear', 'category_commissions', cc.category_id::text,
       jsonb_build_object('percent', cc.percent, 'reason', 'no commission on top-level categories'), null
  from public.category_commissions cc join public.categories c on c.id = cc.category_id where c.depth = 1;
delete from public.category_commissions cc using public.categories c where c.id = cc.category_id and c.depth = 1;
