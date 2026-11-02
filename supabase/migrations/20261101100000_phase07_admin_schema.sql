-- ============================================================================
-- Etsawaa — Phase 07 Admin Suite (schema, part 1 of 2)
-- New tables: ad_packages, ad_campaigns, blog_categories, blog_posts,
--             penalty_rules, vendor_level_history
-- New columns: refund decision fields · vendors commission/permission fields ·
--              products admin fields · withdrawal failure note
-- RLS + grants for everything new. Idempotent. Money = integer piastres.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ADS (AGENT §19): packages (placement/duration/price/discount/slots) +
--    campaigns. source = 'paid' | 'admin_grant' — SINGLE feature mechanism.
-- ----------------------------------------------------------------------------
create table if not exists public.ad_packages (
  id                uuid primary key default gen_random_uuid(),
  name_ar           text not null,
  name_en           text not null,
  placement         text not null check (placement in ('hero_banner','footer_banner','featured_product')),
  duration_days     integer not null check (duration_days > 0),
  price_piastres    integer not null check (price_piastres >= 0),
  discount_percent  integer not null default 0 check (discount_percent between 0 and 90),
  discount_ends_at  timestamptz,            -- temporary discount window
  visibility        text not null default 'vendors' check (visibility in ('vendors','admins')),
  slots             integer not null default 1 check (slots > 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists public.ad_campaigns (
  id             uuid primary key default gen_random_uuid(),
  package_id     uuid not null references public.ad_packages(id) on delete restrict,
  vendor_id      uuid not null references public.vendors(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  source         text not null default 'paid' check (source in ('paid','admin_grant')),
  status         text not null default 'active' check (status in ('active','expired','cancelled')),
  started_at     timestamptz not null default now(),
  ends_at        timestamptz not null,
  impressions    integer not null default 0 check (impressions >= 0),
  clicks         integer not null default 0 check (clicks >= 0),
  granted_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists ad_campaigns_vendor_idx on public.ad_campaigns (vendor_id, created_at desc);
create index if not exists ad_campaigns_active_idx on public.ad_campaigns (status, ends_at)
  where status = 'active';

comment on table public.ad_campaigns is 'Featured mechanics: source paid|admin_grant is the single mechanism behind is_featured (AGENT §19).';

-- ----------------------------------------------------------------------------
-- 2) BLOG (A-27): categories + posts with ar/en bodies, SEO fields, status.
-- ----------------------------------------------------------------------------
create table if not exists public.blog_categories (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null,
  name_en    text not null,
  slug_ar    text not null unique,
  slug_en    text not null unique,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id          uuid primary key default gen_random_uuid(),
  author      uuid references auth.users(id) on delete set null,
  title_ar    text not null default '',
  title_en    text not null default '',
  slug_ar     text not null,
  slug_en     text not null,
  excerpt_ar  text not null default '',
  excerpt_en  text not null default '',
  content_ar  text not null default '',
  content_en  text not null default '',
  cover_path  text,
  category_id uuid references public.blog_categories(id) on delete set null,
  seo_title_ar  text not null default '',
  seo_title_en  text not null default '',
  seo_desc_ar   text not null default '',
  seo_desc_en   text not null default '',
  status      text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint blog_posts_slug_ar_unique unique (slug_ar),
  constraint blog_posts_slug_en_unique unique (slug_en)
);
create index if not exists blog_posts_status_idx on public.blog_posts (status, published_at desc);

-- ----------------------------------------------------------------------------
-- 3) PENALTY RULES (AGENT §18) — trigger config; soft delete keeps history.
-- ----------------------------------------------------------------------------
create table if not exists public.penalty_rules (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,        -- stable machine key
  name_ar       text not null,
  name_en       text not null,
  trigger_type  text not null check (trigger_type in ('returns_count','defect_order','low_rating','packaging','manual')),
  threshold     integer not null default 1 check (threshold > 0),
  amount_piastres integer not null check (amount_piastres > 0),
  is_active     boolean not null default true,
  deleted_at    timestamptz,                 -- SOFT delete (history preserved)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) LEVEL HISTORY (AGENT §20) — every promote/demote logged + notified.
-- ----------------------------------------------------------------------------
create table if not exists public.vendor_level_history (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  from_level  uuid references public.vendor_levels(id),
  to_level    uuid not null references public.vendor_levels(id),
  actor       uuid references auth.users(id),   -- null = automatic (cron)
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists vendor_level_history_vendor_idx on public.vendor_level_history (vendor_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5) REFUND DECISION FIELDS (US-05): per-item fault/amount/restock. The admin
--    decision is final; vendor fault ⇒ clawback + penalty, shipping ⇒ none.
-- ----------------------------------------------------------------------------
alter table public.refund_request_items
  add column if not exists decision text
    check (decision in ('approve','partial','reject')),
  add column if not exists fault text
    check (fault in ('vendor','shipping','customer','defect')),
  add column if not exists refund_amount_piastres integer
    check (refund_amount_piastres is null or refund_amount_piastres >= 0),
  add column if not exists restock boolean not null default true,
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decided_at timestamptz;

alter table public.refund_requests
  add column if not exists executed_at timestamptz,
  add column if not exists executed_by uuid references auth.users(id),
  add column if not exists execution_note text;

-- ----------------------------------------------------------------------------
-- 6) VENDOR COMMISSION + PERMISSION FIELDS (A-05/A-06; US-03).
--    commission_mode: inherit (leaf category) | fixed | category.
--    Custom per-leaf values live in vendor_commission_overrides.
-- ----------------------------------------------------------------------------
alter table public.vendors
  add column if not exists commission_mode text not null default 'inherit'
    check (commission_mode in ('inherit','fixed','category')),
  add column if not exists commission_fixed_percent numeric(5,2)
    check (commission_fixed_percent is null or commission_fixed_percent between 0 and 100),
  add column if not exists allow_direct_publish boolean not null default false,
  add column if not exists can_change_order_status boolean not null default true,
  add column if not exists featured_until timestamptz,
  add column if not exists featured_permanent boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists hidden_reason text;

create table if not exists public.vendor_commission_overrides (
  vendor_id      uuid not null references public.vendors(id) on delete cascade,
  category_id    uuid not null references public.categories(id) on delete cascade,
  percent        numeric(5,2) not null check (percent between 0 and 100),
  primary key (vendor_id, category_id)
);

-- ----------------------------------------------------------------------------
-- 7) PRODUCTS admin fields (A-09 import/export source tracking)
-- ----------------------------------------------------------------------------
alter table public.products
  add column if not exists source text not null default 'vendor'
    check (source in ('vendor','admin','import')),
  add column if not exists admin_note text;

-- ----------------------------------------------------------------------------
-- 8) WITHDRAWALS: failure/receipt note on approval is free-text and optional;
--    cancel_reason already exists (phase 06).
-- ----------------------------------------------------------------------------

-- ============================================================================
-- RLS + GRANTS
-- ============================================================================
alter table public.ad_packages        enable row level security;
alter table public.ad_campaigns       enable row level security;
alter table public.blog_categories    enable row level security;
alter table public.blog_posts         enable row level security;
alter table public.penalty_rules      enable row level security;
alter table public.vendor_level_history enable row level security;
alter table public.vendor_commission_overrides enable row level security;

-- Ads: admins full; vendors read active packages + own campaigns
drop policy if exists ad_packages_admin_all on public.ad_packages;
create policy ad_packages_admin_all on public.ad_packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ad_packages_read on public.ad_packages;
create policy ad_packages_read on public.ad_packages
  for select to authenticated using (is_active);

drop policy if exists ad_campaigns_admin_all on public.ad_campaigns;
create policy ad_campaigns_admin_all on public.ad_campaigns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ad_campaigns_own_read on public.ad_campaigns;
create policy ad_campaigns_own_read on public.ad_campaigns
  for select to authenticated
  using (vendor_id = public.own_vendor_id());

-- Blog: published readable by everyone (incl. anon); drafts admin-only
drop policy if exists blog_categories_read on public.blog_categories;
create policy blog_categories_read on public.blog_categories
  for select using (true);
drop policy if exists blog_categories_admin_all on public.blog_categories;
create policy blog_categories_admin_all on public.blog_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists blog_posts_read on public.blog_posts;
create policy blog_posts_read on public.blog_posts
  for select using (status = 'published' or public.is_admin());

drop policy if exists blog_posts_admin_all on public.blog_posts;
create policy blog_posts_admin_all on public.blog_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Penalty rules: admin write, vendors see active keys (for the "why" display)
drop policy if exists penalty_rules_admin_all on public.penalty_rules;
create policy penalty_rules_admin_all on public.penalty_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists penalty_rules_read on public.penalty_rules;
create policy penalty_rules_read on public.penalty_rules
  for select to authenticated using (is_active and deleted_at is null);

-- Level history: admins + the vendor themself
drop policy if exists level_history_admin_read on public.vendor_level_history;
create policy level_history_admin_read on public.vendor_level_history
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()
    )
  );

-- Commission overrides: admin-only
drop policy if exists vendor_commission_admin_all on public.vendor_commission_overrides;
create policy vendor_commission_admin_all on public.vendor_commission_overrides
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Refund decision columns ride the existing refund RLS (owner/admin/vendor views).

-- ----------------------------------------------------------------------------
-- GRANTS (definer RPCs do the writes; direct table grants stay read-only)
-- ----------------------------------------------------------------------------
grant select on public.ad_packages, public.ad_campaigns, public.penalty_rules,
  public.vendor_level_history, public.vendor_commission_overrides to authenticated;
grant select, insert, update, delete on public.blog_categories to authenticated;
grant select, insert, update, delete on public.blog_posts to authenticated;

revoke all on public.ad_packages, public.ad_campaigns, public.blog_categories,
  public.blog_posts, public.penalty_rules, public.vendor_level_history,
  public.vendor_commission_overrides from public, anon;
grant select on public.ad_packages, public.blog_categories to anon;
grant select on public.blog_posts to anon;

-- Black Friday preset event (Nov 1–30, current year, idempotent by name)
insert into public.events (name_ar, name_en, desc_ar, desc_en, starts_at, ends_at, status)
select 'الجمعة البيضاء', 'Black Friday',
       'خصومات نوفمبر على-category من الإدارة', 'November discounts across categories',
       date_trunc('month', now())::timestamptz,
       (date_trunc('month', now()) + interval '1 month - 1 second')::timestamptz,
       'active'
where not exists (select 1 from public.events where name_en = 'Black Friday');

-- Penalty rules baseline (idempotent by key)
insert into public.penalty_rules (key, name_ar, name_en, trigger_type, threshold, amount_piastres)
values
  ('defect_order',   'طلب معيب',          'Defective order',   'defect_order', 1, 5000),
  ('returns_high',   'معدل مرتجعات مرتفع', 'High return rate',  'returns_count', 3, 10000),
  ('rating_low',     'تقييمات منخفضة',     'Low ratings',       'low_rating',   3, 7500)
on conflict (key) do nothing;
