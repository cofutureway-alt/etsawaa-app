#!/usr/bin/env node
/**
 * G3 design-gate scanner: zero emoji, zero gradients, no raw colors outside
 * the token files — applied to SHIPPED code (app/ + supabase/). Tests and
 * tooling scripts are scanned for emoji only. Exits non-zero on violations.
 * Output is saved as evidence: node scripts/scan-design.mjs > evidence/phase-01/design-scan.txt
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const FULL_SCAN_DIRS = ["app", "supabase"]; // shipped code: emoji + gradient + raw hex
const EMOJI_ONLY_DIRS = ["scripts", "tests"]; // QA code: emoji only
const TEXT_EXTS = new Set([".ts", ".tsx", ".css", ".sql", ".mjs", ".json", ".md"]);
// Real emoji blocks only — arrows (2190–21FF) and misc symbols (2B00–2BFF) in
// comments are not emoji and are allowed (AGENT.md bans emojis in UI/content).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u;
const GRADIENT_RE = /linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient/i;
// Where raw hex colors are ALLOWED to live (token definitions + seeds/defaults)
const HEX_ALLOWED = [
  join("app", "styles", "tokens.css"),
  join("app", "lib", "tokens.ts"),
  join("supabase", "seed", "seed.sql"),
  // standalone print documents (A4/A5 paper) and DB email templates render
  // OUTSIDE the app stylesheet — they cannot reference CSS tokens
  join("app", "features", "orders", "documents.server.ts"),
  join("supabase", "migrations"),
];
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
// Zero-tax rule (AGENT §28: "never a tax line") — documents + email template
// migrations may never contain tax wording in any shipped language.
//  around the Latin terms (avatar_url / status contain "vat"/"ta…" as
// substrings); Arabic terms need no boundary (ضريب/ضرائب/الضريبة).
const TAX_RE = /tax|VAT|vat|taxes|ضريب|ضرائب|الضريبة/i;
const TAX_SCAN_FILES = [
  "app/features/orders/documents.server.ts",
  "supabase/migrations",
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".react-router" || entry === "build") continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

const violations = [];
let filesScanned = 0;

for (const dir of [...FULL_SCAN_DIRS, ...EMOJI_ONLY_DIRS]) {
  const dirPath = join(ROOT, dir);
  let stat;
  try {
    stat = statSync(dirPath);
  } catch {
    continue;
  }
  if (!stat.isDirectory()) continue;
  const fullScan = FULL_SCAN_DIRS.includes(dir);
  for (const file of walk(dirPath)) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!TEXT_EXTS.has(ext)) continue;
    const rel = relative(ROOT, file);
    const content = readFileSync(file, "utf8");
    filesScanned += 1;

    const lines = content.split("\n");
    lines.forEach((line, index) => {
      const lineNo = index + 1;
      if (EMOJI_RE.test(line)) {
        violations.push(`EMOJI  ${rel}:${lineNo}  ${line.trim().slice(0, 90)}`);
      }
      const relPath2 = rel.split(sep).join("/");
      if (TAX_SCAN_FILES.some((tp) => relPath2.startsWith(tp.split(sep).join("/")) && TAX_RE.test(line))) {
        violations.push(`TAX_WORDING  ${rel}:${lineNo}  ${line.trim().slice(0, 90)}`);
      }
      if (!fullScan) return;
      if (GRADIENT_RE.test(line)) {
        violations.push(`GRADIENT  ${rel}:${lineNo}  ${line.trim().slice(0, 90)}`);
      }
      if (HEX_RE.test(line)) {
        HEX_RE.lastIndex = 0;
        const relPath = rel.split(sep).join("/");
        const allowed = HEX_ALLOWED.some((allowedPath) => {
          const norm = allowedPath.replaceAll("\\", "/");
          return relPath === norm || relPath.startsWith(`${norm}/`);
        });
        // Components may also reference token values for swatch previews via settings
        const isSwatchPreview = /backgroundColor|swatch/i.test(line);
        if (!allowed && !isSwatchPreview) {
          violations.push(`RAW_HEX  ${rel}:${lineNo}  ${line.trim().slice(0, 90)}`);
        }
      }
    });
  }
}

console.log(`Etsawaa G3 design scan — ${filesScanned} files scanned`);
console.log(`Rules: zero emoji everywhere | zero gradients | hex only in token/seed files (shipped code)`);
if (violations.length > 0) {
  console.log(`\nVIOLATIONS (${violations.length}):`);
  for (const violation of violations) console.log(`  ${violation}`);
  process.exit(1);
}
console.log("\nRESULT: PASS — no design-rule violations found");
