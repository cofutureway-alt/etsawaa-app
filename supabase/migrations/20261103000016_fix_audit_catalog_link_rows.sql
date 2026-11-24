-- ============================================================================
-- fn_audit_catalog: audit rows that have no `id` column
--
-- The catalog audit trigger wrote `coalesce(new.id, old.id)` as the entity
-- id. category_attributes (an attribute linked into a category — the template
-- of a product type) has a composite key and no `id`, so every admin
-- link/unlink raised `record "new" has no field "id"` and the admin template
-- editor could never attach or detach an attribute. Import/seed work was
-- unaffected only because SQL-level writes (no auth.uid()) skip auditing.
--
-- The row is now read through to_jsonb, and a link row is keyed
-- "<category_id>:<attribute_id>". Behaviour for tables with an id is unchanged.
-- ============================================================================
begin;

create or replace function public.fn_audit_catalog()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare actor uuid; v_row jsonb;
begin
  actor := auth.uid();
  if actor is null then
    return coalesce(new, old);   -- seed / SQL-level work is not audited
  end if;
  v_row := case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (
    actor,
    case tg_op when 'INSERT' then 'catalog.create' when 'UPDATE' then 'catalog.update' else 'catalog.delete' end,
    tg_table_name,
    coalesce(v_row ->> 'id', (v_row ->> 'category_id') || ':' || (v_row ->> 'attribute_id')),
    jsonb_build_object('op', tg_op, 'row', v_row)
  );
  return coalesce(new, old);
end;
$function$;

commit;
