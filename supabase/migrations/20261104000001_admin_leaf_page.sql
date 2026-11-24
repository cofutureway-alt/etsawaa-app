-- ============================================================================
-- Admin → Catalog → Attributes: one page of product types (leaf categories)
--
-- The landing list used to download every category, every dictionary
-- attribute, every option and all ~12,000 template links (~1.2 MB) just to
-- render ~1,400 cards. This returns one page (30 by default), optionally
-- filtered by an Arabic/English name or parent name, with each leaf's
-- attribute count (owned + linked, live attributes only) and the total match
-- count for the pager. Admin only.
-- ============================================================================
begin;

create or replace function public.fn_admin_leaf_page(
  p_q text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid, name_ar text, name_en text, parent_ar text, parent_en text,
  attr_count integer, total bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  return query
  with leaves as (
    select c.id, c.name_ar, c.name_en, p.name_ar as parent_ar, p.name_en as parent_en
    from public.categories c
    left join public.categories p on p.id = c.parent_id
    where c.deleted_at is null
      and not exists (select 1 from public.categories k where k.parent_id = c.id and k.deleted_at is null)
      and (v_q is null
           or c.name_ar ilike '%' || v_q || '%' or c.name_en ilike '%' || v_q || '%'
           or p.name_ar ilike '%' || v_q || '%' or p.name_en ilike '%' || v_q || '%')
  ),
  counted as (
    select l.*, count(*) over () as total
    from leaves l
  ),
  paged as (
    select * from counted
    order by name_ar, id
    limit greatest(1, least(coalesce(p_limit, 30), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select pg.id, pg.name_ar, pg.name_en, pg.parent_ar, pg.parent_en,
         (select count(distinct a.id)::integer
            from public.attribute_defs a
           where a.deleted_at is null
             and (a.category_id = pg.id
                  or exists (select 1 from public.category_attributes ca
                              where ca.category_id = pg.id and ca.attribute_id = a.id))) as attr_count,
         pg.total
  from paged pg
  order by pg.name_ar, pg.id;
end
$function$;

revoke execute on function public.fn_admin_leaf_page(text, integer, integer) from public, anon;
grant execute on function public.fn_admin_leaf_page(text, integer, integer) to authenticated;

commit;
