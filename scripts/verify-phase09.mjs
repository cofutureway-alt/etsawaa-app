// ============================================================================
// Etsawaa — Phase 09 data verification (post-import, pre-publish)
// Usage: node --env-file=.env scripts/verify-phase09.mjs
// Queries staging tables for the LATEST batch per dataset
// (areas, categories, specs, groups, templates, shared) and writes
// evidence/phase-09-data/verify-phase09.json + verify-phase09.txt.
// Read-only; service role (bypasses RLS). Exits 1 if any check fails.
//
// CRITICAL PostgREST pagination rule: every paged fetch MUST use
// .order('<stable-col>') BEFORE .range(f, f+999) — unordered ranges overlap
// and produce phantom duplicates (proven: overlap=277 unordered, 0 ordered).
// Page size 1000; loop until a page returns < 1000 rows.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "evidence", "phase-09-data", "verify-phase09");
const PAGE = 1000;

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

// ------------------------------------------------------------------ helpers
/** paged fetch for one batch; ALWAYS ordered by stable columns before range */
async function fetchAll(table, cols, batchId, orderCols) {
  const rows = [];
  for (let f = 0; ; f += PAGE) {
    let q = db.from(table).select(cols).eq("batch_id", batchId);
    for (const c of orderCols) q = q.order(c);
    const { data, error } = await q.range(f, f + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** exact head count (no data transfer) */
async function headCount(table, batchId, extra) {
  let q = db.from(table).select("*", { count: "exact", head: true }).eq("batch_id", batchId);
  for (const [c, v] of Object.entries(extra ?? {})) q = q.eq(c, v);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object" && !Array.isArray(b)) {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join(",") !== kb.join(",")) return false;
    return ka.every((k) => deepEq(a[k], b[k]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// --------------------------------------------------- 1) latest batch per ds
const BATCH_DATASETS = ["areas", "categories", "specs", "groups", "templates", "shared"];
const batches = {};
for (const ds of BATCH_DATASETS) {
  const { data, error } = await db
    .from("import_batches")
    .select("id,batch_no,dataset,staged_rows,rejected_rows,status,dry_run")
    .eq("dataset", ds)
    .order("batch_no", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error(`no import_batches row for dataset "${ds}"`);
  batches[ds] = data[0];
}
const bid = (ds) => batches[ds].id;

// --------------------------------------------------- 2) fetch staging rows
const [cats, types, specs, groups, links, tpls, areas, shared] = await Promise.all([
  fetchAll("staging_categories", "level,source_key,parent_key,name_ar,ar_missing", bid("categories"), ["src_row"]),
  fetchAll("staging_types", "source_key,name_ar,leaf_keys", bid("templates"), ["src_row"]),
  fetchAll("staging_specs", "source_key,name_en,name_ar", bid("specs"), ["src_row"]),
  fetchAll("staging_groups", "source_key,spec_keys", bid("groups"), ["src_row"]),
  fetchAll("staging_group_links", "group_key,spec_key", bid("groups"), ["group_key", "spec_key"]),
  fetchAll("staging_templates", "type_key,version,source,review_status,fields", bid("templates"), ["type_key", "version"]),
  fetchAll("staging_areas", "gov_key,name_ar,shipping_fee_piastres,pickup_fee_piastres", bid("areas"), ["src_row"]),
  fetchAll("staging_shared_products", "type_en,type_key,cat_keys", bid("shared"), ["src_row"]),
]);

// --------------------------------------------------- 3) checks
const checks = [];
const chk = (name, expected, actual) => checks.push({ name, expected, actual, pass: deepEq(expected, actual) });

// 1. category levels
const lvl = { L1: 0, L2: 0, L3: 0 };
for (const c of cats) lvl[`L${c.level}`]++;
chk("cat levels (L1/L2/L3)", { L1: 10, L2: 38, L3: 170 }, lvl);

// 2. category orphans
const catKeysAll = new Set(cats.map((c) => c.source_key));
const catOrphans = cats.filter((c) => c.parent_key !== null && !catKeysAll.has(c.parent_key)).length;
chk("cat orphans (parent_key unresolved)", 0, catOrphans);

// 3. categories missing Arabic
const catMissingAr = cats.filter((c) => c.name_ar === "" || c.ar_missing).length;
chk("cat missing AR", 0, catMissingAr);

// 4. types staged
const typesStaged = await headCount("staging_types", bid("templates"));
chk("types staged", 1354, typesStaged);

// 5. type leaf_keys resolve to L3 source_keys
const l3Keys = new Set(cats.filter((c) => c.level === 3).map((c) => c.source_key));
const badLeaves = types.reduce((n, t) => n + (t.leaf_keys ?? []).filter((k) => !l3Keys.has(k)).length, 0);
chk("type leaf_keys unresolved vs L3", 0, badLeaves);

// 6. types missing name_ar
const typesMissingAr = types.filter((t) => t.name_ar === "").length;
chk("types missing name_ar", 0, typesMissingAr);

// 7. templates
const tRows = tpls.length;
const tExact = tpls.filter((t) => t.source === "exact");
const tNewFam = tpls.filter((t) => t.source === "new_family");
chk("templates (rows/exact/new_family/approved-exact/pending-new_family/zero-field)",
  { rows: 1354, exact: 955, new_family: 399, exact_approved: 955, new_family_pending: 399, zero_field: 0 },
  {
    rows: tRows,
    exact: tExact.length,
    new_family: tNewFam.length,
    exact_approved: tExact.filter((t) => t.review_status === "approved").length,
    new_family_pending: tNewFam.filter((t) => t.review_status === "pending").length,
    zero_field: tpls.filter((t) => (t.fields ?? []).length === 0).length,
  });

// 8. specs staged
const specsStaged = await headCount("staging_specs", bid("specs"));
chk("specs staged (1270 - 1 Brand reject)", 1269, specsStaged);

// 9. Brand must not be a spec
const brandSpecs = specs.filter((s) => /^brand$/i.test(s.name_en) || s.source_key === "brand").length;
chk("Brand rows in staging_specs", 0, brandSpecs);

// 10. groups + links
const specKeys = new Set(specs.map((s) => s.source_key));
const groupKeys = new Set(groups.map((g) => g.source_key));
const linksStaged = await headCount("staging_group_links", bid("groups"));
const orphanLinks = links.filter((l) => !specKeys.has(l.spec_key) || !groupKeys.has(l.group_key)).length;
const brandGroups = groups.filter((g) => (g.spec_keys ?? []).includes("brand")).length;
const zeroSpecGroups = groups.filter((g) => (g.spec_keys ?? []).length === 0).length;
chk("groups+links (rows/links/orphan_links/brand-spec-groups/zero-spec-groups)",
  { rows: 1000, links: 9409, orphan_links: 0, brand_spec_groups: 0, zero_spec_groups: 0 },
  { rows: groups.length, links: linksStaged, orphan_links: orphanLinks, brand_spec_groups: brandGroups, zero_spec_groups: zeroSpecGroups });

// 11. areas
const govKeys = new Set(areas.map((a) => a.gov_key));
const shipWrong = areas.filter((a) => a.shipping_fee_piastres !== 10000).length;
const pickWrong = areas.filter((a) => a.pickup_fee_piastres !== 2000).length;
chk("areas (rows/distinct-govs/shipping-10000/pickup-2000)",
  { rows: 571, distinct_gov_keys: 27, shipping_fee_wrong: 0, pickup_fee_wrong: 0 },
  { rows: areas.length, distinct_gov_keys: govKeys.size, shipping_fee_wrong: shipWrong, pickup_fee_wrong: pickWrong });

// 12. duplicate area (gov_key, name_ar)
const areaKeys = new Set(areas.map((a) => `${a.gov_key}|${a.name_ar}`));
chk("duplicate area (gov_key,name_ar)", 0, areas.length - areaKeys.size);

// 13. shared products — 196 resolved entries in source; 6 of them are exact
// duplicate entries repeated inside the same type row (Bluetooth Speakers,
// Headphones, Travel Backpacks ×2, Women's Running Shoes, Yoga Mats). The
// import dedupes per row (cat_keys is a set), so the staged total is 190.
const typeKeys = new Set(types.map((t) => t.source_key));
const catKeySum = shared.reduce((n, s) => n + (s.cat_keys ?? []).length, 0);
const unresolvedCat = new Set(shared.flatMap((s) => (s.cat_keys ?? []).filter((k) => !catKeysAll.has(k))));
const badSharedTypes = shared.filter((s) => !typeKeys.has(s.type_key)).length;
chk("shared (rows/bad_type_keys/cat_keys_sum/unresolved_cat_keys)",
  { rows: 32, bad_type_keys: 0, cat_keys_sum: 190, unresolved_cat_keys: 0 },
  { rows: shared.length, bad_type_keys: badSharedTypes, cat_keys_sum: catKeySum, unresolved_cat_keys: unresolvedCat.size });

// 14. rejects ledger
const rejAreas = await headCount("import_rejects", bid("areas"), { reason: "duplicate_area_name_in_governorate" });
const rejSpecs = await headCount("import_rejects", bid("specs"), { reason: "brand_is_not_a_spec" });
chk("rejects ledger (areas-dup-area/specs-brand)",
  { duplicate_area_name_in_governorate: 1, brand_is_not_a_spec: 1 },
  { duplicate_area_name_in_governorate: rejAreas, brand_is_not_a_spec: rejSpecs });

// --------------------------------------------------- 4) outputs
const allPass = checks.every((c) => c.pass);
const json = {
  at: new Date().toISOString(),
  batches: Object.fromEntries(
    BATCH_DATASETS.map((ds) => {
      const b = batches[ds];
      return [ds, { id: b.id, batch_no: b.batch_no, staged: b.staged_rows, rejected: b.rejected_rows }];
    }),
  ),
  checks,
  pass: allPass,
};

const w = 9 + 10 + 24 + 4;
const pad = (s, n) => String(s).padEnd(n);
const lines = [];
lines.push(`Etsawaa Phase 09 — staging data verification  ${json.at}`);
lines.push("Stable-column ordered pagination before range() on every paged fetch (no phantom duplicates).");
lines.push("");
lines.push("BATCHES (latest per dataset)");
for (const ds of BATCH_DATASETS) {
  const b = batches[ds];
  lines.push(`  ${pad(ds, 11)} batch_no=${pad(b.batch_no, 4)} status=${pad(b.status, 8)} staged=${pad(b.staged_rows, 6)} rejected=${b.rejected_rows}  id=${b.id}`);
}
lines.push("");
lines.push(`CHECKS (${checks.length})`);
for (const c of checks) {
  lines.push(`  ${c.pass ? "PASS" : "FAIL"}  ${pad(c.name, w - 24)}  expected=${JSON.stringify(c.expected)}  actual=${JSON.stringify(c.actual)}`);
}
lines.push("");
lines.push(`RESULT: ${allPass ? "ALL PASS" : "FAILURES PRESENT"} (${checks.filter((c) => c.pass).length}/${checks.length})`);
const txt = lines.join("\n") + "\n";

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT + ".json", JSON.stringify(json, null, 2) + "\n");
fs.writeFileSync(OUT + ".txt", txt);
console.log(txt);
process.exit(allPass ? 0 : 1);
