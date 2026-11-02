-- ============================================================================
-- Etsawaa — Phase 01 RLS test suite (F-16 / Gate G2)
-- Run as postgres against the Supabase project (Management API query endpoint
-- or psql). Each assertion impersonates anon/authenticated via SET LOCAL ROLE
-- + request.jwt.claims, measures inside that scope, then records the result
-- AFTER restoring the role. Any failure fails the final summary.
-- ============================================================================

create temp table if not exists rls_results (
  id int primary key,
  label text not null,
  passed boolean not null,
  detail text
);

-- ---------------------------------------------------------------------------
-- Fixture users (idempotent): two customers + one staff without users.manage
-- ---------------------------------------------------------------------------
do $$
declare
  u_a uuid; u_b uuid; u_s uuid;
begin
  select id into u_a from auth.users where email = 'rls-customer-a@example.com';
  if u_a is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'rls-customer-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Customer A","phone_e164":"+201000000001","locale":"ar"}', now(), now(), '', '', '', '', '')
    returning id into u_a;
  end if;

  select id into u_b from auth.users where email = 'rls-customer-b@example.com';
  if u_b is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'rls-customer-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Customer B","phone_e164":"+201000000002","locale":"ar"}', now(), now(), '', '', '', '', '')
    returning id into u_b;
  end if;

  select id into u_s from auth.users where email = 'rls-staff@example.com';
  if u_s is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'rls-staff@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Staff","locale":"ar"}', now(), now(), '', '', '', '', '')
    returning id into u_s;
    update public.profiles set role = 'staff' where id = u_s;
  end if;

  insert into public.user_addresses (user_id, full_name, phone, governorate_id, area_id, address1)
  select u_a, 'A', '+201000000001', 1, (select id from public.areas where governorate_id = 1 limit 1), 'addr A'
  where not exists (select 1 from public.user_addresses where user_id = u_a);

  insert into public.user_addresses (user_id, full_name, phone, governorate_id, area_id, address1)
  select u_b, 'B', '+201000000002', 1, (select id from public.areas where governorate_id = 1 limit 1), 'addr B'
  where not exists (select 1 from public.user_addresses where user_id = u_b);

  insert into public.notifications (user_id, type, payload)
  select u_b, 'test', '{"ar":{"title":"t","body":"b"},"en":{"title":"t","body":"b"}}'::jsonb
  where not exists (select 1 from public.notifications where user_id = u_b);

  perform set_config('rls.u_a', u_a::text, false);
  perform set_config('rls.u_b', u_b::text, false);
  perform set_config('rls.u_s', u_s::text, false);
end $$;

-- 1) Guest denied on profiles
do $$
declare v_count int; v_denied boolean := false;
begin
  begin
    set local role anon;
    begin
      select count(*) into v_count from public.profiles;
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (1, 'Guest denied on profiles', coalesce((v_denied or v_count = 0), false),
          case when v_denied then 'permission denied (no grant)' else format('rows=%s', v_count) end)
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 2) Guest denied on roles
do $$
declare v_denied boolean := false; v_rows int := 0;
begin
  begin
    set local role anon;
    begin
      select count(*) into v_rows from public.roles;
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (2, 'Guest denied on roles', coalesce((v_denied or v_rows = 0), false),
          case when v_denied then 'permission denied' else format('rows=%s', v_rows) end)
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 3) Guest denied on audit_logs
do $$
declare v_denied boolean := false; v_rows int := 0;
begin
  begin
    set local role anon;
    begin
      select count(*) into v_rows from public.audit_logs;
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (3, 'Guest denied on audit_logs', coalesce((v_denied or v_rows = 0), false),
          case when v_denied then 'permission denied' else format('rows=%s', v_rows) end)
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 4) Guest settings read = public allowlist only
do $$
declare v_keys text;
begin
  begin
    set local role anon;
    select string_agg(key, ',' order by key) into v_keys from public.settings;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (4, 'Guest sees only public setting keys',
          coalesce((v_keys = 'settings.design,site.general'), false), coalesce(v_keys, 'none'))
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 5) Guest denied on notifications
do $$
declare v_denied boolean := false; v_rows int := 0;
begin
  begin
    set local role anon;
    begin
      select count(*) into v_rows from public.notifications;
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (5, 'Guest denied on notifications', coalesce((v_denied or v_rows = 0), false),
          case when v_denied then 'permission denied' else format('rows=%s', v_rows) end)
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 6) Guest denied on email_logs
do $$
declare v_denied boolean := false; v_rows int := 0;
begin
  begin
    set local role anon;
    begin
      select count(*) into v_rows from public.email_logs;
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (6, 'Guest denied on email_logs', coalesce((v_denied or v_rows = 0), false),
          case when v_denied then 'permission denied' else format('rows=%s', v_rows) end)
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 7) Customer A cannot read B addresses; sees own
do $$
declare v_b uuid; v_a uuid; v_foreign int := -1; v_own int := -1;
begin
  v_a := current_setting('rls.u_a')::uuid;
  v_b := current_setting('rls.u_b')::uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_a), true);
    select count(*) into v_foreign from public.user_addresses where user_id = v_b;
    select count(*) into v_own from public.user_addresses where user_id = v_a;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (7, 'Customer A cannot read B addresses; sees own',
          coalesce((v_foreign = 0 and v_own = 1), false), format('foreign=%s own=%s', v_foreign, v_own))
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 8) Customer A cannot read B profile; sees own
do $$
declare v_b uuid; v_a uuid; v_foreign int := -1; v_own int := -1;
begin
  v_a := current_setting('rls.u_a')::uuid;
  v_b := current_setting('rls.u_b')::uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_a), true);
    select count(*) into v_foreign from public.profiles where id = v_b;
    select count(*) into v_own from public.profiles where id = v_a;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (8, 'Customer A cannot read B profile; sees own',
          coalesce((v_foreign = 0 and v_own = 1), false), format('foreign=%s own=%s', v_foreign, v_own))
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 9) Customer A cannot read B notifications
do $$
declare v_b uuid; v_a uuid; v_rows int := -1;
begin
  v_a := current_setting('rls.u_a')::uuid;
  v_b := current_setting('rls.u_b')::uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_a), true);
    select count(*) into v_rows from public.notifications where user_id = v_b;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (9, 'Customer A cannot read B notifications', coalesce((v_rows = 0), false), format('rows=%s', v_rows))
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 10) Customer cannot escalate own role (column grant blocks UPDATE on role)
do $$
declare v_a uuid; v_denied boolean := false;
begin
  v_a := current_setting('rls.u_a')::uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_a), true);
    begin
      update public.profiles set role = 'admin' where id = v_a;
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (10, 'Customer cannot self-escalate role', v_denied, 'column grant blocked UPDATE on role')
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 11) Authenticated cannot insert audit_logs
do $$
declare v_a uuid; v_denied boolean := false;
begin
  v_a := current_setting('rls.u_a')::uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_a), true);
    begin
      insert into public.audit_logs (actor, action, entity) values (v_a, 'forgery', 'audit_logs');
    exception when insufficient_privilege then v_denied := true;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (11, 'Authenticated cannot insert audit_logs', v_denied, 'service/definer-only')
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 12) Staff without users.manage cannot call fn_admin_set_role
do $$
declare v_s uuid; v_a uuid; v_denied boolean := false; v_msg text := '';
begin
  v_s := current_setting('rls.u_s')::uuid;
  v_a := current_setting('rls.u_a')::uuid;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_s), true);
    begin
      perform public.fn_admin_set_role(v_a, 'admin');
    exception when others then
      v_denied := true; v_msg := sqlerrm;
    end;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (12, 'Staff without users.manage cannot change roles', v_denied, v_msg)
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 13) fn_resolve_email_from_phone resolves Customer A phone (anon callable)
do $$
declare v_email text;
begin
  begin
    set local role anon;
    select public.fn_resolve_email_from_phone('+201000000001') into v_email;
  end;
  reset role;
  insert into rls_results (id, label, passed, detail)
  values (13, 'Phone resolves to registered email (anon RPC)',
          coalesce((v_email = 'rls-customer-a@example.com'), false), coalesce(v_email, 'null'))
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- 14) Phone uniqueness: second profile with the same phone is rejected
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'rls-dup@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Dup","phone_e164":"+201000000001","locale":"ar"}', now(), now(), '', '', '', '', '');
  exception when unique_violation then v_blocked := true;
  end;
  insert into rls_results (id, label, passed, detail)
  values (14, 'Duplicate phone rejected by UNIQUE index', v_blocked, 'profiles_phone_unique')
  on conflict (id) do update set label = excluded.label, passed = excluded.passed, detail = excluded.detail;
end $$;

-- ---------------------------------------------------------------------------
-- Final verdict + full results dump
-- ---------------------------------------------------------------------------
do $$
declare v_failed int; v_total int;
begin
  select count(*) filter (where not passed), count(*) into v_failed, v_total from rls_results;
  raise notice 'RLS SUITE: %/% passed', v_total - v_failed, v_total;
  if v_failed > 0 then
    raise exception 'RLS suite FAILED: % of % assertions', v_failed, v_total;
  end if;
end $$;

select id, label, passed, coalesce(detail, '') as detail from rls_results order by id;
