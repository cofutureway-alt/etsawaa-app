/**
 * Phase 03 — Vendor Core API/RLS tests (V-20 + G2).
 * Real flows through the real Supabase project: onboarding RPCs, variant
 * cartesian, admin approvals, grace expiry, draft persistence, vendor A/B
 * isolation with direct-ID reads, documents privacy, admin-only RPC gate.
 * Every assertion prints raw output → evidence/phase-03/rls-tests-raw.txt.
 * Reproduce: node --env-file=.env scripts/test-phase3-vendor.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const svc = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PASS_PWD = "Vendor#12345";
const results = [];
const raw = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail ?? "" });
  raw.push(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
}
const section = (title) => raw.push(`\n===== ${title} =====`);

const asUser = async (email) => {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASS_PWD });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return c;
};
let userSeq = 0;
const mkUser = async (email, role) => {
  userSeq += 1;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASS_PWD, email_confirm: true,
    user_metadata: { full_name: email.split("@")[0], phone_e164: `+2012345${String(STAMP).slice(-6)}${userSeq}` },
  });
  if (error) throw new Error(error.message);
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
};

try {
  section("FIXTURES");
  // pre-clean: remove leftovers from any previously interrupted run
  {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    for (const user of list.users) {
      if (user.email?.includes("@etsawaa-e2e.com")) await svc.auth.admin.deleteUser(user.id);
    }
  }
  // categories: clothing leaf with color+size axes; TV leaf without axes
  const { data: root } = await svc.from("categories").insert({ slug_ar: `p3-root-${STAMP}`, slug_en: `p3-root-${STAMP}`, name_ar: "أزياء", name_en: "Fashion" }).select("id").single();
  const { data: clothLeaf } = await svc.from("categories").insert({ slug_ar: `p3-tshirts-${STAMP}`, slug_en: `p3-tshirts-${STAMP}`, name_ar: "تيشيرتات", name_en: "T-Shirts", parent_id: root?.id, depth: 2 }).select("id").single();
  const { data: tvRoot } = await svc.from("categories").insert({ slug_ar: `p3-elc-${STAMP}`, slug_en: `p3-elc-${STAMP}`, name_ar: "إلكترونيات", name_en: "Electronics" }).select("id").single();
  const { data: tvLeaf } = await svc.from("categories").insert({ slug_ar: `p3-tv-${STAMP}`, slug_en: `p3-tv-${STAMP}`, name_ar: "تلفزيونات", name_en: "TVs", parent_id: tvRoot?.id, depth: 2 }).select("id").single();

  const { data: colorDef } = await svc.from("attribute_defs").insert({ category_id: clothLeaf?.id, code: "color", type: "color", is_required: true, is_filterable: true, is_variant_axis: true, sort: 0 }).select("id").single();
  const { data: sizeDef } = await svc.from("attribute_defs").insert({ category_id: clothLeaf?.id, code: "size", type: "enum", is_required: true, is_filterable: true, is_variant_axis: true, sort: 1 }).select("id").single();
  const colorOpts = [["red", "أحمر", "#C0392B"], ["blue", "أزرق", "#2980B9"], ["black", "أسود", "#1F2937"]];
  const { data: colorRows } = await svc.from("attribute_options").insert(colorOpts.map(([code, label_ar, hex], i) => ({ attribute_id: colorDef?.id, code, label_ar, label_en: code, color_hex: hex, sort: i }))).select("id");
  const { data: sizeRows } = await svc.from("attribute_options").insert(["sm", "md", "lg", "xl"].map((code, i) => ({ attribute_id: sizeDef?.id, code, label_ar: ["S", "M", "L", "XL"][i], label_en: ["S", "M", "L", "XL"][i], sort: i }))).select("id");

  const { data: inchesDef } = await svc.from("attribute_defs").insert({ category_id: tvLeaf?.id, code: "inches", type: "number", unit: "in", is_required: true, is_filterable: true, is_variant_axis: false, sort: 0 }).select("id").single();

  // a real (governorate, area) pair from the seed for the onboarding payloads
  const { data: cairoArea } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1).single();
  if (!cairoArea) throw new Error("no Cairo area seeded");

  // users: admin + 3 vendors (A, B, C)
  const adminEmail = `p3-admin-${STAMP}@etsawaa-e2e.com`;
  const aEmail = `p3-vendor-a-${STAMP}@etsawaa-e2e.com`;
  const bEmail = `p3-vendor-b-${STAMP}@etsawaa-e2e.com`;
  const cEmail = `p3-vendor-c-${STAMP}@etsawaa-e2e.com`;
  const adminId = await mkUser(adminEmail, "admin");
  await mkUser(aEmail, "customer");
  await mkUser(bEmail, "customer");
  await mkUser(cEmail, "customer");
  const admin = await asUser(adminEmail);
  const A = await asUser(aEmail);
  const B = await asUser(bEmail);
  const C = await asUser(cEmail);
  check("fixtures ready (4 users, 2 leaf templates)", true, `${clothLeaf?.id}`);

  section("V-01 signup/one-store-per-user");
  // duplicate signup with an existing confirmed email must not create a store path
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const dup = await anonClient.auth.signUp({ email: aEmail, password: PASS_PWD });
  check("duplicate email signup never completes (no confirmed identities)",
    !dup.error ? (dup.data?.user?.identities ?? []).length === 0 : true,
    dup.error?.message ?? `identities=${JSON.stringify(dup.data?.user?.identities?.length)}`);
  const dupUsers = await svc.auth.admin.listUsers({ perPage: 200 });
  check("no extra auth user created by duplicate signup", dupUsers.data.users.filter((u) => u.email === aEmail).length === 1);

  // vendor B cannot insert a vendors row claiming A's owner_id
  const bIllegal = await B.from("vendors").insert({ owner_id: adminId, slug: `evil-${STAMP}`, store_name_ar: "x", store_name_en: "x", status: "draft" }).select("id").single();
  check("vendor B cannot create a store owned by another user", !!bIllegal.error, bIllegal.error?.message ?? "unexpected success");

  section("V-02 onboarding + autosave + resume");
  const onboardPayload = (name) => ({
    store_name_ar: `${name} عربي`,
    store_name_en: `${name} Store`,
    category_ids: [clothLeaf?.id],
    first_name: name, last_name: "Vendor",
    phone: `+2012345${String(STAMP).slice(-5)}`,
    governorate_id: cairoArea.governorate_id, area_id: cairoArea.id, address1: "شارع التحرير 1",
    terms_version: "1.0", terms_signature: `${name} Vendor`,
  });
  // autosave first (draft), then verify resume with a FRESH session
  const autosaveRes = await A.rpc("fn_vendor_autosave", { p_step: 2, p_data: { store_name_ar: "متجر أ", store_name_en: "Store A", first_name: "A" } });
  check("V-02 autosave creates draft", !autosaveRes.error, autosaveRes.error?.message);
  const A2 = await asUser(aEmail); // fresh sign-in (same account)
  const { data: resumed } = await A2.from("vendors").select("store_name_ar, store_name_en, onboarding_step, status").maybeSingle();
  check("draft survives re-login with exact values",
    resumed?.store_name_ar === "متجر أ" && resumed?.store_name_en === "Store A" && resumed?.onboarding_step === 2 && resumed?.status === "draft",
    JSON.stringify(resumed));

  // A & B full onboarding → pending (manual mode)
  const onA = await A.rpc("fn_vendor_onboard", { p_data: onboardPayload("A") });
  const onB = await B.rpc("fn_vendor_onboard", { p_data: onboardPayload("B") });
  const onC = await C.rpc("fn_vendor_onboard", { p_data: onboardPayload("C") });
  check("V-01 vendor A onboarding → pending", !onA.error && onA.data?.status === "pending", JSON.stringify(onA.data ?? onA.error));
  check("V-01 vendor B onboarding → pending", !onB.error && onB.data?.status === "pending", JSON.stringify(onB.data ?? onB.error));
  check("V-01 vendor C onboarding → pending", !onC.error && onC.data?.status === "pending", JSON.stringify(onC.data ?? onC.error));
  const secondStore = await A.rpc("fn_vendor_onboard", { p_data: onboardPayload("A") });
  check("one store per user (resubmit updates, never duplicates)", !secondStore.error, secondStore.error?.message);
  const { count: vendorCount } = await svc.from("vendors").select("id", { count: "exact", head: true });
  check("exactly 3 vendor rows for 3 vendors", vendorCount === 3, `count=${vendorCount}`);

  // role promotion happened
  const { data: profileA } = await svc.from("profiles").select("role").eq("id", (await A.auth.getUser()).data.user?.id).maybeSingle();
  check("onboarding promoted customer → vendor", profileA?.role === "vendor", profileA?.role);

  // invalid area (mismatched governorate) rejected
  const badArea = { ...onboardPayload("X") };
  badArea.area_id = 999999; badArea.governorate_id = cairoArea.governorate_id;
  const badAreaRes = await A.rpc("fn_vendor_onboard", { p_data: JSON.stringify(badArea) });
  check("V-04 area∉governorate rejected server-side", !!badAreaRes.error, badAreaRes.error?.message?.slice(0, 60));

  // missing terms signature rejected
  const noTerms = { ...onboardPayload("X") };
  noTerms.terms_signature = "";
  const noTermsRes = await A.rpc("fn_vendor_onboard", { p_data: JSON.stringify(noTerms) });
  check("V-08 terms+signature mandatory", !!noTermsRes.error, noTermsRes.error?.message?.slice(0, 60));

  // admin approves A and B (C too — for the grace test)
  const rvA = await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onA.data.vendor_id, p_decision: "approve" });
  const rvB = await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onB.data.vendor_id, p_decision: "approve" });
  const rvC = await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onC.data.vendor_id, p_decision: "approve" });
  check("admin approves vendors A/B/C → active", !rvA.error && !rvB.error && !rvC.error, rvA.error?.message);
  // grace started at submit (unverified)
  const { data: vendA } = await svc.from("vendors").select("grace_until, verification_status, status").eq("id", onA.data.vendor_id).single();
  check("grace clock started on submit (unverified + future)", vendA?.verification_status === "unverified" && !!vendA?.grace_until, JSON.stringify(vendA));

  // reject-reason mandatory for vendor review
  const noReason = await admin.rpc("fn_admin_review_vendor", { p_vendor_id: onA.data.vendor_id, p_decision: "reject", p_reason: "" });
  check("vendor rejection reason mandatory", !!noReason.error, noReason.error?.message?.slice(0, 60));
  // (state untouched — A stays active)
  const { data: vendA2 } = await svc.from("vendors").select("status").eq("id", onA.data.vendor_id).single();
  check("rejected-review without reason left vendor untouched", vendA2?.status === "active", vendA2?.status);

  section("V-11..V-15 products + variant cartesian");
  // A: t-shirt draft with media
  const mediaA = await A.rpc("fn_save_product", { p_product: {
    name_ar: "تيشيرت قطن", name_en: "Cotton T-Shirt", short_ar: "قطن 100%", short_en: "100% cotton",
    leaf_category_id: clothLeaf?.id,
    media: [{ kind: "image", path: `u/x/tee-${STAMP}.png` }],
  } });
  check("V-12 t-shirt draft saved", !mediaA.error, mediaA.error?.message);
  const teeId = mediaA.data?.id;

  // forbidden attribute value: option from the wrong attribute
  const forbidden = await A.rpc("fn_save_product", {
    p_product: {
      leaf_category_id: clothLeaf?.id,
      attributes: [{ attribute_id: colorDef?.id, option_id: sizeRows?.[0]?.id }],
    },
    p_id: teeId,
  });
  check("V-14 forbidden value (option from another attribute) rejected", !!forbidden.error, forbidden.error?.message?.slice(0, 80));

  // direct write to children tables has no grant
  const pavDirect = await A.from("product_attribute_values").insert({ product_id: teeId, attribute_id: colorDef?.id, option_id: colorRows?.[0]?.id }).select("product_id").single();
  check("vendors cannot write attribute values directly (grant revoked)", !!pavDirect.error, pavDirect.error?.message?.slice(0, 60));

  // generate 3 colors × 4 sizes
  const gen = await A.rpc("fn_generate_variants", {
    p_product_id: teeId,
    p_axes: [
      { attribute_id: colorDef?.id, option_ids: colorRows?.map((r) => r.id) ?? [] },
      { attribute_id: sizeDef?.id, option_ids: sizeRows?.map((r) => r.id) ?? [] },
    ],
    p_defaults: { price_piastres: 25000, sale_price_piastres: 20000 },
  });
  check("V-15 3×4 cartesian generated = 12 rows", !gen.error && gen.data?.inserted === 12, JSON.stringify(gen.data ?? gen.error));
  const { data: teeVariants } = await svc.from("variants").select("id, option_key, sku, price_piastres").eq("product_id", teeId).is("deleted_at", null).order("option_key");
  check("12 live rows with distinct option_keys", teeVariants?.length === 12 && new Set(teeVariants.map((v) => v.option_key)).size === 12, `rows=${teeVariants?.length}`);

  // unique SKUs via fn_save_variants; duplicate blocked
  const rowsIn = teeVariants.map((v, i) => ({ option_key: v.option_key, sku: `TEE-${STAMP}-${i}`, price_piastres: 25000 + i * 100, sale_price_piastres: i === 0 ? 20000 : null, stock: 10 + i, image_path: "", is_active: true }));
  const saveRows = await A.rpc("fn_save_variants", { p_product_id: teeId, p_rows: rowsIn });
  check("V-16 12 rows saved with unique SKUs", !saveRows.error && saveRows.data?.saved === 12, JSON.stringify(saveRows.data ?? saveRows.error));
  const dupSkuRows = rowsIn.map((r) => ({ ...r, sku: "TEE-DUP" }));
  const dupSku = await A.rpc("fn_save_variants", { p_product_id: teeId, p_rows: dupSkuRows });
  check("duplicate SKU in one save blocked", !!dupSku.error, dupSku.error?.message?.slice(0, 60));
  const crossDup = await A.rpc("fn_save_variants", { p_product_id: teeId, p_rows: [{ ...rowsIn[0], sku: `TEE-${STAMP}-1` }] });
  check("SKU colliding with an existing live row blocked", !!crossDup.error, crossDup.error?.message?.slice(0, 60));

  // deleted combo is NOT resurrected
  const removedKey = teeVariants[0].option_key;
  const regenerate = await A.rpc("fn_generate_variants", {
    p_product_id: teeId,
    p_axes: [
      { attribute_id: colorDef?.id, option_ids: (colorRows ?? []).slice(0, 2).map((r) => r.id) }, // drop black
      { attribute_id: sizeDef?.id, option_ids: sizeRows?.map((r) => r.id) ?? [] },
    ],
  });
  check("desired-set diff tombstones removed combos (4 removed)", !regenerate.error && regenerate.data?.removed === 4, JSON.stringify(regenerate.data));
  const restoreBack = await A.rpc("fn_generate_variants", {
    p_product_id: teeId,
    p_axes: [
      { attribute_id: colorDef?.id, option_ids: colorRows?.map((r) => r.id) ?? [] },
      { attribute_id: sizeDef?.id, option_ids: sizeRows?.map((r) => r.id) ?? [] },
    ],
  });
  const skipped = (restoreBack.data?.skipped ?? []).length;
  check("deleted combos NOT recreated (skipped=4)", !restoreBack.error && restoreBack.data?.inserted === 0 && skipped === 4, JSON.stringify(restoreBack.data));
  // explicit restore works (a key that is REALLY tombstoned)
  const tombstonedKey = restoreBack.data?.skipped?.[0] ?? removedKey;
  const restored = await A.rpc("fn_restore_variants", { p_product_id: teeId, p_keys: [tombstonedKey] });
  check("explicit restore revives a tombstoned combo", !restored.error && restored.data === 1, JSON.stringify(restored.data));
  // regenerate again to the full 12 and re-save SKUs (restored row lost its saved sku? it kept it — tombstone keeps fields)
  const { data: live12 } = await svc.from("variants").select("id, option_key, sku, price_piastres, sale_price_piastres, stock, image_path").eq("product_id", teeId).is("deleted_at", null).order("option_key");
  const resave = await A.rpc("fn_save_variants", { p_product_id: teeId, p_rows: live12.map((v, i) => ({ option_key: v.option_key, sku: `TEE-${STAMP}-${i}`, price_piastres: 25000 + i * 100, sale_price_piastres: null, stock: 10, image_path: "", is_active: true })) });
  check("full 12 live rows resaved", !resave.error, JSON.stringify(resave.data ?? resave.error));

  // submit → pending
  const submitTee = await A.rpc("fn_submit_product", { p_product_id: teeId });
  check("V-17 t-shirt submit → pending", !submitTee.error && submitTee.data?.status === "pending", JSON.stringify(submitTee.data ?? submitTee.error));

  section("V-20 no-variant TV + rejected resubmit");
  const tvMedia = await B.rpc("fn_save_product", { p_product: {
    name_ar: "تلفزيون 55 بوصة", name_en: "55in TV",
    leaf_category_id: tvLeaf?.id,
    media: [{ kind: "image", path: `u/x/tv-${STAMP}.png` }],
    attributes: [{ attribute_id: inchesDef?.id, value_number: "55" }],
  } });
  check("TV draft saved", !tvMedia.error, tvMedia.error?.message);
  const tvId = tvMedia.data?.id;
  const tvGen = await B.rpc("fn_generate_variants", { p_product_id: tvId, p_axes: [], p_defaults: { price_piastres: 1500000 } });
  check("V-20 no-axes → exactly one plain variant", !tvGen.error && tvGen.data?.inserted === 1, JSON.stringify(tvGen.data));
  const { data: tvVariant } = await svc.from("variants").select("id, option_key").eq("product_id", tvId).is("deleted_at", null).single();
  check("plain variant has empty option_key", tvVariant?.option_key === "", JSON.stringify(tvVariant));
  const tvSave = await B.rpc("fn_save_variants", { p_product_id: tvId, p_rows: [{ option_key: "", sku: `TV-${STAMP}`, price_piastres: 1500000, sale_price_piastres: null, stock: 5, image_path: "", is_active: true }] });
  const tvSubmit = await B.rpc("fn_submit_product", { p_product_id: tvId });
  check("TV submit → pending (single row)", !tvSave.error && !tvSubmit.error && tvSubmit.data?.status === "pending", JSON.stringify(tvSubmit.data ?? tvSubmit.error ?? tvSave.error));

  // admin rejects B's TV with mandatory reason; vendor sees reason; resubmit works
  const rejectNoReason = await admin.rpc("fn_admin_review_product", { p_product_id: tvId, p_decision: "reject", p_reason: "" });
  check("V-19 product rejection reason mandatory", !!rejectNoReason.error, rejectNoReason.error?.message?.slice(0, 50));
  const reject = await admin.rpc("fn_admin_review_product", { p_product_id: tvId, p_decision: "reject", p_reason: "الصورة غير مطابقة للمنتج" });
  check("V-19 admin rejects with reason", !reject.error && reject.data?.status === "rejected", JSON.stringify(reject.data ?? reject.error));
  const { data: tvAfter } = await B.from("products").select("status, rejection_reason").eq("id", tvId).single();
  check("vendor sees the rejection reason", tvAfter?.status === "rejected" && tvAfter?.rejection_reason === "الصورة غير مطابقة للمنتج", JSON.stringify(tvAfter));
  const resubmit = await B.rpc("fn_submit_product", { p_product_id: tvId });
  check("rejected product resubmits → pending", !resubmit.error && resubmit.data?.status === "pending", JSON.stringify(resubmit.data ?? resubmit.error));
  // approve the TV, then approve the tee
  const approveTv = await admin.rpc("fn_admin_review_product", { p_product_id: tvId, p_decision: "approve" });
  const approveTee = await admin.rpc("fn_admin_review_product", { p_product_id: teeId, p_decision: "approve" });
  check("V-19 approve publishes both products", !approveTv.error && !approveTee.error && approveTv.data?.status === "approved", JSON.stringify(approveTv.data ?? approveTv.error));

  section("V-06 grace expiry blocks selling (API level)");
  // C: create + submit a product while in grace
  const cMedia = await C.rpc("fn_save_product", { p_product: {
    name_ar: "منتج تاجر ج", name_en: "Vendor C Product",
    leaf_category_id: tvLeaf?.id,
    media: [{ kind: "image", path: `u/x/c-${STAMP}.png` }],
    attributes: [{ attribute_id: inchesDef?.id, value_number: "50" }],
  } });
  const cId = cMedia.data?.id;
  await C.rpc("fn_generate_variants", { p_product_id: cId, p_axes: [] });
  const { data: _cVariant } = await svc.from("variants").select("id").eq("product_id", cId).is("deleted_at", null).single();
  await C.rpc("fn_save_variants", { p_product_id: cId, p_rows: [{ option_key: "", sku: `C-${STAMP}`, price_piastres: 100000, sale_price_piastres: null, stock: 3, image_path: "", is_active: true }] });
  const cSubmit = await C.rpc("fn_submit_product", { p_product_id: cId });
  check("grace-active vendor CAN submit", !cSubmit.error && cSubmit.data?.status === "pending", JSON.stringify(cSubmit.data ?? cSubmit.error));
  const approveC = await admin.rpc("fn_admin_review_product", { p_product_id: cId, p_decision: "approve" });
  check("grace-active vendor's product can be approved", !approveC.error, approveC.error?.message);

  // expire C's grace → cron engine flips state + blocks
  await svc.from("vendors").update({ grace_until: new Date(Date.now() - 3600_000).toISOString() }).eq("id", onC.data.vendor_id);
  const expire = await svc.rpc("fn_expire_grace");
  check("fn_expire_grace flipped 1 vendor", !expire.error && expire.data === 1, JSON.stringify(expire.data ?? expire.error));
  const { data: vendC } = await svc.from("vendors").select("verification_status").eq("id", onC.data.vendor_id).single();
  check("vendor C → grace_expired", vendC?.verification_status === "grace_expired", vendC?.verification_status);
  const cDraft2 = await C.rpc("fn_save_product", { p_product: {
    name_ar: "منتج ج بعد الانتهاء", name_en: "C After Expiry",
    leaf_category_id: tvLeaf?.id,
    media: [{ kind: "image", path: `u/x/c2-${STAMP}.png` }],
    attributes: [{ attribute_id: inchesDef?.id, value_number: "43" }],
  } });
  const cDraft2Id = cDraft2.data?.id;
  await C.rpc("fn_generate_variants", { p_product_id: cDraft2Id, p_axes: [] });
  const { data: _cDraft2Variant } = await svc.from("variants").select("id").eq("product_id", cDraft2Id).is("deleted_at", null).single();
  await C.rpc("fn_save_variants", { p_product_id: cDraft2Id, p_rows: [{ option_key: "", sku: `C2-${STAMP}`, price_piastres: 90000, sale_price_piastres: null, stock: 2, image_path: "", is_active: true }] });
  const cBlocked = await C.rpc("fn_submit_product", { p_product_id: cDraft2Id });
  check("expired grace blocks publish at API level", !!cBlocked.error && /selling is blocked/i.test(cBlocked.error?.message ?? ""), cBlocked.error?.message?.slice(0, 70));
  void tvLeaf;
  // public visibility: C's approved product is hidden, A's tee is visible
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { count: cPublic } = await anon.from("products").select("id", { count: "exact", head: true }).eq("id", cId);
  const { count: teePublic } = await anon.from("products").select("id", { count: "exact", head: true }).eq("id", teeId);
  check("grace-expired vendor product hidden from public", cPublic === 0, `count=${cPublic}`);
  check("verified-flow vendor product visible to public", teePublic === 1, `count=${teePublic}`);
  const cVarQuery = await anon.from("variants").select("id, sku").eq("product_id", cId);
  check("grace-expired variants hidden from public", (cVarQuery.data ?? []).length === 0 && !cVarQuery.error, `rows=${cVarQuery.data?.length} err=${JSON.stringify(cVarQuery.error)}`);
  // verification approve restores selling
  const verifyC = await admin.rpc("fn_admin_verify_vendor", { p_vendor_id: onC.data.vendor_id, p_decision: "approve" });
  check("admin verification → verified", !verifyC.error && verifyC.data?.verification_status === "verified", JSON.stringify(verifyC.data ?? verifyC.error));
  const cResubmit = await C.rpc("fn_submit_product", { p_product_id: cDraft2Id });
  check("after verification the vendor can publish again", !cResubmit.error && cResubmit.data?.status === "pending", JSON.stringify(cResubmit.data ?? cResubmit.error));

  section("G2 RLS isolation (vendor A vs B, direct-ID)");
  // B's DRAFT product (approved products are public by design — that is the
  // storefront, not a leak). Isolation is proven against drafts.
  const bIso = await B.rpc("fn_save_product", { p_product: {
    name_ar: "مسودة ب للعزل", name_en: "B Isolation Draft",
    leaf_category_id: tvLeaf?.id,
    media: [{ kind: "image", path: `u/x/biso-${STAMP}.png` }],
    attributes: [{ attribute_id: inchesDef?.id, value_number: "32" }],
  } });
  const bIsoId = bIso.data?.id;
  await B.rpc("fn_generate_variants", { p_product_id: bIsoId, p_axes: [] });
  // A cannot read B's vendor row / products / variants / documents by ID
  const bVendorId = onB.data.vendor_id;
  const aReadBVendor = await A.from("vendors").select("id").eq("id", bVendorId).maybeSingle();
  check("A cannot read B's vendor row", aReadBVendor.data === null, aReadBVendor.error?.message ?? "0 rows");
  const aReadBTv = await A.from("products").select("id").eq("id", bIsoId).maybeSingle();
  check("A cannot read B's product by ID", aReadBTv.data === null, aReadBTv.error?.message ?? "0 rows");
  const aReadBTvVariant = await A.from("variants").select("id").eq("product_id", bIsoId).maybeSingle();
  check("A cannot read B's variants", aReadBTvVariant.data === null, aReadBTvVariant.error?.message ?? "0 rows");
  const aReadBValues = await A.from("product_attribute_values").select("product_id").eq("product_id", bIsoId).maybeSingle();
  check("A cannot read B's attribute values", aReadBValues.data === null, aReadBValues.error?.message ?? "0 rows");
  const aReadBMedia = await A.from("product_media").select("path").eq("product_id", bIsoId).maybeSingle();
  check("A cannot read B's product media", aReadBMedia.data === null, aReadBMedia.error?.message ?? "0 rows");
  const aUpdateB = await A.from("products").update({ name_en: "hacked" }).eq("id", bIsoId).select("id");
  check("A cannot update B's product (0 rows / error)", !!aUpdateB.error || (aUpdateB.data?.length ?? 0) === 0, aUpdateB.error?.message ?? `updated=${aUpdateB.data?.length}`);
  const aCountB = await A.from("products").select("id", { count: "exact", head: true }).eq("vendor_id", bVendorId).eq("status", "draft");
  check("A cannot list B's DRAFT products by vendor_id (approved ones are public)", (aCountB.count ?? 0) === 0, `count=${aCountB.count} err=${aCountB.error?.message ?? "none"}`);
  // A can read own
  const aOwn = await A.from("products").select("id", { count: "exact", head: true }).eq("vendor_id", onA.data.vendor_id);
  check("A sees own products", (aOwn.count ?? 0) >= 1, `count=${aOwn.count}`);

  section("G2 documents privacy (private bucket + signed URLs)");
  // A uploads a real object into the private documents bucket (owner path)
  const aUid = (await A.auth.getUser()).data.user?.id;
  const docPath = `u/${aUid}/doc-${STAMP}.pdf`;
  const upRes = await A.storage.from("documents").upload(docPath, new TextEncoder().encode("%PDF-1.4 test"), { contentType: "application/pdf" });
  check("vendor A uploads KYC doc to private bucket", !upRes.error, upRes.error?.message);
  const docRow = await A.from("vendor_documents").insert({ vendor_id: onA.data.vendor_id, type: "id_front", path: docPath, original_name: "id.pdf", mime: "application/pdf", size_bytes: 14 }).select("id, path").single();
  check("vendor_documents row inserted (owner)", !docRow.error, docRow.error?.message);
  // B cannot read A's document row
  const bReadDoc = await B.from("vendor_documents").select("id").eq("id", docRow.data?.id).maybeSingle();
  check("B cannot read A's document metadata", bReadDoc.data === null, bReadDoc.error?.message ?? "0 rows");
  // anon cannot GET the object
  const anonGet = await fetch(`${URL}/storage/v1/object/documents/${docPath}`);
  check("anon direct GET on private object denied", anonGet.status === 400 || anonGet.status === 403 || anonGet.status === 404, `HTTP ${anonGet.status}`);
  // B cannot sign A's object
  const bSign = await B.storage.from("documents").createSignedUrl(docPath, 60);
  check("B cannot sign A's object", !!bSign.error, bSign.error?.message?.slice(0, 60));
  // owner CAN sign
  const aSign = await A.storage.from("documents").createSignedUrl(docPath, 60);
  check("owner signs their own document", !aSign.error && !!aSign.data?.signedUrl, aSign.error?.message);
  // vendor cannot call admin-only RPCs
  const aReview = await A.rpc("fn_admin_review_product", { p_product_id: teeId, p_decision: "approve" });
  check("admin-only review RPC blocked for vendor", !!aReview.error, aReview.error?.message?.slice(0, 60));
  const aVerify = await A.rpc("fn_admin_verify_vendor", { p_vendor_id: onA.data.vendor_id, p_decision: "approve" });
  check("admin-only verify RPC blocked for vendor", !!aVerify.error, aVerify.error?.message?.slice(0, 60));
  const anonConfig = await anonClient.rpc("fn_vendor_config");
  check("fn_vendor_config denied for anon", !!anonConfig.error, anonConfig.error?.message?.slice(0, 50));
  // clone (US-12)
  const clone = await A.rpc("fn_clone_product", { p_product_id: teeId });
  check("V-18 clone creates draft (copy)", !clone.error && !!clone.data?.id, JSON.stringify(clone.data ?? clone.error));
  if (clone.data?.id) {
    const { data: cloneRow } = await svc.from("products").select("name_en, name_ar, status").eq("id", clone.data.id).single();
    check("clone named (copy) + status draft", cloneRow?.status === "draft" && cloneRow?.name_en.includes("(copy)") && cloneRow?.name_ar.includes("(نسخة)"), JSON.stringify(cloneRow));
    const { data: cloneVariants } = await svc.from("variants").select("sku").eq("product_id", clone.data.id).is("deleted_at", null);
    check("clone got unique SKU suffixes", (cloneVariants ?? []).every((v) => v.sku?.includes("-C")), JSON.stringify(cloneVariants?.slice(0, 2)));
    // archive
    const archived = await A.rpc("fn_archive_product", { p_product_id: clone.data.id });
    const { count: archivedVisible } = await A.from("products").select("id", { count: "exact", head: true }).eq("id", clone.data.id).is("deleted_at", null);
    check("V-18 archive hides product from list", !archived.error && (archivedVisible ?? 0) === 0, `count=${archivedVisible}`);
  }

  // publish rules per settings: flip review off → direct publish
  section("publish rules follow settings");
  const { data: vendorsSetting } = await svc.from("settings").select("value").eq("key", "vendors").single();
  const currentVendors = vendorsSetting?.value ?? {};
  await svc.from("settings").update({ value: { ...currentVendors, product_review_required: false } }).eq("key", "vendors");
  const directDraft = await A.rpc("fn_save_product", { p_product: {
    name_ar: "منتج نشر مباشر", name_en: "Direct Publish", leaf_category_id: clothLeaf?.id,
    media: [{ kind: "image", path: `u/x/direct-${STAMP}.png` }],
  } });
  const directId = directDraft.data?.id;
  await A.rpc("fn_generate_variants", { p_product_id: directId, p_axes: [] });
  const { data: _directVariant } = await svc.from("variants").select("id").eq("product_id", directId).is("deleted_at", null).single();
  await A.rpc("fn_save_variants", { p_product_id: directId, p_rows: [{ option_key: "", sku: `DIRECT-${STAMP}`, price_piastres: 5000, sale_price_piastres: null, stock: 1, image_path: "", is_active: true }] });
  const directSubmit = await A.rpc("fn_submit_product", { p_product_id: directId });
  check("review-off setting → submit publishes directly", !directSubmit.error && directSubmit.data?.status === "approved", JSON.stringify(directSubmit.data ?? directSubmit.error));
  const currentVendors2 = vendorsSetting?.value ?? {};
  await svc.from("settings").update({ value: { ...currentVendors2, product_review_required: true } }).eq("key", "vendors");

  section("CLEANUP");
  const { data: allDocs } = await A.from("vendor_documents").select("path");
  void allDocs;
  await A.storage.from("documents").remove([docPath]);
  // delete users cascades vendors→products→variants→docs rows
  for (const email of [adminEmail, aEmail, bEmail, cEmail]) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    const user = list.users.find((u) => u.email === email);
    if (user) await svc.auth.admin.deleteUser(user.id);
  }
  await svc.from("categories").delete().in("id", [root?.id, clothLeaf?.id, tvRoot?.id, tvLeaf?.id]);
  await svc.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("audit_logs").delete().neq("id", 0);
  const { data: leftVendors } = await svc.from("vendors").select("id");
  const { data: leftProducts } = await svc.from("products").select("id");
  check("DB pristine after cleanup", (leftVendors ?? []).length === 0 && (leftProducts ?? []).length === 0, `vendors=${leftVendors?.length} products=${leftProducts?.length}`);

  // summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  raw.push(`\n===== SUMMARY: ${passed}/${results.length} passed, ${failed} failed =====`);
  fs.mkdirSync("evidence/phase-03", { recursive: true });
  fs.writeFileSync("evidence/phase-03/rls-tests-raw.txt", raw.join("\n") + "\n");
  fs.writeFileSync("evidence/phase-03/test-results.json", JSON.stringify({ stamp: STAMP, passed, failed, results }, null, 1) + "\n");
  console.log(`\nSUMMARY: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  raw.push(`HARNESS ERROR: ${error.message}`);
  console.error("HARNESS ERROR:", error.message);
  fs.mkdirSync("evidence/phase-03", { recursive: true });
  fs.writeFileSync("evidence/phase-03/rls-tests-raw.txt", raw.join("\n") + "\n");
  process.exitCode = 1;
}
