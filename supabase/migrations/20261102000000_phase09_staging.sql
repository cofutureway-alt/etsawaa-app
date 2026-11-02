-- ============================================================================
-- Etsawaa — Phase 09 Data Import (D-01): staging schema
-- Staging-first: every imported row carries batch_id; rollback deletes by
-- batch (FK cascade from import_batches). Publish to production catalog
-- tables is a SEPARATE explicit admin action (D-14 gate) — and per the phase
-- mandate production writes stay deferred (D-16): the publish RPC enforces
-- the gate, then refuses until the owner provides the target DB.
-- Idempotency: natural keys (source_key) unique per batch. Re-runs upsert.
-- RLS: admin read-only; vendor/customer/anon = deny; writes only via the
-- server-side CLI using the service role (bypasses RLS).
-- Apply: node --env-file=.env scripts/apply-migration.mjs <this file>
-- ============================================================================

-- ---------------------------------------------------------------- batches
create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  batch_no    bigint generated always as identity,
  dataset     text not null,                          -- categories|types|specs|groups|areas|templates|shared
  source_files jsonb not null default '[]'::jsonb,   -- [{path, sha256, rows}]
  status      text not null default 'staged' check (status in ('staged','published','rolled_back')),
  staged_rows integer not null default 0,
  rejected_rows integer not null default 0,
  published_rows integer not null default 0,
  dry_run     boolean not null default false,
  notes       text not null default '',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists import_batches_dataset_idx on public.import_batches (dataset, created_at desc);

-- ------------------------------------------------------- categories staging
create table if not exists public.staging_categories (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.import_batches(id) on delete cascade,
  src_row     integer not null,                       -- source row number (audit)
  level       smallint not null check (level between 1 and 3),
  source_key  text not null,                          -- 'l1' | 'l1/l2' | 'l1/l2/l3' (EN path, natural key)
  parent_key  text,                                   -- parent source_key (null for L1)
  name_ar     text not null default '',
  name_en     text not null default '',
  slug_ar     text not null,
  slug_en     text not null,
  sort        integer not null default 0,
  ar_missing  boolean not null default false,          -- flagged: EN fallback in use
  created_at  timestamptz not null default now(),
  constraint staging_categories_key_unique unique (batch_id, source_key)
);
create index if not exists staging_categories_batch_idx on public.staging_categories (batch_id);

-- ------------------------------------------------- product types staging (L4)
create table if not exists public.staging_types (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.import_batches(id) on delete cascade,
  src_row       integer not null,
  name_en       text not null,
  name_ar       text not null default '',
  source_key    text not null,                         -- slug of the unique type name
  leaf_keys     text[] not null default '{}',          -- L3 category source_keys (1+; shared types have many)
  template_kind text not null check (template_kind in ('exact','new_family','none')),
  group_key     text,                                  -- staging_groups.source_key
  created_at    timestamptz not null default now(),
  constraint staging_types_key_unique unique (batch_id, source_key)
);
create index if not exists staging_types_batch_idx on public.staging_types (batch_id);

-- --------------------------------------------------------- specs staging
create table if not exists public.staging_specs (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.import_batches(id) on delete cascade,
  src_row    integer not null,
  src_id     integer,                                  -- id column from specs.json (trace)
  name_en    text not null,
  name_ar    text not null default '',
  source_key text not null,                            -- slug of EN name
  spec_type  text not null check (spec_type in ('text','number')),
  unit_en    text not null default '',
  unit_ar    text not null default '',
  ar_missing boolean not null default false,
  created_at timestamptz not null default now(),
  constraint staging_specs_key_unique unique (batch_id, source_key)
);
create index if not exists staging_specs_batch_idx on public.staging_specs (batch_id);

-- --------------------------------------------------------- groups staging
create table if not exists public.staging_groups (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.import_batches(id) on delete cascade,
  src_row    integer not null,
  name_en    text not null,
  name_ar    text not null default '',
  source_key text not null,                             -- slug of group name
  spec_keys  text[] not null default '{}',              -- spec source_keys (order kept)
  created_at timestamptz not null default now(),
  constraint staging_groups_key_unique unique (batch_id, source_key)
);
create index if not exists staging_groups_batch_idx on public.staging_groups (batch_id);

-- links materialized for validation & publish (denormalized by design)
create table if not exists public.staging_group_links (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.import_batches(id) on delete cascade,
  group_key  text not null,
  spec_key   text not null,
  sort       integer not null default 0,
  constraint staging_group_links_unique unique (batch_id, group_key, spec_key)
);
create index if not exists staging_group_links_batch_idx on public.staging_group_links (batch_id);

-- ---------------------------------------------------------------- templates
create table if not exists public.staging_templates (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.import_batches(id) on delete cascade,
  src_row       integer not null,
  version       integer not null default 1,             -- bumped on edit after products reference it (US-02)
  type_key      text not null,                          -- staging_types.source_key
  group_key     text,                                   -- staging_groups.source_key (exact templates)
  family        text not null default '',               -- family id for new_family templates
  fields        text[] not null default '{}',           -- ordered spec source_keys
  variant_axes  text[] not null default '{}',           -- subset of fields (Color|Size|Storage|RAM|Capacity)
  source        text not null check (source in ('exact','new_family')),
  confidence    text not null default 'review' check (confidence in ('exact','review','none')),
  review_status text not null default 'pending' check (review_status in ('pending','approved','adjusted','rejected')),
  review_note   text not null default '',
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  is_latest     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint staging_templates_type_version_unique unique (batch_id, type_key, version)
);
create index if not exists staging_templates_type_idx on public.staging_templates (type_key, is_latest);
create index if not exists staging_templates_review_idx on public.staging_templates (review_status);

-- ---------------------------------------------------------------- geography
create table if not exists public.staging_areas (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.import_batches(id) on delete cascade,
  src_row     integer not null,
  gov_name_ar text not null,
  gov_name_en text not null,
  gov_key     text not null,                             -- gov slug (natural key)
  name_ar     text not null,
  name_en     text not null default '',
  source_key  text not null,                             -- govKey + '/' + area slug (natural key)
  shipping_fee_piastres integer not null default 10000 check (shipping_fee_piastres between 0 and 1000000),
  pickup_fee_piastres   integer not null default 2000 check (pickup_fee_piastres between 0 and 1000000),
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint staging_areas_key_unique unique (batch_id, source_key)
);
create index if not exists staging_areas_batch_idx on public.staging_areas (batch_id);
-- duplicates INSIDE the same governorate are rejected at import time (rule);
-- this guard makes it structural: one normalized AR name per governorate/batch.
create unique index if not exists staging_areas_gov_arname_unique
  on public.staging_areas (batch_id, gov_key, name_ar);

-- ------------------------------------------------- shared products staging
create table if not exists public.staging_shared_products (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.import_batches(id) on delete cascade,
  src_row    integer not null,
  type_en    text not null,
  type_ar    text not null default '',
  type_key   text not null,                              -- staging_types.source_key
  cat_keys   text[] not null default '{}',               -- resolved category source_keys (all levels)
  created_at timestamptz not null default now(),
  constraint staging_shared_key_unique unique (batch_id, type_key)
);
create index if not exists staging_shared_batch_idx on public.staging_shared_products (batch_id);

-- ------------------------------------------------------------ reject ledger
create table if not exists public.import_rejects (
  id         bigint generated always as identity primary key,
  batch_id   uuid not null references public.import_batches(id) on delete cascade,
  dataset    text not null,
  src_row    integer not null,
  reason     text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists import_rejects_batch_idx on public.import_rejects (batch_id);

-- ============================================================================
-- RLS: admin read; nobody else. No INSERT/UPDATE/DELETE policies exist at
-- all — only the service role (RLS bypass) mutates staging via the CLI.
-- ============================================================================
alter table public.import_batches          enable row level security;
alter table public.staging_categories      enable row level security;
alter table public.staging_types           enable row level security;
alter table public.staging_specs           enable row level security;
alter table public.staging_groups          enable row level security;
alter table public.staging_group_links     enable row level security;
alter table public.staging_templates       enable row level security;
alter table public.staging_areas           enable row level security;
alter table public.staging_shared_products enable row level security;
alter table public.import_rejects          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'import_batches','staging_categories','staging_types','staging_specs',
    'staging_groups','staging_group_links','staging_templates',
    'staging_areas','staging_shared_products','import_rejects'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_admin())',
      t || '_admin_read', t);
  end loop;
end $$;

-- belt & braces: SELECT only for authenticated, nothing for anon.
grant select on public.import_batches, public.staging_categories, public.staging_types,
  public.staging_specs, public.staging_groups, public.staging_group_links,
  public.staging_templates, public.staging_areas, public.staging_shared_products,
  public.import_rejects
  to authenticated;
revoke all on public.import_batches, public.staging_categories, public.staging_types,
  public.staging_specs, public.staging_groups, public.staging_group_links,
  public.staging_templates, public.staging_areas, public.staging_shared_products,
  public.import_rejects
  from anon;

-- ============================================================================
-- RPC: template review actions (admin; audited) — D-12.
-- approve/reject/adjust a pending template. "adjust" rewrites fields/axes
-- while still in staging (pre-publish). Version bump happens at publish time
-- when products already reference the type (snapshot rule, US-02).
-- ============================================================================
create or replace function public.fn_admin_review_template(
  p_template uuid,
  p_action   text,                       -- approve | adjust | reject
  p_fields   text[] default null,
  p_axes     text[] default null,
  p_note     text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.staging_templates;
  v_new_status text;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  if p_action not in ('approve','adjust','reject') then
    raise exception 'bad_action';
  end if;
  select * into v_row from public.staging_templates where id = p_template for update;
  if not found then raise exception 'template_not_found'; end if;
  if v_row.review_status = 'rejected' and p_action <> 'adjust' then
    raise exception 'template_already_rejected';
  end if;

  v_new_status := case p_action when 'approve' then 'approved'
                                when 'reject'  then 'rejected'
                                else 'adjusted' end;

  update public.staging_templates set
    review_status = v_new_status,
    fields = case when p_action = 'adjust' and p_fields is not null then p_fields else v_row.fields end,
    variant_axes = case when p_action = 'adjust' and p_axes is not null then p_axes else v_row.variant_axes end,
    review_note = p_note,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_template;

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'admin.template.review', 'staging_templates', p_template::text,
          to_jsonb(v_row),
          jsonb_build_object('review_status', v_new_status, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', p_template, 'status', v_new_status);
end $$;

revoke all on function public.fn_admin_review_template(uuid, text, text[], text[], text) from public, anon;
grant execute on function public.fn_admin_review_template(uuid, text, text[], text[], text) to authenticated;

-- ============================================================================
-- RPC: publish batch attempt (D-14 publish gate). Explicit admin action.
-- Gate: every template in the batch must be approved/adjusted and non-zero
-- fields; otherwise the RPC raises with the exact count and reasons.
-- After the gate PASSES the RPC still refuses with `publish_deferred_D16`:
-- the phase mandate defers production writes until the owner provides the
-- target DB. No bulk bypass exists (this is the only publish path).
-- ============================================================================
create or replace function public.fn_admin_publish_batch(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch public.import_batches;
  v_pending int; v_rejected int; v_zero int;
  v_first_pending text;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  select * into v_batch from public.import_batches where id = p_batch for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'staged' then
    raise exception 'batch_not_staged: status=%', v_batch.status;
  end if;
  if v_batch.dry_run then
    raise exception 'batch_is_dry_run: re-import without --dry-run first';
  end if;

  -- PUBLISH GATE (D-14): templates must be approved/adjusted
  select count(*) into v_pending from public.staging_templates
    where batch_id = p_batch and review_status = 'pending';
  if v_pending > 0 then
    select type_key into v_first_pending from public.staging_templates
      where batch_id = p_batch and review_status = 'pending' order by src_row limit 1;
    raise exception 'publish_gate_blocked: % template(s) pending review (first: %)', v_pending, v_first_pending;
  end if;
  select count(*) into v_rejected from public.staging_templates
    where batch_id = p_batch and review_status = 'rejected';
  if v_rejected > 0 then
    raise exception 'publish_gate_blocked: % template(s) rejected', v_rejected;
  end if;
  select count(*) into v_zero from public.staging_templates
    where batch_id = p_batch and cardinality(fields) = 0;
  if v_zero > 0 then
    raise exception 'publish_gate_blocked: % zero-field template(s)', v_zero;
  end if;

  -- gate passed — production copy is deferred (D-16: no target DB provided)
  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'admin.batch.publish_attempted', 'import_batches', p_batch::text,
          jsonb_build_object('gate', 'passed', 'publish', 'deferred_D16'));
  raise exception 'publish_deferred_D16: production target not provided by owner';
end $$;

revoke all on function public.fn_admin_publish_batch(uuid) from public, anon;
grant execute on function public.fn_admin_publish_batch(uuid) to authenticated;
