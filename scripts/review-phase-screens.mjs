/**
 * Screens for the moderation phase: admin verification tab, product review
 * page, store changes queue, stores list; seller dashboard, events, ads,
 * store settings (pending change), verification. Temporary users/store are
 * created and removed again.
 * Reproduce: node --env-file=.env scripts/review-phase-screens.mjs <outdir>
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "evidence/review-phase";
const STAMP = Date.now();
const PWD = `Tmp#${crypto.randomBytes(6).toString("hex")}9a`;
fs.mkdirSync(OUT, { recursive: true });
const made = [];

async function makeUser(role, tag) {
  const email = `rv-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
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

let vendorId = null;
async function main() {
  const admin = await makeUser("admin", "a");
  const seller = await makeUser("vendor", "v");
  const adminC = await signIn(admin.email);
  const sellerC = await signIn(seller.email);
  const { data: cat } = await svc.from("categories").select("id").eq("depth", 1).is("deleted_at", null).limit(2);
  const { data: area } = await svc.from("areas").select("id, governorate_id").order("id").limit(1);
  const on = await sellerC.rpc("fn_vendor_onboard", { p_data: {
    store_name_ar: `متجر تجريبي ${STAMP}`, store_name_en: `Test Store ${STAMP}`, category_ids: cat.map((c) => c.id),
    first_name: "تجربة", last_name: "متجر", governorate_id: area[0].governorate_id, area_id: area[0].id, address1: "عنوان",
    terms_version: "1.0", terms_signature: "RV" } });
  if (on.error) throw new Error(on.error.message);
  vendorId = on.data.vendor_id;
  const ap = await adminC.rpc("fn_admin_review_vendor", { p_vendor_id: vendorId, p_decision: "approve" });
  if (ap.error) throw new Error(ap.error.message);
  // a pending store-settings change
  const rq = await sellerC.rpc("fn_vendor_request_store_change", { p_changes: { store_name_ar: `متجر جديد ${STAMP}`, phone: "01011112222" } });
  console.log("change request", JSON.stringify(rq.data ?? rq.error));

  const { data: anyProduct } = await svc.from("products").select("id").is("deleted_at", null).limit(1);

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
        console.log(`${res?.status()} ${name}@${width} overflow=${overflow}`);
      }
    }
    await ctx.close();
  };
  await shots(admin.email, [
    ["admin-verification", `/ar/admin/users/${seller.id}?tab=verification`],
    ["admin-vendors", `/ar/admin/vendors`],
    ["admin-store-changes", `/ar/admin/store-changes`],
    ["admin-product-review", `/ar/admin/products/${anyProduct[0].id}`],
    ["admin-product-review-en", `/en/admin/products/${anyProduct[0].id}`],
  ]);
  await shots(seller.email, [
    ["vendor-dashboard", `/ar/vendor`],
    ["vendor-events", `/ar/vendor/events`],
    ["vendor-ads", `/ar/vendor/ads`],
    ["vendor-store", `/ar/vendor/store`],
    ["vendor-verification", `/ar/vendor/verification`],
    ["vendor-events-en", `/en/vendor/events`],
  ]);
  await browser.close();
}

main().catch((e) => { console.error("ERR", e.message); process.exitCode = 1; }).finally(async () => {
  if (vendorId) {
    await svc.from("vendor_change_requests").delete().eq("vendor_id", vendorId);
    await svc.from("vendor_status_history").delete().eq("vendor_id", vendorId);
    const { error } = await svc.from("vendors").delete().eq("id", vendorId);
    if (error) console.log("cleanup vendor:", error.message);
  }
  for (const id of made) await svc.auth.admin.deleteUser(id);
  console.log("cleaned");
});
