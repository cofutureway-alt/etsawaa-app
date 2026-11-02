// Apply a SQL file through the Supabase Management API.
// Usage: node --env-file=.env scripts/apply-migration.mjs <path-to.sql>
import fs from "node:fs";

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) throw new Error("SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN missing");

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/apply-migration.mjs <file.sql>");
const sql = fs.readFileSync(file, "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
if (!res.ok) {
  console.log(text.slice(0, 4000));
  process.exitCode = 1;
} else {
  try {
    const body = JSON.parse(text);
    console.log(JSON.stringify(body, null, 1).slice(0, 3000) || "[]");
  } catch {
    console.log(text.slice(0, 2000));
  }
  console.log("MIGRATION APPLIED:", file);
}
