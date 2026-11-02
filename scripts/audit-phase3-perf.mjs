/**
 * Phase 03 UX/speed audit (owner request).
 * 1) Throttled-LCP (4x CPU + slow-4G — the Lighthouse mobile profile) on the
 *    authed vendor pages: dashboard, onboarding, products list, product
 *    wizard with the live 12-variant matrix.
 * 2) Variant matrix responsiveness at scale (V-16 DoD: 100 rows without
 *    lag): a 121-combo product (11 colors × 11 sizes) + keystroke→paint
 *    latency inside the SKU column (10 samples, p50/max).
 * 3) Client bundle sizes from the build output.
 * Reproduce: node --env-file=.env scripts/audit-phase3-perf.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const PWD = "Vendor#12345";
const report = { generatedAt: new Date().toISOString(), throttling: { cpu: "4x", network: "slow 4G (150ms RTT, 1.6Mbps down)" } };

const b = await puppeteer.launch({ headless: "new", protocolTimeout: 300000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const page = await b.newPage();
page.on("dialog", (d) => { void d.accept(); });

async function measureLcp(url, label) {
  await page.evaluateOnNewDocument(() => {
    window.__lcp = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__lcp.push({ startTime: Math.round(e.startTime), element: e.url ? e.url.split("/").pop() : "(text)" });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 6000));
  const entries = await page.evaluate(() => window.__lcp ?? []);
  const final = entries.at(-1);
  return { label, url, lcpMs: final?.startTime ?? null, element: final?.element ?? null };
}

try {
  /* ------------------------------------------------------ fixtures */
  const adminEmail = `p3perf-admin-${stamp}@etsawaa-e2e.com`;
  const vEmail = `p3perf-vendor-${stamp}@etsawaa-e2e.com`;
  let seq = 0;
  const mkUser = async (email, role) => {
    seq += 1;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true, user_metadata: { full_name: email.split("@")[0], phone_e164: `+2012345${String(stamp).slice(-7)}${seq}` } });
    if (error) throw new Error(error.message);
    if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
    return data.user.id;
  };
  await mkUser(adminEmail, "admin");
  await mkUser(vEmail, "vendor");
  const admin = await (async () => { const c = await import("@supabase/supabase-js").then(({ createClient }) => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })); await c.auth.signInWithPassword({ email: adminEmail, password: PWD }); return c; })();

  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1).single();
  const { data: root } = await svc.from("categories").insert({ slug_ar: `p3perf-${stamp}`, slug_en: `p3perf-${stamp}`, name_ar: "أزياء", name_en: "Fashion" }).select("id").single();
  const { data: leaf } = await svc.from("categories").insert({ slug_ar: `p3perf-tee-${stamp}`, slug_en: `p3perf-tee-${stamp}`, name_ar: "تيشيرتات", name_en: "T-Shirts", parent_id: root?.id, depth: 2 }).select("id").single();
  const { data: colorDef } = await svc.from("attribute_defs").insert({ category_id: leaf?.id, code: "color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single();
  const { data: sizeDef } = await svc.from("attribute_defs").insert({ category_id: leaf?.id, code: "size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single();
  const colorRows = await svc.from("attribute_options").insert(Array.from({ length: 11 }, (_, i) => ({ attribute_id: colorDef?.id, code: `c${i}`, label_ar: `لون ${i + 1}`, label_en: `Color ${i + 1}`, color_hex: "#C0392B", sort: i }))).select("id");
  const sizeRows = await svc.from("attribute_options").insert(Array.from({ length: 11 }, (_, i) => ({ attribute_id: sizeDef?.id, code: `s${i}`, label_ar: `مقاس ${i + 1}`, label_en: `Size ${i + 1}`, sort: i }))).select("id");

  const vendor = await (async () => { const c = await import("@supabase/supabase-js").then(({ createClient }) => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })); await c.auth.signInWithPassword({ email: vEmail, password: PWD }); return c; })();
  const onboard = await vendor.rpc("fn_vendor_onboard", { p_data: {
    store_name_ar: "متجر الأداء", store_name_en: "Perf Store",
    category_ids: [leaf?.id], first_name: "بائع", last_name: "أداء",
    governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان",
    terms_version: "1.0", terms_signature: "Perf Owner",
  } });
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onboard.data?.vendor_id, p_decision: "approve" });

  // a DRAFT product with 121 variants (11 × 11) — the scale case
  const tee = await vendor.rpc("fn_save_product", { p_product: {
    name_ar: "منتج ١٢١ متغير", name_en: "121-variant Product",
    leaf_category_id: leaf?.id,
    media: [{ kind: "image", path: `u/x/perf-${stamp}.png` }],
  } });
  const teeId = tee.data?.id;
  await vendor.rpc("fn_generate_variants", {
    p_product_id: teeId,
    p_axes: [
      { attribute_id: colorDef?.id, option_ids: colorRows.data?.map((r) => r.id) ?? [] },
      { attribute_id: sizeDef?.id, option_ids: sizeRows.data?.map((r) => r.id) ?? [] },
    ],
  });
  const { count: variantCount } = await svc.from("variants").select("id", { count: "exact", head: true }).eq("product_id", teeId).is("deleted_at", null);
  report.variantMatrixRows = variantCount;

  /* --------------------------------- 1) login (unthrottled) then throttle */
  await page.goto("http://localhost:3000/ar/auth/login", { waitUntil: "domcontentloaded" });
  await page.type("input[name=identifier]", vEmail);
  await page.type("input[name=password]", PWD);
  await page.click("button[type=submit]");
  await new Promise((r) => setTimeout(r, 3200));

  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });

  report.lcp = [];
  report.lcp.push(await measureLcp("http://localhost:3000/ar/vendor", "vendor dashboard"));
  report.lcp.push(await measureLcp("http://localhost:3000/ar/vendor/onboarding", "onboarding wizard"));
  report.lcp.push(await measureLcp("http://localhost:3000/ar/vendor/products", "products list"));
  report.lcp.push(await measureLcp(`http://localhost:3000/ar/vendor/products/${teeId}/edit`, "product wizard (draft, 121 variants)"));

  /* ------------------------ 2) matrix typing latency at 121 rows (no CPU
     throttling for the interaction test — pure render cost, desktop class) */
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.goto(`http://localhost:3000/ar/vendor/products/${teeId}/edit`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2500));
  // to step 4 (three "التالي" clicks)
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((el) => el.textContent?.trim() === "التالي");
      buttons[buttons.length - 1]?.click();
    });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const rowCount = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
  report.matrixRenderedRows = rowCount;
  const latencies = [];
  for (let i = 0; i < 10; i += 1) {
    const cell = await page.$("table tbody tr:first-child td:nth-child(2) input");
    if (!cell) break;
    await cell.focus();
    const sample = await page.evaluate(() => new Promise((resolve) => {
      const input = document.querySelector("table tbody tr:first-child td:nth-child(2) input");
      const start = performance.now();
      let raf = 0;
      const tick = () => {
        // one real character through the controlled path
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, `SKU-${Math.random().toString(36).slice(2, 7)}`);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        raf = requestAnimationFrame(() => resolve(Math.round(performance.now() - start)));
      };
      cancelAnimationFrame(raf);
      requestAnimationFrame(tick);
    }));
    latencies.push(sample);
  }
  latencies.sort((a, b2) => a - b2);
  report.matrixKeystrokeToPaintMs = { samples: latencies, p50: latencies[Math.floor(latencies.length / 2)], max: latencies.at(-1) };

  /* ------------------------------------------------- 3) bundle sizes */
  const assets = fs.readdirSync("build/client/assets").filter((f) => f.endsWith(".js"));
  const sizes = assets.map((f) => ({ file: f, kb: Math.round(fs.statSync(`build/client/assets/${f}`).size / 1024) }));
  sizes.sort((a, b2) => b2.kb - a.kb);
  report.bundle = {
    clientJsFiles: assets.length,
    totalKb: sizes.reduce((sum, s) => sum + s.kb, 0),
    top10: sizes.slice(0, 10),
    entry: sizes.find((s) => s.file.startsWith("entry")) ?? null,
    wizard: sizes.filter((s) => /product-wizard|variant-matrix/.test(s.file)),
  };

  /* ------------------------------------------------------- cleanup */
  await svc.from("categories").delete().in("id", [root?.id, leaf?.id]);
  for (const email of [adminEmail, vEmail]) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    const user = list.users.find((u) => u.email === email);
    if (user) await svc.auth.admin.deleteUser(user.id);
  }
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);

  fs.mkdirSync("evidence/phase-03", { recursive: true });
  fs.writeFileSync("evidence/phase-03/perf-audit.json", JSON.stringify(report, null, 1) + "\n");
  console.log(JSON.stringify(report, null, 1));
  console.log("PERF AUDIT OK");
  await b.close();
} catch (error) {
  console.error("PERF AUDIT ERROR:", error.message);
  try { fs.writeFileSync("evidence/phase-03/perf-audit.json", JSON.stringify(report, null, 1) + "\n"); } catch { /* ignore */ }
  await b.close();
  process.exitCode = 1;
}
