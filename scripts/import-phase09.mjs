// ============================================================================
// Etsawaa — Phase 09 Data Import CLI (D-01..D-08, D-10, D-11)
// Server-side only (service role). NOT imported anywhere in app/ code.
// Usage:
//   node --env-file=.env scripts/import-phase09.mjs --dry-run
//   node --env-file=.env scripts/import-phase09.mjs            (real import)
//   node --env-file=.env scripts/import-phase09.mjs --rollback <batchId>
// Writes landing directly into staging_* tables; publish goes through
// fn_admin_publish_batch (admin UI, D-14 gate) — never from this CLI.
// Rejected rows → data/rejected/<batch>.jsonl (row + reason, never silent).
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const REJECTED_DIR = path.join(DATA, "rejected");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const rollbackIdx = argv.indexOf("--rollback");

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

// ------------------------------------------------------------------ helpers
const slugify = (s) =>
  s.toLowerCase().trim()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";

let rejects = [];
const reject = (batchId, dataset, srcRow, reason, payload) => {
  rejects.push({ batch_id: batchId, dataset, src_row: srcRow, reason, payload });
};

async function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function newBatch(dataset, files, notes, dry) {
  const source_files = [];
  for (const f of files) {
    source_files.push({ path: path.relative(ROOT, f).replace(/\\/g, "/"), sha256: await sha256(f) });
  }
  const { data, error } = await db
    .from("import_batches")
    .insert({ dataset, source_files, dry_run: dry, notes })
    .select("id, batch_no")
    .single();
  if (error) throw error;
  console.log(`BATCH ${dataset} #${data.batch_no} ${data.id}${dry ? " (dry-run)" : ""}`);
  return data;
}

async function flushRejects(batchId, dataset) {
  if (!rejects.length) return 0;
  fs.mkdirSync(REJECTED_DIR, { recursive: true });
  const file = path.join(REJECTED_DIR, `${batchId}.jsonl`);
  fs.writeFileSync(
    file,
    rejects.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  const { error } = await db.from("import_rejects").insert(
    rejects.map((r) => ({ batch_id: batchId, dataset: r.dataset, src_row: r.src_row, reason: r.reason, payload: r.payload })),
  );
  if (error) throw error;
  const n = rejects.length;
  console.log(`REJECTS ${dataset}: ${n} → ${path.relative(ROOT, file)}`);
  return n;
}

/** chunked upsert; returns the row count written (or verified present) */
async function upsertChunked(table, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + chunk), { ignoreDuplicates: false });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

async function stagedCount(table, batchId) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("batch_id", batchId);
  if (error) throw error;
  return count ?? 0;
}

// ------------------------------------------------------------- dataset: geo
async function importAreas(dry) {
  const file = path.join(DATA, "normalized", "areas.json");
  const govs = JSON.parse(fs.readFileSync(file, "utf8"));
  const batch = dry ? { id: null, batch_no: 0 } : await newBatch("areas", [file], "27 governorates + 572 areas; shipping 100 EGP; pickup 20 EGP", false);
  const rows = [];
  let sort = 0;
  const seenInGov = new Set(); // `${govKey}|${name_ar}`
  for (const [gi, g] of govs.entries()) {
    const govKey = slugify(g.en);
    for (const a of g.areas) {
      const srcRow = gi * 1000 + sort++; // deterministic row numbering
      const key = `${govKey}|${a.ar}`;
      if (seenInGov.has(key)) {
        reject(batch.id, "areas", srcRow, "duplicate_area_name_in_governorate", { gov: g.en, area_ar: a.ar, area_en: a.en });
        continue;
      }
      seenInGov.add(key);
      rows.push({
        batch_id: batch.id,
        src_row: srcRow,
        gov_name_ar: g.ar,
        gov_name_en: g.en,
        gov_key: govKey,
        name_ar: a.ar,
        name_en: a.en ?? "",
        source_key: `${govKey}/${slugify(a.ar) || slugify(a.en)}`,
        shipping_fee_piastres: (g.shipping_fee_egp ?? 0) * 100,
        pickup_fee_piastres: (a.pickup_fee_egp ?? 0) * 100,
        sort: sort,
      });
    }
  }
  if (dry) return { staged: rows.length, rejected: rejects.length };
  const n = await upsertChunked("staging_areas", rows);
  const rej = await flushRejects(batch.id, "areas");
  await db.from("import_batches").update({ staged_rows: n, rejected_rows: rej, finished_at: new Date().toISOString() }).eq("id", batch.id);
  return { batch: batch.id, staged: n, rejected: rej };
}

// ------------------------------------------------------- dataset: categories
function buildCategoryRows(catsRows, batch, dry) {
  const rows = [];
  const levels = { 1: new Map(), 2: new Map(), 3: new Map() };
  const srcKeys = { 1: (r) => slugify(r.l1), 2: (r) => `${slugify(r.l1)}/${slugify(r.l2)}`, 3: (r) => `${slugify(r.l1)}/${slugify(r.l2)}/${slugify(r.l3)}` };
  let rowNo = 0;
  for (const r of catsRows) {
    for (const lvl of [1, 2, 3]) {
      const key = srcKeys[lvl](r);
      if (levels[lvl].has(key)) continue;
      const ar = lvl === 1 ? r.l1_ar : lvl === 2 ? r.l2_ar : r.l3_ar;
      const en = lvl === 1 ? r.l1 : lvl === 2 ? r.l2 : r.l3;
      levels[lvl].set(key, true);
      rows.push({
        batch_id: batch.id,
        src_row: ++rowNo,
        level: lvl,
        source_key: key,
        parent_key: lvl === 1 ? null : lvl === 2 ? srcKeys[1](r) : srcKeys[2](r),
        name_ar: ar ?? "",
        name_en: en ?? "",
        slug_ar: slugify(ar ?? en),
        slug_en: slugify(en ?? ""),
        sort: rowNo,
        ar_missing: !ar,
      });
    }
  }
  return rows;
}

// --------------------------------------------------------- datasets: specs/groups
function buildSpecRows(specs, batch) {
  // two EN spellings collide on the slug ("Fragrance Free" vs "Fragrance-Free",
  // "Single Use" vs "Single-use") — namespace the natural key with the source
  // id so BOTH real rows survive (no fabricated merge, no silent drop).
  const seen = new Map();
  return specs.map((s, i) => {
    let key = slugify(s.en);
    if (seen.has(key)) key = `${key}-src${s.id ?? i + 1}`;
    else seen.set(key, s.en);
    return {
      batch_id: batch.id, src_row: s.id ?? i + 1, src_id: s.id ?? null,
      name_en: s.en, name_ar: s.ar ?? "", source_key: key,
      spec_type: s.type === "number" ? "number" : "text",
      unit_en: s.unit_en === "—" ? "" : s.unit_en ?? "",
      unit_ar: s.unit_ar === "—" ? "" : s.unit_ar ?? "",
      ar_missing: !s.ar,
    };
  });
}

function buildGroupRows(groups, specs, batch) {
  // same slug-collision view as buildSpecRows: spec #450/#451 and #929/#1253
  // get `-src<id>` keys so group links always resolve to exactly one spec row.
  const seen = new Map();
  const specKeys = new Map(); // base slug -> source_key used in staging_specs
  for (const s of specs) {
    let key = slugify(s.en);
    if (seen.has(key)) key = `${key}-src${s.id}`;
    else seen.set(key, s.en);
    specKeys.set(slugify(s.en) === key ? key : `${slugify(s.en)}`, key);
  }
  // simpler: map every distinct EN name to its final key
  const byName = new Map();
  seen.clear();
  for (const s of specs) {
    let key = slugify(s.en);
    if (byName.has(key) && byName.get(key) !== s.en) key = `${key}-src${s.id}`;
    else if (byName.has(key)) continue;
    else byName.set(key, s.en);
    specKeys.set(s.en.toLowerCase(), key);
  }
  const rows = [], links = [];
  groups.forEach((g, i) => {
    const gKey = slugify(g.name);
    const keys = [];
    for (const [j, en] of (g.specs ?? []).entries()) {
      // HARD RULE: Brand is not a spec — the "Brand" entry heading every group
      // list is dropped here (brand stays products.brand_id). Documented skip.
      if (/^brand$/i.test(en)) continue;
      const sKey = specKeys.get(en.toLowerCase());
      if (!sKey) {
        reject(batch.id, "groups", i + 1, "unknown_spec_ref", { group: g.name, spec: en });
        continue;
      }
      keys.push(sKey);
      links.push({ batch_id: batch.id, group_key: gKey, spec_key: sKey, sort: j });
    }
    rows.push({ batch_id: batch.id, src_row: i + 1, name_en: g.name, name_ar: "", source_key: gKey, spec_keys: keys });
  });
  return { rows, links };
}

// ------------------------------------------------ datasets: types + templates
const VARIANT_AXIS_NAMES = new Set(["color", "size", "storage", "ram", "capacity"]);

function buildTypeAndTemplateRows(templates, catsRows, groups, specs, batch) {
  const srcKeys = { 1: (r) => slugify(r.l1), 2: (r) => `${slugify(r.l1)}/${slugify(r.l2)}`, 3: (r) => `${slugify(r.l1)}/${slugify(r.l2)}/${slugify(r.l3)}` };
  const validLeaf = new Set(catsRows.map((r) => srcKeys[3](r)));
  // group name → spec source_keys (minus Brand) — exact templates inherit
  // their group's field list (source JSON carries only the group name).
  const specFinalKey = new Map(); // EN lower → final key (collision-suffixed)
  {
    const seenBase = new Map();
    for (const s of specs) {
      const base = slugify(s.en);
      let key = base;
      if (seenBase.has(base) && seenBase.get(base) !== s.en) key = `${base}-src${s.id}`;
      else if (seenBase.has(base)) continue;
      else seenBase.set(base, s.en);
      specFinalKey.set(s.en.toLowerCase(), key);
    }
  }
  const groupFields = new Map(); // group slug → source_keys[]
  for (const g of groups) {
    const keys = [];
    for (const en of g.specs ?? []) {
      if (/^brand$/i.test(en)) continue;
      const k = specFinalKey.get(en.toLowerCase());
      if (k) keys.push(k);
    }
    groupFields.set(slugify(g.name), keys);
  }
  const types = new Map(); // typeKey -> row
  const tpls = [];
  templates.forEach((t, i) => {
    const typeKey = slugify(t.type);
    const leafKeys = (t.category_paths ?? [])
      .map((p) => p.split(" › ").map(slugify).join("/"))
      .filter((k) => validLeaf.has(k));
    if (!leafKeys.length) {
      reject(batch.id, "types", i + 1, "unresolved_leaf_category", { type: t.type, paths: t.category_paths });
      return; // type without a resolvable leaf cannot be staged safely
    }
    const existing = types.get(typeKey);
    if (existing) {
      for (const k of leafKeys) if (!existing.leaf_keys.includes(k)) existing.leaf_keys.push(k);
    } else {
      types.set(typeKey, {
        batch_id: batch.id, src_row: i + 1, name_en: t.type, name_ar: t.type_ar ?? "",
        source_key: typeKey, leaf_keys: [...leafKeys],
        template_kind: t.source, group_key: t.group ? slugify(t.group) : null,
      });
    }
    // fields: explicit for new_family; derived from the bound group for exact
    let fields = (t.fields ?? []).map(slugify);
    if (t.source === "exact" && t.group) fields = groupFields.get(slugify(t.group)) ?? [];
    const axes = fields.filter((f) => VARIANT_AXIS_NAMES.has(f));
    tpls.push({
      batch_id: batch.id, src_row: i + 1, version: 1, type_key: typeKey,
      group_key: t.group ? slugify(t.group) : null,
      family: t.family ?? "",
      fields,
      variant_axes: t.source === "exact" ? axes : (t.variant_axes ?? []).map(slugify),
      source: t.source,
      confidence: t.source === "exact" ? "exact" : "review",
      review_status: t.source === "exact" ? "approved" : "pending",
    });
  });
  return { types: [...types.values()], tpls };
}

// ------------------------------------------------------ dataset: shared links
function buildSharedRows(shared, catsRows, batch) {
  // entry "EN (AR)" must resolve to a real category node at ANY level —
  // source_keys are path-namespaced (l1 | l1/l2 | l1/l2/l3), so match by
  // (en, ar) pair against the normalized rows, then use that node's key.
  const srcKeys = { 1: (r) => slugify(r.l1), 2: (r) => `${slugify(r.l1)}/${slugify(r.l2)}`, 3: (r) => `${slugify(r.l1)}/${slugify(r.l2)}/${slugify(r.l3)}` };
  const nodeIndex = new Map(); // `en|ar` -> {key, level}
  for (const r of catsRows) {
    for (const lvl of [1, 2, 3]) {
      const en = lvl === 1 ? r.l1 : lvl === 2 ? r.l2 : r.l3;
      const ar = lvl === 1 ? r.l1_ar : lvl === 2 ? r.l2_ar : r.l3_ar;
      if (en && ar) nodeIndex.set(`${en}|${ar}`, { key: srcKeys[lvl](r), level: lvl });
    }
  }
  const rows = [];
  shared.forEach((s, i) => {
    const catKeys = [];
    for (const c of s.categories ?? []) {
      const m = c.match(/^(.*) \((.*)\)$/);
      if (!m) { reject(batch.id, "shared", i + 1, "malformed_category_entry", { entry: c }); continue; }
      const node = nodeIndex.get(`${m[1]}|${m[2]}`);
      if (!node) {
        // documented rejects: "Unisex (للجنسين (مشترك))" — no such category
        // node exists anywhere in the source tree (Flip Flops, Watches).
        reject(batch.id, "shared", i + 1, "no_category_node", { entry: c, type: s.type_en });
        continue;
      }
      const k = node.key;
      if (!catKeys.includes(k)) catKeys.push(k);
    }
    rows.push({
      batch_id: batch.id, src_row: i + 1,
      type_en: s.type_en, type_ar: s.type_ar ?? "", type_key: slugify(s.type_en),
      cat_keys: catKeys,
    });
  });
  return rows;
}

// ------------------------------------------------------------------- run all
async function run() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, "normalized", f), "utf8"));
  const catsRows = read("categories.json");
  const specs = read("specs.json");
  const groups = read("groups.json");
  const templates = read("product_templates.json");
  const shared = read("shared_products.json");
  const areasFile = path.join(DATA, "normalized", "areas.json");

  const results = {};
  results.areas = await importAreas(DRY);
  if (!DRY) rejects = [];

  // one shared batch id for the catalog datasets? No — mandate says every row
  // carries batch_id and rollback is BY BATCH; separate batch per dataset.
  const mkBatch = async (dataset, files, notes) => {
    if (DRY) return { id: null, batch_no: 0 };
    const b = await newBatch(dataset, files, notes, false);
    rejects = [];
    return b;
  };

  // categories
  const catsBatch = await mkBatch("categories", [path.join(DATA, "normalized", "categories.json")], "L1→L3 from normalized categories.json");
  const catRows = buildCategoryRows(catsRows, catsBatch, DRY);
  if (!DRY) {
    const n = await upsertChunked("staging_categories", catRows);
    await db.from("import_batches").update({ staged_rows: n, finished_at: new Date().toISOString() }).eq("id", catsBatch.id);
    results.categories = { batch: catsBatch.id, staged: n };
  } else results.categories = { staged: catRows.length };

  // specs
  const specsBatch = await mkBatch("specs", [path.join(DATA, "normalized", "specs.json")], "1,270 rows; Brand rejected as spec (product field)");
  const specRowsAll = buildSpecRows(specs, specsBatch).filter((r) => {
    if (/^brand$/i.test(r.name_en)) { reject(specsBatch.id, "specs", r.src_row, "brand_is_not_a_spec", { en: r.name_en }); return false; }
    return true;
  });
  if (!DRY) {
    const n = await upsertChunked("staging_specs", specRowsAll);
    const rej = await flushRejects(specsBatch.id, "specs");
    await db.from("import_batches").update({ staged_rows: n, rejected_rows: rej, finished_at: new Date().toISOString() }).eq("id", specsBatch.id);
    results.specs = { batch: specsBatch.id, staged: n, rejected: rej };
  } else results.specs = { staged: specRowsAll.length, rejected: rejects.length };

  // groups
  const groupsBatch = await mkBatch("groups", [path.join(DATA, "normalized", "groups.json"), path.join(DATA, "normalized", "specs.json")], "1,000 groups; Brand dropped from every group list");
  const g = buildGroupRows(groups, specs, groupsBatch);
  if (!DRY) {
    const n = await upsertChunked("staging_groups", g.rows);
    const l = await upsertChunked("staging_group_links", g.links);
    const rej = await flushRejects(groupsBatch.id, "groups");
    await db.from("import_batches").update({ staged_rows: n, rejected_rows: rej, notes: `links=${l}`, finished_at: new Date().toISOString() }).eq("id", groupsBatch.id);
    results.groups = { batch: groupsBatch.id, staged: n, links: l, rejected: rej };
  } else results.groups = { staged: g.rows.length, links: g.links.length };

  // types + templates
  const tplBatch = await mkBatch("templates", [path.join(DATA, "normalized", "product_templates.json"), path.join(DATA, "analysis", "all294_templates.csv"), path.join(DATA, "analysis", "unmatched_399_review.csv")], "1,354 types; 955 exact + 399 new_family (pending review)");
  const t = buildTypeAndTemplateRows(templates, catsRows, groups, specs, tplBatch);
  if (!DRY) {
    const nTypes = await upsertChunked("staging_types", t.types);
    const nTpls = await upsertChunked("staging_templates", t.tpls);
    const rej = await flushRejects(tplBatch.id, "types");
    await db.from("import_batches").update({ staged_rows: nTypes, rejected_rows: rej, notes: `templates=${nTpls}`, finished_at: new Date().toISOString() }).eq("id", tplBatch.id);
    results.types = { batch: tplBatch.id, staged: nTypes, templates: nTpls, rejected: rej };
  } else results.types = { staged: t.types.length, templates: t.tpls.length };

  // shared products
  const shBatch = await mkBatch("shared", [path.join(DATA, "normalized", "shared_products.json")], "32 shared types → category links; Unisex entries rejected (no node)");
  const shRows = buildSharedRows(shared, catsRows, shBatch);
  if (!DRY) {
    const n = await upsertChunked("staging_shared_products", shRows);
    const rej = await flushRejects(shBatch.id, "shared");
    await db.from("import_batches").update({ staged_rows: n, rejected_rows: rej, finished_at: new Date().toISOString() }).eq("id", shBatch.id);
    results.shared = { batch: shBatch.id, staged: n, rejected: rej };
  } else results.shared = { staged: shRows.length };

  console.log("RESULT " + JSON.stringify(results, null, 1));
  fs.mkdirSync(path.join(ROOT, "evidence", "phase-09-data"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence", "phase-09-data", DRY ? "dry-run.json" : "import-result.json"),
    JSON.stringify({ at: new Date().toISOString(), dry: DRY, ...results }, null, 1),
  );
}

// ------------------------------------------------------------------ rollback
async function rollback(batchId) {
  const { data: b, error } = await db.from("import_batches").select("*").eq("id", batchId).single();
  if (error || !b) throw new Error(`batch ${batchId} not found`);
  if (b.status === "published") throw new Error("refusing: batch already published to production catalog — manual owner action required");
  // FK cascade removes every staging_* row tied to the batch; rejects too.
  const { error: del } = await db.from("import_batches").delete().eq("id", batchId);
  if (del) throw del;
  console.log(`ROLLEDBACK batch ${b.dataset} #${b.batch_no} (${batchId}) — staging rows removed by cascade`);
}

// ---------------------------------------------------------------------- main
if (rollbackIdx >= 0) {
  await rollback(argv[rollbackIdx + 1]);
} else {
  await run();
}
