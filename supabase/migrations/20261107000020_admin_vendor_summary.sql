-- Admin → store detail: the page pulled EVERY order group and EVERY review
-- row of the store into Node just to add them up (unbounded payload that
-- grows with the store's history), plus 2 sequential owner lookups. This
-- returns the totals and the owner contact in one call, computed in SQL.
-- SECURITY INVOKER: exactly the caller's RLS, as the page's queries had.

create or replace function public.fn_admin_vendor_summary(p_vendor uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'products', (select count(*)::int from public.products
                  where vendor_id = p_vendor and status = 'approved' and deleted_at is null),
    'orders', g.orders,
    'sales', g.sales,
    'commission', g.commission,
    'rating_avg', r.avg,
    'rating_count', r.cnt,
    'wallet', (select jsonb_build_object('available_piastres', w.available_piastres, 'pending_piastres', w.pending_piastres)
                 from public.wallets w where w.vendor_id = p_vendor),
    'owner', (select jsonb_build_object('email', p.email, 'phone', p.phone, 'full_name', p.full_name)
                from public.store_members m join public.profiles p on p.id = m.user_id
               where m.vendor_id = p_vendor and m.role = 'owner' limit 1)
  )
  from (select count(*)::int as orders,
               coalesce(sum(items_subtotal_piastres), 0)::bigint as sales,
               coalesce(sum(commission_piastres), 0)::bigint as commission
          from public.order_vendor_groups where vendor_id = p_vendor) g,
       (select round(avg(rating)::numeric, 1) as avg, count(*)::int as cnt
          from public.reviews where vendor_id = p_vendor and status = 'published') r
$$;

revoke all on function public.fn_admin_vendor_summary(uuid) from public, anon;
grant execute on function public.fn_admin_vendor_summary(uuid) to authenticated, service_role;
