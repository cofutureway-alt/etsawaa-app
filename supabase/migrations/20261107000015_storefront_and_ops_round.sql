-- Owner round 2026-11-07 (32-item list). Re-runnable.
--  1. Storefront view: "before discount" price of the cheapest offer, best discount %, units sold;
--     a sale with no start date counts as running.
--  2. No duplicate images: one path once per product gallery and once per child product.
--  3. Grace period: months were counted as years; the clock start is stored so an admin change of the
--     grace length re-dates every vendor still inside the grace window.
--  4. Banners get a placement (hero carousel or between two home sections).
--  5. Public site settings: social links + contact channels; shipping rules (vendor shipping blocked
--     for some categories); product size chart; a store under review cannot create products.
--  6. Contact inbox: customer / vendor forms, attachments, reply thread.
--  7. Every in-app notification can also go out by email (template per event, on/off per event).
--  8. Custom staff roles; staff defaults widened; contact inbox permission.
--  9. Product review: "return for changes" also works on an approved product.

create or replace function pg_temp.patch(p_fn regprocedure, p_old text, p_new text, p_marker text)
returns void language plpgsql as $$
declare src text; n text;
begin
  src := pg_get_functiondef(p_fn);
  if position(p_marker in src) > 0 then return; end if;
  n := replace(src, p_old, p_new);
  if n = src then raise exception 'patch anchor not found in %: %', p_fn, left(p_old, 60); end if;
  execute n;
end $$;

-- ───────────────────────────── 1. storefront view
create or replace view public.v_storefront_products as
SELECT p.id,
    p.slug_ar,
    p.slug_en,
    p.name_ar,
    p.name_en,
    p.short_ar,
    p.short_en,
    p.leaf_category_id,
    cat.name_ar AS category_name_ar,
    cat.name_en AS category_name_en,
    cat.slug_ar AS category_slug_ar,
    cat.slug_en AS category_slug_en,
    p.brand_id,
    b.name_ar AS brand_name_ar,
    b.name_en AS brand_name_en,
    p.vendor_id,
    v.slug AS vendor_slug,
    v.store_name_ar,
    v.store_name_en,
    v.logo_path AS vendor_logo_path,
    lvl.name_ar AS level_name_ar,
    lvl.name_en AS level_name_en,
    lvl.icon AS level_icon,
    img.path AS main_image_path,
    pr.min_price_piastres,
    pr.min_sale_price_piastres,
    pr.has_sale,
    GREATEST(COALESCE(evp.percent, 0), COALESCE(evc.percent, 0)) AS event_percent,
        CASE
            WHEN (COALESCE(evp.percent, 0) >= COALESCE(evc.percent, 0)) THEN evp.max_piastres
            ELSE evc.max_piastres
        END AS event_max_piastres,
    st.stock_total,
    r.rating_avg,
    r.rating_count,
    (p.featured_permanent OR ((p.featured_until IS NOT NULL) AND (p.featured_until > now())) OR (p.featured_by_vendor AND (fn_vendor_featured_slots(p.vendor_id) > 0)) OR (EXISTS ( SELECT 1
           FROM (ad_campaigns ac
             JOIN ad_packages ap ON ((ap.id = ac.package_id)))
          WHERE ((ac.product_id = p.id) AND (ac.status = 'active'::text) AND (ac.ends_at > now()) AND (ap.placement = 'featured_product'::text))))) AS is_featured,
    p.event_hidden AS is_event_hidden,
    (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))) AS vendor_event_refused,
    ((NOT p.event_hidden) AND (NOT (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))))) AS is_listable,
    p.published_at,
    p.created_at,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', x.id, 'hex', x.color_hex, 'label_ar', x.label_ar, 'label_en', x.label_en, 'image', x.image) ORDER BY x.sort) AS jsonb_agg
           FROM ( SELECT DISTINCT ON (g.color_option_id) o.id,
                    o.color_hex,
                    o.label_ar,
                    o.label_en,
                    g.sort,
                    ( SELECT m.path
                           FROM variant_group_media m
                          WHERE (m.group_id = g.id)
                          ORDER BY m."position"
                         LIMIT 1) AS image
                   FROM (variant_groups g
                     JOIN attribute_options o ON ((o.id = g.color_option_id)))
                  WHERE ((g.product_id = p.id) AND (g.deleted_at IS NULL) AND (EXISTS ( SELECT 1
                           FROM variants vv
                          WHERE ((vv.group_id = g.id) AND (vv.deleted_at IS NULL) AND vv.is_active))))
                  ORDER BY g.color_option_id, g.sort) x), '[]'::jsonb) AS colors,
    pr.min_regular_piastres,
    pr.max_discount_percent,
    COALESCE(( SELECT sum(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.status <> ALL (ARRAY['cancelled'::text, 'pending_payment'::text])), 0)::integer AS sold_count
   FROM ((((((((((products p
     JOIN vendors v ON ((v.id = p.vendor_id)))
     LEFT JOIN categories cat ON ((cat.id = p.leaf_category_id)))
     LEFT JOIN brands b ON ((b.id = p.brand_id)))
     LEFT JOIN vendor_levels lvl ON ((lvl.id = v.level_id)))
     LEFT JOIN LATERAL ( SELECT pm.path
           FROM product_media pm
          WHERE ((pm.product_id = p.id) AND (pm.kind = 'image'::text))
          ORDER BY pm."position"
         LIMIT 1) img ON (true))
     LEFT JOIN LATERAL ( SELECT min(
                CASE
                    WHEN ((COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamptz) <= now()) AND (v2.sale_price_piastres < v2.price_piastres) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN LEAST(v2.price_piastres, v2.sale_price_piastres)
                    ELSE v2.price_piastres
                END) AS min_price_piastres,
            min(
                CASE
                    WHEN ((COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamptz) <= now()) AND (v2.sale_price_piastres < v2.price_piastres) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN v2.sale_price_piastres
                    ELSE NULL::integer
                END) AS min_sale_price_piastres,
            bool_or(((COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamptz) <= now()) AND (v2.sale_price_piastres < v2.price_piastres) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL))) AS has_sale,
            min(v2.price_piastres) AS min_regular_raw,
            (array_agg(v2.price_piastres ORDER BY (CASE WHEN (COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamptz) <= now()) AND (v2.sale_price_piastres < v2.price_piastres) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL) THEN v2.sale_price_piastres ELSE v2.price_piastres END), v2.price_piastres))[1] AS min_regular_piastres,
            COALESCE(max(CASE WHEN (COALESCE(v2.sale_starts_at, p.sale_starts_at, '-infinity'::timestamptz) <= now()) AND (v2.sale_price_piastres < v2.price_piastres) AND ((COALESCE(v2.sale_ends_at, p.sale_ends_at) IS NULL) OR (COALESCE(v2.sale_ends_at, p.sale_ends_at) > now())) AND (v2.sale_price_piastres IS NOT NULL) THEN round(((v2.price_piastres - v2.sale_price_piastres))::numeric * 100 / v2.price_piastres) ELSE NULL END), 0)::integer AS max_discount_percent
           FROM variants v2
          WHERE ((v2.product_id = p.id) AND (v2.deleted_at IS NULL) AND v2.is_active AND (v2.price_piastres IS NOT NULL))) pr ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(v3.stock), (0)::bigint) AS stock_total
           FROM variants v3
          WHERE ((v3.product_id = p.id) AND (v3.deleted_at IS NULL) AND v3.is_active)) st ON (true))
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            (count(*))::integer AS rating_count
           FROM reviews rw
          WHERE ((rw.product_id = p.id) AND (rw.status = 'published'::text))) r ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'product'::text) AND (d.ref_id = p.id))
          ORDER BY d.percent DESC
         LIMIT 1) evp ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'category'::text) AND fn_category_within(p.leaf_category_id, d.ref_id))
          ORDER BY d.percent DESC
         LIMIT 1) evc ON (true))
  WHERE ((p.status = 'approved'::text) AND (p.deleted_at IS NULL) AND (v.status = 'active'::text) AND (v.verification_status <> 'grace_expired'::text) AND (NOT v.hidden_from_listings));

-- ───────────────────────────── 2. duplicate images
delete from public.product_media a using public.product_media b
 where a.product_id = b.product_id and a.path = b.path
   and (a.position > b.position or (a.position = b.position and a.id > b.id));
create unique index if not exists product_media_product_path_key on public.product_media (product_id, path);
delete from public.variant_group_media a using public.variant_group_media b
 where a.group_id = b.group_id and a.path = b.path
   and (a.position > b.position or (a.position = b.position and a.id > b.id));
create unique index if not exists variant_group_media_group_path_key on public.variant_group_media (group_id, path);

select pg_temp.patch('public.fn_save_product(jsonb,uuid)',
  $o$values (v_product.id, coalesce(v_media ->> 'kind', 'image'), v_media ->> 'path', v_i);$o$,
  $n$values (v_product.id, coalesce(v_media ->> 'kind', 'image'), v_media ->> 'path', v_i)
      on conflict (product_id, path) do nothing; -- dedupe-media$n$, 'dedupe-media');
select pg_temp.patch('public.fn_save_children(uuid,jsonb)',
  $o$insert into public.variant_group_media (group_id, path, position) values (v_group, img, v_i);$o$,
  $n$insert into public.variant_group_media (group_id, path, position) values (v_group, img, v_i)
        on conflict (group_id, path) do nothing; -- dedupe-media$n$, 'dedupe-media');

-- ───────────────────────────── 3. grace period
alter table public.vendors add column if not exists grace_started_at timestamptz;
update public.vendors set grace_started_at = grace_until - interval '7 days'
 where grace_until is not null and grace_started_at is null;

create or replace function public.fn_grace_interval(p_cfg jsonb)
returns interval language sql immutable as $$
  select case coalesce(p_cfg ->> 'grace_unit', 'days')
           when 'hours'  then make_interval(hours  => greatest(coalesce((p_cfg ->> 'grace_value')::int, 7), 1))
           when 'months' then make_interval(months => greatest(coalesce((p_cfg ->> 'grace_value')::int, 7), 1))
           else make_interval(days => greatest(coalesce((p_cfg ->> 'grace_value')::int, 7), 1)) end;
$$;

select pg_temp.patch('public.fn_vendor_onboard'::regproc::regprocedure,
  $o$years  => case when v_config ->> 'grace_unit' = 'months'$o$,
  $n$months => case when v_config ->> 'grace_unit' = 'months'$n$, 'months => case when v_config');
select pg_temp.patch('public.fn_admin_review_vendor'::regproc::regprocedure,
  $o$years => case when v_cfg ->> 'grace_unit' = 'months'$o$,
  $n$months => case when v_cfg ->> 'grace_unit' = 'months'$n$, 'months => case when v_cfg');

create or replace function public.fn_vendor_grace_start()
returns trigger language plpgsql as $$
begin
  if new.grace_until is not null and (tg_op = 'INSERT' or old.grace_until is null) then
    new.grace_started_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_vendor_grace_start on public.vendors;
create trigger trg_vendor_grace_start before insert or update of grace_until on public.vendors
  for each row execute function public.fn_vendor_grace_start();

-- an admin change of the grace length re-dates everyone still inside the window
create or replace function public.fn_settings_regrace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'verification'
     and (old.value ->> 'grace_value', old.value ->> 'grace_unit') is distinct from (new.value ->> 'grace_value', new.value ->> 'grace_unit') then
    update public.vendors
       set grace_until = grace_started_at + public.fn_grace_interval(new.value)
     where grace_started_at is not null and grace_until is not null
       and verification_status in ('unverified', 'submitted', 'needs_changes', 'rejected');
  end if;
  return new;
end $$;
drop trigger if exists trg_settings_regrace on public.settings;
create trigger trg_settings_regrace after update on public.settings
  for each row execute function public.fn_settings_regrace();
-- apply the CURRENT setting once (the owner moved 7 → 90 days after «ميكي» registered)
update public.vendors v
   set grace_until = v.grace_started_at + public.fn_grace_interval((select value from public.settings where key = 'verification'))
 where v.grace_started_at is not null and v.grace_until is not null
   and v.verification_status in ('unverified', 'submitted', 'needs_changes', 'rejected');

-- ───────────────────────────── 4. banner placement
alter table public.banners add column if not exists placement text not null default 'hero';
do $$ begin
  alter table public.banners add constraint banners_placement_check check (placement in
    ('hero', 'after_brands', 'after_categories', 'after_best', 'after_best_selling', 'after_top_rated',
     'after_vendors', 'after_recent', 'bottom'));
exception when duplicate_object then null; end $$;

-- ───────────────────────────── 5. public settings, shipping rules, size chart, review gate
create or replace function public.is_public_setting(p_key text)
returns boolean language sql stable as $$
  select p_key in ('site.general', 'settings.design', 'media', 'site.social', 'site.contact');
$$;
insert into public.settings (key, value) values
  ('site.social', '{"facebook":"","instagram":"","tiktok":"","x":"","youtube":"","linkedin":"","whatsapp":""}'),
  ('site.contact', '{"email":"support@etsawaa.com","phone":"","whatsapp":"","address_ar":"","address_en":"","hours_ar":"","hours_en":""}'),
  ('shipping_rules', jsonb_build_object('vendor_blocked_category_ids', coalesce((
     select jsonb_agg(id) from public.categories
      where deleted_at is null and slug_en in ('air-conditioners', 'ro-water-purifiers', 'drinking-water-purifiers', 'water-filter-cartridges')), '[]'::jsonb)))
on conflict (key) do nothing;

create or replace function public.fn_vendor_shipping_blocked(p_category uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.categories c,
           jsonb_array_elements_text(coalesce((select value -> 'vendor_blocked_category_ids' from public.settings where key = 'shipping_rules'), '[]'::jsonb)) b(id)
     where c.id = p_category and (c.id::text = b.id or c.path like '%' || b.id || '%')), false);
$$;
grant execute on function public.fn_vendor_shipping_blocked(uuid) to authenticated;

alter table public.products add column if not exists size_chart jsonb;

select pg_temp.patch('public.fn_save_product(jsonb,uuid)',
  $o$    dims = coalesce(p_product -> 'dims', v_product.dims),$o$,
  $n$    dims = coalesce(p_product -> 'dims', v_product.dims),
    size_chart = case when p_product ? 'size_chart' then nullif(p_product -> 'size_chart', 'null'::jsonb) else v_product.size_chart end,$n$,
  'size_chart = case');
select pg_temp.patch('public.fn_save_product(jsonb,uuid)',
  $o$  if coalesce(v_product.slug_ar, '') = '' and coalesce(v_product.name_ar, '') <> '' then$o$,
  $n$  -- some categories ship with the platform only (settings.shipping_rules) — shipping-rule
  if v_product.shipping_mode = 'vendor' and public.fn_vendor_shipping_blocked(v_product.leaf_category_id) then
    update public.products set shipping_mode = 'platform' where id = v_product.id returning * into v_product;
  end if;

  if coalesce(v_product.slug_ar, '') = '' and coalesce(v_product.name_ar, '') <> '' then$n$,
  'shipping-rule');
select pg_temp.patch('public.fn_save_product(jsonb,uuid)',
  $o$  if v_is_new then
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;$o$,
  $n$  if v_is_new and exists (select 1 from public.vendors where id = v_vendor and status = 'pending') then
    raise exception 'vendor_under_review: the store is still under review' using errcode = 'P0001';
  end if;
  if v_is_new then
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;$n$,
  'vendor_under_review');

-- ───────────────────────────── 6. contact inbox
alter table public.contact_messages
  add column if not exists kind text not null default 'customer',
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists topic text not null default '',
  add column if not exists order_number text not null default '',
  add column if not exists store_name text not null default '',
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'new',
  add column if not exists last_reply_at timestamptz,
  add column if not exists email_status text;
do $$ begin
  alter table public.contact_messages add constraint contact_messages_kind_check check (kind in ('customer', 'vendor'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.contact_messages add constraint contact_messages_status_check check (status in ('new', 'open', 'replied', 'closed'));
exception when duplicate_object then null; end $$;
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

create table if not exists public.contact_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.contact_messages(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  email_status text,
  created_at timestamptz not null default now()
);
create index if not exists contact_replies_message_idx on public.contact_replies (message_id, created_at);
alter table public.contact_replies enable row level security;
grant select, insert on public.contact_replies to authenticated;
grant update on public.contact_messages to authenticated;

drop policy if exists contact_admin_read on public.contact_messages;
create policy contact_admin_read on public.contact_messages for select to authenticated using (public.has_permission('contact.manage'));
drop policy if exists contact_admin_update on public.contact_messages;
create policy contact_admin_update on public.contact_messages for update to authenticated
  using (public.has_permission('contact.manage')) with check (public.has_permission('contact.manage'));
drop policy if exists contact_replies_rw on public.contact_replies;
create policy contact_replies_rw on public.contact_replies for all to authenticated
  using (public.has_permission('contact.manage')) with check (public.has_permission('contact.manage'));

insert into storage.buckets (id, name, public) values ('contact', 'contact', false) on conflict (id) do nothing;

-- ───────────────────────────── 7. event emails
alter table public.notifications add column if not exists emailed_at timestamptz;
alter table public.notifications add column if not exists email_status text;
update public.notifications set emailed_at = coalesce(emailed_at, created_at), email_status = coalesce(email_status, 'skipped_backlog')
 where emailed_at is null;
create index if not exists notifications_email_queue_idx on public.notifications (created_at) where emailed_at is null;
alter table public.email_templates add column if not exists is_active boolean not null default true;
alter table public.email_templates add column if not exists audience text not null default 'all';

with ev(type, audience, ar, en) as (values
  ('product.pending', 'admin', 'منتج جديد بانتظار المراجعة', 'A product is waiting for review'),
  ('product.approved', 'vendor', 'تمت الموافقة على منتجك', 'Your product was approved'),
  ('product.rejected', 'vendor', 'منتجك يحتاج تعديلات', 'Your product needs changes'),
  ('vendor.submitted', 'admin', 'متجر جديد بانتظار المراجعة', 'A new store is waiting for review'),
  ('vendor.approved', 'vendor', 'تم تفعيل متجرك', 'Your store is active'),
  ('vendor.rejected', 'vendor', 'تم رفض طلب المتجر', 'Your store application was declined'),
  ('vendor.suspended', 'vendor', 'تم إيقاف متجرك', 'Your store was suspended'),
  ('vendor.reinstated', 'vendor', 'تمت إعادة تفعيل متجرك', 'Your store was reinstated'),
  ('vendor.grace_expired', 'vendor', 'انتهت مهلة توثيق المتجر', 'Your verification grace period ended'),
  ('vendor.change_request', 'admin', 'طلب تعديل بيانات متجر', 'A store change request'),
  ('vendor.change_approved', 'vendor', 'تمت الموافقة على تعديل بيانات المتجر', 'Your store change was approved'),
  ('vendor.change_rejected', 'vendor', 'تم رفض تعديل بيانات المتجر', 'Your store change was declined'),
  ('verification.approved', 'vendor', 'تم توثيق متجرك', 'Your store is verified'),
  ('verification.rejected', 'vendor', 'مستندات التوثيق مرفوضة', 'Your verification was declined'),
  ('verification.needs_changes', 'vendor', 'مستندات التوثيق تحتاج تعديل', 'Your verification needs changes'),
  ('verification.document_rejected', 'vendor', 'تم رفض مستند', 'A document was declined'),
  ('verification.grace_expired', 'vendor', 'انتهت مهلة التوثيق', 'Verification grace period ended'),
  ('order_cancelled', 'customer', 'تم إلغاء طلبك', 'Your order was cancelled'),
  ('order_completed', 'customer', 'اكتمل طلبك', 'Your order is complete'),
  ('order_delivered', 'customer', 'تم توصيل طلبك', 'Your order was delivered'),
  ('payment_success', 'customer', 'تم الدفع بنجاح', 'Payment received'),
  ('payment_failed', 'customer', 'فشل الدفع', 'Payment failed'),
  ('refund_submitted', 'customer', 'تم استلام طلب الاسترجاع', 'Refund request received'),
  ('refund_submitted_admin', 'admin', 'طلب استرجاع جديد', 'A new refund request'),
  ('refund_decided', 'customer', 'تم البت في طلب الاسترجاع', 'Your refund request was decided'),
  ('refund_executed', 'customer', 'تم تنفيذ الاسترجاع', 'Your refund was paid'),
  ('refund_settled_vendor', 'vendor', 'تسوية استرجاع على متجرك', 'A refund was settled on your store'),
  ('penalty', 'vendor', 'غرامة جديدة على متجرك', 'A new penalty on your store'),
  ('badge', 'vendor', 'حصلت على شارة جديدة', 'You earned a new badge'),
  ('level', 'vendor', 'تغيّر مستوى متجرك', 'Your store level changed'),
  ('store_visibility', 'vendor', 'تغيّر ظهور متجرك', 'Your store visibility changed'),
  ('vendor_shipping_request', 'admin', 'طلب شحن ذاتي من بائع', 'A vendor shipping request'),
  ('vendor_shipping_decision', 'vendor', 'تم البت في طلب الشحن', 'Your shipping request was decided'),
  ('packaging_order_admin', 'admin', 'طلب تغليف جديد', 'A new packaging order'),
  ('packaging_paid', 'vendor', 'تم دفع طلب التغليف', 'Packaging order paid'),
  ('packaging_status', 'vendor', 'تحديث طلب التغليف', 'Packaging order update'),
  ('packaging_return', 'vendor', 'مرتجع طلب تغليف', 'Packaging return'),
  ('packaging_balance_collected', 'vendor', 'تم تحصيل رصيد التغليف', 'Packaging balance collected')
)
insert into public.email_templates (key, name_ar, name_en, subject_ar, subject_en, html_ar, html_en, variables, audience)
select 'event:' || type, ar, en, '{{title}} — {{site_name}}', '{{title}} — {{site_name}}',
  '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1f1f1f"><h2 style="color:#BE0404;margin:0 0 12px">{{title}}</h2><p style="font-size:15px;line-height:1.8;margin:0 0 20px">{{body}}</p><p><a href="{{link}}" style="background:#BE0404;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">افتح التفاصيل</a></p><p style="font-size:12px;color:#777;margin-top:28px">{{site_name}}</p></div>',
  '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1f1f1f"><h2 style="color:#BE0404;margin:0 0 12px">{{title}}</h2><p style="font-size:15px;line-height:1.6;margin:0 0 20px">{{body}}</p><p><a href="{{link}}" style="background:#BE0404;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open details</a></p><p style="font-size:12px;color:#777;margin-top:28px">{{site_name}}</p></div>',
  '["title","body","link","name","site_name"]'::jsonb, audience
from ev
on conflict (key) do nothing;

insert into public.email_templates (key, name_ar, name_en, subject_ar, subject_en, html_ar, html_en, variables, audience) values
 ('contact_reply', 'رد على رسالة تواصل', 'Contact message reply', 'رد: {{subject}} — {{site_name}}', 'Re: {{subject}} — {{site_name}}',
  '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1f1f1f"><p>مرحبًا {{name}}،</p><div style="font-size:15px;line-height:1.8;white-space:pre-line">{{body}}</div><hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="font-size:12px;color:#777">بخصوص رسالتك: {{subject}}<br>{{site_name}}</p></div>',
  '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1f1f1f"><p>Hi {{name}},</p><div style="font-size:15px;line-height:1.6;white-space:pre-line">{{body}}</div><hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="font-size:12px;color:#777">Re: {{subject}}<br>{{site_name}}</p></div>',
  '["name","body","subject","site_name"]'::jsonb, 'all'),
 ('contact_received', 'رسالة تواصل جديدة (للفريق)', 'New contact message (team)', 'رسالة جديدة: {{subject}}', 'New message: {{subject}}',
  '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;padding:20px"><h3>{{kind}} — {{subject}}</h3><p><b>{{name}}</b> &lt;{{email}}&gt; {{phone}}</p><div style="white-space:pre-line">{{message}}</div><p><a href="{{link}}">فتح الرسالة</a></p></div>',
  '<div style="font-family:Arial,sans-serif;padding:20px"><h3>{{kind}} — {{subject}}</h3><p><b>{{name}}</b> &lt;{{email}}&gt; {{phone}}</p><div style="white-space:pre-line">{{message}}</div><p><a href="{{link}}">Open message</a></p></div>',
  '["kind","subject","name","email","phone","message","link"]'::jsonb, 'admin'),
 ('contact_ack', 'تأكيد استلام رسالة التواصل', 'Contact message received', 'استلمنا رسالتك — {{site_name}}', 'We received your message — {{site_name}}',
  '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><p>مرحبًا {{name}}،</p><p>استلمنا رسالتك بخصوص «{{subject}}» وسيرد عليك فريقنا قريبًا على هذا البريد.</p><p style="font-size:12px;color:#777">{{site_name}}</p></div>',
  '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><p>Hi {{name}},</p><p>We received your message about “{{subject}}”. Our team will reply to this address soon.</p><p style="font-size:12px;color:#777">{{site_name}}</p></div>',
  '["name","subject","site_name"]'::jsonb, 'all')
on conflict (key) do nothing;

-- ───────────────────────────── 8. roles & permissions
alter table public.profiles add column if not exists staff_role text references public.roles(slug) on update cascade on delete set null;

create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status = 'blocked' then false
      when p.role = 'admin' then true
      when p.role = 'staff' and exists (select 1 from public.user_permissions u
             where u.user_id = p.id and u.permission = p_permission and not u.granted) then false
      when p.role = 'staff' and exists (select 1 from public.user_permissions u
             where u.user_id = p.id and u.permission = p_permission and u.granted) then true
      else coalesce(r.permissions ? '*' or r.permissions ? p_permission, false)
    end
    from public.profiles p
    left join public.roles r on r.slug = case when p.role = 'staff' then coalesce(p.staff_role, 'staff') else p.role end
    where p.id = auth.uid()), false);
$$;

create or replace function public.fn_my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('role', p.role, 'staff_role', p.staff_role, 'permissions',
      case
        when p.status = 'blocked' then '[]'::jsonb
        when p.role = 'admin' then '["*"]'::jsonb
        when p.role <> 'staff' then coalesce(r.permissions, '[]'::jsonb)
        else coalesce((
          select jsonb_agg(k order by k) from (
            select jsonb_array_elements_text(coalesce(r.permissions, '[]'::jsonb)) k
            union
            select permission from public.user_permissions where user_id = p.id and granted
            except
            select permission from public.user_permissions where user_id = p.id and not granted
          ) s), '[]'::jsonb)
      end)
    from public.profiles p
    left join public.roles r on r.slug = case when p.role = 'staff' then coalesce(p.staff_role, 'staff') else p.role end
    where p.id = auth.uid()), jsonb_build_object('role', null, 'permissions', '[]'::jsonb));
$$;

-- staff defaults (owner list): products add/edit/delete/review, sellers, brands/categories/tags
-- (commission stays admin-only inside its RPCs), the contact inbox
update public.roles set permissions = (
  select jsonb_agg(k order by k) from (
    select jsonb_array_elements_text(permissions) k from public.roles where slug = 'staff'
    union select unnest(array['products.view', 'products.create', 'products.edit', 'products.delete', 'products.review',
      'vendors.view', 'vendors.create', 'vendors.edit', 'vendors.review', 'vendors.verify', 'vendors.suspend',
      'store_changes.review', 'catalog.manage', 'contact.manage'])) s)
 where slug = 'staff';

-- staff.manage holders (not only admins) maintain custom roles; system roles stay locked
drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles for all to authenticated
  using (public.is_admin() or (public.has_permission('staff.manage') and not is_system))
  with check (public.is_admin() or (public.has_permission('staff.manage') and not is_system and slug not in ('admin', 'staff', 'vendor', 'customer')));

create or replace function public.fn_admin_set_staff_role(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('staff.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(p_role, 'staff') <> 'staff' and not exists (select 1 from public.roles where slug = p_role and not is_system) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;
  update public.profiles set staff_role = nullif(p_role, 'staff') where id = p_user and role = 'staff';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_staff'); end if;
  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'staff.role', 'profiles', p_user::text, jsonb_build_object('staff_role', p_role));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.fn_admin_set_staff_role(uuid, text) to authenticated;

-- ───────────────────────────── 9. product review: return for changes from approved too
select pg_temp.patch('public.fn_admin_decide_product(uuid,text,text)',
  $o$  elsif v_product.status <> 'pending' then$o$,
  $n$  elsif p_decision = 'reject' and v_product.status in ('pending', 'approved') then
    null; -- return-for-changes: an approved product can be sent back as well
  elsif v_product.status <> 'pending' then$n$,
  'return-for-changes');
