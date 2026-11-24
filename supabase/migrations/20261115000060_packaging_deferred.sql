-- Packaging: a new payment method "deferred" (owner request) — nothing paid
-- now; the full amount is collected from the vendor's earnings when their
-- first order is delivered (the existing balance collection). Until it is
-- paid in full, the store accepts at most `deferred_max_orders` customer
-- orders (default 10, admin settings → packaging).

alter table public.packaging_orders drop constraint if exists packaging_orders_payment_method_check;
alter table public.packaging_orders add constraint packaging_orders_payment_method_check
  check (payment_method = any (array['card', 'cod', 'deferred']));
alter table public.packaging_orders drop constraint if exists packaging_orders_payment_status_check;
alter table public.packaging_orders add constraint packaging_orders_payment_status_check
  check (payment_status = any (array['unpaid', 'deposit_paid', 'paid', 'cod_pending', 'deferred', 'refunded', 'partially_refunded']));

create or replace function public.fn_packaging_settings()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'split_enabled', coalesce((s.value->>'split_enabled')::boolean, true),
    'split_percent', least(greatest(coalesce((s.value->>'split_percent')::int, 50), 1), 99),
    'max_open_balances', greatest(coalesce((s.value->>'max_open_balances')::int, 1), 0),
    'return_window_days', greatest(coalesce((s.value->>'return_window_days')::int, 14), 0),
    'cod_enabled', coalesce((s.value->>'cod_enabled')::boolean, true),
    'deferred_enabled', coalesce((s.value->>'deferred_enabled')::boolean, true),
    'deferred_max_orders', greatest(coalesce((s.value->>'deferred_max_orders')::int, 10), 1))
  from (select (select value from public.settings where key = 'packaging') as value) s;
$$;

-- true while a deferred packaging order is unpaid and the store already took
-- the allowed number of customer orders since it was placed
create or replace function public.fn_packaging_order_cap_reached(p_vendor uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
      from public.packaging_balances b
      join public.packaging_orders o on o.id = b.order_id
     where b.vendor_id = p_vendor and b.status = 'open' and b.amount_piastres > 0
       and o.payment_method = 'deferred' and o.status <> 'cancelled'
       and (select count(*) from public.order_vendor_groups g
             where g.vendor_id = p_vendor and g.created_at >= b.created_at)
           >= (public.fn_packaging_settings()->>'deferred_max_orders')::int);
$$;
revoke all on function public.fn_packaging_order_cap_reached(uuid) from public;
grant execute on function public.fn_packaging_order_cap_reached(uuid) to authenticated, service_role;

-- vendor view of the cap (packaging page + dashboard notice)
create or replace function public.fn_vendor_deferred_status()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select jsonb_build_object(
      'open', true,
      'amount_piastres', b.amount_piastres,
      'number', o.number,
      'orders_taken', (select count(*) from public.order_vendor_groups g where g.vendor_id = b.vendor_id and g.created_at >= b.created_at),
      'max_orders', (public.fn_packaging_settings()->>'deferred_max_orders')::int)
      from public.packaging_balances b
      join public.packaging_orders o on o.id = b.order_id
     where b.vendor_id = public.own_vendor_id() and b.status = 'open' and b.amount_piastres > 0
       and o.payment_method = 'deferred' and o.status <> 'cancelled'
     order by b.created_at limit 1), jsonb_build_object('open', false));
$$;
revoke all on function public.fn_vendor_deferred_status() from public;
grant execute on function public.fn_vendor_deferred_status() to authenticated;

-- placing: accept method 'deferred' (full plan, confirmed at once, the whole
-- total opens a balance collected from earnings)
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_vendor_place_packaging_order'::regproc) into v_src;
  if position('deferred' in v_src) > 0 then return; end if;
  v_new := v_src;
  v_new := replace(v_new,
    'if v_plan not in (''full'', ''split'') or v_method not in (''card'', ''cod'') then',
    'if v_plan not in (''full'', ''split'') or v_method not in (''card'', ''cod'', ''deferred'') then');
  v_new := replace(v_new,
    'if v_method = ''cod'' and not (v_cfg->>''cod_enabled'')::boolean then return jsonb_build_object(''ok'', false, ''reason'', ''cod_disabled''); end if;',
    'if v_method = ''cod'' and not (v_cfg->>''cod_enabled'')::boolean then return jsonb_build_object(''ok'', false, ''reason'', ''cod_disabled''); end if;
  if v_method = ''deferred'' and not (v_cfg->>''deferred_enabled'')::boolean then return jsonb_build_object(''ok'', false, ''reason'', ''deferred_disabled''); end if;
  if v_method = ''deferred'' and v_plan <> ''full'' then return jsonb_build_object(''ok'', false, ''reason'', ''bad_plan''); end if;
  if v_method = ''deferred'' and (select count(*) from public.packaging_balances b
                                   where b.vendor_id = v_vendor.id and b.status = ''open'') >= greatest((v_cfg->>''max_open_balances'')::int, 1) then
    return jsonb_build_object(''ok'', false, ''reason'', ''open_balance_exists'');
  end if;');
  v_new := replace(v_new,
    'status = case when v_method = ''cod'' then ''confirmed'' else ''pending_payment'' end,',
    'status = case when v_method in (''cod'', ''deferred'') then ''confirmed'' else ''pending_payment'' end,');
  v_new := replace(v_new,
    'payment_status = case when v_method = ''cod'' then ''cod_pending'' else ''unpaid'' end,',
    'payment_status = case when v_method = ''cod'' then ''cod_pending'' when v_method = ''deferred'' then ''deferred'' else ''unpaid'' end,');
  v_new := replace(v_new,
    'confirmed_at = case when v_method = ''cod'' then now() else null end',
    'confirmed_at = case when v_method in (''cod'', ''deferred'') then now() else null end');
  v_new := replace(v_new,
    '  perform public.fn_packaging_event(v_order.id, null, ''placed'', null,',
    '  if v_method = ''deferred'' then
    insert into public.packaging_balances (vendor_id, order_id, amount_piastres, original_piastres, note)
    values (v_vendor.id, v_order.id, v_total, v_total, ''deferred: collected from the first delivered order'')
    on conflict (order_id) do nothing;
  end if;
  perform public.fn_packaging_event(v_order.id, null, ''placed'', null,');
  if (length(v_new) - length(replace(v_new, 'deferred', ''))) / 8 < 10 then
    raise exception 'fn_vendor_place_packaging_order changed shape; patch not applied';
  end if;
  execute v_new;
end $$;

-- checkout: a store over its deferred-packaging cap cannot take new orders
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_create_order'::regproc) into v_src;
  if position('fn_packaging_order_cap_reached' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    'or not public.vendor_can_sell(r.vendor_id)',
    'or not public.vendor_can_sell(r.vendor_id)
        or public.fn_packaging_order_cap_reached(r.vendor_id)');
  if v_new = v_src then raise exception 'fn_create_order changed shape; patch not applied'; end if;
  execute v_new;
end $$;

update public.settings set value = value || '{"deferred_enabled": true, "deferred_max_orders": 10}'::jsonb
 where key = 'packaging' and not (value ? 'deferred_max_orders');
