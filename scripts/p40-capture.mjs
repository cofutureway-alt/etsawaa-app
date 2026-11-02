/**
 * P4-0 — Playwright capture harness (owner-specified protocol) + fixture setup.
 *
 * Protocol per shot:
 *  - Playwright viewport {width, height}, deviceScaleFactor: 1
 *  - wait for networkidle + document.fonts.ready
 *  - one full scroll to the bottom (trigger lazy images), back to top
 *  - assert document.documentElement.clientWidth === width AND
 *          document.documentElement.scrollWidth === clientWidth (fail otherwise)
 *  - at 1440: assert the main container bounding box >= 1100px wide
 *  - fullPage: true screenshot
 *
 * Re-captures: home AR + EN at 390/768/1280/1440, "you viewed before" strip
 * populated + absent states. Logs the empty-block-above-footer check and the
 * LCP element/size. Fixtures cleaned; DB pristine at the end.
 * Reproduce: node --env-file=.env scripts/p40-capture.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import zlib from "node:zlib";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = "http://localhost:3000";
const OUT = "evidence/phase-04/screens";
fs.mkdirSync(OUT, { recursive: true });

const log = [];
let passCount = 0, failCount = 0;
const check = (name, cond, detail = "") => {
  log.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 150)}` : ""}`);
  if (cond) passCount += 1; else failCount += 1;
};

function pngBuffer(width, height, [r, g, b]) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) { raw[y * (1 + width * 3)] = 0; for (let x = 0; x < width; x += 1) { const off = y * (1 + width * 3) + 1 + x * 3; raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; } }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** minimal WEBP encoder is out of scope — the owner's real banners are
 * supplied artwork; for the fixture banner we ship a PNG at TRUE display
 * size (1280x432) so the LCP measurement reflects honest bytes. */
const makeBanner = () => pngBuffer(1280, 432, [150, 20, 20]);

try {
  /* ---------------------------------------------------------- fixtures */
  console.log("fixtures…");
  const { data: au } = await svc.auth.admin.createUser({ email: `p40-a-${STAMP}@etsawaa-e2e.com`, password: PWD, email_confirm: true });
  const { data: vu } = await svc.auth.admin.createUser({ email: `p40-v-${STAMP}@etsawaa-e2e.com`, password: PWD, email_confirm: true });
  await svc.from("profiles").update({ role: "admin" }).eq("id", au.user.id);
  await svc.from("profiles").update({ role: "vendor" }).eq("id", vu.user.id);
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await admin.auth.signInWithPassword({ email: `p40-a-${STAMP}@etsawaa-e2e.com`, password: PWD });
  const A = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await A.auth.signInWithPassword({ email: `p40-v-${STAMP}@etsawaa-e2e.com`, password: PWD });
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).limit(1).single();

  const { data: fashion } = await svc.from("categories").insert({ slug_ar: `ملابس-${STAMP}`, slug_en: `p40-fashion-${STAMP}`, name_ar: "ملابس", name_en: "Fashion", show_in_header: true }).select("id").single();
  const { data: tee } = await svc.from("categories").insert({ slug_ar: `تيشيرتات-${STAMP}`, slug_en: `p40-tshirts-${STAMP}`, name_ar: "تيشيرتات", name_en: "T-Shirts", parent_id: fashion?.id, depth: 2, show_in_header: true }).select("id").single();
  const { data: polo } = await svc.from("categories").insert({ slug_ar: `بولو-${STAMP}`, slug_en: `p40-polo-${STAMP}`, name_ar: "قمصان بولو", name_en: "Polo", parent_id: fashion?.id, depth: 2 }).select("id").single();
  void (await svc.from("categories").insert({ slug_ar: `صيفي-${STAMP}`, slug_en: `p40-summer-${STAMP}`, name_ar: "بولو صيفي", name_en: "Summer Polo", parent_id: polo?.id, depth: 3 }).select("id").single());
  const { data: electronics } = await svc.from("categories").insert({ slug_ar: `إلكترونيات-${STAMP}`, slug_en: `p40-electronics-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics", show_in_header: true }).select("id").single();
  const { data: tvs } = await svc.from("categories").insert({ slug_ar: `شاشات-${STAMP}`, slug_en: `p40-tvs-${STAMP}`, name_ar: "شاشات", name_en: "TVs", parent_id: electronics?.id, depth: 2 }).select("id").single();

  const colorDefIns = await svc.from("attribute_defs").insert({ category_id: tee?.id, code: "color", label_ar: "اللون", label_en: "Color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single();
  if (colorDefIns.error) throw new Error(`color def: ${colorDefIns.error.message}`);
  const colorDef = colorDefIns.data;
  const sizeDefIns = await svc.from("attribute_defs").insert({ category_id: tee?.id, code: "size", label_ar: "المقاس", label_en: "Size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single();
  if (sizeDefIns.error) throw new Error(`size def: ${sizeDefIns.error.message}`);
  const sizeDef = sizeDefIns.data;
  const { data: colorRows } = await svc.from("attribute_options").insert([
    { attribute_id: colorDef?.id, code: "red", label_ar: "أحمر", label_en: "Red", color_hex: "#C0392B", sort: 0 },
    { attribute_id: colorDef?.id, code: "blue", label_ar: "أزرق", label_en: "Blue", color_hex: "#2471A3", sort: 1 },
    { attribute_id: colorDef?.id, code: "green", label_ar: "أخضر", label_en: "Green", color_hex: "#1E8449", sort: 2 },
  ]).select("id");
  const { data: sizeRows } = await svc.from("attribute_options").insert([
    { attribute_id: sizeDef?.id, code: "sm", label_ar: "S", label_en: "S", sort: 0 },
    { attribute_id: sizeDef?.id, code: "md", label_ar: "M", label_en: "M", sort: 1 },
    { attribute_id: sizeDef?.id, code: "lg", label_ar: "L", label_en: "L", sort: 2 },
    { attribute_id: sizeDef?.id, code: "xl", label_ar: "XL", label_en: "XL", sort: 3 },
  ]).select("id");
  // colorRows/sizeRows ARE the data arrays (destructured from the response)
  if (!Array.isArray(colorRows) || !Array.isArray(sizeRows) || colorRows.length === 0 || sizeRows.length === 0) {
    throw new Error(`options empty: color ${colorRows?.length}, size ${sizeRows?.length}`);
  }

  const { data: brand } = await svc.from("brands").insert({ name_ar: "اتسو سبورت", name_en: "Etso Sport", slug_ar: `اتسو-سبورت-${STAMP}`, slug_en: `p40-brand-${STAMP}` }).select("id").single();

  const bannerPath = `u/${vu.user.id}/banner-${STAMP}.png`;
  const teePath = `u/${vu.user.id}/tee-${STAMP}.png`;
  const tvPath = `u/${vu.user.id}/tv-${STAMP}.png`;
  const logoPath = `u/${vu.user.id}/logo-${STAMP}.png`;
  const catPath = `u/${vu.user.id}/cat-${STAMP}.png`;
  await svc.storage.from("media").upload(bannerPath, makeBanner(), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(teePath, pngBuffer(640, 640, [185, 60, 60]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(tvPath, pngBuffer(640, 640, [40, 50, 70]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(logoPath, pngBuffer(300, 300, [140, 10, 10]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(catPath, pngBuffer(300, 300, [190, 150, 150]), { contentType: "image/png", upsert: true });
  await svc.from("categories").update({ thumb_path: catPath }).in("id", [fashion?.id, tee?.id, electronics?.id]);

  const on = await A.rpc("fn_vendor_onboard", { p_data: { store_name_ar: "متجر الأناقة", store_name_en: "Elegance Store", category_ids: [tee?.id], first_name: "أ", last_name: "ب", governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان", terms_version: "1.0", terms_signature: "Owner" } });
  const vendorId = on.data?.vendor_id;
  await svc.from("vendors").update({ logo_path: logoPath, banner_path: bannerPath, is_featured: true, short_desc_ar: "أفضل تيشيرتات القاهرة", short_desc_en: "Cairo's best tees" }).eq("id", vendorId);
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: vendorId, p_decision: "approve" });

  const p1 = await A.rpc("fn_save_product", { p_product: { name_ar: "تيشيرت أحمد القطني", name_en: "Ahmed Cotton Tee", short_ar: "قطن مصري 100%", short_en: "100% Egyptian cotton", desc_ar: "تيشيرت قطن مصري خالص.", desc_en: "Pure Egyptian cotton tee.", leaf_category_id: tee?.id, brand_id: brand?.id, media: [{ kind: "image", path: teePath }], weight_g: 250 } });
  const teeId = p1.data?.id;
  const gen = await A.rpc("fn_generate_variants", { p_product_id: teeId, p_axes: [
    { attribute_id: colorDef?.id, option_ids: colorRows.map((r) => r.id) },
    { attribute_id: sizeDef?.id, option_ids: sizeRows.map((r) => r.id) },
  ] });
  if (gen.error) throw new Error(gen.error.message);
  const { data: teeVars } = await svc.from("variants").select("id, option_key, option_ids").eq("product_id", teeId).is("deleted_at", null).order("created_at");
  const colorIds = colorRows.map((r) => r.id);
  await A.rpc("fn_save_variants", { p_product_id: teeId, p_rows: (teeVars ?? []).map((v, i) => ({
    option_key: v.option_key, sku: `TEE-${STAMP}-${i}`, price_piastres: 10000,
    sale_price_piastres: v.option_ids?.includes(colorIds[1]) ? 8000 : null,
    stock: 5 + (i % 8), image_path: v.option_ids?.includes(colorIds[0]) ? teePath : "", is_active: true,
  })) });
  const facetMap = new Map();
  for (const v of teeVars ?? []) for (const oid of v.option_ids ?? []) facetMap.set(oid, { product_id: teeId, attribute_id: colorIds.includes(oid) ? colorDef?.id : sizeDef?.id, option_id: oid });
  await svc.from("product_facets").upsert([...facetMap.values()], { onConflict: "product_id,attribute_id,option_id" });
  await svc.from("products").update({ sale_starts_at: new Date(Date.now() - 3600_000).toISOString(), sale_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(), featured_permanent: true }).eq("id", teeId);

  const p2 = await A.rpc("fn_save_product", { p_product: { name_ar: "شاشة ذكية 55 بوصة", name_en: "Smart TV 55", desc_ar: "شاشة ذكية 4K.", desc_en: "4K smart TV.", leaf_category_id: tvs?.id, media: [{ kind: "image", path: tvPath }], weight_g: 15000 } });
  const tvId = p2.data?.id;
  await A.rpc("fn_generate_variants", { p_product_id: tvId, p_axes: [] });
  const { data: tvVar } = await svc.from("variants").select("id, option_key").eq("product_id", tvId).is("deleted_at", null).single();
  await A.rpc("fn_save_variants", { p_product_id: tvId, p_rows: [{ option_key: tvVar?.option_key ?? "", sku: `TV-${STAMP}`, price_piastres: 2500000, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
  await svc.from("products").update({ featured_permanent: true }).eq("id", tvId);

  await A.rpc("fn_submit_product", { p_product_id: teeId });
  await A.rpc("fn_submit_product", { p_product_id: tvId });
  await admin.rpc("fn_admin_review_product", { p_product_id: teeId, p_decision: "approve", p_reason: null });
  await admin.rpc("fn_admin_review_product", { p_product_id: tvId, p_decision: "approve", p_reason: null });

  for (const rating of [5, 4, 5]) {
    await svc.from("reviews").insert({ product_id: teeId, vendor_id: vendorId, customer_id: au.user.id, rating, title: "جودة ممتازة", body: "القماش ممتاز.", status: "published" });
  }
  await svc.from("banners").insert({ title_ar: "عروض الموسم", title_en: "Season deals", image_path: bannerPath, link_url: "/ar/products", position: 0 });

  /* --------------------------------------------------------- capture */
  const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
  const WIDTHS = [390, 768, 1280, 1440];
  const assertionLog = [];

  async function capture(url, name, { seededRecent = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 0, height: 0 }, deviceScaleFactor: 1 });
    void context;
    const page = await browser.newPage({ viewport: { width: 0, height: 0 }, deviceScaleFactor: 1 });
    if (seededRecent) {
      await page.addInitScript((ids) => {
        localStorage.setItem("etsawaa.recent.v1", JSON.stringify(ids.map((id, i) => ({ id, at: Date.now() - i * 60000 }))));
      }, [teeId, tvId]);
    }
    await page.setViewportSize({ width: WIDTHS[0], height: 900 });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      // one full scroll to the bottom (lazy images), then back to the top
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const step = () => {
            y += 600;
            window.scrollTo(0, y);
            if (y < document.documentElement.scrollHeight) setTimeout(step, 60);
            else resolve();
          };
          step();
        });
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const a1 = await page.evaluate(() => document.documentElement.clientWidth);
      const a2 = await page.evaluate(() => document.documentElement.scrollWidth);
      const okWidth = a1 === width;
      const okNoOverflow = a2 === a1;
      if (!okWidth || !okNoOverflow) {
        check(`assert ${name}@${width}: clientWidth===${width} && no horizontal overflow`, false, `clientWidth ${a1}, scrollWidth ${a2}`);
        assertionLog.push({ name, width, clientWidth: a1, scrollWidth: a2, ok: false });
        continue;
      }
      let containerW = null;
      if (width === 1440) {
        containerW = await page.evaluate(() => {
          const main = document.getElementById("main");
          return main ? Math.round(main.getBoundingClientRect().width) : null;
        });
        check(`assert ${name}@1440: main container >= 1100px`, containerW != null && containerW >= 1100, `${containerW}px`);
        assertionLog.push({ name, width, containerW, ok: containerW != null && containerW >= 1100 });
      }
      await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      check(`capture ${name}@${width}`, true, `clientWidth ${a1}, scrollWidth ${a2}${containerW != null ? `, container ${containerW}px` : ""}`);
      assertionLog.push({ name, width, clientWidth: a1, scrollWidth: a2, containerW, ok: true });
    }
    await page.close();
  }

  // empty-block probe: measure the gap between the last content block and the
  // footer at 1440 (the owner's screenshot artifact question)
  async function emptyBlockProbe(url) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const gap = await page.evaluate(() => {
      const main = document.getElementById("main");
      const footer = document.querySelector("footer");
      if (!main || !footer) return null;
      const last = main.lastElementChild.getBoundingClientRect();
      const foot = footer.getBoundingClientRect();
      return { mainBottom: Math.round(last.bottom + window.scrollY), footerTop: Math.round(foot.top + window.scrollY), gapPx: Math.round(foot.top - last.bottom) };
    });
    // LCP element identification
    const lcp = await page.evaluate(() => new Promise((resolve) => {
      let best = null;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) best = e; }).observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => {
        if (!best) return resolve(null);
        const el = best.element;
        resolve({
          tag: el?.tagName, src: el?.currentSrc ?? el?.src ?? null,
          w: el?.naturalWidth ?? null, h: el?.naturalHeight ?? null,
          renderedW: Math.round(el?.getBoundingClientRect().width ?? 0),
          bytes: best.size ?? null, ms: Math.round(best.startTime),
        });
      }, 800);
    }));
    await page.close();
    return { gap, lcp };
  }

  // strip populated: guest localStorage recent → strip renders
  await capture(`${BASE}/ar`, "home-ar", { seededRecent: true });
  // strip absent state: fresh context, no history → strip hidden
  await capture(`${BASE}/ar`, "home-ar-empty-recent", { seededRecent: false });
  await capture(`${BASE}/en`, "home-en", { seededRecent: false });

  const probe = await emptyBlockProbe(`${BASE}/ar`);
  check("empty block above footer: measured gap between last section and footer", probe.gap != null && probe.gap.gapPx >= 0 && probe.gap.gapPx < 120, `gap ${probe.gap?.gapPx}px (main bottom ${probe.gap?.mainBottom}, footer top ${probe.gap?.footerTop})`);
  check("LCP element identified", probe.lcp != null, JSON.stringify(probe.lcp));
  console.log("LCP:", JSON.stringify(probe.lcp));
  console.log("gap:", JSON.stringify(probe.gap));

  fs.writeFileSync("evidence/phase-04/p40-assertions.json", JSON.stringify({ at: new Date().toISOString(), assertionLog, emptyBlock: probe.gap, lcpElement: probe.lcp }, null, 1) + "\n");

  /* ------------------------------------------------------------ cleanup */
  console.log("cleanup…");
  await svc.from("banners").delete().like("title_en", "Season deals");
  await svc.from("reviews").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.auth.admin.deleteUser(au.user.id);
  await svc.auth.admin.deleteUser(vu.user.id);
  await svc.from("brands").delete().like("slug_en", "p40-brand-%");
  for (const depth of [3, 2, 1]) {
    await svc.from("categories").delete().like("slug_en", "p40-%").eq("depth", depth);
  }
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { count: pCount } = await svc.from("products").select("*", { count: "exact", head: true });
  const { count: cCount } = await svc.from("categories").select("*", { count: "exact", head: true });
  check("DB pristine", pCount === 0 && cCount === 0, `p${pCount} c${cCount}`);

  fs.writeFileSync("evidence/phase-04/p40-log.txt", log.join("\n") + "\n");
  console.log(`\nP4-0 RESULT: ${passCount} pass, ${failCount} fail`);
  if (failCount > 0) process.exitCode = 1;
  await browser.close();
} catch (error) {
  console.error("P4-0 ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 5).join(" | "));
  fs.writeFileSync("evidence/phase-04/p40-log.txt", log.join("\n") + "\nERROR: " + error.message + "\n");
  process.exitCode = 1;
}
