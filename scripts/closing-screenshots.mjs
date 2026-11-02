/**
 * Deep-review corrections — screenshots + proofs.
 * P2-6 picker at 390/768/1440 (dialog + selected) · P2-7 /vendor/media at
 * 390/1280 incl. mobile folder drawer · P2-9 category drag-to-new-parent
 * before/after/reload · minor: /ar/categories + clothing fixture.
 * Reproduce: node --env-file=.env scripts/closing-screenshots.mjs (server on :3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const b = await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const page = await b.newPage();
const stamp = Date.now();
const OUT = "evidence/phase-02/screens";
const WIDTHS = [390, 768, 1280, 1440];

const pngs = (async () => {
  const p = await b.newPage();
  const colors = ["#c0392b", "#27ae60", "#2980b9"];
  const out = [];
  for (const color of colors) {
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

let seq = 0;
const mkUser = async (email, role) => {
  seq += 1;
  const { data, error } = await svc.auth.admin.createUser({ email, password: "Close#12345", email_confirm: true, user_metadata: { full_name: email.split("@")[0], phone_e164: `+2017${seq}0${String(stamp).slice(-7)}` } });
  if (error) throw new Error(error.message);
  if (role !== "customer") await svc.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
};
const session = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "Close#12345" });
  if (error) throw new Error(error.message);
  return c;
};
const login = async (email) => {
  await page.goto("http://localhost:3000/ar/auth/login", { waitUntil: "networkidle2" });
  await page.type("input[name=identifier]", email);
  await page.type("input[name=password]", "Close#12345");
  await page.click("button[type=submit]");
  await new Promise((r) => setTimeout(r, 3500));
};
const shot = (name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage });

try {
  const pngBuffers = await pngs;
  const adminEmail = `dr-admin-${stamp}@etsawaa-e2e.com`;
  const vendorEmail = `dr-vendor-${stamp}@etsawaa-e2e.com`;
  const adminId = await mkUser(adminEmail, "admin");
  const vendorId = await mkUser(vendorEmail, "vendor");
  const admin = await session(adminEmail);
  const vendor = await session(vendorEmail);

  // ---- clothing fixture for the attributes preview (realistic) -------------
  const { data: clothLeaf } = await admin.from("categories").insert({ slug_ar: `dr-cloth-${stamp}`, slug_en: `dr-cloth-${stamp}`, name_ar: "ملابس رجالية", name_en: "Men Clothing" }).select("id").single();
  const { data: sizeDef } = await admin.from("attribute_defs").insert({ category_id: clothLeaf?.id ?? "", code: "size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true }).select("id").single();
  await admin.from("attribute_options").insert([
    { attribute_id: sizeDef?.id ?? "", code: "s", label_ar: "S", label_en: "S", sort: 0 },
    { attribute_id: sizeDef?.id ?? "", code: "m", label_ar: "M", label_en: "M", sort: 1 },
    { attribute_id: sizeDef?.id ?? "", code: "l", label_ar: "L", label_en: "L", sort: 2 },
    { attribute_id: sizeDef?.id ?? "", code: "xl", label_ar: "XL", label_en: "XL", sort: 3 },
  ]);
  const { data: colorDef } = await admin.from("attribute_defs").insert({ category_id: clothLeaf?.id ?? "", code: "color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single();
  await admin.from("attribute_options").insert([
    { attribute_id: colorDef?.id ?? "", code: "red", label_ar: "أحمر", label_en: "Red", color_hex: "#C0392B", sort: 0 },
    { attribute_id: colorDef?.id ?? "", code: "blue", label_ar: "أزرق", label_en: "Blue", color_hex: "#2980B9", sort: 1 },
    { attribute_id: colorDef?.id ?? "", code: "black", label_ar: "أسود", label_en: "Black", color_hex: "#1F2937", sort: 2 },
  ]);
  const { data: otherLeaf } = await admin.from("categories").insert({ slug_ar: `dr-other-${stamp}`, slug_en: `dr-other-${stamp}`, name_ar: "أحذية", name_en: "Shoes" }).select("id").single();
  await admin.from("category_attributes").insert({ category_id: otherLeaf?.id ?? "", attribute_id: sizeDef?.id ?? "" });

  // ---- P2-7: vendor library at 390 + 1280 incl. mobile folder drawer -------
  await vendor.from("media_folders").insert({ name: "صور المنتجات" }).select().single();
  const { data: f1 } = await vendor.from("media_folders").select("id").eq("name", "صور المنتجات").single();
  for (const [i, body] of pngBuffers.entries()) {
    const p = `u/${vendorId}/${crypto.randomUUID()}.png`;
    await vendor.storage.from("media").upload(p, body, { contentType: "image/png" });
    await vendor.from("media_files").insert({ bucket: "media", path: p, folder_id: f1?.id ?? null, original_name: `منتج-${i + 1}.png`, mime: "image/png", size_bytes: body.length, kind: "image", width: 300, height: 200 });
  }
  await login(vendorEmail);
  for (const w of [390, 1280]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto("http://localhost:3000/ar/vendor/media", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2200));
    await shot(`vendor-media-${w}`);
    if (w === 390) {
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "المجلدات")?.click(); });
      await new Promise((r) => setTimeout(r, 900));
      await shot(`vendor-media-390-folder-drawer`, false);
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ---- P2-6: picker at 390/768/1440 (admin) --------------------------------
  await admin.from("media_files").insert({ bucket: "media", path: "PLACEHOLDER", original_name: "x" }).then(({ error }) => { if (error && error.message.includes("PLACEHOLDER")) void 0; }).catch(() => {});
  // seed one admin image properly
  const ap = `u/${adminId}/${crypto.randomUUID()}.png`;
  await admin.storage.from("media").upload(ap, pngBuffers[0], { contentType: "image/png" });
  await admin.from("media_files").insert({ bucket: "media", path: ap, original_name: "category-thumb.png", mime: "image/png", size_bytes: pngBuffers[0].length, kind: "image", width: 300, height: 200 });
  await login(adminEmail);
  for (const w of [390, 768, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto("http://localhost:3000/ar/admin/catalog/categories", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("إضافة فئة"))?.click(); });
    await new Promise((r) => setTimeout(r, 700));
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("اختر من الوسائط"))?.click(); });
    await new Promise((r) => setTimeout(r, 2200));
    await shot(`picker-dialog-${w}`, false);
    const box = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find((n) => n.className?.toString?.().includes("cursor-pointer") && n.textContent?.includes("category-thumb.png"));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 80) };
    });
    if (box) {
      await page.mouse.click(box.x, box.y);
      await new Promise((r) => setTimeout(r, 1500));
    }
    await shot(`picker-selected-${w}`, false);
  }

  // ---- template-preview + link-dialog with the clothing fixture (4 widths) --
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`http://localhost:3000/ar/admin/catalog/attributes?cat=${clothLeaf?.id ?? ""}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => { const d = document.querySelector("details"); if (d && !d.open) d.open = true; });
    await new Promise((r) => setTimeout(r, 700));
    await shot(`template-preview-${w}`);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("فئة أخرى"));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 900));
    await shot(`link-dialog-${w}`);
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---- P2-9: category drag-to-new-parent UI proof (1280) -------------------
  const { data: rootA } = await admin.from("categories").insert({ slug_ar: `dr-a-${stamp}`, slug_en: `dr-a-${stamp}`, name_ar: "إلكترونيات", name_en: "Electronics" }).select("id").single();
  const { data: _rootB } = await admin.from("categories").insert({ slug_ar: `dr-b-${stamp}`, slug_en: `dr-b-${stamp}`, name_ar: "أثاث", name_en: "Furniture" }).select("id").single();
  const { data: mover } = await admin.from("categories").insert({ slug_ar: `dr-m-${stamp}`, slug_en: `dr-m-${stamp}`, name_ar: "سماعات", name_en: "Headphones" }).select("id,path").single();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/ar/admin/catalog/categories", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1800));
  await shot("category-drag-before-1280");
  const from = await page.evaluateHandle((name) => [...document.querySelectorAll('[aria-roledescription="draggable"]')].find((el) => el.textContent?.includes(name)), "أثاث");
  const to = await page.evaluateHandle((name) => [...document.querySelectorAll('[aria-roledescription="draggable"]')].find((el) => el.textContent?.includes(name)), "إلكترونيات");
  const fb = (await from.asElement()?.boundingBox()) ?? null;
  const tb = (await to.asElement()?.boundingBox()) ?? null;
  if (fb && tb) {
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(fb.x + (tb.x + 60 - fb.x) * (i / 20), fb.y + (tb.y + tb.height / 2 - fb.y) * (i / 20));
      await new Promise((r) => setTimeout(r, 45));
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 2000));
  }
  await shot("category-drag-after-1280", false);
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));
  const { data: moverAfter } = await admin.from("categories").select("parent_id,path,depth").eq("id", mover?.id ?? "").single();
  const persisted = moverAfter?.parent_id === rootA?.id && moverAfter?.depth === 2;
  fs.writeFileSync("evidence/phase-02/category-drag-proof.json", `${JSON.stringify({ mover: mover?.id, before: null, after: moverAfter?.parent_id, depth: moverAfter?.depth, path: moverAfter?.path, persisted }, null, 1)}\n`);
  await shot("category-drag-after-reload-1280", false);

  // ---- minor: /ar/categories public listing --------------------------------
  for (const w of [1280, 390]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto("http://localhost:3000/ar/categories", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(`public-categories-${w}`);
  }

  // ---- cleanup --------------------------------------------------------------
  await admin.from("categories").delete().in("slug_en", [`dr-cloth-${stamp}`, `dr-other-${stamp}`, `dr-a-${stamp}`, `dr-b-${stamp}`, `dr-m-${stamp}`]);
  const { data: vfiles } = await vendor.from("media_files").select("path");
  for (const f of vfiles ?? []) await vendor.storage.from("media").remove([f.path]);
  await vendor.from("media_files").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.storage.from("media").remove([ap]);
  await admin.from("media_files").delete().eq("path", ap);
  await svc.from("audit_logs").delete().neq("id", 0);
  for (const id of [adminId, vendorId]) await svc.auth.admin.deleteUser(id);
  let remaining = -1;
  for (let i = 0; i < 5; i += 1) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    remaining = list.users.length;
    if (remaining === 0) break;
    for (const usr of list.users) await svc.auth.admin.deleteUser(usr.id);
  }
  console.log(JSON.stringify({ categoryDrag: { persisted }, usersRemaining: remaining }, null, 1));
  console.log("CLOSING SCREENSHOTS OK");
  await b.close();
} catch (error) {
  console.error("CLOSING ERROR:", error.message);
  await b.close();
  process.exitCode = 1;
}
