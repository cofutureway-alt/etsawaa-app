-- ============================================================================
-- Store settings changes go through admin review
--
-- An active store's public/identity settings (names, descriptions, logo,
-- banner, categories, owner name, phone, address, socials) are no longer
-- written directly: the seller files a change request holding only the
-- fields that differ, with the old values captured next to the new ones.
-- An admin approves (changes applied) or rejects (with a reason); every
-- request stays on file as the audit history. One pending request per store
-- — a new submission replaces it.
--
-- Enforced in the database: a trigger refuses direct owner updates of those
-- columns on an active store (SECURITY DEFINER paths and admins are exempt).
-- ============================================================================
begin;

create table if not exists public.vendor_change_requests (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  changes jsonb not null,
  previous jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text,
  requested_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists vendor_change_requests_one_pending
  on public.vendor_change_requests (vendor_id) where status = 'pending';
create index if not exists vendor_change_requests_status_idx on public.vendor_change_requests (status, created_at desc);

alter table public.vendor_change_requests enable row level security;
drop policy if exists vcr_read on public.vendor_change_requests;
create policy vcr_read on public.vendor_change_requests for select to authenticated
  using (public.is_admin() or exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()));
grant select on public.vendor_change_requests to authenticated;

-- the columns that need review
create or replace function public.fn_store_review_fields()
returns text[] language sql immutable as $$
  select array['store_name_ar', 'store_name_en', 'short_desc_ar', 'short_desc_en', 'welcome_msg_ar', 'welcome_msg_en',
               'logo_path', 'banner_path', 'category_ids', 'first_name', 'last_name', 'phone',
               'governorate_id', 'area_id', 'address1', 'address2', 'postal_code', 'socials']
$$;

-- '' and {} (or an object of empty strings) mean "nothing" — not a change
create or replace function public.fn_norm_change(j jsonb)
returns jsonb language sql immutable as $$
  select case
    when j is null or jsonb_typeof(j) = 'null' then null
    when jsonb_typeof(j) = 'string' and btrim(j #>> '{}') = '' then null
    when jsonb_typeof(j) = 'object' then (
      select case when count(*) = 0 then null else jsonb_object_agg(k, v) end
      from jsonb_each(j) as e(k, v)
      where not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = ''))
    )
    when jsonb_typeof(j) = 'array' and jsonb_array_length(j) = 0 then null
    else j end
$$;

create or replace function public.fn_guard_store_settings()
returns trigger language plpgsql as $$
declare
  f text;
begin
  -- only direct writes by the API role are checked; definer RPCs run as owner
  if current_user <> 'authenticated' or public.is_admin() or old.status <> 'active' then
    return new;
  end if;
  foreach f in array public.fn_store_review_fields() loop
    if public.fn_norm_change(to_jsonb(old) -> f) is distinct from public.fn_norm_change(to_jsonb(new) -> f) then
      raise exception 'store_change_requires_review' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_guard_store_settings on public.vendors;
create trigger trg_guard_store_settings before update on public.vendors
  for each row execute function public.fn_guard_store_settings();

-- seller: file (or replace) the pending request
create or replace function public.fn_vendor_request_store_change(p_changes jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_prev jsonb := '{}'::jsonb;
  f text;
  v_id uuid;
begin
  perform public.fn_assert_my_store_operational();
  select * into v_vendor from public.vendors where owner_id = auth.uid();
  if v_vendor.id is null then return jsonb_build_object('ok', false, 'reason', 'no_store'); end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_payload'); end if;
  v_old := to_jsonb(v_vendor);
  foreach f in array public.fn_store_review_fields() loop
    if p_changes ? f and public.fn_norm_change(p_changes -> f) is distinct from public.fn_norm_change(v_old -> f) then
      v_changes := v_changes || jsonb_build_object(f, p_changes -> f);
      v_prev := v_prev || jsonb_build_object(f, v_old -> f);
    end if;
  end loop;
  if (v_changes ? 'store_name_ar' and btrim(coalesce(v_changes ->> 'store_name_ar', '')) = '')
     or (v_changes ? 'store_name_en' and btrim(coalesce(v_changes ->> 'store_name_en', '')) = '') then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  update public.vendor_change_requests set status = 'cancelled', reviewed_at = now()
   where vendor_id = v_vendor.id and status = 'pending';
  if v_changes = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  insert into public.vendor_change_requests (vendor_id, changes, previous, requested_by)
  values (v_vendor.id, v_changes, v_prev, auth.uid()) returning id into v_id;

  perform public.fn_notify(a.id, 'vendor.change_request', jsonb_build_object('vendor_id', v_vendor.id, 'store_name_ar', v_vendor.store_name_ar, 'request_id', v_id))
    from public.profiles a where a.role = 'admin';
  return jsonb_build_object('ok', true, 'request_id', v_id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_changes) k));
end $$;

-- seller: withdraw the pending request
create or replace function public.fn_vendor_cancel_store_change()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.vendor_change_requests r set status = 'cancelled', reviewed_at = now()
   from public.vendors v
   where v.id = r.vendor_id and v.owner_id = auth.uid() and r.status = 'pending';
  return jsonb_build_object('ok', true);
end $$;

-- admin: approve (apply) or reject (reason required)
create or replace function public.fn_admin_decide_store_change(p_request uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req public.vendor_change_requests%rowtype;
  v_rec public.vendors%rowtype;
  v_owner uuid;
  f text;
begin
  if not (public.is_admin() or public.has_permission('vendors.review')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then return jsonb_build_object('ok', false, 'reason', 'bad_decision'); end if;
  select * into v_req from public.vendor_change_requests where id = p_request for update;
  if v_req.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  if p_decision = 'approve' then
    v_rec := jsonb_populate_record(null::public.vendors, v_req.changes);
    foreach f in array public.fn_store_review_fields() loop
      if v_req.changes ? f then
        execute format('update public.vendors set %I = ($1).%I, updated_at = now() where id = $2', f, f) using v_rec, v_req.vendor_id;
      end if;
    end loop;
  end if;

  update public.vendor_change_requests set
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    reason = nullif(btrim(coalesce(p_reason, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = v_req.id;

  select owner_id into v_owner from public.vendors where id = v_req.vendor_id;
  perform public.fn_notify(v_owner, 'vendor.change_' || p_decision || 'd',
    jsonb_build_object('vendor_id', v_req.vendor_id, 'request_id', v_req.id, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'vendor.change_' || p_decision, 'vendors', v_req.vendor_id::text, v_req.previous,
          case when p_decision = 'approve' then v_req.changes else jsonb_build_object('rejected', v_req.changes, 'reason', p_reason) end);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_vendor_request_store_change(jsonb) from public, anon;
revoke all on function public.fn_vendor_cancel_store_change() from public, anon;
revoke all on function public.fn_admin_decide_store_change(uuid, text, text) from public, anon;
grant execute on function public.fn_vendor_request_store_change(jsonb) to authenticated;
grant execute on function public.fn_vendor_cancel_store_change() to authenticated;
grant execute on function public.fn_admin_decide_store_change(uuid, text, text) to authenticated;

commit;
