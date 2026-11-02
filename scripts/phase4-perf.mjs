/**
 * Phase 04 — G6 SEO/perf evidence.
 * 1) Meta coverage: title/description/canonical/hreflang/robots per page.
 * 2) JSON-LD validity: parse + check @type on home/product/category/listing.
 * 3) Sitemap baseline: /sitemap.xml parses, carries hreflang alternates.
 * 4) Lighthouse mobile (perf + a11y + SEO categories) for home + product.
 * 5) Throttled LCP (4x CPU + slow-4G) for home/product/listing.
 * Real fixtures; DB pristine at the end.
 * Reproduce: node --env-file=.env scripts/phase4-perf.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import zlib from "node:zlib";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = "http://localhost:3000";
const report = { generatedAt: new Date().toISOString(), meta: [], jsonld: [], sitemap: null, lighthouse: [], lcp: [] };
let passCount = 0, failCount = 0;
const check = (name, cond, detail = "") => {
  if (cond) passCount += 1; else failCount += 1;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`);
};

function png(width, height, [r, g, b]) {
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

async function html(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

try {
  /* ------------------------------------------------- pre-clean leftovers */
  for (const depth of [2, 1]) {
    await svc.from("categories").delete().like("slug_en", "p4g-%").eq("depth", depth);
  }

  /* ---------------------------------------------------------- fixtures */
  console.log("fixtures…");
  const { data: au } = await svc.auth.admin.createUser({ email: `p4g-a-${STAMP}@etsawaa-e2e.com`, password: PWD, email_confirm: true });
  const { data: vu } = await svc.auth.admin.createUser({ email: `p4g-v-${STAMP}@etsawaa-e2e.com`, password: PWD, email_confirm: true });
  await svc.from("profiles").update({ role: "admin" }).eq("id", au.user.id);
  await svc.from("profiles").update({ role: "vendor" }).eq("id", vu.user.id);
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await admin.auth.signInWithPassword({ email: `p4g-a-${STAMP}@etsawaa-e2e.com`, password: PWD });
  const A = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await A.auth.signInWithPassword({ email: `p4g-v-${STAMP}@etsawaa-e2e.com`, password: PWD });
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).limit(1).single();
  const { data: root } = await svc.from("categories").insert({ slug_ar: `إلكترونيات-${STAMP}`, slug_en: `p4g-electronics-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics", show_in_header: true }).select("id").single();
  const tvs = (await svc.from("categories").insert({ slug_ar: `شاشات-${STAMP}`, slug_en: `p4g-tvs-${STAMP}`, name_ar: "شاشات", name_en: "TVs", parent_id: root?.id, depth: 2 }).select("id, slug_ar").single()).data;
  const on = await A.rpc("fn_vendor_onboard", { p_data: { store_name_ar: "متجر الأداء", store_name_en: "Perf Store", category_ids: [tvs?.id], first_name: "ب", last_name: "ب", governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان", terms_version: "1.0", terms_signature: "Perf" } });
  const vendorId = on.data?.vendor_id;
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: vendorId, p_decision: "approve" });
  const { data: vend } = await svc.from("vendors").select("slug").eq("id", vendorId).single();
  const img = `u/${vu.user.id}/perf-${STAMP}.png`;
  await svc.storage.from("media").upload(img, png(640, 640, [40, 50, 70]), { contentType: "image/png", upsert: true });
  const p = await A.rpc("fn_save_product", { p_product: { name_ar: "شاشة أداء 55", name_en: "Perf TV 55", desc_ar: "شاشة ذكية 4K للمقارنة المرجعية.", desc_en: "A 4K smart TV for benchmarking.", leaf_category_id: tvs?.id, media: [{ kind: "image", path: img }] } });
  await A.rpc("fn_generate_variants", { p_product_id: p.data?.id, p_axes: [] });
  const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.data?.id).is("deleted_at", null).single();
  await A.rpc("fn_save_variants", { p_product_id: p.data?.id, p_rows: [{ option_key: v?.option_key ?? "", sku: `G6-${STAMP}`, price_piastres: 2500000, sale_price_piastres: null, stock: 3, image_path: "", is_active: true }] });
  await A.rpc("fn_submit_product", { p_product_id: p.data?.id });
  await admin.rpc("fn_admin_review_product", { p_product_id: p.data?.id, p_decision: "approve", p_reason: null });
  const { data: prod } = await svc.from("products").select("slug_ar, slug_en").eq("id", p.data?.id).single();
  const productUrl = `${BASE}/ar/product/${encodeURIComponent(prod.slug_ar)}`;
  const categoryUrl = `${BASE}/ar/category/${encodeURIComponent(tvs.slug_ar)}`;
  const storeUrl = `${BASE}/ar/store/${vend.slug}`;

  /* ------------------------------------------------------- 1) meta coverage */
  console.log("meta coverage…");
  const pages = [
    ["/ar", "home"],
    ["/en", "home-en"],
    ["/ar/products", "listing"],
    ["/ar/search?q=شاشة", "search"],
    ["/ar/vendors", "vendors"],
    ["/ar/brands", "brands"],
    ["/ar/cart", "cart"],
    ["/ar/sell", "sell"],
    ["/ar/contact", "contact"],
    ["/ar/p/about", "static"],
    ["/ar/compare", "compare"],
    [productUrl, "product"],
    [categoryUrl, "category"],
    [storeUrl, "store"],
  ];
  for (const [path, label] of pages) {
    const { status, body } = await html(path.startsWith("http") ? path : `${BASE}${path}`);
    const hasTitle = /<title>[^<]+<\/title>/.test(body);
    const hasDesc = /<meta name="description" content="[^"]+"/.test(body);
    const hasCanonical = /<link rel="canonical" href="[^"]+"/.test(body);
    const hasHreflang = /hreflang="ar"/i.test(body) && /hreflang="en"/i.test(body) && /hreflang="x-default"/i.test(body);
    const hasOg = /property="og:title"/.test(body);
    const noindex = label === "cart" || label === "compare" || label === "search";
    const robotsOk = noindex ? /robots" content="noindex/.test(body) : !/robots" content="noindex/.test(body);
    const ok = status === 200 && hasTitle && hasDesc && hasCanonical && hasHreflang && hasOg && robotsOk;
    check(`meta: ${label}`, ok, `status ${status}${hasTitle ? "" : " no-title"}${hasDesc ? "" : " no-desc"}${hasCanonical ? "" : " no-canonical"}${hasHreflang ? "" : " no-hreflang"}${robotsOk ? "" : " robots-wrong"}`);
    report.meta.push({ label, url: path, status, title: hasTitle, description: hasDesc, canonical: hasCanonical, hreflang: hasHreflang, og: hasOg, robotsOk });
  }

  /* ------------------------------------------------------ 2) JSON-LD validity */
  console.log("json-ld…");
  const ldChecks = [
    [`${BASE}/ar`, ["Organization", "WebSite"]],
    [productUrl, ["Product", "BreadcrumbList"]],
    [categoryUrl, ["BreadcrumbList", "ItemList"]],
  ];
  for (const [url, types] of ldChecks) {
    const { body } = await html(url);
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
    let allValid = true;
    const found = [];
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) found.push(item["@type"]);
      } catch (e) {
        allValid = false;
        found.push(`PARSE-ERROR ${e.message}`);
      }
    }
    const missing = types.filter((t) => !found.includes(t));
    check(`json-ld ${url.replace(BASE, "")}: ${types.join("+")}`, allValid && missing.length === 0, `found [${found.join(", ")}]${missing.length ? ` MISSING ${missing}` : ""}`);
    report.jsonld.push({ url, expected: types, found });
  }

  /* --------------------------------------------------------- 3) sitemap */
  console.log("sitemap…");
  {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    const parseOk = res.status === 200 && text.startsWith("<?xml") && text.includes("<urlset");
    const urlCount = (text.match(/<loc>/g) ?? []).length;
    const hasProduct = text.includes(`/ar/product/${encodeURIComponent(prod.slug_ar)}`) || text.includes(prod.slug_ar);
    const hasAlternates = text.includes('hreflang="ar"') && text.includes('hreflang="en"');
    check("sitemap.xml valid + hreflang + product listed", parseOk && urlCount > 5 && hasProduct && hasAlternates, `urls ${urlCount}, product ${hasProduct}, alternates ${hasAlternates}`);
    report.sitemap = { status: res.status, urls: urlCount, hasProduct, hasAlternates };
  }

  /* -------------------------------------------------- 4) Lighthouse mobile */
  console.log("lighthouse…");
  const lighthouse = (await import("lighthouse")).default;
  const b = await puppeteer.launch({ headless: "new", protocolTimeout: 300000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--remote-debugging-port=9333"] });
  for (const [url, label] of [[`${BASE}/ar`, "home"], [productUrl, "product"]]) {
    const flags = { port: 9333, onlyCategories: ["performance", "accessibility", "seo"], formFactor: "mobile", screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }, throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 }, maxWaitForLoad: 90000 };
    const result = await lighthouse(url, flags);
    const lhr = result.lhr;
    const scores = {
      performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
      seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
      lcpMs: Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 0),
      cls: lhr.audits["cumulative-layout-shift"]?.numericValue ?? 0,
      tbtMs: Math.round(lhr.audits["total-blocking-time"]?.numericValue ?? 0),
    };
    report.lighthouse.push({ label, url, ...scores });
    console.log(`lighthouse ${label}:`, JSON.stringify(scores));
    check(`lighthouse ${label}: performance ≥ 90`, scores.performance >= 90, JSON.stringify(scores));
  }

  /* ------------------------------------------------- 5) throttled LCP (SSR) */
  console.log("throttled LCP…");
  const page = await b.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  for (const [url, label] of [[`${BASE}/ar`, "home"], [productUrl, "product"], [`${BASE}/ar/products`, "listing"], [categoryUrl, "category"]]) {
    await page.evaluateOnNewDocument(() => {
      window.__lcp = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push(Math.round(e.startTime)); }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 6000));
    const entries = await page.evaluate(() => window.__lcp ?? []);
    const lcp = entries.at(-1) ?? null;
    report.lcp.push({ label, url, lcpMs: lcp });
    check(`throttled LCP ${label} < 2500ms`, lcp != null && lcp < 2500, `${lcp}ms`);
  }
  await b.close();

  /* ------------------------------------------------------------ cleanup */
  console.log("cleanup…");
  // users first: cascades vendors → products, freeing the categories
  await svc.auth.admin.deleteUser(au.user.id);
  await svc.auth.admin.deleteUser(vu.user.id);
  for (const depth of [2, 1]) {
    await svc.from("categories").delete().like("slug_en", "p4g-%").eq("depth", depth);
  }
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { count: pCount } = await svc.from("products").select("*", { count: "exact", head: true });
  const { count: cCount } = await svc.from("categories").select("*", { count: "exact", head: true });
  check("DB pristine after perf run", pCount === 0 && cCount === 0, `p${pCount} c${cCount}`);

  fs.mkdirSync("evidence/phase-04", { recursive: true });
  fs.writeFileSync("evidence/phase-04/seo-perf.json", JSON.stringify(report, null, 1) + "\n");
  console.log(`\nG6 RESULT: ${passCount} pass, ${failCount} fail`);
  if (failCount > 0) process.exitCode = 1;
} catch (error) {
  console.error("G6 ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 5).join(" | "));
  fs.mkdirSync("evidence/phase-04", { recursive: true });
  fs.writeFileSync("evidence/phase-04/seo-perf.json", JSON.stringify(report, null, 1) + "\n");
  process.exitCode = 1;
}
