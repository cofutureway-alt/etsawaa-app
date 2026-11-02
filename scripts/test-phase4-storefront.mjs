/**
 * Phase 04 — storefront API/RLS test suite.
 * Fixtures: two vendors (A/B), two category trees, brands, real product
 * images in the media bucket, 12-variant tee (3 colors x 4 sizes, one sale),
 * a no-variant TV, a vendor-B tee (isolation), a coupon, reviews.
 * Assertions: filter counts vs DB, sort/pagination, variant integrity,
 * cart add/merge rules, wishlist dedupe, recently-viewed cap/dedupe/clear,
 * coupon validation matrix, search normalization + suggestions,
 * draft/pending/hidden leakage, static pages, contact insert.
 * Output: evidence/phase-04/rls-tests-raw.txt + test-results.json
 * Reproduce: node --env-file=.env scripts/test-phase4-storefront.mjs
 */
import { createClient } from "@supabase/supabase-js";
import zlib from "node:zlib";
import fs from "node:fs";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const svc = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

const STAMP = Date.now();
const PWD = "Vendor#12345";
const out = [];
let passCount = 0;
let failCount = 0;
let sectionName = "";

function section(name) {
  sectionName = name;
  out.push(`\n=== ${name} ===`);
  console.log(`\n=== ${name} ===`);
}
function check(name, cond, detail = "") {
  if (cond) passCount += 1;
  else failCount += 1;
  out.push(`${cond ? "PASS" : "FAIL"} [${sectionName}] ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
}

/** minimal valid PNG (solid color) — no dependencies */
function png(width, height, [r, g, b]) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x += 1) {
      const off = y * (1 + width * 3) + 1 + x * 3;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
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
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PWD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

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

const results = {};
try {
  /* ------------------------------------------------- pre-clean leftovers */
  await svc.from("categories").delete().like("slug_en", "p4%");
  await svc.from("categories").delete().like("slug_en", "p3%");
  for (const email of ["p4-admin", "p4-vendor-a", "p4-vendor-b", "p4-cust"]) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    for (const user of list.users.filter((u) => u.email?.startsWith(email))) {
      await svc.auth.admin.deleteUser(user.id);
    }
  }
  await svc.from("coupons").delete().like("code", "P4%");
  await svc.from("reviews").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("contact_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("banners").delete().like("title_en", "Test banner");
  await svc.from("cart_items").delete().neq("variant_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("wishlist_items").delete().neq("product_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("recently_viewed").delete().neq("product_id", "00000000-0000-0000-0000-000000000000");

  /* ------------------------------------------------------------ fixtures */
  section("FIXTURES");
  const adminEmail = `p4-admin-${STAMP}@etsawaa-e2e.com`;
  const aEmail = `p4-vendor-a-${STAMP}@etsawaa-e2e.com`;
  const bEmail = `p4-vendor-b-${STAMP}@etsawaa-e2e.com`;
  const custEmail = `p4-cust-${STAMP}@etsawaa-e2e.com`;
  const adminId = await mkUser(adminEmail, "admin");
  const aUid = await mkUser(aEmail, "vendor");
  const bUid = await mkUser(bEmail, "vendor");
  const custId = await mkUser(custEmail, "customer");
  const admin = await signIn(adminEmail);
  const A = await signIn(aEmail);
  const B = await signIn(bEmail);
  const CUST = await signIn(custEmail);

  const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1).single();

  // categories: fashion > tshirts (leaf, attrs), electronics > tvs (leaf, no axes)
  const { data: fashion } = await svc.from("categories").insert({ slug_ar: `p4-ازياء-${STAMP}`, slug_en: `p4fashion-${STAMP}`, name_ar: "أزياء", name_en: "Fashion" }).select("id").single();
  const { data: tee } = await svc.from("categories").insert({ slug_ar: `p4-tshirts-${STAMP}`, slug_en: `p4tshirts-${STAMP}`, name_ar: "تيشيرتات", name_en: "T-Shirts", parent_id: fashion?.id, depth: 2 }).select("id").single();
  const { data: electronics } = await svc.from("categories").insert({ slug_ar: `p4-الكترونيات-${STAMP}`, slug_en: `p4electronics-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics" }).select("id").single();
  const { data: tvs } = await svc.from("categories").insert({ slug_ar: `p4-tvs-${STAMP}`, slug_en: `p4tvs-${STAMP}`, name_ar: "شاشات", name_en: "TVs", parent_id: electronics?.id, depth: 2 }).select("id").single();

  // attribute defs: color (color type, axis, filterable) + size (enum, axis, filterable) on tee leaf
  const { data: colorDef } = await svc.from("attribute_defs").insert({ category_id: tee?.id, code: "color", label_ar: "اللون", label_en: "Color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single();
  const { data: sizeDef } = await svc.from("attribute_defs").insert({ category_id: tee?.id, code: "size", label_ar: "المقاس", label_en: "Size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single();
  const colorRows = await svc.from("attribute_options").insert([
    { attribute_id: colorDef?.id, code: "red", label_ar: "أحمر", label_en: "Red", color_hex: "#C0392B", sort: 0 },
    { attribute_id: colorDef?.id, code: "blue", label_ar: "أزرق", label_en: "Blue", color_hex: "#2471A3", sort: 1 },
    { attribute_id: colorDef?.id, code: "green", label_ar: "أخضر", label_en: "Green", color_hex: "#1E8449", sort: 2 },
  ]).select("id");
  // codes must match ^[a-z0-9_]{2,40}$ — single-letter codes are rejected
  const sizeRows = await svc.from("attribute_options").insert([
    { attribute_id: sizeDef?.id, code: "sm", label_ar: "S", label_en: "S", sort: 0 },
    { attribute_id: sizeDef?.id, code: "md", label_ar: "M", label_en: "M", sort: 1 },
    { attribute_id: sizeDef?.id, code: "lg", label_ar: "L", label_en: "L", sort: 2 },
    { attribute_id: sizeDef?.id, code: "xl", label_ar: "XL", label_en: "XL", sort: 3 },
  ]).select("id");
  if (sizeRows.error || !sizeRows.data || colorRows.error || !colorRows.data) {
    throw new Error(`fixture options failed: ${JSON.stringify(sizeRows.error ?? colorRows.error)}`);
  }

  // brands (fixture brand with a real thumb in the bucket)
  const { data: brand } = await svc.from("brands").insert({ name_ar: "اتسو سبورت", name_en: "Etso Sport", slug_ar: `p4-brand-${STAMP}`, slug_en: `p4brand-${STAMP}`, sort: 0 }).select("id").single();

  // media objects (public bucket) for product images
  const { data: bucket } = await svc.storage.createBucket("media", { public: true }).catch(() => ({ data: null }));
  void bucket;
  const imgs = {
    teeMain: `u/${aUid}/tee-main-${STAMP}.png`,
    teeRed: `u/${aUid}/tee-red-${STAMP}.png`,
    tv: `u/${aUid}/tv-${STAMP}.png`,
    teeB: `u/${bUid}/tee-b-${STAMP}.png`,
    logoA: `u/${aUid}/logo-a-${STAMP}.png`,
    banner: `u/${aUid}/banner-${STAMP}.png`,
    brandThumb: `u/${aUid}/brand-${STAMP}.png`,
  };
  await svc.storage.from("media").upload(imgs.teeMain, png(400, 400, [190, 60, 60]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(imgs.teeRed, png(400, 400, [220, 40, 40]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(imgs.tv, png(400, 400, [40, 50, 70]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(imgs.teeB, png(400, 400, [60, 120, 60]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(imgs.logoA, png(200, 200, [90, 5, 5]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(imgs.banner, png(900, 220, [80, 10, 10]), { contentType: "image/png", upsert: true });
  await svc.storage.from("media").upload(imgs.brandThumb, png(200, 200, [30, 80, 140]), { contentType: "image/png", upsert: true });
  await svc.from("brands").update({ thumb_path: imgs.brandThumb }).eq("id", brand?.id);

  // vendors A + B (onboarded, approved)
  const onboardA = await A.rpc("fn_vendor_onboard", { p_data: {
    store_name_ar: "متجر الأناقة", store_name_en: "Elegance Store",
    category_ids: [tee?.id], first_name: "أ", last_name: "ب",
    governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان",
    terms_version: "1.0", terms_signature: "A Owner",
  } });
  check("vendor A onboarded", !onboardA.error, JSON.stringify(onboardA.error));
  const vendorA = onboardA.data?.vendor_id;
  await svc.from("vendors").update({ logo_path: imgs.logoA, banner_path: imgs.banner, short_desc_ar: "أفضل تيشيرتات القاهرة", short_desc_en: "Cairo's best tees" }).eq("id", vendorA);
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: vendorA, p_decision: "approve" });
  await admin.rpc("fn_admin_verify_vendor", { p_vendor_id: vendorA, p_decision: "verify" });

  const onboardB = await B.rpc("fn_vendor_onboard", { p_data: {
    store_name_ar: "متجر ب", store_name_en: "Store B",
    category_ids: [tee?.id], first_name: "ج", last_name: "د",
    governorate_id: area?.governorate_id, area_id: area?.id, address1: "عنوان",
    terms_version: "1.0", terms_signature: "B Owner",
  } });
  const vendorB = onboardB.data?.vendor_id;
  await admin.rpc("fn_admin_review_vendor", { p_vendor_id: vendorB, p_decision: "approve" });

  // product A1: tee, 12 variants (3 colors x 4 sizes), red has its own image, blue on sale
  const saleEnds = new Date(Date.now() + 7 * 86400_000).toISOString();
  const teeA = await A.rpc("fn_save_product", { p_product: {
    name_ar: "تيشيرت أحمد", name_en: "Ahmed Tee",
    short_ar: "قطن مصري 100%", short_en: "100% Egyptian cotton",
    desc_ar: "تيشيرت قطن مصري خالص بجودة عالية.",
    desc_en: "Pure Egyptian cotton tee, high quality.",
    leaf_category_id: tee?.id, brand_id: brand?.id,
    media: [{ kind: "image", path: imgs.teeMain }],
    weight_g: 250,
  } });
  check("tee A saved", !teeA.error, JSON.stringify(teeA.error));
  const teeAId = teeA.data?.id;
  const genTee = await A.rpc("fn_generate_variants", { p_product_id: teeAId, p_axes: [
    { attribute_id: colorDef?.id, option_ids: colorRows.data?.map((r) => r.id) ?? [] },
    { attribute_id: sizeDef?.id, option_ids: sizeRows.data?.map((r) => r.id) ?? [] },
  ] });
  if (genTee.error) throw new Error(`generate tee variants failed: ${genTee.error.message}`);
  const { data: teeVariants } = await svc.from("variants").select("id, option_key, option_ids").eq("product_id", teeAId).is("deleted_at", null).order("created_at");
  check("tee A has 12 variants", teeVariants?.length === 12, `got ${teeVariants?.length}`);
  // per-variant: red main image, blue sale price, stocks 3..14
  const colorIds = colorRows.data?.map((r) => r.id) ?? [];
  const sizeIds = sizeRows.data?.map((r) => r.id) ?? [];
  const rows = (teeVariants ?? []).map((v, i) => {
    const isRed = v.option_ids?.includes(colorIds[0]);
    const isBlue = v.option_ids?.includes(colorIds[1]);
    return {
      option_key: v.option_key, sku: `TEE-${STAMP}-${i}`,
      price_piastres: 10000,
      sale_price_piastres: isBlue ? 8000 : null,
      stock: 3 + (i % 12),
      image_path: isRed ? imgs.teeRed : "",
      is_active: true,
    };
  });
  const saveVars = await A.rpc("fn_save_variants", { p_product_id: teeAId, p_rows: rows });
  check("tee A variants saved with images/sale", !saveVars.error, JSON.stringify(saveVars.error));
  // tombstone one variant (green + XL) → regenerate must skip it
  const greenXl = (teeVariants ?? []).find((v) => v.option_ids?.includes(colorIds[2]) && v.option_ids?.includes(sizeIds[3]));
  const delRes = await A.rpc("fn_save_variants", { p_product_id: teeAId, p_rows: [] });
  void delRes;
  await svc.from("variants").update({ deleted_at: new Date().toISOString() }).eq("id", greenXl?.id);
  const regen = await A.rpc("fn_generate_variants", { p_product_id: teeAId, p_axes: [
    { attribute_id: colorDef?.id, option_ids: colorIds },
    { attribute_id: sizeDef?.id, option_ids: sizeIds },
  ] });
  check("regeneration skips tombstoned combo", regen.data?.skipped?.length === 1, JSON.stringify(regen.data));
  // product-level attribute values (facets): material enum? use color facets via variants; add size facet rows for filter tests
  // facets derive from variants through product_facets — seed them for the 11 live combos
  const liveVariants = (teeVariants ?? []).filter((v) => v.id !== greenXl?.id);
  const facetMap = new Map();
  for (const v of liveVariants) {
    for (const oid of v.option_ids ?? []) {
      facetMap.set(oid, { product_id: teeAId, attribute_id: colorIds.includes(oid) ? colorDef?.id : sizeDef?.id, option_id: oid });
    }
  }
  const facetRows = [...facetMap.values()];
  const facetUpsert = await svc.from("product_facets").upsert(facetRows, { onConflict: "product_id,attribute_id,option_id" });
  if (facetUpsert.error) throw new Error(`facet upsert failed: ${facetUpsert.error.message}`);
  // sale window on the product covering the blue sale price
  await svc.from("products").update({ sale_starts_at: new Date(Date.now() - 3600_000).toISOString(), sale_ends_at: saleEnds }).eq("id", teeAId);

  // product A2: TV without variants
  const tv = await A.rpc("fn_save_product", { p_product: {
    name_ar: "شاشة ذكية 55 بوصة", name_en: "Smart TV 55 inch",
    desc_ar: "شاشة ذكية بدقة 4K.", desc_en: "4K smart TV.",
    leaf_category_id: tvs?.id, media: [{ kind: "image", path: imgs.tv }],
    weight_g: 15000,
  } });
  const tvId = tv.data?.id;
  await A.rpc("fn_generate_variants", { p_product_id: tvId, p_axes: [] });
  const { data: tvVariant } = await svc.from("variants").select("id, option_key").eq("product_id", tvId).is("deleted_at", null).single();
  await A.rpc("fn_save_variants", { p_product_id: tvId, p_rows: [{ option_key: tvVariant?.option_key ?? "", sku: `TV-${STAMP}`, price_piastres: 2500000, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
  // TV attribute value (non-axis, enum-less text attr for specs display)
  await svc.from("product_attribute_values").insert({ product_id: tvId, attribute_id: sizeDef?.id, value_text: "55\"" }).catch?.(() => undefined);

  // product B1: vendor B tee (isolation target)
  const teeB = await B.rpc("fn_save_product", { p_product: {
    name_ar: "تيشيرت ب", name_en: "Tee B", leaf_category_id: tee?.id, brand_id: brand?.id, media: [{ kind: "image", path: imgs.teeB }],
  } });
  const teeBId = teeB.data?.id;
  await B.rpc("fn_generate_variants", { p_product_id: teeBId, p_axes: [] });
  const { data: teeBVariant } = await svc.from("variants").select("id, option_key").eq("product_id", teeBId).is("deleted_at", null).single();
  await B.rpc("fn_save_variants", { p_product_id: teeBId, p_rows: [{ option_key: teeBVariant?.option_key ?? "", sku: `TEEB-${STAMP}`, price_piastres: 7000, sale_price_piastres: null, stock: 9, image_path: "", is_active: true }] });

  // a DRAFT product (leakage target)
  const draft = await A.rpc("fn_save_product", { p_product: {
    name_ar: "منتج مسودة", name_en: "Draft Product", leaf_category_id: tee?.id, media: [{ kind: "image", path: imgs.teeMain }],
  } });
  results.draftId = draft.data?.id;

  // publish everything except the draft
  for (const id of [teeAId, tvId]) await A.rpc("fn_submit_product", { p_product_id: id });
  await B.rpc("fn_submit_product", { p_product_id: teeBId });
  await admin.rpc("fn_admin_review_product", { p_product_id: teeAId, p_decision: "approve", p_reason: null });
  await admin.rpc("fn_admin_review_product", { p_product_id: tvId, p_decision: "approve", p_reason: null });
  await admin.rpc("fn_admin_review_product", { p_product_id: teeBId, p_decision: "approve", p_reason: null });

  // reviews for tee A (published) — rating distribution 4/5/5
  for (const rating of [4, 5, 5]) {
    await svc.from("reviews").insert({ product_id: teeAId, vendor_id: vendorA, customer_id: custId, rating, title: "جيد", body: "منتج جيد جدًا", status: "published" });
  }

  // coupon: 10% min 5,000 piastres, excludes sale items, per-user limit 2
  const coupon = await svc.from("coupons").insert({
    code: `P4SAVE${STAMP}`, type: "percent", value: 10,
    min_subtotal_piastres: 5000, max_uses_per_user: 2, exclude_sale_items: true,
    status: "active", created_by: adminId,
  }).select("id").single();
  await svc.from("coupon_scopes").insert({ coupon_id: coupon.data?.id, mode: "include", scope: "brand", ref_id: brand?.id });
  const expiredCoupon = await svc.from("coupons").insert({
    code: `P4OLD${STAMP}`, type: "fixed", value: 1000, status: "active",
    starts_at: new Date(Date.now() - 10 * 86400_000).toISOString(), ends_at: new Date(Date.now() - 86400_000).toISOString(),
    created_by: adminId,
  }).select("id").single();
  void expiredCoupon;

  results.teeAId = teeAId; results.tvId = tvId; results.teeBId = teeBId; results.vendorA = vendorA; results.vendorB = vendorB;

  /* ------------------------------------------------------- leakage (G2) */
  section("NO LEAKAGE (draft/pending/hidden)");
  const { data: visible } = await anon.from("v_storefront_products").select("id, is_listable");
  const visibleIds = new Set((visible ?? []).map((r) => r.id));
  check("draft product NOT in the public view", !visibleIds.has(results.draftId));
  check("published A tee visible + listable", visibleIds.has(teeAId) && (visible ?? []).find((r) => r.id === teeAId)?.is_listable === true);
  check("vendor B tee visible", visibleIds.has(teeBId));
  // pending: submit another draft and leave it pending
  const pendingDraft = await A.rpc("fn_save_product", { p_product: { name_ar: "بانتظار الاعتماد", name_en: "Pending", leaf_category_id: tee?.id, media: [{ kind: "image", path: imgs.teeMain }] } });
  await A.rpc("fn_submit_product", { p_product_id: pendingDraft.data?.id });
  const { data: visible2 } = await anon.from("v_storefront_products").select("id");
  check("pending product NOT in the public view", !((visible2 ?? []).some((r) => r.id === pendingDraft.data?.id)));
  results.pendingId = pendingDraft.data?.id;
  // hidden vendor: suspend B → their products drop out
  await svc.from("vendors").update({ status: "suspended" }).eq("id", vendorB);
  const { data: visible3 } = await anon.from("v_storefront_products").select("id");
  check("suspended vendor's products drop from the view", !((visible3 ?? []).some((r) => r.id === teeBId)));
  await svc.from("vendors").update({ status: "active" }).eq("id", vendorB);

  /* --------------------------------------------------- filter counts vs DB */
  section("FILTER COUNTS vs DB");
  const search = async (params) => {
    const { data, error } = await anon.rpc("fn_search_products", params);
    if (error) throw new Error(error.message);
    return data;
  };
  const all = await search({ p_sort: "newest", p_page: 1, p_per_page: 24 });
  const { count: dbCount } = await svc.from("v_storefront_products").select("id", { count: "exact", head: true }).eq("is_listable", true);
  check("total matches DB listable count", all.total === dbCount, `rpc ${all.total} vs db ${dbCount}`);

  const teeOnly = await search({ p_category: tee?.id, p_page: 1, p_per_page: 24 });
  check("category scope counts only subtree products", teeOnly.total === 2, `got ${teeOnly.total} (tee A + tee B)`);

  const brandFacet = await search({ p_category: tee?.id, p_page: 1, p_per_page: 24 });
  const brandRow = (brandFacet.facets?.brands ?? []).find((b) => b.id === brand?.id);
  check("brand facet count = 2 (both tees)", brandRow?.count === 2, JSON.stringify(brandFacet.facets?.brands));

  const attrSearch = await search({ p_category: tee?.id, p_brand: brand?.id, p_attrs: [{ attribute_id: colorDef?.id, option_ids: [colorIds[0]] }], p_page: 1, p_per_page: 24 });
  check("attribute filter narrows to tee A (1 item)", attrSearch.total === 1, `got ${attrSearch.total}`);

  const inStock = await search({ p_category: tee?.id, p_in_stock: true, p_page: 1, p_per_page: 24 });
  check("in-stock filter keeps both (stocked)", inStock.total === 2, `got ${inStock.total}`);

  // price filter on the SALE price of tee A (8000) vs tee B (7000)
  const priceBand = await search({ p_category: tee?.id, p_price_min: 7500, p_price_max: 8500, p_page: 1, p_per_page: 24 });
  check("price band hits the sale price (tee A only)", priceBand.total === 1, `got ${priceBand.total}: ${JSON.stringify(priceBand.items?.map((i) => [i.name_en, i.min_price_piastres]))}`);

  /* --------------------------------------------------- sort + pagination */
  section("SORT + PAGINATION");
  const asc = await search({ p_sort: "price_asc", p_page: 1, p_per_page: 24 });
  const prices = (asc.items ?? []).map((i) => i.event_price_piastres ?? i.min_price_piastres);
  check("price_asc is ordered", prices.every((p, i) => i === 0 || prices[i - 1] <= p), JSON.stringify(prices));
  const rated = await search({ p_sort: "rating", p_page: 1, p_per_page: 24 });
  check("rating sort puts tee A first (only rated)", (rated.items ?? [])[0]?.id === teeAId, JSON.stringify((rated.items ?? []).slice(0, 2).map((i) => i.name_en)));
  // pagination: per_page 2 over 3 items
  const page1 = await search({ p_sort: "newest", p_page: 1, p_per_page: 2 });
  const page2 = await search({ p_sort: "newest", p_page: 2, p_per_page: 2 });
  check("pagination totals stable + pages disjoint", page1.total === 3 && page2.items.length === 1 && !page1.items.some((i) => page2.items.some((j) => j.id === i.id)), `p1=${page1.items.length} p2=${page2.items.length}`);

  /* ------------------------------------------------------- did-you-mean */
  section("SEARCH NORMALIZATION");
  const hamza = await search({ p_q: "احمد", p_page: 1, p_per_page: 24 });
  check("hamza-normalized search finds 'أحمد'", hamza.total >= 1 && hamza.items.some((i) => i.id === teeAId), `total ${hamza.total}`);
  const typo = await search({ p_q: "احمض", p_page: 1, p_per_page: 24 });
  const dym = typo.total === 0 ? await (async () => { const { data } = await anon.rpc("fn_search_did_you_mean", { p_q: "احمض" }); return data; })() : null;
  check("typo 'احمض' → did-you-mean suggests 'أحمد'", dym === "أحمد", `got ${JSON.stringify(dym)}`);
  const sugg = await (async () => { const { data, error } = await anon.rpc("fn_search_suggestions", { p_q: "تيشرت" }); if (error) throw new Error(error.message); return data; })();
  check("suggestions return products for 'تيشرت'", (sugg?.products ?? []).length >= 1, JSON.stringify(sugg?.products?.length));
  const storeSugg = await (async () => { const { data, error } = await anon.rpc("fn_search_suggestions", { p_q: "الأناقة" }); if (error) throw new Error(error.message); return data; })();
  check("suggestions return stores for 'الأناقة'", (storeSugg?.stores ?? []).length === 1, JSON.stringify(storeSugg?.stores));

  /* -------------------------------------------------------- cart (S-09) */
  section("CART add/set/merge");
  const redS = liveVariants.find((v) => v.option_ids?.includes(colorIds[0]) && v.option_ids?.includes(sizeIds[0]));
  const blueS = liveVariants.find((v) => v.option_ids?.includes(colorIds[1]) && v.option_ids?.includes(sizeIds[0]));
  const add1 = await CUST.rpc("fn_cart_add", { p_variant_id: redS?.id, p_qty: 2 });
  check("cart add returns qty 2", add1.data?.qty === 2, JSON.stringify(add1.data));
  const add2 = await CUST.rpc("fn_cart_add", { p_variant_id: redS?.id, p_qty: 2 });
  // red/S stock is 3 → 2+2 caps at 3 with the capped flag (auto-correct rule, US-06)
  check("cart add same line increments and caps at stock (3)", add2.data?.qty === 3 && add2.data?.capped === true, JSON.stringify(add2.data));
  const oos = await CUST.rpc("fn_cart_add", { p_variant_id: greenXl?.id, p_qty: 1 });
  check("tombstoned variant → variant_unavailable", Boolean(oos.error) && oos.error.message.includes("variant_unavailable"), oos.error?.message);
  const setBig = await CUST.rpc("fn_cart_set_qty", { p_variant_id: redS?.id, p_qty: 99 });
  check("set qty caps at stock with capped flag", setBig.data?.capped === true && setBig.data?.qty === setBig.data?.stock, JSON.stringify(setBig.data));
  // merge: guest lines [blueS x2, redS x9(capped), bogus] → combines/caps/drops
  const merge = await CUST.rpc("fn_cart_merge", { p_lines: [
    { variant_id: blueS?.id, qty: 2 },
    { variant_id: redS?.id, qty: 9 },
    { variant_id: greenXl?.id, qty: 1 },
  ] });
  const mergedLines = merge.data?.lines ?? [];
  const blueLine = mergedLines.find((l) => l.variant_id === blueS?.id);
  const redLine = mergedLines.find((l) => l.variant_id === redS?.id);
  check("merge: new line added (blue x2)", blueLine?.qty === 2, JSON.stringify(blueLine));
  check("merge: conflicting line caps at stock (red)", redLine?.qty === redLine?.stock && redLine?.stock <= 3, JSON.stringify(redLine));
  check("merge: unavailable variant dropped with notice", (merge.data?.notices ?? []).some((n) => n.variant_id === greenXl?.id && n.key === "unavailable"), JSON.stringify(merge.data?.notices));
  const cartGet = await CUST.rpc("fn_cart_get");
  check("fn_cart_get returns hydrated lines (name+price)", ((cartGet.data ?? [])[0] ?? {}).name_ar !== undefined && ((cartGet.data ?? [])[0] ?? {}).price_piastres > 0, JSON.stringify((cartGet.data ?? [])[0]?.name_ar));
  results.redVariant = redS?.id; results.blueVariant = blueS?.id;

  /* -------------------------------------------------------- coupon (S-09) */
  section("COUPON validation matrix");
  const lines = await CUST.rpc("fn_cart_get");
  const cartLines = (lines.data ?? []).map((l) => ({
    product_id: l.product_id, vendor_id: l.vendor_id, leaf_category_id: l.leaf_category_id, brand_id: l.brand_id,
    unit_price_piastres: l.price_piastres, qty: l.qty, on_sale: l.on_sale,
  }));
  const okCoupon = await anon.rpc("fn_apply_coupon", { p_code: `P4SAVE${STAMP}`, p_lines: cartLines });
  // cart = red x3 (regular 10,000 — NOT on sale; red has no sale price) + blue x2 (sale 8,000).
  // exclude_sale_items drops the blue line; the red line is branded → eligible 3 x 10,000 → 10% = 3,000.
  check("exclude_sale drops the sale line, keeps the regular one (3,000)", okCoupon.data?.ok === true && okCoupon.data?.discount_piastres === 3000, JSON.stringify(okCoupon.data));
  // remove sale exclusion → brand scope still excludes tee B (no brand) → still not eligible; test include-brand with a branded line instead
  const lineBranded = [{ product_id: teeAId, vendor_id: vendorA, leaf_category_id: tee?.id, brand_id: brand?.id, unit_price_piastres: 10000, qty: 2, on_sale: false }];
  const ok2 = await anon.rpc("fn_apply_coupon", { p_code: `P4SAVE${STAMP}`, p_lines: lineBranded });
  check("branded line → 10% of 20,000 = 2,000", ok2.data?.ok === true && ok2.data?.discount_piastres === 2000, JSON.stringify(ok2.data));
  const below = await anon.rpc("fn_apply_coupon", { p_code: `P4SAVE${STAMP}`, p_lines: [{ ...lineBranded[0], qty: 1 }] });
  check("min_subtotal enforced (1x10,000 ≥ 5,000 → ok? qty1=10,000 ≥ 5,000 ok)", below.data?.ok === true, JSON.stringify(below.data));
  const below2 = await anon.rpc("fn_apply_coupon", { p_code: `P4SAVE${STAMP}`, p_lines: [{ ...lineBranded[0], unit_price_piastres: 3000, qty: 1 }] });
  check("min_subtotal rejects (3,000 < 5,000)", below2.data?.ok === false && below2.data?.reason === "min_subtotal", JSON.stringify(below2.data));
  const expired = await anon.rpc("fn_apply_coupon", { p_code: `P4OLD${STAMP}`, p_lines: lineBranded });
  check("expired coupon rejected", expired.data?.ok === false && expired.data?.reason === "expired", JSON.stringify(expired.data));
  const bogus = await anon.rpc("fn_apply_coupon", { p_code: "NOPE", p_lines: lineBranded });
  check("unknown code rejected", bogus.data?.ok === false && bogus.data?.reason === "invalid", JSON.stringify(bogus.data));

  /* ------------------------------------------------------ wishlist (S-13) */
  section("WISHLIST toggle + dedupe");
  const wOn = await CUST.rpc("fn_wishlist_toggle", { p_product_id: teeAId });
  check("first toggle adds", wOn.data?.added === true, JSON.stringify(wOn.data));
  const wishQ = await svc.from("wishlist_items").select("*", { count: "exact", head: true }).eq("user_id", custId).eq("product_id", teeAId);
  if (wishQ.error) throw new Error(`wishlist count failed: ${wishQ.error.message}`);
  check("exactly one row after add", wishQ.count === 1, `count ${wishQ.count}`);
  // dedupe at the DB level: the composite PK rejects a second row for the same pair
  const dupInsert = await svc.from("wishlist_items").insert({ user_id: custId, product_id: teeAId });
  check("duplicate (user,product) insert rejected by the unique PK", Boolean(dupInsert.error), dupInsert.error?.message?.slice(0, 80));
  const off = await CUST.rpc("fn_wishlist_toggle", { p_product_id: teeAId });
  check("second toggle removes it", off.data?.added === false, JSON.stringify(off.data));
  const wishQ2 = await svc.from("wishlist_items").select("*", { count: "exact", head: true }).eq("user_id", custId).eq("product_id", teeAId);
  check("wishlist row gone after toggle off", wishQ2.count === 0, `count ${wishQ2.count}`);
  const wDraft = await CUST.rpc("fn_wishlist_toggle", { p_product_id: results.draftId });
  check("draft product cannot be wishlisted", Boolean(wDraft.error), wDraft.error?.message);

  /* ------------------------------------------------- recently viewed (S-22) */
  section("RECENTLY VIEWED cap/dedupe/clear");
  for (let i = 0; i < 25; i += 1) {
    // cycle through the 11 live tee variants' product (single product) + TV + tee B
    const target = [teeAId, tvId, teeBId][i % 3];
    await CUST.rpc("fn_record_view", { p_product_id: target });
  }
  const recentQ = await svc.from("recently_viewed").select("*", { count: "exact", head: true }).eq("user_id", custId);
  if (recentQ.error) throw new Error(`recent count failed: ${recentQ.error.message}`);
  check("cap: only 3 distinct products (dedupe by user+product)", recentQ.count === 3, `count ${recentQ.count}`);
  // the real cap test needs 20+ distinct products — build 21 throwaway approved products cheaply
  const throwawayIds = [];
  for (let i = 0; i < 21; i += 1) {
    const p = await A.rpc("fn_save_product", { p_product: { name_ar: `منتج سجل ${i}`, name_en: `Recent ${i}`, leaf_category_id: tee?.id, media: [{ kind: "image", path: imgs.teeMain }] } });
    const pid = p.data?.id;
    throwawayIds.push(pid);
    await A.rpc("fn_generate_variants", { p_product_id: pid, p_axes: [] });
    const { data: v } = await svc.from("variants").select("id, option_key").eq("product_id", pid).is("deleted_at", null).single();
    await A.rpc("fn_save_variants", { p_product_id: pid, p_rows: [{ option_key: v?.option_key ?? "", sku: `R${i}-${STAMP}`, price_piastres: 1000 + i, sale_price_piastres: null, stock: 1, image_path: "", is_active: true }] });
    await svc.from("products").update({ status: "approved", published_at: new Date().toISOString() }).eq("id", pid);
  }
  for (const pid of throwawayIds) await CUST.rpc("fn_record_view", { p_product_id: pid });
  const { data: recentRows } = await svc.from("recently_viewed").select("product_id, viewed_at").eq("user_id", custId).order("viewed_at", { ascending: false });
  check("hard cap: never more than 20 rows", (recentRows ?? []).length === 20, `rows ${(recentRows ?? []).length}`);
  check("newest first: last viewed product is row 1", (recentRows ?? [])[0]?.product_id === throwawayIds[20], JSON.stringify((recentRows ?? [])[0]?.product_id));
  // draft is never recorded
  await CUST.rpc("fn_record_view", { p_product_id: results.draftId });
  const draftQ = await svc.from("recently_viewed").select("*", { count: "exact", head: true }).eq("user_id", custId).eq("product_id", results.draftId);
  check("hidden/draft product view not recorded", draftQ.count === 0, `count ${draftQ.count}`);
  const cleared = await CUST.rpc("fn_recently_viewed_clear");
  check("clear history removes all rows", cleared.data === 20, `deleted ${cleared.data}`);

  /* --------------------------------------------------- product data (S-05) */
  section("PRODUCT PAGE DATA (variant integrity)");
  const { data: tvVariantsLive } = await svc.from("variants").select("id, price_piastres, stock").eq("product_id", tvId).is("deleted_at", null).eq("is_active", true);
  const { data: tvView } = await anon.from("v_storefront_products").select("*").eq("id", tvId).single();
  check("TV (no-variant) has 1 live variant", tvVariantsLive?.length === 1, `got ${tvVariantsLive?.length}`);
  check("TV view exposes min price 2,500.00 EGP", tvView?.min_price_piastres === 2500000, JSON.stringify(tvView?.min_price_piastres));
  const { data: teeView } = await anon.from("v_storefront_products").select("*").eq("id", teeAId).single();
  check("tee view: has_sale true with sale window", teeView?.has_sale === true, JSON.stringify(teeView?.has_sale));
  check("tee view: min price includes sale (8,000)", teeView?.min_price_piastres === 8000, JSON.stringify(teeView?.min_price_piastres));
  check("tee view: rating avg 4.7 (4,5,5 → 4.7)", Number(teeView?.rating_avg) === 4.7, JSON.stringify(teeView?.rating_avg));
  check("tee view: rating count 3", teeView?.rating_count === 3);
  const { data: teeReviews } = await anon.from("v_storefront_reviews").select("id, rating, author_name").eq("product_id", teeAId);
  check("published reviews visible with author names", teeReviews?.length === 3 && ((teeReviews ?? [])[0] ?? {}).author_name !== undefined, JSON.stringify(teeReviews?.length));
  // per-variant image: red variant rows carry their own image
  const { data: redVarRows } = await svc.from("variants").select("id, image_path").eq("product_id", teeAId).is("deleted_at", null).eq("image_path", imgs.teeRed);
  check("red variants carry their own image (4 rows)", redVarRows?.length === 4, `got ${redVarRows?.length}`);

  /* ------------------------------------------------- store page data (S-06) */
  section("STORE PAGE DATA");
  const { data: storeView } = await anon.from("v_storefront_stores").select("*").eq("id", vendorA).single();
  check("store view exposes public identity", storeView?.slug?.length > 0 && storeView?.store_name_ar === "متجر الأناقة", JSON.stringify(storeView?.store_name_ar));
  check("store view hides owner/phone fields", !("owner_id" in (storeView ?? {})) && !("phone" in (storeView ?? {})));
  check("store product_count = 2 + 21 throwaway", storeView?.product_count === 23, `got ${storeView?.product_count}`);
  // event refusal: create event + refuse vendor A → listings drop A, store keeps
  const { data: ev } = await svc.from("events").insert({ name_ar: "عرض اختبار", name_en: "Test Event", desc_ar: "خصومات", desc_en: "Discounts", starts_at: new Date(Date.now() - 3600_000).toISOString(), ends_at: new Date(Date.now() + 86400_000).toISOString(), status: "active" }).select("id").single();
  await svc.from("event_vendors").insert({ event_id: ev?.id, vendor_id: vendorA, status: "refused" });
  const { data: visibleEv } = await anon.from("v_storefront_products").select("id, is_listable, vendor_event_refused").eq("vendor_id", vendorA);
  check("refused vendor: EVERY product flagged refused + not listable", (visibleEv ?? []).length === 23 && (visibleEv ?? []).every((r) => r.vendor_event_refused === true && r.is_listable === false), `rows ${(visibleEv ?? []).length}`);
  const { data: storeEv } = await anon.from("v_storefront_stores").select("refused_event_id, refused_event_name_ar").eq("id", vendorA).single();
  check("store view carries the refusal notice fields", storeEv?.refused_event_id === ev?.id, JSON.stringify(storeEv));
  await svc.from("event_vendors").delete().eq("event_id", ev?.id);
  await svc.from("events").delete().eq("id", ev?.id);

  /* -------------------------------------------------- static pages + contact */
  section("STATIC PAGES + CONTACT");
  const { data: pages } = await anon.from("static_pages").select("slug_en, title_en, content_en").in("slug_en", ["about", "terms", "privacy", "returns"]);
  check("4 seeded static pages readable by anon", pages?.length === 4, `got ${pages?.length}`);
  const contactInsert = await anon.from("contact_messages").insert({ name: "زائر", email: "guest@example.com", phone: "01012345678", subject: "استفسار", message: "رسالة اختبار من زائر للموقع" });
  check("anon can insert a contact message", !contactInsert.error, JSON.stringify(contactInsert.error));
  const contactRead = await anon.from("contact_messages").select("id").limit(1);
  check("anon CANNOT read contact messages (RLS)", contactRead.error !== null || (contactRead.data ?? []).length === 0, JSON.stringify(contactRead.error?.message ?? "readable!"));

  /* ---------------------------------------------------------- banners (S-01) */
  section("BANNERS");
  const { data: bannerIns } = await svc.from("banners").insert({ title_ar: "بانر اختبار", title_en: "Test banner", image_path: imgs.banner, link_url: "/ar/products", position: 0 }).select("id").single();
  const { data: bannerRead } = await anon.from("banners").select("id, title_ar").eq("id", bannerIns?.id);
  check("active banner readable by anon", bannerRead?.length === 1);
  const bannerOff = await svc.from("banners").update({ is_active: false }).eq("id", bannerIns?.id);
  if (bannerOff.error) throw new Error(`banner update failed: ${bannerOff.error.message}`);
  const { data: bannerHidden } = await anon.from("banners").select("id").eq("id", bannerIns?.id);
  check("inactive banner hidden from anon", bannerHidden?.length === 0, JSON.stringify(bannerHidden?.length));

  /* ------------------------------------------------------------- cleanup */
  section("CLEANUP");
  await CUST.rpc("fn_recently_viewed_clear");
  await svc.from("cart_items").delete().neq("variant_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("wishlist_items").delete().neq("product_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("coupons").delete().in("id", [coupon.data?.id, expiredCoupon.data?.id].filter(Boolean));
  await svc.from("banners").delete().eq("id", bannerIns?.id);
  await svc.from("reviews").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("contact_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  // users first: cascades vendors → products → variants/facets, freeing the categories
  for (const email of [adminEmail, aEmail, bEmail, custEmail]) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    const user = list.users.find((u) => u.email === email);
    if (user) await svc.auth.admin.deleteUser(user.id);
  }
  for (const depth of [2, 1]) {
    const del = await svc.from("categories").delete().like("slug_en", "p4%").eq("depth", depth);
    if (del.error) console.log("cleanup p4 categories:", del.error.message);
    const del3 = await svc.from("categories").delete().like("slug_en", "p3%").eq("depth", depth);
    if (del3.error) console.log("cleanup p3 categories:", del3.error.message);
  }
  const brandsDel = await svc.from("brands").delete().like("slug_ar", "p4-brand%");
  if (brandsDel.error) console.log("cleanup brands:", brandsDel.error.message);
  await svc.from("brands").delete().eq("id", brand?.id);
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { count: pCount } = await svc.from("products").select("id", { count: "exact", head: true });
  const { count: vCount } = await svc.from("vendors").select("id", { count: "exact", head: true });
  const { count: cCount } = await svc.from("categories").select("id", { count: "exact", head: true });
  const { count: bCount } = await svc.from("brands").select("id", { count: "exact", head: true });
  check("DB pristine: 0 products, vendors, categories, brands", pCount === 0 && vCount === 0 && cCount === 0 && bCount === 0,
    `products ${pCount}, vendors ${vCount}, categories ${cCount}, brands ${bCount}`);

  /* ------------------------------------------------------------- summary */
  fs.mkdirSync("evidence/phase-04", { recursive: true });
  fs.writeFileSync("evidence/phase-04/rls-tests-raw.txt", out.join("\n") + "\n");
  fs.writeFileSync("evidence/phase-04/test-results.json", JSON.stringify({ stamp: STAMP, pass: passCount, fail: failCount, at: new Date().toISOString() }, null, 1) + "\n");
  console.log(`\nRESULT: ${passCount} pass, ${failCount} fail`);
  if (failCount > 0) process.exitCode = 1;
} catch (error) {
  console.error("SUITE ERROR:", error.message, error.stack?.split("\n")[1] ?? "");
  out.push(`SUITE ERROR: ${error.message}`);
  fs.mkdirSync("evidence/phase-04", { recursive: true });
  fs.writeFileSync("evidence/phase-04/rls-tests-raw.txt", out.join("\n") + "\n");
  fs.writeFileSync("evidence/phase-04/test-results.json", JSON.stringify({ stamp: STAMP, pass: passCount, fail: failCount + 1, error: error.message }, null, 1) + "\n");
  process.exitCode = 1;
}
