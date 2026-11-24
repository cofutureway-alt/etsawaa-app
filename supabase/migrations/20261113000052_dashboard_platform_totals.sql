-- Admin dashboard: the platform's basic counts — users, customers, vendors,
-- customer-support staff, admins, products (live / all) and orders (all time).
do $$
declare v_def text := pg_get_functiondef('public.fn_admin_dashboard(integer)'::regprocedure);
begin
  if position('''users_all''' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
    '''customers'', (select count(*) from public.profiles where role = ''customer'' and status = ''active''),',
    '''customers'', (select count(*) from public.profiles where role = ''customer'' and status = ''active''),
      ''users_all'', (select count(*) from public.profiles),
      ''support'', (select count(*) from public.profiles where role = ''staff''),
      ''admins'', (select count(*) from public.profiles where role = ''admin''),
      ''vendors_all'', (select count(*) from public.vendors),
      ''products_all'', (select count(*) from public.products where deleted_at is null),
      ''products_live'', (select count(*) from public.v_storefront_products vp where vp.is_listable),
      ''orders_all'', (select count(*) from public.orders where payment_mode = ''live''),');
  if position('''users_all''' in v_def) = 0 then raise exception 'fn_admin_dashboard shape changed'; end if;
  execute v_def;
end $$;
notify pgrst, 'reload schema';
