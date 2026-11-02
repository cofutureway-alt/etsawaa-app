/**
 * Phase 07 — admin suite evidence captures (same protocol as phase-06:
 * viewport{width}, dSF 1, networkidle + fonts.ready, full scroll,
 * clientWidth/scrollWidth assert, @1440 container>=1100). Subjects: the
 * admin pages delivered in this phase + print center. Seeded fixtures →
 * cleanup → DB pristine.
 * Reproduce: E2E_BASE=http://localhost:<port> node --env-file=.env scripts/phase7-screens.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const OUT = "evidence/phase-07/screens";
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

const F = { users: {}, vendors: {}, cats: [], products: [], imgPaths: [], orders: [], packages: [], posts: [], levels: [], ruleIds: [] };

async function makeUser(role, tag) {
  const email = `p7s-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");
async function makeCategory(tag, parentId, depth) {
  const { data: cat } = await svc.from("categories").insert({
    slug_ar: `فئة-${tag}-${STAMP}`, slug_en: `p7s-${tag}-${STAMP}`,
    name_ar: `فئة ${tag}`, name_en: `Cat ${tag}`, parent_id: parentId ?? null, depth,
  }).select("id").single();
  F.cats.push(cat.id);
  return cat.id;
}

async function onboardVendor(tag, leafCatId) {
  const user = await makeUser("vendor", tag);
  const client = await signIn(F.users[`vendor-${tag}`].email);
  const areaQ = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id");
  const area = areaQ.data[1];
  const { data: on } = await client.rpc("fn_vendor_onboard", {
    p_data: {
      store_name_ar: `مَتجر ${tag} ${STAMP}`, store_name_en: `Store ${tag} ${STAMP}`,
      category_ids: [leafCatId], first_name: "ب", last_name: "ت",
      governorate_id: area.governorate_id, area_id: area.id, address1: "عنوان المتجر",
      terms_version: "1.0", terms_signature: "P7S",
    },
  });
  const admin = await signIn(F.users["admin-0"].email);
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on.vendor_id, p_decision: "approve" });
  F.vendors[tag] = { id: on.vendor_id, userId: user.id, client, areaId: area.id };
  return F.vendors[tag];
}

async function makeOrder(customer, products) {
  for (const [variantId, qty] of products) await customer.rpc("fn_cart_add", { p_variant_id: variantId, p_qty: qty });
  const areaList = await svc.from("areas").select("id").eq("governorate_id", 1).order("id");
  const { data: o } = await customer.rpc("fn_create_order", {
    p_payload: {
      attempt_key: crypto.randomUUID(), payment_method: "cod", coupon_code: null,
      address: {
        full_name: "عميل الجولة", phone_primary: "+201001234567", phone_alternate: "+201109876543",
        governorate_id: 1, area_id: areaList.data[2].id, address1: "١٥ شارع التحرير",
      },
    },
  });
  if (!o?.ok) throw new Error(`order: ${JSON.stringify(o)}`);
  F.orders.push(o.number);
  return o;
}

async function seedVendorWallet(vendorId) {
  await svc.rpc("fn_post_transaction", { p_vendor_id: vendorId, p_type: "admin_adjustment", p_amount: 125000, p_reference: `p7s-${STAMP}`, p_reason: "رصيد تجريبي للعرض" });
  await svc.rpc("fn_post_transaction", { p_vendor_id: vendorId, p_type: "penalty", p_amount: -2500, p_reference: `p7s-pen-${STAMP}`, p_reason: "غرامة عرض تجريبية" });
}

async function main() {
  /* ---------------- fixtures ---------------- */
  await makeUser("admin", "0");
  const admin = await signIn(F.users["admin-0"].email);
  const root = await makeCategory("root", null, 1);
  const leaf = await makeCategory("leaf", root, 2);
  const vA = await onboardVendor("A", leaf);
  const vB = await onboardVendor("B", leaf);
  const vC = await onboardVendor("C", leaf);
  const prodA = await (async () => {
    const imgPath = `u/${vA.userId}/p7s-${STAMP}-A.webp`;
    await svc.storage.from("media").upload(imgPath, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
    const { data: p } = await vA.client.rpc("fn_save_product", {
      p_product: { name_ar: "ساعة يد أنيقة", name_en: "Elegant Watch", desc_ar: "وصف", desc_en: "d", leaf_category_id: leaf, shipping_mode: "platform", media: [{ kind: "image", path: imgPath }] },
    });
    await vA.client.rpc("fn_generate_variants", { p_product_id: p.id, p_axes: [] });
    const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.id).is("deleted_at", null).single();
    await vA.client.rpc("fn_save_variants", { p_product_id: p.id, p_rows: [{ option_key: v.option_key, sku: `P7S-A-${STAMP}`, price_piastres: 125000, sale_price_piastres: null, stock: 8, image_path: "", is_active: true }] });
    await vA.client.rpc("fn_submit_product", { p_product_id: p.id });
    await admin.rpc("fn_admin_review_product", { p_product_id: p.id, p_decision: "approve", p_reason: null });
    F.products.push(p.id); F.imgPaths.push(imgPath);
    return { productId: p.id, variantId: v.id };
  })();

  // a product for each of B and C so the demo order spans THREE vendors
  async function simpleProduct(vendor, tag, price) {
    const imgPath = `u/${vendor.userId}/p7s-${STAMP}-${tag}.webp`;
    await svc.storage.from("media").upload(imgPath, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
    const { data: p } = await vendor.client.rpc("fn_save_product", {
      p_product: { name_ar: `منتج ${tag}`, name_en: `Product ${tag}`, desc_ar: "وصف", desc_en: "d", leaf_category_id: leaf, shipping_mode: "platform", media: [{ kind: "image", path: imgPath }] },
    });
    await vendor.client.rpc("fn_generate_variants", { p_product_id: p.id, p_axes: [] });
    const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.id).is("deleted_at", null).single();
    await vendor.client.rpc("fn_save_variants", { p_product_id: p.id, p_rows: [{ option_key: v.option_key, sku: `P7S-${tag}-${STAMP}`, price_piastres: price, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
    await vendor.client.rpc("fn_submit_product", { p_product_id: p.id });
    await admin.rpc("fn_admin_review_product", { p_product_id: p.id, p_decision: "approve", p_reason: null });
    F.products.push(p.id); F.imgPaths.push(imgPath);
    return { productId: p.id, variantId: v.id };
  }
  const prodB = await simpleProduct(vB, "B", 90000);
  const prodC = await simpleProduct(vC, "C", 45000);

  // customer + ONE three-vendor COD order (feeds the print-center capture)
  await makeUser("customer", "0");
  const customer = await signIn(F.users["customer-0"].email);
  await makeOrder(customer, [[prodA.variantId, 2], [prodB.variantId, 1], [prodC.variantId, 1]]);
  seedVendorWallet(vA.id);
  const vc = await signIn(F.users["vendor-A"].email);
  await vc.rpc("fn_request_withdrawal", { p_amount_piastres: 20000, p_method: "bank", p_details: { holder: "م", account: "EG12-3456" } });

  // ads package + grant, penalty rule, blog post + category, event enrollment
  const { data: pkg } = await admin.from("ad_packages").insert({
    name_ar: "تمييز أسبوع", name_en: "Featured week", placement: "featured_product",
    duration_days: 7, price_piastres: 15000, visibility: "vendors", slots: 5, is_active: true,
  }).select("id").single();
  F.packages.push(pkg.id);
  await admin.rpc("fn_admin_grant_ad", { p_vendor_id: vA.id, p_package_id: pkg.id });
  await admin.rpc("fn_admin_apply_penalty", { p_vendor_id: vA.id, p_amount_piastres: 5000, p_reason: "تأخير في تجهيز طلب — عرض" });
  const { data: bcat } = await admin.from("blog_categories").insert({ name_ar: "أخبار", name_en: "News", slug_ar: `أخبار-${STAMP}`, slug_en: `news-${STAMP}` }).select("id").single();
  await admin.from("blog_posts").insert({
    title_ar: "دليل البائع الجديد", title_en: "New vendor guide", slug_ar: `دليل-${STAMP}`, slug_en: `guide-${STAMP}`,
    excerpt_ar: "كل ما تحتاجه لتبدأ", excerpt_en: "All you need to start",
    content_ar: "نص تجريبي للمقال.", content_en: "Sample body.", status: "published", published_at: new Date().toISOString(),
    category_id: bcat.id, author: F.users["admin-0"].id,
  });
  const { data: ev } = await svc.from("events").select("id").eq("name_en", "Black Friday").limit(1);
  if (ev?.[0]) await admin.rpc("fn_event_set_vendor", { p_event_id: ev[0].id, p_vendor_id: vA.id, p_status: "accepted" });

  /* ---------------- browser ---------------- */
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();

    async function login(email, landOn) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle" });
      await page.fill("input[name=identifier]", email);
      await page.fill("input[name=password]", PWD);
      await page.click("button[type=submit]");
      await page.waitForTimeout(1800);
      await page.goto(landOn, { waitUntil: "domcontentloaded" });
      if (page.url().includes("/auth/login")) throw new Error(`login failed ${email}`);
    }

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

    const adminEmail = F.users["admin-0"].email;
    const P = `${BASE}/ar/admin`;

    await login(adminEmail, `${P}`);
    await shoot(`${P}`, "admin-dashboard");
    await shoot(`${P}/withdrawals`, "admin-withdrawals");
    await shoot(`${P}/vendors?status=active`, "admin-vendors");
    await shoot(`${P}/vendors/${vA.id}/edit`, "admin-vendor-edit");
    await shoot(`${P}/products`, "admin-products");
    await shoot(`${P}/coupons`, "admin-coupons");
    await shoot(`${P}/reviews`, "admin-reviews");
    await shoot(`${P}/penalties`, "admin-penalties");
    await shoot(`${P}/levels`, "admin-levels");
    await shoot(`${P}/ads`, "admin-ads");
    await shoot(`${P}/events`, "admin-events");
    await shoot(`${P}/reports`, "admin-reports");
    await shoot(`${P}/customers`, "admin-customers");
    await shoot(`${P}/roles`, "admin-roles");
    await shoot(`${P}/blog`, "admin-blog");
    await shoot(`${P}/banners`, "admin-banners");
    await shoot(`${P}/pages`, "admin-pages");
    await shoot(`${P}/zones`, "admin-zones");
    await shoot(`${P}/zones?gov=1`, "admin-zones-areas");
    await shoot(`${P}/document-settings`, "admin-doc-settings");
    await shoot(`${P}/settings/sections`, "admin-settings-sections");
    await shoot(`${P}/logs`, "admin-audit");
    await shoot(`${P}/orders`, "admin-orders");
    await shoot(`${P}/orders/${encodeURIComponent(F.orders[0])}`, "admin-order-detail");
    await shoot(`${P}/refunds`, "admin-refunds");
    await shoot(`${P}/shipping`, "admin-shipping");
    await shoot(`${P}/users`, "admin-users");
    await shoot(`${P}/email-templates`, "admin-email-templates");
    await shoot(`${P}/media-settings`, "admin-media-settings");
    // A-39 /admin/profile redirects into the shared self-scoped profile page
    await shoot(`${BASE}/ar/account/profile`, "admin-profile");

    /* print center on a THREE-vendor order: 1 invoice + 1 carrier label + 3
       vendor labels, captured as a dedicated subject at all four widths */
    {
      const orderNo = F.orders[0];
      await shoot(`${P}/orders/${encodeURIComponent(orderNo)}`, "admin-print-center-3vendors", WIDTHS, {
        pre: async (pg) => {
          const labels = await pg.evaluate(() =>
            [...document.querySelectorAll("a[href*='/print/label_vendor']")].length);
          const invoice = await pg.evaluate(() =>
            [...document.querySelectorAll("a[href*='/print/invoice_admin']")].length);
          const carrier = await pg.evaluate(() =>
            [...document.querySelectorAll("a[href*='/print/label_carrier']")].length);
          check(`print-center-3vendors invoice=${invoice} carrier=${carrier} vendorLabels=${labels}`,
            invoice === 1 && carrier === 1 && labels === 3, `got ${invoice}/${carrier}/${labels}`);
        },
      });
    }
  } finally {
    await browser.close();
  }
}

process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e); process.exitCode = 1; });
main()
  .catch((error) => {
    console.error("SUITE ERROR:", error.message, (error.stack ?? String(error)).split("|")[0]);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      fs.mkdirSync("evidence/phase-07", { recursive: true });
      fs.writeFileSync("evidence/phase-07/screens-log.txt", log.join("\n") + "\n");
      console.log(`
==== screens: ${passCount} PASS / ${failCount} FAIL ====`);
      // teardown → pristine
      const svcDel = (t) => svc.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await svcDel("order_documents");
      await svcDel("order_status_history");
      await svcDel("order_notes");
      await svcDel("order_items");
      await svcDel("order_vendor_groups");
      await svcDel("payments");
      await svcDel("withdrawal_requests");
      await svcDel("wallet_transactions");
      await svcDel("wallets");
      await svcDel("vendor_penalties");
      await svcDel("ad_campaigns");
      await svcDel("ad_packages").then(() => svc.from("ad_packages").delete().in("id", F.packages.length ? F.packages : ["00000000-0000-0000-0000-000000000000"]));
      await svcDel("blog_posts");
      await svc.from("blog_categories").delete().like("slug_en", "news-%");
      const ev = await svc.from("events").select("id").eq("name_en", "Black Friday").limit(1);
      if (ev.data?.[0]) await svc.from("event_vendors").delete().eq("event_id", ev.data[0].id);
      await svcDel("order_sequences").then(() => svc.from("order_sequences").delete().gt("year", 0));
      await svcDel("orders");
      await svcDel("coupon_redemptions");
      await svcDel("coupons");
      await svcDel("audit_logs").then(() => svc.from("audit_logs").delete().neq("id", 0));
      await svc.from("vendor_level_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await svc.from("vendor_levels").delete().in("id", F.levels.length ? F.levels : ["00000000-0000-0000-0000-000000000000"]);
      // settings rows are baseline data (seeded by migration 003) — restored, never removed
      await svc.from("settings").update({ value: { store_url_pattern: "Store", single_seller: false, show_customer_details: true, vendor_onboarding_mode: "manual", vendor_address_public: false, vendor_registration: true, welcome_ar: "", welcome_en: "", force_onboarding: true, terms_required: true } }).eq("key", "general");
      await svc.from("areas").delete().like("name_ar", "P7 حي %");
      if (F.imgPaths.length > 0) await svc.storage.from("media").remove(F.imgPaths);
      for (const pid of F.products) await svc.from("products").delete().eq("id", pid);
      for (const v of Object.values(F.vendors)) await svc.from("vendors").delete().eq("id", v.id);
      for (let i = F.cats.length - 1; i >= 0; i -= 1) await svc.from("categories").delete().eq("id", F.cats[i]);
      for (const u of Object.values(F.users)) await svc.auth.admin.deleteUser(u.id);
      await svcDel("notifications");
      await svcDel("email_logs");
      const counts = {};
      for (const t of ["orders", "products", "categories", "vendors", "coupons", "wallets", "wallet_transactions", "withdrawal_requests", "vendor_penalties", "cart_items", "ad_packages", "ad_campaigns", "blog_posts", "event_vendors", "reviews", "refund_requests"]) {
        const { count } = await svc.from(t).select("*", { count: "exact", head: true });
        counts[t] = count;
      }
      const pristine = Object.values(counts).every((c) => c === 0);
      console.log("pristine:", pristine, JSON.stringify(counts));
    } catch (e) {
      console.error("CLEANUP ERROR:", e.message);
      process.exitCode = 1;
    }
  });
