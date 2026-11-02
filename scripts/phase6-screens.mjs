/**
 * Phase 06 — evidence captures (same protocol as phase-05: viewport{width},
 * dSF 1, networkidle + fonts.ready, full scroll, clientWidth/scrollWidth
 * assert, @1440 container>=1100). Subjects: vendor orders (list + filters),
 * wallet card + transactions, withdraw dialog, penalties, report, vendor
 * profile (store name + logo avatar), admin shipping queue; print PDFs:
 * vendor invoice A4 + vendor label A5 (name only, no barcode).
 * Cleanup → DB pristine. Reproduce: node --env-file=.env scripts/phase6-screens.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = "http://localhost:3000";
const OUT = "evidence/phase-06/screens";
const PDF_OUT = "evidence/phase-06/pdf";
const WIDTHS = [390, 768, 1280, 1440];
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PDF_OUT, { recursive: true });

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

const ADDRESS = {
  full_name: "عميل الاختبار",
  phone_primary: "+201001234567",
  phone_alternate: "+201109876543",
  governorate_id: 1,
  area_id: null,
  address1: "١٥ شارع التحرير، الدور الثالث",
};

const F = { users: {}, vendors: {}, cats: [], products: [], imgPaths: [], orders: [], coupons: [] };

async function makeUser(role, tag) {
  const email = `p6s-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");
async function uploadImage(vendorUserId) {
  const path = `u/${vendorUserId}/p6s-${STAMP}-${Math.random().toString(36).slice(2)}.webp`;
  const { error } = await svc.storage.from("media").upload(path, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(error.message);
  F.imgPaths.push(path);
  return path;
}

async function onboardVendor(tag, leafCatId, opts = {}) {
  const user = await makeUser("vendor", tag);
  const client = await signIn(F.users[`vendor-${tag}`].email);
  const areaQ = await svc.from("areas").select("id, governorate_id, pickup_fee_piastres").eq("governorate_id", 1).order("id");
  const area = (areaQ.data ?? [])[opts.areaIndex ?? 0];
  const { data: on } = await client.rpc("fn_vendor_onboard", {
    p_data: {
      store_name_ar: `متجر ${tag}`, store_name_en: `Store ${tag}`,
      category_ids: [leafCatId], first_name: "ب", last_name: "ت",
      governorate_id: area.governorate_id, area_id: area.id, address1: "عنوان المتجر",
      terms_version: "1.0", terms_signature: "P6S",
    },
  });
  await signIn(F.users["admin-0"].email).then((a) => a.rpc("fn_admin_review_vendor", { p_vendor_id: on.vendor_id, p_decision: "approve" }));
  await svc.from("vendors").update({ level_id: opts.levelId ?? null, area_id: area.id }).eq("id", on.vendor_id);
  if (opts.areaPickup !== undefined) await svc.from("areas").update({ pickup_fee_piastres: opts.areaPickup }).eq("id", area.id);
  F.vendors[tag] = { id: on.vendor_id, userId: user.id, client, areaId: area.id };
}

async function makeProduct(vendor, tag, leafCatId, price, opts = {}) {
  const imgPath = await uploadImage(vendor.userId);
  const p = await vendor.client.rpc("fn_save_product", { p_product: { name_ar: `منتج ${tag}`, name_en: `Product ${tag}`, desc_ar: "وصف المنتج التجريبي", desc_en: "desc", leaf_category_id: leafCatId, shipping_mode: opts.vendorShip ? "vendor" : "platform", media: [{ kind: "image", path: imgPath }] } });
  await vendor.client.rpc("fn_generate_variants", { p_product_id: p.data.id, p_axes: [] });
  const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.data.id).is("deleted_at", null).single();
  await vendor.client.rpc("fn_save_variants", { p_product_id: p.data.id, p_rows: [{ option_key: v.option_key, sku: `P6S-${tag}-${STAMP}`, price_piastres: price, sale_price_piastres: null, stock: opts.stock ?? 10, image_path: "", is_active: true }] });
  await vendor.client.rpc("fn_submit_product", { p_product_id: p.data.id });
  await signIn(F.users["admin-0"].email).then((a) => a.rpc("fn_admin_review_product", { p_product_id: p.data.id, p_decision: "approve", p_reason: null }));
  F.products.push(p.data.id);
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
  const { data: lvl } = await svc.from("vendor_levels").select("id").order("min_successful_orders").limit(1).single();
  // fixtures run at 10% for determinism; the SHARED level is always restored to
  // the seeded baseline (5%) — never to a snapshot of an unrelated transient run
  await svc.from("vendor_levels").update({ rewards: { commission_percent: 10, hold_days: 14 } }).eq("id", lvl.id);

  const root = await svc.from("categories").insert({ slug_ar: `جذر-${STAMP}`, slug_en: `p6s-root-${STAMP}`, name_ar: "أجهزة", name_en: "Devices", show_in_header: true }).select("id").single();
  F.cats.push(root.data.id);
  const leafA = await svc.from("categories").insert({ slug_ar: `صوتيات-${STAMP}`, slug_en: `p6s-a-${STAMP}`, name_ar: "صوتيات", name_en: "Audio", parent_id: root.data.id, depth: 2 }).select("id").single();
  const leafB = await svc.from("categories").insert({ slug_ar: `شاشات-${STAMP}`, slug_en: `p6s-b-${STAMP}`, name_ar: "شاشات", name_en: "Displays", parent_id: root.data.id, depth: 2 }).select("id").single();
  F.cats.push(leafA.data.id, leafB.data.id);

  await onboardVendor("A", leafA.data.id, { levelId: lvl.id, areaIndex: 0, areaPickup: 700 });
  await onboardVendor("B", leafB.data.id, { levelId: lvl.id, areaIndex: 1, areaPickup: 0 });
  const varA = await makeProduct(F.vendors.A, "A", leafA.data.id, 50000);
  const varShip = await makeProduct(F.vendors.A, "sh", leafA.data.id, 20000, { vendorShip: true });
  const varB = await makeProduct(F.vendors.B, "B", leafB.data.id, 80000);

  const areaList = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id");
  if (!areaList.data || areaList.data.length < 3) throw new Error(`areas: ${JSON.stringify(areaList.error ?? areaList.data)}`);
  ADDRESS.area_id = areaList.data[2].id;
  const customer = await signIn(F.users["customer-0"].email);
  const admin = await signIn(F.users["admin-0"].email);
  await svc.from("user_addresses").insert({ user_id: F.users["customer-0"].id, label: "المنزل", full_name: ADDRESS.full_name, phone: ADDRESS.phone_primary, governorate_id: 1, area_id: ADDRESS.area_id, address1: ADDRESS.address1, is_default: true });

  /* O1: COD 2-vendor (wallet story for A) — deliver A's part, ship it
     O2: vendor-shipped kashier → pending_admin (queue evidence) */
  await addToCart(customer, varA, 2); await addToCart(customer, varB, 1);
  const O1 = await placeOrder(customer, "cod");
  await addToCart(customer, varShip, 1);
  const O2 = await placeOrder(customer, "kashier");

  const { data: o1row } = await svc.from("orders").select("id").eq("number", O1.number).single();
  const { data: o2row } = await svc.from("orders").select("id").eq("number", O2.number).single();
  for (const gid of (await svc.from("order_vendor_groups").select("id").eq("order_id", o1row.id)).data) {
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "preparing", p_note: null });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "handed_to_carrier", p_note: "تم التسليم للنقل" });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "out_for_delivery", p_note: null });
    await admin.rpc("fn_update_group_status", { p_group_id: gid.id, p_status: "delivered", p_note: null });
  }
  const { data: grpA1 } = await svc.from("order_vendor_groups").select("id").eq("order_id", o1row.id).eq("vendor_id", F.vendors.A.id).single();

  // vendor A wallet story: shipping request approved + withdrawal pending
  const { data: o2grp } = await svc.from("order_vendor_groups").select("id").eq("order_id", o2row.id).single();
  await F.vendors.A.client.rpc("fn_request_vendor_shipping", { p_group_id: o2grp.id });
  const { data: o1Ord } = await svc.from("orders").select("shipping_fee_piastres").eq("id", o1row.id).single();
  // approve B's (platform ships) and A's with share for the revenue row
  await admin.rpc("fn_approve_vendor_shipping", { p_group_id: o2grp.id, p_decision: "approve", p_shipping_piastres: 2500 });

  // wallet money for A: earn (delivered above) + a withdrawal pending
  await F.vendors.A.client.rpc("fn_request_withdrawal", { p_amount_piastres: 5000, p_method: "bank", p_details: { holder: "ب ت", account: "EG12 0003" } });
  // penalty row for the view
  await svc.from("vendor_penalties").insert({ vendor_id: F.vendors.A.id, source: "manual", amount_piastres: 2500, reason: "تأخير تجهيز طلب", reference: "manual", status: "applied" });

  /* ---------------------------------------------------------- captures */
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const shots = [];

  async function login(page, email, landOn) {
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
    const page = await browser.newPage({ viewport: { width: widths[0], height: 900 }, deviceScaleFactor: 1 });
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
    check(`captured ${name}`, true, widths.join("/"));
  }

  /* vendor session pages */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await login(page, F.users["vendor-A"].email, `${BASE}/ar/vendor/orders`);

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
      check(`captured ${name}`, true, widths.join("/"));
    };

    await authed(`${BASE}/ar/vendor/orders`, "vendor-orders", WIDTHS);
    await authed(`${BASE}/ar/vendor/orders?status=on_hold`, "vendor-orders-filtered", WIDTHS);
    await authed(`${BASE}/ar/vendor/wallet`, "vendor-wallet", WIDTHS);
    await authed(`${BASE}/ar/vendor/wallet`, "vendor-withdraw-dialog", WIDTHS, {
      pre: async (p) => {
        const btn = p.locator("button:has-text('سحب الرصيد'), button:has-text('Withdraw')");
        if (await btn.count()) await btn.first().click();
        await p.waitForTimeout(400);
      },
    });
    await authed(`${BASE}/ar/vendor/penalties`, "vendor-penalties", WIDTHS);
    await authed(`${BASE}/ar/vendor/reports`, "vendor-report", WIDTHS);
    await authed(`${BASE}/ar/account/profile`, "vendor-profile", WIDTHS);
    // print history page lives inside the orders page (details) — capture open state
    await authed(`${BASE}/ar/vendor/orders`, "vendor-print-history", WIDTHS, {
      pre: async (p) => {
        const d = p.locator("details summary");
        if (await d.count()) await d.first().click();
        await p.waitForTimeout(300);
      },
    });
    // admin shipping queue
    await login(page, F.users["admin-0"].email, `${BASE}/ar/admin/shipping`);
    await authed(`${BASE}/ar/admin/shipping`, "admin-shipping-queue", WIDTHS);
    await ctx.close();
  }

  /* vendor print PDFs (A4 invoice + A5 label) — real page.pdf */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
    await login(page, F.users["vendor-A"].email, `${BASE}/ar/vendor/orders`);

    // vendor prints OWN invoice for O1
    const invUrl = `${BASE}/order/${encodeURIComponent(O1.number)}/print/invoice_vendor?lang=ar`;
    await page.goto(invUrl, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${PDF_OUT}/vendor-invoice-a4.pdf`, format: "A4", printBackground: true });
    check("PDF vendor invoice A4", fs.existsSync(`${PDF_OUT}/vendor-invoice-a4.pdf`), `${(fs.statSync(`${PDF_OUT}/vendor-invoice-a4.pdf`).size / 1024).toFixed(0)}KB`);

    const lblUrl = `${BASE}/order/${encodeURIComponent(O1.number)}/print/label_vendor?lang=ar`;
    await page.goto(lblUrl, { waitUntil: "networkidle" });
    // bounding-box + content assertions (B1 protocol)
    const orderNumber = O1.number;
    const box = await page.evaluate((orderNumber) => {
      const sheet = document.querySelector(".sheet-a5");
      const r = sheet.getBoundingClientRect();
      const overflows = [...sheet.querySelectorAll("*")].filter((el) => {
        if (el.closest(".watermark")) return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1);
      }).length;
      const text = sheet.innerText;
      return {
        sheetW: Math.round(r.width), sheetH: Math.round(r.height), overflows,
        hasNumber: text.includes(orderNumber),
        hasName: text.includes("عميل الاختبار"),
        noPhone: !/\+201/.test(text),
        noBarcode: !sheet.querySelector("svg"),
        shippingDash: /—/.test(text),
      };
    }, orderNumber);
    check("vendor label A5 geometry + content rules",
      Math.abs(box.sheetW - 794) <= 4 && Math.abs(box.sheetH - 560) <= 4 && box.overflows === 0
      && box.hasNumber && box.hasName && box.noPhone && box.noBarcode && box.shippingDash,
      JSON.stringify(box));
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${PDF_OUT}/vendor-label-a5-landscape.pdf`, format: "A5", landscape: true, printBackground: true });
    check("PDF vendor label A5 landscape", fs.existsSync(`${PDF_OUT}/vendor-label-a5-landscape.pdf`), `${(fs.statSync(`${PDF_OUT}/vendor-label-a5-landscape.pdf`).size / 1024).toFixed(0)}KB`);

    // screen captures of both documents
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(invUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/print-vendor-invoice.png`, fullPage: true });
    shots.push(`${OUT}/print-vendor-invoice.png`);
    await page.goto(lblUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/print-vendor-label.png`, fullPage: true });
    shots.push(`${OUT}/print-vendor-label.png`);
    await page.close();
  }

  check(`all shots saved (${shots.length})`, shots.length >= 30, shots.slice(0, 4).map((s) => s.split("/").pop()).join(","));
  await browser.close();
  browser = null;

  // restore the shared level rewards
  await svc.from("vendor_levels").update({ rewards: { commission_percent: 5, hold_days: 14 } }).eq("id", lvl.id);
} catch (error) {
  console.error("SUITE ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 6).join(" | "));
  process.exitCode = 1;
} finally {
  try {
    if (browser) await browser.close();
    await svc.from("orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("order_sequences").delete().gt("year", 0);
    await svc.from("wallet_transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("wallets").delete().neq("vendor_id", "00000000-0000-0000-0000-000000000000");
    await svc.from("withdrawal_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("vendor_penalties").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("coupon_redemptions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("coupons").delete().in("id", F.coupons);
    if (F.imgPaths.length > 0) await svc.storage.from("media").remove(F.imgPaths);
    for (const pid of F.products) await svc.from("products").delete().eq("id", pid);
    for (const v of Object.values(F.vendors)) await svc.from("vendors").delete().eq("id", v.id);
    for (let i = F.cats.length - 1; i >= 0; i -= 1) await svc.from("categories").delete().eq("id", F.cats[i]);
    for (const u of Object.values(F.users)) await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("audit_logs").delete().neq("id", 0);
    await svc.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const counts = {};
    for (const t of ["orders", "products", "categories", "vendors", "coupons", "wallets", "wallet_transactions", "withdrawal_requests", "vendor_penalties", "cart_items", "reviews", "refund_requests"]) {
      const { count } = await svc.from(t).select("*", { count: "exact", head: true });
      counts[t] = count;
    }
    const pristine = Object.values(counts).every((c) => c === 0);
    check("DB pristine after cleanup", pristine, JSON.stringify(counts));
    fs.writeFileSync("evidence/phase-06/screens-log.txt", log.join("\n") + `\npristine: ${pristine}\n`);
  } catch (e) {
    console.error("CLEANUP ERROR:", e.message);
    process.exitCode = 1;
  }
}
