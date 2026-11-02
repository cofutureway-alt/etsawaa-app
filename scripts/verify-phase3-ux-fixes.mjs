/**
 * Verifies the two UX fixes from the phase-03 audit:
 * 1) wizard autosave: consecutive saves in one session no longer raise the
 *    false "modified in another tab" (stale) banner
 * 2) store settings: changing the governorate resets the area select
 * Reproduce: node --env-file=.env scripts/verify-phase3-ux-fixes.mjs (:3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 300000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const page = await b.newPage();
page.on("dialog", (d) => { void d.accept(); });
const stamp = Date.now();
const PWD = "Vendor#12345";
const results = [];

try {
  /* fixtures: vendor + draft product */
  const { data: u } = await svc.auth.admin.createUser({ email: `p3ux-${stamp}@etsawaa-e2e.com`, password: PWD, email_confirm: true, user_metadata: { full_name: "ux", phone_e164: `+2012345${String(stamp).slice(-7)}` } });
  await svc.from("profiles").update({ role: "vendor" }).eq("id", u.user.id);
  const { data: leaf } = await svc.from("categories").insert({ slug_ar: `p3ux-${stamp}`, slug_en: `p3ux-${stamp}`, name_ar: "اختبار", name_en: "Test" }).select("id").single();
  const vendor = await (async () => { const c = await import("@supabase/supabase-js").then(({ createClient }) => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })); await c.auth.signInWithPassword({ email: `p3ux-${stamp}@etsawaa-e2e.com`, password: PWD }); return c; })();
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1).single();
  await vendor.rpc("fn_vendor_onboard", { p_data: { store_name_ar: "متجر UX", store_name_en: "UX Store", category_ids: [leaf?.id], first_name: "ب", last_name: "ج", governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان", terms_version: "1.0", terms_signature: "UX Owner" } });
  const draft = await vendor.rpc("fn_save_product", { p_product: { name_ar: "منتج UX", name_en: "UX Product", leaf_category_id: leaf?.id, media: [{ kind: "image", path: `u/${u.user.id}/x.png` }] } });
  const teeId = draft.data?.id;
  await vendor.rpc("fn_generate_variants", { p_product_id: teeId, p_axes: [] });
  const { data: v1 } = await svc.from("variants").select("id, option_key").eq("product_id", teeId).is("deleted_at", null).single();
  await vendor.rpc("fn_save_variants", { p_product_id: teeId, p_rows: [{ option_key: v1?.option_key ?? "", sku: `UX-${stamp}`, price_piastres: 10000, sale_price_piastres: null, stock: 1, image_path: "", is_active: true }] });

  await page.goto("http://localhost:3000/ar/auth/login", { waitUntil: "domcontentloaded" });
  await page.type("input[name=identifier]", `p3ux-${stamp}@etsawaa-e2e.com`);
  await page.type("input[name=password]", PWD);
  await page.click("button[type=submit]");
  await new Promise((r) => setTimeout(r, 3000));

  /* 1) two consecutive autosaves → no stale banner */
  await page.goto(`http://localhost:3000/ar/vendor/products/${teeId}/edit`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2000));
  const typeAndWait = async (text) => {
    const name = await page.$("#p_name_ar");
    await name.click({ clickCount: 3 });
    await name.type(text);
    await new Promise((r) => setTimeout(r, 3200)); // debounce 1.2s + save roundtrip
  };
  await typeAndWait("منتج UX أول");
  await typeAndWait("منتج UX ثاني"); // second save in the SAME session
  const staleVisible = await page.evaluate(() => document.body.innerText.includes("تم حفظ نسخة أحدث"));
  results.push({ check: "consecutive autosaves do NOT raise the stale banner", ok: !staleVisible });
  const savedIndicator = await page.evaluate(() => document.body.innerText.includes("حُفظ"));
  results.push({ check: "autosave indicator shows after saves", ok: savedIndicator });

  /* 2) store settings: governorate change resets the area */
  await page.goto("http://localhost:3000/ar/vendor/store", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => {
    const gov = document.getElementById("governorate_id");
    gov.value = "2"; // Giza — different from the seeded Cairo area
    gov.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 600));
  const areaValue = await page.evaluate(() => document.getElementById("area_id")?.value ?? null);
  results.push({ check: "area select resets when the governorate changes", ok: areaValue === "" });

  /* cleanup */
  await svc.from("categories").delete().eq("id", leaf?.id);
  await svc.auth.admin.deleteUser(u.user.id);
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);

  fs.writeFileSync("evidence/phase-03/ux-fixes-verify.json", JSON.stringify({ stamp, results }, null, 1) + "\n");
  console.log(JSON.stringify(results, null, 1));
  console.log(results.every((r) => r.ok) ? "UX FIXES VERIFIED" : "UX FIXES FAILED");
  await b.close();
  if (!results.every((r) => r.ok)) process.exitCode = 1;
} catch (error) {
  console.error("UX VERIFY ERROR:", error.message);
  await b.close();
  process.exitCode = 1;
}
