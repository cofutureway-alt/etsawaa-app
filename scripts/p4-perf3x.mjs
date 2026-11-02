/**
 * Perf round — Lighthouse mobile ×3 (medians) for home + product, with a
 * REAL banner fixture (optimized owner artwork webp from /public — the same
 * format real banners ship in) + LCP element identification.
 * Reproduce: node --env-file=.env scripts/p4-perf3x.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = "http://localhost:3000";
const report = { at: new Date().toISOString(), runs: [] };

async function lh(url, port) {
  const result = await lighthouse(url, {
    port, onlyCategories: ["performance"], formFactor: "mobile",
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
    maxWaitForLoad: 120000,
  });
  const a = result.lhr.audits;
  return {
    score: Math.round((result.lhr.categories.performance?.score ?? 0) * 100),
    lcpMs: Math.round(a["largest-contentful-paint"]?.numericValue ?? 0),
    tbtMs: Math.round(a["total-blocking-time"]?.numericValue ?? 0),
    cls: a["cumulative-layout-shift"]?.numericValue ?? 0,
    fcpMs: Math.round(a["first-contentful-paint"]?.numericValue ?? 0),
    lcpElement: a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet?.slice(0, 120) ?? null,
  };
}

const median = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? null;
};

try {
  /* fixtures: vendor + TV product + a real-format webp banner */
  const { data: au } = await svc.auth.admin.createUser({ email: `p4x-a-${STAMP}@etsawaa-e2e.com`, password: PWD, email_confirm: true });
  const { data: vu } = await svc.auth.admin.createUser({ email: `p4x-v-${STAMP}@etsawaa-e2e.com`, password: PWD, email_confirm: true });
  await svc.from("profiles").update({ role: "admin" }).eq("id", au.user.id);
  await svc.from("profiles").update({ role: "vendor" }).eq("id", vu.user.id);
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await admin.auth.signInWithPassword({ email: `p4x-a-${STAMP}@etsawaa-e2e.com`, password: PWD });
  const A = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await A.auth.signInWithPassword({ email: `p4x-v-${STAMP}@etsawaa-e2e.com`, password: PWD });
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).limit(1).single();
  const { data: root } = await svc.from("categories").insert({ slug_ar: `إلكترونيات-${STAMP}`, slug_en: `p4x-electronics-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics", show_in_header: true }).select("id").single();
  const { data: tvs } = await svc.from("categories").insert({ slug_ar: `شاشات-${STAMP}`, slug_en: `p4x-tvs-${STAMP}`, name_ar: "شاشات", name_en: "TVs", parent_id: root?.id, depth: 2 }).select("id").single();
  const on = await A.rpc("fn_vendor_onboard", { p_data: { store_name_ar: "متجر الأداء", store_name_en: "Perf Store", category_ids: [tvs?.id], first_name: "ب", last_name: "ب", governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان", terms_version: "1.0", terms_signature: "P" } });
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on.data?.vendor_id, p_decision: "approve" });
  // REAL banner format: the optimized owner artwork webp (what real banners are)
  const bannerBytes = fs.readFileSync("public/promo-wide-1.webp");
  const bannerPath = `u/${vu.user.id}/banner-${STAMP}.webp`;
  await svc.storage.from("media").upload(bannerPath, bannerBytes, { contentType: "image/webp", upsert: true });
  const teeBytes = fs.readFileSync("public/promo-wide-1-sm.webp");
  const teePath = `u/${vu.user.id}/tv-${STAMP}.webp`;
  await svc.storage.from("media").upload(teePath, teeBytes, { contentType: "image/webp", upsert: true });
  await svc.from("banners").insert({ title_ar: "عروض الموسم", title_en: "Season deals", image_path: bannerPath, link_url: "/ar/products", position: 0 });
  const p = await A.rpc("fn_save_product", { p_product: { name_ar: "شاشة أداء 55", name_en: "Perf TV 55", desc_ar: "شاشة ذكية 4K.", desc_en: "4K smart TV.", leaf_category_id: tvs?.id, media: [{ kind: "image", path: teePath }] } });
  await A.rpc("fn_generate_variants", { p_product_id: p.data?.id, p_axes: [] });
  const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", p.data?.id).is("deleted_at", null).single();
  await A.rpc("fn_save_variants", { p_product_id: p.data?.id, p_rows: [{ option_key: v?.option_key ?? "", sku: `X-${STAMP}`, price_piastres: 2500000, sale_price_piastres: null, stock: 3, image_path: "", is_active: true }] });
  await A.rpc("fn_submit_product", { p_product_id: p.data?.id });
  await admin.rpc("fn_admin_review_product", { p_product_id: p.data?.id, p_decision: "approve", p_reason: null });
  const { data: prod } = await svc.from("products").select("slug_ar").eq("id", p.data?.id).single();

  const productUrl = `${BASE}/ar/product/${encodeURIComponent(prod.slug_ar)}`;
  const b = await puppeteer.launch({ headless: "new", protocolTimeout: 600000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--remote-debugging-port=9333"] });
  for (const [url, label] of [[`${BASE}/ar`, "home"], [productUrl, "product"]]) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await lh(url, 9333);
      runs.push(r);
      console.log(`${label} run ${i + 1}:`, JSON.stringify(r));
    }
    const medians = {
      score: median(runs.map((r) => r.score)),
      lcpMs: median(runs.map((r) => r.lcpMs)),
      tbtMs: median(runs.map((r) => r.tbtMs)),
      cls: median(runs.map((r) => r.cls)),
      fcpMs: median(runs.map((r) => r.fcpMs)),
    };
    report.runs.push({ label, url, runs, medians });
    console.log(`${label} MEDIANS:`, JSON.stringify(medians));
  }
  await b.close();

  /* cleanup */
  await svc.from("banners").delete().like("title_en", "Season deals");
  await svc.auth.admin.deleteUser(au.user.id);
  await svc.auth.admin.deleteUser(vu.user.id);
  for (const depth of [2, 1]) {
    await svc.from("categories").delete().like("slug_en", "p4x-%").eq("depth", depth);
  }
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { count: pCount } = await svc.from("products").select("*", { count: "exact", head: true });
  const { count: cCount } = await svc.from("categories").select("*", { count: "exact", head: true });
  report.pristine = pCount === 0 && cCount === 0;
  console.log("pristine:", report.pristine, `(p${pCount} c${cCount})`);

  fs.writeFileSync("evidence/phase-04/perf-3x.json", JSON.stringify(report, null, 1) + "\n");
} catch (error) {
  console.error("PERF3X ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 5).join(" | "));
  fs.writeFileSync("evidence/phase-04/perf-3x.json", JSON.stringify(report, null, 1) + "\nERROR: " + error.message + "\n");
  process.exitCode = 1;
}
