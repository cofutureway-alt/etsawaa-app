import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ar } from "../app/lib/i18n/ar.ts";
import { en } from "../app/lib/i18n/en.ts";

/**
 * Every literal t("key", { vars }) call in app/ must name a key that exists,
 * and every variable it passes must appear as {{var}} in both languages —
 * otherwise people see a raw key or a value is silently dropped.
 */
const ROOT = path.join(import.meta.dirname, "..", "app");
const SKIP_VARS = new Set(["count", "defaultValue", "lng", "ns", "context", "returnObjects"]);
// passed on purpose but not shown in the text
const ALLOWED = new Set(["legal.acceptTerms:version"]);

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "i18n") files(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function objectKeys(body: string): string[] {
  let depth = 0, cur = "";
  const parts: string[] = [];
  for (const ch of body) {
    if ("([".includes(ch)) depth++;
    if (")]".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).map((p) => {
    const k = p.match(/^([a-zA-Z_]\w*)\s*:/);
    if (k) return k[1] ?? "";
    return /^[a-zA-Z_]\w*$/.test(p) ? p : "";
  }).filter((v) => v && !SKIP_VARS.has(v));
}

test("t() calls use existing keys and their variables appear in the text", () => {
  const dicts = { en: en as Record<string, string>, ar: ar as Record<string, string> };
  const problems: string[] = [];
  for (const f of files(ROOT)) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"\s*(?:,\s*\{([^}]*)\})?/g)) {
      const key = m[1] ?? "";
      if (!(key in dicts.en)) {
        if (!(`${key}_one` in dicts.en) && !(`${key}_other` in dicts.en)) problems.push(`${path.relative(ROOT, f)}: missing key ${key}`);
        continue;
      }
      if (m[2] === undefined) continue;
      for (const v of objectKeys(m[2])) {
        if (ALLOWED.has(`${key}:${v}`)) continue;
        for (const [name, dict] of Object.entries(dicts)) {
          if (!(dict[key] ?? "").includes(`{{${v}}}`)) problems.push(`${path.relative(ROOT, f)}: ${name}.${key} lacks {{${v}}}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});
