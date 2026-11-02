// Route-by-route HydrateFallback coverage audit → evidence/phase-08.5/h24-skeleton-coverage.json
import fs from "node:fs";
import path from "node:path";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!p.includes("+types")) walk(p, out); }
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk("app/routes");
const resource = /(api[\\/]|logout|rss|sitemap|robots|root-redirect)/i;
const rows = files
  .map((f) => {
    const src = fs.readFileSync(f, "utf-8");
    const hasLoader = /export (async )?function loader|export const loader/.test(src);
    const hasHF = /export function HydrateFallback/.test(src);
    const isRes = resource.test(f);
    return { f: f.split(path.sep).join("/"), hasLoader, hasHF, isRes };
  })
  .filter((r) => r.hasLoader || r.hasHF);

const missing = rows.filter((r) => r.hasLoader && !r.hasHF && !r.isRes);
const wronglyHas = rows.filter((r) => r.hasHF && (r.isRes || !r.hasLoader));
console.log("UI routes with a loader:", rows.filter((r) => r.hasLoader && !r.isRes).length);
console.log("routes with HydrateFallback:", rows.filter((r) => r.hasHF).length);
console.log("MISSING HydrateFallback (must be 0):", missing.length, missing.map((m) => m.f));
console.log("WRONGLY has HydrateFallback (must be 0):", wronglyHas.length, wronglyHas.map((m) => m.f));
fs.mkdirSync("evidence/phase-08.5", { recursive: true });
fs.writeFileSync(
  "evidence/phase-08.5/h24-skeleton-coverage.json",
  JSON.stringify(
    {
      total: rows.length,
      hfCount: rows.filter((r) => r.hasHF).length,
      missingCount: missing.length,
      wronglyCount: wronglyHas.length,
      missing,
      wronglyHas,
      rows,
    },
    null,
    2,
  ),
);
process.exit(missing.length || wronglyHas.length ? 1 : 0);
