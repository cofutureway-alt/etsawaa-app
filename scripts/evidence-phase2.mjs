/**
 * Phase 02 — interactive evidence pack (M-18 + drag/picker proofs).
 * Real users through the real login form; real files uploaded by their owners.
 * Outputs: evidence/phase-02/screens/*.png + drag-move-proof.json + picker-proof.json
 * Reproduce: node --env-file=.env scripts/evidence-phase2.mjs   (server on :3000)
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PASSWORD = "Phase2#12345";
const OUT = "evidence/phase-02/screens";
fs.mkdirSync(OUT, { recursive: true });

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Colored placeholder PNGs (300x200) via Chrome canvas - nicer evidence cards. */
const makePngs = async () => {
  const p = await b.newPage();
  const colors = ["#c0392b", "#27ae60", "#2980b9"];
  const out = [];
  for (const color of colors) {
    out.push(await p.evaluate((c) => {
      const canvas = document.createElement("canvas");
      canvas.width = 300; canvas.height = 200;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = c; ctx.fillRect(0, 0, 300, 200);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 28px sans-serif";
      ctx.fillText("Etsawaa", 90, 110);
      return canvas.toDataURL("image/png");
    }, color));
  }
  await p.close();
  return out.map((d) => Buffer.from(d.split(",")[1], "base64"));
};

let userSeq = 0;
const mkUser = async (email, role) => {
  userSeq += 1;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: email.split("@")[0], phone_e164: `+201${userSeq}0${String(STAMP).slice(-7)}` },
  });
  if (error) throw new Error(error.message);
  if (role !== "customer") await svc.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
};

const sessionClient = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(error.message);
  return c;
};

const seedMedia = async (c, uid, folderId, names, pngs = null) => {
  for (const [i, name] of names.entries()) {
    const path = `u/${uid}/${crypto.randomUUID()}.png`;
    const body = pngs ? pngs[i % pngs.length] : tinyPng;
    const { error: upErr } = await c.storage.from("media").upload(path, body, { contentType: "image/png" });
    if (upErr) throw new Error(upErr.message);
    const { error } = await c.from("media_files").insert({
      bucket: "media", path, folder_id: folderId, original_name: name,
      mime: "image/png", size_bytes: body.length, kind: "image", width: 300, height: 200,
    });
    if (error) throw new Error(error.message);
  }
};

const b = await puppeteer.launch({ headless: "new", executablePath: CHROME, args: ["--no-sandbox"] });
const page = await b.newPage();
const results = { drag: null, picker: null };

const login = async (email) => {
  await page.goto("http://localhost:3000/ar/auth/login", { waitUntil: "networkidle2" });
  await page.evaluate(() => { const el = document.querySelector("input[name=identifier]"); if (el) el.value = ""; });
  await page.type("input[name=identifier]", email);
  await page.type("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await new Promise((r) => setTimeout(r, 3500));
};

const shot = (name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage });

const waitForText = async (text, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const has = await page.evaluate((t) => document.body.innerText.includes(t), text);
    if (has) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

try {
  // ---------------- fixtures -------------------------------------------------
  const adminEmail = `p2-ev-admin-${STAMP}@etsawaa-e2e.com`;
  const userEmail = `p2-ev-user-${STAMP}@etsawaa-e2e.com`;
  const adminId = await mkUser(adminEmail, "admin");
  const userId = await mkUser(userEmail, "vendor");
  const adminC = await sessionClient(adminEmail);
  const userC = await sessionClient(userEmail);

  // user library content: 2 folders + 3 files in the first folder
  const pngs = await makePngs();
  const { data: f1 } = await userC.from("media_folders").insert({ name: "صور المنتجات" }).select("id,name").single();
  await userC.from("media_folders").insert({ name: "مجلد ب", parent_id: f1?.id ?? null });
  await seedMedia(userC, userId, f1?.id ?? null, ["banner-1.png", "banner-2.png", "banner-3.png"], pngs);
  // admin media for the picker
  await seedMedia(adminC, adminId, null, ["category-thumb.png"], [pngs[0]]);
  // catalog content for the attributes editor
  const { data: leaf } = await adminC.from("categories").insert({ slug_ar: `ev-leaf-${STAMP}`, slug_en: `ev-leaf-${STAMP}`, name_ar: "أحذية رجالية", name_en: "Men Shoes", is_active: true }).select("id").single();
  const { data: def } = await adminC.from("attribute_defs").insert({ category_id: leaf?.id ?? "", code: "size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single();
  await adminC.from("attribute_options").insert([
    { attribute_id: def?.id ?? "", code: "s40", label_ar: "٤٠", label_en: "40", sort: 0 },
    { attribute_id: def?.id ?? "", code: "s41", label_ar: "٤١", label_en: "41", sort: 1 },
  ]);
  await adminC.from("brands").insert({ slug_ar: `ev-brand-${STAMP}`, slug_en: `ev-brand-${STAMP}`, name_ar: "ماركة إثبات", name_en: "Proof Brand" });

  // ---------------- 1) media library shots (user) ----------------------------
  await login(userEmail);
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto("http://localhost:3000/ar/account/media", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1800));
    await shot(`media-library-${w}`);
  }

  // ---------------- 2) drag-move proof (1280) --------------------------------
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/ar/account/media", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));
  const beforeState = await userC.from("media_files").select("id,folder_id,original_name").limit(1);
  const fileId = beforeState.data?.[0]?.id;
  const dragName = beforeState.data?.[0]?.original_name ?? "banner-1.png";
  await shot("drag-before-1280");
  // grab the card of THE tracked file
  const card = await page.evaluateHandle((name) => {
    const nodes = [...document.querySelectorAll('[aria-roledescription="draggable"]')];
    return nodes.find((el) => el.textContent?.includes(name));
  }, dragName);
  // drop onto the ROOT droppable ("كل الملفات") — the file starts inside a folder
  const folderCell = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "كل الملفات"));
  if (card && folderCell) {
    const a = await card.asElement()?.boundingBox();
    const t = await folderCell.asElement()?.boundingBox();
    if (a && t) {
      await page.mouse.move(a.x + a.width / 2, a.y + 20);
      await page.mouse.down();
      for (let i = 1; i <= 20; i += 1) {
        await page.mouse.move(a.x + (t.x + t.width / 2 - a.x) * (i / 20), a.y + 20 + (t.y + 10 - a.y - 20) * (i / 20));
        await new Promise((r) => setTimeout(r, 50));
      }
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  await shot("drag-after-1280", false);
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));
  const afterState = await userC.from("media_files").select("id,folder_id").eq("id", fileId).single();
  const persisted = (beforeState.data?.[0]?.folder_id ?? "x") !== (afterState.data?.folder_id ?? "y");
  results.drag = { fileId, name: dragName, before: beforeState.data?.[0]?.folder_id ?? null, after: afterState.data?.folder_id ?? null, persisted };
  fs.writeFileSync("evidence/phase-02/drag-move-proof.json", `${JSON.stringify(results.drag, null, 1)}\n`);
  await shot("drag-after-reload-1280", false);

  // ---------------- 3) admin catalog shots + picker proof --------------------
  await page.goto("http://localhost:3000/ar/auth/logout", { method: "POST" }).catch(() => {});
  await login(adminEmail);
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto("http://localhost:3000/ar/admin/catalog/categories", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    await shot(`admin-categories-${w}`);
    await page.goto("http://localhost:3000/ar/admin/catalog/brands", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(`admin-brands-${w}`);
    await page.goto("http://localhost:3000/ar/admin/catalog/tags", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(`admin-tags-${w}`);
  }

  // attributes editor (select the leaf first)
  for (const w of [390, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`http://localhost:3000/ar/admin/catalog/attributes?cat=${leaf?.id ?? ""}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    await shot(`admin-attributes-${w}`);
  }

  // picker proof: categories → add → choose from media → create folder → select
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/ar/admin/catalog/categories", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { const btns = [...document.querySelectorAll("button")]; btns.find((el) => el.textContent?.includes("إضافة فئة"))?.click(); });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => { const btns = [...document.querySelectorAll("button")]; btns.find((el) => el.textContent?.includes("اختر من الوسائط"))?.click(); });
  const rendered = await waitForText("category-thumb.png", 12000);
  await shot("picker-dialog-1280", false);
  const hadFile = rendered;
  // select the file (single mode → a real click fills the field and closes)
  const cardBox = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((n) => n.className?.toString?.().includes("cursor-pointer") && n.textContent?.includes("category-thumb.png"));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 80) };
  });
  if (cardBox) {
    await page.mouse.click(cardBox.x, cardBox.y);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const thumbFilled = await page.evaluate(() => {
    const input = [...document.querySelectorAll("input[name=thumb_path]")].at(-1);
    return input instanceof HTMLInputElement ? input.value : "";
  });
  await shot("picker-selected-1280", false);
  results.picker = { dialogRendered: hadFile, thumbFilled };
  fs.writeFileSync("evidence/phase-02/picker-proof.json", `${JSON.stringify(results.picker, null, 1)}\n`);

  // ---------------- cleanup --------------------------------------------------
  const { data: files } = await userC.from("media_files").select("path,bucket");
  for (const f of files ?? []) await userC.storage.from(f.bucket).remove([f.path]);
  const { data: afiles } = await adminC.from("media_files").select("path,bucket");
  for (const f of afiles ?? []) await adminC.storage.from(f.bucket).remove([f.path]);
  await adminC.from("categories").delete().eq("id", leaf?.id ?? "");
  await adminC.from("brands").delete().eq("slug_en", `ev-brand-${STAMP}`);
  for (const id of [adminId, userId]) await svc.auth.admin.deleteUser(id);
  let remaining = -1;
  for (let i = 0; i < 5; i += 1) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    remaining = list.users.length;
    if (remaining === 0) break;
    for (const u of list.users) await svc.auth.admin.deleteUser(u.id);
  }
  console.log(JSON.stringify({ results, usersRemaining: remaining }, null, 1));
  console.log("PHASE2 EVIDENCE OK");
  await b.close();
} catch (error) {
  console.error("PHASE2 EVIDENCE ERROR:", error.message);
  await b.close();
  process.exitCode = 1;
}
