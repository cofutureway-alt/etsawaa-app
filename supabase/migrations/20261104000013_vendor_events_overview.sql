-- ============================================================================
-- Seller events: auto-enrolment that actually applies + an overview RPC
--
-- Stores are enrolled in every live event automatically and may opt out.
-- v_active_event_vendors only listed stores with an event_vendors row, so a
-- store that never answered got no event discount. It now lists every active
-- store: 'refused' when it opted out, otherwise 'accepted'.
--
-- fn_vendor_event_overview(): the seller's events (live, upcoming, recently
-- ended) with their participation, the discounts that touch the seller's own
-- products (scope, target name, %, cap), the best % and how many of the
-- seller's products it affects — what the events page and the dashboard
-- banner show.
-- ============================================================================
begin;

create or replace view public.v_active_event_vendors as
select v.id as vendor_id, e.id as event_id, e.name_ar, e.name_en,
       case when ev.status = 'refused' then 'refused' else 'accepted' end as status
from public.events e
cross join public.vendors v
left join public.event_vendors ev on ev.event_id = e.id and ev.vendor_id = v.id
where e.status = 'active' and now() between e.starts_at and e.ends_at and v.status = 'active';

create or replace function public.fn_vendor_event_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_vendor uuid := public.own_vendor_id();
begin
  if v_vendor is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.phase_order, x.starts_at)
    from (
      select e.id, e.name_ar, e.name_en, e.desc_ar, e.desc_en, e.starts_at, e.ends_at,
             case when ev.status = 'refused' then 'refused' else 'participating' end as participation,
             case when now() < e.starts_at then 'upcoming' when now() > e.ends_at then 'ended' else 'live' end as phase,
             case when now() between e.starts_at and e.ends_at then 0 when now() < e.starts_at then 1 else 2 end as phase_order,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'scope', d.scope, 'percent', d.percent, 'max_piastres', d.max_discount_piastres,
                        'name_ar', coalesce(c.name_ar, p.name_ar), 'name_en', coalesce(c.name_en, p.name_en),
                        'products', d.products) order by d.percent desc)
               from (
                 select d.*, (
                   select count(*) from public.products pp
                   where pp.vendor_id = v_vendor and pp.deleted_at is null and pp.status = 'approved'
                     and ((d.scope = 'product' and pp.id = d.ref_id)
                       or (d.scope = 'category' and public.fn_category_within(pp.leaf_category_id, d.ref_id)))
                 ) as products
                 from public.event_discounts d where d.event_id = e.id
               ) d
               left join public.categories c on d.scope = 'category' and c.id = d.ref_id
               left join public.products p on d.scope = 'product' and p.id = d.ref_id
               where d.products > 0
             ), '[]'::jsonb) as discounts,
             (select count(distinct pp.id) from public.products pp
               join public.event_discounts d on d.event_id = e.id
              where pp.vendor_id = v_vendor and pp.deleted_at is null and pp.status = 'approved'
                and ((d.scope = 'product' and pp.id = d.ref_id)
                  or (d.scope = 'category' and public.fn_category_within(pp.leaf_category_id, d.ref_id)))) as affected_products,
             (select max(d.percent) from public.event_discounts d
               join public.products pp on pp.vendor_id = v_vendor and pp.deleted_at is null and pp.status = 'approved'
                and ((d.scope = 'product' and pp.id = d.ref_id)
                  or (d.scope = 'category' and public.fn_category_within(pp.leaf_category_id, d.ref_id)))
              where d.event_id = e.id) as max_percent
      from public.events e
      left join public.event_vendors ev on ev.event_id = e.id and ev.vendor_id = v_vendor
      where e.status = 'active' and e.ends_at > now() - interval '30 days'
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.fn_vendor_event_overview() from public, anon;
grant execute on function public.fn_vendor_event_overview() to authenticated;

commit;
