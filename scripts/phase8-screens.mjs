/**
 * Phase 08 — storefront evidence captures (same protocol as phase-07:
 * viewport{width}, dSF 1, networkidle + fonts.ready, full scroll,
 * clientWidth/scrollWidth assert, @1440 container>=1100).
 * Subjects: blog listing + article, static pages (about/terms/privacy/
 * returns/contact), checkout WITH the delivered map pin (L-20),
 * store print center, admin print center. Fixtures seeded → cleanup →
 * DB pristine.
 * Reproduce: E2E_BASE=http://localhost:<port> node --env-file=.env scripts/phase8-screens.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const OUT = "evidence/phase-08/screens";
const WIDTHS = [390, 768, 1280, 1440];
fs.mkdirSync(OUT, { recursive: true });

const log = [];
let passCount = 0, failCount = 0;
const check = (name, cond, detail = "") => {
  log.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}`);
  if (cond) passCount += 1; else failCount += 1;
};

const signIn = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PWD });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return c;
};

const F = { users: {}, vendors: {}, cats: [], products: [], imgPaths: [], orders: [], posts: [], blogCats: [] };

async function makeUser(role, tag) {
  const email = `p8s-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");

async function main() {
  /* ---------------- fixtures ---------------- */
  await makeUser("admin", "0");
  const admin = await signIn(F.users["admin-0"].email);

  const root = (await admin.from("categories").insert({ slug_ar: `جذر-${STAMP}`, slug_en: `p8s-root-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics", depth: 1, show_in_header: true }).select("id").single()).data;
  const mid = (await admin.from("categories").insert({ parent_id: root.id, slug_ar: `وسط-${STAMP}`, slug_en: `p8s-mid-${STAMP}`, name_ar: "سماعات", name_en: "Audio", depth: 2 }).select("id").single()).data;
  const leaf = (await admin.from("categories").insert({ parent_id: mid.id, slug_ar: `ورقة-${STAMP}`, slug_en: `p8s-leaf-${STAMP}`, name_ar: "لاسلكية", name_en: "Wireless", depth: 3 }).select("id").single()).data;
  F.cats.push(root.id, mid.id, leaf.id);

  await makeUser("vendor", "A");
  const vendor = await signIn(F.users["vendor-A"].email);
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1);
  const on = await vendor.rpc("fn_vendor_onboard", {
    p_data: {
      store_name_ar: `متجر الشاشات ${STAMP}`, store_name_en: `Screen Store ${STAMP}`,
      category_ids: [leaf.id], first_name: "ب", last_name: "ت",
      governorate_id: area[0].governorate_id, area_id: area[0].id, address1: "عنوان المتجر",
      terms_version: "1.0", terms_signature: "P8S",
    },
  });
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on.data.vendor_id, p_decision: "approve" });
  F.vendors.A = { id: on.data.vendor_id, userId: F.users["vendor-A"].id, client: vendor };

  const imgPath = `u/${F.vendors.A.userId}/p8s-${STAMP}.webp`;
  await svc.storage.from("media").upload(imgPath, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
  const p = await vendor.rpc("fn_save_product", {
    p_product: {
      name_ar: "سماعات بلوتوث", name_en: "BT Headphones",
      desc_ar: "سماعات لاسلكية بجودة عالية.", desc_en: "High-quality wireless headphones.",
      leaf_category_id: leaf.id, shipping_mode: "platform",
      media: [{ kind: "image", path: imgPath }],
    },
  });
  await vendor.rpc("fn_generate_variants", { p_product_id: p.data.id, p_axes: [] });
  const { data: variant } = await svc.from("variants").select("id, option_key").eq("product_id", p.data.id).is("deleted_at", null).single();
  await vendor.rpc("fn_save_variants", { p_product_id: p.data.id, p_rows: [{ option_key: variant.option_key, sku: `P8S-${STAMP}`, price_piastres: 89000, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
  await vendor.rpc("fn_submit_product", { p_product_id: p.data.id });
  await admin.rpc("fn_admin_review_product", { p_product_id: p.data.id, p_decision: "approve", p_reason: null });
  F.products.push(p.data.id);
  F.imgPaths.push(imgPath);

  // blog fixture: category + a REAL published article (headings, lists, real copy)
  const { data: bcat } = await admin.from("blog_categories").insert({
    name_ar: "أدلة الشراء", name_en: "Buying guides", slug_ar: `أدلة-الشراء-${STAMP}`, slug_en: `p8s-guides-${STAMP}`,
  }).select("id").single();
  F.blogCats.push(bcat.id);
  const ARTICLE_AR = [
    "<h2>كيف تختار المنتج المناسب؟</h2>",
    "<p>الشراء الذكي لا يبدأ بالسعر، بل بفهم ما تحتاجه فعلاً. قبل أن تفتح صفحة المنتج، اكتب في ورقة الاستخدام اليومي المتوقع: كم مرة ستستخدم الجهاز أسبوعيًا، وفي أي مكان، ومع من. الإجابة على هذه الأسئلة الثلاثة تختصر نصف قرار الشراء.</p>",
    "<p>في سوق متعدد البائعين مثل اتسوء، المنتج نفسه قد يظهر من أكثر من متجر وبسعر مختلف. الفارق الحقيقي غالبًا في الضمان، وسرعة الشحن، وسياسة الاستبدال — وليست الصورة أو السعر وحدهما.</p>",
    "<h3>ثلاث خطوات قبل الضغط على «أضف إلى السلة»</h3>",
    "<ol><li>اقرأ وصف المنتج كاملاً، خصوصًا المقاسات والمواصفات الفنية.</li><li>راجع تقييمات المتجر وعدد الطلبات المكتملة، لا تقييم المنتج فقط.</li><li>تحقق من سياسة الاستبدال والاسترجاع وموعد التوصيل المتوقع لمحافظتك.</li></ol>",
    "<h2>كيف تقارن بين متجرين؟</h2>",
    "<p>استخدم أداة المقارنة في المتجر لعرض المنتجات جنبًا إلى جنب. المقارنة تُظهر السعر النهائي شاملًا الشحن، وهو الرقم الذي يجب أن تبني عليه قرارك — لا سعر الوحدة المعروض في أعلى الصفحة.</p>",
    "<ul><li>السعر النهائي شامل الشحن إلى منطقتك.</li><li>مدة التوصيل المعلنة من كل متجر.</li><li>توفر خدمة الدفع عند الاستلام.</li><li>سياسة الإرجاع ومدة الاستبدال.</li></ul>",
    "<h3>الدفع عند الاستلام: متى يكون الخيار الأفضل؟</h3>",
    "<p>الدفع عند الاستلام مناسب للطلبات الأولى من متجر جديد، أو عندما تكون قيمة الطلب مرتفعة وتريد فحص المنتج قبل السداد. مع تكرار الشراء من متجر تثق به، يصبح الدفع الإلكتروني أسرع ويقلل زمن تجهيز الطلب.</p>",
    "<h2>الأسئلة الشائعة</h2>",
    "<p><strong>هل يمكنني تغيير العنوان بعد الطلب؟</strong> يمكن تعديل العنوان قبل انتقال الطلب إلى مرحلة التجهيز، من صفحة تفاصيل الطلب.</p>",
    "<p><strong>ماذا لو وصل المنتج تالفًا؟</strong> التقط صورة للمنتج والتغليف خلال ٤٨ ساعة من الاستلام، ثم افتح طلب استرجاع من صفحة الطلب — فريق الدعم يتولى الباقي مع البائع.</p>",
    "<p><strong>هل الأسعار تشمل التوصيل؟</strong> السعر المعروض في صفحة المنتج لا يشمل التوصيل؛ رسوم الشحن تُحسب حسب المحافظة وتظهر بوضوح في صفحة إتمام الطلب قبل التأكيد.</p>",
  ].join("");
  const ARTICLE_EN = [
    "<h2>How to choose the right product</h2>",
    "<p>Smart buying starts with understanding what you actually need, not with the price tag. Before opening a product page, write down the expected daily use: how often per week, where, and with whom. Answering those three questions settles half the decision.</p>",
    "<p>In a multi-vendor marketplace like Etsawaa the same product can appear in several stores at different prices. The real difference is usually the warranty, the shipping speed and the returns policy — not the photo or the price alone.</p>",
    "<h3>Three steps before you press “Add to cart”</h3>",
    "<ol><li>Read the full description, especially sizes and technical specifications.</li><li>Check the store rating and its completed orders, not only the product review score.</li><li>Confirm the returns policy and the expected delivery window for your governorate.</li></ol>",
    "<h2>Comparing two stores</h2>",
    "<p>Use the comparison tool to see products side by side. It shows the final price including shipping — the number your decision should be based on, not the headline unit price.</p>",
    "<ul><li>Final price including shipping to your area.</li><li>Advertised delivery time for each store.</li><li>Cash-on-delivery availability.</li><li>Returns policy and exchange window.</li></ul>",
    "<h3>When cash on delivery is the better option</h3>",
    "<p>Cash on delivery suits a first order from a new store, or a high-value order you want to inspect before paying. Once you reorder from a store you trust, online payment is faster and shortens the order preparation time.</p>",
    "<h2>Frequently asked questions</h2>",
    "<p><strong>Can I change the address after ordering?</strong> You can edit it until the order moves to preparation, from the order details page.</p>",
    "<p><strong>What if the item arrives damaged?</strong> Photograph the item and its packaging within 48 hours of delivery, then open a return request from the order page — support handles the rest with the store.</p>",
    "<p><strong>Do prices include delivery?</strong> The product page price excludes delivery; the shipping fee is calculated by governorate and shown clearly at checkout before you confirm.</p>",
  ].join("");
  const { data: post } = await admin.from("blog_posts").insert({
    title_ar: "دليل الشراء الذكي: كيف تختار منتجك من سوق متعدد البائعين",
    title_en: "The smart buying guide: choosing a product on a multi-vendor marketplace",
    slug_ar: `دليل-الشراء-الذكي-${STAMP}`, slug_en: `p8s-smart-buying-guide-${STAMP}`,
    excerpt_ar: "خطوات عملية لمقارنة المتاجر، حساب السعر النهائي شامل الشحن، واختيار طريقة الدفع الأنسب لطلبك الأول.",
    excerpt_en: "Practical steps to compare stores, work out the final price including shipping, and pick the right payment method for a first order.",
    content_ar: ARTICLE_AR, content_en: ARTICLE_EN,
    status: "published", published_at: new Date().toISOString(), category_id: bcat.id,
    author: F.users["admin-0"].id,
  }).select("id, slug_ar").single();
  F.posts.push(post.id);

  // 3 published posts so the listing shows a real grid (not a single card).
  // Each carries a UNIQUE excerpt and body — no placeholder copy anywhere.
  const EXTRAS = [
    {
      ar: "كيف تقرأ تقييمات المتجر قبل الشراء", en: "How to read store reviews before buying",
      xAr: "تقييم المتجر أهم من تقييم المنتج: عدد الطلبات المكتملة يكشف جدية البائع، والتقييمات المكتوبة تكشف أسلوب التعامل عند وجود مشكلة.",
      xEn: "A store's rating matters more than the product's: completed-order volume shows how seriously the seller trades, and written reviews reveal how problems are handled.",
      bAr: "<h2>ما الذي يهم فعلاً</h2><p>رتّب ما تراه في صفحة المتجر: عدد الطلبات المكتملة أولًا، ثم متوسط التقييم، ثم التقييمات المكتوبة التي تذكر مشكلة وحلّها.</p><h2>علامات تحذير</h2><p>متجر بلا طلبات مكتملة مع تقييم عالٍ يستحق الحذر، وكذلك التقييمات القصيرة جدًا والمتشابهة في الصياغة.</p>",
      bEn: "<h2>What actually matters</h2><p>Order what you see on a store page: completed orders first, then the average rating, then the written reviews that describe a problem and its resolution.</p><h2>Warning signs</h2><p>A store with no completed orders but a high rating deserves caution, as do very short reviews that share the same phrasing.</p>",
    },
    {
      ar: "التوصيل إلى المحافظات: ما تتوقعه فعلًا", en: "Delivery to the governorates: what to expect",
      xAr: "مدة التوصيل المعروضة تقديرية وتتحرك بتغيّر المحافظة والمتجر: القاهرة والجيزة أسرع، والدلتا في المنتصف، والصعيد والمناطق النائية أطول.",
      xEn: "The delivery estimate you see is indicative and shifts with governorate and store: Cairo and Giza are fastest, the Delta sits in the middle, and Upper Egypt and remote areas take longest.",
      bAr: "<h2>لماذا تختلف المدة</h2><p>كل متجر يجهّز طلبه بنفسه قبل تسليمه للناقل؛ فمتجر في القاهرة قد يسلّم في اليوم التالي، بينما متجر في أسوان يحتاج يومين للتجهيز قبل الشحن.</p><h2>كيف تقرأ الموعد</h2><p>الموعد المعروض في صفحة الطلب يشمل التجهيز والشحن معًا، ولا يُحسب من ساعة الدفع بل من لحظة تأكيد المتجر للطلب.</p>",
      bEn: "<h2>Why the window varies</h2><p>Each store prepares its own order before handing it to the carrier; a Cairo store may hand over the next day, while an Aswan store needs two days to prepare before shipping.</p><h2>How to read the date</h2><p>The date on the order page covers preparation and shipping together, counted from the store's confirmation — not from the payment moment.</p>",
    },
    {
      ar: "الدفع عند الاستلام أم إلكتروني؟ مقارنة عملية", en: "Cash on delivery or online payment? A practical comparison",
      xAr: "الدفع عند الاستلام يمنحك فحص المنتج قبل السداد مقابل تجهيز أبطأ، والدفع الإلكتروني يسرّع الطلب لكنه يتطلب ثقة مسبقة في المتجر.",
      xEn: "Cash on delivery lets you inspect the item before paying but slows preparation; online payment speeds the order up but asks for prior trust in the store.",
      bAr: "<h2>الفرق في الزمن</h2><p>الطلب المدفوع إلكترونيًا ينتقل مباشرة للتجهيز، بينما طلب الدفع عند الاستلام ينتظر تأكيدًا هاتفيًا قبل الشحن.</p><h2>متى تختار أيّهما</h2><p>الطلب الأول من متجر جديد يفضّل الدفع عند الاستلام؛ وبعد تجربة ناجحة، الدفع الإلكتروني يوفّر يومًا على الأقل.</p>",
      bEn: "<h2>The difference in time</h2><p>A paid order moves straight to preparation, while a cash-on-delivery order waits for a phone confirmation before shipping.</p><h2>Choosing between them</h2><p>A first order from a new store favours cash on delivery; after one good experience, online payment saves at least a day.</p>",
    },
  ];
  for (const [i, x] of EXTRAS.entries()) {
    const extra = await admin.from("blog_posts").insert({
      title_ar: x.ar, title_en: x.en,
      slug_ar: `مقال-${i + 1}-${STAMP}`, slug_en: `p8s-post-${i + 1}-${STAMP}`,
      excerpt_ar: x.xAr, excerpt_en: x.xEn,
      content_ar: x.bAr, content_en: x.bEn,
      status: "published", published_at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      category_id: bcat.id, author: F.users["admin-0"].id,
    }).select("id").single();
    F.posts.push(extra.data.id);
  }

  // two more vendors so the print center shows the 3-vendor job (1+1+1)
  for (const tag of ["B", "C"]) {
    await makeUser("vendor", tag);
    const vc = await signIn(F.users[`vendor-${tag}`].email);
    const on2 = await vc.rpc("fn_vendor_onboard", {
      p_data: {
        store_name_ar: `متجر ${tag} ${STAMP}`, store_name_en: `Store ${tag} ${STAMP}`,
        category_ids: [leaf.id], first_name: "ب", last_name: "ت",
        governorate_id: area[0].governorate_id, area_id: area[0].id, address1: "عنوان المتجر",
        terms_version: "1.0", terms_signature: "P8S",
      },
    });
    await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on2.data.vendor_id, p_decision: "approve" });
    F.vendors[tag] = { id: on2.data.vendor_id, userId: F.users[`vendor-${tag}`].id, client: vc };
    const ip = `u/${F.vendors[tag].userId}/p8s-${STAMP}-${tag}.webp`;
    await svc.storage.from("media").upload(ip, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
    const pr = await vc.rpc("fn_save_product", {
      p_product: {
        name_ar: `منتج ${tag}`, name_en: `Item ${tag}`,
        desc_ar: "منتج للمعاينة.", desc_en: "A preview item.",
        leaf_category_id: leaf.id, shipping_mode: "platform",
        media: [{ kind: "image", path: ip }],
      },
    });
    await vc.rpc("fn_generate_variants", { p_product_id: pr.data.id, p_axes: [] });
    const { data: vr } = await svc.from("variants").select("id, option_key").eq("product_id", pr.data.id).is("deleted_at", null).single();
    await vc.rpc("fn_save_variants", { p_product_id: pr.data.id, p_rows: [{ option_key: vr.option_key, sku: `P8S-${tag}-${STAMP}`, price_piastres: 45000, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
    await vc.rpc("fn_submit_product", { p_product_id: pr.data.id });
    await admin.rpc("fn_admin_review_product", { p_product_id: pr.data.id, p_decision: "approve", p_reason: null });
    F.products.push(pr.data.id);
    F.imgPaths.push(ip);
    F.extraVariants = F.extraVariants ?? [];
    F.extraVariants.push(vr.id);
  }

  // customer + order with pin (for checkout map + print center)
  await makeUser("customer", "0");
  const customer = await signIn(F.users["customer-0"].email);
  const { data: areas } = await svc.from("areas").select("id").eq("governorate_id", 1).order("id");
  const { data: addr, error: addrErr } = await customer.from("user_addresses").insert({
    user_id: F.users["customer-0"].id, label: "المنزل", full_name: "عميل الشاشات",
    phone: `+2010${String(STAMP).slice(-8)}`, governorate_id: 1, area_id: areas[2].id,
    address1: "١٥ شارع التحرير", is_default: true,
  }).select("id").single();
  if (addrErr || !addr?.id) throw new Error(`address: ${addrErr?.message}`);
  // 3 vendors in ONE order so the print center shows the 1+1+1 job
  await customer.rpc("fn_cart_add", { p_variant_id: variant.id, p_qty: 1 });
  for (const vId of F.extraVariants ?? []) await customer.rpc("fn_cart_add", { p_variant_id: vId, p_qty: 1 });
  const o = await customer.rpc("fn_create_order", {
    p_payload: {
      attempt_key: crypto.randomUUID(), payment_method: "cod", coupon_code: null,
      address: {
        full_name: "عميل الشاشات", phone_primary: "+201001234567", phone_alternate: "+201109876543",
        governorate_id: 1, area_id: areas[2].id, address1: "١٥ شارع التحرير",
        lat: 30.0444, lng: 31.2357, geo_accuracy: 25,
      },
    },
  });
  if (!o.data?.ok) throw new Error(`order: ${JSON.stringify(o.data)}`);
  F.orders.push(o.data.number);
  const { data: ordRow } = await svc.from("orders").select("id").eq("number", o.data.number).single();

  /* ---------------- captures ---------------- */
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const login = async (email) => {
    await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle", timeout: 60000 });
    await page.fill("input[name=identifier]", email);
    await page.fill("input[name=password]", PWD);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => !window.location.pathname.includes("/auth"), { timeout: 30000 }).catch(() => undefined);
  };

  async function shoot(url, name, widths = WIDTHS, { pre } = {}) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const step = () => { y += 600; window.scrollTo(0, y); if (y < document.documentElement.scrollHeight) setTimeout(step, 50); else resolve(); };
          step();
        });
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      if (pre) await pre(page);
      const a1 = await page.evaluate(() => document.documentElement.clientWidth);
      const a2 = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`${name}-${width}`, a1 === width && a2 === a1, `client=${a1} scroll=${a2}`);
      if (width === 1440) {
        const cw = await page.evaluate(() => {
          const el = document.querySelector("main") ?? document.body;
          return el.getBoundingClientRect().width;
        });
        check(`${name}-1440-container`, cw >= 1100, `main=${Math.round(cw)}`);
      }
      await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
    }
  }

  /* blog (L-01/L-02) */
  await shoot(`${BASE}/ar/blog`, "blog-list");
  await shoot(`${BASE}/ar/blog/${encodeURIComponent(post.slug_ar)}`, "blog-article");
  await shoot(`${BASE}/en/blog/${encodeURIComponent(`p8s-smart-buying-guide-${STAMP}`)}`, "blog-article-en");

  /* U1/U2 — no placeholder excerpts, no empty media slots, at EVERY width */
  {
    // strings that must NEVER render anywhere (kept here purely as an
    // assertion blocklist — these are not data and are never inserted)
    const PLACEHOLDERS = [
      "ملخص قصير يشرح الفكرة الأساسية للمقال في سطرين.",
      "A short summary explaining the core idea in two lines.",
      "نص أول", "نص ثانٍ", "نص ثالث",
      "Text one", "Text two", "Text three",
    ];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const pages = {
        list: `${BASE}/ar/blog`,
        article: `${BASE}/ar/blog/${encodeURIComponent(post.slug_ar)}`,
        "list-en": `${BASE}/en/blog`,
      };
      for (const [label, url] of Object.entries(pages)) {
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
        const html = await page.content();
        const hit = PLACEHOLDERS.find((p) => html.includes(p));
        check(`U1 no placeholder excerpt (${label}@${width})`, !hit, hit ? `found: ${hit.slice(0, 40)}` : "clean");
        // every media slot must be either a real image or the branded cover
        const slots = await page.evaluate(() => {
          const cards = [...document.querySelectorAll("ul > li, article")];
          let empty = 0;
          for (const c of cards) {
            const hasImg = c.querySelector("img");
            const hasCover = c.querySelector("[data-fallback-cover]");
            // only count slots that actually reserved media space
            const reserved = c.querySelector('[class*="aspect-"], [class*="aspect"]');
            if (reserved && !hasImg && !hasCover) empty += 1;
          }
          return { empty, covers: document.querySelectorAll("[data-fallback-cover]").length };
        });
        check(`U2 no blank media slot (${label}@${width})`, slots.empty === 0, `blank=${slots.empty} branded-covers=${slots.covers}`);
      }
    }
  }

  /* U3 — About card is constrained and carries a CTA */
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/ar/p/about`, { waitUntil: "networkidle", timeout: 60000 });
    const info = await page.evaluate(() => {
      const card = document.querySelector("article");
      const cta = [...document.querySelectorAll("article a")].find((a) => a.getAttribute("href")?.includes("/contact"));
      const r = card?.getBoundingClientRect();
      return { w: Math.round(r?.width ?? 0), cta: Boolean(cta), cardW: Math.round(card?.clientWidth ?? 0) };
    });
    check(`U3 about card constrained + CTA @${width}`, info.w <= 940 && info.cta, `card=${info.w}px cta=${info.cta}`);
  }

  /* U4 — mobile TOC is a <details>, desktop keeps the sticky rail */
  {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${BASE}/ar/blog/${encodeURIComponent(post.slug_ar)}`, { waitUntil: "networkidle", timeout: 60000 });
    const m = await page.evaluate(() => {
      const d = document.querySelector("details");
      const visual = [...document.querySelectorAll("nav[aria-label]")].filter((n) => n.getBoundingClientRect().height > 0).length;
      return { details: Boolean(d), open: d?.hasAttribute("open") ?? null, visibleNavs: visual };
    });
    check("U4 mobile TOC collapsed in <details> @390", m.details && m.open === false, JSON.stringify(m));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/ar/blog/${encodeURIComponent(post.slug_ar)}`, { waitUntil: "networkidle", timeout: 60000 });
    const d = await page.evaluate(() => {
      const aside = document.querySelector("aside nav");
      const cs = aside ? getComputedStyle(aside) : null;
      return { asideNav: Boolean(aside), position: cs?.position ?? "none" };
    });
    check("U4 desktop TOC sticky rail @1280", d.asideNav && d.position === "sticky", JSON.stringify(d));
  }

  /* static pages (L-03) */
  for (const s of ["about", "terms", "privacy", "returns"]) {
    await shoot(`${BASE}/ar/p/${s}`, `static-${s}`);
  }
  await shoot(`${BASE}/ar/contact`, "static-contact");

  /* checkout with map pin (L-20) — customer session, new-address accordion open */
  await login(F.users["customer-0"].email);
  await shoot(`${BASE}/ar/checkout`, "checkout-map", WIDTHS, {
    pre: async (pg) => {
      await pg.evaluate(() => {
        const btns = [...document.querySelectorAll("button, [role=button], input[type=radio], label")];
        const target = btns.find((b) => /عنوان جديد|new address|new/i.test(b.textContent ?? ""));
        if (target) (target.closest("button") ?? target).click();
      });
      await pg.waitForSelector(".leaflet-container", { timeout: 20000 }).catch(() => undefined);
      // wait for the first tile to paint so the capture never shows an empty box
      await pg.waitForFunction(() => document.querySelectorAll(".leaflet-tile-loaded").length >= 4, { timeout: 20000 }).catch(() => undefined);
      // put a pin on the map (same journey the customer takes) and screenshot it set
      await pg.evaluate(() => {
        const el = document.querySelector(".leaflet-container");
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      });
      await pg.waitForTimeout(900);
      check(`checkout-map-pin-set-${await pg.evaluate(() => innerWidth)}`,
        await pg.evaluate(() => Boolean(document.querySelector(".leaflet-marker-icon"))), "pin visible on map");
    },
  });

  /* store print center + admin print center (3-vendor order with pin ⇒ carrier QR) */
  await login(F.users["vendor-A"].email);
  await shoot(`${BASE}/ar/vendor/orders`, "vendor-print-center");
  await login(F.users["admin-0"].email);
  await shoot(`${BASE}/ar/admin/orders/${encodeURIComponent(o.data.number)}`, "admin-order-print-center");

  await page.close();
  await ctx.close();
  await browser.close();
}

main()
  .catch((error) => {
    console.error("SCREENS ERROR:", error.message, String(error.stack ?? "").split("\n").slice(1, 4).join(" | "));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const nil = "00000000-0000-0000-0000-000000000000";
      await svc.from("order_documents").delete().neq("id", nil);
      await svc.from("order_notes").delete().neq("id", nil);
      await svc.from("order_status_history").delete().neq("id", nil);
      await svc.from("order_items").delete().neq("id", nil);
      await svc.from("order_vendor_groups").delete().neq("id", nil);
      await svc.from("payments").delete().neq("id", nil);
      await svc.from("order_sequences").delete().gt("year", 0);
      await svc.from("orders").delete().neq("id", nil);
      await svc.from("cart_items").delete().neq("id", nil);
      await svc.from("user_addresses").delete().eq("user_id", F.users["customer-0"]?.id ?? nil);
      await svc.from("blog_posts").delete().in("id", F.posts.length ? F.posts : [nil]);
      await svc.from("blog_categories").delete().in("id", F.blogCats.length ? F.blogCats : [nil]);
      await svc.from("audit_logs").delete().neq("id", 0);
      await svc.from("email_logs").delete().neq("id", nil);
      if (F.imgPaths.length) await svc.storage.from("media").remove(F.imgPaths);
      for (const pid of F.products) await svc.from("products").delete().eq("id", pid);
      for (const v of Object.values(F.vendors)) await svc.from("vendors").delete().eq("id", v.id);
      for (let i = F.cats.length - 1; i >= 0; i -= 1) await svc.from("categories").delete().eq("id", F.cats[i]);
      for (const u of Object.values(F.users)) await svc.auth.admin.deleteUser(u.id);
      await svc.from("notifications").delete().neq("id", nil);
      const counts = {};
      for (const t of ["orders", "products", "categories", "vendors", "cart_items", "blog_posts", "blog_categories", "user_addresses"]) {
        const { count } = await svc.from(t).select("*", { count: "exact", head: true });
        counts[t] = count;
      }
      const pristine = Object.values(counts).every((c) => c === 0);
      console.log("pristine:", pristine, JSON.stringify(counts));
      fs.mkdirSync("evidence/phase-08", { recursive: true });
      fs.writeFileSync("evidence/phase-08/screens-results.json", JSON.stringify({ at: new Date().toISOString(), log, passCount, failCount, pristine }, null, 1) + "\n");
    } catch (e) {
      console.error("CLEANUP ERROR:", e.message);
      process.exitCode = 1;
    }
  });
