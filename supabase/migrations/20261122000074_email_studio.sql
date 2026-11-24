-- Additive migration: legacy HTML remains available during rollout/rollback.
begin;
alter table public.email_templates
  add column if not exists content_ar jsonb,
  add column if not exists content_en jsonb,
  add column if not exists draft_content jsonb,
  add column if not exists revision integer not null default 1,
  add column if not exists draft_updated_at timestamptz;
alter table public.contact_messages add column if not exists locale text check (locale in ('ar','en'));
-- Preserve the available language evidence for older conversations.
update public.contact_messages m set locale=coalesce(
 (select p.locale from public.profiles p where p.id=m.user_id),
 case when (coalesce(m.subject,'') || coalesce(m.message,'')) ~ '[ء-ي]' then 'ar' else 'en' end
) where locale is null;

create table if not exists public.email_template_versions (
  template_key text not null references public.email_templates(key) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid,
  primary key (template_key,version)
);
alter table public.email_template_versions enable row level security;
revoke all on public.email_template_versions from public, anon, authenticated;
grant all on public.email_template_versions to service_role;
insert into public.email_template_versions(template_key,version,snapshot)
select key,version,to_jsonb(t) from public.email_templates t on conflict do nothing;

create or replace function public.can_edit_email_templates()
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_permission('settings.email_templates') or public.has_permission('settings.manage');
$$;
revoke all on function public.can_edit_email_templates() from public;
grant execute on function public.can_edit_email_templates() to authenticated;

create or replace function public.fn_admin_email_templates()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_edit_email_templates() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  return jsonb_build_object('ok',true,'templates',coalesce((
    select jsonb_agg(to_jsonb(t) || jsonb_build_object('history',coalesce((
      select jsonb_agg(jsonb_build_object('version',v.version,'published_at',v.published_at)
        order by v.version desc) from public.email_template_versions v
      where v.template_key=t.key and v.snapshot->'content_ar' is not null and v.snapshot->'content_ar' <> 'null'::jsonb
    ),'[]'::jsonb)) order by t.key) from public.email_templates t
  ),'[]'::jsonb));
end $$;

-- Check field shape and placeholder allowlist even when called outside the UI.
create or replace function public.email_content_valid(p_content jsonb,p_variables jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare c jsonb; d jsonb; k text; token text; s text; max_length integer;
begin
  if jsonb_typeof(p_content) <> 'object' or not p_content ?& array['ar','en']
     or (select count(*) from jsonb_object_keys(p_content)) <> 2 then return false; end if;
  for c in select value from jsonb_each(p_content) loop
    if jsonb_typeof(c) <> 'object' or not c ?& array['subject','preheader','heading','body','details','buttonLabel','buttonUrl','note','code']
       or (select count(*) from jsonb_object_keys(c)) <> 9 then return false; end if;
    foreach k in array array['subject','preheader','heading','body','buttonLabel','buttonUrl','note','code'] loop
      max_length:=case k when 'subject' then 300 when 'preheader' then 300 when 'heading' then 300 when 'buttonLabel' then 120 when 'buttonUrl' then 2000 when 'note' then 3000 when 'code' then 120 else 12000 end;
      if jsonb_typeof(c->k) <> 'string' or length(c->>k)>max_length then return false; end if;
    end loop;
    if trim(c->>'subject')='' or trim(c->>'heading')='' or trim(c->>'body')='' then return false; end if;
    if jsonb_typeof(c->'details') <> 'array' or jsonb_array_length(c->'details')>12 then return false; end if;
    for d in select value from jsonb_array_elements(c->'details') loop
      if jsonb_typeof(d) <> 'object' or jsonb_typeof(d->'label') <> 'string' or jsonb_typeof(d->'value') <> 'string'
         or length(d->>'label')>2000 or length(d->>'value')>2000
         or (select count(*) from jsonb_object_keys(d)) <> 2 then return false; end if;
    end loop;
    if (trim(c->>'buttonLabel')='') <> (trim(c->>'buttonUrl')='') then return false; end if;
    s := c->>'buttonUrl';
    if s<>'' and s !~ '^https://' and s !~ '^\{\{\s*\w+\s*\}\}$' then return false; end if;
    for token in select (regexp_matches(c::text,'\{\{\s*(\w+)\s*\}\}','g'))[1] loop
      if not p_variables ? token then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function public.email_content_valid(jsonb,jsonb) from public;

create or replace function public.fn_admin_edit_email_template(
  p_key text,p_revision integer,p_intent text,p_content jsonb default null,
  p_restore_version integer default null,p_html_ar text default null,p_html_en text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.email_templates; c jsonb; updated public.email_templates;
begin
  if not public.can_edit_email_templates() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select * into t from public.email_templates where key=p_key for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if t.revision<>p_revision then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  if p_intent not in ('draft','publish','restore') then return jsonb_build_object('ok',false,'reason','bad_intent'); end if;
  if p_intent='restore' then
    select jsonb_build_object('ar',snapshot->'content_ar','en',snapshot->'content_en') into c
      from public.email_template_versions where template_key=p_key and version=p_restore_version;
  else c:=p_content; end if;
  if c is null or not public.email_content_valid(c,t.variables) then
    return jsonb_build_object('ok',false,'reason','invalid_content');
  end if;
  if p_key like 'auth:%' then
    if p_key='auth:invite' then
      if c->'ar'->>'buttonUrl' !~ '\{\{\s*confirmation_url\s*\}\}' or c->'en'->>'buttonUrl' !~ '\{\{\s*confirmation_url\s*\}\}' then
        return jsonb_build_object('ok',false,'reason','invalid_content');
      end if;
    elsif ((c->'ar'->>'body') || (c->'ar'->>'code')) !~ '\{\{\s*code\s*\}\}' or ((c->'en'->>'body') || (c->'en'->>'code')) !~ '\{\{\s*code\s*\}\}' then
      return jsonb_build_object('ok',false,'reason','invalid_content');
    end if;
  end if;
  if p_intent='draft' then
    update public.email_templates set draft_content=c,draft_updated_at=now(),revision=revision+1 where key=p_key returning * into updated;
  else
    update public.email_templates set content_ar=c->'ar',content_en=c->'en',
      subject_ar=c->'ar'->>'subject',subject_en=c->'en'->>'subject',
      html_ar=coalesce(p_html_ar,html_ar),html_en=coalesce(p_html_en,html_en),
      draft_content=null,draft_updated_at=null,version=version+1,revision=revision+1,
      updated_at=now(),updated_by=auth.uid() where key=p_key returning * into updated;
    insert into public.email_template_versions(template_key,version,snapshot,published_by)
      values(p_key,updated.version,to_jsonb(updated),auth.uid());
  end if;
  perform public.fn_audit('email_template.' || p_intent,'email_templates',p_key,null,
    jsonb_build_object('version',updated.version,'revision',updated.revision));
  return jsonb_build_object('ok',true,'version',updated.version,'revision',updated.revision);
end $$;
revoke all on function public.fn_admin_edit_email_template(text,integer,text,jsonb,integer,text,text) from public,anon;
grant execute on function public.fn_admin_edit_email_template(text,integer,text,jsonb,integer,text,text) to authenticated;

create or replace function public.fn_admin_set_email_template_active(p_key text,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.can_edit_email_templates() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_key like 'auth:%' then return jsonb_build_object('ok',false,'reason','security_required'); end if;
  update public.email_templates set is_active=p_active,revision=revision+1,updated_at=now(),updated_by=auth.uid() where key=p_key;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  perform public.fn_audit('email_template.active','email_templates',p_key,null,jsonb_build_object('is_active',p_active));
  return jsonb_build_object('ok',true);
end $$;

-- Keep the old editor RPC usable only for genuinely legacy rows; otherwise a
-- hidden HTML edit would diverge from the structured content being delivered.
create or replace function public.fn_admin_save_email_template(p_key text,p_subject_ar text,p_subject_en text,p_html_ar text,p_html_en text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.can_edit_email_templates() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if exists(select 1 from public.email_templates where key=p_key and content_ar is not null) then
    return jsonb_build_object('ok',false,'reason','use_structured_editor');
  end if;
  return jsonb_build_object('ok',false,'reason','use_structured_editor');
end $$;

create or replace function public.fn_set_preferred_locale(p_locale text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or p_locale not in ('ar','en') then return false; end if;
  update public.profiles set locale=p_locale where id=auth.uid() and locale is distinct from p_locale;
  return exists(select 1 from public.profiles where id=auth.uid());
end $$;
revoke all on function public.fn_set_preferred_locale(text) from public,anon;
grant execute on function public.fn_set_preferred_locale(text) to authenticated;

-- Auth has a 5-second HTTP hook budget. Accept a durable, AES-GCM-encrypted
-- job, then send outside the Auth transaction. Erase ciphertext on delivery.
create table if not exists public.auth_email_deliveries (
  id text primary key, status text not null check(status in ('pending','sending','sent','failed')),
  payload text, attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 hour',
  updated_at timestamptz not null default now()
);
alter table public.auth_email_deliveries enable row level security;
revoke all on public.auth_email_deliveries from public,anon,authenticated;
grant all on public.auth_email_deliveries to service_role;
create index if not exists auth_email_pending on public.auth_email_deliveries(next_attempt_at) where payload is not null;
create index if not exists auth_email_expiry on public.auth_email_deliveries(expires_at);
create or replace function public.fn_enqueue_auth_email(p_id text,p_payload text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_id !~ '^[0-9a-f]{64}$' or length(p_payload)>40000 or p_expires_at<=now() or p_expires_at>now()+interval '1 day' then raise exception 'invalid job'; end if;
  insert into public.auth_email_deliveries(id,status,payload,expires_at) values(p_id,'pending',p_payload,p_expires_at) on conflict(id) do nothing;
end $$;
revoke all on function public.fn_enqueue_auth_email(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_enqueue_auth_email(text,text,timestamptz) to service_role;
create or replace function public.fn_claim_auth_email(p_id text)
returns text language plpgsql security definer set search_path=public as $$
declare claimed text;
begin
  insert into public.auth_email_deliveries(id,status,attempts) values(p_id,'sending',1)
  on conflict(id) do update set status='sending',updated_at=now(),attempts=auth_email_deliveries.attempts+1
  where (auth_email_deliveries.status in ('pending','failed') or
    (auth_email_deliveries.status='sending' and auth_email_deliveries.updated_at<now()-interval '2 minutes'))
    and auth_email_deliveries.next_attempt_at<=now() and auth_email_deliveries.expires_at>now() and auth_email_deliveries.attempts<5
  returning id into claimed;
  if claimed is not null then return 'claimed'; end if;
  if exists(select 1 from public.auth_email_deliveries where id=p_id and status='sent') then return 'sent'; end if;
  return 'busy';
end $$;
revoke all on function public.fn_claim_auth_email(text) from public,anon,authenticated;
grant execute on function public.fn_claim_auth_email(text) to service_role;
notify pgrst,'reload schema';
commit;
