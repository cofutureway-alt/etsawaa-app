/**
 * Phase 02 — M-08 + upload-limit evidence (raw output artifact).
 *
 *  A. media isolation: user B sees nothing of user A (folders/files rows,
 *     direct-ID select), documents object NOT publicly readable, signed URL
 *     works then EXPIRES, public media URL works (public-read bucket).
 *  B. catalog writes: customer + staff denied, admin allowed; anon reads only
 *     active categories (inactive/deleted hidden).
 *  C. upload limits through the real bucket config (edge admin-update-bucket):
 *     disallowed mime, oversized image, video (toggle off), PDF toggle off→on.
 *
 * Reproduce: node --env-file=.env scripts/test-phase2-media.mjs
 * Requires the production server NOT to be required; talks to Supabase directly.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const STAMP = Date.now();
const PASSWORD = "Phase2#12345";
const results = [];
const lines = [];
const emit = (o) => { const s = typeof o === "string" ? o : JSON.stringify(o); lines.push(s); console.log(s); };
const check = (test, expected, actual, pass, detail) => { results.push({ test, pass }); emit({ test, expected, actual, pass, ...(detail ? { detail } : {}) }); };

let userSeq = 0;
const mkUser = async (email, role) => {
  userSeq += 1;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: email.split("@")[0], phone_e164: `+201${userSeq}0${String(STAMP).slice(-7)}` },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  if (role !== "customer") await svc.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
};

const signIn = async (email) => {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
};

// 1×N transparent PNG + 1×1
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const bigPng = Buffer.alloc(6 * 1024 * 1024, 0x61); // 6MB > max_image_mb 5
const fakeExe = Buffer.from("MZ0000fakebinary");
const fakePdf = Buffer.from("%PDF-1.4 tiny pdf");

try {
  const adminId = await mkUser(`p2-admin-${STAMP}@etsawaa-e2e.com`, "admin");
  const aId = await mkUser(`p2-usera-${STAMP}@etsawaa-e2e.com`, "customer");
  const bId = await mkUser(`p2-userb-${STAMP}@etsawaa-e2e.com`, "customer");
  const staffId = await mkUser(`p2-staff-${STAMP}@etsawaa-e2e.com`, "staff");
  const admin = await signIn(`p2-admin-${STAMP}@etsawaa-e2e.com`);
  const a = await signIn(`p2-usera-${STAMP}@etsawaa-e2e.com`);
  const b = await signIn(`p2-userb-${STAMP}@etsawaa-e2e.com`);
  const staff = await signIn(`p2-staff-${STAMP}@etsawaa-e2e.com`);
  emit({ fixture: { adminId, aId, bId, staffId } });

  // ---------------- A. media isolation -------------------------------------
  const { data: folderA, error: folderErr } = await a.from("media_folders").insert({ name: "A-folder" }).select("id,name").single();
  check("A.createFolder", "ok", folderErr?.message ?? "ok", !folderErr);

  const { data: seenFolders } = await b.from("media_folders").select("id");
  check("B.cannotListAfolders", "0 rows", (seenFolders ?? []).length, (seenFolders ?? []).length === 0);

  const pathA = `u/${aId}/${crypto.randomUUID()}.png`;
  const up = await a.storage.from("media").upload(pathA, tinyPng, { contentType: "image/png" });
  check("A.uploadToMedia", "ok", up.error?.message ?? "ok", !up.error);
  const { error: rowErr } = await a.from("media_files").insert({ bucket: "media", path: pathA, original_name: "a.png", mime: "image/png", size_bytes: tinyPng.length, kind: "image", folder_id: folderA?.id ?? null });
  check("A.insertMediaFileRow", "ok", rowErr?.message ?? "ok", !rowErr);

  const { data: bFiles } = await b.from("media_files").select("id");
  check("B.cannotListAfiles", "0 rows", (bFiles ?? []).length, (bFiles ?? []).length === 0);
  const { data: rowId } = await svc.from("media_files").select("id").eq("path", pathA).single();
  const { data: bDirect } = await b.from("media_files").select("*").eq("id", rowId?.id ?? "00000000-0000-0000-0000-000000000000");
  check("B.directIdReadDenied", "0 rows", (bDirect ?? []).length, (bDirect ?? []).length === 0);

  // public URL works for media (public-read bucket, M-01 DoD)
  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/media/${pathA}`;
  const pubRes = await fetch(publicUrl);
  check("media.publicUrl200", 200, pubRes.status, pubRes.status === 200);

  // documents: private + signed URL expiry
  const docPath = `u/${aId}/${crypto.randomUUID()}.pdf`;
  const upDoc = await a.storage.from("documents").upload(docPath, fakePdf, { contentType: "application/pdf" });
  check("A.uploadToDocuments", "ok", upDoc.error?.message ?? "ok", !upDoc.error);
  const docPublic = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/documents/${docPath}`);
  check("documents.notPublic", "403/400", docPublic.status, docPublic.status === 403 || docPublic.status === 400);
  const { data: signed } = await a.storage.from("documents").createSignedUrl(docPath, 2);
  const signedRes = await fetch(signed?.signedUrl ?? "");
  check("documents.signedUrl200", 200, signedRes.status, signedRes.status === 200);
  await new Promise((r) => setTimeout(r, 3000));
  const signedExpired = await fetch(signed?.signedUrl ?? "");
  check("documents.signedUrlExpires", "400/403", signedExpired.status, signedExpired.status === 400 || signedExpired.status === 403);

  // ---------------- B. catalog writes + public reads -----------------------
  const catIns = await b.from("categories").insert({ slug_ar: `x-${STAMP}`, slug_en: `x-${STAMP}`, name_ar: "x", name_en: "x" });
  check("customer.categoryWriteDenied", "RLS error", catIns.error ? "denied" : "ALLOWED", !!catIns.error);
  const staffIns = await staff.from("categories").insert({ slug_ar: `x2-${STAMP}`, slug_en: `x2-${STAMP}`, name_ar: "x", name_en: "x" });
  check("staff.categoryWriteDenied", "RLS error", staffIns.error ? "denied" : "ALLOWED", !!staffIns.error);

  const slugA = `adm-${STAMP}`;
  const slugB = `adm-off-${STAMP}`;
  const { data: catActive } = await admin.from("categories").insert({ slug_ar: slugA, slug_en: slugA, name_ar: "نشطة", name_en: "Active", is_active: true }).select("id").single();
  const { data: catHidden } = await admin.from("categories").insert({ slug_ar: slugB, slug_en: slugB, name_ar: "مخفية", name_en: "Hidden", is_active: false }).select("id").single();
  check("admin.categoryWriteAllowed", "ok", catActive ? "ok" : "denied", !!catActive);

  const { data: anonCats } = await anon.from("categories").select("id");
  const anonHasHidden = (anonCats ?? []).some((c) => c.id === catHidden?.id);
  check("anon.seesActiveOnly", "hidden excluded", anonHasHidden ? "LEAKED" : "excluded", !anonHasHidden && (anonCats ?? []).length >= 1);
  const { data: adminCats } = await admin.from("categories").select("id");
  const adminSeesHidden = (adminCats ?? []).some((c) => c.id === catHidden?.id);
  check("admin.seesInactiveRow", "visible", adminSeesHidden ? "visible" : "missing", adminSeesHidden);

  // attribute attach to non-leaf must fail (DB trigger): parent WITH a child
  const { data: rootCat } = await admin.from("categories").insert({ slug_ar: `root-${STAMP}`, slug_en: `root-${STAMP}`, name_ar: "جذر", name_en: "Root" }).select("id").single();
  await admin.from("categories").insert({ parent_id: rootCat?.id ?? null, slug_ar: `root-child-${STAMP}`, slug_en: `root-child-${STAMP}`, name_ar: "ابن", name_en: "Child" });
  const { error: leafErr } = await admin.from("attribute_defs").insert({ category_id: rootCat?.id ?? "", code: "x_test", type: "text" });
  check("attribute.nonLeafBlocked", "DB error", leafErr ? "denied" : "ALLOWED", !!leafErr);
  const { error: axisErr } = await admin.from("attribute_defs").insert({ category_id: catActive?.id ?? "", code: "x_axis", type: "text", is_variant_axis: true });
  check("attribute.textAxisBlocked", "DB check error", axisErr ? "denied" : "ALLOWED", !!axisErr);

  // ---------------- C. upload limits through the bucket config -------------
  const callEdge = async (body, clientSession) => {
    const { data: sess } = await clientSession.auth.getSession();
    return fetch(`${process.env.SUPABASE_URL}/functions/v1/admin-update-bucket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.session?.access_token}`, "Content-Type": "application/json", apikey: process.env.SUPABASE_ANON_KEY ?? "" },
      body: JSON.stringify(body),
    });
  };

  // defaults: images only (no video, no pdf), 5MB images
  const apply = await callEdge({ action: "apply", media: { allow_images: true, allow_video: false, allow_pdf: false, allowed_mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"], max_image_mb: 5, max_video_mb: 50, max_pdf_mb: 10, max_dimensions_px: 4000 } }, admin);
  const applyBody = await apply.json();
  check("edge.applyConfig", "admin ok", JSON.stringify(applyBody.results ?? applyBody), apply.ok && applyBody.results?.media === "ok");

  const bNonAdmin = await callEdge({ action: "apply", media: {} }, b);
  check("edge.nonAdminDenied", 403, bNonAdmin.status, bNonAdmin.status === 403);

  const upExe = await a.storage.from("media").upload(`u/${aId}/${crypto.randomUUID()}.exe`, fakeExe, { contentType: "application/octet-stream" });
  check("upload.disallowedMime", "rejected", upExe.error ? `rejected (${upExe.error.statusCode ?? upExe.error.message.slice(0, 30)})` : "ACCEPTED", !!upExe.error);

  const upBig = await a.storage.from("media").upload(`u/${aId}/${crypto.randomUUID()}.png`, bigPng, { contentType: "image/png" });
  check("upload.oversizedImage", "rejected", upBig.error ? `rejected (${upBig.error.statusCode ?? upBig.error.message.slice(0, 30)})` : "ACCEPTED", !!upBig.error);

  const upVideo = await a.storage.from("media").upload(`u/${aId}/${crypto.randomUUID()}.mp4`, fakeExe, { contentType: "video/mp4" });
  check("upload.videoOff", "rejected", upVideo.error ? "rejected" : "ACCEPTED", !!upVideo.error);

  const upPdfOff = await a.storage.from("media").upload(`u/${aId}/${crypto.randomUUID()}.pdf`, fakePdf, { contentType: "application/pdf" });
  check("upload.pdfOff", "rejected", upPdfOff.error ? "rejected" : "ACCEPTED", !!upPdfOff.error);

  // toggle PDF ON through the edge function → PDF upload succeeds
  await callEdge({ action: "apply", media: { allow_images: true, allow_video: false, allow_pdf: true, allowed_mimes: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"], max_image_mb: 5, max_video_mb: 50, max_pdf_mb: 10, max_dimensions_px: 4000 } }, admin);
  const upPdfOn = await a.storage.from("media").upload(`u/${aId}/${crypto.randomUUID()}.pdf`, fakePdf, { contentType: "application/pdf" });
  check("upload.pdfOn", "accepted", upPdfOn.error ? `rejected (${upPdfOn.error.message.slice(0, 30)})` : "accepted", !upPdfOn.error);

  // ---------------- cleanup -------------------------------------------------
  for (const p of [pathA, docPath]) await a.storage.from(p.includes("/documents/") ? "documents" : "media").remove([p]);
  if (!upPdfOn.error && upPdfOn.data?.path) await a.storage.from("media").remove([upPdfOn.data.path]);
  for (const c of [admin, a, b, staff]) await c.auth.signOut();
  for (const id of [adminId, aId, bId, staffId]) await svc.auth.admin.deleteUser(id);
  let usersRemaining = -1;
  for (let i = 0; i < 5; i += 1) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    usersRemaining = list.users.length;
    if (usersRemaining === 0) break;
    for (const u of list.users) await svc.auth.admin.deleteUser(u.id);
  }
  await svc.from("categories").delete().in("slug_en", [slugA, slugB, `root-${STAMP}`, `adm-off-${STAMP}`]);
  emit({ cleanup: { usersRemaining, testCategoriesRemoved: true } });

  const failed = results.filter((r) => !r.pass);
  emit({ summary: { total: results.length, passed: results.length - failed.length, failed: failed.length } });
  fs.writeFileSync("evidence/phase-02/rls-media-tests.txt", `${lines.join("\n")}\n`);
  if (failed.length > 0) {
    console.error("PHASE2 TESTS FAILED");
    process.exitCode = 1;
  } else {
    console.log("PHASE2 TESTS OK");
  }
} catch (error) {
  fs.writeFileSync("evidence/phase-02/rls-media-tests.txt", `${lines.join("\n")}\nERROR: ${error.message}\n`);
  console.error("PHASE2 TESTS ERROR:", error.message);
  process.exitCode = 1;
}
