-- Ads marketplace (owner brief 2026-11-13 + "دليل الإعلانات للتجار"):
--  * the admin builds packages from PLACEMENTS — each package holds one or more
--    placements, each with a number of slots (banners on the home page / a
--    category page / between home sections, featured products in home
--    sections or categories, a popup with design templates, sponsored spots on
--    product pages, a featured store, offer campaigns, and services such as
--    push notifications, campaign management and photography);
--  * a vendor buys a package, fills every slot (which product / banner image /
--    section / category / template, in the order they want) and pays by card
--    (Kashier, "AD-" order numbers) or from the wallet — never cash on delivery;
--  * the admin reviews: approve → the campaigns start now and run for the
--    package duration; reject → refund to the wallet or, at the vendor's choice
--    of payout, as a withdrawal request on their payout method.

-- ── 1. placements catalogue (the storefront knows how to render each code)
create table if not exists public.ad_placements (
  code text primary key,
  kind text not null check (kind in ('banner', 'featured', 'popup', 'product_page', 'store', 'campaign', 'service')),
  name_ar text not null,
  name_en text not null,
  desc_ar text not null default '',
  desc_en text not null default '',
  needs_product boolean not null default false,
  needs_image boolean not null default false,
  sort int not null default 0,
  is_active boolean not null default true
);
insert into public.ad_placements (code, kind, name_ar, name_en, desc_ar, desc_en, needs_product, needs_image, sort) values
  ('home_hero', 'banner', 'بانر الواجهة الرئيسية', 'Home hero banner', 'صورة كبيرة في سلايدر أعلى الصفحة الرئيسية.', 'A large image in the slider at the top of the home page.', false, true, 1),
  ('home_spot', 'banner', 'بانر بين أقسام الرئيسية', 'Home section banner', 'بانر عريض بين أقسام الصفحة الرئيسية في المكان الذي تختاره.', 'A wide banner between the home page sections, in the spot you choose.', false, true, 2),
  ('category_banner', 'banner', 'بانر صفحة قسم', 'Category banner', 'بانر أعلى صفحة القسم الذي تختاره.', 'A banner at the top of the category page you choose.', false, true, 3),
  ('home_section', 'featured', 'منتج مميز في أقسام الرئيسية', 'Featured in a home section', 'منتجك في أول قسم "وافد جديد" أو "العروض" أو "الأكثر شعبية" بالصفحة الرئيسية.', 'Your product first in New arrivals, Offers or Most popular on the home page.', true, false, 4),
  ('category_featured', 'featured', 'منتج مميز في قسم', 'Featured in a category', 'منتجك في أول نتائج القسم الذي تختاره.', 'Your product at the top of the category you choose.', true, false, 5),
  ('popup', 'popup', 'إعلان منبثق', 'Popup ad', 'منتجك في نافذة منبثقة بتصميم إعلاني يظهر لزوار الموقع.', 'Your product in a designed popup shown to visitors.', true, false, 6),
  ('product_page', 'product_page', 'إعلان داخل صفحة المنتج', 'In-product-page ad', 'منتجك يظهر كـ "منتج مُموَّل" لمن يشاهد منتجاً مشابهاً، بعدد مرات ظهور.', 'Your product shown as "Sponsored" to shoppers viewing similar products, by impressions.', true, false, 7),
  ('featured_store', 'store', 'متجر مميز', 'Featured store', 'متجرك وشعارك في أول المتاجر بالصفحة الرئيسية وصفحة المتاجر.', 'Your store and logo first among stores on the home page and the stores page.', false, false, 8),
  ('offer_campaign', 'campaign', 'حملة عروض', 'Offer campaign', 'منتجك ضمن حملة التخفيضات الكبرى للمنصة (لازم يكون عليه خصم).', 'Your product in the platform''s big sale campaign (it must be discounted).', true, false, 9),
  ('push_notification', 'service', 'إشعار للعملاء', 'Push notification', 'رسالة تصل للعملاء وقت عرضك.', 'A message delivered to customers at the time of your offer.', false, false, 10),
  ('campaign_management', 'service', 'إدارة الحملة', 'Campaign management', 'فريق المنصة يكتب المحتوى ويصمم صور إعلانك.', 'The platform team writes your content and designs your ad images.', false, false, 11),
  ('photography', 'service', 'تصوير احترافي', 'Professional photography', 'تصوير منتجاتك على خلفية بيضاء بمصور محترف (صور أو فيديو).', 'Professional white-background photos or video of your products.', false, false, 12)
on conflict (code) do update set kind = excluded.kind, name_ar = excluded.name_ar, name_en = excluded.name_en,
  desc_ar = excluded.desc_ar, desc_en = excluded.desc_en, needs_product = excluded.needs_product, needs_image = excluded.needs_image, sort = excluded.sort;
alter table public.ad_placements enable row level security;
drop policy if exists ad_placements_read on public.ad_placements;
create policy ad_placements_read on public.ad_placements for select using (true);
grant select on public.ad_placements to anon, authenticated;

-- ── 2. packages: a list of placement items instead of one placement
alter table public.ad_packages alter column placement drop not null;
alter table public.ad_packages drop constraint if exists ad_packages_placement_check;
alter table public.ad_packages add column if not exists desc_ar text not null default '';
alter table public.ad_packages add column if not exists desc_en text not null default '';
-- [{ "placement": code, "count": n, "spots": [...], "sections": [...], "templates": [...] }]
alter table public.ad_packages add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.ad_packages add column if not exists pricing_model text not null default 'fixed';
alter table public.ad_packages drop constraint if exists ad_packages_pricing_model_check;
alter table public.ad_packages add constraint ad_packages_pricing_model_check check (pricing_model in ('fixed', 'cpm', 'cpc'));
alter table public.ad_packages add column if not exists impressions_included integer;
alter table public.ad_packages add column if not exists sort integer not null default 0;
alter table public.ad_packages add column if not exists is_featured boolean not null default false;
-- the one old package keeps working as a hero banner package
update public.ad_packages set items = jsonb_build_array(jsonb_build_object('placement',
         case placement when 'hero_banner' then 'home_hero' when 'footer_banner' then 'home_spot' else 'home_section' end, 'count', slots))
 where items = '[]'::jsonb and placement is not null;

-- ── 3. orders
create sequence if not exists public.ad_order_seq;
create table if not exists public.ad_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  attempt_key uuid not null unique,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  package_id uuid references public.ad_packages(id) on delete set null,
  package_snapshot jsonb not null,
  assignments jsonb not null default '[]'::jsonb,
  amount_piastres integer not null check (amount_piastres >= 0),
  payment_method text not null check (payment_method in ('card', 'wallet')),
  payment_mode text not null default 'live',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  kashier_session_id text,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'in_review', 'approved', 'rejected', 'cancelled')),
  notes text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  reject_reason text,
  refund_method text check (refund_method is null or refund_method in ('wallet', 'withdrawal')),
  refunded_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz
);
create index if not exists ad_orders_vendor_idx on public.ad_orders (vendor_id, created_at desc);
create index if not exists ad_orders_status_idx on public.ad_orders (status, created_at);
alter table public.ad_orders enable row level security;
drop policy if exists ad_orders_read on public.ad_orders;
create policy ad_orders_read on public.ad_orders for select to authenticated
  using (vendor_id = public.own_vendor_id() or public.is_admin() or public.has_permission('ads.manage'));
grant select on public.ad_orders to authenticated;

create table if not exists public.ad_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ad_orders(id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  amount_piastres integer not null,
  status text not null check (status in ('succeeded', 'failed')),
  failure_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
alter table public.ad_order_payments enable row level security;
drop policy if exists ad_order_payments_read on public.ad_order_payments;
create policy ad_order_payments_read on public.ad_order_payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.ad_orders o where o.id = order_id and o.vendor_id = public.own_vendor_id()));
grant select on public.ad_order_payments to authenticated;

-- ── 4. campaigns carry what they show and where
alter table public.ad_campaigns add column if not exists order_id uuid references public.ad_orders(id) on delete set null;
alter table public.ad_campaigns add column if not exists placement text;
alter table public.ad_campaigns add column if not exists section text;
alter table public.ad_campaigns add column if not exists spot text;
alter table public.ad_campaigns add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.ad_campaigns add column if not exists template text;
alter table public.ad_campaigns add column if not exists image_path text;
alter table public.ad_campaigns add column if not exists link_url text;
alter table public.ad_campaigns add column if not exists position integer not null default 0;
alter table public.ad_campaigns add column if not exists impressions_limit integer;
alter table public.ad_campaigns add column if not exists banner_id uuid references public.banners(id) on delete set null;
alter table public.ad_campaigns alter column package_id drop not null;
create index if not exists ad_campaigns_live_idx on public.ad_campaigns (placement, status, ends_at);

-- banners: a vendor's paid banner (home spot, category page)
alter table public.banners add column if not exists vendor_id uuid references public.vendors(id) on delete cascade;
alter table public.banners add column if not exists category_id uuid references public.categories(id) on delete cascade;
alter table public.banners drop constraint if exists banners_placement_check;
alter table public.banners add constraint banners_placement_check check (placement = any (array['hero', 'after_brands', 'after_categories', 'after_best',
  'after_best_selling', 'after_top_rated', 'after_vendors', 'after_recent', 'bottom', 'category']));

-- wallet: an ad refund credit
alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type = any (array['earning', 'commission', 'pickup_fee',
  'shipping_revenue', 'penalty', 'ad_purchase', 'withdrawal', 'withdrawal_refund', 'refund_clawback', 'admin_adjustment',
  'packaging_balance', 'packaging_refund', 'ad_refund']));
-- withdrawals: an ad refund paid out on the vendor's payout method
alter table public.withdrawal_requests add column if not exists kind text not null default 'withdrawal';
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_kind_check;
alter table public.withdrawal_requests add constraint withdrawal_requests_kind_check check (kind in ('withdrawal', 'ad_refund'));
alter table public.withdrawal_requests add column if not exists reference text;

-- featured products: the new featured placements count too
do $$
declare v_def text := pg_get_viewdef('public.v_storefront_products'::regclass, true);
begin
  if position('''featured_product''::text))' in v_def) > 0 and position('home_section' in v_def) = 0 then
    v_def := replace(v_def, 'AND ap.placement = ''featured_product''::text))',
      'AND (ap.placement = ''featured_product''::text OR ac.placement = ANY (ARRAY[''home_section''::text, ''category_featured''::text]))))');
    v_def := replace(v_def, 'JOIN ad_packages ap ON ap.id = ac.package_id', 'LEFT JOIN ad_packages ap ON ap.id = ac.package_id');
    execute 'create or replace view public.v_storefront_products as ' || v_def;
  end if;
end $$;

-- ── 5. what the storefront shows right now
create or replace view public.v_active_ads as
  select ac.id, ac.placement, ac.section, ac.spot, ac.category_id, ac.template, ac.product_id, ac.vendor_id,
         ac.image_path, ac.link_url, ac.position, ac.ends_at
    from public.ad_campaigns ac
   where ac.status = 'active' and ac.started_at <= now() and ac.ends_at > now()
     and ac.placement is not null
     and (ac.impressions_limit is null or ac.impressions < ac.impressions_limit);
grant select on public.v_active_ads to anon, authenticated;

-- ── 6. price of a package now (temporary discount applies until it ends)
create or replace function public.fn_ad_package_price(p public.ad_packages) returns integer
language sql stable as $$
  select case when p.discount_percent > 0 and (p.discount_ends_at is null or p.discount_ends_at > now())
              then (p.price_piastres * (100 - p.discount_percent) / 100)::int else p.price_piastres end
$$;

-- ── 7. vendor places an order
create or replace function public.fn_vendor_place_ad_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vendor public.vendors%rowtype;
  v_key uuid := nullif(p_payload->>'attempt_key', '')::uuid;
  v_method text := coalesce(p_payload->>'method', 'card');
  v_pkg public.ad_packages%rowtype;
  v_existing public.ad_orders%rowtype;
  v_item jsonb; v_place public.ad_placements%rowtype;
  v_assign jsonb := coalesce(p_payload->'assignments', '[]'::jsonb);
  v_a jsonb; v_n int; v_price int; v_order public.ad_orders%rowtype; v_wallet public.wallets%rowtype;
begin
  perform public.fn_assert_my_store_operational();
  select * into v_vendor from public.vendors where id = public.own_vendor_id();
  if v_vendor.id is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_vendor.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'store_not_active'); end if;
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'attempt_key_required'); end if;
  select * into v_existing from public.ad_orders where attempt_key = v_key;
  if found then
    if v_existing.vendor_id <> v_vendor.id then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'number', v_existing.number, 'status', v_existing.status,
      'amount_piastres', v_existing.amount_piastres, 'method', v_existing.payment_method);
  end if;
  if v_method not in ('card', 'wallet') then return jsonb_build_object('ok', false, 'reason', 'bad_method'); end if;
  select * into v_pkg from public.ad_packages where id = nullif(p_payload->>'package_id', '')::uuid;
  if not found or not v_pkg.is_active or v_pkg.visibility <> 'vendors' then return jsonb_build_object('ok', false, 'reason', 'package_unavailable'); end if;

  -- every slot of every item filled with what that placement needs
  for v_item in select * from jsonb_array_elements(v_pkg.items) loop
    select * into v_place from public.ad_placements where code = v_item->>'placement';
    if not found then return jsonb_build_object('ok', false, 'reason', 'bad_package'); end if;
    select count(*) into v_n from jsonb_array_elements(v_assign) a where a->>'placement' = v_place.code;
    if v_place.kind <> 'service' and v_n <> coalesce((v_item->>'count')::int, 1) then
      return jsonb_build_object('ok', false, 'reason', 'slots_incomplete', 'placement', v_place.code);
    end if;
    for v_a in select a from jsonb_array_elements(v_assign) a where a->>'placement' = v_place.code loop
      if v_place.needs_product then
        if not exists (select 1 from public.products p where p.id = nullif(v_a->>'product_id', '')::uuid
                        and p.vendor_id = v_vendor.id and p.status = 'approved' and p.deleted_at is null) then
          return jsonb_build_object('ok', false, 'reason', 'bad_product', 'placement', v_place.code);
        end if;
      end if;
      if v_place.needs_image and coalesce(v_a->>'image_path', '') !~ ('^u/' || auth.uid()::text || '/') then
        return jsonb_build_object('ok', false, 'reason', 'image_required', 'placement', v_place.code);
      end if;
      if v_place.code = 'home_section' and coalesce(v_a->>'section', '') not in ('best', 'discounts', 'best_selling', 'top_rated', 'recent') then
        return jsonb_build_object('ok', false, 'reason', 'bad_section');
      end if;
      if v_place.code in ('category_banner', 'category_featured')
         and not exists (select 1 from public.categories c where c.id = nullif(v_a->>'category_id', '')::uuid and c.deleted_at is null) then
        return jsonb_build_object('ok', false, 'reason', 'bad_category');
      end if;
      if v_place.code = 'home_spot' and coalesce(v_a->>'spot', '') not in ('after_brands', 'after_categories', 'after_best', 'after_best_selling',
           'after_top_rated', 'after_vendors', 'after_recent', 'bottom') then
        return jsonb_build_object('ok', false, 'reason', 'bad_spot');
      end if;
      if v_place.code = 'popup' and jsonb_array_length(coalesce(v_item->'templates', '[]'::jsonb)) > 0
         and not (coalesce(v_item->'templates', '[]'::jsonb) ? coalesce(v_a->>'template', '')) then
        return jsonb_build_object('ok', false, 'reason', 'bad_template');
      end if;
    end loop;
  end loop;

  v_price := public.fn_ad_package_price(v_pkg);
  insert into public.ad_orders (number, attempt_key, vendor_id, package_id, package_snapshot, assignments, amount_piastres,
      payment_method, status, payment_status, notes, created_by)
  values ('AD-' || to_char(now(), 'YY') || lpad(nextval('public.ad_order_seq')::text, 6, '0'), v_key, v_vendor.id, v_pkg.id,
      to_jsonb(v_pkg) || jsonb_build_object('charged_piastres', v_price), v_assign, v_price, v_method,
      'pending_payment', 'unpaid', left(coalesce(p_payload->>'notes', ''), 1000), auth.uid())
  returning * into v_order;

  if v_method = 'wallet' or v_price = 0 then
    if v_price > 0 then
      select * into v_wallet from public.wallets where vendor_id = v_vendor.id for update;
      if coalesce(v_wallet.available_piastres, 0) < v_price then
        raise exception 'insufficient_balance' using errcode = 'P0001';
      end if;
      perform public.fn_post_transaction(v_vendor.id, 'ad_purchase', -v_price, 'ad:' || v_order.number,
        'Ad package ' || v_pkg.name_en || ' (' || v_order.number || ')', null, null, jsonb_build_object('ad_order', v_order.id));
    end if;
    update public.ad_orders set status = 'in_review', payment_status = 'paid', paid_at = now() where id = v_order.id returning * into v_order;
    perform public.fn_ads_notify_admins(v_order);
  end if;
  perform public.fn_audit('ads.order_placed', 'ad_orders', v_order.id::text, null,
    jsonb_build_object('number', v_order.number, 'amount_piastres', v_price, 'method', v_method));
  return jsonb_build_object('ok', true, 'number', v_order.number, 'status', v_order.status, 'amount_piastres', v_price, 'method', v_method);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;
revoke all on function public.fn_vendor_place_ad_order(jsonb) from public, anon;
grant execute on function public.fn_vendor_place_ad_order(jsonb) to authenticated;

-- notify every admin / ads manager that an order waits for review
create or replace function public.fn_ads_notify_admins(p_order public.ad_orders) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' loop
    perform public.fn_notify(r.id, 'ad_order_review', jsonb_build_object(
      'ar', jsonb_build_object('title', 'طلب إعلان جديد ' || p_order.number, 'body', 'بانتظار المراجعة'),
      'en', jsonb_build_object('title', 'New ad order ' || p_order.number, 'body', 'Waiting for review'),
      'link', '/admin/ads?tab=orders'));
  end loop;
end $$;

-- ── 8. card payment result (Kashier webhook / session read; service role)
create or replace function public.fn_confirm_ad_payment(p_number text, p_provider_ref text, p_status text,
  p_amount_piastres integer, p_raw jsonb, p_mode text default 'live')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.ad_orders%rowtype; v_ref text := coalesce(nullif(trim(p_provider_ref), ''), 'missing'); v_owner uuid;
begin
  select * into v_order from public.ad_orders where number = p_number for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if v_order.payment_mode is distinct from coalesce(p_mode, 'live') then return jsonb_build_object('ok', false, 'reason', 'mode_mismatch'); end if;
  if exists (select 1 from public.ad_order_payments where provider = 'kashier' and provider_ref = v_ref) then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if p_status = 'failed' then
    insert into public.ad_order_payments (order_id, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload)
    values (v_order.id, 'kashier', v_ref, coalesce(p_amount_piastres, 0), 'failed', 'declined', coalesce(p_raw, '{}'::jsonb));
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  if v_order.status <> 'pending_payment' then
    insert into public.ad_order_payments (order_id, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload)
    values (v_order.id, 'kashier', v_ref, coalesce(p_amount_piastres, 0), 'succeeded', 'order_not_awaiting_payment', coalesce(p_raw, '{}'::jsonb));
    return jsonb_build_object('ok', false, 'reason', 'not_awaiting_payment');
  end if;
  if p_amount_piastres is distinct from v_order.amount_piastres then
    insert into public.ad_order_payments (order_id, provider, provider_ref, amount_piastres, status, failure_reason, raw_payload)
    values (v_order.id, 'kashier', v_ref, coalesce(p_amount_piastres, 0), 'failed', 'amount_mismatch', coalesce(p_raw, '{}'::jsonb));
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  insert into public.ad_order_payments (order_id, provider, provider_ref, amount_piastres, status, raw_payload)
  values (v_order.id, 'kashier', v_ref, p_amount_piastres, 'succeeded', coalesce(p_raw, '{}'::jsonb));
  update public.ad_orders set status = 'in_review', payment_status = 'paid', paid_at = now() where id = v_order.id returning * into v_order;
  perform public.fn_ads_notify_admins(v_order);
  select owner_id into v_owner from public.vendors where id = v_order.vendor_id;
  perform public.fn_notify(v_owner, 'ad_order_paid', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم دفع طلب الإعلان ' || v_order.number, 'body', 'إعلانك قيد المراجعة وسيبدأ فور الموافقة'),
    'en', jsonb_build_object('title', 'Ad order ' || v_order.number || ' paid', 'body', 'Your ad is under review and starts once approved'),
    'link', '/vendor/ads'));
  return jsonb_build_object('ok', true, 'status', 'succeeded');
end $$;
revoke all on function public.fn_confirm_ad_payment(text, text, text, integer, jsonb, text) from public, anon, authenticated;

-- vendor abandons an unpaid order
create or replace function public.fn_vendor_cancel_ad_order(p_number text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.ad_orders set status = 'cancelled'
   where number = p_number and vendor_id = public.own_vendor_id() and status = 'pending_payment';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_cancellable'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_vendor_cancel_ad_order(text) to authenticated;

-- ── 9. admin decision
create or replace function public.fn_admin_decide_ad_order(p_order_id uuid, p_decision text, p_reason text default null,
  p_refund_method text default 'wallet')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.ad_orders%rowtype; v_days int; v_a jsonb; v_place public.ad_placements%rowtype;
  v_banner uuid; v_camp uuid; v_owner uuid; v_pos int := 0; v_details jsonb; v_method text; v_wr uuid;
  v_name text; v_limit int;
begin
  if not (public.is_admin() or public.has_permission('ads.manage')) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_order from public.ad_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_order.status <> 'in_review' then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
  select owner_id into v_owner from public.vendors where id = v_order.vendor_id;
  v_name := coalesce(v_order.package_snapshot->>'name_ar', '');

  if p_decision = 'approve' then
    v_days := greatest(1, coalesce((v_order.package_snapshot->>'duration_days')::int, 7));
    v_limit := nullif((v_order.package_snapshot->>'impressions_included')::int, 0);
    for v_a in select * from jsonb_array_elements(v_order.assignments) loop
      v_pos := v_pos + 1;
      select * into v_place from public.ad_placements where code = v_a->>'placement';
      continue when v_place.code is null or v_place.kind = 'service';
      v_banner := null;
      if v_place.kind = 'banner' then
        insert into public.banners (title_ar, title_en, image_path, link_url, position, is_active, starts_at, ends_at, placement, vendor_id, category_id)
        values (coalesce(v_a->>'title', ''), coalesce(v_a->>'title', ''), v_a->>'image_path', coalesce(v_a->>'link_url', ''),
                100 + coalesce((v_a->>'position')::int, v_pos), true, now(), now() + make_interval(days => v_days),
                case v_place.code when 'home_hero' then 'hero' when 'category_banner' then 'category' else v_a->>'spot' end,
                v_order.vendor_id, nullif(v_a->>'category_id', '')::uuid)
        returning id into v_banner;
      end if;
      insert into public.ad_campaigns (package_id, vendor_id, product_id, source, status, started_at, ends_at, order_id, placement,
          section, spot, category_id, template, image_path, link_url, position, impressions_limit, banner_id, granted_by)
      values (v_order.package_id, v_order.vendor_id, nullif(v_a->>'product_id', '')::uuid, 'paid', 'active', now(),
          now() + make_interval(days => v_days), v_order.id, v_place.code, nullif(v_a->>'section', ''), nullif(v_a->>'spot', ''),
          nullif(v_a->>'category_id', '')::uuid, nullif(v_a->>'template', ''), nullif(v_a->>'image_path', ''), nullif(v_a->>'link_url', ''),
          coalesce((v_a->>'position')::int, v_pos), case when v_place.kind = 'product_page' then v_limit end, v_banner, auth.uid())
      returning id into v_camp;
    end loop;
    update public.ad_orders set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           starts_at = now(), ends_at = now() + make_interval(days => v_days) where id = v_order.id;
    perform public.fn_notify(v_owner, 'ad_order_approved', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تمت الموافقة على إعلانك ' || v_order.number, 'body', 'إعلانك يظهر الآن لمدة ' || v_days || ' يوم'),
      'en', jsonb_build_object('title', 'Your ad ' || v_order.number || ' is approved', 'body', 'It is live now for ' || v_days || ' days'),
      'link', '/vendor/ads'));
  elsif p_decision = 'reject' then
    if coalesce(trim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    if p_refund_method not in ('wallet', 'withdrawal') then return jsonb_build_object('ok', false, 'reason', 'bad_refund_method'); end if;
    update public.ad_orders set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = trim(p_reason)
     where id = v_order.id;
    if v_order.payment_status = 'paid' and v_order.amount_piastres > 0 then
      -- the money comes back to the wallet first …
      perform public.fn_post_transaction(v_order.vendor_id, 'ad_refund', v_order.amount_piastres, 'ad-refund:' || v_order.number,
        'Refund of rejected ad order ' || v_order.number, null, null, jsonb_build_object('ad_order', v_order.id));
      if p_refund_method = 'withdrawal' then
        -- … and is paid out on the vendor's last payout method as a withdrawal request
        select method, details into v_method, v_details from public.withdrawal_requests
         where vendor_id = v_order.vendor_id and kind = 'withdrawal' order by created_at desc limit 1;
        insert into public.withdrawal_requests (vendor_id, amount_piastres, method, details, requested_by, kind, reference)
        values (v_order.vendor_id, v_order.amount_piastres, coalesce(v_method, 'wallet'), coalesce(v_details, '{}'::jsonb), auth.uid(),
                'ad_refund', v_order.number)
        returning id into v_wr;
        insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
        values (v_order.vendor_id, 'withdrawal', -v_order.amount_piastres, 'withdrawal:' || v_wr::text,
                'Ad refund paid out (' || v_order.number || ')', auth.uid());
      end if;
      update public.ad_orders set payment_status = 'refunded', refund_method = p_refund_method, refunded_at = now() where id = v_order.id;
    end if;
    perform public.fn_notify(v_owner, 'ad_order_rejected', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم رفض طلب الإعلان ' || v_order.number, 'body', trim(p_reason) ||
            case when v_order.payment_status = 'paid' then case when p_refund_method = 'wallet' then ' — تم رد المبلغ لمحفظتك' else ' — سيُحوَّل المبلغ لوسيلة السحب الخاصة بك' end else '' end),
      'en', jsonb_build_object('title', 'Ad order ' || v_order.number || ' rejected', 'body', trim(p_reason) ||
            case when v_order.payment_status = 'paid' then case when p_refund_method = 'wallet' then ' — refunded to your wallet' else ' — the amount will be paid to your payout method' end else '' end),
      'link', '/vendor/ads'));
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  perform public.fn_audit('ads.order_' || p_decision, 'ad_orders', v_order.id::text, null,
    jsonb_build_object('number', v_order.number, 'reason', p_reason, 'refund', p_refund_method));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fn_admin_decide_ad_order(uuid, text, text, text) from public, anon;
grant execute on function public.fn_admin_decide_ad_order(uuid, text, text, text) to authenticated;

-- admin stops a running campaign / order early
create or replace function public.fn_admin_stop_ad_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_permission('ads.manage')) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.ad_campaigns set status = 'cancelled' where order_id = p_order_id and status = 'active';
  update public.banners set is_active = false where id in (select banner_id from public.ad_campaigns where order_id = p_order_id and banner_id is not null);
  update public.ad_orders set ends_at = least(coalesce(ends_at, now()), now()) where id = p_order_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_admin_stop_ad_order(uuid) to authenticated;

-- ── 10. impressions / clicks (anyone; only live campaigns count)
create or replace function public.fn_ad_event(p_campaign uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'view' then
    update public.ad_campaigns set impressions = impressions + 1,
           status = case when impressions_limit is not null and impressions + 1 >= impressions_limit then 'expired' else status end
     where id = p_campaign and status = 'active' and ends_at > now();
  elsif p_kind = 'click' then
    update public.ad_campaigns set clicks = clicks + 1 where id = p_campaign and status = 'active';
  end if;
end $$;
grant execute on function public.fn_ad_event(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
