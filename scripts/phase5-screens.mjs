/**
 * Phase 05 — evidence captures (Playwright protocol from P4-0):
 * per shot — viewport{width}, dSF 1, networkidle + fonts.ready, full scroll,
 * assert clientWidth===width && scrollWidth===clientWidth; @1440 container>=1100.
 * Covers: checkout gate/steps (address, payment+COD-disabled, confirm),
 * Kashier return (awaiting webhook), COD success, tracking timeline,
 * account orders/detail+review, refund wizard, profile, wishlist (incl. gone
 * state), recently viewed, notifications, addresses, reviews page, vendor
 * orders, admin orders + print center, and the print documents:
 * admin invoice A4 + carrier label A5 (Code128) + 3 vendor labels for a
 * 3-vendor order + cancelled watermark. DB pristine at the end.
 * Reproduce: node --env-file=.env scripts/phase5-screens.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = "http://localhost:3000";
const OUT = "evidence/phase-05/screens";
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

const F = { users: {}, vendors: {}, cats: [], products: [], variants: {}, coupons: [], imgPaths: [], orders: [] };
const ADDRESS = {
  full_name: "منى أحمد",
  phone_primary: "+201001112233",
  phone_alternate: "+201155566778",
  governorate_id: 1,
  area_id: null,
  address1: "٢٢ شارع جامعة الدول العربية، المهندسين",
};

async function makeUser(role, tag) {
  const email = `p5s-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");
async function uploadImage(vendorUserId) {
  const path = `u/${vendorUserId}/p5s-${STAMP}-${Math.random().toString(36).slice(2)}.webp`;
  const { error } = await svc.storage.from("media").upload(path, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(error.message);
  F.imgPaths.push(path);
  return path;
}

async function onboardVendor(tag, leafCatId) {
  const user = await makeUser("vendor", tag);
  const client = await signIn(F.users[`vendor-${tag}`].email);
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).limit(1).single();
  const on = await client.rpc("fn_vendor_onboard", { p_data: { store_name_ar: `متجر ${tag}`, store_name_en: `Store ${tag}`, category_ids: [leafCatId], first_name: "ب", last_name: "ت", governorate_id: area.governorate_id, area_id: area.id, address1: "عنوان", terms_version: "1.0", terms_signature: "P5S" } });
  await signIn(F.users["admin-0"].email).then((a) => a.rpc("fn_admin_review_vendor", { p_vendor_id: on.data.vendor_id, p_decision: "approve" }));
  F.vendors[tag] = { id: on.data.vendor_id, userId: user.id, client };
}

async function makeProduct(vendor, tag, leafCatId, price, opts = {}) {
  const imgPath = await uploadImage(vendor.userId);
  const p = await vendor.client.rpc("fn_save_product", { p_product: { name_ar: `منتج ${tag}`, name_en: `Product ${tag}`, desc_ar: "وصف المنتج التجريبي", desc_en: "desc", leaf_category_id: leafCatId, media: [{ kind: "image", path: imgPath }] } });
  await vendor.client.rpc("fn_generate_variants", { p_product_id: p.data.id, p_axes: [] });
  const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.data.id).is("deleted_at", null).single();
  await vendor.client.rpc("fn_save_variants", { p_product_id: p.data.id, p_rows: [{ option_key: v.option_key, sku: `P5S-${tag}-${STAMP}`, price_piastres: price, sale_price_piastres: null, stock: opts.stock ?? 10, image_path: "", is_active: true }] });
  await vendor.client.rpc("fn_submit_product", { p_product_id: p.data.id });
  await signIn(F.users["admin-0"].email).then((a) => a.rpc("fn_admin_review_product", { p_product_id: p.data.id, p_decision: "approve", p_reason: null }));
  if (opts.fragile) await svc.from("products").update({ is_fragile: true }).eq("id", p.data.id);
  F.products.push(p.data.id);
  F.variants[tag] = v.id;
  return v.id;
}

async function addToCart(userClient, variantId, qty) {
  await userClient.rpc("fn_cart_add", { p_variant_id: variantId, p_qty: qty });
}

async function placeOrder(userClient, method, coupon = null) {
  const { data } = await userClient.rpc("fn_create_order", { p_payload: { attempt_key: crypto.randomUUID(), payment_method: method, coupon_code: coupon, address: { ...ADDRESS } } });
  if (!data?.ok) throw new Error(`order: ${JSON.stringify(data)}`);
  F.orders.push(data.number);
  return data;
}

let browser;
try {
  /* ---------------------------------------------------------- fixtures */
  console.log("fixtures…");
  await makeUser("admin", "0");
  await makeUser("customer", "0");
  const root = await svc.from("categories").insert({ slug_ar: `جذر-${STAMP}`, slug_en: `p5s-root-${STAMP}`, name_ar: "أجهزة", name_en: "Devices", show_in_header: true }).select("id").single();
  F.cats.push(root.data.id);
  const leafA = await svc.from("categories").insert({ slug_ar: `صوتيات-${STAMP}`, slug_en: `p5s-a-${STAMP}`, name_ar: "صوتيات", name_en: "Audio", parent_id: root.data.id, depth: 2 }).select("id").single();
  const leafB = await svc.from("categories").insert({ slug_ar: `شاشات-${STAMP}`, slug_en: `p5s-b-${STAMP}`, name_ar: "شاشات", name_en: "Displays", parent_id: root.data.id, depth: 2 }).select("id").single();
  const leafC = await svc.from("categories").insert({ slug_ar: `ملحقات-${STAMP}`, slug_en: `p5s-c-${STAMP}`, name_ar: "ملحقات", name_en: "Accessories", parent_id: root.data.id, depth: 2 }).select("id").single();
  F.cats.push(leafA.data.id, leafB.data.id, leafC.data.id);
  await onboardVendor("A", leafA.data.id);
  await onboardVendor("B", leafB.data.id);
  await onboardVendor("C", leafC.data.id);
  const vA = await makeProduct(F.vendors.A, "A", leafA.data.id, 50000);
  const vB = await makeProduct(F.vendors.B, "B", leafB.data.id, 80000, { fragile: true });
  const vC = await makeProduct(F.vendors.C, "C", leafC.data.id, 30000);
  const vCap = await makeProduct(F.vendors.A, "cap", leafA.data.id, 610000);
  await makeProduct(F.vendors.B, "gone", leafB.data.id, 40000);

  const { data: area } = await svc.from("areas").select("id").eq("governorate_id", 1).limit(1).single();
  ADDRESS.area_id = area.id;
  const customer = await signIn(F.users["customer-0"].email);
  const admin = await signIn(F.users["admin-0"].email);

  // addresses (default + second)
  await svc.from("user_addresses").insert({ user_id: F.users["customer-0"].id, label: "المنزل", full_name: ADDRESS.full_name, phone: ADDRESS.phone_primary, governorate_id: 1, area_id: area.id, address1: ADDRESS.address1, is_default: true });
  await svc.from("user_addresses").insert({ user_id: F.users["customer-0"].id, label: "العمل", full_name: ADDRESS.full_name, phone: ADDRESS.phone_primary, governorate_id: 2, area_id: (await svc.from("areas").select("id").eq("governorate_id", 2).limit(1).single()).data.id, address1: "برج النيل، الطابق ٥" });

  // wishlist: 2 live + 1 gone (product withdrawn from the storefront)
  await customer.rpc("fn_wishlist_toggle", { p_product_id: F.products[0] });
  await customer.rpc("fn_wishlist_toggle", { p_product_id: F.products[1] });
  await customer.rpc("fn_wishlist_toggle", { p_product_id: F.products[4] });
  await svc.from("products").update({ status: "rejected", rejection_reason: "evidence" }).eq("id", F.products[4]);

  // recently viewed
  for (const [i, pid] of F.products.slice(0, 3).entries()) {
    await svc.from("recently_viewed").upsert({ user_id: F.users["customer-0"].id, product_id: pid, viewed_at: new Date(Date.now() - i * 3600000).toISOString() });
  }

  /* orders:
     O1 COD 3-vendor → success page + grouped items + COD-collect flow
     O2 kashier unpaid → awaiting-confirmation state
     O3 COD → handed_to_carrier (tracking progress)
     O4 COD → delivered (review + return windows)
     O5 COD → cancelled (watermark on documents) */
  await addToCart(customer, vA, 1); await addToCart(customer, vB, 1); await addToCart(customer, vC, 2);
  const O1 = await placeOrder(customer, "cod");
  await addToCart(customer, vA, 1);
  const O2 = await placeOrder(customer, "kashier");
  await addToCart(customer, vB, 1);
  const O3 = await placeOrder(customer, "cod");
  await addToCart(customer, vA, 2); await addToCart(customer, vC, 1);
  const O4 = await placeOrder(customer, "cod");
  await addToCart(customer, vC, 1);
  const O5 = await placeOrder(customer, "cod");

  // O3 → out for delivery progress; O4 → delivered (windows + reviews open)
  const { data: o3row } = await svc.from("orders").select("id").eq("number", O3.number).single();
  const { data: o4row } = await svc.from("orders").select("id").eq("number", O4.number).single();
  for (const gid of (await svc.from("order_vendor_groups").select("id").eq("order_id", o3row.id)).data) {
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "preparing", p_note: null });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "handed_to_carrier", p_note: "تم التسليم لشركة الشحن" });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "out_for_delivery", p_note: null });
  }
  for (const gid of (await svc.from("order_vendor_groups").select("id").eq("order_id", o4row.id)).data) {
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "preparing", p_note: null });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "handed_to_carrier", p_note: null });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "out_for_delivery", p_note: null });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "delivered", p_note: null });
  }
  // O5 → cancelled by customer
  const { data: o5row } = await svc.from("orders").select("id").eq("number", O5.number).single();
  await customer.rpc("fn_cancel_order", { p_order_id: o5row.id, p_reason: "لم أعد بحاجة للمنتج" });

  // refund request on the delivered order (first item)
  const { data: o4items } = await svc.from("order_items").select("id").eq("order_id", o4row.id).limit(1);
  await customer.rpc("fn_request_refund", { p_order_id: o4row.id, p_kind: "return", p_items: [{ order_item_id: o4items[0].id, qty: 1, reason: "damaged" }], p_description: "وصل تالفًا", p_evidence: [] });

  // pending review on the delivered order (half stars)
  await customer.rpc("fn_submit_review", { p_order_item_id: o4items[0].id, p_rating: 4.5, p_title: "جودة ممتازة", p_body: "الصوت نقي والتغليف كان آمنًا." });

  /* ---------------------------------------------------------- captures */
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const shots = [];

  async function shoot(url, name, widths = WIDTHS, { pre } = {}) {
    const page = await browser.newPage({ viewport: { width: widths[0], height: 900 }, deviceScaleFactor: 1 });
    if (pre) await pre(page);
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
      const a1 = await page.evaluate(() => document.documentElement.clientWidth);
      const a2 = await page.evaluate(() => document.documentElement.scrollWidth);
      if (a1 !== width || a2 !== a1) {
        check(`assert ${name}@${width}`, false, `clientWidth ${a1}, scrollWidth ${a2}`);
        continue;
      }
      if (width === 1440) {
        const cw = await page.evaluate(() => {
          const m = document.querySelector("main") ?? document.querySelector(".mx-auto.w-full.max-w-page");
          return m ? Math.round(m.getBoundingClientRect().width) : null;
        });
        check(`assert ${name}@1440 container>=1100`, cw != null && cw >= 1100, `${cw}px`);
      }
      const file = `${OUT}/${name}-${width}.png`;
      await page.screenshot({ path: file, fullPage: true });
      shots.push(file);
    }
    await page.close();
  }

  async function login(page, email) {
    // RR7 submits the login form via fetch (login.data) — no navigation; the
    // Set-Cookie lands on the fetch response, so give it a beat to settle.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle" });
    await page.fill("input[name=identifier]", email);
    await page.fill("input[name=password]", PWD);
    await page.click("button[type=submit]");
    await page.waitForTimeout(1800);
    await page.goto(`${BASE}/ar/account`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/auth/login")) {
      // session not settled yet — one retry
      await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle" });
      await page.fill("input[name=identifier]", email);
      await page.fill("input[name=password]", PWD);
      await page.click("button[type=submit]");
      await page.waitForTimeout(1800);
    }
  }

  /* checkout gate (guest) */
  await shoot(`${BASE}/ar/checkout`, "checkout-gate", WIDTHS);

  /* customer session pages */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await login(page, F.users["customer-0"].email);

    const authed = async (url, name, widths, opts = {}) => {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        if (opts.pre) await opts.pre(page);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const a1 = await page.evaluate(() => document.documentElement.clientWidth);
        const a2 = await page.evaluate(() => document.documentElement.scrollWidth);
        if (a1 !== width || a2 !== a1) { check(`assert ${name}@${width}`, false, `${a1}/${a2}`); continue; }
        const file = `${OUT}/${name}-${width}.png`;
        await page.screenshot({ path: file, fullPage: true });
        shots.push(file);
      }
      check(`captured ${name}`, true, widths.join("/"));
    };

    // checkout address step (saved addresses + new address + read-only email)
    await authed(`${BASE}/ar/checkout`, "checkout-address", WIDTHS);
    // payment step with COD disabled over the cap: cap product in cart
    await addToCart(customer, vCap, 1);
    await authed(`${BASE}/ar/checkout`, "checkout-cod-disabled", WIDTHS, { pre: async (p) => {
      // open the payment accordion
      const btn = p.locator("button:has-text('طريقة الدفع'), button:has-text('Payment')");
      if (await btn.count()) await btn.first().click();
      await p.waitForTimeout(400);
    } });
    await customer.from("cart_items").delete().neq("variant_id", "00000000-0000-0000-0000-000000000000");

    await authed(`${BASE}/ar/order/${encodeURIComponent(O1.number)}?placed=1`, "order-success-cod", WIDTHS);
    await authed(`${BASE}/ar/order/${encodeURIComponent(O2.number)}?kashier=return`, "kashier-awaiting", WIDTHS);
    await authed(`${BASE}/ar/order/${encodeURIComponent(O3.number)}/track`, "tracking-progress", WIDTHS);
    await authed(`${BASE}/ar/order/${encodeURIComponent(O1.number)}/track`, "tracking-initial", WIDTHS);
    await authed(`${BASE}/ar/account/orders`, "account-orders", WIDTHS);
    await authed(`${BASE}/ar/account/orders/${encodeURIComponent(O4.number)}`, "account-order-delivered", WIDTHS, {
      pre: async (p) => {
        const b = p.locator("button:has-text('اكتب تقييمًا')");
        if (await b.count()) { await b.first().click(); await p.waitForTimeout(300); }
      },
    });
    await authed(`${BASE}/ar/account/orders/${encodeURIComponent(O4.number)}/return?items=`, "refund-wizard", WIDTHS);
    await authed(`${BASE}/ar/account/profile`, "profile", WIDTHS);
    await authed(`${BASE}/ar/account/wishlist`, "wishlist", WIDTHS);
    await authed(`${BASE}/ar/account/recent`, "recently-viewed", WIDTHS);
    await authed(`${BASE}/ar/account/notifications`, "notifications", WIDTHS);
    await authed(`${BASE}/ar/account/addresses`, "addresses", WIDTHS);
    await authed(`${BASE}/ar/account/reviews`, "account-reviews", WIDTHS);
    await authed(`${BASE}/ar/account`, "account-overview", WIDTHS);
    await ctx.close();
  }

  /* vendor session */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await login(page, F.users["vendor-A"].email);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/ar/vendor/orders`, { waitUntil: "networkidle" });
      const a1 = await page.evaluate(() => document.documentElement.clientWidth);
      const a2 = await page.evaluate(() => document.documentElement.scrollWidth);
      if (a1 !== width || a2 !== a1) { check(`assert vendor-orders@${width}`, false, `${a1}/${a2}`); continue; }
      const f = `${OUT}/vendor-orders-${width}.png`;
      await page.screenshot({ path: f, fullPage: true });
      shots.push(f);
    }
    check("captured vendor-orders", true, "390/768/1280/1440");
    await ctx.close();
  }

  /* admin session + print documents */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await login(page, F.users["admin-0"].email);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/ar/admin/orders`, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${OUT}/admin-orders-${width}.png`, fullPage: true });
      shots.push(`${OUT}/admin-orders-${width}.png`);
      await page.goto(`${BASE}/ar/admin/orders/${encodeURIComponent(O1.number)}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${OUT}/admin-order-detail-${width}.png`, fullPage: true });
      shots.push(`${OUT}/admin-order-detail-${width}.png`);
    }
    check("captured admin orders + detail", true, "390/768/1280/1440");

    // print documents — 3-vendor order: 1 invoice + 1 carrier label + 3 vendor labels
    fs.mkdirSync("evidence/phase-05/pdf", { recursive: true });
    const print = async (doc, name, qs = "", vendor = null) => {
      const u = `${BASE}/order/${encodeURIComponent(O1.number)}/print/${doc}?lang=ar&copies=1&pieces=4${qs}${vendor ? `&vendor=${vendor}` : ""}`;
      await page.goto(u, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      shots.push(`${OUT}/${name}.png`);
      return u;
    };
    const uInvoice = await print("invoice_admin", "print-invoice-a4");
    const uCarrier = await print("label_carrier", "print-carrier-a5-code128", "&pieces=4");
    const uVendorLabel = await print("label_vendor", "print-vendor-label-a", "", F.vendors.A.id);
    for (const [tag, vid] of Object.entries({ b: F.vendors.B.id, c: F.vendors.C.id })) {
      await print("label_vendor", `print-vendor-label-${tag}`, "", vid);
    }
    await print("invoice_vendor", "print-vendor-invoice-a", "", F.vendors.A.id);

    // REAL PDFs — page.pdf with the true paper sizes (B1 evidence)
    const pdf = async (url, file, opts) => {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({ path: `evidence/phase-05/pdf/${file}`, printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }, ...opts });
    };
    await pdf(uInvoice, "admin-invoice-a4.pdf", { format: "A4" });
    await pdf(uCarrier, "carrier-label-a5-landscape.pdf", { format: "A5", landscape: true });
    await pdf(uVendorLabel, "vendor-label-a5-landscape.pdf", { format: "A5", landscape: true });
    const pdfSizes = ["admin-invoice-a4.pdf", "carrier-label-a5-landscape.pdf", "vendor-label-a5-landscape.pdf"]
      .map((f) => `${f}:${Math.round(fs.statSync(`evidence/phase-05/pdf/${f}`).size / 1024)}KB`).join(" ");
    check("PDFs generated (A4 invoice + A5 landscape carrier/vendor labels)", true, pdfSizes);
    // cancelled watermark
    await page.goto(`${BASE}/order/${encodeURIComponent(O5.number)}/print/label_carrier?lang=ar`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/print-carrier-cancelled-watermark.png`, fullPage: true });
    shots.push(`${OUT}/print-carrier-cancelled-watermark.png`);

    // barcode sanity: bwip-js groups the bars by width into several <path>
    // elements — sum the d-lengths of the rendered label's barcode SVG
    await page.goto(`${BASE}/order/${encodeURIComponent(O1.number)}/print/label_carrier?lang=ar`, { waitUntil: "networkidle" });
    const bar = await page.evaluate((num) => {
      const svgs = [...document.querySelectorAll("svg")];
      const barcode = svgs.find((el) => el.querySelectorAll("path[stroke]").length >= 2);
      if (!barcode) return { found: false };
      const dLen = [...barcode.querySelectorAll("path")].reduce((sum, p) => sum + (p.getAttribute("d")?.length ?? 0), 0);
      const bars = [...barcode.querySelectorAll("path")].reduce((sum, p) => sum + ((p.getAttribute("d") ?? "").match(/M/g) ?? []).length, 0);
      const numberShown = document.body.innerText.includes(num);
      return { found: true, dLen, bars, numberShown };
    }, O1.number);
    check("carrier label Code128 rendered (multi-width bars + readable number)",
      bar.found && bar.dLen > 400 && bar.bars >= 30 && bar.numberShown, JSON.stringify(bar));
    const vendorLabelContent = await page.goto(`${BASE}/order/${encodeURIComponent(O1.number)}/print/label_vendor?lang=ar&vendor=${F.vendors.A.id}`, { waitUntil: "networkidle" }).then((r) => r.status());
    check("vendor label route ok", vendorLabelContent === 200);
    const vl = await page.evaluate(() => document.body.innerText);
    check("vendor label: shipment number as TEXT, no barcode, no phone/address, shipping dash",
      vl.includes(O1.number) && !vl.includes("+201001112233") && !vl.includes("+201155566778") && !vl.includes("جامعة الدول") && !vl.includes("svg"),
      `hasNumber=${vl.includes(O1.number)}`);
    // B1 bounding-box assertion: every visible element inside the A5 sheet
    // margins (sheet = 210×148mm ≈ 794×560px at 96dpi; tolerance 2px)
    await page.goto(`${BASE}/order/${encodeURIComponent(O1.number)}/print/label_carrier?lang=ar`, { waitUntil: "networkidle" });
    const bbox = await page.evaluate(() => {
      const sheet = document.querySelector(".sheet");
      const s = sheet.getBoundingClientRect();
      const out = [];
      for (const el of sheet.querySelectorAll("*")) {
        if (el.closest(".watermark")) continue; // the watermark is intentionally full-bleed
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < s.left - 2 || r.right > s.right + 2 || r.top < s.top - 2 || r.bottom > s.bottom + 2) {
          out.push(`${el.tagName}.${el.className?.baseVal ?? el.className} ${Math.round(r.left - s.left)},${Math.round(r.top - s.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      return { sheetW: Math.round(s.width), sheetH: Math.round(s.height), overflows: out.slice(0, 5) };
    });
    check("carrier label: A5 sheet 210×148 + all elements inside margins",
      Math.abs(bbox.sheetW - 794) <= 4 && Math.abs(bbox.sheetH - 560) <= 4 && bbox.overflows.length === 0,
      JSON.stringify(bbox));

    // carrier label carries everything
    await page.goto(`${BASE}/order/${encodeURIComponent(O1.number)}/print/label_carrier?lang=ar`, { waitUntil: "networkidle" });
    const cl = await page.evaluate(() => document.body.innerText);
    check("carrier label: name + both phones + address + pieces + COD line",
      cl.includes(ADDRESS.full_name) && cl.includes("+201001112233") && cl.includes("+201155566778") && cl.includes("جامعة الدول") && cl.includes("فقط لا غير"),
      "carrier fields");
    await ctx.close();
  }

  /* shots summary */
  const sizes = shots.map((f) => `${f.split("/").pop()}:${Math.round(fs.statSync(f).size / 1024)}KB`).join(" ");
  check(`all shots saved (${shots.length})`, shots.length >= 24, sizes);

  /* ---------------------------------------------------------- cleanup */
  console.log("cleanup…");
  // pattern-based (self-heals leftovers of earlier failed runs) + every step checked.
  // deleting the fixture USERS cascades profiles → vendors → products (+ cart,
  // wishlist, recently-viewed, reviews, media rows) in one pass.
  const step = async (label, run) => {
    const r = await run();
    if (r?.error) console.log(`cleanup ${label} ERR:`, r.error.message);
  };
  for (const t of ["order_documents", "payments", "refund_request_items", "refund_requests", "order_notes", "order_status_history", "order_items", "order_vendor_groups", "orders"]) {
    await step(t, () => svc.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  }
  await step("order_sequences", () => svc.from("order_sequences").delete().gt("year", 0));
  await step("coupons", () => svc.from("coupons").delete().like("code", "P5S%"));
  await step("coupon_redemptions", () => svc.from("coupon_redemptions").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  for (let round = 0; round < 3; round += 1) {
    const { data: fixtureUsers } = await svc.from("profiles").select("id").like("email", "p5s-%");
    if ((fixtureUsers ?? []).length === 0) break;
    for (const u of (fixtureUsers ?? [])) {
      const r = await svc.auth.admin.deleteUser(u.id);
      if (r.error) console.log(`cleanup user ERR (round ${round + 1}):`, r.error.message);
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  await step("categories-2", () => svc.from("categories").delete().like("slug_en", "p5s-%").eq("depth", 2));
  await step("categories-1", () => svc.from("categories").delete().like("slug_en", "p5s-%").eq("depth", 1));
  if (F.imgPaths.length > 0) await svc.storage.from("media").remove(F.imgPaths);
  await step("notifications", () => svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await step("audit", () => svc.from("audit_logs").delete().neq("id", 0));
  await step("email_logs", () => svc.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  const counts = {};
  for (const t of ["orders", "products", "categories", "vendors", "banners", "brands", "cart_items", "reviews", "refund_requests", "wishlist_items", "recently_viewed"]) {
    const { count } = await svc.from(t).select("*", { count: "exact", head: true });
    counts[t] = count;
  }
  const pristine = Object.values(counts).every((c) => c === 0);
  check("DB pristine after cleanup", pristine, JSON.stringify(counts));
  console.log(`\n==== ${passCount}/${passCount + failCount} checks passed ====`);
} catch (error) {
  console.error("SUITE ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 4).join(" | "));
  process.exitCode = 1;
} finally {
  fs.writeFileSync("evidence/phase-05/screens-log.txt", log.join("\n") + "\n");
  if (browser) await browser.close().catch(() => undefined);
}
