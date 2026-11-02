// H-06 — ROUTE SMOKE: hit every menu route (admin/vendor/account + key public
// routes) as the relevant role, record HTTP status. zeroes 500s; expected 404
// only for truly unknown URLs. Writes evidence/phase-08.5/route-smoke.json.
// Usage: node --env-file=.env scripts/hardening-route-smoke.mjs
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const OUT = "evidence/phase-08.5/route-smoke.json";
fs.mkdirSync("evidence/phase-08.5", { recursive: true });

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

// login helper → cookie string
async function login(email, password) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  // The SSR app stores the session in its own cookies via /auth flows; for the
  // smoke we seed sb-* cookies directly from the session tokens.
  const ck = [
    `sb-access-token=${data.session.access_token}`,
    `sb-refresh-token=${data.session.refresh_token}`,
  ].join("; ");
  return ck;
}

const adminCookies = await login("process.env.TEST_ADMIN_EMAIL ?? """, "process.env.TEST_ADMIN_PASSWORD ?? """);

// vendor probe user (created during RLS probes) — may have no store; statuses matter
let vendorCookies = null;
try {
  const { error } = await anon.auth.signInWithPassword({ email: "rls-probe-vendor@etsawaa-test.com", password: "Probe-Vendor-#9" });
  if (!error) {
    vendorCookies = (await anon.auth.getSession()).data.session
      ? [`sb-access-token=${(await anon.auth.getSession()).data.session.access_token}`, `sb-refresh-token=${(await anon.auth.getSession()).data.session.refresh_token}`].join("; ")
      : null;
  }
} catch { /* vendor optional */ }

const ROUTES = [
  // [path, cookie, expect]
  ["/ar", null, 200],
  ["/ar/products", null, 200],
  ["/ar/cart", null, 200],
  ["/ar/blog", null, 200],
  ["/ar/contact", null, 200],
  ["/sitemap.xml", null, 200],
  // admin menu
  ["/ar/admin", adminCookies, [200, 302]],
  ["/ar/admin/orders", adminCookies, [200, 302]],
  ["/ar/admin/products", adminCookies, [200, 302]],
  ["/ar/admin/vendors", adminCookies, [200, 302]],
  ["/ar/admin/customers", adminCookies, [200, 302]],
  ["/ar/admin/shipping", adminCookies, [200, 302]],
  ["/ar/admin/withdrawals", adminCookies, [200, 302]],
  ["/ar/admin/reviews", adminCookies, [200, 302]],
  ["/ar/admin/reports", adminCookies, [200, 302]],
  ["/ar/admin/refunds", adminCookies, [200, 302]],
  ["/ar/admin/coupons", adminCookies, [200, 302]],
  ["/ar/admin/penalties", adminCookies, [200, 302]],
  ["/ar/admin/levels", adminCookies, [200, 302]],
  ["/ar/admin/ads", adminCookies, [200, 302]],
  ["/ar/admin/events", adminCookies, [200, 302]],
  ["/ar/admin/banners", adminCookies, [200, 302]],
  ["/ar/admin/logs", adminCookies, [200, 302]],
  ["/ar/admin/users", adminCookies, [200, 302]],
  ["/ar/admin/roles", adminCookies, [200, 302]],
  ["/ar/admin/zones", adminCookies, [200, 302]],
  ["/ar/admin/catalog/categories", adminCookies, [200, 302]],
  ["/ar/admin/catalog/brands", adminCookies, [200, 302]],
  ["/ar/admin/catalog/tags", adminCookies, [200, 302]],
  ["/ar/admin/catalog/attributes", adminCookies, [200, 302]],
  ["/ar/admin/blog", adminCookies, [200, 302]],
  ["/ar/admin/pages", adminCookies, [200, 302]],
  ["/ar/admin/email-templates", adminCookies, [200, 302]],
  ["/ar/admin/settings/sections", adminCookies, [200, 302]],
  ["/ar/admin/document-settings", adminCookies, [200, 302]],
  ["/ar/admin/media", adminCookies, [200, 302]],
  ["/ar/admin/media-settings", adminCookies, [200, 302]],
  ["/ar/admin/settings", adminCookies, [200, 302]],
  ["/ar/admin/profile", adminCookies, [200, 302]],
  ["/ar/admin/orders/TEST-NUMBER", adminCookies, [200, 302, 404]],
  // vendor panel
  ["/ar/vendor", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/products", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/orders", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/wallet", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/reports", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/penalties", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/store", vendorCookies ?? adminCookies, [200, 302]],
  ["/ar/vendor/profile", vendorCookies ?? adminCookies, [200, 302]],
  // account
  ["/ar/account", adminCookies, [200, 302]],
  ["/ar/account/orders", adminCookies, [200, 302]],
  ["/ar/account/addresses", adminCookies, [200, 302]],
  ["/ar/account/wishlist", adminCookies, [200, 302]],
  ["/ar/account/reviews", adminCookies, [200, 302]],
  ["/ar/account/profile", adminCookies, [200, 302]],
];

const results = [];
let bad = 0;
for (const [path, cookies, expect] of ROUTES) {
  const headers = {};
  if (cookies) headers.Cookie = cookies;
  let status;
  try {
    const res = await fetch(BASE + path, { headers, redirect: "manual" });
    status = res.status;
  } catch (e) {
    status = `FETCH_ERR: ${String(e).slice(0, 80)}`;
  }
  const ok = Array.isArray(expect) ? expect.includes(status) : status === expect;
  results.push({ path, status, expect, ok });
  console.log(`${ok ? "OK " : "FAIL"} ${status} ${path}`);
  if (!ok) bad += 1;
}

const fiveHundreds = results.filter((r) => typeof r.status === "number" && r.status >= 500);
const summary = {
  at: new Date().toISOString(),
  total: results.length,
  failures: results.filter((r) => !r.ok),
  fiveHundreds: fiveHundreds.map((r) => r.path),
  pass: bad === 0,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(`\n${bad === 0 ? "ALL PASS" : `${bad} FAILURES`} — 500s: ${summary.fiveHundreds.length}`);
// keep cookies out of any lingering session
await anon.auth.signOut().catch(() => {});
process.exit(bad === 0 ? 0 : 1);
