-- Ad packages from "دليل الإعلانات للتجار" (owner feedback 2026-11-16: the
-- price table was not entered). Also:
--  * "متجر مميز" (store spotlight) is its own placement now — first among
--    stores on the home page AND the stores page, and on top of search
--    results; "ظهور متجرك في الصفحة الرئيسية" stays the home-only one;
--  * an offer-campaign product must carry a discount (guide: "لازم يكون عليه خصم").

insert into public.ad_placements (code, kind, name_ar, name_en, desc_ar, desc_en, needs_product, needs_image, sort) values
  ('store_spotlight', 'store', 'متجر مميز', 'Featured store',
   'متجرك وشعارك أول المتاجر في الصفحة الرئيسية وصفحة المتاجر، وفي أعلى نتائج البحث.',
   'Your store and logo first among stores on the home page and the stores page, and on top of search results.', false, false, 8)
on conflict (code) do nothing;
update public.ad_placements
   set name_ar = 'ظهور متجرك في الصفحة الرئيسية', name_en = 'Your store on the home page',
       desc_ar = 'متجرك وشعارك ضمن أول المتاجر في الصفحة الرئيسية.', desc_en = 'Your store and logo among the first stores on the home page.'
 where code = 'featured_store';
update public.ad_placements
   set desc_ar = 'منتجك في أول قسم «العروض» بالصفحة الرئيسية خلال الحملة — لازم يكون عليه خصم.',
       desc_en = 'Your product first in the home page Offers section during the campaign — it must be discounted.'
 where code = 'offer_campaign';

-- offer campaign: the product must be on sale now
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_vendor_place_ad_order'::regproc) into v_src;
  if position('not_discounted' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    '      if v_place.needs_image and coalesce(v_a->>''image_path'', '''') !~',
    '      if v_place.code = ''offer_campaign'' and not exists (select 1 from public.v_storefront_products sp
           where sp.id = nullif(v_a->>''product_id'', '''')::uuid and (sp.has_sale or coalesce(sp.event_percent, 0) > 0)) then
        return jsonb_build_object(''ok'', false, ''reason'', ''not_discounted'');
      end if;
      if v_place.needs_image and coalesce(v_a->>''image_path'', '''') !~');
  if v_new = v_src then raise exception 'fn_vendor_place_ad_order changed shape; patch not applied'; end if;
  execute v_new;
end $$;

-- the price table (EGP → piastres). Monthly = 30 days.
insert into public.ad_packages (name_ar, name_en, desc_ar, desc_en, duration_days, price_piastres, items, pricing_model, impressions_included, sort, is_active, visibility)
select p.name_ar, p.name_en, p.desc_ar, p.desc_en, p.days, p.price, p.items::jsonb, p.model, p.imp, p.sort, p.active, 'vendors'
  from (values
    ('لافتة رئيسية (بانر)', 'Home banner', 'صورة كبيرة لمتجرك في سلايدر أعلى الصفحة الرئيسية لمدة شهر.', 'A large image of your store in the home page top slider for a month.',
     30, 200000, '[{"placement":"home_hero","count":1}]', 'fixed', null::int, 1, true),
    ('لافتة قسم', 'Category banner', 'بانر أعلى صفحة القسم اللي تختاره لمدة شهر.', 'A banner at the top of the category page you choose, for a month.',
     30, 100000, '[{"placement":"category_banner","count":1}]', 'fixed', null, 2, true),
    ('ظهور في قسم بالصفحة الرئيسية', 'Featured in one home section', 'منتجك في أول قسم «وافد جديد» أو «العروض» أو «الأكثر شعبية» — قسم واحد تختاره، لمدة شهر.', 'Your product first in New arrivals, Offers or Most popular — one section of your choice, for a month.',
     30, 50000, '[{"placement":"home_section","count":1,"sections":["recent","discounts","best_selling"]}]', 'fixed', null, 3, true),
    ('ظهور في 3 أقسام مع بعض', 'Featured in 3 home sections', 'منتجاتك في أول «وافد جديد» و«العروض» و«الأكثر شعبية» مع بعض، لمدة شهر.', 'Your products first in New arrivals, Offers and Most popular together, for a month.',
     30, 100000, '[{"placement":"home_section","count":3,"sections":["recent","discounts","best_selling"]}]', 'fixed', null, 4, true),
    ('ظهور متجرك في الصفحة الرئيسية', 'Your store on the home page', 'متجرك وشعارك ضمن أول المتاجر في الصفحة الرئيسية لمدة شهر.', 'Your store and logo among the first stores on the home page, for a month.',
     30, 50000, '[{"placement":"featured_store","count":1}]', 'fixed', null, 5, true),
    ('متجر مميز', 'Featured store', 'متجرك وشعارك أول المتاجر في الصفحة الرئيسية وصفحة المتاجر، وفي أعلى نتائج البحث — اشتراك شهري.', 'Your store and logo first on the home page and the stores page, and on top of search results — monthly subscription.',
     30, 100000, '[{"placement":"store_spotlight","count":1}]', 'fixed', null, 6, true),
    ('إعلان داخل صفحة المنتج', 'In-product-page ad', 'منتجك يظهر «منتج مُموَّل» للي بيتفرج على منتج شبه منتجك — 10,000 ظهور (50 جنيه لكل 1000 ظهور).', 'Your product shown as Sponsored to shoppers viewing similar products — 10,000 impressions (EGP 50 per 1,000).',
     30, 50000, '[{"placement":"product_page","count":1}]', 'cpm', 10000, 7, true),
    ('حملة عروض', 'Offer campaign', 'منتجك في أول قسم «العروض» بالصفحة الرئيسية خلال الحملة — لازم يكون عليه خصم.', 'Your product first in the home page Offers section during the campaign — it must be discounted.',
     30, 100000, '[{"placement":"offer_campaign","count":1}]', 'fixed', null, 8, true),
    -- no customer app yet: kept hidden until push messages can be delivered
    ('إشعار دفع', 'Push notification', 'رسالة توصل لموبايلات العملاء على التطبيق وقت عرضك — إشعار واحد.', 'A message to customers'' phones on the app at the time of your offer — one notification.',
     1, 50000, '[{"placement":"push_notification","count":1}]', 'fixed', null, 9, false)
  ) as p(name_ar, name_en, desc_ar, desc_en, days, price, items, model, imp, sort, active)
 where not exists (select 1 from public.ad_packages x where x.name_ar = p.name_ar);

notify pgrst, 'reload schema';
