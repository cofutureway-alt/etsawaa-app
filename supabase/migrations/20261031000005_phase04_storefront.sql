-- ============================================================================
-- PHASE 04 — STOREFRONT
-- Banners · static pages · contact messages · reviews · wishlist ·
-- recently viewed · cart · coupons · events · featured/event flags ·
-- Arabic normalization · storefront views · search RPC
-- Rules: RLS on every table; public reads only through definer views with
-- hard visibility predicates; all multi-row writes via RPCs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) PRODUCTS: featured flags + event-hidden flag (ARCHITECTURE §5d)
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists featured_until timestamptz,
  add column if not exists featured_permanent boolean not null default false,
  add column if not exists event_hidden boolean not null default false;

create index if not exists products_featured_idx
  on public.products (featured_permanent, featured_until desc)
  where deleted_at is null and status = 'approved';
create index if not exists products_published_idx
  on public.products (published_at desc)
  where deleted_at is null and status = 'approved';

-- Attribute display labels (additive; facets use them, admin catalog UI can
-- edit later — the code remains the fallback).
alter table public.attribute_defs
  add column if not exists label_ar text,
  add column if not exists label_en text;

-- ---------------------------------------------------------------------------
-- 1) ARABIC NORMALIZATION (alef/hamza variants, taa marbuta, alef maqsura,
--    tashkeel) — "أحمد" matches "احمد", "مدرسة" matches "مدرسه".
-- ---------------------------------------------------------------------------
create or replace function public.ar_norm(txt text) returns text
language sql immutable parallel safe as $$
  select lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(txt, ''),
    '[ًٌٍَُِّْٰـ]', '', 'g'),
    '[أإآٱ]', 'ا', 'g'),
    'ة', 'ه', 'g'),
    'ى', 'ي', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- 2) BANNERS (platform home banners — DB-driven, separate from vendor ads)
-- ---------------------------------------------------------------------------
create table if not exists public.banners (
  id          uuid primary key default gen_random_uuid(),
  title_ar    text not null default '',      -- alt text for a11y
  title_en    text not null default '',
  image_path  text not null,                 -- media bucket object path
  link_url    text not null default '',      -- absolute or app path; '' = decorative
  position    int not null default 0,
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists banners_active_idx on public.banners (position)
  where is_active;

revoke all on public.banners from anon, authenticated, public;
grant select on public.banners to anon, authenticated;
drop policy if exists banners_read on public.banners;
create policy banners_read on public.banners
  for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

-- ---------------------------------------------------------------------------
-- 3) STATIC PAGES (DB-driven; header visibility from show_in_header)
-- ---------------------------------------------------------------------------
create table if not exists public.static_pages (
  id             uuid primary key default gen_random_uuid(),
  slug_ar        text not null,
  slug_en        text not null,
  title_ar       text not null,
  title_en       text not null,
  content_ar     text not null default '',
  content_en     text not null default '',
  show_in_header boolean not null default false,
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint static_pages_slug_ar_unique unique (slug_ar),
  constraint static_pages_slug_en_unique unique (slug_en)
);

revoke all on public.static_pages from anon, authenticated, public;
grant select on public.static_pages to anon, authenticated;
drop policy if exists static_pages_read on public.static_pages;
create policy static_pages_read on public.static_pages
  for select to anon, authenticated using (is_active);
drop policy if exists static_pages_admin_write on public.static_pages;
create policy static_pages_admin_write on public.static_pages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Real baseline content (owner-editable from admin later; content tooling in 08).
insert into public.static_pages (slug_ar, slug_en, title_ar, title_en, content_ar, content_en, show_in_header)
values
  ('من-نحن', 'about', 'من نحن', 'About Etsawaa',
   E'## من نحن\nاتسوء سوق مصري متعدد البائعين يجمع المتاجر المصرية في مكان واحد: منتجات حقيقية من بائعين موثوقين، وأسعار واضحة بالجنيه المصري، وتوصيل لكل محافظات مصر.\n\n## رسالتنا\nنمنح كل تاجر صغير قناة عادلة للوصول لعملائه في كل المحافظات، ونمنح كل عميل تجربة شراء واضحة: صور حقيقية، مواصفات دقيقة، وسعر نهائي بدون مفاجآت.\n\n## لماذا اتسوء؟\n- متاجر موثوقة تمر بمراجعة قبل البيع\n- شفافية كاملة في الأسعار والشحن\n- دفع عند الاستلام أو دفع إلكتروني آمن\n- سياسة استبدال واسترجاع واضحة\n\n## تواصل معنا\nفريق الدعم متاح للإجابة على أي استفسار عبر صفحة التواصل.',
   E'## About Etsawaa\nEtsawaa is an Egyptian multi-vendor marketplace that brings Egyptian stores together in one place: real products from vetted sellers, clear prices in EGP, and delivery to every governorate.\n\n## Our mission\nWe give every small merchant a fair channel to reach customers across Egypt, and give every customer a clear buying experience: real photos, accurate specs, and a final price with no surprises.\n\n## Why Etsawaa?\n- Vetted stores reviewed before they can sell\n- Full transparency on pricing and shipping\n- Cash on delivery or secure online payment\n- A clear exchange and return policy\n\n## Contact us\nOur support team answers any question through the contact page.',
   false),
  ('الشروط-والأحكام', 'terms', 'الشروط والأحكام', 'Terms & Conditions',
   E'## استخدام المنصة\nباستخدامك منصة اتسوء فإنك توافق على هذه الشروط. المنصة وسيط بين البائع والمشتري؛ المتاجر مسؤولة عن منتجاتها ومحتواها، واتسوء مسؤول عن تيسير الطلب والدفع والتوصيل وحل النزاعات.\n\n## الحسابات\n- يجب أن تكون بيانات التسجيل صحيحة وحديثة.\n- الحفاظ على سرية كلمة المرور مسؤوليتك.\n- يحق للمنصة إيقاف أي حساب يخالف الشروط.\n\n## الطلبات والأسعار\n- الأسعار بالجنيه المصري وتشمل ما يُعلن عنه صراحة.\n- يتم تأكيد الطلب بعد إتمام الدفع أو اختيار الدفع عند الاستلام وفق القواعد المعلنة.\n- قد تُلغى الطلبات عند نفاد الكمية مع إشعار فوري واسترداد كامل لأي مدفوعات.\n\n## الملكية الفكرية\nشعار اتسوء ومحتوى المنصة مملوكان لاتسوء، وصور ومحتوى المنتجات مملوكة لمتاجرها.\n\n## تعديل الشروط\nقد تُحدَّث هذه الشروط؛ يستمر استخدامك للمنصة بعد التحديث بمثابة موافقة على النسخة المحدثة.',
   E'## Using the platform\nBy using Etsawaa you agree to these terms. The platform is an intermediary between seller and buyer: stores are responsible for their products and content, and Etsawaa is responsible for facilitating the order, payment, delivery, and dispute resolution.\n\n## Accounts\n- Registration data must be accurate and current.\n- You are responsible for keeping your password confidential.\n- The platform may suspend any account that violates these terms.\n\n## Orders & prices\n- Prices are in EGP and include only what is explicitly stated.\n- An order is confirmed after payment is completed or cash on delivery is chosen per the published rules.\n- Orders may be cancelled when stock runs out, with immediate notice and a full refund of anything paid.\n\n## Intellectual property\nThe Etsawaa logo and platform content belong to Etsawaa; product images and content belong to their stores.\n\n## Changes to these terms\nThese terms may be updated; continued use of the platform after an update constitutes acceptance of the updated version.',
   false),
  ('سياسة-الخصوصية', 'privacy', 'سياسة الخصوصية', 'Privacy Policy',
   E'## البيانات التي نجمعها\n- بيانات الحساب: الاسم، البريد الإلكتروني، رقم الهاتف.\n- بيانات الطلب: عناوين التوصيل وسجل المشتريات.\n- بيانات تقنية محدودة لتشغيل الموقع وأمنه.\n\n## كيف نستخدم بياناتك\n- تنفيذ الطلبات وتوصيلها.\n- إشعارات حالة الطلب والعروض بعد موافقتك.\n- تحسين الخدمة ودعم العملاء.\n\n## مشاركة البيانات\nنشارك بيانات التوصيل اللازمة (الاسم، الهاتف، العنوان) مع البائع وشركة الشحن لتنفيذ طلبك فقط. لا نبيع بياناتك لأي طرف ثالث.\n\n## حقوقك\nيمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذف حسابك عبر صفحة التواصل، مع الاحتفاظ بما تقتضيه المتطلبات المحاسبية والقانونية.\n\n## ملفات تعريف الارتباط\nنستخدم الكوكيز الأساسية لتشغيل الجلسة وسلة التسوق فقط.',
   E'## Data we collect\n- Account data: name, email, phone number.\n- Order data: delivery addresses and purchase history.\n- Limited technical data required to run and secure the site.\n\n## How we use your data\n- To fulfil and deliver orders.\n- To send order-status notifications and offers after your consent.\n- To improve the service and support customers.\n\n## Sharing data\nWe share the delivery data required (name, phone, address) with the seller and the carrier solely to fulfil your order. We never sell your data to any third party.\n\n## Your rights\nYou can request access to your data, correction, or account deletion through the contact page, except what accounting and legal requirements oblige us to keep.\n\n## Cookies\nWe use essential cookies only, for the session and the shopping cart.',
   false),
  ('سياسة-الاستبدال-والاسترجاع', 'returns', 'سياسة الاستبدال والاسترجاع', 'Returns & Exchange Policy',
   E'## نافذة الاسترجاع\nيحق لك طلب استرجاع أو استبدال خلال 14 يومًا من تاريخ التسليم، وخلال 30 يومًا للمنتجات المشمولة بضمان.\n\n## الشروط\n- أن يكون المنتج بحالته الأصلية مع ملحقاته وتغليفه.\n- صور المنتج والحالة عند الفتح تساعد في إنجاز الطلب أسرع.\n\n## الحالات غير القابلة للاسترجاع\n- المنتجات الشخصية المفتوحة (العناية والعطور) لأسباب صحية.\n- المنتجات المصنوعة حسب الطلب ما لم يكن بها عيب.\n\n## خطوات الطلب\n1. من حسابك: الطلبات، اختر الطلب ثم "طلب استرجاع".\n2. حدد المنتجات والسبب وأرفق الصور.\n3. تتم المراجعة من فريق اتسوء ثم يُبلغ البائع بالتنفيذ.\n\n## استرداد المبلغ\nبعد اعتماد الطلب: يُعاد المبلغ بنفس وسيلة الدفع (بطاقة/محفظة) أو تحويلاً يدويًا موثقًا لطلبات الدفع عند الاستلام. تُسند تكلفة الإرجاع على من قصّر وفق قرار فريق المراجعة.',
   E'## Return window\nYou may request a return or exchange within 14 days of delivery, and within 30 days for products covered by a warranty.\n\n## Conditions\n- The product must be in its original condition with accessories and packaging.\n- Photos of the product and its condition on unboxing speed up the review.\n\n## Non-returnable cases\n- Opened personal-care products (care & perfumes) for hygiene reasons.\n- Custom-made products unless defective.\n\n## How to request\n1. From your account: Orders, pick the order then "Request return".\n2. Select the products, the reason, and attach photos.\n3. Etsawaa reviews the request, then the seller executes the decision.\n\n## Refunds\nAfter approval: the amount is refunded via the original payment method (card/wallet) or a documented manual transfer for cash-on-delivery orders. Return costs are charged to the party at fault per the review team decision.',
   false)
on conflict (slug_ar) do nothing;

-- ---------------------------------------------------------------------------
-- 4) CONTACT MESSAGES (anon can send; admin reads in phase 07)
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  phone      text not null default '',
  subject    text not null,
  message    text not null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
revoke all on public.contact_messages from anon, authenticated, public;
grant insert on public.contact_messages to anon, authenticated;
drop policy if exists contact_insert on public.contact_messages;
create policy contact_insert on public.contact_messages
  for insert to anon, authenticated with check (true);
drop policy if exists contact_admin_read on public.contact_messages;
create policy contact_admin_read on public.contact_messages
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5) REVIEWS (read-only storefront now; submission ships with orders in 05)
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  customer_id   uuid not null references auth.users(id) on delete cascade,
  order_item_id uuid,
  rating        numeric(2,1) not null check (rating between 0.5 and 5),
  title         text not null default '',
  body          text not null default '',
  status        text not null default 'pending'
                check (status in ('pending','published','spam','trash')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists reviews_product_idx on public.reviews (product_id, status);
create index if not exists reviews_vendor_idx on public.reviews (vendor_id, status);

revoke all on public.reviews from anon, authenticated, public;
grant select on public.reviews to anon, authenticated;
drop policy if exists reviews_read_published on public.reviews;
create policy reviews_read_published on public.reviews
  for select to anon, authenticated using (status = 'published');
drop policy if exists reviews_read_own on public.reviews;
create policy reviews_read_own on public.reviews
  for select to authenticated using (customer_id = auth.uid());
drop policy if exists reviews_admin_all on public.reviews;
create policy reviews_admin_all on public.reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6) WISHLIST (one row per user+product; toggle via definer RPC — dedupe)
-- ---------------------------------------------------------------------------
create table if not exists public.wishlist_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists wishlist_user_idx on public.wishlist_items (user_id, created_at desc);

revoke all on public.wishlist_items from anon, authenticated, public;
grant select, delete on public.wishlist_items to authenticated;
drop policy if exists wishlist_select_own on public.wishlist_items;
create policy wishlist_select_own on public.wishlist_items
  for select to authenticated using (user_id = auth.uid());
drop policy if exists wishlist_delete_own on public.wishlist_items;
create policy wishlist_delete_own on public.wishlist_items
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.fn_wishlist_toggle(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_added boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.product_is_public(p_product_id) then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.wishlist_items where user_id = auth.uid() and product_id = p_product_id) then
    delete from public.wishlist_items where user_id = auth.uid() and product_id = p_product_id;
    v_added := false;
  else
    insert into public.wishlist_items (user_id, product_id) values (auth.uid(), p_product_id)
      on conflict (user_id, product_id) do nothing;
    v_added := true;
  end if;
  return jsonb_build_object('added', v_added);
end $$;

-- ---------------------------------------------------------------------------
-- 7) RECENTLY VIEWED (cap 20, dedupe, newest first; merge on login)
-- ---------------------------------------------------------------------------
create table if not exists public.recently_viewed (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists recent_user_idx on public.recently_viewed (user_id, viewed_at desc);

revoke all on public.recently_viewed from anon, authenticated, public;
grant select, delete on public.recently_viewed to authenticated;
drop policy if exists recent_select_own on public.recently_viewed;
create policy recent_select_own on public.recently_viewed
  for select to authenticated using (user_id = auth.uid());
drop policy if exists recent_delete_own on public.recently_viewed;
create policy recent_delete_own on public.recently_viewed
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.fn_recently_viewed_prune(p_user uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.recently_viewed
  where user_id = p_user
    and product_id in (
      select product_id from (
        select product_id, row_number() over (order by viewed_at desc) rn
        from public.recently_viewed where user_id = p_user
      ) ranked where rn > 20
    );
$$;

create or replace function public.fn_record_view(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.product_is_public(p_product_id) then
    return; -- hidden/deleted products are never recorded
  end if;
  insert into public.recently_viewed (user_id, product_id, viewed_at)
  values (auth.uid(), p_product_id, now())
  on conflict (user_id, product_id) do update set viewed_at = now();
  perform public.fn_recently_viewed_prune(auth.uid());
end $$;

-- guest history merges on login: keeps the newer timestamp, dedupes, caps 20
create or replace function public.fn_recently_viewed_merge(p_items jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer; v_item jsonb; v_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if v_item->>'product_id' is null then continue; end if;
    begin
      v_at := coalesce((v_item->>'viewed_at')::timestamptz, now());
      insert into public.recently_viewed (user_id, product_id, viewed_at)
      values (auth.uid(), (v_item->>'product_id')::uuid, v_at)
      on conflict (user_id, product_id) do update
        set viewed_at = greatest(recently_viewed.viewed_at, excluded.viewed_at);
    exception when invalid_text_representation or invalid_datetime_format then
      continue; -- skip malformed guest rows instead of failing the merge
    end;
  end loop;
  perform public.fn_recently_viewed_prune(auth.uid());
  select count(*) into v_count from public.recently_viewed where user_id = auth.uid();
  return v_count;
end $$;

create or replace function public.fn_recently_viewed_clear()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  delete from public.recently_viewed where user_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 8) CART (DB cart for signed-in users; guests use localStorage then merge)
-- ---------------------------------------------------------------------------
create table if not exists public.cart_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  variant_id uuid not null references public.variants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty        integer not null default 1 check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, variant_id)
);
create index if not exists cart_user_idx on public.cart_items (user_id, updated_at desc);

revoke all on public.cart_items from anon, authenticated, public;
grant select, delete on public.cart_items to authenticated;
drop policy if exists cart_select_own on public.cart_items;
create policy cart_select_own on public.cart_items
  for select to authenticated using (user_id = auth.uid());
drop policy if exists cart_delete_own on public.cart_items;
create policy cart_delete_own on public.cart_items
  for delete to authenticated using (user_id = auth.uid());

drop trigger if exists cart_touch on public.cart_items;
create trigger cart_touch before update on public.cart_items
  for each row execute function public.touch_updated_at();

-- resolve a public, purchasable variant (or fail) — definer: reads catalog
create or replace function public.fn_cart_resolve(p_variant_id uuid)
returns table (ov_variant_id uuid, ov_product_id uuid, ov_stock integer)
language sql stable security definer set search_path = public as $$
  select v.id, v.product_id, v.stock
  from public.variants v
  where v.id = p_variant_id and v.deleted_at is null and v.is_active
    and public.product_is_public(v.product_id)
$$;

create or replace function public.fn_cart_add(p_variant_id uuid, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_stock integer; v_product uuid; v_prev integer; v_final integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    raise exception 'bad_quantity' using errcode = '22023';
  end if;
  select ov_product_id, ov_stock into v_product, v_stock
    from public.fn_cart_resolve(p_variant_id);
  if v_product is null then
    raise exception 'variant_unavailable' using errcode = 'P0002';
  end if;
  if v_stock < 1 then
    raise exception 'out_of_stock' using errcode = 'P0002';
  end if;
  select coalesce((select qty from public.cart_items
    where user_id = auth.uid() and variant_id = p_variant_id), 0) into v_prev;
  insert into public.cart_items (user_id, variant_id, product_id, qty)
  values (auth.uid(), p_variant_id, v_product, least(v_prev + p_qty, v_stock))
  on conflict (user_id, variant_id) do update
    set qty = least(v_prev + excluded.qty, v_stock);
  select qty into v_final from public.cart_items
    where user_id = auth.uid() and variant_id = p_variant_id;
  return jsonb_build_object(
    'variant_id', p_variant_id, 'qty', v_final, 'stock', v_stock,
    'capped', v_final < v_prev + p_qty
  );
end $$;

create or replace function public.fn_cart_set_qty(p_variant_id uuid, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_stock integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select ov_stock into v_stock from public.fn_cart_resolve(p_variant_id);
  if v_stock is null or p_qty is null or p_qty < 1 then
    delete from public.cart_items where user_id = auth.uid() and variant_id = p_variant_id;
    return jsonb_build_object('removed', true);
  end if;
  update public.cart_items
    set qty = least(p_qty, v_stock)
    where user_id = auth.uid() and variant_id = p_variant_id;
  return jsonb_build_object('variant_id', p_variant_id, 'qty', least(p_qty, v_stock), 'stock', v_stock, 'capped', p_qty > v_stock);
end $$;

create or replace function public.fn_cart_remove(p_variant_id uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.cart_items
  where user_id = auth.uid() and variant_id = p_variant_id;
$$;

-- full cart read with live product/variant data (name, image, price, stock)
create or replace function public.fn_cart_get()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', c.variant_id,
    'product_id', c.product_id,
    'qty', c.qty,
    'vendor_id', p.vendor_id,
    'leaf_category_id', p.leaf_category_id,
    'brand_id', p.brand_id,
    'stock', v.stock,
    'sku', v.sku,
    'option_key', v.option_key,
    'price_piastres', coalesce(
      case when p.sale_starts_at is not null and p.sale_starts_at <= now()
             and (p.sale_ends_at is null or p.sale_ends_at > now())
           then v.sale_price_piastres end,
      v.price_piastres),
    'regular_price_piastres', v.price_piastres,
    'on_sale', p.sale_starts_at is not null and p.sale_starts_at <= now()
               and (p.sale_ends_at is null or p.sale_ends_at > now())
               and v.sale_price_piastres is not null,
    'name_ar', p.name_ar, 'name_en', p.name_en,
    'slug_ar', p.slug_ar, 'slug_en', p.slug_en,
    'image_path', img.path,
    'vendor_id', p.vendor_id,
    'store_name_ar', vd.store_name_ar, 'store_name_en', vd.store_name_en,
    'capped', c.qty > v.stock
  ) order by c.updated_at desc), '[]'::jsonb)
  from public.cart_items c
  join public.products p on p.id = c.product_id
  join public.variants v on v.id = c.variant_id
  join public.vendors vd on vd.id = p.vendor_id
  left join lateral (
    select pm.path from public.product_media pm
    where pm.product_id = p.id and pm.kind = 'image'
    order by pm.position limit 1
  ) img on true
  where c.user_id = auth.uid()
$$;

-- guest cart merge on sign-in: identical lines combine, conflicts resolve to
-- the higher quantity, everything caps at stock with a notice per line
create or replace function public.fn_cart_merge(p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_line jsonb; v_variant uuid; v_qty integer; v_stock integer; v_product uuid;
        v_notices jsonb := '[]'::jsonb; v_local integer; v_existing integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_variant := (v_line->>'variant_id')::uuid;
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    if v_variant is null or v_qty < 1 or v_qty > 99 then continue; end if;
    begin
      select ov_product_id, ov_stock into v_product, v_stock
        from public.fn_cart_resolve(v_variant);
    exception when others then
      v_product := null;
    end;
    if v_product is null or v_stock < 1 then
      v_notices := v_notices || jsonb_build_object('variant_id', v_variant, 'key', 'unavailable');
      continue;
    end if;
    select coalesce((select qty from public.cart_items
      where user_id = auth.uid() and variant_id = v_variant), 0) into v_existing;
    v_local := least(v_qty, v_stock);
    if v_existing > 0 then
      update public.cart_items
        set qty = least(greatest(v_existing, v_local), v_stock)
        where user_id = auth.uid() and variant_id = v_variant;
    else
      insert into public.cart_items (user_id, variant_id, product_id, qty)
      values (auth.uid(), v_variant, v_product, v_local);
    end if;
    if greatest(v_existing, v_qty) > v_stock then
      v_notices := v_notices || jsonb_build_object('variant_id', v_variant, 'key', 'capped');
    end if;
  end loop;
  return jsonb_build_object('lines', public.fn_cart_get(), 'notices', v_notices);
end $$;

-- ---------------------------------------------------------------------------
-- 9) COUPONS (admin-only creation; cart validates via fn_apply_coupon)
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  type                  text not null check (type in ('percent','fixed')),
  value                 integer not null check (value > 0), -- percent 1..100 or piastres
  free_shipping         boolean not null default false,
  min_subtotal_piastres integer not null default 0 check (min_subtotal_piastres >= 0),
  max_discount_piastres integer check (max_discount_piastres is null or max_discount_piastres > 0),
  max_uses_total        integer check (max_uses_total is null or max_uses_total > 0),
  max_uses_per_user     integer check (max_uses_per_user is null or max_uses_per_user > 0),
  exclude_sale_items    boolean not null default false,
  status                text not null default 'active'
                        check (status in ('active','expired','disabled')),
  starts_at             timestamptz,
  ends_at               timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint coupons_code_unique unique (code)
);

create table if not exists public.coupon_scopes (
  id        uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  mode      text not null check (mode in ('include','exclude')),
  scope     text not null check (scope in ('vendor','category','brand','product')),
  ref_id    uuid not null
);
create index if not exists coupon_scopes_idx on public.coupon_scopes (coupon_id);

create table if not exists public.coupon_redemptions (
  id         uuid primary key default gen_random_uuid(),
  coupon_id  uuid not null references public.coupons(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  order_id   uuid,
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_idx on public.coupon_redemptions (coupon_id, user_id);

revoke all on public.coupons, public.coupon_scopes, public.coupon_redemptions
  from anon, authenticated, public;
grant select, insert, update, delete on public.coupons to authenticated;
grant select, insert, update, delete on public.coupon_scopes to authenticated;
grant select on public.coupon_redemptions to authenticated;
drop policy if exists coupons_admin_all on public.coupons;
create policy coupons_admin_all on public.coupons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists coupon_scopes_admin_all on public.coupon_scopes;
create policy coupon_scopes_admin_all on public.coupon_scopes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists coupon_redemptions_admin_read on public.coupon_redemptions;
create policy coupon_redemptions_admin_read on public.coupon_redemptions
  for select to authenticated using (public.is_admin());

-- Validate a coupon against cart lines. Lines:
-- [{product_id, vendor_id, leaf_category_id, brand_id, unit_price_piastres,
--   qty, on_sale}]
create or replace function public.fn_apply_coupon(p_code text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_subtotal integer := 0; v_eligible integer := 0;
        v_eligible_subtotal integer := 0; v_line jsonb; v_on_sale boolean;
        v_discount integer := 0; v_uses_total integer := 0; v_uses_user integer := 0;
        v_has_include boolean; v_scope_ok boolean;
begin
  select * into c from public.coupons
    where upper(code) = upper(coalesce(p_code, '')) limit 1;
  if c is null or c.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if (c.starts_at is not null and c.starts_at > now())
     or (c.ends_at is not null and c.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses_total is not null then
    select count(*) into v_uses_total from public.coupon_redemptions where coupon_id = c.id;
    if v_uses_total >= c.max_uses_total then
      return jsonb_build_object('ok', false, 'reason', 'limit');
    end if;
  end if;
  if c.max_uses_per_user is not null and auth.uid() is not null then
    select count(*) into v_uses_user from public.coupon_redemptions
      where coupon_id = c.id and user_id = auth.uid();
    if v_uses_user >= c.max_uses_per_user then
      return jsonb_build_object('ok', false, 'reason', 'limit');
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_subtotal := v_subtotal + coalesce((v_line->>'unit_price_piastres')::integer, 0) * coalesce((v_line->>'qty')::integer, 0);
  end loop;
  if v_subtotal < c.min_subtotal_piastres then
    return jsonb_build_object('ok', false, 'reason', 'min_subtotal');
  end if;

  select exists (select 1 from public.coupon_scopes where coupon_id = c.id and mode = 'include')
    into v_has_include;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_on_sale := coalesce((v_line->>'on_sale')::boolean, false);
    if c.exclude_sale_items and v_on_sale then
      continue;
    end if;
    v_scope_ok := true;
    if v_has_include then
      select bool_or(
        (scope = 'vendor'   and ref_id = (v_line->>'vendor_id')::uuid)
        or (scope = 'category' and ref_id = (v_line->>'leaf_category_id')::uuid)
        or (scope = 'brand'    and ref_id = (v_line->>'brand_id')::uuid)
        or (scope = 'product'  and ref_id = (v_line->>'product_id')::uuid)
      ) into v_scope_ok
      from public.coupon_scopes where coupon_id = c.id and mode = 'include';
    end if;
    if exists (
      select 1 from public.coupon_scopes s
      where s.coupon_id = c.id and s.mode = 'exclude' and (
        (s.scope = 'vendor'   and s.ref_id = (v_line->>'vendor_id')::uuid)
        or (s.scope = 'category' and s.ref_id = (v_line->>'leaf_category_id')::uuid)
        or (s.scope = 'brand'    and s.ref_id = (v_line->>'brand_id')::uuid)
        or (s.scope = 'product'  and s.ref_id = (v_line->>'product_id')::uuid)
      )
    ) then
      v_scope_ok := false;
    end if;
    if v_scope_ok then
      v_eligible := v_eligible + coalesce((v_line->>'qty')::integer, 0);
      v_eligible_subtotal := v_eligible_subtotal
        + coalesce((v_line->>'unit_price_piastres')::integer, 0) * coalesce((v_line->>'qty')::integer, 0);
    end if;
  end loop;

  if v_eligible = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  if c.type = 'percent' then
    v_discount := (v_eligible_subtotal * c.value) / 100;
  else
    v_discount := c.value; -- fixed, once per order
  end if;
  if c.max_discount_piastres is not null and v_discount > c.max_discount_piastres then
    v_discount := c.max_discount_piastres;
  end if;
  if v_discount > v_subtotal then
    v_discount := v_subtotal;
  end if;
  return jsonb_build_object(
    'ok', true,
    'coupon_id', c.id,
    'discount_piastres', v_discount,
    'free_shipping', c.free_shipping,
    'eligible_count', v_eligible
  );
end $$;

revoke all on function public.fn_apply_coupon(text, jsonb) from public, anon;
grant execute on function public.fn_apply_coupon(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) EVENTS (minimal read-side schema; admin suite arrives in phase 07)
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  name_en     text not null,
  desc_ar     text not null default '',
  desc_en     text not null default '',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'draft' check (status in ('draft','active','ended')),
  created_at  timestamptz not null default now()
);

create table if not exists public.event_vendors (
  event_id  uuid not null references public.events(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  status    text not null default 'auto' check (status in ('auto','accepted','refused')),
  primary key (event_id, vendor_id)
);

create table if not exists public.event_discounts (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events(id) on delete cascade,
  scope                 text not null check (scope in ('category','product')),
  ref_id                uuid not null, -- category or product
  percent               integer not null check (percent between 1 and 90),
  max_discount_piastres integer check (max_discount_piastres is null or max_discount_piastres > 0)
);
create index if not exists event_discounts_scope_idx on public.event_discounts (event_id, scope, ref_id);

revoke all on public.events, public.event_vendors, public.event_discounts
  from anon, authenticated, public;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.event_vendors to authenticated;
grant select, insert, update, delete on public.event_discounts to authenticated;
drop policy if exists events_admin_all on public.events;
create policy events_admin_all on public.events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists event_vendors_admin_all on public.event_vendors;
create policy event_vendors_admin_all on public.event_vendors
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists event_discounts_admin_all on public.event_discounts;
create policy event_discounts_admin_all on public.event_discounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 11) STOREFRONT VIEWS (definer — the ONLY public window on vendor/product
--     data; every view hard-codes the visibility predicate so nothing that
--     is draft/pending/hidden can ever leak, whatever the client asks for)
-- ---------------------------------------------------------------------------

-- Active event id per vendor (refusal → listing exclusion + store notice)
create or replace view public.v_active_event_vendors as
select ev.vendor_id, e.id as event_id, e.name_ar, e.name_en, ev.status
from public.events e
join public.event_vendors ev on ev.event_id = e.id
where e.status = 'active' and now() between e.starts_at and e.ends_at;

create or replace view public.v_storefront_products as
select
  p.id,
  p.slug_ar, p.slug_en,
  p.name_ar, p.name_en,
  p.short_ar, p.short_en,
  p.leaf_category_id,
  cat.name_ar as category_name_ar, cat.name_en as category_name_en,
  cat.slug_ar as category_slug_ar, cat.slug_en as category_slug_en,
  p.brand_id,
  b.name_ar as brand_name_ar, b.name_en as brand_name_en,
  p.vendor_id,
  v.slug as vendor_slug,
  v.store_name_ar, v.store_name_en,
  v.logo_path as vendor_logo_path,
  lvl.name_ar as level_name_ar, lvl.name_en as level_name_en, lvl.icon as level_icon,
  img.path as main_image_path,
  pr.min_price_piastres,
  pr.min_sale_price_piastres,
  pr.has_sale,
  greatest(
    coalesce(evp.percent, 0),
    coalesce(evc.percent, 0)
  ) as event_percent,
  case
    when coalesce(evp.percent, 0) >= coalesce(evc.percent, 0) then evp.max_piastres
    else evc.max_piastres
  end as event_max_piastres,
  st.stock_total,
  r.rating_avg,
  r.rating_count,
  (p.featured_permanent or (p.featured_until is not null and p.featured_until > now())) as is_featured,
  p.event_hidden as is_event_hidden,
  exists (
    select 1 from public.v_active_event_vendors aev
    where aev.vendor_id = v.id and aev.status = 'refused'
  ) as vendor_event_refused,
  (
    (not p.event_hidden)
    and not exists (
      select 1 from public.v_active_event_vendors aev
      where aev.vendor_id = v.id and aev.status = 'refused'
    )
  ) as is_listable,
  p.published_at,
  p.created_at
from public.products p
join public.vendors v on v.id = p.vendor_id
left join public.categories cat on cat.id = p.leaf_category_id
left join public.brands b on b.id = p.brand_id
left join public.vendor_levels lvl on lvl.id = v.level_id
left join lateral (
  select pm.path from public.product_media pm
  where pm.product_id = p.id and pm.kind = 'image'
  order by pm.position limit 1
) img on true
left join lateral (
  select
    min(case when p.sale_starts_at is not null and p.sale_starts_at <= now()
              and (p.sale_ends_at is null or p.sale_ends_at > now())
              and v2.sale_price_piastres is not null
            then least(v2.price_piastres, v2.sale_price_piastres)
            else v2.price_piastres end) as min_price_piastres,
    min(case when p.sale_starts_at is not null and p.sale_starts_at <= now()
              and (p.sale_ends_at is null or p.sale_ends_at > now())
              and v2.sale_price_piastres is not null
            then v2.sale_price_piastres end) as min_sale_price_piastres,
    bool_or(p.sale_starts_at is not null and p.sale_starts_at <= now()
            and (p.sale_ends_at is null or p.sale_ends_at > now())
            and v2.sale_price_piastres is not null) as has_sale,
    min(v2.price_piastres) as min_regular_piastres
  from public.variants v2
  where v2.product_id = p.id and v2.deleted_at is null and v2.is_active
    and v2.price_piastres is not null
) pr on true
left join lateral (
  select coalesce(sum(v3.stock), 0) as stock_total
  from public.variants v3
  where v3.product_id = p.id and v3.deleted_at is null and v3.is_active
) st on true
left join lateral (
  select round(avg(rw.rating)::numeric, 1) as rating_avg, count(*)::int as rating_count
  from public.reviews rw
  where rw.product_id = p.id and rw.status = 'published'
) r on true
left join lateral (
  select d.percent, d.max_discount_piastres as max_piastres
  from public.v_active_event_vendors aev
  join public.event_discounts d on d.event_id = aev.event_id
  where aev.vendor_id = p.vendor_id and aev.status = 'accepted'
    and d.scope = 'product' and d.ref_id = p.id
  order by d.percent desc limit 1
) evp on true
left join lateral (
  select d.percent, d.max_discount_piastres as max_piastres
  from public.v_active_event_vendors aev
  join public.event_discounts d on d.event_id = aev.event_id
  where aev.vendor_id = p.vendor_id and aev.status = 'accepted'
    and d.scope = 'category' and d.ref_id = p.leaf_category_id
  order by d.percent desc limit 1
) evc on true
where p.status = 'approved'
  and p.deleted_at is null
  and v.status = 'active'
  and v.verification_status <> 'grace_expired'
  and not v.hidden_from_listings;

grant select on public.v_storefront_products to anon, authenticated;

-- Public store cards: /vendors listing + /store/:slug + suggestions.
-- Suspended stores stay visible here so the store page can explain itself;
-- the vendors ROUTE filters to active + not hidden.
create or replace view public.v_storefront_stores as
select
  v.id, v.slug,
  v.store_name_ar, v.store_name_en,
  v.short_desc_ar, v.short_desc_en,
  v.logo_path, v.banner_path,
  v.status,
  v.is_featured,
  lvl.name_ar as level_name_ar, lvl.name_en as level_name_en, lvl.icon as level_icon,
  r.rating_avg, r.rating_count,
  pc.product_count,
  aev.event_id as refused_event_id,
  aev.name_ar as refused_event_name_ar, aev.name_en as refused_event_name_en
from public.vendors v
left join public.vendor_levels lvl on lvl.id = v.level_id
left join lateral (
  select round(avg(rw.rating)::numeric, 1) as rating_avg, count(*)::int as rating_count
  from public.reviews rw
  where rw.vendor_id = v.id and rw.status = 'published'
) r on true
left join lateral (
  select count(*)::int as product_count
  from public.products p
  where p.vendor_id = v.id and p.status = 'approved' and p.deleted_at is null
) pc on true
left join public.v_active_event_vendors aev
  on aev.vendor_id = v.id and aev.status = 'refused'
where v.status in ('active','suspended');

grant select on public.v_storefront_stores to anon, authenticated;

-- Active categories (header menu, home strip, /sell map, category pages)
create or replace view public.v_storefront_categories as
select c.id, c.parent_id, c.depth, c.path,
       c.slug_ar, c.slug_en, c.name_ar, c.name_en,
       c.description_ar, c.description_en, c.thumb_path, c.sort
from public.categories c
where c.is_active and c.deleted_at is null;

grant select on public.v_storefront_categories to anon, authenticated;

-- Active brands with public product counts
create or replace view public.v_storefront_brands as
select b.id, b.slug_ar, b.slug_en, b.name_ar, b.name_en, b.thumb_path, b.sort,
       coalesce(pc.product_count, 0) as product_count
from public.brands b
left join lateral (
  select count(*)::int as product_count
  from public.products p
  where p.brand_id = b.id and p.status = 'approved' and p.deleted_at is null
) pc on true
where b.is_active and b.deleted_at is null;

grant select on public.v_storefront_brands to anon, authenticated;

-- Filterable attribute definitions (label falls back to the code)
create or replace view public.v_storefront_facet_defs as
select distinct on (d.id)
  d.id as attribute_id, d.code, d.type, d.unit, d.sort,
  coalesce(d.label_ar, d.code) as label_ar,
  coalesce(d.label_en, d.code) as label_en,
  d.category_id as leaf_category_id
from public.attribute_defs d
join public.categories leaf on leaf.id = d.category_id
  and leaf.is_active and leaf.deleted_at is null
where d.is_filterable
  and (
    exists (
      select 1 from public.category_attributes ca
      where ca.attribute_id = d.id and ca.category_id = d.category_id
    )
    or not exists (
      select 1 from public.category_attributes ca where ca.category_id = d.category_id
    )
  );

grant select on public.v_storefront_facet_defs to anon, authenticated;

-- Admin dictionary options for facet defs (labels/colors for the UI)
create or replace view public.v_storefront_facet_options as
select o.id as option_id, o.attribute_id, o.label_ar, o.label_en, o.color_hex, o.sort
from public.attribute_options o
join public.attribute_defs d on d.id = o.attribute_id
join public.categories leaf on leaf.id = d.category_id
  and leaf.is_active and leaf.deleted_at is null
where d.is_filterable;

grant select on public.v_storefront_facet_options to anon, authenticated;

-- Published reviews with the author display name (product page reviews tab)
create or replace view public.v_storefront_reviews as
select rw.id, rw.product_id, rw.vendor_id, rw.rating, rw.title, rw.body, rw.created_at,
       pr.full_name as author_name
from public.reviews rw
join public.profiles pr on pr.id = rw.customer_id
where rw.status = 'published';

grant select on public.v_storefront_reviews to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12) SEARCH RPC — filtering + facets + counts + pagination in one call.
--     Facet counts are computed on the base set minus that facet's own
--     filter, so a selected color never zeroes out the color list.
--     Effective price = variant sale (within the product sale window) else
--     regular, minus the active event discount (capped).
-- ---------------------------------------------------------------------------
create or replace function public.fn_search_products(
  p_q          text default null,
  p_category   uuid default null,
  p_brand      uuid default null,
  p_attrs      jsonb default null,   -- [{attribute_id, option_ids:[]}]
  p_price_min  integer default null, -- piastres
  p_price_max  integer default null,
  p_rating     numeric default null, -- 2..5
  p_in_stock   boolean default null,
  p_sort       text default 'newest',
  p_page       integer default 1,
  p_per_page   integer default 24
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text;
  v_norm text;
  v_cat_path text;
  v_total integer := 0;
  v_where_core text;
  v_items jsonb;
  v_facet_brands jsonb;
  v_facet_categories jsonb;
  v_facet_attrs jsonb;
  v_where text;
  v_cat_cond text := '';
  v_brand_cond text := '';
  v_price_cond text := '';
  v_rating_cond text := '';
  v_stock_cond text := '';
  v_attr_cond text := '';
  v_price_expr text := 'coalesce(case when has_sale then min_sale_price_piastres end, min_price_piastres)';
  v_event_price_expr text := 'case when event_percent > 0 then least('
    || v_price_expr || ' - (' || v_price_expr || ' * event_percent / 100),'
    || ' coalesce(event_max_piastres, 9223372036854775807)) else '
    || v_price_expr || ' end';
  v_attrs jsonb := coalesce(p_attrs, '[]'::jsonb);
  v_attr_elem jsonb;
  v_off integer := greatest(coalesce(p_page, 1) - 1, 0) * least(coalesce(p_per_page, 24), 60);
  v_limit integer := least(coalesce(p_per_page, 24), 60);
  v_order text;
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) > 80 then
    v_q := left(v_q, 80);
  end if;
  v_norm := public.ar_norm(v_q);

  if p_category is not null then
    select path into v_cat_path from public.categories where id = p_category;
    if v_cat_path is null then
      return jsonb_build_object('total', 0, 'page', greatest(coalesce(p_page,1),1), 'per_page', v_limit,
        'items', '[]'::jsonb, 'facets', jsonb_build_object());
    end if;
  end if;

  v_where_core := ' min_price_piastres is not null and is_listable';
  v_where := v_where_core;

  if v_q <> '' then
    v_where := v_where || format(' and (
      public.fn_tsv_match(id, %L)
      or public.ar_norm(name_ar) like %L
      or name_en ilike %L
      or name_ar %% %L
      or name_en %% %L
    )', v_q, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q);
  end if;
  if p_category is not null then
    v_cat_cond := format(
      ' (leaf_category_id = %L::uuid or exists (
         select 1 from public.categories sc
         where sc.id = leaf_category_id and sc.path like %L))',
      p_category::text, v_cat_path || '/%');
    v_where := v_where || ' and' || v_cat_cond;
  end if;
  if p_brand is not null then
    v_brand_cond := format(' and brand_id = %L::uuid', p_brand::text);
    v_where := v_where || v_brand_cond;
  end if;
  if p_price_min is not null or p_price_max is not null then
    if p_price_min is not null then
      v_price_cond := v_price_cond || format(' %s >= %s', v_price_expr, p_price_min::text);
    end if;
    if p_price_max is not null then
      v_price_cond := v_price_cond || (case when v_price_cond <> '' then ' and' else '' end)
        || format(' %s <= %s', v_price_expr, p_price_max::text);
    end if;
    v_where := v_where || ' and' || v_price_cond;
  end if;
  if p_rating is not null and p_rating >= 1 then
    v_rating_cond := format(' (rating_avg >= %s and rating_count > 0)', p_rating::text);
    v_where := v_where || ' and' || v_rating_cond;
  end if;
  if coalesce(p_in_stock, false) then
    v_stock_cond := ' stock_total > 0';
    v_where := v_where || ' and' || v_stock_cond;
  end if;

  -- attribute facet conditions: every selected attribute must have ≥1 match
  for v_attr_elem in select * from jsonb_array_elements(v_attrs) loop
    if jsonb_typeof(v_attr_elem->'option_ids') = 'array'
       and jsonb_array_length(v_attr_elem->'option_ids') > 0 then
      v_attr_cond := v_attr_cond || format(
        ' exists (select 1 from public.product_facets pf
           where pf.product_id = id and pf.attribute_id = %L::uuid
             and pf.option_id::text = any(array(select jsonb_array_elements_text(%L))))',
        v_attr_elem->>'attribute_id', v_attr_elem->'option_ids');
    end if;
  end loop;
  if v_attr_cond <> '' then
    v_attr_cond := ' and' || v_attr_cond;
    v_where := v_where || v_attr_cond;
  end if;

  execute 'select count(*) from public.v_storefront_products where' || v_where into v_total;

  v_order := case p_sort
    when 'price_asc'  then v_event_price_expr || ' asc nulls last, published_at desc'
    when 'price_desc' then v_event_price_expr || ' desc nulls last, published_at desc'
    when 'rating'     then 'rating_count desc, rating_avg desc nulls last, published_at desc'
    else 'is_featured desc, published_at desc nulls last'
  end;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*) order by %s), '[]'::jsonb)
    from (
      select vp.*, %s as event_price_piastres
      from public.v_storefront_products vp
      where%s
      offset %s limit %s
    ) t
  $f$, v_order, v_event_price_expr, v_where, v_off::text, v_limit::text)
    into v_items;

  -- ---- facets -------------------------------------------------------------
  -- brands: base minus the brand filter
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select brand_id as id, brand_name_ar as name_ar, brand_name_en as name_en, count(*)::int as count
      from public.v_storefront_products
      where%s
      group by brand_id, brand_name_ar, brand_name_en
      having brand_id is not null
    ) f
  $f$, v_where_core || v_attr_cond)
    into v_facet_brands;

  -- categories: children of the current node (or level-1 roots), unfiltered
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.count desc nulls last, f.name_ar nulls last), '[]'::jsonb)
    from (
      select sc.id, sc.name_ar as name_ar, sc.name_en as name_en, sc.slug_ar, sc.slug_en,
             count(vp.id)::int as count
      from (%s) sc
      left join public.v_storefront_products vp
        on vp.min_price_piastres is not null and vp.is_listable
       and (vp.leaf_category_id = sc.id
            or exists (select 1 from public.categories dsc
                       where dsc.id = vp.leaf_category_id and dsc.path like sc.path || '/%%'))
      group by sc.id, sc.name_ar, sc.name_en, sc.slug_ar, sc.slug_en
    ) f
  $f$,
    case when p_category is null
      then 'select * from public.v_storefront_categories where depth = 1'
      else format('select * from public.categories c where c.is_active and c.deleted_at is null and c.parent_id = %L::uuid', p_category::text)
    end
  ) into v_facet_categories;

  -- attribute options: defs effective for the scope; counts on the base
  -- minus ALL attribute filters (stable counts while multi-selecting)
  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(f.*) order by f.attribute_sort, f.option_sort), '[]'::jsonb)
    from (
      select fd.attribute_id, fd.code, fd.label_ar, fd.label_en, fd.type, fd.unit, fd.sort as attribute_sort,
             fo.option_id, fo.label_ar as option_label_ar, fo.label_en as option_label_en,
             fo.color_hex, fo.sort as option_sort, coalesce(fc.count, 0)::int as count
      from public.v_storefront_facet_defs fd
      join public.v_storefront_facet_options fo on fo.attribute_id = fd.attribute_id
      left join (
        select pf.attribute_id, pf.option_id, count(*)::int as count
        from public.product_facets pf
        where exists (
          select 1 from public.v_storefront_products vp2
          where vp2.id = pf.product_id and (%s)
        )
        group by pf.attribute_id, pf.option_id
      ) fc on fc.attribute_id = fd.attribute_id and fc.option_id = fo.option_id
      where %s
    ) f
  $f$,
    v_where_core || v_brand_cond,
    case when p_category is null then 'true' else
      format('(fd.leaf_category_id = %L::uuid or exists (
        select 1 from public.categories sc2
        where sc2.id = fd.leaf_category_id and sc2.path like %L))',
        p_category::text, v_cat_path || '/%')
    end
  ) into v_facet_attrs;

  return jsonb_build_object(
    'total', v_total,
    'page', greatest(coalesce(p_page, 1), 1),
    'per_page', v_limit,
    'items', coalesce(v_items, '[]'::jsonb),
    'facets', jsonb_build_object(
      'brands', coalesce(v_facet_brands, '[]'::jsonb),
      'categories', coalesce(v_facet_categories, '[]'::jsonb),
      'attributes', coalesce(v_facet_attrs, '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.fn_search_products(text, uuid, uuid, jsonb, integer, integer, numeric, boolean, text, integer, integer) from public, anon;
grant execute on function public.fn_search_products(text, uuid, uuid, jsonb, integer, integer, numeric, boolean, text, integer, integer) to anon, authenticated;

-- FTS match helper (the generated tsv lives on the base table)
create or replace function public.fn_tsv_match(p_id uuid, p_q text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.products p
    where p.id = p_id
      and p.search_tsv @@ websearch_to_tsquery('arabic', p_q)
  );
$$;

revoke all on function public.fn_tsv_match(uuid, text) from public;
grant execute on function public.fn_tsv_match(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13) SUGGESTIONS (search box: products + stores + categories, normalized)
-- ---------------------------------------------------------------------------
create or replace function public.fn_search_suggestions(p_q text, p_limit integer default 4)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text; v_norm text; v_products jsonb; v_stores jsonb; v_categories jsonb;
  v_lim integer := least(coalesce(p_limit, 4), 8);
begin
  v_q := btrim(coalesce(p_q, ''));
  if char_length(v_q) < 2 then
    return jsonb_build_object('products', '[]', 'stores', '[]', 'categories', '[]');
  end if;
  if char_length(v_q) > 60 then
    v_q := left(v_q, 60);
  end if;
  v_norm := public.ar_norm(v_q);

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select vp.id, vp.slug_ar, vp.slug_en, vp.name_ar, vp.name_en, vp.main_image_path,
             coalesce(case when vp.has_sale then vp.min_sale_price_piastres end,
                      vp.min_price_piastres) as price_piastres
      from public.v_storefront_products vp
      where vp.min_price_piastres is not null and (
        public.fn_tsv_match(vp.id, %L)
        or public.ar_norm(vp.name_ar) like %L
        or vp.name_en ilike %L
        or vp.name_ar %% %L
        or vp.name_en %% %L
      )
      order by vp.is_featured desc, vp.rating_count desc, vp.published_at desc
      limit %s
    ) t
  $f$, v_q, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q, v_lim::text)
    into v_products;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select s.slug, s.store_name_ar as name_ar, s.store_name_en as name_en, s.logo_path
      from public.v_storefront_stores s
      where s.status = 'active' and s.product_count > 0
        and (public.ar_norm(s.store_name_ar) like %L
             or s.store_name_en ilike %L
             or s.store_name_ar %% %L
             or s.store_name_en %% %L)
      order by s.is_featured desc, s.product_count desc
      limit %s
    ) t
  $f$, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q, v_lim::text)
    into v_stores;

  execute format($f$
    select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from (
      select c.slug_ar, c.slug_en, c.name_ar, c.name_en, c.depth
      from public.v_storefront_categories c
      where public.ar_norm(c.name_ar) like %L
         or c.name_en ilike %L
         or c.name_ar %% %L
         or c.name_en %% %L
      order by c.depth, c.sort
      limit %s
    ) t
  $f$, '%' || v_norm || '%', '%' || v_q || '%', v_q, v_q, v_lim::text)
    into v_categories;

  return jsonb_build_object('products', v_products, 'stores', v_stores, 'categories', v_categories);
end $$;

revoke all on function public.fn_search_suggestions(text, integer) from public, anon;
grant execute on function public.fn_search_suggestions(text, integer) to anon, authenticated;

-- "Did you mean": closest product name word when a search returns nothing
create or replace function public.fn_search_did_you_mean(p_q text)
returns text
language sql stable security definer set search_path = public as $$
  select word from (
    select word, similarity(word, p_q) as sim
    from (
      select distinct (regexp_split_to_table(name_ar, '\s+')) as word
      from public.products where status = 'approved' and deleted_at is null
      union
      select distinct (regexp_split_to_table(name_en, '\s+')) as word
      from public.products where status = 'approved' and deleted_at is null
    ) words
    where word <> '' and similarity(word, p_q) > 0.2
    order by sim desc limit 1
  ) best
$$;

revoke all on function public.fn_search_did_you_mean(text) from public, anon;
grant execute on function public.fn_search_did_you_mean(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14) RPC EXECUTE GRANTS (cart / wishlist / recents)
-- ---------------------------------------------------------------------------
revoke all on function public.fn_wishlist_toggle(uuid) from public, anon;
grant execute on function public.fn_wishlist_toggle(uuid) to authenticated;
revoke all on function public.fn_record_view(uuid) from public, anon;
grant execute on function public.fn_record_view(uuid) to authenticated;
revoke all on function public.fn_recently_viewed_merge(jsonb) from public, anon;
grant execute on function public.fn_recently_viewed_merge(jsonb) to authenticated;
revoke all on function public.fn_recently_viewed_clear() from public, anon;
grant execute on function public.fn_recently_viewed_clear() to authenticated;
revoke all on function public.fn_cart_add(uuid, integer) from public, anon;
grant execute on function public.fn_cart_add(uuid, integer) to authenticated;
revoke all on function public.fn_cart_set_qty(uuid, integer) from public, anon;
grant execute on function public.fn_cart_set_qty(uuid, integer) to authenticated;
revoke all on function public.fn_cart_remove(uuid) from public, anon;
grant execute on function public.fn_cart_remove(uuid) to authenticated;
revoke all on function public.fn_cart_get() from public, anon;
grant execute on function public.fn_cart_get() to authenticated;
revoke all on function public.fn_cart_merge(jsonb) from public, anon;
grant execute on function public.fn_cart_merge(jsonb) to authenticated;

-- ============================================================================
-- PATCH 4a (folded): public dictionary reads + stores listable flag +
-- active-event view (applied idempotently; safe on fresh installs)
-- ============================================================================
grant select on public.attribute_defs, public.attribute_options to anon, authenticated;

drop view if exists public.v_storefront_stores;
create view public.v_storefront_stores as
select
  v.id, v.slug,
  v.store_name_ar, v.store_name_en,
  v.short_desc_ar, v.short_desc_en,
  v.logo_path, v.banner_path,
  v.status,
  v.is_featured,
  v.hidden_from_listings,
  (v.status = 'active' and not v.hidden_from_listings) as is_listable,
  v.category_ids,
  lvl.name_ar as level_name_ar, lvl.name_en as level_name_en, lvl.icon as level_icon,
  r.rating_avg, r.rating_count,
  pc.product_count,
  aev.event_id as refused_event_id,
  aev.name_ar as refused_event_name_ar, aev.name_en as refused_event_name_en
from public.vendors v
left join public.vendor_levels lvl on lvl.id = v.level_id
left join lateral (
  select round(avg(rw.rating)::numeric, 1) as rating_avg, count(*)::int as rating_count
  from public.reviews rw
  where rw.vendor_id = v.id and rw.status = 'published'
) r on true
left join lateral (
  select count(*)::int as product_count
  from public.products p
  where p.vendor_id = v.id and p.status = 'approved' and p.deleted_at is null
) pc on true
left join public.v_active_event_vendors aev
  on aev.vendor_id = v.id and aev.status = 'refused'
where v.status in ('active','suspended');

grant select on public.v_storefront_stores to anon, authenticated;

create or replace view public.v_storefront_active_event as
select e.id, e.name_ar, e.name_en, e.desc_ar, e.desc_en, e.starts_at, e.ends_at
from public.events e
where e.status = 'active' and now() between e.starts_at and e.ends_at
limit 1;

grant select on public.v_storefront_active_event to anon, authenticated;

-- ============================================================================
-- PATCH 4f (folded): ENABLE ROW LEVEL SECURITY on every phase-04 table
-- (policies existed but RLS was not armed — caught by the banner test)
-- ============================================================================
alter table public.banners            enable row level security;
alter table public.static_pages       enable row level security;
alter table public.contact_messages   enable row level security;
alter table public.reviews            enable row level security;
alter table public.wishlist_items     enable row level security;
alter table public.recently_viewed    enable row level security;
alter table public.cart_items         enable row level security;
alter table public.coupons            enable row level security;
alter table public.coupon_scopes      enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.events             enable row level security;
alter table public.event_vendors      enable row level security;
alter table public.event_discounts    enable row level security;

-- did-you-mean compares normalized forms (hamza variants must match)
create or replace function public.fn_search_did_you_mean(p_q text)
returns text
language sql stable security definer set search_path = public as $$
  select word from (
    select word, similarity(public.ar_norm(word), public.ar_norm(p_q)) as sim
    from (
      select distinct (regexp_split_to_table(name_ar, '\s+')) as word
      from public.products where status = 'approved' and deleted_at is null
      union
      select distinct (regexp_split_to_table(name_en, '\s+')) as word
      from public.products where status = 'approved' and deleted_at is null
    ) words
    where word <> '' and similarity(public.ar_norm(word), public.ar_norm(p_q)) > 0.2
    order by sim desc limit 1
  ) best
$$;

revoke all on function public.fn_search_did_you_mean(text) from public, anon;
grant execute on function public.fn_search_did_you_mean(text) to anon, authenticated;

-- PATCH 4g (folded): anon read policies for the public attribute dictionary
-- (grant existed since 4a but no policy → zero rows for guests; the product
-- page variant selector needs axis labels for visitors)
drop policy if exists attribute_defs_read_anon on public.attribute_defs;
create policy attribute_defs_read_anon on public.attribute_defs
  for select to anon using (deleted_at is null);
drop policy if exists attribute_options_read_anon on public.attribute_options;
create policy attribute_options_read_anon on public.attribute_options
  for select to anon using (deleted_at is null);
