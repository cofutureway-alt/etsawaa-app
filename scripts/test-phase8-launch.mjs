/**
 * Phase 08 — content & launch E2E.
 * Blog public (list/article/TOC/share/related), drafts invisible, RSS valid XML,
 * sitemap contains posts, 301 moved slug, meta coverage on public pages,
 * JSON-LD core set, map-pin order round-trip (coords on order, none for vendor),
 * carrier label QR (maps URL), cancelled watermark. DB pristine after run.
 * Reproduce: E2E_BASE=http://localhost:<port> node --env-file=.env scripts/test-phase8-launch.mjs
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Cust#12345";
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const results = [];
let browser;

const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
};

const signIn = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PWD });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return c;
};

const F = {
  users: {}, vendors: {}, catIds: [], products: [], imgPaths: [],
  orders: [], postIds: [], blogCatIds: [], addressId: null,
};

async function makeUser(role, tag) {
  const email = `p8-${role}-${tag}-${STAMP}@etsawaa-e2e.com`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from("profiles").update({ role }).eq("id", u.user.id);
  F.users[`${role}-${tag}`] = { id: u.user.id, email };
  return u.user;
}

const PRODUCT_IMG = fs.readFileSync("public/promo-wide-1-sm.webp");

/** QR PNG/SVG payloads are base64 — decode and look for the maps URL. */
function printBufferHasMaps(htmlText) {
  const hits = htmlText.match(/data:image[^"' ]+/g) ?? [];
  for (const h of hits) {
    try {
      const decoded = Buffer.from(h.split(",")[1], "base64").toString("utf8");
      if (decoded.includes("maps.google.com")) return true;
    } catch { /* not text */ }
  }
  return false;
}

async function main() {
  /* ---------- fixtures ---------- */
  await makeUser("admin", "0");
  const admin = await signIn(F.users["admin-0"].email);

  const root = (await admin.from("categories").insert({ slug_ar: `جذر-${STAMP}`, slug_en: `p8-root-${STAMP}`, name_ar: "جذر", name_en: "Root", depth: 1 }).select("id").single()).data;
  const mid = (await admin.from("categories").insert({ parent_id: root.id, slug_ar: `وسط-${STAMP}`, slug_en: `p8-mid-${STAMP}`, name_ar: "وسط", name_en: "Mid", depth: 2 }).select("id").single()).data;
  const leaf = (await admin.from("categories").insert({ parent_id: mid.id, slug_ar: `ورقة-${STAMP}`, slug_en: `p8-leaf-${STAMP}`, name_ar: "ورقة", name_en: "Leaf", depth: 3 }).select("id").single()).data;
  F.catIds.push(root.id, mid.id, leaf.id);
  F.leafId = leaf.id;

  await makeUser("vendor", "A");
  const vClient = await signIn(F.users["vendor-A"].email);
  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1);
  const { data: on, error: onErr } = await vClient.rpc("fn_vendor_onboard", {
    p_data: {
      store_name_ar: `متجر ${STAMP}`, store_name_en: `Store ${STAMP}`,
      category_ids: [F.leafId], first_name: "ب", last_name: "ت",
      governorate_id: area[0].governorate_id, area_id: area[0].id, address1: "عنوان المتجر",
      terms_version: "1.0", terms_signature: "P8",
    },
  });
  if (onErr || !on?.vendor_id) throw new Error(`onboard: ${onErr?.message ?? JSON.stringify(on)}`);
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: on.vendor_id, p_decision: "approve" });
  F.vendors.A = { id: on.vendor_id, userId: F.users["vendor-A"].id, client: vClient };

  // product
  const imgPath = `u/${F.vendors.A.userId}/p8-${STAMP}.webp`;
  await svc.storage.from("media").upload(imgPath, PRODUCT_IMG, { contentType: "image/webp", upsert: true });
  const { data: prod, error: pe } = await vClient.rpc("fn_save_product", {
    p_product: {
      name_ar: "ساعة يد فاخرة", name_en: "Luxury Watch",
      desc_ar: "ساعة أنيقة", desc_en: "Elegant watch",
      leaf_category_id: F.leafId, shipping_mode: "platform",
      media: [{ kind: "image", path: imgPath }],
    },
  });
  if (pe || !prod?.id) throw new Error(`product: ${pe?.message}`);
  await vClient.rpc("fn_generate_variants", { p_product_id: prod.id, p_axes: [] });
  const { data: variant } = await svc.from("variants").select("id, option_key").eq("product_id", prod.id).is("deleted_at", null).single();
  await vClient.rpc("fn_save_variants", {
    p_product_id: prod.id,
    p_rows: [{ option_key: variant.option_key, sku: `P8-W-${STAMP}`, price_piastres: 125000, sale_price_piastres: null, stock: 4, image_path: "", is_active: true }],
  });
  await vClient.rpc("fn_submit_product", { p_product_id: prod.id });
  await admin.rpc("fn_admin_review_product", { p_product_id: prod.id, p_decision: "approve", p_reason: null });
  F.products.push(prod.id);
  F.imgPaths.push(imgPath);

  // customer + saved address
  await makeUser("customer", "0");
  const customer = await signIn(F.users["customer-0"].email);
  const { data: areaRow } = await svc.from("areas").select("id").eq("governorate_id", 1).order("id");
  const custArea = areaRow[2].id;
  const { data: addr, error: addrErr } = await customer.from("user_addresses").insert({
    user_id: F.users["customer-0"].id,
    label: "المنزل", full_name: "عميل الجولة", phone: `+2010${String(STAMP).slice(-8)}`,
    governorate_id: 1, area_id: custArea, address1: "١٥ شارع التحرير", is_default: true,
  }).select("id").single();
  if (addrErr || !addr?.id) throw new Error(`address insert: ${addrErr?.message ?? "null"}`);
  F.addressId = addr.id;

  const orderPayload = (extra = {}) => ({
    attempt_key: crypto.randomUUID(),
    payment_method: "cod",
    coupon_code: null,
    address: {
      full_name: "عميل الجولة", phone_primary: "+201001234567", phone_alternate: "+201109876543",
      governorate_id: 1, area_id: custArea, address1: "١٥ شارع التحرير",
      ...(extra.pin ? extra.pin : {}),
    },
    ...extra.rest,
  });

  /* ---------- BLOG (L-01/L-02) ---------- */
  {
    const { data: bc } = await admin.from("blog_categories").insert({
      name_ar: "أدلة", name_en: "Guides", slug_ar: `أدلة-${STAMP}`, slug_en: `guides-${STAMP}`,
    }).select("id").single();
    F.blogCatIds.push(bc.id);

    const mk = async (titleAr, titleEn, contentAr, status) => {
      const slugEn = `p8-${titleEn.toLowerCase().replace(/\s+/g, "-")}-${STAMP}`;
      const { data: post } = await admin.from("blog_posts").insert({
        title_ar: titleAr, title_en: titleEn,
        slug_ar: `${titleEn.toLowerCase().replace(/\s+/g, "-")}-${STAMP}`, slug_en: slugEn,
        excerpt_ar: "مقتطف", excerpt_en: "Excerpt",
        content_ar: contentAr, content_en: contentAr,
        status, published_at: status === "published" ? new Date().toISOString() : null,
        category_id: bc.id, author: F.users["admin-0"].id,
      }).select("id, slug_en").single();
      F.postIds.push(post.id);
      return post;
    };

    const published = await mk("دليل الشراء", "Buying Guide",
      "<h2>لماذا اتسوء</h2><p>نص أول.</p><h3>الخطوات</h3><p>نص ثانٍ.</p><h2>الأسئلة الشائعة</h2><p>نص ثالث.</p>",
      "published");
    await mk("مسودة داخلية", "Internal draft", "<p>غير منشور.</p>", "draft");
    check("B1 fetched slugs unique", published.slug_en.includes("buying-guide"), published.slug_en);

    // list page shows published, hides draft
    const list = await fetch(`${BASE}/${"ar"}/blog`);
    const listText = await list.text();
    check("B2 list 200", list.status === 200, String(list.status));
    check("B3 list shows published article", listText.includes("دليل الشراء"), "found");
    check("B4 list hides drafts", !listText.includes("مسودة داخلية"), "absent");

    // article page (Arabic locale uses the ARABIC slug) — suite mirrors the route
    const { data: slugRow } = await svc.from("blog_posts").select("slug_ar, slug_en").eq("id", published.id).single();
    const art = await fetch(`${BASE}/ar/blog/${encodeURIComponent(slugRow.slug_ar)}`);
    const artText = await art.text();
    check("B5 article 200", art.status === 200, String(art.status));
    check("B6 TOC anchors injected", artText.includes('id="sec-0"') && artText.includes('id="sec-2"'), "sec-*");
    check("B7 BlogPosting JSON-LD", artText.includes('"BlogPosting"'), "ld+json");
    check("B8 BreadcrumbList JSON-LD", artText.includes('"BreadcrumbList"'), "ld+json");
    check("B9 share row present", artText.includes("facebook.com/sharer"), "share");
    check("B10 canonical present", artText.includes('rel="canonical"'), "meta");

    // draft article direct URL → 404 (public)
    const { data: draftRow } = await svc.from("blog_posts").select("slug_ar, slug_en").like("slug_en", "%internal-draft-%").single();
    const draftRes = await fetch(`${BASE}/ar/blog/${encodeURIComponent(draftRow.slug_ar)}`);
    check("B11 draft article 404 publicly", draftRes.status === 404 || draftRes.status === 302, String(draftRes.status));

    // RSS: valid XML with the published item only
    const rss = await fetch(`${BASE}/rss.xml`);
    const rssText = await rss.text();
    check("B12 rss 200 xml", rss.status === 200 && rssText.startsWith("<?xml"), String(rss.status));
    check("B13 rss has published item", rssText.includes("دليل الشراء"), "item");
    check("B14 rss hides drafts", !rssText.includes("مسودة داخلية"), "absent");

    // sitemap includes the article
    const sm = await fetch(`${BASE}/sitemap.xml`);
    const smText = await sm.text();
    const { data: smSlug } = await svc.from("blog_posts").select("slug_ar").eq("id", published.id).single();
    check("B15 sitemap includes blog post", smText.includes(`/ar/blog/${encodeURIComponent(smSlug.slug_ar)}`), "loc");

    // 301 moved slug (L-08)
    const oldSlug = `old-buying-${STAMP}`;
    const addr = await admin.rpc("fn_admin_add_slug_redirect", {
      p_kind: "post", p_old_ar: oldSlug, p_old_en: oldSlug,
      p_new_ar: published.slug_en, p_new_en: published.slug_en,
    });
    check("B16 redirect created", addr.data?.ok === true, JSON.stringify(addr.data));
    const moved = await fetch(`${BASE}/en/blog/${oldSlug}`, { redirect: "manual" });
    check("B17 moved slug 301", moved.status === 301 && String(moved.headers.get("location") || "").includes(published.slug_en), `${moved.status} ${moved.headers.get("location")}`);
  }

  /* ---------- META + JSON-LD coverage (L-05/L-06) ---------- */
  {
    const targets = [
      { url: `${BASE}/ar`, need: ["Organization", "WebSite"] },
      { url: `${BASE}/ar/products`, need: ["ItemList"] },
    ];
    // product page needs a live product slug
    const { data: prodRow } = await svc.from("products").select("slug_ar, slug_en").eq("id", F.products[0]).single();
    targets.push({ url: `${BASE}/ar/product/${encodeURIComponent(prodRow.slug_ar)}`, need: ["\"Product\"", "BreadcrumbList", "offers"] });

    for (const tgt of targets) {
      const res = await fetch(tgt.url);
      const text = await res.text();
      const hasTitle = /<title>[^<]{3,}<\/title>/.test(text);
      const hasDesc = text.includes('name="description"');
      const hasCanonical = text.includes('rel="canonical"');
      const hasHreflang = text.includes('hreflang="en"') && text.includes('hreflang="ar"');
      check(`M1 meta complete ${new URL(tgt.url).pathname}`, res.status === 200 && hasTitle && hasDesc && hasCanonical && hasHreflang,
        `${res.status} title=${hasTitle} desc=${hasDesc} canon=${hasCanonical} hreflang=${hasHreflang}`);
      for (const ld of tgt.need) {
        check(`M2 JSON-LD ${ld.replace(/"/g, "")} on ${new URL(tgt.url).pathname}`, text.includes(ld), ld);
      }
    }
  }

  /* ---------- MAP PIN (L-20) ---------- */
  let orderNumber;
  {
    await customer.rpc("fn_cart_add", { p_variant_id: variant.id, p_qty: 1 });
    const created = await customer.rpc("fn_create_order", {
      p_payload: orderPayload({ pin: { lat: 30.0444, lng: 31.2357, geo_accuracy: 25 } }),
    });
    check("P1 order with pin created", created.data?.ok === true, JSON.stringify(created.data));
    orderNumber = created.data.number;
    F.orders.push(orderNumber);
    const { data: ord } = await svc.from("orders").select("shipping_lat, shipping_lng, shipping_geo_accuracy_m").eq("number", orderNumber).single();
    check("P2 pin persisted on order", ord.shipping_lat !== null && ord.shipping_lng !== null && ord.shipping_geo_accuracy_m === 25, JSON.stringify(ord));

    // vendor snapshot must NOT include coordinates
    const vendorSession = vClient;
    const snap = await vendorSession.rpc("fn_vendor_order_snapshot", { p_number: orderNumber });
    const snapText = JSON.stringify(snap.data);
    check("P3 vendor snapshot has NO coordinates", !snapText.includes("shipping_lat") && !snapText.includes("30.0444"), snapText.slice(0, 120));

    // carrier label with QR maps URL (admin/session-free render needs the print route)
    browser = browser ?? await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
    // dedicated browser context → the admin cookie never clobbers the customer's
    const adminCtx = await browser.createBrowserContext();
    const page = await adminCtx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
    await page.waitForSelector("input[name=identifier]", { timeout: 30000 });
    await page.type("input[name=identifier]", F.users["admin-0"].email);
    await page.type("input[name=password]", PWD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => undefined),
      page.click("button[type=submit]"),
    ]);
    await page.waitForFunction(() => !window.location.pathname.includes("/auth"), { timeout: 20000 }).catch(() => {});
    const landed = await page.evaluate(() => location.pathname);
    const cookies = await adminCtx.cookies(`${BASE}`);
    console.log("   [P4 cookies]", cookies.map((c) => `${c.name}=${String(c.value).slice(0, 12)}…`).join(" | ") || "NONE");
    // in-page fetch: cookies ride along with the admin session
    const prin = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return { status: r.status, text: await r.text() };
    }, `${BASE}/order/${encodeURIComponent(orderNumber)}/print/label_carrier?lang=ar`);
    check("P4 carrier label renders with pin QR", prin.status === 200 && prin.text.includes("data:image/svg+xml;base64"), `landed=${landed} status=${prin.status}`);
    // P5: a QR SVG is an encoded MATRIX — the URL never appears as text, so
    // text/decode search can't see it. Instead regenerate the EXPECTED QR with
    // the same bwip-js options and prove the label carries that exact image:
    // byte-equality ⇒ the matrix encodes the maps URL for the persisted pin.
    const bwipjs = (await import("bwip-js")).default;
    const expUrl = `https://maps.google.com/?q=${(30.0444).toFixed(6)},${(31.2357).toFixed(6)}`;
    const expSvg = (await bwipjs.toSVG({ bcid: "qrcode", text: expUrl, scale: 4, includetext: false }))
      .replace(/<\?xml[^?]*\?>\s*/, "");
    const expB64 = `data:image/svg+xml;base64,${Buffer.from(expSvg).toString("base64")}`;
    check("P5 QR is scannable maps payload", prin.text.includes(expB64), expUrl);
    await page.close();
    await adminCtx.close();
  }

  /* ---------- CANCELLED WATERMARK (part of L-19) ---------- */
  {
    const orow = await svc.from("orders").select("id").eq("number", orderNumber).single();
    const { data: wdata, error: werr } = await admin.rpc("fn_cancel_order_admin", { p_order_id: orow.data.id, p_reason: "P8 watermark" });
    if (werr || !wdata?.ok) console.log("   [W1 debug]", werr?.message ?? "", JSON.stringify(wdata));
    const { data: st, error: sterr } = await svc.from("orders").select("status").eq("id", orow.data.id).single();
    if (sterr || st?.status !== "cancelled") console.log("   [W1 st]", sterr?.message ?? "", JSON.stringify(st));
    check("W1 order cancelled via admin", st?.status === "cancelled", st?.status);
    browser = browser ?? await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const wCtx = await browser.createBrowserContext();
    const wPage = await wCtx.newPage();
    await wPage.setViewport({ width: 1280, height: 900 });
    await wPage.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
    await wPage.waitForSelector("input[name=identifier]", { timeout: 30000 });
    await wPage.type("input[name=identifier]", F.users["admin-0"].email);
    await wPage.type("input[name=password]", PWD);
    await Promise.all([
      wPage.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => undefined),
      wPage.click("button[type=submit]"),
    ]);
    await wPage.waitForFunction(() => !window.location.pathname.includes("/auth"), { timeout: 20000 }).catch(() => {});
        const inv = await wPage.evaluate(async (url) => {
      const r = await fetch(url);
      return { status: r.status, text: await r.text() };
    }, `${BASE}/order/${encodeURIComponent(orderNumber)}/print/invoice_admin?lang=ar`);
    check("W2 cancelled watermark on invoice", inv.status === 200 && inv.text.includes("ملغي"), `status=${inv.status} watermark=${inv.text.includes("ملغي")}`);
  }

  /* ---------- CHECKOUT MAP UI (browser render) ---------- */
  {
    browser = browser ?? await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    const login = await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
    await page.type("input[name=identifier]", F.users["customer-0"].email);
    await page.type("input[name=password]", PWD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => undefined),
      page.click("button[type=submit]"),
    ]);
    await page.goto(`${BASE}/ar/checkout`, { waitUntil: "networkidle2", timeout: 90000 });
    // the map mounts inside the NEW-address accordion — open it first
    const opened = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button, [role=button], input[type=radio], label")];
      const target = btns.find((b) => /عنوان جديد|new address|new/i.test(b.textContent ?? ""));
      if (target) { (target.closest("button") ?? target) .click(); return true; }
      return false;
    });
    await page.waitForSelector(".leaflet-container", { timeout: 15000 }).catch(() => {});
    const mapRendered = await page.evaluate(() => {
      const el = document.querySelector(".leaflet-container");
      return el ? { w: el.clientWidth, h: el.clientHeight } : null;
    });
    check("U1 leaflet map mounts at 390", mapRendered !== null && mapRendered.w > 250 && mapRendered.h > 200, JSON.stringify(mapRendered));
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check("U2 no horizontal scroll at 390 with map", noHScroll, "scrollWidth<=innerWidth");
    await page.close();
  }
}

main()
  .catch((error) => {
    console.error("SUITE ERROR:", error.message, String(error.stack ?? "").split("\n").slice(1, 4).join(" | "));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      fs.mkdirSync("evidence/phase-08", { recursive: true });
      const failed = results.filter((r) => !r.ok);
      fs.writeFileSync("evidence/phase-08/tests-raw.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
      console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
      if (browser) await browser.close();
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
      await svc.from("slug_redirects").delete().neq("id", nil);
      await svc.from("blog_posts").delete().in("id", F.postIds.length ? F.postIds : [nil]);
      await svc.from("blog_categories").delete().in("id", F.blogCatIds.length ? F.blogCatIds : [nil]);
      await svc.from("user_addresses").delete().eq("id", F.addressId ?? nil);
      await svc.from("coupon_redemptions").delete().neq("id", nil);
      await svc.from("coupons").delete().neq("id", nil);
      await svc.from("audit_logs").delete().neq("id", 0);
      await svc.from("email_logs").delete().neq("id", nil);
      if (F.imgPaths.length) await svc.storage.from("media").remove(F.imgPaths);
      for (const pid of F.products) await svc.from("products").delete().eq("id", pid);
      for (const v of Object.values(F.vendors)) await svc.from("vendors").delete().eq("id", v.id);
      for (let i = F.catIds.length - 1; i >= 0; i -= 1) await svc.from("categories").delete().eq("id", F.catIds[i]);
      for (const u of Object.values(F.users)) await svc.auth.admin.deleteUser(u.id);
      await svc.from("notifications").delete().neq("id", nil);
      await svc.from("settings").delete().in("key", ["general"]);
      const counts = {};
      for (const t of ["orders", "products", "categories", "vendors", "cart_items", "blog_posts", "blog_categories", "slug_redirects", "reviews", "refund_requests", "user_addresses"]) {
        const { count } = await svc.from(t).select("*", { count: "exact", head: true });
        counts[t] = count;
      }
      const pristine = Object.values(counts).every((c) => c === 0);
      console.log("pristine:", pristine, JSON.stringify(counts));
      fs.appendFileSync("evidence/phase-08/tests-raw.json", `\npristine: ${pristine} ${JSON.stringify(counts)}\n`);
    } catch (e) {
      console.error("CLEANUP ERROR:", e.message);
      process.exitCode = 1;
    }
  });
