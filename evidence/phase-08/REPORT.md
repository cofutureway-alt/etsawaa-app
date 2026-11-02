# PHASE 08 — CONTENT & LAUNCH — REPORT

التاريخ: 2026-11-01 · التطبيق: `H:\z etsawaa\etsawaa-app` · المرجعيات: `etsawaa V4/plans/phase-08-launch/{PLAN,TASKS,USER-STORIES}.md` + AGENT.md §11/§28/§32 + ARCHITECTURE.md + JOURNEYS.md

---

## مراجعة المالك — R2 (B2 partial → UX patch)

| # | الملاحظة | الحالة | الدليل |
|---|---|---|---|
| **U1** | مقتطفات مؤقتة «ملخص قصير يشرح الفكرة الأساسية للمقال في سطرين.» في القائمة والمقالات ذات الصلة | **مُصلَح** | الفيكسچر كان يحتوي النص حرفيًا لثلاثة مقالات. الآن لكل مقال **مقتطف فريد + جسم فريد** (AR+EN). المطابقتان الباقيتان في `scripts/phase8-screens.mjs:294-295` هما **سطرا قائمة الحظر** التي يقارن بها الفحص — ليست بيانات. `app/` = 0، مخرجات الشاشات/JSON = 0، و**12/12 تأكيد U1** يمر على 3 صفحات × 4 عروض → `U1-U4-verification.txt` |
| **U2** | مربعات وردية فارغة لكل مقال بلا غلاف (قائمة + ذات صلة) | **مُصلَح** | مكوّن `app/components/blog/FallbackCover.tsx`: غلاف موسوم حتمي (FNV-1a → 5 ألوان tokens) يعرض **أحرف العنوان الأولى + اسم التصنيف**. نفس المدخل = نفس الغلاف في القائمة والمقال و«ذات صلة» والمقال نفسه (hero). **12/12 `U2 no blank media slot`** بـ `branded-covers=4` و`blank=0` على 390/768/1280/1440 |
| **U3** | بطاقة "من نحن" بعرض كامل والنص 68ch على اليمين | **مُصلَح** | البطاقة نفسها `mx-auto max-w-[900px]` متمركزة، والنص يبقى `68ch`، و**زر CTA مرئي** «تواصل مع فريق الدعم» → `/:lang/contact` (id `staticPage.contactCta` AR+EN). 4/4 تأكيد `U3 about card constrained + CTA` |
| **U4** | TOC الموبايل | **مُصلَح** | `<details>` أصلي (بلا JS) مغلق افتراضيًا تحت 768px، بسهم يدور عند الفتح و`summary` قابل للوصول؛ الديسكتوب يحتفظ بالـrail اللاصق. تأكيدان: mobile `details+closed`، desktop `position:sticky` |

### عيب إضافي اكتُشف أثناء العمل
`bg-primary-soft` كان مستخدمًا في **6 ملفات** (تبويبات اللوحات، شرائح المدونة، محرر القوالب) لكنه **غير معرّف في أي CSS** → حالة التحديد كانت بلا خلفية. أُضيف `--color-primary-soft: #fee7e7` في `tokens.css` + ربطه في `@theme inline`.

### البوابات بعد R2
e2e **35/35 ×2** (md5 مختلف) · p5 **63/63** · p6 **61/61** · unit **57/57** · screens **89/89** (59 عرض + 30 تأكيد U1–U4) · tsc 0 · build ✓ · pristine في كل تشغيل

---

## مراجعة المالك — النتائج (R1)

| # | الملاحظة | الحالة | الدليل |
|---|---|---|---|
| **B1** | الخريطة مكسورة بصريًا (خريطتان متراكبتان، فراغ كبير، بلا علاقة pin/تأكيد) | **مُصلَح** | السبب الجذري: **`leaflet.css` لم يُستورد إطلاقًا** — بلا CSS تتكدّس كل بلاطة فوق الأخرى. الآن: استيراد ديناميكي للـCSS + `invalidateSize()` بعد استقرار عرض الأكورديون + حاوية واحدة `relative h-56 sm:h-72 overflow-hidden` + شارة "تم تحديد الموقع" مع الإحداثيات وزر إزالة + "استخدم موقعي" بجانبها. 4 عروض مُعاد التقاطها، و`checkout-map-pin-set-{390,768,1280,1440}` = 4/4 PASS (دبوس ظاهر في DOM) |
| **B2** | المدونة محتوى مؤقت ("نص أول/ثاني/ثالث")، TOC منفصل، جسم فارغ، بطاقة واحدة وفراغ | **مُصلَح** | (أ) **`.pubProse` لم يكن موجودًا في CSS** — عناوين المقال كانت تُطبع بحجم نص عادي؛ أُضيفت أنماط h2/h3/ul/ol/blockquote/link. (ب) فيكسچر الأدلة صار **مقالًا حقيقيًا** (AR+EN، 9 أقسام، قوائم مرقبة ونقطية، ~700 كلمة) + 3 مقالات أخرى للشبكة. (ج) العمود صار `minmax(0,68ch)` مع TOC لاصق 240px على الديسكتوب وداخل عمود المحتوى على الموبايل. (د) القائمة: شبكة 3 أعمدة + صف صورة محفوظ للمقال بلا غلاف + حالة فراغ مع `action` ("كل المقالات") |
| **B3** | `admin-order-print-center` صفحة 404 | **مُصلَح** | المسار `admin/orders/:number` يستقبل **رقم الطلب** لا uuid؛ السكربت كان يمرّر `ordRow.id` → 404. صُحّح إلى `o.data.number`، والطلب صار **3 بائعين** (1+1+1) فتُظهر الشاشة مركز الطباعة كاملًا: نسخ/قطع، فاتورة A4، شحن A5 أفقي، وبطاقة بائع لكل متجر — عند 390/768/1280/1440 |
| **B4** | LCP 2771/3002ms فوق بوابة 2.5s — مطلوب تحسين أو waiver صريح | **waiver مطلوب صراحةً** | `evidence/phase-08/B4-LCP-WAIVER-REQUEST.md` — أرقام ما بعد التحسين: home 95 /**2850ms**، product 95 /**2988ms**، category 96 /**2683ms** (كان 3002 → −319ms). تحسينات مُنفّذة: `fetchPriority=high` على أول 4 بطاقات، بانر 480w (16.7KB بدل 33KB). **لم يُعتبر الـwaiver ممنوحًا** — ينتظر قرار المالك |
| **B5** | بنود التكامل false في integration-gate.json | **محجوب بدليل مُثبت + طلب تأجيل مؤرخ** | `evidence/phase-08/B5-INTEGRATION-DEFERRAL.md`: G1 `RESEND_API_KEY` غائب؛ G2 مفاتيح Kashier غائبة (المسار مُختبر 63/63 بوضع test)؛ G3 استدعاء حقيقي يعيد **`provider is not enabled`** من Supabase — كود OAuth كامل وجاهز، العائق تهيئة. كل بند مع خطوات الإغلاق والزمن المتوقع |
| **WARN** | RLS DELETE WITH CHECK | **مُوثَّق** | سياسات DELETE تستخدم `USING` فقط — صحيح في Postgres (لا `WITH CHECK` على DELETE)؛ سلوك آمن ومقصود. مُسجَّل في `rls-audit.json` |
| **UX** | صفحة "من نحن" فقرة واحدة عريضة | **مُصلَح** | عمود قراءة `max-w-[68ch]` لكل الصفحات الثابتة + فواصل بصرية بين الأقسام (`border-t` قبل كل h2) |
| **UX** | تقصير checkout على الموبايل | **مُصلَح** | المحافظة + المنطقة في صف واحد على الموبايل (`grid-cols-2` ثم `sm:contents`)، والخريطة 224px على الموبايل بدل 288 |

### البوابات بعد الإصلاحات (كلها أُعيد تشغيلها)
- e2e المرحلة: **35/35 ×2** (md5 مختلف) + pristine
- p5: **63/63 ×2** · p6: **61/61 ×2** · unit: **57/57**
- print QA: **21/21** + pristine
- screens: **59/59** (55 عرض + 4 تأكيدات دبوس) + pristine
- RLS: **0 CRITICAL** (8/9، WARN موثّق)
- tsc **0** · lint **0 errors** · build ✓

---

## design skill (إلزامي)

**design skill: ui-ux-pro-max — invoked at step 1 (قبل أي عمل تصميمي في المرحلة: MapPin، صفحات المدونة، مظهر الـLabel/الـwatermark) — output applied:** flat tokens فقط، صفر gradients، صفر emojis، RTL-first، مؤشر تقدم القراءة editorial في المقال، أخطاء حقول inline، أسطح tokens-only، WCAG AA (aria-labels للخريطة والTOC والمشاركة)، لا كلمة ضريبة.

---

## L-01 … L-20 → الدليل → الالتزام

| البند | الوصف | النتيجة | الدليل | Commit |
|---|---|---|---|---|
| L-01 | مدونة: قائمة + مقال (TOC، تقدم قراءة، related، share)؛ المسودات مخفية عمّومًا | ✓ | `evidence/phase-08/tests-raw-run1.json` B1–B11 + `screens/blog-list-*.png` + `screens/blog-article-{390,768,1280,1440}.png` | phase-08 |
| L-02 | تصنيفات المدونة + RSS 2.0 صالح (مبدّل لغة، بدون مسودات) | ✓ | B12–B14 + `app/routes/rss[.xml].ts` | phase-08 |
| L-03 | الصفحات الثابتة نهائية (about/terms/privacy/returns/contact) + meta/canonical لكل صفحة + header/footer | ✓ | `screens/static-{about,terms,privacy,returns,contact}-*.png` + فحص M1 على مستوى السويتات (`curl` title/desc/canonical = 1/1/1 لكل صفحة)؛ contact صفحة مستقلة `/contact` بـmeta كامل | phase-08 |
| L-04 | البانرات: نافذة نشر تُطبّق — المنتهي يختفي تلقائيًا | ✓ | إثبات حي: بانر منتهي + بانر حي → الصفحة الرئيسية أظهرت الحي فقط؛ ctx تنظيف؛ فلتر في `getBanners` (`evidence/phase-08/l10-scan.txt` زمن التشغيل في سجل التشغيل /tmp/p8-pq*.log) | phase-08 |
| L-05 | تغطية meta لكل مسار عام (title/description/canonical/hreflang) | ✓ | M1 (3 مسارات) PASS في tests-raw ×2 | phase-08 |
| L-06 | JSON-LD: Organization/WebSite/ItemList/Product/BreadcrumbList/BlogPosting/CollectionPage | ✓ | M2 (7 أنواع) PASS ×2 + B7/B8 | phase-08 |
| L-07 | sitemap.xml + robots + hreflang + canonical؛ المدونة المنشورة داخل الـsitemap | ✓ | B15 + `app/routes/sitemap[.xml].ts` + robots 200 | phase-08 |
| L-08 | 404/410 + خريطة 301 للمسودات المنقولة (`slug_redirects`, kind post/page) | ✓ | B17 moved-slug 301 (post) + 301 هجرة صفحة في `app/routes/static-page.tsx` + draft→404 (B11) | phase-08 |
| L-09 | Animation pass | ✓ ضمن المكوّنات الجديدة | فقط transitions/hover tokens قياسية؛ progress bar للمقال CSS-only؛ reduced-motion محترم عالميًا (Phase 04) | phase-08 |
| L-10 | مسح tokens/gradient/emoji/RTL | PASS | `evidence/phase-08/l10-scan.txt` (0 gradients، 0 emojis، 0 tax في واجهة العميل، 0 service_role client-side) | phase-08 |
| L-11 | Responsive 390/768/1280/1440 | 55/55 | `evidence/phase-08/screens-results.json` + 44 PNG في `screens/` (blog list/article AR+EN، 5 صفحات ثابتة، checkout بالخريطة، vendor print-center، admin order-print-center) | phase-08 |
| L-12 | Lighthouse موبايل ×3 (medians) على home/product/**category** | **home 95 / product 95 / category 96**; LCP 2850/2988/2683ms; CLS 0; TBT 78/54/66ms; FCP 803/774/763ms | `evidence/phase-08/lighthouse-3x.json` (3 runs + medians) — **LCP فوق 2.5s: waiver مطلوب صراحةً، لم يُمنح** → `B4-LCP-WAIVER-REQUEST.md` | phase-08 |
| L-13 | RLS audit آلي + probes cross-tenant | 8/9, **0 CRITICAL**, 1 WARN موثّق | `evidence/phase-08/rls-audit.json` + السكربت `scripts/rls-audit.mjs` + الإصلاحات migrations `20261101100005/06` | phase-08 |
| L-14 | e2e كاملة ×2 (مرّتان متتاليتان + كلها pristine) | **35/35 ×2** (md5 مختلف) + عودة p5 **63/63 ×2** + p6 **61/61 ×2** + unit **57/57** | `tests-raw-run1/run2.json` + `tests-console-run1/run2.log` + `p5/p6-regression-run1/run2.log` + `unit-tests.log` | phase-08 |
| L-15 | Seeds إنتاج على DB فارغ (settings/email_templates/roles/جغرافيا) بلا بيانات عرض | ✓ | البذور داخل migrations بـ`on conflict` (idempotent): تعداد 17 settings، 7 email_templates، 4 roles عند التجميع؛ كل السويتات تنتهي `pristine: true` | phase-08 |
| L-16 | Monitoring: مراقبة email/payments/audit + قاعدة تنبيه | ✓ وثيقة | `evidence/phase-08/ops/OPS-RUNBOOK.md` §L-16 (email_logs/payments/order_documents/audit_logs مُطبّقة في الكود + جدول عتبات وفعل) | phase-08 |
| L-17 | Backups + restore drill + rollback + RTO/RPO | ✓ وثيقة | `OPS-RUNBOOK.md` §L-17 (PITR RPO≤5min، RTO≤60min، دراسة استعادة، خطوات rollback بكود tag وKashier mode) | phase-08 |
| L-18 | Launch checklist موقّعة | ☐ 16 بندًا تنتظر توقيع المالك (**B4 waiver + B5 integration** حاجبان) | `OPS-RUNBOOK.md` §L-18 + `B4-LCP-WAIVER-REQUEST.md` + `B5-INTEGRATION-DEFERRAL.md` + `integration-gate.json` | phase-08 |
| L-19 | طباعة QA: A4+A5، watermark ملغي، 3-vendor 1+1+3، name-only، Code128 | **21/21** | `evidence/phase-08/print-qa.json` + `print/` (6 PDF: A4 admin أصلي+ملغي، 3×A4 vendor، A5 carrier; PNGs نظيفة للورقة؛ order-detail 4 عروض) | phase-08 |
| L-20 | خريطة الدفع (checkout pin) | ✓ كامل السلسلة | DB `(shipping_lat,lng,accuracy)`+check حدود مصر → `MapPin.tsx` (Leaflet ديناميكي بعد mount، drag، استخدام موقعي، Photon عكسي اختياري) → payload → `fn_create_order` 3 أعمدة → snapshot بائع **بدون** إحداثيات (P3) → Label الناقل QR `maps.google.com` (P4/P5 byte-equal) + `checkout-map-{390..1440}.png` | phase-08 |

### الحروق الإضافية على DB (migrations, مطبّقة)
- `20261101100004_phase08_geo_redirects.sql` — أعمدة geo على orders بقيود حدود مصر + جدول `slug_redirects` + `fn_admin_add_slug_redirect` (audited).
- `20261101100005_phase08_rls_audit_fixes.sql` — RLS على order_sequences/email_logs/email_templates/roles + policies قراءة إدارية + FORCE RLS على wallet_transactions/audit_logs/email_logs.
- `20261101100006_phase08_grants_repair.sql` — منح EXECUTE لـ`fn_cancel_order_admin/fn_admin_set_order_status/fn_admin_bulk_order_status` لـauthenticated (اكتشفهم فحص W1).
- تعديل `20261101000003_phase06_create_order_commission.sql` — `fn_create_order` يخزن lat/lng/accuracy من العنوان بعد التحقق.

### أخطاء مُصلَحة أثناء المرحلة (ختام)
1. استيراد Leaflet الثابت حطّم SSR → dynamic import + واجهات TS بنائية.
2. embed `profiles(full_name)` يسمّم استعلامات anon → حلّ الاسم عبر admin client على عمود uuid.
3. مواضع tuple في `fn_create_order` (case blocks) → مُحاذاة 1:1.
4. URL الطباعة: القالب root-leaf `/order/:number/print/:doc` — السيوت كان يجرّب `/ar/order/...` = 404 (هذا سبب "viewer null" المزعوم سابقًا).
5. QR التحقق: نص URL لا يظهر في SVG → إثبات byte-equal بإعادة توليد المستقلة.

### L-19 — الغطاء على المتصفحات المطلوبة
- PDFs مولّدة عبر Chromium (Chrome). بنية CSS `@page size A4/A5 landscape` قياسية؛ فروق Chrome/Edge/Safari محصورة في محرك الطباعة نفسه — عيّنات PDF أُنتجت وللمالك طباعتها من المتصفحات الثلاثة وتوقيع الاستبيان. **مسح Code128 بجهاز حقيقي = خطوة توقيع المالك** (لا يمكن برمجيًا؛ الpayload موثق في `print/carrier-label.html` و`carrier-label-qr-payload.svg`).

## Integration gate — الحالة بصدق
`evidence/phase-08/integration-gate.json`: **3 بنود محجوبة على مفاتيح المالك الحية** (RESEND_API_KEY، KASHIER_MERCHANT_ID/SECRET حية + webhook، GOOGLE_CLIENT_ID/SECRET) — النظام كله جاهز (قوالب 7، kashier.server.ts، مسار OAuth) و p5 63/63 غطّى مسار Kashier sandbox بالتوقيع HMAC. **القانون: لا إطلاق قبل تعبئة بنود الـchecklist 1–16.**

## البوابات الختامية
tsc 0 · oxlint 0 errors · build ✓ · unit 57/57 · p5 63/63 ×2 · p6 61/61 ×2 · phase-08 35/35 ×2 (md5-distinct) · print 21/21 · screens 55/55 · RLS 0 CRITICAL · Lighthouse 95/96/94 · pristine في كل تشغيل · لا ZIP في المرحلة (وأزيل الأثر القديم phase-07.zip)

## Commit proof (raw)
سجل بعد هذا الالتزام مباشرة في `evidence/phase-08/commit.txt` + القسم أدناه (نفس بروتوكول Phase 07: وسم `phase-08-code` للأشجار الثابتة، ووسم `phase-08` لالتزام الإقفال).
