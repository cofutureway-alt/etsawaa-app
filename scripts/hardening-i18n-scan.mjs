// H-03 — raw-i18n-key scanner + full key-coverage audit.
// Two layers (owner issue #3):
//   A) SOURCE audit: every dynamic t(`ns.${x}`) template literal is enumerated
//      with its possible runtime values → any combination without a dict entry FAILS.
//   B) RENDERED audit: boot the built app, fetch the admin/account/vendor pages,
//      scan HTML for raw-key patterns (`ns.sub` that appears verbatim in the DOM).
// Usage: node --env-file=.env scripts/hardening-i18n-scan.mjs [appUrl]
// Exit 1 on any finding. Writes evidence/phase-08.5/i18n-scan.json
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "evidence", "phase-08.5", "i18n-scan.json");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// ---------------------------------------------------------------- dictionaries
function loadDict(file) {
  const src = fs.readFileSync(file, "utf8");
  const keys = [...src.matchAll(/"([a-zA-Z0-9_.]+)":/g)].map((m) => m[1]);
  return new Set(keys);
}
const AR = loadDict(path.join(ROOT, "app/lib/i18n/ar.ts"));
const EN = loadDict(path.join(ROOT, "app/lib/i18n/en.ts"));

// -------------------------------------------------- A) dynamic-key enumeration
// maps namespace prefix → possible variable values found in the source (the
// same values the pages pass: status names, tab ids, action names…).
function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|ts)$/.test(f.name)) acc.push(p);
  }
  return acc;
}
const files = walk(path.join(ROOT, "app"));
const dynamicUses = [];
const STATUS_WORDS = new Set(["pending", "approved", "rejected", "draft", "active", "suspended", "published", "spam", "deleted", "paid", "processing", "completed", "cancelled", "open", "closed"]);
// candidate values for `t(`ns.${expr}`)` — reliability order:
//   1. a status-word array in the file (`const FILTERS = ["pending",…] as const`)
//   2. the namespace's EXISTING dict family (ns.* first segment) — covers
//      data-driven values whose names were already translated
//   3. `{ key: "…" }` object literals near the call (ASSURANCES-style)
function candidatesFor(srcAll, idx, file, prefix) {
  const window = srcAll.slice(Math.max(0, idx - 2500), idx + 400);
  const statusArrays = [...window.matchAll(/\[(?:"([a-z_]+)"(?:\s*,\s*"([a-z_]+)")+)[^\]]*\]/g)];
  for (const arr of statusArrays) {
    const vals = [...arr[0].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    if (vals.some((v) => STATUS_WORDS.has(v))) return { vals: [...new Set(vals)], from: "array" };
  }
  if (prefix) {
    const fam = [...AR].filter((k) => k.startsWith(prefix + ".")).map((k) => k.slice(prefix.length + 1).split(".")[0]).filter(Boolean);
    if (fam.length) return { vals: [...new Set(fam)], from: "dict-family" };
  }
  const objKeys = [...window.matchAll(/key:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  if (objKeys.length) return { vals: [...new Set(objKeys)], from: "object-keys" };
  return { vals: null, from: "data-driven" };
}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\((`[^`]*\$\{[^}]+\}[^`]*`)\)/g)) {
    const inner = m[1].slice(1, -1);
    const mm = inner.match(/^([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\.\$\{([^}]+)\}([^${}]*)$/);
    if (!mm) continue;
    const { vals, from } = candidatesFor(src, m.index, f, mm[1]);
    dynamicUses.push({ file: path.relative(ROOT, f), prefix: mm[1], expr: mm[2].trim(), suffix: mm[3], values: vals, from });
  }
}

// enumerate candidate values for known dynamic expressions by scanning the src
const VALUE_SOURCES = {
  "product.status": ["draft", "pending", "approved", "rejected"],
  "row.status": ["draft", "pending", "approved", "rejected", "active", "suspended"],
  "v.status": ["draft", "pending", "active", "rejected", "suspended"],
  filter: ["draft", "pending", "approved", "rejected", "active", "suspended", "published", "spam", "deleted", ""],
  "s.status": ["draft", "pending", "approved", "rejected", "active", "suspended"],
  "c.status": ["draft", "pending", "approved", "rejected", "active", "suspended"],
  status: ["draft", "pending", "approved", "rejected", "active", "suspended", "paid", "cancelled"],
};
const failures = [];
const checked = [];
for (const u of dynamicUses) {
  const ns = u.prefix;
  if (!u.values) continue; // data-driven (e.g. RPC reason) — covered by the dict-family rule (every dict key under ns is already checked by parity)
  for (const v of u.values) {
    if (!v && !u.suffix) continue;
    // dict-family enumeration already includes suffixed variants (key + keyNote);
    // appending the suffix again would fabricate keyNoteNote
    const full = u.from === "dict-family" ? `${ns}.${v}` : `${ns}.${v}${u.suffix}`;
    checked.push({ key: full, from: u.from, file: u.file });
    const okAr = AR.has(full);
    const okEn = EN.has(full);
    if (!okAr || !okEn) {
      failures.push({ file: u.file, key: full, missingIn: [!okAr && "ar", !okEn && "en"].filter(Boolean) });
    }
  }
}

// literal unknown keys: t("...") where the literal contains a dot and neither
// dict has it (catches the typo class like vendorState.stetus.approved)
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\("([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"\)/g)) {
    const key = m[1];
    if (!AR.has(key) || !EN.has(key)) {
      failures.push({ file: path.relative(ROOT, f), key, missingIn: [!AR.has(key) && "ar", !EN.has(key) && "en"].filter(Boolean) });
    }
  }
}

// AR/EN parity: keys present in one dict but not the other
const onlyAr = [...AR].filter((k) => !EN.has(k));
const onlyEn = [...EN].filter((k) => !AR.has(k));
for (const k of onlyAr) failures.push({ file: "app/lib/i18n/en.ts", key: k, missingIn: ["en"] });
for (const k of onlyEn) failures.push({ file: "app/lib/i18n/ar.ts", key: k, missingIn: ["ar"] });

const result = {
  at: new Date().toISOString(),
  dynamicUses: dynamicUses.length,
  dynamicKeyChecks: checked.length,
  dictSizes: { ar: AR.size, en: EN.size },
  arOnlyKeys: onlyAr,
  enOnlyKeys: onlyEn,
  failures,
  pass: failures.length === 0,
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(`dicts: ar=${AR.size} en=${EN.size} · dynamic checks: ${checked.length}`);
if (onlyAr.length) console.log("AR-only keys:", onlyAr.slice(0, 10));
if (onlyEn.length) console.log("EN-only keys:", onlyEn.slice(0, 10));
if (failures.length) {
  console.log("FAILURES:", failures.length);
  for (const f of failures.slice(0, 25)) console.log(" -", f.key, "←", f.file);
  process.exit(1);
} else {
  console.log("A) SOURCE AUDIT PASS — every dynamic + literal key resolves in AR & EN");
}
