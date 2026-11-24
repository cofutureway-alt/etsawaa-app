/**
 * Screens for returns / packaging / pickup / legal: admin order page with the
 * returns panel, refunds queue, packaging catalog + operations + order,
 * settings (pickup billing), legal admin; seller packaging store, order,
 * wallet, agreement; public terms page + acceptance gate.
 * Temporary users / store / orders are created and removed again.
 * Reproduce: node --env-file=.env scripts/ops-phase-screens.mjs <outdir>
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "evidence/ops-phase";
const STAMP = Date.now();
const PWD = `Tmp#${crypto.randomBytes(6).toString("hex")}9a`;
fs.mkdirSync(OUT, { recursive: true });
const made = [];
const cleanup = { vendorId: null, orderId: null, pkgOrders: [], stock: [] };

async function makeUser(role, tag, acceptTerms = true) {
  const email = `ops-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({
    email, password: PWD, email_confirm: true,
    user_metadata: acceptTerms ? { terms_version: "2.0", full_name: `Ops ${tag}` } : { full_name: `Ops ${tag}` },
  });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  made.push(u.user.id);
  return { id: u.user.id, email };
}
const signIn = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PWD });
  if (error) throw new Error(error.message);
  return c;
};

async function main() {
  const admin = await makeUser("admin", "a");
  const seller = await makeUser("vendor", "v");
  const buyer = await makeUser("customer", "c");
  const fresh = await makeUser("customer", "n", false); // no acceptance → gate
  const adminC = await signIn(admin.email);
  const sellerC = await signIn(seller.email);
  const { data: cat } = await svc.from("categories").select("id").eq("depth", 1).is("deleted_at", null).limit(1);
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("id", 17).single();
  const on = await sellerC.rpc("fn_vendor_onboard", { p_data: {
    store_name_ar: `متجر عمليات ${STAMP}`, store_name_en: `Ops Store ${STAMP}`, category_ids: cat.map((c) => c.id),
    first_name: "تجربة", last_name: "عمليات", governorate_id: area.governorate_id, area_id: area.id, address1: "شارع التجربة",
    terms_version: "1.0", terms_signature: "Ops Seller" } });
  if (on.error) throw new Error(on.error.message);
  cleanup.vendorId = on.data.vendor_id;
  const ap = await adminC.rpc("fn_admin_review_vendor", { p_vendor_id: cleanup.vendorId, p_decision: "approve" });
  if (ap.error) throw new Error(ap.error.message);

  // packaging: give stock, place a COD order and a split order paid by an admin-recorded payment
  const { data: items } = await svc.from("packaging_items").select("id, sku, stock_base").in("sku", ["ENV-S-01", "BUB-50-50"]);
  cleanup.stock = items;
  for (const i of items) await svc.from("packaging_items").update({ stock_base: i.stock_base + 500 }).eq("id", i.id);
  const env = items.find((i) => i.sku === "ENV-S-01").id;
  const bub = items.find((i) => i.sku === "BUB-50-50").id;
  const split = await sellerC.rpc("fn_vendor_place_packaging_order", { p_payload: { attempt_key: crypto.randomUUID(), plan: "split", method: "card",
    items: [{ item_id: env, unit: "piece", qty: 20 }, { item_id: bub, unit: "roll", qty: 1 }, { item_id: bub, unit: "meter", qty: 15 }] } });
  console.log("split", JSON.stringify(split.data ?? split.error));
  const paid = await adminC.rpc("fn_admin_packaging_record_payment", { p_order_id: split.data.id, p_amount: split.data.due_now_piastres, p_reference: `TR-${STAMP}`, p_note: "screens" });
  console.log("record", JSON.stringify(paid.data ?? paid.error));
  const cod = await sellerC.rpc("fn_vendor_place_packaging_order", { p_payload: { attempt_key: crypto.randomUUID(), plan: "full", method: "cod",
    items: [{ item_id: env, unit: "piece", qty: 5 }] } });
  cleanup.pkgOrders = [split.data.id, cod.data.id];

  // a delivered 2-line customer order for the returns panel
  const { data: variant } = await svc.from("variants").select("id, product_id, products(leaf_category_id)").gt("stock", 0).limit(1).single();
  const orderId = crypto.randomUUID(); const groupId = crypto.randomUUID();
  const number = `OPS-${String(STAMP).slice(-6)}`;
  let r = await svc.from("orders").insert({ id: orderId, number, attempt_key: crypto.randomUUID(), user_id: buyer.id, email: buyer.email,
    phone_primary: "+201011112222", phone_alternate: "+201011113333", ship_name: "Buyer Ops", governorate_id: area.governorate_id, area_id: area.id,
    address1: "addr", status: "completed", payment_method: "kashier", payment_status: "paid", subtotal_piastres: 40000, discount_piastres: 0,
    shipping_fee_piastres: 5000, total_piastres: 45000, delivered_at: new Date().toISOString() });
  if (r.error) throw new Error(r.error.message);
  cleanup.orderId = orderId;
  await svc.from("order_vendor_groups").insert({ id: groupId, order_id: orderId, vendor_id: cleanup.vendorId, status: "delivered", shipping_mode: "platform",
    vendor_ship_status: "not_required", items_subtotal_piastres: 40000, discount_piastres: 0, commission_piastres: 2000, delivered_at: new Date().toISOString() });
  r = await svc.from("order_items").insert([
    { order_id: orderId, group_id: groupId, vendor_id: cleanup.vendorId, variant_id: variant.id, product_id: variant.product_id, leaf_category_id: variant.products.leaf_category_id,
      product_name_ar: "قميص قطن", product_name_en: "Cotton shirt", unit_price_piastres: 10000, qty: 2, line_total_piastres: 20000, coupon_discount_piastres: 0, commission_piastres: 1000, commission_rate_bps: 500 },
    { order_id: orderId, group_id: groupId, vendor_id: cleanup.vendorId, variant_id: variant.id, product_id: variant.product_id, leaf_category_id: variant.products.leaf_category_id,
      product_name_ar: "بنطلون جينز", product_name_en: "Denim jeans", unit_price_piastres: 20000, qty: 1, line_total_piastres: 20000, coupon_discount_piastres: 0, commission_piastres: 1000, commission_rate_bps: 500 }]);
  if (r.error) throw new Error(r.error.message);
  const { data: lines } = await svc.from("order_items").select("id, qty").eq("order_id", orderId).order("qty", { ascending: false });
  const ret = await adminC.rpc("fn_admin_create_return", { p_order_id: orderId, p_payload: { note: "screens", logistics_status: "awaiting_return",
    items: [{ order_item_id: lines[0].id, qty: 1, reason: "change_of_mind", restock: true }] } });
  console.log("return", JSON.stringify(ret.data ?? ret.error));

  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const shots = async (email, list) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle" });
    await page.fill("input[name=identifier]", email);
    await page.fill("input[name=password]", PWD);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => !location.pathname.includes("/auth"), { timeout: 30000 }).catch(() => undefined);
    for (const [name, path] of list) {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
        console.log(`${res?.status()} ${name}@${width} overflow=${overflow} at=${new URL(page.url()).pathname}`);
      }
    }
    await ctx.close();
  };
  await shots(admin.email, [
    ["admin-order-returns", `/ar/admin/orders/${number}`],
    ["admin-order-returns-en", `/en/admin/orders/${number}`],
    ["admin-refunds", `/ar/admin/refunds?status=approved`],
    ["admin-packaging", `/ar/admin/packaging`],
    ["admin-packaging-ops", `/ar/admin/packaging/orders`],
    ["admin-packaging-balances", `/ar/admin/packaging/orders?tab=balances`],
    ["admin-packaging-order", `/ar/admin/packaging/orders/${split.data.number}`],
    ["admin-settings", `/ar/admin/settings/sections`],
    ["admin-legal", `/ar/admin/legal`],
  ]);
  await shots(seller.email, [
    ["vendor-packaging", `/ar/vendor/packaging`],
    ["vendor-packaging-en", `/en/vendor/packaging`],
    ["vendor-packaging-orders", `/ar/vendor/packaging/orders`],
    ["vendor-packaging-order", `/ar/vendor/packaging/orders/${split.data.number}`],
    ["vendor-wallet", `/ar/vendor/wallet`],
    ["vendor-agreement", `/ar/vendor/agreement`],
  ]);
  await shots(fresh.email, [
    ["gate-accept", `/ar/account`],
    ["legal-terms", `/ar/legal/terms`],
    ["legal-terms-en", `/en/legal/terms`],
  ]);
  // printable documents (admin)
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle" });
  await page.fill("input[name=identifier]", admin.email);
  await page.fill("input[name=password]", PWD);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !location.pathname.includes("/auth"), { timeout: 30000 }).catch(() => undefined);
  for (const doc of ["invoice", "label"]) {
    const res = await page.goto(`${BASE}/packaging/${split.data.number}/print/${doc}?lang=ar`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/print-${doc}.png`, fullPage: true });
    console.log(`${res?.status()} print-${doc}`);
  }
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error("ERR", e.message); process.exitCode = 1; }).finally(async () => {
  if (cleanup.orderId) {
    const { data: reqs } = await svc.from("refund_requests").select("id").eq("order_id", cleanup.orderId);
    await svc.from("pickup_charges").delete().eq("order_id", cleanup.orderId);
    await svc.from("wallet_transactions").delete().eq("order_id", cleanup.orderId);
    await svc.from("vendor_penalties").delete().in("reference", (reqs ?? []).map((x) => `penalty:${x.id}:${cleanup.vendorId}`));
    await svc.from("orders").delete().eq("id", cleanup.orderId);
  }
  if (cleanup.vendorId) {
    await svc.from("wallet_transactions").delete().eq("vendor_id", cleanup.vendorId);
    await svc.from("packaging_balances").delete().eq("vendor_id", cleanup.vendorId);
    await svc.from("packaging_returns").delete().eq("vendor_id", cleanup.vendorId);
    await svc.from("packaging_orders").delete().eq("vendor_id", cleanup.vendorId);
    await svc.from("legal_acceptances").delete().eq("vendor_id", cleanup.vendorId);
    await svc.from("vendor_status_history").delete().eq("vendor_id", cleanup.vendorId);
    await svc.from("wallets").delete().eq("vendor_id", cleanup.vendorId);
    const { error } = await svc.from("vendors").delete().eq("id", cleanup.vendorId);
    if (error) console.log("cleanup vendor:", error.message);
  }
  for (const i of cleanup.stock) await svc.from("packaging_items").update({ stock_base: i.stock_base }).eq("id", i.id);
  for (const id of made) {
    await svc.from("legal_acceptances").delete().eq("user_id", id);
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) console.log("cleanup user:", error.message);
  }
  console.log("cleaned");
});
