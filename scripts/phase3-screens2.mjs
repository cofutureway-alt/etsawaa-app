/**
 * Phase 03 review round (P3-1..P3-4): complete the evidence set.
 * - 4 widths for: vendor signup, onboarding steps 2–5, wizard steps 1–5,
 *   variant matrix, admin queues + review dialog, vendor products, store settings
 * - OTP screen (real signup → verify) at 390/1280
 * - rejected + suspended vendor dashboard banners
 * Reproduce: node --env-file=.env scripts/phase3-screens2.mjs (server on :3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 300000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const page = await b.newPage();
page.on("dialog", (dialog) => { void dialog.accept(); });
const stamp = Date.now();
const OUT = "evidence/phase-03/screens";
fs.mkdirSync(OUT, { recursive: true });
const PWD = "Vendor#12345";
let seq = 0;

const pngBuffers = await (async () => {
  const p = await b.newPage();
  const out = [];
  for (const color of ["#c0392b", "#27ae60", "#2980b9"]) {
    out.push(await p.evaluate((c) => {
      const cv = document.createElement("canvas");
      cv.width = 300; cv.height = 200;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = c; ctx.fillRect(0, 0, 300, 200);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 26px sans-serif";
      ctx.fillText("Etsawaa", 88, 110);
      return cv.toDataURL("image/png");
    }, color));
  }
  await p.close();
  return out.map((d) => Buffer.from(d.split(",")[1], "base64"));
})();

const mkUser = async (email, role) => {
  seq += 1;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PWD, email_confirm: true,
    user_metadata: { full_name: email.split("@")[0], phone_e164: `+2012345${String(stamp).slice(-6)}${seq}` },
  });
  if (error) throw new Error(error.message);
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
};
const login = async (email) => {
  await goto2("http://localhost:3000/ar/auth/login", "login");
  await page.type("input[name=identifier]", email);
  await page.type("input[name=password]", PWD);
  await page.click("button[type=submit]");
  await new Promise((r) => setTimeout(r, 3200));
};
const goto2 = async (url, label) => {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 2200));
  } catch {
    console.log("nav-timeout:", label ?? url, "— continuing");
  }
};
const shot = async (name, fullPage = true) => {
  try {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage, timeout: 60000 });
  } catch (cause) {
    console.log("shot-retry:", name, String(cause).slice(0, 80));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false, timeout: 60000 });
  }
};
const asUser = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PWD });
  if (error) throw new Error(error.message);
  return c;
};
const clickButton = async (text) => {
  await page.evaluate((label) => {
    const buttons = [...document.querySelectorAll("button")].filter((el) => el.textContent?.trim() === label);
    buttons[buttons.length - 1]?.click();
  }, text);
  await new Promise((r) => setTimeout(r, 1500));
};
const clickButtonContains = async (text) => {
  await page.evaluate((label) => {
    const buttons = [...document.querySelectorAll("button")].filter((el) => el.textContent?.includes(label));
    buttons[buttons.length - 1]?.click();
  }, text);
  await new Promise((r) => setTimeout(r, 1500));
};

let createdUsers = [];
try {
  // ------------------------------------------------------------- pre-clean
  {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    for (const user of list.users) {
      if (/^p3[uts]?-/.test(user.email ?? "")) {
        const { data: objs } = await svc.storage.from("media").list(`u/${user.id}`, { limit: 100 });
        if (objs?.length) await svc.storage.from("media").remove(objs.map((o) => `u/${user.id}/${o.name}`));
        const { data: docs } = await svc.storage.from("documents").list(`u/${user.id}`, { limit: 100 });
        if (docs?.length) await svc.storage.from("documents").remove(docs.map((o) => `u/${user.id}/${o.name}`));
        await svc.auth.admin.deleteUser(user.id);
      }
    }
    await svc.from("categories").delete().like("slug_en", "p3%");
  }

  // ---------------------------------------------------------------- fixtures
  const adminEmail = `p3u-admin-${stamp}@etsawaa-e2e.com`;
  const vEmail = `p3u-vendor-${stamp}@etsawaa-e2e.com`;
  const rejEmail = `p3u-rejected-${stamp}@etsawaa-e2e.com`;
  const suspEmail = `p3u-suspended-${stamp}@etsawaa-e2e.com`;
  const wEmail = `p3u-wizard-${stamp}@etsawaa-e2e.com`;
  const _adminId = await mkUser(adminEmail, "admin");
  await mkUser(vEmail, "vendor");
  await mkUser(rejEmail, "vendor");
  await mkUser(suspEmail, "vendor");
  await mkUser(wEmail, "vendor");
  createdUsers = [adminEmail, vEmail, rejEmail, suspEmail, wEmail];
  const admin = await asUser(adminEmail);
  const vendor = await asUser(vEmail);

  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1).single();
  const { data: root } = await svc.from("categories").insert({ slug_ar: `p3u-root-${stamp}`, slug_en: `p3u-root-${stamp}`, name_ar: "أزياء", name_en: "Fashion" }).select("id").single();
  const { data: clothLeaf } = await svc.from("categories").insert({ slug_ar: `p3u-tee-${stamp}`, slug_en: `p3u-tee-${stamp}`, name_ar: "تيشيرتات", name_en: "T-Shirts", parent_id: root?.id, depth: 2 }).select("id").single();
  const { data: colorDef } = await svc.from("attribute_defs").insert({ category_id: clothLeaf?.id, code: "color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single();
  const { data: sizeDef } = await svc.from("attribute_defs").insert({ category_id: clothLeaf?.id, code: "size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single();
  const { data: colorRows } = await svc.from("attribute_options").insert([["red", "أحمر", "#C0392B"], ["blue", "أزرق", "#2980B9"], ["black", "أسود", "#1F2937"]].map(([code, label, hex], i) => ({ attribute_id: colorDef?.id, code, label_ar: label, label_en: code, color_hex: hex, sort: i }))).select("id");
  const { data: sizeRows } = await svc.from("attribute_options").insert(["sm", "md", "lg", "xl"].map((code, i) => ({ attribute_id: sizeDef?.id, code, label_ar: ["S", "M", "L", "XL"][i], label_en: ["S", "M", "L", "XL"][i], sort: i }))).select("id");

  // vendor media for the picker fields
  const vUid = (await vendor.auth.getUser()).data.user?.id;
  const mediaPaths = [];
  for (const [i, body] of pngBuffers.entries()) {
    const p = `u/${vUid}/${crypto.randomUUID()}.png`;
    await vendor.storage.from("media").upload(p, body, { contentType: "image/png" });
    await vendor.from("media_files").insert({ bucket: "media", path: p, original_name: `store-${i}.png`, mime: "image/png", size_bytes: body.length, kind: "image", width: 300, height: 200 });
    mediaPaths.push(p);
  }

  const onboardPayload = (ar, en) => ({
    store_name_ar: ar, store_name_en: en,
    category_ids: [clothLeaf?.id],
    first_name: "بائع", last_name: "اتسوء",
    phone: `+2012345${String(stamp).slice(-5)}`,
    governorate_id: area?.governorate_id, area_id: area?.id, address1: "شارع التحرير 1",
    terms_version: "1.0", terms_signature: `${en} Owner`,
  });

  // main vendor (active + unverified → grace warning)
  const onMain = await vendor.rpc("fn_vendor_onboard", { p_data: onboardPayload("متجر النيل", "Nile Store") });
  const mainVendorId = onMain.data?.vendor_id;
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: mainVendorId, p_decision: "approve" });
  // rejected vendor (with reason)
  const rejClient = await asUser(rejEmail);
  const onRej = await rejClient.rpc("fn_vendor_onboard", { p_data: onboardPayload("متجر مرفوض", "Rejected Store") });
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onRej.data?.vendor_id, p_decision: "reject", p_reason: "بيانات المتجر غير مكتملة — أكمل العنوان وأعد الإرسال" });
  // suspended vendor
  const suspClient = await asUser(suspEmail);
  const onSusp = await suspClient.rpc("fn_vendor_onboard", { p_data: onboardPayload("متجر موقوف", "Suspended Store") });
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onSusp.data?.vendor_id, p_decision: "approve" });
  await svc.from("vendors").update({ status: "suspended" }).eq("id", onSusp.data?.vendor_id);

  // draft t-shirt with the full 12-variant matrix (wizard + matrix evidence)
  const tee = await vendor.rpc("fn_save_product", { p_product: {
    name_ar: "تيشيرت قطن رجالي", name_en: "Men Cotton T-Shirt",
    desc_ar: "قطن مصري 100% بقصة مريحة", desc_en: "100% Egyptian cotton, relaxed fit",
    leaf_category_id: clothLeaf?.id,
    media: mediaPaths.slice(0, 3).map((p) => ({ kind: "image", path: p })),
  } });
  const teeId = tee.data?.id;
  await vendor.rpc("fn_generate_variants", {
    p_product_id: teeId,
    p_axes: [
      { attribute_id: colorDef?.id, option_ids: colorRows?.map((r) => r.id) ?? [] },
      { attribute_id: sizeDef?.id, option_ids: sizeRows?.map((r) => r.id) ?? [] },
    ],
    p_defaults: { price_piastres: 25000, sale_price_piastres: 19900 },
  });
  const { data: teeVariants } = await svc.from("variants").select("id, option_key").eq("product_id", teeId).is("deleted_at", null).order("option_key");
  await vendor.rpc("fn_save_variants", { p_product_id: teeId, p_rows: teeVariants.map((v, i) => ({ option_key: v.option_key, sku: `TSH-${stamp}-${String(i).padStart(2, "0")}`, price_piastres: 25000, sale_price_piastres: 19900, stock: 10 + i, image_path: i % 3 === 0 ? mediaPaths[i % 3] : "", is_active: true })) });

  // a second pending product feeds the admin queue
  const tee2 = await vendor.rpc("fn_save_product", { p_product: {
    name_ar: "تيشيرت صيفي", name_en: "Summer Tee", leaf_category_id: clothLeaf?.id,
    media: [{ kind: "image", path: mediaPaths[0] }],
  } });
  await vendor.rpc("fn_generate_variants", { p_product_id: tee2.data?.id, p_axes: [] });
  const { data: tee2v } = await svc.from("variants").select("id, option_key").eq("product_id", tee2.data?.id).is("deleted_at", null).single();
  await vendor.rpc("fn_save_variants", { p_product_id: tee2.data?.id, p_rows: [{ option_key: tee2v?.option_key ?? "", sku: `SUM-${stamp}`, price_piastres: 18000, sale_price_piastres: null, stock: 4, image_path: "", is_active: true }] });
  await vendor.rpc("fn_submit_product", { p_product_id: tee2.data?.id });

  /* --------------------------- P3-3: real signup → OTP screen (390/1280) */
  const otpEmail = `p3u-otp-${stamp}@etsawaa-e2e.com`;
  createdUsers.push(otpEmail);
  await goto2("http://localhost:3000/ar/auth/register?intent=vendor", "register");
  await page.type("input[name=firstName]", "بائع");
  await page.type("input[name=lastName]", "اتسوء");
  await page.type("input[name=email]", otpEmail);
  await page.type("input[name=phone]", "01012345678");
  await page.type("input[name=password]", PWD);
  await page.type("input[name=confirmPassword]", PWD);
  await page.click("input[name=terms]");
  await new Promise((r) => setTimeout(r, 500));
  await clickButton("إنشاء حساب");
  await new Promise((r) => setTimeout(r, 2500));
  for (const w of [390, 1280]) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 700));
    await shot(`vendor-otp-${w}`);
  }
  // sign out of the pending account before the next login
  await goto2("http://localhost:3000/ar/auth/logout", "logout");

  /* ------------------- P3-1: vendor signup at 768/1440 (390/1280 exist) */
  for (const w of [768, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2("http://localhost:3000/ar/auth/register?intent=vendor", `signup-${w}`);
    await shot(`vendor-signup-${w}`);
  }

  /* --------------- P3-1: onboarding steps 2–5 walkthrough + 4 widths ---- */
  await login(wEmail);
  await goto2("http://localhost:3000/ar/vendor/onboarding", "onboarding");
  // step 1 fill (names + category) → next
  await page.type("#store_name_ar", "متجر الأنواع");
  await page.type("#store_name_en", "Variety Store");
  await page.evaluate(() => {
    const d = [...document.querySelectorAll("details")].find((el) => el.textContent?.includes("أزياء"));
    if (d) d.open = true;
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("details input[type=checkbox]")].find((el) => (el.closest("details")?.textContent ?? "").includes("أزياء"));
    if (box && !box.checked) box.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await clickButton("التالي");
  // step 2 fill → next (reaches step 3)
  await page.type("#first_name", "بائع");
  await page.type("#last_name", "اتسوء");
  await page.type("#phone", "01012345678");
  await page.evaluate(() => {
    const gov = document.getElementById("governorate_id");
    if (gov) {
      gov.value = "1";
      gov.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    const areaSel = document.getElementById("area_id");
    const opt = areaSel?.querySelector("option:nth-child(2)");
    if (areaSel && opt) {
      areaSel.value = opt.value;
      areaSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.type("#address1", "شارع التحرير 1");
  await new Promise((r) => setTimeout(r, 900));
  await clickButton("التالي");
  // step 3 skip → step 4
  await clickButtonContains("تخطي التحقق");
  // step 4 fill → next (lands on step 5; onboarding_step=5 persisted)
  await page.evaluate(() => {
    const cb = document.getElementById("terms_accepted");
    if (cb && !cb.checked) cb.click();
  });
  await page.type("#terms_signature", "Variety Store Owner");
  await new Promise((r) => setTimeout(r, 500));
  await clickButton("التالي");
  await new Promise((r) => setTimeout(r, 1000));

  // shoot steps 5→2 at every width via the back buttons (resume = step 5)
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2("http://localhost:3000/ar/vendor/onboarding", `ob-${w}`);
    await shot(`onboarding-step5-review-${w}`);
    await clickButton("رجوع");
    await shot(`onboarding-step4-terms-${w}`);
    await clickButton("رجوع");
    await shot(`onboarding-step3-verification-${w}`);
    await clickButton("رجوع");
    await shot(`onboarding-step2-${w}`);
  }

  /* ----------------- P3-1/P3-2: product wizard steps 1–5 at 4 widths ---- */
  const clickNext = async () => clickButton("التالي");
  const wizardUrl = `http://localhost:3000/ar/vendor/products/${teeId}/edit`;
  await login(vEmail);
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2(wizardUrl, `wizard-${w}`);
    await new Promise((r) => setTimeout(r, 1800));
    await shot(`product-wizard-step1-${w}`);
    await clickNext();
    await shot(`product-wizard-step2-${w}`);
    await clickNext();
    await shot(`product-wizard-step3-${w}`);
    await clickNext();
    await shot(`product-wizard-step4-${w}`);
    await clickNext();
    await shot(`product-wizard-step5-${w}`);
  }
  // variant matrix: cards at 390 (exists), table at 768/1280/1440
  for (const w of [768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2(wizardUrl, `matrix-${w}`);
    await clickNext();
    await clickNext();
    await clickNext();
    await shot(`variant-matrix-desktop-${w}`);
  }

  /* --------------------- P3-1: vendor products + store settings at 768 -- */
  for (const [route, name] of [["products", "vendor-products"], ["store", "vendor-store-settings"]]) {
    await page.setViewport({ width: 768, height: 900 });
    await goto2(`http://localhost:3000/ar/vendor/${route}`, name);
    await shot(`${name}-768`);
  }

  /* --------------- P3-1: admin queues + review dialog at 4 widths ------- */
  await login(adminEmail);
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2("http://localhost:3000/ar/admin/products", `admin-products-${w}`);
    await shot(`admin-products-queue-${w}`);
    if (w === 390 || w === 1440) {
      await clickButton("مراجعة");
      await new Promise((r) => setTimeout(r, 800));
      await shot(`admin-product-review-dialog-${w}`, false);
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await clickButton("مراجعة");
  await new Promise((r) => setTimeout(r, 800));
  await shot("admin-product-review-dialog-768", false);
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 500));
  for (const w of [390, 768, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2("http://localhost:3000/ar/admin/vendors", `admin-vendors-${w}`);
    await shot(`admin-vendors-queue-${w}`);
  }

  /* ----------------- minor: rejected + suspended vendor banners --------- */
  await login(rejEmail);
  for (const w of [390, 1280]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2("http://localhost:3000/ar/vendor", `rej-${w}`);
    await shot(`vendor-dashboard-rejected-${w}`);
  }
  await login(suspEmail);
  for (const w of [390, 1280]) {
    await page.setViewport({ width: w, height: 900 });
    await goto2("http://localhost:3000/ar/vendor", `susp-${w}`);
    await shot(`vendor-dashboard-suspended-${w}`);
  }

  // ------------------------------------------------------------- cleanup
  await vendor.storage.from("media").remove(mediaPaths);
  await svc.from("categories").delete().in("id", [root?.id, clothLeaf?.id]);
  for (const email of createdUsers) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    const user = list.users.find((u) => u.email === email);
    if (user) await svc.auth.admin.deleteUser(user.id);
  }
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { data: leftV } = await svc.from("vendors").select("id");
  const { data: leftP } = await svc.from("products").select("id");
  console.log(JSON.stringify({ screens: fs.readdirSync(OUT).length, leftVendors: leftV?.length, leftProducts: leftP?.length }, null, 1));
  console.log("PHASE3 SCREENS2 OK");
  await b.close();
} catch (error) {
  console.error("SCREENS2 ERROR:", error.message);
  try {
    for (const email of createdUsers) {
      const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
      const user = list.users.find((u) => u.email === email);
      if (user) await svc.auth.admin.deleteUser(user.id);
    }
  } catch { /* best-effort */ }
  await b.close();
  process.exitCode = 1;
}
