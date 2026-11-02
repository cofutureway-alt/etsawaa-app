-- ============================================================================
-- Etsawaa — Phase 07 A-25: email template admin (list / save / version bump)
-- email_templates is definer-only (RLS off, no grants to authenticated), so the
-- admin UI reads and writes exclusively through these SECURITY DEFINER RPCs.
-- Every save is audited with before/after and bumps `version`.
-- ============================================================================

alter table public.email_templates
  add column if not exists version integer not null default 1,
  add column if not exists name_ar text not null default '',
  add column if not exists name_en text not null default '',
  add column if not exists scope   text not null default 'both'
    check (scope in ('ar','en','both'));

comment on column public.email_templates.version is 'Incremented on every admin save (A-25); shown in the editor header.';

-- email_logs gains an honest fourth state: the send was attempted while the
-- provider keys were missing (A-25 — no fake success, never a silent drop).
alter table public.email_logs drop constraint if exists email_logs_status_check;
alter table public.email_logs add constraint email_logs_status_check
  check (status in ('sent', 'failed', 'queued', 'not_configured'));

-- ----------------------------------------------------------------------------
-- 1) FN_ADMIN_EMAIL_TEMPLATES — the list the editor renders.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_email_templates()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return jsonb_build_object(
    'ok', true,
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', t.key,
        'name_ar', nullif(t.name_ar, ''),
        'name_en', nullif(t.name_en, ''),
        'subject_ar', t.subject_ar,
        'subject_en', t.subject_en,
        'html_ar', t.html_ar,
        'html_en', t.html_en,
        'variables', coalesce(t.variables, '[]'::jsonb),
        'version', t.version,
        'updated_at', t.updated_at,
        'updated_by', t.updated_by
      ) order by t.key)
      from public.email_templates t
    ), '[]'::jsonb)
  );
end $$;

-- ----------------------------------------------------------------------------
-- 2) FN_ADMIN_SAVE_EMAIL_TEMPLATE — validated server-side as well as in the UI.
--    Unknown variables / unclosed tags / empty subject or body are rejected
--    with a machine reason the editor maps to a localized message.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_save_email_template(
  p_key text, p_subject_ar text, p_subject_en text,
  p_html_ar text, p_html_en text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_declared text[];
  v_used text[];
  v_unknown text[];
  v_version integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select to_jsonb(t), array(select jsonb_array_elements_text(coalesce(t.variables, '[]'::jsonb)))
    into v_before, v_declared
    from public.email_templates t where t.key = p_key;
  if v_before is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(trim(p_subject_ar), '') = '' or coalesce(trim(p_subject_en), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty_subject');
  end if;
  if coalesce(trim(p_html_ar), '') = '' or coalesce(trim(p_html_en), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty_body');
  end if;

  -- unknown placeholders across all four fields
  select coalesce(array_agg(distinct name), '{}')
    into v_used
    from (
      select (regexp_matches(p_subject_ar || ' ' || p_subject_en || ' ' || p_html_ar || ' ' || p_html_en,
                             '\{\{\s*(\w+)\s*\}\}', 'g'))[1] as name
    ) m;
  v_unknown := array(select n from unnest(coalesce(v_used, '{}')) n where n <> all (v_declared));
  if coalesce(array_length(v_unknown, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'unknown_variables',
      'detail', array_to_string(v_unknown, ', '));
  end if;

  -- Tag structure (nesting-aware) is validated by lib/email/validate.ts in the
  -- route before this RPC is called; a counting heuristic here would reject
  -- valid nested templates and still miss crossed tags, so it is deliberately
  -- NOT duplicated in SQL. Empty subject/body + unknown variables are enforced
  -- here regardless of the client.

  update public.email_templates
     set subject_ar = p_subject_ar, subject_en = p_subject_en,
         html_ar = p_html_ar, html_en = p_html_en,
         version = version + 1, updated_at = now(), updated_by = auth.uid()
   where key = p_key
  returning version into v_version;

  perform public.fn_audit('email_template.saved', 'email_templates', p_key, v_before,
    jsonb_build_object('version', v_version,
      'subject_ar', left(p_subject_ar, 200), 'subject_en', left(p_subject_en, 200)));
  return jsonb_build_object('ok', true, 'version', v_version);
end $$;

-- ----------------------------------------------------------------------------
-- 3) FN_ADMIN_TEST_EMAIL — records the attempt in email_logs and reports the
--    provider state HONESTLY. With no RESEND key the row is written with
--    status='not_configured' and the UI shows the "provider not configured"
--    banner instead of pretending success.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_log_test_email(
  p_template text, p_to text, p_status text, p_error text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_status not in ('sent', 'failed', 'not_configured') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  insert into public.email_logs (to_email, template, provider, status, error, message_id)
  values (p_to, p_template, 'resend', p_status, p_error, null);
  perform public.fn_audit('email_template.test_send', 'email_templates', p_template, null,
    jsonb_build_object('to', p_to, 'status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 4) FN_ADMIN_EMAIL_STATUS — provider configuration state for the banner.
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_email_provider_state()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  -- the function cannot see Node env; the route passes its own probe instead.
  -- Kept as a single source for the settings mirror (provider row).
  return jsonb_build_object('ok', true,
    'provider', (select value->>'provider' from public.settings where key = 'emails'));
end $$;

revoke all on function public.fn_admin_email_templates(),
  public.fn_admin_save_email_template(text, text, text, text, text),
  public.fn_admin_log_test_email(text, text, text, text),
  public.fn_admin_email_provider_state() from public, anon;
grant execute on function public.fn_admin_email_templates(),
  public.fn_admin_save_email_template(text, text, text, text, text),
  public.fn_admin_log_test_email(text, text, text, text),
  public.fn_admin_email_provider_state() to authenticated;

-- Human names for the known templates (idempotent; empty stays NULL in the UI)
update public.email_templates set name_ar = case key
    when 'welcome' then 'ترحيب بحساب جديد'
    when 'order_confirmation' then 'تأكيد الطلب'
    when 'payment_success' then 'نجاح الدفع'
    when 'payment_failed' then 'فشل الدفع'
    when 'order_shipped' then 'تم الشحن'
    when 'order_delivered' then 'تم التسليم'
    when 'order_cancelled' then 'إلغاء الطلب'
  end,
  name_en = case key
    when 'welcome' then 'Welcome email'
    when 'order_confirmation' then 'Order confirmation'
    when 'payment_success' then 'Payment success'
    when 'payment_failed' then 'Payment failed'
    when 'order_shipped' then 'Order shipped'
    when 'order_delivered' then 'Order delivered'
    when 'order_cancelled' then 'Order cancelled'
  end
where key in ('welcome','order_confirmation','payment_success','payment_failed',
              'order_shipped','order_delivered','order_cancelled');
