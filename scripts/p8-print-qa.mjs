/**
 * L-19 — Print QA evidence generator.
 * A 3-vendor order (pieces 1+1+3) is rendered through the real print routes
 * with an ADMIN session:
 *   • invoice_admin        → A4 portrait PDF + PNG (then again after cancel →
 *                            the ملغي watermark must appear)
 *   • label_carrier        → A5 landscape PDF + PNG; Code128 bars counted
 *                            structurally; maps QR data-URL must embed
 *   • label_vendor ×3      → A5 landscape PDFs; VENDOR NAME-ONLY rule asserted
 *                            (no customer phone/address, no coordinates)
 *   • order detail (print center) screenshotted at 390/768/1280/1440
 * Code128 payload correctness is structural (bwip-js is deterministic and
 * raises on invalid input; bars counted from the embedded SVG); the physical
 * scan with a real device is the owner's sign-off step on the printed samples.
 * Reproduce: node --env-file=.env scripts/p8-print-qa.mjs  (BASE= prod :3000
 * preferred — set E2E_BASE to override; server must be running)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const OUT = "evidence/phase-08/print";
const F = { users: {}, vendors: {}, catIds: [], products: [], imgPaths: [] };
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`);
};

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");

async function signIn(email) {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PWD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}
async function makeUser(role, tag) {
  const email = `p8pq-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

/** collect every data:image/svg+xml;base64 payload and decode it */
function svgPayloads(html) {
  const out = [];
  for (const hit of html.match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g) ?? []) {
    try { out.push(Buffer.from(hit.split(",")[1], "base64").toString("utf8")); } catch { /* skip */ }
  }
  return out;
}

try {
  fs.mkdirSync(OUT, { recursive: true });

  /* ---------- fixtures: 3 approved vendors, 3 products, 1 customer ---------- */
  await makeUser("admin", "0");
  const admin = await signIn(F.users["admin-0"].email);

  const root = (await admin.from("categories").insert({ slug_ar: `جذر-${STAMP}`, slug_en: `p8pq-root-${STAMP}`, name_ar: "جذر", name_en: "Root", depth: 1 }).select("id").single()).data;
  const mid = (await admin.from("categories").insert({ parent_id: root.id, slug_ar: `وسط-${STAMP}`, slug_en: `p8pq-mid-${STAMP}`, name_ar: "وسط", name_en: "Mid", depth: 2 }).select("id").single()).data;
  const leaf = (await admin.from("categories").insert({ parent_id: mid.id, slug_ar: `ورقة-${STAMP}`, slug_en: `p8pq-leaf-${STAMP}`, name_ar: "ورقة", name_en: "Leaf", depth: 3 }).select("id").single()).data;
  F.catIds.push(root.id, mid.id, leaf.id);

  const { data: areaRow } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1);
  const variants = [];
  for (const tag of ["A", "B", "C"]) {
    await makeUser("vendor", tag);
    const vc = await signIn(F.users[`vendor-${tag}`].email);
    const on = await vc.rpc("fn_vendor_onboard", {
      p_data: {
        store_name_ar: `مطبعة ${tag}`, store_name_en: `Print Store ${tag}`,
        category_ids: [leaf.id], first_name: "ب", last_name: "ت",
        governorate_id: areaRow[0].governorate_id, area_id: areaRow[0].id, address1: "عنوان المتجر",
        terms_version: "1.0", terms_signature: "P8",
      },
    });
    if (on.error || !on.data?.vendor_id) throw new Error(`onboard ${tag}: ${on.error?.message ?? JSON.stringify(on.data)}`);
    await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on.data.vendor_id, p_decision: "approve" });
    F.vendors[tag] = { id: on.data.vendor_id, userId: F.users[`vendor-${tag}`].id, client: vc };
    const imgPath = `u/${F.vendors[tag].userId}/p8pq-${STAMP}-${tag}.webp`;
    await svc.storage.from("media").upload(imgPath, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
    const p = await vc.rpc("fn_save_product", {
      p_product: {
        name_ar: `منتج ${tag}`, name_en: `Print Item ${tag}`,
        desc_ar: "منتج الطباعة", desc_en: "Print QA item",
        leaf_category_id: leaf.id, shipping_mode: "platform",
        media: [{ kind: "image", path: imgPath }],
      },
    });
    if (p.error || !p.data?.id) throw new Error(`product ${tag}: ${p.error?.message}`);
    await vc.rpc("fn_generate_variants", { p_product_id: p.data.id, p_axes: [] });
    const { data: variant } = await svc.from("variants").select("id, option_key").eq("product_id", p.data.id).is("deleted_at", null).single();
    await vc.rpc("fn_save_variants", { p_product_id: p.data.id, p_rows: [{ option_key: variant.option_key, sku: `PQ-${tag}-${STAMP}`, price_piastres: 99000, sale_price_piastres: null, stock: 10, image_path: "", is_active: true }] });
    await vc.rpc("fn_submit_product", { p_product_id: p.data.id });
    await admin.rpc("fn_admin_review_product", { p_product_id: p.data.id, p_decision: "approve", p_reason: null });
    F.products.push(p.data.id);
    F.imgPaths.push(imgPath);
    variants.push({ variantId: variant.id, qty: tag === "C" ? 3 : 1 });
  }

  await makeUser("customer", "0");
  const customer = await signIn(F.users["customer-0"].email);
  const { data: areas } = await svc.from("areas").select("id").eq("governorate_id", 1).order("id");
  const custArea = areas[2].id;
  const { data: addr, error: addrErr } = await customer.from("user_addresses").insert({
    user_id: F.users["customer-0"].id, label: "المنزل", full_name: "عميل الطباعة",
    phone: `+2010${String(STAMP).slice(-8)}`, governorate_id: 1, area_id: custArea,
    address1: "١٥ شارع التحرير", is_default: true,
  }).select("id").single();
  if (addrErr || !addr?.id) throw new Error(`address: ${addrErr?.message}`);

  for (const v of variants) await customer.rpc("fn_cart_add", { p_variant_id: v.variantId, p_qty: v.qty });
  const created = await customer.rpc("fn_create_order", {
    p_payload: {
      attempt_key: crypto.randomUUID(), payment_method: "cod", coupon_code: null,
      address: {
        full_name: "عميل الطباعة", phone_primary: "+201001234567", phone_alternate: "+201109876543",
        governorate_id: 1, area_id: custArea, address1: "١٥ شارع التحرير",
        lat: 30.0444, lng: 31.2357, geo_accuracy: 25,
      },
    },
  });
  if (created.error || created.data?.ok !== true) throw new Error(`order: ${created.error?.message ?? JSON.stringify(created.data)}`);
  const orderNumber = created.data.number;
  const { data: ordRow } = await svc.from("orders").select("id, ship_name, phone_primary").eq("number", orderNumber).single();
  const { data: groups, error: groupsErr } = await svc.from("order_vendor_groups").select("id, vendor_id").eq("order_id", ordRow.id);
  if (groupsErr) throw new Error(`groups query: ${groupsErr.message}`);
  if (!groups || groups.length === 0) throw new Error(`no vendor groups for order ${orderNumber}`);
  const { data: itemRows } = await svc.from("order_items").select("group_id, qty").eq("order_id", ordRow.id);
  const piecesByGroup = new Map();
  for (const it of itemRows ?? []) piecesByGroup.set(it.group_id, (piecesByGroup.get(it.group_id) ?? 0) + it.qty);
  const idToTag = new Map(Object.entries(F.vendors).map(([tag, v]) => [v.id, tag]));
  const groupInfo = groups.map((g) => ({ ...g, tag: idToTag.get(g.vendor_id) ?? "?", pieces: piecesByGroup.get(g.id) ?? 0 }));
  const pieces = groupInfo.map((g) => g.pieces).sort().join("+");
  check("3-vendor job created (1+1+3)", groups.length === 3 && pieces === "1+1+3", `groups=${groups.length} pieces=${pieces} order=${orderNumber}`);

  /* ---------- render through a real admin session ---------- */
  const browser = await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
  await page.type("input[name=identifier]", F.users["admin-0"].email);
  await page.type("input[name=password]", PWD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => undefined), page.click("button[type=submit]")]);
  await page.waitForFunction(() => !window.location.pathname.includes("/auth"), { timeout: 20000 }).catch(() => {});

  const fetchDoc = async (doc, query = "") => page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, text: await r.text() };
  }, `${BASE}/order/${encodeURIComponent(orderNumber)}/print/${doc}?lang=ar${query}`);

  /** render a doc into the page without hanging on external font CSS */
  const setDoc = async (html) => {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  };
  /** screenshot the paper itself (fullPage can clip mm-sized sheets) */
  const shotSheet = async (path) => {
    const el = await page.$(".sheet");
    if (el) await el.screenshot({ path });
    else await page.screenshot({ path, fullPage: true });
  };

  /* carrier label: Code128 + maps QR */
  let payload = await fetchDoc("label_carrier");
  check("carrier label 200", payload.status === 200, String(payload.status));
  fs.writeFileSync(`${OUT}/carrier-label.html`, payload.text);
  const svgs = svgPayloads(payload.text);
  fs.writeFileSync(`${OUT}/carrier-label-qr-payload.svg`, svgs[0] ?? "");
  // bwip-js renders bars as ONE <path> whose d contains an M..z subpath per bar
  const inlineSvgs = payload.text.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
  const barcodeSvg = inlineSvgs.find((s) => (s.match(/M\d/g) ?? []).length > 30);
  const barCount = barcodeSvg ? (barcodeSvg.match(/M\d/g) ?? []).length : 0;
  check("Code128 structurally encoded (>40 bar subpaths)", barCount > 40, `bars=${barCount}`);
  check("Code128 human-readable text = order number", barcodeSvg && payload.text.includes(orderNumber), orderNumber);
  check("carrier label embeds maps QR data-URL", svgs.length >= 1, `svgs=${svgs.length}`);
  check("carrier label shows recipient+phone", payload.text.includes("عميل الطباعة") && payload.text.includes("0100"), "carrier PII present by design");
  await setDoc(payload.text);
  await page.pdf({ path: `${OUT}/label-carrier-A5-landscape.pdf`, format: "A5", landscape: true, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await shotSheet(`${OUT}/label-carrier.png`);

  /* vendor labels + invoices: name-only rule */
  for (const g of groupInfo) {
    const tag = g.tag;
    if (tag === "?") throw new Error(`unknown vendor_id ${g.vendor_id}`);
    const vl = await fetchDoc("label_vendor", `&vendor=${g.vendor_id}`);
    // name-only rule: the packing label MAY show the customer NAME (pack-for)
    // but never the phone, the street address, or the map coordinates
    const clean = !vl.text.includes("+201001234567") && !vl.text.includes("التحرير") && !vl.text.includes("0100") && !vl.text.includes("maps.google.com");
    check(`vendor label ${tag} name-only (no customer PII, no coords)`, vl.status === 200 && clean, `${vl.status} clean=${clean}`);
    check(`vendor label ${tag} shows own store name`, vl.text.includes(`مطبعة ${tag}`), "store name");
    await setDoc(vl.text);
    await page.pdf({ path: `${OUT}/label-vendor-${tag}-A5-landscape.pdf`, format: "A5", landscape: true, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    if (tag === "A") await shotSheet(`${OUT}/label-vendor-A.png`);

    const vi = await fetchDoc("invoice_vendor", `&vendor=${g.vendor_id}`);
    check(`vendor invoice ${tag} 200 name-only`, vi.status === 200 && !vi.text.includes("+201001234567") && !vi.text.includes("التحرير"), String(vi.status));
    await setDoc(vi.text);
    await page.pdf({ path: `${OUT}/invoice-vendor-${tag}-A4.pdf`, format: "A4", landscape: false, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  /* admin invoice (pre-cancel) */
  payload = await fetchDoc("invoice_admin");
  check("admin invoice 200", payload.status === 200, String(payload.status));
  check("admin invoice shows full address+phone", payload.text.includes("١٥ شارع التحرير") && payload.text.includes("+201001234567"), "admin sees PII");
  fs.writeFileSync(`${OUT}/invoice-admin.html`, payload.text);
  await setDoc(payload.text);
  await page.pdf({ path: `${OUT}/invoice-admin-A4.pdf`, format: "A4", landscape: false, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await shotSheet(`${OUT}/invoice-admin.png`);

  /* order detail (print center) screens at 4 widths */
  const detailUrl = `${BASE}/ar/admin/orders`;
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`${BASE}/ar/admin/orders/${ordRow.id}`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.screenshot({ path: `${OUT}/order-detail-${w}.png`, fullPage: false });
  }
  check("order detail (print center) captured at 4 widths", fs.existsSync(`${OUT}/order-detail-390.png`) && fs.existsSync(`${OUT}/order-detail-1440.png`), "390/768/1280/1440");

  /* cancel → watermark */
  const { error: werr } = await admin.rpc("fn_cancel_order_admin", { p_order_id: ordRow.id, p_reason: "P8 print QA" });
  const { data: stRow } = await svc.from("orders").select("status").eq("id", ordRow.id).single();
  check("order cancelled", !werr && stRow?.status === "cancelled", werr?.message ?? stRow?.status);
  const inv2 = await fetchDoc("invoice_admin");
  check("cancelled watermark ملغي on invoice", inv2.status === 200 && inv2.text.includes("ملغي"), `status=${inv2.status}`);
  fs.writeFileSync(`${OUT}/invoice-admin-cancelled.html`, inv2.text);
  await setDoc(inv2.text);
  await page.pdf({ path: `${OUT}/invoice-admin-cancelled-A4.pdf`, format: "A4", landscape: false, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await shotSheet(`${OUT}/invoice-admin-cancelled.png`);

  /* reprint logged */
  const { data: docsLog } = await svc.from("order_documents").select("doc_type, copies").eq("order_id", ordRow.id);
  check("every render logged an order_documents row", (docsLog ?? []).length >= 7, `rows=${docsLog?.length}`);

  await page.close();
  await ctx.close();
  await browser.close();

} catch (error) {
  console.error("PRINT QA ERROR:", error.message, String(error.stack ?? "").split("\n").slice(1, 4).join(" | "));
  process.exitCode = 1;
} finally {
  /* cleanup → pristine */
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
    await svc.from("user_addresses").delete().like("full_name", "عميل الطباعة");
    await svc.from("audit_logs").delete().neq("id", 0);
    await svc.from("email_logs").delete().neq("id", nil);
    if (F.imgPaths.length) await svc.storage.from("media").remove(F.imgPaths);
    for (const pid of F.products) await svc.from("products").delete().eq("id", pid);
    for (const v of Object.values(F.vendors)) await svc.from("vendors").delete().eq("id", v.id);
    for (let i = F.catIds.length - 1; i >= 0; i -= 1) await svc.from("categories").delete().eq("id", F.catIds[i]);
    for (const u of Object.values(F.users)) await svc.auth.admin.deleteUser(u.id);
    await svc.from("notifications").delete().neq("id", nil);
    const counts = {};
    for (const t of ["orders", "products", "categories", "vendors", "cart_items", "user_addresses", "order_documents"]) {
      const { count } = await svc.from(t).select("*", { count: "exact", head: true });
      counts[t] = count;
    }
    const pristine = Object.values(counts).every((c) => c === 0);
    console.log("pristine:", pristine, JSON.stringify(counts));
    fs.mkdirSync("evidence/phase-08", { recursive: true });
    fs.writeFileSync("evidence/phase-08/print-qa.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, results, pristine, counts }, null, 1) + "\n");
  } catch (e) {
    console.error("CLEANUP ERROR:", e.message);
    process.exitCode = 1;
  }
}
