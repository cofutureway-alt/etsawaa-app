/**
 * Phase 04 — evidence screens at 390/768/1280/1440 + guest-flow check.
 * Pages: home (ar+en), category, listing (filtered URL), search, product,
 * store, vendors, brands, cart, seller center, static page, compare +
 * cart drawer. Real fixtures only; DB pristine at the end.
 * Reproduce: node --env-file=.env scripts/phase4-screens.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import zlib from "node:zlib";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ANON = process.env.SUPABASE_ANON_KEY;
const URL_ = process.env.SUPABASE_URL;
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 300000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const page = await b.newPage();
page.on("dialog", (d) => { void d.accept(); });

const STAMP = Date.now();
const PWD = "Vendor#12345";
const OUT = "evidence/phase-04/screens";
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [390, 768, 1280, 1440];
const log = [];
let passCount = 0, failCount = 0;
const check = (name, cond, detail = "") => {
  log.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}`);
  if (cond) passCount += 1; else failCount += 1;
};

function png(width, height, [r, g, b2]) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x += 1) {
      const off = y * (1 + width * 3) + 1 + x * 3;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b2;
    }
  }
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

async function goto2(url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2200));
}
async function shot(name) {
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 650));
    try {
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true, timeout: 60000 });
    } catch {
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, timeout: 60000 });
    }
  }
  console.log("shots:", name);
}


const must = (res, label) => {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
};

let seq = 0;
async function mkUser(email, role) {
  seq += 1;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PWD, email_confirm: true,
    user_metadata: { full_name: email.split("@")[0], phone_e164: `+2012345${String(STAMP).slice(-7)}${seq}` },
  });
  if (error) throw new Error(error.message);
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
}

const fx = {};
try {
  /* ------------------------------------------------- pre-clean leftovers */
  {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    for (const user of list.users.filter((u) => u.email?.startsWith("p4s-"))) {
      await svc.auth.admin.deleteUser(user.id);
    }
  }
  await svc.from("brands").delete().like("slug_en", "p4s-brand-%");
  for (const depth of [3, 2, 1]) {
    await svc.from("categories").delete().like("slug_en", "p4s-%").eq("depth", depth);
  }
  await svc.from("banners").delete().like("title_en", "Summer deals");
  await svc.from("events").delete().like("name_en", "Black Friday");
  await svc.from("reviews").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  /* ---------------------------------------------------------- fixtures */
  console.log("fixtures…");
  const adminEmail = `p4s-admin-${STAMP}@etsawaa-e2e.com`;
  const aEmail = `p4s-vendor-a-${STAMP}@etsawaa-e2e.com`;
  const custEmail = `p4s-cust-${STAMP}@etsawaa-e2e.com`;
  await mkUser(adminEmail, "admin");
  const aUid = await mkUser(aEmail, "vendor");
  const custId = await mkUser(custEmail, "customer");
  const admin = await (async () => { const c = createClient(URL_, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email: adminEmail, password: PWD }); return c; })();
  const A = await (async () => { const c = createClient(URL_, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email: aEmail, password: PWD }); return c; })();

  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1).single();

  // 3-level category tree for the /sell map + category page subcategory cards
  const fashion = must(await svc.from("categories").insert({ slug_ar: `ملابس-${STAMP}`, slug_en: `p4s-fashion-${STAMP}`, name_ar: "ملابس", name_en: "Fashion", show_in_header: true }).select("id").single(), "fashion cat");
  const tee = must(await svc.from("categories").insert({ slug_ar: `تيشيرتات-${STAMP}`, slug_en: `p4s-tshirts-${STAMP}`, name_ar: "تيشيرتات", name_en: "T-Shirts", parent_id: fashion?.id, depth: 2, description_ar: "تيشيرتات قطنية بمقاسات متعددة", description_en: "Cotton tees in every size", show_in_header: true }).select("id").single(), "tee cat");
  const polo = must(await svc.from("categories").insert({ slug_ar: `بولو-${STAMP}`, slug_en: `p4s-polo-${STAMP}`, name_ar: "قمصان بولو", name_en: "Polo Shirts", parent_id: fashion?.id, depth: 2, show_in_header: true }).select("id").single(), "polo cat");
  // depth-3 node lives under polo so `tee` stays a childless LEAF (attribute defs attach to leaves)
  void must(await svc.from("categories").insert({ slug_ar: `أوفرسايز-${STAMP}`, slug_en: `p4s-oversized-${STAMP}`, name_ar: "بولو أوفرسايز", name_en: "Oversized Polo", parent_id: polo?.id, depth: 3 }).select("id").single(), "oversized cat");
    const electronics = must(await svc.from("categories").insert({ slug_ar: `إلكترونيات-${STAMP}`, slug_en: `p4s-electronics-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics", show_in_header: true }).select("id").single(), "electronics cat");
  const tvs = must(await svc.from("categories").insert({ slug_ar: `شاشات-${STAMP}`, slug_en: `p4s-tvs-${STAMP}`, name_ar: "شاشات", name_en: "TVs", parent_id: electronics?.id, depth: 2 }).select("id").single(), "tvs cat");

  const colorDef = must(await svc.from("attribute_defs").insert({ category_id: tee?.id, code: "color", label_ar: "اللون", label_en: "Color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single(), "color def");
  const sizeDef = must(await svc.from("attribute_defs").insert({ category_id: tee?.id, code: "size", label_ar: "المقاس", label_en: "Size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single(), "size def");
  const colorRows = must(await svc.from("attribute_options").insert([
    { attribute_id: colorDef?.id, code: "red", label_ar: "أحمر", label_en: "Red", color_hex: "#C0392B", sort: 0 },
    { attribute_id: colorDef?.id, code: "blue", label_ar: "أزرق", label_en: "Blue", color_hex: "#2471A3", sort: 1 },
    { attribute_id: colorDef?.id, code: "green", label_ar: "أخضر", label_en: "Green", color_hex: "#1E8449", sort: 2 },
  ]).select("id"), "color options");
  const sizeRows = must(await svc.from("attribute_options").insert([
    { attribute_id: sizeDef?.id, code: "sm", label_ar: "S", label_en: "S", sort: 0 },
    { attribute_id: sizeDef?.id, code: "md", label_ar: "M", label_en: "M", sort: 1 },
    { attribute_id: sizeDef?.id, code: "lg", label_ar: "L", label_en: "L", sort: 2 },
    { attribute_id: sizeDef?.id, code: "xl", label_ar: "XL", label_en: "XL", sort: 3 },
  ]).select("id"), "size options");

  const brand = must(await svc.from("brands").insert({ name_ar: "اتسو سبورت", name_en: "Etso Sport", slug_ar: `اتسو-سبورت-${STAMP}`, slug_en: `p4s-brand-${STAMP}` }).select("id").single(), "brand");

  const imgs = {
    teeMain: `u/${aUid}/s-tee-main-${STAMP}.png`, teeRed: `u/${aUid}/s-tee-red-${STAMP}.png`,
    tv: `u/${aUid}/s-tv-${STAMP}.png`, logo: `u/${aUid}/s-logo-${STAMP}.png`,
    banner: `u/${aUid}/s-banner-${STAMP}.png`, catThumb: `u/${aUid}/s-cat-${STAMP}.png`,
    dbBanner: `u/${aUid}/s-db-banner-${STAMP}.png`, brandThumb: `u/${aUid}/s-brand-${STAMP}.png`,
  };
  const uploads = [
    [imgs.teeMain, [180, 60, 60]], [imgs.teeRed, [220, 40, 40]], [imgs.tv, [40, 50, 70]],
    [imgs.logo, [140, 10, 10]], [imgs.banner, [80, 10, 10]], [imgs.catThumb, [190, 150, 150]],
    [imgs.dbBanner, [120, 20, 20]], [imgs.brandThumb, [30, 80, 140]],
  ];
  for (const [path, color] of uploads) {
    const up = await svc.storage.from("media").upload(path, png(640, 640, color), { contentType: "image/png", upsert: true });
    if (up.error) throw new Error(`upload ${path}: ${up.error.message}`);
  }
  await svc.from("categories").update({ thumb_path: imgs.catThumb }).in("id", [fashion?.id, tee?.id, electronics?.id]);
  await svc.from("brands").update({ thumb_path: imgs.brandThumb }).eq("id", brand?.id);

  const onboard = await A.rpc("fn_vendor_onboard", { p_data: {
    store_name_ar: "متجر الأناقة", store_name_en: "Elegance Store",
    category_ids: [tee?.id], first_name: "أ", last_name: "ب",
    governorate_id: area?.governorate_id, area_id: area?.id, address1: "شارع التحرير",
    terms_version: "1.0", terms_signature: "Elegance Owner",
  } });
  const vendorA = onboard.data?.vendor_id;
  await svc.from("vendors").update({ logo_path: imgs.logo, banner_path: imgs.banner, is_featured: true, short_desc_ar: "أفضل تيشيرتات القاهرة", short_desc_en: "Cairo's best tees" }).eq("id", vendorA);
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: vendorA, p_decision: "approve" });
  await admin.rpc("fn_admin_verify_vendor", { p_vendor_id: vendorA, p_decision: "verify" });

  // tee: 12 variants, red image per-variant, blue sale, featured, rated
  const teeP = await A.rpc("fn_save_product", { p_product: {
    name_ar: "تيشيرت أحمد القطني", name_en: "Ahmed Cotton Tee",
    short_ar: "قطن مصري 100% — 12 لون ومقاس", short_en: "100% Egyptian cotton — 12 combos",
    desc_ar: "تيشيرت قطن مصري خالص، مريح في الصيف، بمقاسات من S إلى XL وثلاثة ألوان.",
    desc_en: "Pure Egyptian cotton tee, summer-comfortable, sizes S–XL in three colors.",
    leaf_category_id: tee?.id, brand_id: brand?.id,
    media: [{ kind: "image", path: imgs.teeMain }], weight_g: 250,
  } });
  const teeId = teeP.data?.id;
  const gen = await A.rpc("fn_generate_variants", { p_product_id: teeId, p_axes: [
    { attribute_id: colorDef?.id, option_ids: (colorRows ?? []).map((r) => r.id) },
    { attribute_id: sizeDef?.id, option_ids: (sizeRows ?? []).map((r) => r.id) },
  ] });
  if (gen.error) throw new Error(gen.error.message);
  const { data: teeVars } = await svc.from("variants").select("id, option_key, option_ids").eq("product_id", teeId).is("deleted_at", null).order("created_at");
  const colorIds = colorRows.data?.map((r) => r.id) ?? [];
  const rows = (teeVars ?? []).map((v, i) => ({
    option_key: v.option_key, sku: `TEE-${STAMP}-${i}`, price_piastres: 10000,
    sale_price_piastres: v.option_ids?.includes(colorIds[1]) ? 8000 : null,
    stock: 5 + (i % 8), image_path: v.option_ids?.includes(colorIds[0]) ? imgs.teeRed : "", is_active: true,
  }));
  await A.rpc("fn_save_variants", { p_product_id: teeId, p_rows: rows });
  const facetMap = new Map();
  for (const v of teeVars ?? []) for (const oid of v.option_ids ?? []) facetMap.set(oid, { product_id: teeId, attribute_id: colorIds.includes(oid) ? colorDef?.id : sizeDef?.id, option_id: oid });
  await svc.from("product_facets").upsert([...facetMap.values()], { onConflict: "product_id,attribute_id,option_id" });
  await svc.from("products").update({
    sale_starts_at: new Date(Date.now() - 3600_000).toISOString(),
    sale_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    featured_permanent: true,
  }).eq("id", teeId);
  const { data: redVar } = await svc.from("variants").select("id").eq("product_id", teeId).is("deleted_at", null).limit(1).single();
  fx.redVariant = redVar?.id;

  // TV: no variants, featured
  const tvP = await A.rpc("fn_save_product", { p_product: {
    name_ar: "شاشة ذكية 55 بوصة", name_en: "Smart TV 55 inch",
    desc_ar: "شاشة ذكية بدقة 4K وتقنية HDR.", desc_en: "4K HDR smart TV.",
    leaf_category_id: tvs?.id, media: [{ kind: "image", path: imgs.tv }], weight_g: 15000,
  } });
  const tvId = tvP.data?.id;
  await A.rpc("fn_generate_variants", { p_product_id: tvId, p_axes: [] });
  const { data: tvVar } = await svc.from("variants").select("id, option_key").eq("product_id", tvId).is("deleted_at", null).single();
  await A.rpc("fn_save_variants", { p_product_id: tvId, p_rows: [{ option_key: tvVar?.option_key ?? "", sku: `TV-${STAMP}`, price_piastres: 2500000, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
  await svc.from("products").update({ featured_permanent: true }).eq("id", tvId);
  fx.tvVariant = tvVar?.id;

  // publish
  await A.rpc("fn_submit_product", { p_product_id: teeId });
  await A.rpc("fn_submit_product", { p_product_id: tvId });
  await admin.rpc("fn_admin_review_product", { p_product_id: teeId, p_decision: "approve", p_reason: null });
  await admin.rpc("fn_admin_review_product", { p_product_id: tvId, p_decision: "approve", p_reason: null });

  // reviews (top-rated section)
  for (const rating of [5, 4, 5]) {
    await svc.from("reviews").insert({ product_id: teeId, vendor_id: vendorA, customer_id: custId, rating, title: "جودة ممتازة", body: "القماش ممتاز والمقاس مطابق.", status: "published" });
  }

  // DB banners + event (home sections)
  await svc.from("banners").insert([
    { title_ar: "عروض الصيف", title_en: "Summer deals", image_path: imgs.dbBanner, link_url: "/ar/products", position: 0 },
  ]);
  await svc.from("events").insert({ name_ar: "الجمعة البيضاء", name_en: "Black Friday", desc_ar: "خصومات تصل إلى 50% على أقسام مختارة طوال نوفمبر.", desc_en: "Up to 50% off selected categories all November.", starts_at: new Date(Date.now() - 3600_000).toISOString(), ends_at: new Date(Date.now() + 30 * 86400_000).toISOString(), status: "active" });

  fx.teeId = teeId; fx.tvId = tvId; fx.teeSlug = (await svc.from("products").select("slug_ar, slug_en").eq("id", teeId).single()).data;
  fx.brandId = brand?.id; fx.teeCat = tee?.id;

  /* ------------------------------------------------- G1 guest flow check */
  await page.setViewport({ width: 1280, height: 900 });
  await goto2("http://localhost:3000/ar");
  const featuredVisible = await page.evaluate(() => document.body.innerText.includes("تيشيرت أحمد القطني"));
  check("G1: home SSR shows the featured product name", featuredVisible);
  await page.evaluate(() => {
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent?.includes("تيشيرت أحمد القطني"));
    link?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const onProduct = page.url().includes("/product/");
  check("G1: click 1 reaches the product page", onProduct, page.url());
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("أضف إلى السلة"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1800));
  const drawerOpen = await page.evaluate(() => document.body.innerText.includes("عرض السلة"));
  check("G1: click 2 adds to cart and opens the drawer (≤3 clicks)", clicked && drawerOpen);
  await page.screenshot({ path: `${OUT}/cart-drawer-1280.png`, timeout: 60000 });
  await page.setViewport({ width: 390, height: 800 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${OUT}/cart-drawer-390.png`, timeout: 60000 });
  check("G1: drawer screenshots saved", fs.existsSync(`${OUT}/cart-drawer-1280.png`));

  /* ------------------------------------------------------------ screens */
  await goto2("http://localhost:3000/ar");
  await shot("home-ar");
  await goto2("http://localhost:3000/en");
  await shot("home-en");

  await goto2(`http://localhost:3000/ar/category/${encodeURIComponent(fx.teeSlug.slug_ar)}`);
  await shot("category");

  await goto2(`http://localhost:3000/ar/products?cat=${fx.teeCat}&sort=price_asc`);
  await shot("listing-filters");

  await goto2("http://localhost:3000/ar/search?q=" + encodeURIComponent("تيشرت"));
  await shot("search-results");

  await goto2(`http://localhost:3000/ar/product/${encodeURIComponent(fx.teeSlug.slug_ar)}`);
  await shot("product");

  const { data: storeRow } = await svc.from("v_storefront_stores").select("slug").eq("id", vendorA).single();
  await goto2(`http://localhost:3000/ar/store/${storeRow?.slug}`);
  await shot("store");

  await goto2("http://localhost:3000/ar/vendors");
  await shot("vendors");
  await goto2("http://localhost:3000/ar/brands");
  await shot("brands");

  // cart page: guest localStorage seed (guest cart is localStorage by design)
  await page.evaluateOnNewDocument((lines) => {
    localStorage.setItem("etsawaa.cart.v1", JSON.stringify(lines));
  }, [
    { variant_id: fx.redVariant, product_id: fx.teeId, qty: 2 },
    { variant_id: fx.tvVariant, product_id: fx.tvId, qty: 1 },
  ]);
  const consoleErrors = [];
  const onResponses = (r) => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); };
  const onConsole = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300)); };
  const onPageError = (err) => consoleErrors.push(`PAGEERROR: ${String(err).slice(0, 300)}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponses);
  await goto2("http://localhost:3000/ar/cart");
  await new Promise((r) => setTimeout(r, 2500));
  await shot("cart");
  const cartOk = await page.evaluate(() => document.body.innerText.includes("إجمالي المنتجات"));
  check("cart page renders seeded guest cart", cartOk, consoleErrors.join(" || "));
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponses);

  await page.evaluateOnNewDocument(() => {});
  await goto2("http://localhost:3000/ar/sell");
  await shot("sell");

  await goto2("http://localhost:3000/ar/p/about");
  await shot("static-page");

  await goto2(`http://localhost:3000/ar/compare?ids=${fx.teeId},${fx.tvId}`);
  await shot("compare");
  const compareOk = await page.evaluate(() => document.body.innerText.includes("الخصائص المشتركة"));
  check("compare page shows the different-categories notice", compareOk);

  /* ------------------------------------------------------------ cleanup */
  console.log("cleanup…");
  await svc.from("banners").delete().like("title_en", "Summer deals");
  await svc.from("events").delete().like("name_en", "Black Friday");
  await svc.from("reviews").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  // stamp-agnostic: remove every screen-run fixture (this run + earlier failed runs)
  {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    for (const user of list.users.filter((u) => u.email?.startsWith("p4s-"))) {
      await svc.auth.admin.deleteUser(user.id);
    }
  }
  await svc.from("brands").delete().like("slug_en", "p4s-brand-%");
  for (const depth of [3, 2, 1]) {
    await svc.from("categories").delete().like("slug_en", "p4s-%").eq("depth", depth);
  }
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { count: pCount } = await svc.from("products").select("*", { count: "exact", head: true });
  const { count: vCount } = await svc.from("vendors").select("*", { count: "exact", head: true });
  const { count: cCount } = await svc.from("categories").select("*", { count: "exact", head: true });
  check("DB pristine after screens", pCount === 0 && vCount === 0 && cCount === 0, `p${pCount} v${vCount} c${cCount}`);

  fs.writeFileSync("evidence/phase-04/screens-log.txt", log.join("\n") + "\n");
  console.log(`\nSCREENS RESULT: ${passCount} pass, ${failCount} fail`);
  if (failCount > 0) process.exitCode = 1;
  await b.close();
} catch (error) {
  console.error("SCREENS ERROR:", error.message, (error.stack ?? "").split("\n").slice(0, 6).join(" | "));
  log.push(`ERROR: ${error.message}`);
  fs.writeFileSync("evidence/phase-04/screens-log.txt", log.join("\n") + "\n");
  await b.close();
  process.exitCode = 1;
}
