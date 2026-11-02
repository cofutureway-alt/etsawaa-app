-- ============================================================================
-- Etsawaa — Phase 03 Vendor Core (V-01..V-20 schema + engine)
-- Tables: vendor_levels, vendors, store_members, vendor_documents,
--         products, product_attribute_values, product_facets, product_media,
--         product_tags, variants
-- RPCs:   fn_vendor_config, fn_vendor_onboard, fn_generate_variants,
--         fn_restore_variants, fn_save_variants, fn_save_product,
--         fn_submit_product, fn_clone_product, fn_admin_review_product,
--         fn_admin_review_vendor, fn_admin_verify_vendor, fn_expire_grace
-- Settings: verification, vendor_terms, vendors (+ site.general vendor keys)
-- RLS on every table, explicit grants, definer-only multi-row writes.
-- Apply: POST /v1/projects/{ref}/database/query (Management API) or psql -f.
-- ============================================================================

create extension if not exists pg_trgm;


-- ----------------------------------------------------------------------------
-- 1) VENDOR LEVELS (badge = level; seeded default "New vendor")
-- ----------------------------------------------------------------------------
create table if not exists public.vendor_levels (
  id                    uuid primary key default gen_random_uuid(),
  name_ar               text not null,
  name_en               text not null,
  icon                  text,
  min_successful_orders integer not null default 0 check (min_successful_orders >= 0),
  rewards               jsonb not null default '{}'::jsonb,
  sort                  integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

insert into public.vendor_levels (name_ar, name_en, min_successful_orders, sort)
values ('تاجر جديد', 'New vendor', 0, 0)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2) VENDORS (one store per user: owner_id UNIQUE)
-- ----------------------------------------------------------------------------
create table if not exists public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null unique references auth.users(id) on delete cascade,
  slug                text not null unique,
  store_name_ar       text not null default '',
  store_name_en       text not null default '',
  short_desc_ar       text not null default '',
  short_desc_en       text not null default '',
  welcome_msg_ar      text not null default '',
  welcome_msg_en      text not null default '',
  logo_path           text,
  banner_path         text,
  category_ids        uuid[] not null default '{}'::uuid[],
  first_name          text not null default '',
  last_name           text not null default '',
  phone               text,
  country             text not null default 'EG',
  governorate_id      smallint references public.governorates(id),
  area_id             bigint references public.areas(id),
  address1            text not null default '',
  address2            text not null default '',
  postal_code         text not null default '',
  socials             jsonb not null default '{}'::jsonb,
  -- lifecycle: draft (onboarding in progress) → pending → active | rejected;
  -- suspended by admin. grace-expired lives in verification_status.
  status              text not null default 'draft'
                      check (status in ('draft','pending','active','rejected','suspended')),
  rejection_reason    text,
  verification_status text not null default 'unverified'
                      check (verification_status in ('unverified','submitted','verified','rejected','grace_expired')),
  verification_note   text,
  grace_until         timestamptz,
  submitted_at        timestamptz,
  reviewed_by         uuid references auth.users(id),
  reviewed_at         timestamptz,
  onboarding_step     smallint not null default 1 check (onboarding_step between 1 and 5),
  terms_version       text,
  terms_accepted_at   timestamptz,
  terms_signature     text,
  level_id            uuid references public.vendor_levels(id),
  is_featured         boolean not null default false,
  hidden_from_listings boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists vendors_status_idx    on public.vendors (status);
create index if not exists vendors_owner_idx     on public.vendors (owner_id);
create index if not exists vendors_level_idx     on public.vendors (level_id);
create index if not exists vendors_trgm_idx      on public.vendors using gin (store_name_ar gin_trgm_ops, store_name_en gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 3) STORE MEMBERS (vendor staff; owner row created by fn_vendor_onboard)
-- ----------------------------------------------------------------------------
create table if not exists public.store_members (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  constraint store_members_unique unique (vendor_id, user_id)
);
create index if not exists store_members_user_idx on public.store_members (user_id);

-- ----------------------------------------------------------------------------
-- 4) VENDOR DOCUMENTS (KYC — metadata only; objects live in `documents` bucket)
-- ----------------------------------------------------------------------------
create table if not exists public.vendor_documents (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id) on delete cascade,
  type         text not null check (type in ('id_front','id_back','commercial_register','tax_card','residence')),
  bucket       text not null default 'documents' check (bucket = 'documents'),
  path         text not null,
  original_name text not null default '',
  mime         text not null default '',
  size_bytes   integer not null default 0,
  status       text not null default 'pending' check (status in ('pending','verified','rejected')),
  review_note  text,
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint vendor_documents_one_per_type unique (vendor_id, type)
);
create index if not exists vendor_documents_vendor_idx on public.vendor_documents (vendor_id);

-- ----------------------------------------------------------------------------
-- 5) PRODUCTS
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  leaf_category_id uuid not null references public.categories(id) on delete restrict,
  brand_id         uuid references public.brands(id) on delete set null,
  name_ar          text not null default '',
  name_en          text not null default '',
  slug_ar          text not null default '',
  slug_en          text not null default '',
  desc_ar          text not null default '',
  desc_en          text not null default '',
  short_ar         text not null default '',
  short_en         text not null default '',
  is_fragile       boolean not null default false,
  shipping_mode    text not null default 'platform' check (shipping_mode in ('platform','vendor')),
  shipping_class   text not null default 'standard',
  weight_g         integer check (weight_g is null or weight_g >= 0),
  dims             jsonb not null default '{}'::jsonb, -- {l_cm,w_cm,h_cm}
  -- draft → pending → approved | rejected (AGENT §5)
  status           text not null default 'draft'
                   check (status in ('draft','pending','approved','rejected')),
  rejection_reason text,
  sale_starts_at   timestamptz,
  sale_ends_at     timestamptz,
  specs            jsonb not null default '{}'::jsonb,
  search_tsv       tsvector generated always as (
                     to_tsvector('arabic', coalesce(name_ar, '') || ' ' || coalesce(name_en, ''))
                   ) stored,
  published_at     timestamptz,
  submitted_at     timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists products_vendor_idx    on public.products (vendor_id);
create index if not exists products_status_idx    on public.products (status);
create index if not exists products_category_idx  on public.products (leaf_category_id);
create index if not exists products_brand_idx     on public.products (brand_id);
create index if not exists products_tsv_idx       on public.products using gin (search_tsv);
create index if not exists products_trgm_idx      on public.products using gin (name_ar gin_trgm_ops, name_en gin_trgm_ops);
create index if not exists products_slug_ar_idx   on public.products (slug_ar) where deleted_at is null;
create index if not exists products_slug_en_idx   on public.products (slug_en) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 6) PRODUCT CHILDREN
-- ----------------------------------------------------------------------------
create table if not exists public.product_attribute_values (
  product_id   uuid not null references public.products(id) on delete cascade,
  attribute_id uuid not null references public.attribute_defs(id) on delete restrict,
  option_id    uuid references public.attribute_options(id) on delete restrict,
  value_text   text,
  value_number numeric,
  value_bool   boolean,
  primary key (product_id, attribute_id),
  -- enum/color MUST reference the admin dictionary (AGENT §6.6)
  constraint pav_option_required_for_choice
    check ((option_id is not null) or (value_text is not null or value_number is not null or value_bool is not null))
);

create table if not exists public.product_facets (
  product_id   uuid not null references public.products(id) on delete cascade,
  attribute_id uuid not null references public.attribute_defs(id) on delete restrict,
  option_id    uuid not null references public.attribute_options(id) on delete restrict,
  primary key (product_id, attribute_id, option_id)
);
create index if not exists product_facets_attr_option_idx on public.product_facets (attribute_id, option_id);

create table if not exists public.product_media (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  kind       text not null default 'image' check (kind in ('image','video')),
  path       text not null, -- media bucket path u/{uid}/{uuid}.{ext}
  position   smallint not null default 0
);
create index if not exists product_media_product_idx on public.product_media (product_id, position);

create table if not exists public.product_tags (
  product_id uuid not null references public.products(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete restrict,
  primary key (product_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- 7) VARIANTS (cartesian rows; tombstones block regeneration)
-- ----------------------------------------------------------------------------
create table if not exists public.variants (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products(id) on delete cascade,
  sku                   text,
  option_key            text not null default '',
  option_ids            uuid[] not null default '{}'::uuid[],
  price_piastres        integer check (price_piastres is null or price_piastres > 0),
  sale_price_piastres   integer check (sale_price_piastres is null or sale_price_piastres > 0),
  stock                 integer not null default 0 check (stock >= 0),
  image_path            text,
  is_active             boolean not null default true,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- live uniqueness: one row per combination, SKUs globally unique among live rows
create unique index if not exists variants_product_option_key_live
  on public.variants (product_id, option_key) where deleted_at is null;
create unique index if not exists variants_sku_live
  on public.variants (sku) where sku is not null and deleted_at is null;
create index if not exists variants_product_idx on public.variants (product_id);
create index if not exists variants_sku_trgm_idx on public.variants using gin (sku gin_trgm_ops);

-- ============================================================================
-- HELPERS
-- ============================================================================

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vendors_touch on public.vendors;
create trigger vendors_touch before update on public.vendors
  for each row execute function public.touch_updated_at();
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
drop trigger if exists variants_touch on public.variants;
create trigger variants_touch before update on public.variants
  for each row execute function public.touch_updated_at();

-- Definer helper for child-table policies: owner or admin visibility.
-- (Inline EXISTS over vendors breaks for anon — vendors has no anon grant.)
create or replace function public.product_owned_or_admin(p_product_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.products p join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id
      and (v.owner_id = auth.uid() or public.is_admin())
  );
$$;

-- vendors are the caller's own rows (same predicate everywhere)
create or replace function public.own_vendor_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.vendors where owner_id = auth.uid();
$$;

-- Public catalog visibility: approved product of a sellable vendor.
-- grace_expired / suspended / non-active vendors are hidden site-wide.
create or replace function public.product_is_public(p_product_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.products p
    join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id
      and p.status = 'approved' and p.deleted_at is null
      and v.status = 'active'
      and v.verification_status <> 'grace_expired'
      and not v.hidden_from_listings
  );
$$;

-- Vendor state helper: selling allowed right now?
create or replace function public.vendor_can_sell(p_vendor_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vendors
    where id = p_vendor_id
      and status = 'active'
      and verification_status <> 'grace_expired'
  );
$$;

-- notifications helper (definer context)
create or replace function public.fn_notify(p_user uuid, p_type text, p_payload jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, payload) values (p_user, p_type, p_payload);
$$;

-- unique slug within a table/column (vendors / products share the helper per call site)
create or replace function public.fn_vendor_slug(p_base text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 0;
begin
  v_base := trim(both '-' from lower(regexp_replace(coalesce(p_base, 'store'), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g')));
  v_candidate := case when v_base = '' or v_base is null then 'store' else v_base end;
  loop
    if not exists (select 1 from public.vendors where slug = v_candidate) then
      return v_candidate;
    end if;
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n::text;
  end loop;
end $$;

create or replace function public.fn_product_slug(p_base text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 0;
begin
  v_base := trim(both '-' from lower(regexp_replace(coalesce(p_base, 'product'), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g')));
  v_candidate := case when v_base = '' or v_base is null then 'product' else v_base end;
  loop
    if not exists (
      select 1 from public.products
      where slug_ar = v_candidate or slug_en = v_candidate
    ) then
      return v_candidate;
    end if;
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n::text;
  end loop;
end $$;

-- ============================================================================
-- SETTINGS (verification · vendor_terms · vendors + site.general vendor keys)
-- ============================================================================

insert into public.settings (key, value)
values ('verification', jsonb_build_object(
  'required_documents', jsonb_build_object(
    'id_front', true,
    'id_back', true,
    'commercial_register', false,
    'tax_card', false,
    'residence', false
  ),
  'grace_value', 7,
  'grace_unit', 'days',
  'max_document_mb', 5,
  'after_grace', 'block_selling'
))
on conflict (key) do nothing;

insert into public.settings (key, value)
values ('vendor_terms', jsonb_build_object(
  'version', '1.0',
  'text_ar', 'بموافقتي على عقد البائع أقر بأنني مسؤول عن صحة البيانات والمنتجات المنشورة عبر متجري على منصة اتسوء، وألتزم بسياسات البيع والاسترجاع والشحن المعتمدة، وبمراجعة الإدارة لجميع المنتجات قبل النشر، وبعدم نشر أي منتجات مخالفة للقانون أو العادات العامة. تلتزم المنصة بتحويل أرباح المحفظة وفق قواعد التعليمات المالية المعلنة.',
  'text_en', 'By accepting the vendor contract I confirm that I am responsible for the accuracy of the data and products published through my store on Etsawaa, and I commit to the approved selling, returns and shipping policies, to admin review of all products before publishing, and to never publish products that violate the law or public order. The platform commits to transferring wallet earnings according to the published financial rules.'
))
on conflict (key) do nothing;

insert into public.settings (key, value)
values ('vendors', jsonb_build_object(
  'product_review_required', true,
  'allow_clone', true
))
on conflict (key) do nothing;

-- site.general: add the vendor onboarding switches (public section 16.2)
update public.settings
set value = value
  || jsonb_build_object('vendor_registration_enabled', true)
  || jsonb_build_object('vendor_onboarding_mode', 'manual')
  || jsonb_build_object('force_onboarding', true)
where key = 'site.general'
  and value ? 'site_name_ar'
  and not (value ? 'vendor_registration_enabled');

-- ============================================================================
-- VENDOR CONFIG (definer read of vendor-relevant settings for the wizard)
-- ============================================================================
create or replace function public.fn_vendor_config() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_verification jsonb;
  v_terms        jsonb;
  v_vendors      jsonb;
  v_general      jsonb;
begin
  select value into v_verification from public.settings where key = 'verification';
  select value into v_terms from public.settings where key = 'vendor_terms';
  select value into v_vendors from public.settings where key = 'vendors';
  select value into v_general from public.settings where key = 'site.general';
  return jsonb_build_object(
    'registration_enabled', coalesce(v_general ->> 'vendor_registration_enabled', 'true') = 'true',
    'onboarding_mode', coalesce(v_general ->> 'vendor_onboarding_mode', 'manual'),
    'force_onboarding', coalesce(v_general ->> 'force_onboarding', 'true') = 'true',
    'review_required', coalesce(v_vendors ->> 'product_review_required', 'true') = 'true',
    'allow_clone', coalesce(v_vendors ->> 'allow_clone', 'true') = 'true',
    'required_documents', coalesce(v_verification -> 'required_documents', '{}'::jsonb),
    'grace_value', coalesce((v_verification ->> 'grace_value')::int, 7),
    'grace_unit', coalesce(v_verification ->> 'grace_unit', 'days'),
    'max_document_mb', coalesce((v_verification ->> 'max_document_mb')::int, 5),
    'terms_version', coalesce(v_terms ->> 'version', '1.0'),
    'terms_ar', coalesce(v_terms ->> 'text_ar', ''),
    'terms_en', coalesce(v_terms ->> 'text_en', '')
  );
end $$;

revoke all on function public.fn_vendor_config() from public, anon;
grant execute on function public.fn_vendor_config() to authenticated;

-- ============================================================================
-- RPC: fn_vendor_onboard — submit the onboarding wizard (step 5)
-- Server-side validation; one store per user; role promotion; grace start.
-- ============================================================================
create or replace function public.fn_vendor_onboard(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user        uuid := auth.uid();
  v_vendor      public.vendors%rowtype;
  v_config      jsonb := public.fn_vendor_config();
  v_new_status  text;
  v_exists      boolean;
  v_cat         uuid;
  v_area_ok     boolean;
  v_grace       interval;
  v_admins      uuid[];
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  if coalesce(v_config ->> 'registration_enabled', 'true') <> 'true' then
    raise exception 'vendor registration is disabled';
  end if;

  -- required server-side validation (V-03/V-04/V-08)
  if coalesce(p_data ->> 'store_name_ar', '') = '' or coalesce(p_data ->> 'store_name_en', '') = '' then
    raise exception 'store name (ar+en) is required';
  end if;
  if jsonb_array_length(coalesce(p_data -> 'category_ids', '[]'::jsonb)) = 0 then
    raise exception 'at least one store category is required';
  end if;
  for v_cat in select jsonb_array_elements_text(p_data -> 'category_ids')::uuid loop
    if not exists (select 1 from public.categories c where c.id = v_cat and c.is_active and c.deleted_at is null) then
      raise exception 'invalid store category %', v_cat;
    end if;
  end loop;
  if coalesce(p_data ->> 'governorate_id', '') = '' or coalesce(p_data ->> 'area_id', '') = '' then
    raise exception 'governorate and area are required';
  end if;
  select exists (
    select 1 from public.areas
    where id = (p_data ->> 'area_id')::bigint
      and governorate_id = (p_data ->> 'governorate_id')::smallint
  ) into v_area_ok;
  if not v_area_ok then
    raise exception 'area does not belong to the selected governorate';
  end if;
  if coalesce(p_data ->> 'terms_version', '') <> coalesce(v_config ->> 'terms_version', '1.0')
     or coalesce(p_data ->> 'terms_signature', '') = '' then
    raise exception 'terms acceptance with typed signature is required';
  end if;

  select * into v_vendor from public.vendors where owner_id = v_user;
  v_exists := v_vendor.id is not null;

  -- one store per user (belt over the unique index: friendly error)
  if not v_exists then
    v_new_status := case when v_config ->> 'onboarding_mode' = 'direct' then 'active' else 'pending' end;
    insert into public.vendors (
      owner_id, slug, store_name_ar, store_name_en, short_desc_ar, short_desc_en,
      welcome_msg_ar, welcome_msg_en, logo_path, banner_path, category_ids,
      first_name, last_name, phone, governorate_id, area_id, address1, address2, postal_code, socials,
      status, submitted_at, terms_version, terms_accepted_at, terms_signature, onboarding_step, level_id
    ) values (
      v_user,
      public.fn_vendor_slug(p_data ->> 'slug'),
      p_data ->> 'store_name_ar', p_data ->> 'store_name_en',
      coalesce(p_data ->> 'short_desc_ar', ''), coalesce(p_data ->> 'short_desc_en', ''),
      coalesce(p_data ->> 'welcome_msg_ar', ''), coalesce(p_data ->> 'welcome_msg_en', ''),
      nullif(p_data ->> 'logo_path', ''), nullif(p_data ->> 'banner_path', ''),
      (select coalesce(array_agg(value::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_data -> 'category_ids') value),
      coalesce(p_data ->> 'first_name', ''), coalesce(p_data ->> 'last_name', ''),
      nullif(p_data ->> 'phone', ''),
      (p_data ->> 'governorate_id')::smallint, (p_data ->> 'area_id')::bigint,
      coalesce(p_data ->> 'address1', ''), coalesce(p_data ->> 'address2', ''),
      coalesce(p_data ->> 'postal_code', ''), coalesce(p_data -> 'socials', '{}'::jsonb),
      v_new_status, now(),
      p_data ->> 'terms_version', now(), p_data ->> 'terms_signature',
      5,
      (select id from public.vendor_levels where min_successful_orders = 0 order by sort limit 1)
    ) returning * into v_vendor;
  else
    -- resubmit / re-save: only draft & rejected may (re)enter the approval flow
    if v_vendor.status in ('draft', 'rejected') then
      v_new_status := case when v_config ->> 'onboarding_mode' = 'direct' then 'active' else 'pending' end;
    elsif v_vendor.status = 'pending' then
      v_new_status := 'pending';
    else
      v_new_status := v_vendor.status; -- active/suspended: profile edit only
    end if;
    update public.vendors set
      slug = case when p_data ? 'slug' and coalesce(p_data ->> 'slug', '') <> '' then public.fn_vendor_slug(p_data ->> 'slug') else v_vendor.slug end,
      store_name_ar = p_data ->> 'store_name_ar',
      store_name_en = p_data ->> 'store_name_en',
      short_desc_ar = coalesce(p_data ->> 'short_desc_ar', ''),
      short_desc_en = coalesce(p_data ->> 'short_desc_en', ''),
      welcome_msg_ar = coalesce(p_data ->> 'welcome_msg_ar', ''),
      welcome_msg_en = coalesce(p_data ->> 'welcome_msg_en', ''),
      logo_path = nullif(p_data ->> 'logo_path', ''),
      banner_path = nullif(p_data ->> 'banner_path', ''),
      category_ids = (select coalesce(array_agg(value::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_data -> 'category_ids') value),
      first_name = coalesce(p_data ->> 'first_name', ''),
      last_name = coalesce(p_data ->> 'last_name', ''),
      phone = nullif(p_data ->> 'phone', ''),
      governorate_id = (p_data ->> 'governorate_id')::smallint,
      area_id = (p_data ->> 'area_id')::bigint,
      address1 = coalesce(p_data ->> 'address1', ''),
      address2 = coalesce(p_data ->> 'address2', ''),
      postal_code = coalesce(p_data ->> 'postal_code', ''),
      socials = coalesce(p_data -> 'socials', '{}'::jsonb),
      status = v_new_status,
      rejection_reason = case when v_vendor.status = 'rejected' then null else v_vendor.rejection_reason end,
      submitted_at = case when v_vendor.status in ('draft', 'rejected') then now() else v_vendor.submitted_at end,
      terms_version = p_data ->> 'terms_version',
      terms_accepted_at = now(),
      terms_signature = p_data ->> 'terms_signature',
      onboarding_step = 5
    where id = v_vendor.id
    returning * into v_vendor;
  end if;

  -- owner membership (idempotent)
  insert into public.store_members (vendor_id, user_id, role)
  values (v_vendor.id, v_user, 'owner')
  on conflict (vendor_id, user_id) do update set role = 'owner';

  -- grace clock starts at first submission while unverified
  if v_vendor.verification_status = 'unverified' and v_vendor.grace_until is null then
    v_grace := make_interval(
      years  => case when v_config ->> 'grace_unit' = 'months' then greatest((v_config ->> 'grace_value')::int, 1) else 0 end,
      days   => case when v_config ->> 'grace_unit' = 'days' then greatest((v_config ->> 'grace_value')::int, 1) else 0 end,
      hours  => case when v_config ->> 'grace_unit' = 'hours' then greatest((v_config ->> 'grace_value')::int, 1) else 0 end
    );
    update public.vendors set grace_until = now() + v_grace where id = v_vendor.id
      returning grace_until into v_vendor.grace_until;
  end if;

  -- promote the account to vendor
  update public.profiles set role = 'vendor' where id = v_user and role = 'customer';

  -- notify admins (new vendor / resubmission)
  select array_agg(p.id) into v_admins from public.profiles p where p.role = 'admin';
  for i in 1..coalesce(cardinality(v_admins), 0) loop
    perform public.fn_notify(v_admins[i], 'vendor.submitted', jsonb_build_object(
      'vendor_id', v_vendor.id,
      'store_name_ar', v_vendor.store_name_ar,
      'store_name_en', v_vendor.store_name_en,
      'status', v_new_status
    ));
  end loop;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'vendor.onboard', 'vendors', v_vendor.id::text,
          jsonb_build_object('status', v_new_status, 'slug', v_vendor.slug));

  return jsonb_build_object(
    'vendor_id', v_vendor.id,
    'slug', v_vendor.slug,
    'status', v_new_status,
    'grace_until', v_vendor.grace_until
  );
end $$;

revoke all on function public.fn_vendor_onboard(jsonb) from public, anon;
grant execute on function public.fn_vendor_onboard(jsonb) to authenticated;

-- ============================================================================
-- RPC: fn_vendor_autosave — persist wizard progress (draft) for resume (V-02)
-- ============================================================================
create or replace function public.fn_vendor_autosave(p_step smallint, p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_vendor public.vendors%rowtype;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  if p_step not between 1 and 5 then
    raise exception 'invalid onboarding step';
  end if;

  select * into v_vendor from public.vendors where owner_id = v_user;
  if v_vendor.id is null then
    -- first autosave creates the draft store (still role=customer until submit)
    if coalesce(p_data ->> 'store_name_ar', '') = '' then
      p_data := p_data || jsonb_build_object('store_name_ar', 'متجر ' || coalesce(p_data ->> 'first_name', ''));
    end if;
    insert into public.vendors (owner_id, slug, store_name_ar, store_name_en, status, onboarding_step)
    values (v_user,
            public.fn_vendor_slug(p_data ->> 'slug'),
            coalesce(p_data ->> 'store_name_ar', ''),
            coalesce(p_data ->> 'store_name_en', ''),
            'draft', p_step)
    returning * into v_vendor;
  end if;

  if v_vendor.status not in ('draft', 'pending', 'rejected') then
    raise exception 'onboarding is locked for stores in status %', v_vendor.status;
  end if;

  update public.vendors set
    slug = case when p_data ? 'slug' and coalesce(p_data ->> 'slug', '') <> '' then public.fn_vendor_slug(p_data ->> 'slug') else v_vendor.slug end,
    store_name_ar = coalesce(nullif(p_data ->> 'store_name_ar', ''), v_vendor.store_name_ar),
    store_name_en = coalesce(nullif(p_data ->> 'store_name_en', ''), v_vendor.store_name_en),
    short_desc_ar = coalesce(p_data ->> 'short_desc_ar', v_vendor.short_desc_ar),
    short_desc_en = coalesce(p_data ->> 'short_desc_en', v_vendor.short_desc_en),
    welcome_msg_ar = coalesce(p_data ->> 'welcome_msg_ar', v_vendor.welcome_msg_ar),
    welcome_msg_en = coalesce(p_data ->> 'welcome_msg_en', v_vendor.welcome_msg_en),
    logo_path = coalesce(nullif(p_data ->> 'logo_path', ''), v_vendor.logo_path),
    banner_path = coalesce(nullif(p_data ->> 'banner_path', ''), v_vendor.banner_path),
    category_ids = case
      when p_data ? 'category_ids'
      then (select coalesce(array_agg(value::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_data -> 'category_ids') value)
      else v_vendor.category_ids end,
    first_name = coalesce(p_data ->> 'first_name', v_vendor.first_name),
    last_name = coalesce(p_data ->> 'last_name', v_vendor.last_name),
    phone = coalesce(nullif(p_data ->> 'phone', ''), v_vendor.phone),
    governorate_id = coalesce((p_data ->> 'governorate_id')::smallint, v_vendor.governorate_id),
    area_id = coalesce((p_data ->> 'area_id')::bigint, v_vendor.area_id),
    address1 = coalesce(p_data ->> 'address1', v_vendor.address1),
    address2 = coalesce(p_data ->> 'address2', v_vendor.address2),
    postal_code = coalesce(p_data ->> 'postal_code', v_vendor.postal_code),
    socials = case when p_data ? 'socials' then coalesce(p_data -> 'socials', '{}'::jsonb) else v_vendor.socials end,
    onboarding_step = greatest(p_step, 1)
  where id = v_vendor.id
  returning * into v_vendor;

  return jsonb_build_object('vendor_id', v_vendor.id, 'step', v_vendor.onboarding_step, 'slug', v_vendor.slug);
end $$;

revoke all on function public.fn_vendor_autosave(smallint, jsonb) from public, anon;
grant execute on function public.fn_vendor_autosave(smallint, jsonb) to authenticated;

-- ============================================================================
-- RPC: fn_generate_variants — desired-set diff against the cartesian product
--   inserts missing combos, tombstones rows outside the set, NEVER recreates
--   tombstoned combos (returns them as skipped). Unique(product, option_key).
-- ============================================================================
create or replace function public.fn_generate_variants(p_product_id uuid, p_axes jsonb, p_defaults jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user        uuid := auth.uid();
  v_vendor_id   uuid;
  v_status      text;
  v_axis        jsonb;
  v_attr        record;
  v_opt         uuid;
  v_combos      jsonb;   -- array of arrays of option uuids
  v_new_combos  jsonb;
  v_combo       jsonb;
  v_key         text;
  v_exists      text;    -- 'live' | 'tombstone'
  v_inserted    integer := 0;
  v_removed     integer := 0;
  v_skipped     jsonb := '[]'::jsonb;
  v_price       integer := nullif(p_defaults ->> 'price_piastres', '')::int;
  v_sale        integer := nullif(p_defaults ->> 'sale_price_piastres', '')::int;
  v_i           integer;
  v_j           integer;
  v_sorted      text;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select vendor_id, status into v_vendor_id, v_status from public.products where id = p_product_id;
  if v_vendor_id is null then
    raise exception 'product not found';
  end if;
  if not exists (select 1 from public.vendors where id = v_vendor_id and owner_id = v_user) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'variants are locked for products in status %', v_status;
  end if;
  if v_sale is not null and v_price is not null and v_sale >= v_price then
    raise exception 'sale price must be lower than the price';
  end if;

  -- validate axes against the leaf template (variant axes, admin dictionary)
  if jsonb_typeof(p_axes) <> 'array' then
    raise exception 'axes must be an array';
  end if;
  for v_axis in select * from jsonb_array_elements(p_axes) loop
    select * into v_attr from public.attribute_defs
      where id = (v_axis ->> 'attribute_id')::uuid and is_variant_axis and deleted_at is null;
    if v_attr.id is null then
      raise exception 'attribute % is not a variant axis of the template', v_axis ->> 'attribute_id';
    end if;
    if not public.fn_attr_in_template(
      v_attr.id,
      (select leaf_category_id from public.products where id = p_product_id)
    ) then
      raise exception 'attribute % is not linked to this category', v_attr.code;
    end if;
    for v_opt in select jsonb_array_elements_text(v_axis -> 'option_ids')::uuid loop
      if not exists (
        select 1 from public.attribute_options
        where id = v_opt and attribute_id = v_attr.id and deleted_at is null
      ) then
        raise exception 'option % is not an option of attribute %', v_opt, v_attr.code;
      end if;
    end loop;
    if jsonb_array_length(v_axis -> 'option_ids') = 0 then
      raise exception 'axis % has no selected options', v_attr.code;
    end if;
  end loop;

  -- cartesian product of the selected options (ordered by axis order)
  v_combos := jsonb_build_array('[]'::jsonb);
  for v_axis in select * from jsonb_array_elements(p_axes) loop
    v_new_combos := '[]'::jsonb;
    for v_i in 0..jsonb_array_length(v_combos) - 1 loop
      for v_opt in select jsonb_array_elements_text(v_axis -> 'option_ids')::uuid loop
        v_new_combos := v_new_combos || jsonb_build_array(
          (select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
             from jsonb_array_elements(v_combos -> v_i) value) || to_jsonb(v_opt)
        );
      end loop;
    end loop;
    v_combos := v_new_combos;
  end loop;

  -- diff against the desired set
  if jsonb_array_length(p_axes) = 0 then
    -- no axes: ensure exactly one plain row (TV case, option_key='')
    if not exists (select 1 from public.variants where product_id = p_product_id and option_key = '') then
      insert into public.variants (product_id, option_key, option_ids, price_piastres, sale_price_piastres)
      values (p_product_id, '', '{}', v_price, v_sale);
      v_inserted := v_inserted + 1;
    end if;
  else
    -- insert missing combos (skip tombstoned ones — never resurrect silently)
    for v_i in 0..jsonb_array_length(v_combos) - 1 loop
      v_combo := v_combos -> v_i;
      -- option_key is the sorted id list, joined (canonical combination key)
      select string_agg(el #>> '{}', ',' order by el #>> '{}')
        into v_sorted
        from jsonb_array_elements(v_combo) el;
      select case
        when exists (select 1 from public.variants where product_id = p_product_id and option_key = v_sorted and deleted_at is null) then 'live'
        when exists (select 1 from public.variants where product_id = p_product_id and option_key = v_sorted) then 'tombstone'
        else 'new' end
      into v_exists;
      if v_exists = 'new' then
        insert into public.variants (product_id, option_key, option_ids, price_piastres, sale_price_piastres)
        values (
          p_product_id,
          v_sorted,
          (select coalesce(array_agg((el #>> '{}')::uuid order by el #>> '{}'), '{}'::uuid[]) from jsonb_array_elements(v_combo) el),
          v_price, v_sale
        );
        v_inserted := v_inserted + 1;
      elsif v_exists = 'tombstone' then
        v_skipped := v_skipped || to_jsonb(v_sorted);
      end if;
    end loop;

    -- tombstone live rows outside the desired set (UI confirms before calling)
    with desired as (
      select string_agg(el #>> '{}', ',' order by el #>> '{}') as k
      from jsonb_array_elements(v_combos) arr, jsonb_array_elements(arr) el
      group by arr
    )
    update public.variants set deleted_at = now()
    where product_id = p_product_id and deleted_at is null and option_key <> ''
      and option_key not in (select k from desired);
    get diagnostics v_removed = row_count;
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'variants.generate', 'products', p_product_id::text,
          jsonb_build_object('inserted', v_inserted, 'removed', v_removed, 'skipped', v_skipped));

  return jsonb_build_object('inserted', v_inserted, 'removed', v_removed, 'skipped', v_skipped);
end $$;

revoke all on function public.fn_generate_variants(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.fn_generate_variants(uuid, jsonb, jsonb) to authenticated;

-- ============================================================================
-- RPC: fn_restore_variants — explicit undo of tombstones (never automatic)
-- ============================================================================
create or replace function public.fn_restore_variants(p_product_id uuid, p_keys text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_n integer := 0;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id and v.owner_id = v_user
  ) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  update public.variants set deleted_at = null
  where product_id = p_product_id and deleted_at is not null and option_key = any(p_keys)
    and not exists (
      select 1 from public.variants live
      where live.product_id = variants.product_id and live.option_key = variants.option_key and live.deleted_at is null
    );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.fn_restore_variants(uuid, text[]) from public, anon;
grant execute on function public.fn_restore_variants(uuid, text[]) to authenticated;

-- ============================================================================
-- RPC: fn_save_variants — atomic per-row edit (SKU/price/sale/stock/image)
-- ============================================================================
create or replace function public.fn_save_variants(p_product_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_row       jsonb;
  v_variant   record;
  v_seen_sku  text;
  v_skus      text[] := '{}'::text[];
  v_count     integer := 0;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id and v.owner_id = v_user and p.status in ('draft', 'rejected')
  ) then
    raise exception 'not allowed: product not editable' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    select * into v_variant from public.variants
      where product_id = p_product_id and option_key = coalesce(v_row ->> 'option_key', '')
        and deleted_at is null;
    if v_variant.id is null then
      raise exception 'variant % not found', v_row ->> 'option_key';
    end if;

    v_seen_sku := nullif(trim(coalesce(v_row ->> 'sku', '')), '');
    if v_seen_sku is null then
      raise exception 'SKU is required for every variant';
    end if;
    if v_seen_sku = any(v_skus) then
      raise exception 'duplicate SKU % in this save', v_seen_sku;
    end if;
    v_skus := v_skus || v_seen_sku;

    if coalesce((v_row ->> 'price_piastres')::int, 0) <= 0 then
      raise exception 'price is required for every variant';
    end if;
    if (v_row ->> 'sale_price_piastres') is not null
       and (v_row ->> 'sale_price_piastres')::int >= (v_row ->> 'price_piastres')::int then
      raise exception 'sale price must be lower than the price';
    end if;
    if coalesce((v_row ->> 'stock')::int, -1) < 0 then
      raise exception 'stock cannot be negative';
    end if;

    update public.variants set
      sku = v_seen_sku,
      price_piastres = (v_row ->> 'price_piastres')::int,
      sale_price_piastres = nullif(v_row ->> 'sale_price_piastres', '')::int,
      stock = (v_row ->> 'stock')::int,
      image_path = nullif(v_row ->> 'image_path', ''),
      is_active = coalesce((v_row ->> 'is_active')::boolean, true)
    where id = v_variant.id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('saved', v_count);
end $$;

revoke all on function public.fn_save_variants(uuid, jsonb) from public, anon;
grant execute on function public.fn_save_variants(uuid, jsonb) to authenticated;

-- ============================================================================
-- RPC: fn_save_product — atomic draft save: product + attributes + facets +
-- media + tags + specs snapshot (multi-row write in ONE definer call)
-- ============================================================================
create or replace function public.fn_save_product(p_product jsonb, p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_vendor    uuid;
  v_product   public.products%rowtype;
  v_is_new    boolean := p_id is null;
  v_cat       uuid := nullif(p_product ->> 'leaf_category_id', '')::uuid;
  v_is_leaf   boolean;
  v_attr      record;
  v_val       jsonb;
  v_opt       uuid;
  v_slug_ar   text;
  v_slug_en   text;
  v_specs     jsonb := '{}'::jsonb;
  v_media     jsonb;
  v_i         integer;
  v_sale_s    timestamptz;
  v_sale_e    timestamptz;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select id into v_vendor from public.vendors where owner_id = v_user;
  if v_vendor is null then
    raise exception 'not allowed: no store' using errcode = '42501';
  end if;

  if v_is_new then
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;
  else
    select * into v_product from public.products where id = p_id and vendor_id = v_vendor;
    if v_product.id is null then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
    if v_product.status not in ('draft', 'rejected') then
      raise exception 'product is locked in status %', v_product.status;
    end if;
  end if;

  -- category: must be an active leaf
  if v_cat is not null then
    select not exists (select 1 from public.categories c where c.parent_id = v_cat and c.deleted_at is null)
      and exists (select 1 from public.categories c where c.id = v_cat and c.is_active and c.deleted_at is null)
      into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be an active leaf category';
    end if;
  end if;
  if coalesce(p_product ->> 'brand_id', '') <> ''
     and not exists (select 1 from public.brands where id = (p_product ->> 'brand_id')::uuid and deleted_at is null) then
    raise exception 'brand not found';
  end if;

  -- sale schedule validity
  v_sale_s := nullif(p_product ->> 'sale_starts_at', '')::timestamptz;
  v_sale_e := nullif(p_product ->> 'sale_ends_at', '')::timestamptz;
  if v_sale_s is not null and v_sale_e is not null and v_sale_e <= v_sale_s then
    raise exception 'sale schedule end must be after the start';
  end if;

  update public.products set
    name_ar  = coalesce(p_product ->> 'name_ar',  v_product.name_ar),
    name_en  = coalesce(p_product ->> 'name_en',  v_product.name_en),
    desc_ar  = coalesce(p_product ->> 'desc_ar',  v_product.desc_ar),
    desc_en  = coalesce(p_product ->> 'desc_en',  v_product.desc_en),
    short_ar = coalesce(p_product ->> 'short_ar', v_product.short_ar),
    short_en = coalesce(p_product ->> 'short_en', v_product.short_en),
    leaf_category_id = coalesce(v_cat, v_product.leaf_category_id),
    brand_id = coalesce(nullif(p_product ->> 'brand_id', '')::uuid, v_product.brand_id),
    is_fragile = coalesce((p_product ->> 'is_fragile')::boolean, v_product.is_fragile),
    shipping_mode = coalesce(p_product ->> 'shipping_mode', v_product.shipping_mode),
    shipping_class = coalesce(p_product ->> 'shipping_class', v_product.shipping_class),
    weight_g = coalesce((p_product ->> 'weight_g')::int, v_product.weight_g),
    dims = coalesce(p_product -> 'dims', v_product.dims),
    sale_starts_at = coalesce(v_sale_s, v_product.sale_starts_at),
    sale_ends_at = coalesce(v_sale_e, v_product.sale_ends_at)
  where id = v_product.id
  returning * into v_product;

  -- slug: generated once from the names, kept stable afterwards
  if coalesce(v_product.slug_ar, '') = '' and coalesce(v_product.name_ar, '') <> '' then
    update public.products set slug_ar = public.fn_product_slug(v_product.name_ar) where id = v_product.id;
  end if;
  if coalesce(v_product.slug_en, '') = '' and coalesce(v_product.name_en, '') <> '' then
    update public.products set slug_en = public.fn_product_slug(v_product.name_en) where id = v_product.id;
  end if;

  -- full children replace (draft-phase saves are whole-form)
  if p_product ? 'attributes' then
    delete from public.product_attribute_values where product_id = v_product.id;
    for v_val in select * from jsonb_array_elements(coalesce(p_product -> 'attributes', '[]'::jsonb)) loop
      select * into v_attr from public.attribute_defs
        where id = (v_val ->> 'attribute_id')::uuid and deleted_at is null;
      if v_attr.id is null then
        raise exception 'attribute % not found', v_val ->> 'attribute_id';
      end if;
      if not exists (
        select 1 from public.category_attributes
        where category_id = v_product.leaf_category_id and attribute_id = v_attr.id
      ) then
        raise exception 'attribute % does not belong to the product category', v_attr.code;
      end if;
      v_opt := nullif(v_val ->> 'option_id', '')::uuid;
      if v_attr.type in ('enum', 'color') then
        if v_opt is null or not exists (
          select 1 from public.attribute_options where id = v_opt and attribute_id = v_attr.id and deleted_at is null
        ) then
          raise exception 'value for % must come from the admin options', v_attr.code;
        end if;
      end if;
      insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
      values (
        v_product.id, v_attr.id, v_opt,
        nullif(v_val ->> 'value_text', ''),
        nullif(v_val ->> 'value_number', '')::numeric,
        nullif(v_val ->> 'value_bool', '')::boolean
      );
    end loop;

    -- facets: one row per chosen filterable option
    delete from public.product_facets where product_id = v_product.id;
    insert into public.product_facets (product_id, attribute_id, option_id)
    select v_product.id, pav.attribute_id, pav.option_id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;

    -- specs snapshot for fast display (option labels; text/number/bool raw values)
    select coalesce(jsonb_object_agg(ad.code, jsonb_build_object(
      'type', ad.type,
      'unit', ad.unit,
      'value', case
        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)
        when ad.type = 'number' then to_jsonb(pav.value_number)
        when ad.type = 'bool' then to_jsonb(pav.value_bool)
        else to_jsonb(pav.value_text) end
    )), '{}'::jsonb)
    into v_specs
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    left join public.attribute_options ao on ao.id = pav.option_id
    where pav.product_id = v_product.id;
    update public.products set specs = v_specs where id = v_product.id;
  end if;

  if p_product ? 'media' then
    delete from public.product_media where product_id = v_product.id;
    v_i := 0;
    for v_media in select * from jsonb_array_elements(coalesce(p_product -> 'media', '[]'::jsonb)) loop
      insert into public.product_media (product_id, kind, path, position)
      values (
        v_product.id,
        coalesce(v_media ->> 'kind', 'image'),
        v_media ->> 'path',
        v_i
      );
      v_i := v_i + 1;
    end loop;
  end if;

  if p_product ? 'tag_ids' then
    delete from public.product_tags where product_id = v_product.id;
    insert into public.product_tags (product_id, tag_id)
    select v_product.id, value::uuid
    from jsonb_array_elements_text(coalesce(p_product -> 'tag_ids', '[]'::jsonb)) value
    where exists (select 1 from public.tags where id = value::uuid and deleted_at is null);
  end if;

  -- optional default pricing push (bulk fill from step 3)
  if coalesce((p_product -> 'apply_defaults')::boolean, false) then
    update public.variants set
      price_piastres = coalesce(nullif(p_product ->> 'default_price_piastres', '')::int, price_piastres),
      sale_price_piastres = coalesce(nullif(p_product ->> 'default_sale_piastres', '')::int, sale_price_piastres)
    where product_id = v_product.id and deleted_at is null;
  end if;

  select * into v_product from public.products where id = v_product.id;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, case when v_is_new then 'product.create' else 'product.update' end, 'products', v_product.id::text,
          jsonb_build_object('status', v_product.status, 'name_ar', v_product.name_ar));

  return jsonb_build_object(
    'id', v_product.id,
    'slug_ar', v_product.slug_ar,
    'slug_en', v_product.slug_en,
    'status', v_product.status,
    'updated_at', v_product.updated_at
  );
end $$;

revoke all on function public.fn_save_product(jsonb, uuid) from public, anon;
grant execute on function public.fn_save_product(jsonb, uuid) to authenticated;

-- ============================================================================
-- RPC: fn_submit_product — draft/rejected → pending (or approved when the
-- settings skip review). Blocks when the vendor cannot sell (grace expired).
-- ============================================================================
create or replace function public.fn_submit_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_product public.products%rowtype;
  v_vendor  public.vendors%rowtype;
  v_config  jsonb := public.fn_vendor_config();
  v_target  text;
  v_missing text[] := '{}'::text[];
  v_attr    record;
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then
    raise exception 'product not found';
  end if;
  select * into v_vendor from public.vendors where id = v_product.vendor_id;
  if v_vendor.owner_id <> v_user then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is not submittable in status %', v_product.status;
  end if;

  -- selling gate (grace expiry / suspension blocks publish at API level)
  if not public.vendor_can_sell(v_vendor.id) then
    raise exception 'selling is blocked for this store (% / %)', v_vendor.status, v_vendor.verification_status
      using errcode = 'P0001';
  end if;

  -- completeness validation
  if coalesce(v_product.name_ar, '') = '' or coalesce(v_product.name_en, '') = '' then
    v_missing := v_missing || 'name';
  end if;
  if not exists (
    select 1 from public.product_media where product_id = v_product.id
  ) then
    v_missing := v_missing || 'media';
  end if;
  if not exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and sku is not null and price_piastres is not null and price_piastres > 0
  ) then
    v_missing := v_missing || 'variants';
  end if;
  if exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and (sku is null or price_piastres is null or price_piastres <= 0)
  ) then
    v_missing := v_missing || 'variants_incomplete';
  end if;
  for v_attr in
    select ad.code from public.category_attributes ca
    join public.attribute_defs ad on ad.id = ca.attribute_id
    where ca.category_id = v_product.leaf_category_id and ad.is_required and ad.deleted_at is null
      and not exists (
        select 1 from public.product_attribute_values pav
        where pav.product_id = v_product.id and pav.attribute_id = ad.id
      )
  loop
    v_missing := v_missing || ('attribute:' || v_attr.code);
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'product is incomplete: %', array_to_string(v_missing, ', ');
  end if;

  -- review mode from settings
  if coalesce(v_config ->> 'review_required', 'true') = 'true' then
    v_target := 'pending';
  else
    v_target := 'approved';
  end if;

  update public.products set
    status = v_target,
    rejection_reason = null,
    submitted_at = now(),
    published_at = case when v_target = 'approved' then now() else null end
  where id = v_product.id
  returning * into v_product;

  if v_target = 'pending' then
    -- notify admins: product awaiting review
    perform public.fn_notify(a.id, 'product.pending', jsonb_build_object(
      'product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
      'vendor', v_vendor.store_name_ar
    ))
    from public.profiles a where a.role = 'admin';
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'product.submit', 'products', v_product.id::text, jsonb_build_object('status', v_target));

  return jsonb_build_object('status', v_target);
end $$;

revoke all on function public.fn_submit_product(uuid) from public, anon;
grant execute on function public.fn_submit_product(uuid) to authenticated;

-- ============================================================================
-- RPC: fn_clone_product — draft "(copy)" with unique SKUs (US-12)
-- ============================================================================
create or replace function public.fn_clone_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_src     public.products%rowtype;
  v_new     public.products%rowtype;
  v_variant record;
  v_new_sku text;
  v_n       integer := 0;
  v_drift   text[] := '{}'::text[];
begin
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_src from public.products where id = p_product_id;
  if v_src.id is null then
    raise exception 'product not found';
  end if;
  if not exists (select 1 from public.vendors where id = v_src.vendor_id and owner_id = v_user) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if coalesce((public.fn_vendor_config() ->> 'allow_clone'), 'true') <> 'true' then
    raise exception 'cloning is disabled';
  end if;

  insert into public.products (
    vendor_id, leaf_category_id, brand_id, name_ar, name_en, desc_ar, desc_en, short_ar, short_en,
    is_fragile, shipping_mode, shipping_class, weight_g, dims, status, sale_starts_at, sale_ends_at
  ) values (
    v_src.vendor_id, v_src.leaf_category_id, v_src.brand_id,
    v_src.name_ar || ' (نسخة)', v_src.name_en || ' (copy)',
    v_src.desc_ar, v_src.desc_en, v_src.short_ar, v_src.short_en,
    v_src.is_fragile, v_src.shipping_mode, v_src.shipping_class, v_src.weight_g, v_src.dims,
    'draft', v_src.sale_starts_at, v_src.sale_ends_at
  ) returning * into v_new;

  update public.products set
    slug_ar = public.fn_product_slug(v_new.name_ar),
    slug_en = public.fn_product_slug(v_new.name_en)
  where id = v_new.id;

  insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
  select v_new.id, attribute_id, option_id, value_text, value_number, value_bool
  from public.product_attribute_values where product_id = v_src.id;

  insert into public.product_facets (product_id, attribute_id, option_id)
  select v_new.id, attribute_id, option_id from public.product_facets where product_id = v_src.id;

  insert into public.product_media (product_id, kind, path, position)
  select v_new.id, kind, path, position from public.product_media where product_id = v_src.id;

  insert into public.product_tags (product_id, tag_id)
  select v_new.id, tag_id from public.product_tags where product_id = v_src.id;

  for v_variant in select * from public.variants where product_id = v_src.id and deleted_at is null loop
    -- unique SKU suggestion: base-C1, -C2, ...
    v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C1';
    while exists (select 1 from public.variants where sku = v_new_sku and deleted_at is null) loop
      v_n := v_n + 1;
      v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C' || (v_n + 1)::text;
    end loop;
    v_n := 0;
    insert into public.variants (product_id, sku, option_key, option_ids, price_piastres, sale_price_piastres, stock, image_path, is_active)
    values (v_new.id, v_new_sku, v_variant.option_key, v_variant.option_ids,
            v_variant.price_piastres, v_variant.sale_price_piastres, v_variant.stock, v_variant.image_path, v_variant.is_active);
  end loop;

  -- template drift warning: attributes no longer in the current template
  select coalesce(array_agg(pav.attribute_id::text), '{}'::text[]) into v_drift
  from public.product_attribute_values pav
  where pav.product_id = v_new.id
    and not exists (
      select 1 from public.category_attributes ca
      where ca.category_id = v_new.leaf_category_id and ca.attribute_id = pav.attribute_id
    );

  return jsonb_build_object('id', v_new.id, 'name_en', v_new.name_en, 'drifted_attributes', to_jsonb(v_drift));
end $$;

revoke all on function public.fn_clone_product(uuid) from public, anon;
grant execute on function public.fn_clone_product(uuid) to authenticated;

-- ============================================================================
-- RPC: fn_admin_review_product — approve/reject with mandatory reason
-- ============================================================================
create or replace function public.fn_admin_review_product(p_product_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_product public.products%rowtype;
  v_vendor  public.vendors%rowtype;
begin
  if not (public.is_admin() or public.has_permission('products.review')) then
    raise exception 'not allowed: reviewer permission required' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then
    raise exception 'product not found';
  end if;
  if v_product.status <> 'pending' then
    raise exception 'product is not awaiting review (status %)', v_product.status;
  end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then
    raise exception 'a rejection reason is mandatory';
  end if;

  select * into v_vendor from public.vendors where id = v_product.vendor_id;

  update public.products set
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    rejection_reason = case when p_decision = 'reject' then trim(p_reason) else null end,
    published_at = case when p_decision = 'approve' then now() else null end
  where id = v_product.id
  returning * into v_product;

  perform public.fn_notify(v_vendor.owner_id, 'product.' || p_decision || 'd', jsonb_build_object(
    'product_id', v_product.id,
    'name_ar', v_product.name_ar,
    'name_en', v_product.name_en,
    'reason', case when p_decision = 'reject' then trim(p_reason) else null end
  ));

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'product.review', 'products', v_product.id::text,
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', v_product.status, 'reason', v_product.rejection_reason));

  return jsonb_build_object('status', v_product.status);
end $$;

revoke all on function public.fn_admin_review_product(uuid, text, text) from public, anon;
grant execute on function public.fn_admin_review_product(uuid, text, text) to authenticated;

-- ============================================================================
-- RPC: fn_admin_review_vendor — store activation (pending → active/rejected)
-- ============================================================================
create or replace function public.fn_admin_review_vendor(p_vendor_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
  v_grace  interval;
  v_cfg    jsonb := public.fn_vendor_config();
begin
  if not (public.is_admin() or public.has_permission('vendors.review')) then
    raise exception 'not allowed: reviewer permission required' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id;
  if v_vendor.id is null then
    raise exception 'vendor not found';
  end if;
  if v_vendor.status <> 'pending' then
    raise exception 'vendor is not awaiting review (status %)', v_vendor.status;
  end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then
    raise exception 'a rejection reason is mandatory';
  end if;

  update public.vendors set
    status = case when p_decision = 'approve' then 'active' else 'rejected' end,
    rejection_reason = case when p_decision = 'reject' then trim(p_reason) else null end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    -- activation starts the grace clock if still unverified
    grace_until = case
      when p_decision = 'approve' and verification_status = 'unverified' and grace_until is null then
        now() + make_interval(
          days  => case when v_cfg ->> 'grace_unit' = 'days' then greatest((v_cfg ->> 'grace_value')::int, 1) else 0 end,
          hours => case when v_cfg ->> 'grace_unit' = 'hours' then greatest((v_cfg ->> 'grace_value')::int, 1) else 0 end,
          years => case when v_cfg ->> 'grace_unit' = 'months' then greatest((v_cfg ->> 'grace_value')::int, 1) else 0 end
        )
      else grace_until end
  where id = p_vendor_id
  returning * into v_vendor;

  perform public.fn_notify(v_vendor.owner_id, 'vendor.' || p_decision || 'd', jsonb_build_object(
    'vendor_id', v_vendor.id,
    'store_name_ar', v_vendor.store_name_ar,
    'reason', case when p_decision = 'reject' then trim(p_reason) else null end
  ));

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'vendor.review', 'vendors', v_vendor.id::text,
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', v_vendor.status, 'reason', v_vendor.rejection_reason));

  return jsonb_build_object('status', v_vendor.status, 'grace_until', v_vendor.grace_until);
end $$;

revoke all on function public.fn_admin_review_vendor(uuid, text, text) from public, anon;
grant execute on function public.fn_admin_review_vendor(uuid, text, text) to authenticated;

-- ============================================================================
-- RPC: fn_admin_verify_vendor — KYC decision (warning clears only on verify)
-- ============================================================================
create or replace function public.fn_admin_verify_vendor(p_vendor_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
begin
  if not (public.is_admin() or public.has_permission('vendors.verify')) then
    raise exception 'not allowed: verifier permission required' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id;
  if v_vendor.id is null then
    raise exception 'vendor not found';
  end if;

  update public.vendors set
    verification_status = case when p_decision = 'approve' then 'verified' else 'rejected' end,
    verification_note = case when p_decision = 'reject' then trim(coalesce(p_note, '')) else null end,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_vendor_id
  returning * into v_vendor;

  if p_decision = 'approve' then
    -- verification clears grace: products return to sale
    update public.variants set is_active = true
    where product_id in (select id from public.products where vendor_id = v_vendor.id)
      and deleted_at is null;
  end if;

  perform public.fn_notify(v_vendor.owner_id, 'verification.' || p_decision || 'd', jsonb_build_object(
    'vendor_id', v_vendor.id,
    'note', case when p_decision = 'reject' then trim(coalesce(p_note, '')) else null end
  ));

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'vendor.verify', 'vendors', v_vendor.id::text,
          jsonb_build_object('verification_status', v_vendor.verification_status));

  return jsonb_build_object('verification_status', v_vendor.verification_status);
end $$;

revoke all on function public.fn_admin_verify_vendor(uuid, text, text) from public, anon;
grant execute on function public.fn_admin_verify_vendor(uuid, text, text) to authenticated;

-- ============================================================================
-- RPC: fn_expire_grace — daily cron + admin trigger. Flips expired unverified
-- vendors to grace_expired and marks their variants unavailable (V-06).
-- ============================================================================
create or replace function public.fn_expire_grace()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_vendor record;
  v_count  integer := 0;
  v_admins uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_admins from public.profiles where role = 'admin';

  for v_vendor in
    select * from public.vendors
    where status = 'active'
      and verification_status = 'unverified'
      and grace_until is not null
      and grace_until < now()
  loop
    update public.vendors set verification_status = 'grace_expired' where id = v_vendor.id;
    update public.variants set is_active = false
    where product_id in (select id from public.products where vendor_id = v_vendor.id)
      and deleted_at is null;
    perform public.fn_notify(v_vendor.owner_id, 'verification.grace_expired', jsonb_build_object(
      'vendor_id', v_vendor.id,
      'store_name_ar', v_vendor.store_name_ar
    ));
    for i in 1..coalesce(cardinality(v_admins), 0) loop
      perform public.fn_notify(v_admins[i], 'vendor.grace_expired', jsonb_build_object(
        'vendor_id', v_vendor.id, 'store_name_ar', v_vendor.store_name_ar
      ));
    end loop;
    insert into public.audit_logs (action, entity, entity_id, after)
    values ('vendor.grace_expired', 'vendors', v_vendor.id::text, jsonb_build_object('grace_until', v_vendor.grace_until));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.fn_expire_grace() from public, anon;
grant execute on function public.fn_expire_grace() to authenticated;

-- ============================================================================
-- AUDIT TRIGGERS (sensitive lifecycle rows)
-- ============================================================================
create or replace function public.fn_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid;
begin
  actor := auth.uid();
  if actor is null then
    return coalesce(new, old);
  end if;
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (
    actor,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_vendors on public.vendors;
create trigger trg_audit_vendors after insert or update or delete on public.vendors
  for each row execute function public.fn_audit_row();
drop trigger if exists trg_audit_vendor_documents on public.vendor_documents;
create trigger trg_audit_vendor_documents after insert or update or delete on public.vendor_documents
  for each row execute function public.fn_audit_row();

-- ============================================================================
-- RLS: enable + revoke + policies
-- ============================================================================

alter table public.vendor_levels        enable row level security;
alter table public.vendors              enable row level security;
alter table public.store_members        enable row level security;
alter table public.vendor_documents     enable row level security;
alter table public.products             enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_facets       enable row level security;
alter table public.product_media        enable row level security;
alter table public.product_tags         enable row level security;
alter table public.variants             enable row level security;

revoke all on public.vendor_levels    from anon, authenticated;
revoke all on public.vendors          from anon, authenticated;
revoke all on public.store_members    from anon, authenticated;
revoke all on public.vendor_documents from anon, authenticated;
revoke all on public.products         from anon, authenticated;
revoke all on public.product_attribute_values from anon, authenticated;
revoke all on public.product_facets   from anon, authenticated;
revoke all on public.product_media    from anon, authenticated;
revoke all on public.product_tags     from anon, authenticated;
revoke all on public.variants         from anon, authenticated;

-- vendor_levels: public read
grant select on public.vendor_levels to anon, authenticated;
drop policy if exists vendor_levels_read on public.vendor_levels;
create policy vendor_levels_read on public.vendor_levels
  for select to anon, authenticated using (is_active);

-- vendors: owner reads/edits profile columns; admin reads all.
-- status/verification/grace/reviewed_* are NOT owner-updatable (column grants).
grant select on public.vendors to authenticated;
grant insert, delete on public.vendors to authenticated;
grant update (
  slug, store_name_ar, store_name_en, short_desc_ar, short_desc_en,
  welcome_msg_ar, welcome_msg_en, logo_path, banner_path, category_ids,
  first_name, last_name, phone, governorate_id, area_id, address1, address2,
  postal_code, socials, onboarding_step
) on public.vendors to authenticated;

drop policy if exists vendors_select_own on public.vendors;
create policy vendors_select_own on public.vendors
  for select to authenticated using (owner_id = auth.uid());
drop policy if exists vendors_select_admin on public.vendors;
create policy vendors_select_admin on public.vendors
  for select to authenticated using (public.is_admin());
drop policy if exists vendors_insert_own on public.vendors;
create policy vendors_insert_own on public.vendors
  for insert to authenticated with check (owner_id = auth.uid() and status = 'draft');
drop policy if exists vendors_update_own on public.vendors;
create policy vendors_update_own on public.vendors
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
drop policy if exists vendors_delete_own_draft on public.vendors;
create policy vendors_delete_own_draft on public.vendors
  for delete to authenticated using (owner_id = auth.uid() and status = 'draft');

-- store_members: read own memberships (+ admin)
grant select on public.store_members to authenticated;
drop policy if exists store_members_select_own on public.store_members;
create policy store_members_select_own on public.store_members
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- vendor_documents: owner metadata CRUD (objects stay private via storage);
-- owner may replace path/mime/size but never flip status/review columns.
grant select, insert, delete on public.vendor_documents to authenticated;
grant update (path, original_name, mime, size_bytes) on public.vendor_documents to authenticated;
drop policy if exists vendor_documents_owner on public.vendor_documents;
create policy vendor_documents_owner on public.vendor_documents
  for all to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()));
drop policy if exists vendor_documents_admin_read on public.vendor_documents;
create policy vendor_documents_admin_read on public.vendor_documents
  for select to authenticated using (public.is_admin());

-- products: owner drafts; public sees approved products of sellable vendors
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon, authenticated
  using (deleted_at is null and public.product_is_public(id));
drop policy if exists products_select_own on public.products;
create policy products_select_own on public.products
  for select to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()));
drop policy if exists products_select_admin on public.products;
create policy products_select_admin on public.products
  for select to authenticated using (public.is_admin());
drop policy if exists products_insert_own on public.products;
create policy products_insert_own on public.products
  for insert to authenticated
  with check (
    exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid())
    and status = 'draft'
  );
drop policy if exists products_update_own on public.products;
create policy products_update_own on public.products
  for update to authenticated
  using (
    exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid())
    and status in ('draft', 'rejected')
  )
  with check (
    exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid())
    and status in ('draft', 'rejected')
  );
drop policy if exists products_delete_own on public.products;
create policy products_delete_own on public.products
  for delete to authenticated
  using (
    exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid())
    and status in ('draft', 'rejected')
  );

-- product children: reads follow the product state; writes ONLY via definer RPCs
grant select on public.product_attribute_values to anon, authenticated;
grant select on public.product_facets to anon, authenticated;
grant select on public.product_media to anon, authenticated;
grant select on public.product_tags to anon, authenticated;

drop policy if exists pav_read on public.product_attribute_values;
create policy pav_read on public.product_attribute_values
  for select to anon, authenticated
  using (
    public.product_is_public(product_id)
    or public.product_owned_or_admin(product_id)
  );
drop policy if exists facets_read on public.product_facets;
create policy facets_read on public.product_facets
  for select to anon, authenticated
  using (
    public.product_is_public(product_id)
    or public.product_owned_or_admin(product_id)
  );
drop policy if exists product_media_read on public.product_media;
create policy product_media_read on public.product_media
  for select to anon, authenticated
  using (
    public.product_is_public(product_id)
    or public.product_owned_or_admin(product_id)
  );
drop policy if exists product_tags_read on public.product_tags;
create policy product_tags_read on public.product_tags
  for select to anon, authenticated
  using (
    public.product_is_public(product_id)
    or public.product_owned_or_admin(product_id)
  );

-- variants: reads follow the product; ALL writes via definer RPCs (atomicity rule)
grant select on public.variants to anon, authenticated;
drop policy if exists variants_read on public.variants;
create policy variants_read on public.variants
  for select to anon, authenticated
  using (
    (deleted_at is null and public.product_is_public(product_id))
    or public.product_owned_or_admin(product_id)
  );

-- ============================================================================
-- CRON: expire vendor verification grace daily (03:10 UTC) when pg_cron exists
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    begin
      perform cron.unschedule('expire-vendor-grace');
    exception when others then null;
    end;
    perform cron.schedule('expire-vendor-grace', '10 3 * * *', 'select public.fn_expire_grace();');
  else
    raise notice 'pg_cron not available — fn_expire_grace is exposed for a scheduled Edge Function';
  end if;
end $$;
