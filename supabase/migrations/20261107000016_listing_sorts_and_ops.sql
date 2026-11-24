-- Owner round 2026-11-07 (part 2). Re-runnable.
--  * Listing sorts: best selling (units sold) and biggest discount.

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

select pg_temp.patch('public.fn_search_products(text,uuid,uuid,jsonb,integer,integer,numeric,boolean,text,integer,integer)',
  $o$    when 'rating'     then 'rating_count desc, rating_avg desc nulls last, published_at desc'$o$,
  $n$    when 'rating'     then 'rating_avg desc nulls last, rating_count desc, published_at desc'
    when 'best_selling' then 'sold_count desc, rating_avg desc nulls last, published_at desc'
    when 'discount'   then 'max_discount_percent desc, published_at desc'$n$,
  'best_selling');

-- ───────────────────────────── vendor analytics (dashboard)
-- One call for the seller's dashboard: period vs previous period, daily series,
-- top products / categories / governorates, buyers, cancellations, refunds,
-- reviews, stock value and views (recently-viewed rows as a views proxy).
create or replace function public.fn_vendor_analytics(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_vendor uuid := public.own_vendor_id();
  v_days int := least(greatest(coalesce(p_days, 30), 7), 365);
  v_from timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_prev timestamptz := v_from - make_interval(days => v_days);
  v_out jsonb;
begin
  if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'no_store'); end if;
  with g as (
    select og.*, o.user_id, o.governorate_id, o.created_at as placed_at
      from public.order_vendor_groups og join public.orders o on o.id = og.order_id
     where og.vendor_id = v_vendor and o.created_at >= v_prev and o.status <> 'pending_payment'
  ), cur as (select * from g where placed_at >= v_from), prv as (select * from g where placed_at < v_from),
  items as (
    select oi.*, o.created_at as placed_at from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.order_vendor_groups og on og.id = oi.group_id
     where oi.vendor_id = v_vendor and o.created_at >= v_from and og.status <> 'cancelled' and o.status <> 'pending_payment'
  )
  select jsonb_build_object(
    'ok', true, 'days', v_days,
    'kpi', jsonb_build_object(
      'revenue', coalesce((select sum(items_subtotal_piastres - discount_piastres) from cur where status <> 'cancelled'), 0),
      'revenue_prev', coalesce((select sum(items_subtotal_piastres - discount_piastres) from prv where status <> 'cancelled'), 0),
      'orders', (select count(*) from cur where status <> 'cancelled'),
      'orders_prev', (select count(*) from prv where status <> 'cancelled'),
      'units', coalesce((select sum(qty) from items), 0),
      'commission', coalesce((select sum(commission_piastres) from cur where status <> 'cancelled'), 0),
      'cancelled', (select count(*) from cur where status = 'cancelled'),
      'all_orders', (select count(*) from cur),
      'delivered', (select count(*) from cur where status = 'delivered'),
      'in_progress', (select count(*) from cur where status in ('pending', 'preparing', 'on_hold', 'handed_to_carrier', 'out_for_delivery')),
      'buyers', (select count(distinct user_id) from cur where status <> 'cancelled'),
      'repeat_buyers', (select count(*) from (select user_id from public.order_vendor_groups og2 join public.orders o2 on o2.id = og2.order_id
                         where og2.vendor_id = v_vendor and og2.status <> 'cancelled' and o2.status <> 'pending_payment' and o2.user_id is not null
                         group by user_id having count(*) > 1) r),
      'refunds', (select count(distinct rr.id) from public.refund_requests rr join cur on cur.order_id = rr.order_id),
      'avg_ship_hours', (select round(avg(extract(epoch from (shipped_at - placed_at)) / 3600)::numeric, 1) from cur where shipped_at is not null),
      'rating_avg', (select round(avg(rating), 2) from public.reviews where vendor_id = v_vendor and status = 'published'),
      'rating_count', (select count(*) from public.reviews where vendor_id = v_vendor and status = 'published'),
      'views', (select count(*) from public.recently_viewed rv join public.products p on p.id = rv.product_id where p.vendor_id = v_vendor and rv.viewed_at >= v_from),
      'stock_units', coalesce((select sum(v.stock) from public.variants v join public.products p on p.id = v.product_id
                       where p.vendor_id = v_vendor and p.deleted_at is null and v.deleted_at is null and v.is_active), 0),
      'stock_value', coalesce((select sum(v.stock::bigint * v.price_piastres) from public.variants v join public.products p on p.id = v.product_id
                       where p.vendor_id = v_vendor and p.deleted_at is null and v.deleted_at is null and v.is_active and v.price_piastres is not null), 0),
      'live_products', (select count(*) from public.products where vendor_id = v_vendor and status = 'approved' and deleted_at is null)
    ),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'revenue', coalesce(x.rev, 0), 'orders', coalesce(x.n, 0)) order by d)
       from generate_series(v_from, date_trunc('day', now()), interval '1 day') d
       left join (select date_trunc('day', placed_at) as dd, sum(items_subtotal_piastres - discount_piastres) as rev, count(*) as n
                    from cur where status <> 'cancelled' group by 1) x on x.dd = d), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(t order by t.revenue desc) from (
       select product_id as id, max(product_name_ar) name_ar, max(product_name_en) name_en, max(image_path) image,
              sum(qty) units, sum(line_total_piastres) revenue
         from items group by product_id order by sum(line_total_piastres) desc limit 5) t), '[]'::jsonb),
    'top_categories', coalesce((select jsonb_agg(t order by t.revenue desc) from (
       select c.name_ar, c.name_en, sum(i.qty) units, sum(i.line_total_piastres) revenue
         from items i join public.categories c on c.id = i.leaf_category_id group by c.id, c.name_ar, c.name_en
        order by sum(i.line_total_piastres) desc limit 5) t), '[]'::jsonb),
    'top_governorates', coalesce((select jsonb_agg(t order by t.orders desc) from (
       select gv.name_ar, gv.name_en, count(*) orders from cur join public.governorates gv on gv.id = cur.governorate_id
        where cur.status <> 'cancelled' group by gv.id, gv.name_ar, gv.name_en order by count(*) desc limit 5) t), '[]'::jsonb),
    'status_mix', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from cur group by status) s), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.fn_vendor_analytics(integer) from public, anon;
grant execute on function public.fn_vendor_analytics(integer) to authenticated;

-- ───────────────────────────── email templates: on/off + audience in the admin list
create or replace function public.fn_admin_email_templates()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return jsonb_build_object(
    'ok', true,
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', t.key, 'name_ar', nullif(t.name_ar, ''), 'name_en', nullif(t.name_en, ''),
        'subject_ar', t.subject_ar, 'subject_en', t.subject_en, 'html_ar', t.html_ar, 'html_en', t.html_en,
        'variables', coalesce(t.variables, '[]'::jsonb), 'version', t.version, 'updated_at', t.updated_at,
        'updated_by', t.updated_by, 'is_active', t.is_active, 'audience', t.audience
      ) order by t.audience, t.key)
      from public.email_templates t
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.fn_admin_set_email_template_active(p_key text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.email_templates set is_active = p_active, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.fn_audit('email_template.active', 'email_templates', p_key, null, jsonb_build_object('is_active', p_active));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_admin_set_email_template_active(text, boolean) to authenticated;

-- audiences of the original transactional templates
update public.email_templates set audience = 'customer'
 where key in ('order_cancelled', 'order_confirmation', 'order_delivered', 'order_shipped', 'payment_failed', 'payment_success') and audience = 'all';

-- ───────────────────────────── custom staff roles
create or replace function public.fn_admin_create_role(p_name_ar text, p_name_en text, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  if not public.has_permission('staff.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(length(trim(p_name_ar)), 0) < 2 or coalesce(length(trim(p_name_en)), 0) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;
  v_slug := 'role_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.roles (slug, name_ar, name_en, permissions, is_system)
  values (v_slug, trim(p_name_ar), trim(p_name_en),
          coalesce((select jsonb_agg(distinct k) from jsonb_array_elements_text(coalesce(p_permissions, '[]'::jsonb)) k
                     where k ~ '^[a-z_]+\.[a-z_]+$' and k <> 'staff.manage'), '[]'::jsonb), false);
  perform public.fn_audit('role.create', 'roles', v_slug, null, jsonb_build_object('name_ar', p_name_ar, 'name_en', p_name_en));
  return jsonb_build_object('ok', true, 'slug', v_slug);
end $$;
grant execute on function public.fn_admin_create_role(text, text, jsonb) to authenticated;

create or replace function public.fn_admin_update_role(p_slug text, p_name_ar text, p_name_en text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('staff.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.roles set name_ar = trim(p_name_ar), name_en = trim(p_name_en)
   where slug = p_slug and not is_system and slug not in ('admin', 'staff', 'vendor', 'customer');
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_admin_update_role(text, text, text) to authenticated;

create or replace function public.fn_admin_delete_role(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('staff.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_slug in ('admin', 'staff', 'vendor', 'customer') or exists (select 1 from public.roles where slug = p_slug and is_system) then
    return jsonb_build_object('ok', false, 'reason', 'system_role');
  end if;
  -- members fall back to the default staff role (FK on delete set null)
  delete from public.roles where slug = p_slug;
  perform public.fn_audit('role.delete', 'roles', p_slug, null, null);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_admin_delete_role(text) to authenticated;

-- permissions of the default staff role or a custom role; admin keeps '*', sellers/customers none.
-- Only an admin may hand out staff.manage (it lets the holder edit roles).
create or replace function public.fn_admin_set_role_permissions(p_slug text, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_perms jsonb;
begin
  if not (public.is_admin() or (public.has_permission('staff.manage') and p_slug not in ('admin', 'staff', 'vendor', 'customer'))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_slug in ('admin', 'vendor', 'customer') then return jsonb_build_object('ok', false, 'reason', 'system_role'); end if;
  select to_jsonb(r) into v_before from public.roles r where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_perms := coalesce((select jsonb_agg(distinct k) from jsonb_array_elements_text(coalesce(p_permissions, '[]'::jsonb)) k
                        where k ~ '^[a-z_]+\.[a-z_]+$' and (public.is_admin() or k <> 'staff.manage')), '[]'::jsonb);
  update public.roles set permissions = v_perms where slug = p_slug;
  perform public.fn_audit('role.permissions', 'roles', p_slug, v_before->'permissions', v_perms);
  return jsonb_build_object('ok', true);
end $$;
