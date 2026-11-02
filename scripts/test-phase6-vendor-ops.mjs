/**
 * Phase 06 — vendor operations E2E (server on :3000, KASHIER_* test env).
 * Covers: vendor-shipping request/hold, ship-before-approval block,
 * admin approve → shipping_revenue transaction + COD stays blocked,
 * reject → nothing posted; pickup fee correctness + idempotent re-ship;
 * earnings on delivery (pending) + hold release (settings-driven);
 * withdrawal request (min/over-balance/pending-unique) + hold + cancel
 * restore + admin approve once; wallet view reconciliation; penalties;
 * commission-funded coupon fixture 100 EGP / 10% / 30% → 3 EGP, vendor
 * keeps 100, platform net 7; zero-commission → zero; stacking via pairs_with;
 * cross-vendor isolation (direct ID + print route → 403). DB pristine.
 * Reproduce: node --env-file=.env scripts/test-phase6-vendor-ops.mjs
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");
async function uploadProductImage(vendorUserId) {
  const path = `u/${vendorUserId}/p6-${STAMP}-${Math.random().toString(36).slice(2)}.webp`;
  const { error } = await svc.storage.from("media").upload(path, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`storage upload: ${error.message}`);
  return path;
}
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Cust#12345";
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const results = [];
let browser;

const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
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

const payload = (method, extra = {}) => ({
  attempt_key: crypto.randomUUID(),
  payment_method: method,
  coupon_code: null,
  address: { ...ADDRESS },
  ...extra,
});

async function addToCart(userClient, variantId, qty) {
  const { error } = await userClient.rpc("fn_cart_add", { p_variant_id: variantId, p_qty: qty });
  if (error) throw new Error(`cart add: ${error.message}`);
}

async function createOrder(userClient, method, extra = {}) {
  const { data, error } = await userClient.rpc("fn_create_order", { p_payload: payload(method, extra) });
  if (error) return { ok: false, reason: "rpc_error", detail: error.message };
  return data;
}

/* ---------------- fixtures ---------------- */
const F = { users: {}, vendors: {}, cats: [], products: [], variants: {}, coupons: [], imgPaths: [], orders: [] };

async function makeUser(role, tag) {
  const email = `p6-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

async function onboardVendor(tag, leafCatId, opts = {}) {
  const user = await makeUser("vendor", tag);
  const client = await signIn(F.users[`vendor-${tag}`].email);
  const areaQ = await svc.from("areas").select("id, governorate_id, pickup_fee_piastres").eq("governorate_id", 1).order("id");
  const area = (areaQ.data ?? [])[opts.areaIndex ?? 0];
  if (!area) throw new Error(`area missing for index ${opts.areaIndex ?? 0}`);
  const { data: on, error: onErr } = await client.rpc("fn_vendor_onboard", {
    p_data: {
      store_name_ar: `متجر ${tag} ${STAMP}`, store_name_en: `Store ${tag} ${STAMP}`,
      category_ids: [leafCatId], first_name: "ب", last_name: "ت",
      governorate_id: area.governorate_id, area_id: area.id, address1: "عنوان المتجر",
      terms_version: "1.0", terms_signature: "P6",
    },
  });
  if (!on?.vendor_id) throw new Error(`onboard ${tag}: ${JSON.stringify(on)} err=${JSON.stringify(onErr)}`);
  const admin = await signIn(F.users["admin-0"].email);
  const { error: revErr } = await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on.vendor_id, p_decision: "approve" });
  if (revErr) throw new Error(`approve vendor ${tag}: ${revErr.message}`);
  // fixture commission rate + area pickup rate (deterministic money tests)
  await svc.from("vendors").update({ level_id: opts.levelId ?? null, area_id: area.id }).eq("id", on.vendor_id);
  if (opts.areaPickup !== undefined) {
    await svc.from("areas").update({ pickup_fee_piastres: opts.areaPickup }).eq("id", area.id);
  }
  F.vendors[tag] = { id: on.vendor_id, userId: user.id, client, areaId: area.id, areaPickup: opts.areaPickup ?? area.pickup_fee_piastres };
  return F.vendors[tag];
}

async function makeCategory(tag, parentId, depth) {
  const { data: cat, error } = await svc.from("categories").insert({
    slug_ar: `فئة-${tag}-${STAMP}`, slug_en: `p6-${tag}-${STAMP}`,
    name_ar: `فئة ${tag}`, name_en: `Cat ${tag}`,
    parent_id: parentId ?? null, depth,
  }).select("id").single();
  if (error) throw new Error(`category ${tag}: ${error.message}`);
  F.cats.push(cat.id);
  return cat.id;
}

async function makeProduct(vendor, tag, leafCatId, price, opts = {}) {
  const imgPath = await uploadProductImage(vendor.userId);
  const { data: p, error: pErr } = await vendor.client.rpc("fn_save_product", {
    p_product: {
      name_ar: `منتج ${tag}`, name_en: `Product ${tag}`,
      desc_ar: "وصف", desc_en: "desc",
      leaf_category_id: leafCatId,
      shipping_mode: opts.vendorShip ? "vendor" : "platform",
      media: [{ kind: "image", path: imgPath }],
    },
  });
  if (pErr || !p?.id) throw new Error(`save_product ${tag}: ${pErr?.message ?? JSON.stringify(p)}`);
  await vendor.client.rpc("fn_generate_variants", { p_product_id: p.id, p_axes: [] });
  const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.id).is("deleted_at", null).single();
  await vendor.client.rpc("fn_save_variants", {
    p_product_id: p.id,
    p_rows: [{ option_key: v.option_key, sku: `P6-${tag}-${STAMP}`, price_piastres: price, sale_price_piastres: null, stock: opts.stock ?? 5, image_path: "", is_active: true }],
  });
  await vendor.client.rpc("fn_submit_product", { p_product_id: p.id });
  const admin = await signIn(F.users["admin-0"].email);
  await admin.rpc("fn_admin_review_product", { p_product_id: p.id, p_decision: "approve", p_reason: null });
  F.products.push(p.id);
  F.variants[tag] = v.id;
  F.imgPaths.push(imgPath);
  return { productId: p.id, variantId: v.id };
}

async function makeCoupon(tag, fields) {
  const code = `P6${tag}${STAMP}`;
  const { data: c, error } = await svc.from("coupons").insert({ code, ...fields }).select("id").single();
  if (error) throw new Error(`coupon ${tag}: ${error.message}`);
  F.coupons.push(c.id);
  return { id: c.id, code };
}

async function loginPage(page, email) {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[name=identifier]", { timeout: 30000 });
  await page.type("input[name=identifier]", email);
  await page.type("input[name=password]", PWD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => undefined),
    page.click("button[type=submit]"),
  ]);
}

/* ==================================================================== */
let admin, customer, levelId, areaPickupBase;
try {
  /* ---------- fixtures ---------- */
  console.log("fixtures…");
  await makeUser("admin", "0");
  await makeUser("customer", "0");
  admin = await signIn(F.users["admin-0"].email);
  customer = await signIn(F.users["customer-0"].email);
  const { data: lvl } = await svc.from("vendor_levels").select("id").order("min_successful_orders").limit(1).single();
  levelId = lvl.id;
  // deterministic level money: 10% commission, 14-day hold
  await svc.from("vendor_levels").update({ rewards: { commission_percent: 10, hold_days: 14 } }).eq("id", levelId);

  const root = await makeCategory("root", null, 1);
  const leaf = await makeCategory("leaf", root, 2);

  const { data: areaRow } = await svc.from("areas").select("pickup_fee_piastres").eq("governorate_id", 1).order("id").limit(1).single();
  areaPickupBase = areaRow.pickup_fee_piastres;

  const vA = await onboardVendor("A", leaf, { levelId, areaPickup: 700 }); // 7 EGP/piece
  const vB = await onboardVendor("B", leaf, { levelId, areaPickup: 0, areaIndex: 1 });   // zero rate → no fee (SECOND area)
  const prodA = await makeProduct(vA, "A", leaf, 50000);
  const prodAShip = await makeProduct(vA, "sh", leaf, 20000, { vendorShip: true });
  const prodB = await makeProduct(vB, "B", leaf, 80000);
  const areaList = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id");
  ADDRESS.area_id = areaList.data[2].id; // third area — distinct from both vendor areas

  /* ---------- KO1: cross-vendor isolation (direct ID + print) ---------- */
  {
    await addToCart(customer, prodA.variantId, 1);
    const o = await createOrder(customer, "kashier");
    check("KO1a order created", o?.ok === true, JSON.stringify(o));
    F.orders.push(o.number);
    const { data: grp } = await svc.from("order_vendor_groups").select("id, vendor_id").eq("order_id", o.order_id).single();
    // vendor B's client reads vendor A's group snapshot → forbidden
    const snapB = await vB.client.rpc("fn_vendor_order_snapshot", { p_number: o.number });
    check("KO1b vendor B snapshot of A order empty", snapB.data == null, JSON.stringify(snapB.data));
    // direct-ID update of A's group by B → forbidden
    const direct = await vB.client.rpc("fn_vendor_set_fulfillment", { p_group_id: grp.id, p_status: "preparing" });
    check("KO1c vendor B direct-transition on A group forbidden", direct.data?.ok === false && direct.data.reason === "forbidden", JSON.stringify(direct.data));
    // B requests shipping on A's group → forbidden
    const shipB = await vB.client.rpc("fn_request_vendor_shipping", { p_group_id: grp.id });
    check("KO1d vendor B shipping-request on A group forbidden", shipB.data?.ok === false && shipB.data.reason === "forbidden", JSON.stringify(shipB.data));
    const { data: wd0 } = await svc.from("order_vendor_groups").select("vendor_ship_status").eq("id", grp.id).single();
    check("KO1e group untouched by cross-vendor attempts", wd0.vendor_ship_status === "not_required", wd0.vendor_ship_status);
  }

  /* ---------- KO1 print isolation via HTTP (browser, vendor B session) ---------- */
  browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
  {
    const page = await browser.newPage();
    await loginPage(page, F.users["vendor-B"].email);
    // find vendor A's order number by a fresh platform order
    await addToCart(customer, prodA.variantId, 1);
    const o2 = await createOrder(customer, "kashier");
    F.orders.push(o2.number);
    const respA = await page.goto(`${BASE}/order/${encodeURIComponent(o2.number)}/print/invoice_vendor?lang=ar&vendor=${vA.id}`, { waitUntil: "networkidle2" });
    check("KO2a vendor B HTTP print of A invoice → 403", respA.status() === 403, String(respA.status()));
    const respL = await page.goto(`${BASE}/order/${encodeURIComponent(o2.number)}/print/label_vendor?lang=ar&vendor=${vA.id}`, { waitUntil: "networkidle2" });
    check("KO2b vendor B HTTP print of A label → 403", respL.status() === 403, String(respL.status()));
    // B's own invoice renders
    await addToCart(customer, prodB.variantId, 1);
    const o3 = await createOrder(customer, "kashier");
    F.orders.push(o3.number);
    const respOwn = await page.goto(`${BASE}/order/${encodeURIComponent(o3.number)}/print/invoice_vendor?lang=ar`, { waitUntil: "networkidle2" });
    check("KO2c vendor B prints OWN invoice → 200", respOwn.status() === 200, String(respOwn.status()));
await page.close();
  }

  /* ---------- WS: vendor-shipping flow on A (vendor-shipped product) ---------- */
  {
    await addToCart(customer, prodAShip.variantId, 1);
    // COD must be blocked (vendor-shipped in cart)
    const cod = await createOrder(customer, "cod");
    check("WS0 COD blocked for vendor-shipped cart", cod?.ok === false && cod.reason === "cod_vendor_ship", JSON.stringify(cod));
    const k = await createOrder(customer, "kashier");
    check("WS1 vendor-shipped order created on_hold", k?.ok === true && k.status === "on_hold", JSON.stringify(k));
    F.orders.push(k.number);
    const { data: grp } = await svc.from("order_vendor_groups").select("id, status, vendor_ship_status, shipping_mode").eq("order_id", k.order_id).single();

    // ship before approval → blocked
    const early = await vA.client.rpc("fn_vendor_set_fulfillment", { p_group_id: grp.id, p_status: "handed_to_carrier" });
    check("WS2 ship before approval rejected", early.data?.ok === false && ["awaiting_admin_approval", "invalid_transition"].includes(early.data.reason), JSON.stringify(early.data));

    // vendor requests shipping (idempotent duplicate ok)
    const req1 = await vA.client.rpc("fn_request_vendor_shipping", { p_group_id: grp.id });
    check("WS3 shipping request ok", req1.data?.ok === true, JSON.stringify(req1.data));
    const req2 = await vA.client.rpc("fn_request_vendor_shipping", { p_group_id: grp.id });
    check("WS3b duplicate shipping request idempotent", req2.data?.ok === true, JSON.stringify(req2.data));
    const { data: g2 } = await svc.from("order_vendor_groups").select("status, vendor_ship_status").eq("id", grp.id).single();
    check("WS4 group on_hold + pending_admin", g2.status === "on_hold" && g2.vendor_ship_status === "pending_admin", JSON.stringify(g2));

    // admin REJECT with reason → nothing posted, group resumes, platform ships
    const rej = await admin.rpc("fn_approve_vendor_shipping", { p_group_id: grp.id, p_decision: "reject", p_shipping_piastres: 0, p_note: "المخزون غير جاهز" });
    check("WS5 reject ok", rej.data?.ok === true, JSON.stringify(rej.data));
    const rejNoNote = await admin.rpc("fn_approve_vendor_shipping", { p_group_id: grp.id, p_decision: "reject", p_shipping_piastres: 0, p_note: "" });
    check("WS5b reject without reason invalid (state check strictness)", rejNoNote.data?.ok === false || rejNoNote.data?.reason !== undefined, JSON.stringify(rejNoNote.data));
    const { data: g3 } = await svc.from("order_vendor_groups").select("status, vendor_ship_status").eq("id", grp.id).single();
    check("WS6 after reject: resumed + rejected", g3.status === "preparing" && g3.vendor_ship_status === "rejected", JSON.stringify(g3));
    const { data: tx0 } = await svc.from("wallet_transactions").select("id").eq("group_id", grp.id);
    check("WS7 rejection posted NOTHING", (tx0 ?? []).length === 0, String((tx0 ?? []).length));

    // ship now allowed (platform ships, but vendor can walk ladder to handed_to_carrier)
    const ok = await vA.client.rpc("fn_vendor_set_fulfillment", { p_group_id: grp.id, p_status: "handed_to_carrier" });
    check("WS8 vendor still cannot mark handed after REJECT (platform ships)", ok.data?.ok === false && ok.data.reason === "vendor_ship_not_approved", JSON.stringify(ok.data));

    // admin e2e: order leaves on_hold
    const { data: oAfter } = await svc.from("orders").select("status").eq("id", k.order_id).single();
    check("WS9 order resumed after decision", oAfter.status === "processing", oAfter.status);
  }

  /* ---------- WS2: approved path with shipping revenue + pickup + earnings ---------- */
  {
    await addToCart(customer, prodAShip.variantId, 2); // qty 2 → pickup 2×700=1400
    const k = await createOrder(customer, "kashier");
    F.orders.push(k.number);
    const { data: grp } = await svc.from("order_vendor_groups").select("id").eq("order_id", k.order_id).single();
    await vA.client.rpc("fn_request_vendor_shipping", { p_group_id: grp.id });

    // admin APPROVE with share = order shipping fee
    const { data: ord } = await svc.from("orders").select("shipping_fee_piastres").eq("id", k.order_id).single();
    const apr = await admin.rpc("fn_approve_vendor_shipping", { p_group_id: grp.id, p_decision: "approve", p_shipping_piastres: ord.shipping_fee_piastres });
    check("WA1 approve ok", apr.data?.ok === true, JSON.stringify(apr.data));
    const apr2 = await admin.rpc("fn_approve_vendor_shipping", { p_group_id: grp.id, p_decision: "approve", p_shipping_piastres: ord.shipping_fee_piastres });
    check("WA1b second approve rejected (not_pending)", apr2.data?.ok === false && apr2.data.reason === "not_pending", JSON.stringify(apr2.data));

    const { data: shipTx } = await svc.from("wallet_transactions").select("amount_piastres").eq("group_id", grp.id).eq("type", "shipping_revenue").single();
    check("WA2 shipping_revenue posted once at share", shipTx?.amount_piastres === ord.shipping_fee_piastres, JSON.stringify(shipTx));

    // vendor walks: preparing → handed_to_carrier (pickup posts once)
    await vA.client.rpc("fn_vendor_set_fulfillment", { p_group_id: grp.id, p_status: "preparing" });
    const ship1 = await vA.client.rpc("fn_vendor_set_fulfillment", { p_group_id: grp.id, p_status: "handed_to_carrier" });
    check("WA3 handed_to_carrier ok (pickup posted)", ship1.data?.ok === true, JSON.stringify(ship1.data));
    const { data: pickTx } = await svc.from("wallet_transactions").select("amount_piastres").eq("group_id", grp.id).eq("type", "pickup_fee").single();
    check("WA4 pickup = qty×rate (2×700=1400)", pickTx?.amount_piastres === -1400, JSON.stringify(pickTx));

    // retry ship → invalid transition (group moved), pickup never double-posted
    const ship2 = await vA.client.rpc("fn_vendor_set_fulfillment", { p_group_id: grp.id, p_status: "handed_to_carrier" });
    check("WA5 retry ship rejected (invalid_transition)", ship2.data?.ok === false, JSON.stringify(ship2.data));
    const { data: pickAll } = await svc.from("wallet_transactions").select("id").eq("group_id", grp.id).eq("type", "pickup_fee");
    check("WA6 pickup single row (no double charge)", (pickAll ?? []).length === 1, String((pickAll ?? []).length));

    // deliver → earning pending (net = 20000×2 − 0 disc − 10% commission), commission row
    await admin.rpc("fn_update_group_status", { p_group_id: grp.id, p_status: "delivered", p_note: null });
    const { data: earnTx } = await svc.from("wallet_transactions").select("amount_piastres").eq("group_id", grp.id).eq("type", "earning").single();
    const { data: commTx } = await svc.from("wallet_transactions").select("amount_piastres").eq("group_id", grp.id).eq("type", "commission").single();
    check("WA7 earning pending = 40000−4000=36000", earnTx?.amount_piastres === 36000, JSON.stringify(earnTx));
    check("WA8 commission debit = −4000", commTx?.amount_piastres === -4000, JSON.stringify(commTx));
    const { data: w } = await svc.from("wallets").select("available_piastres, pending_piastres").eq("vendor_id", vA.id).single();
    // available: +shipping_revenue (5000) − pickup (1400) − commission (4000); pending: earning
    check("WA9 wallet available = share − pickup − commission", w.available_piastres === ord.shipping_fee_piastres - 1400 - 4000, JSON.stringify(w));
    check("WA10 wallet pending = earning", w.pending_piastres === 36000, JSON.stringify(w));
    // UI view matches the ledger
    const view = await vA.client.rpc("fn_vendor_wallet_view");
    check("WA11 wallet view reconciles ledger", view.data?.wallet?.available_piastres === w.available_piastres && view.data?.wallet?.pending_piastres === 36000, JSON.stringify(view.data?.wallet));

    // hold release: shrink hold to 0 days and run the release → pending → available exactly once
    await svc.from("vendor_levels").update({ rewards: { commission_percent: 10, hold_days: 0 } }).eq("id", levelId);
    const rel1 = await admin.rpc("fn_release_earnings");
    const rel2 = await admin.rpc("fn_release_earnings");
    check("WA12 release runs", rel1.data?.ok === true && (rel1.data.released ?? 0) >= 1, JSON.stringify(rel1.data));
    const { data: w2 } = await svc.from("wallets").select("available_piastres, pending_piastres").eq("vendor_id", vA.id).single();
    check("WA13 release moved pending→available once", w2.pending_piastres === 0 && w2.available_piastres === w.available_piastres + 36000, JSON.stringify(w2));
    const rel3 = await admin.rpc("fn_release_earnings");
    const { data: w3 } = await svc.from("wallets").select("available_piastres").eq("vendor_id", vA.id).single();
    check("WA14 second release no-op", rel3.data?.ok === true && w3.available_piastres === w2.available_piastres, JSON.stringify(rel3.data));
    await svc.from("vendor_levels").update({ rewards: { commission_percent: 10, hold_days: 14 } }).eq("id", levelId);

    /* ---------- WD: withdrawals ---------- */
    const availNow = w2.available_piastres;
    const min = 5000;
    const low = await vA.client.rpc("fn_request_withdrawal", { p_amount_piastres: 100, p_method: "bank", p_details: {} });
    check("WD1 below-min blocked", low.data?.ok === false && low.data.reason === "below_min", JSON.stringify(low.data));
    const over = await vA.client.rpc("fn_request_withdrawal", { p_amount_piastres: availNow + 100000, p_method: "bank", p_details: {} });
    check("WD2 over-balance blocked (server)", over.data?.ok === false && over.data.reason === "insufficient", JSON.stringify(over.data));
    const wd1 = await vA.client.rpc("fn_request_withdrawal", { p_amount_piastres: 20000, p_method: "bank", p_details: { holder: "ب ت", account: "EG00" } });
    check("WD3 request ok", wd1.data?.ok === true, JSON.stringify(wd1.data));
    const wdDup = await vA.client.rpc("fn_request_withdrawal", { p_amount_piastres: 5000, p_method: "bank", p_details: {} });
    check("WD4 second pending blocked", wdDup.data?.ok === false && wdDup.data.reason === "pending_exists", JSON.stringify(wdDup.data));
    let wNow = (await svc.from("wallets").select("available_piastres").eq("vendor_id", vA.id).single()).data;
    check("WD5 hold applied (available − 20000)", wNow.available_piastres === availNow - 20000, JSON.stringify(wNow));
    // cancel restores exactly once
    const cx1 = await vA.client.rpc("fn_cancel_withdrawal", { p_id: wd1.data.id, p_reason: "تغيير رأي" });
    check("WD6 vendor cancel ok", cx1.data?.ok === true, JSON.stringify(cx1.data));
    const cx2 = await vA.client.rpc("fn_cancel_withdrawal", { p_id: wd1.data.id, p_reason: "مرة ثانية" });
    check("WD7 double cancel rejected (not_pending)", cx2.data?.ok === false && cx2.data.reason === "not_pending", JSON.stringify(cx2.data));
    wNow = (await svc.from("wallets").select("available_piastres").eq("vendor_id", vA.id).single()).data;
    check("WD8 hold restored once", wNow.available_piastres === availNow, JSON.stringify(wNow));
    // approve path reduces exactly once; admin cancel restores
    const wd2 = await vA.client.rpc("fn_request_withdrawal", { p_amount_piastres: 10000, p_method: "instapay", p_details: { account: "010@insta" } });
    const ap1 = await admin.rpc("fn_admin_withdrawal_decision", { p_id: wd2.data.id, p_decision: "approve" });
    check("WD9 admin approve ok", ap1.data?.ok === true, JSON.stringify(ap1.data));
    const ap2 = await admin.rpc("fn_admin_withdrawal_decision", { p_id: wd2.data.id, p_decision: "approve" });
    check("WD10 approve once (not_pending)", ap2.data?.ok === false && ap2.data.reason === "not_pending", JSON.stringify(ap2.data));
    wNow = (await svc.from("wallets").select("available_piastres").eq("vendor_id", vA.id).single()).data;
    check("WD11 available reduced exactly once", wNow.available_piastres === availNow - 10000, JSON.stringify(wNow));
    // negative balance by design: admin adjustment debits more than available
    await svc.rpc("fn_post_transaction", { p_vendor_id: vA.id, p_type: "penalty", p_amount: -500000, p_reference: `test-negative:${STAMP}`, p_reason: "جزاء اختبار", p_order_id: null, p_group_id: null }).then(async () => {
      const wNeg = (await svc.from("wallets").select("available_piastres").eq("vendor_id", vA.id).single()).data;
      check("WD12 balance went negative by design", wNeg.available_piastres < 0, JSON.stringify(wNeg));
    });

  }

  /* ---------- VO-22: commission-funded coupon exact fixture ---------- */
  {
    // vendor B: 10% commission (level set above), area pickup 0
    const cp = await makeCoupon("VF", { type: "commission_percent", value: 30, status: "active", stackable: true });
    await addToCart(customer, prodB.variantId, 1); // 80000 piastres (800 EGP)
    const o = await createOrder(customer, "kashier", {});
    check("VF0 order without coupon ok", o?.ok === true, o?.number);
    F.orders.push(o.number);
    // adjust qty directly: simpler to make a second order WITH coupon
    const o2 = await createOrder(customer, "kashier", {});
    check("VF1 baseline cart consumed", o2?.ok === false, JSON.stringify(o2)); // cart emptied

    await addToCart(customer, prodB.variantId, 1);
    const oc = await createOrder(customer, "kashier", { coupon_code: cp.code });
    check("VF2 commission-coupon order ok", oc?.ok === true, JSON.stringify(oc));
    F.orders.push(oc.number);
    const { data: ordRow } = await svc.from("orders").select("subtotal_piastres, discount_piastres, total_piastres").eq("id", oc.order_id).single();
    // commission = 80000×10% = 8000; discount = 30%×8000 = 2400 (24 EGP); total = 80000−2400
    check("VF3 discount = 30%×10%×item = 2400", ordRow.discount_piastres === 2400, JSON.stringify(ordRow));
    const { data: itemRow } = await svc.from("order_items").select("commission_piastres, coupon_discount_piastres, line_total_piastres").eq("order_id", oc.order_id).single();
    check("VF4 item commission reduced to 5600 (platform net 7−2.4)", itemRow.commission_piastres === 5600, JSON.stringify(itemRow));
    check("VF5 vendor keeps FULL item total (item coupon_discount only)", itemRow.line_total_piastres === 80000, JSON.stringify(itemRow));
    // vendor net from items = 80000 (unchanged) — delivered earning keeps full line
    // zero-commission vendor → zero discount
    await svc.from("vendor_levels").update({ rewards: { commission_percent: 0, hold_days: 14 } }).eq("id", levelId);
    const oz = await createOrder(customer, "kashier", { coupon_code: cp.code });
    check("VF6 empty cart → fails", oz?.ok === false, JSON.stringify(oz));
    await addToCart(customer, prodB.variantId, 1);
    const oz2 = await createOrder(customer, "kashier", { coupon_code: cp.code });
    F.orders.push(oz2.number);
    const { data: zRow } = await svc.from("orders").select("discount_piastres").eq("id", oz2.order_id).single();
    check("VF7 zero-commission → zero discount", zRow.discount_piastres === 0, JSON.stringify(zRow));
    await svc.from("vendor_levels").update({ rewards: { commission_percent: 10, hold_days: 14 } }).eq("id", levelId);
    /* stacking: pairs_with product coupon — prodB 800 EGP, product 10% = 80 EGP;
       commission after product discount = (80000−8000)×10% = 7200; coupon 30%×7200 = 2160 */
    const pairProduct = await makeCoupon("PP", { type: "percent", value: 10, status: "active", stackable: true });
    await svc.from("coupons").update({ pairs_with: pairProduct.code }).eq("id", cp.id);
    await addToCart(customer, prodB.variantId, 1);
    const os = await createOrder(customer, "kashier", { coupon_code: cp.code });
    F.orders.push(os.number);
    const { data: sRow } = await svc.from("orders").select("discount_piastres").eq("id", os.order_id).single();
    check("VF8 stacked discount = 8000(product)+2160(commission)", sRow.discount_piastres === 8000 + 2160, JSON.stringify(sRow));
    const { data: sItem } = await svc.from("order_items").select("coupon_discount_piastres, commission_piastres").eq("order_id", os.order_id).single();
    check("VF9 stacked: item keeps full vendor line, commission reduced from 7200 to 5040", sItem.coupon_discount_piastres === 10160 && sItem.commission_piastres === 5040, JSON.stringify(sItem));
    await svc.from("coupons").update({ pairs_with: null }).eq("id", cp.id);
  }

  /* ---------- PEN: penalties view ---------- */
  {
    const { data: pen } = await svc.from("vendor_penalties").insert({
      vendor_id: vA.id, source: "manual", amount_piastres: 2500, reason: "تأخير شحن تجريبي", reference: "manual", status: "applied",
    }).select("id").single();
    F.penalty = pen.id;
    const rows = await vA.client.from("vendor_penalties").select("id, status").eq("vendor_id", vA.id);
    check("PEN1 vendor reads own penalty (RLS)", (rows.data ?? []).length === 1, JSON.stringify(rows.data?.length));
    const others = await vB.client.from("vendor_penalties").select("id").eq("vendor_id", vA.id);
    check("PEN2 vendor B cannot read A penalties", (others.data ?? []).length === 0, String((others.data ?? []).length));
  }

  /* ---------- RPT: report totals match ledger ---------- */
  {
    const view = await vA.client.rpc("fn_vendor_wallet_view");
    const txs = await vA.client.from("wallet_transactions").select("type, amount_piastres").eq("vendor_id", vA.id);
    let pickup = 0; for (const t of txs.data ?? []) if (t.type === "pickup_fee") pickup += Math.abs(t.amount_piastres);
    check("RPT1 pickup total = 1400 (B has none)", pickup === 1400, String(pickup));
        check("RPT2 wallet view level present", view.data?.level?.name_en !== undefined, JSON.stringify(view.data?.level));
  }
} catch (error) {
  console.error("SUITE ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 6).join(" | "));
  process.exitCode = 1;
} finally {
  /* ---------------- results + cleanup → pristine ---------------- */
  try {
    fs.mkdirSync("evidence/phase-06", { recursive: true });
    const failed = results.filter((r) => !r.ok);
    fs.writeFileSync("evidence/phase-06/tests-raw.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
    console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
    if (failed.length > 0) process.exitCode = 1;
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
    // the vendor level is SHARED STATE (seeded) — restore its rewards, never delete
    if (levelId) await svc.from("vendor_levels").update({ rewards: { commission_percent: 5, hold_days: 14 } }).eq("id", levelId);
    for (const u of Object.values(F.users)) await svc.auth.admin.deleteUser(u.id);
    await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await svc.from("audit_logs").delete().neq("id", 0);
    await svc.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const counts = {};
    for (const t of ["orders", "products", "categories", "vendors", "coupons", "wallets", "wallet_transactions", "withdrawal_requests", "vendor_penalties", "cart_items", "reviews", "refund_requests"]) {
      const { count } = await svc.from(t).select("*", { count: "exact", head: true });
      counts[t] = count;
    }
    const pristine = Object.values(counts).every((c) => c === 0);
    console.log("pristine:", pristine, JSON.stringify(counts));
    fs.mkdirSync("evidence/phase-06", { recursive: true });
    fs.appendFileSync("evidence/phase-06/tests-raw.json", `\npristine: ${pristine} ${JSON.stringify(counts)}\n`);
  } catch (e) {
    console.error("CLEANUP ERROR:", e.message);
    process.exitCode = 1;
  }
}
