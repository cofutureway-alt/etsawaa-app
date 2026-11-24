-- Settings page clean-up — make the payment settings actually apply.
--
-- * fn_create_order read the COD cap from settings key 'checkout' while the
--   admin "Payments" card saves it under 'payments' → editing the cap did
--   nothing. It now reads 'payments' (falling back to 'checkout').
-- * payments.cod_enabled was saved but never checked → turning COD off did
--   nothing. fn_create_order now refuses COD with reason 'cod_disabled'.
-- * the "seller registration" toggle saved into 'general' but the /sell page
--   and fn_vendor_config read 'site.general' → copy any saved value over.
-- Patched in place from the live definition so nothing else in the function changes.

do $$
declare src text; n text;
begin
  src := pg_get_functiondef('public.fn_create_order'::regproc);

  n := replace(src,
    $a$from public.settings s where s.key = 'checkout';$a$,
    $b$from public.settings s where s.key in ('payments', 'checkout') and s.value ? 'cod_max_total_piastres'
     order by (s.key = 'payments') desc limit 1;$b$);
  if n = src then raise exception 'cod cap anchor not found'; end if;
  src := n;

  n := replace(src,
    $a$if v_total > v_cod_cap then$a$,
    $b$if coalesce((select (s.value->>'cod_enabled')::boolean from public.settings s where s.key = 'payments'), true) = false then
      return jsonb_build_object('ok', false, 'reason', 'cod_disabled');
    end if;
    if v_total > v_cod_cap then$b$);
  if n = src then raise exception 'cod check anchor not found'; end if;

  execute n;
end $$;

-- seller registration flag lives in site.general
update public.settings sg
   set value = sg.value || jsonb_build_object('vendor_registration_enabled', (g.value->>'vendor_registration_enabled')::boolean)
  from public.settings g
 where sg.key = 'site.general' and g.key = 'general' and g.value ? 'vendor_registration_enabled';
