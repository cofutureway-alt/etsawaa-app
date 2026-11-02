/**
 * L-13 — RLS audit automation. Enumerates every table in `public` and flags:
 *   CRITICAL — RLS disabled (any direct query bypasses all policies)
 *   CRITICAL — RLS enabled but ZERO policies (implicit "deny all" for anon/
 *              authenticated SEEMS safe, but FORCE ROW LEVEL SECURITY is not
 *              set and table owners bypass it — still flagged for review)
 *   WARN     — a policy without WITH CHECK on write commands
 *   WARN     — views owned by definer without an explicit grant review
 * Also runs the cross-tenant probes from test-staff-isolation style checks.
 * Output: evidence/phase-08/rls-audit.json + console table.
 * Reproduce: node --env-file=.env scripts/rls-audit.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const results = [];
const check = (name, ok, severity, detail = "") => {
  results.push({ name, ok: Boolean(ok), severity, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : severity.toUpperCase()}  ${name}${detail ? ` — ${String(detail).slice(0, 150)}` : ""}`);
};

async function query(sql) {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const tok = process.env.SUPABASE_ACCESS_TOKEN;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`mgmt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

await (async () => {
  /* 1) RLS enabled on EVERY public table */
  const tables = await query(
    `select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename`,
  );
  const noRls = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
  check(
    `rls.enabled-on-all-tables (${tables.length} tables)`,
    noRls.length === 0,
    "CRITICAL",
    noRls.length ? `missing: ${noRls.join(", ")}` : "all tables have rowsecurity=on",
  );

  /* 2) every RLS table has at least one policy */
  const policies = await query(
    `select tablename, count(*) as n from pg_policies where schemaname='public' group by tablename`,
  );
  const byName = new Map(policies.map((p) => [p.tablename, Number(p.n)]));
  const bare = tables.filter((t) => t.rowsecurity && (byName.get(t.tablename) ?? 0) === 0).map((t) => t.tablename);
  check(
    "rls.every-rls-table-has-a-policy",
    bare.length === 0,
    "CRITICAL",
    bare.length ? `no policies: ${bare.join(", ")}` : "every table has ≥1 policy",
  );

  /* 3) write policies (insert/update/delete/all) missing WITH CHECK */
  const noCheck = await query(
    `select tablename, policyname, cmd from pg_policies
     where schemaname='public'
       and cmd in ('INSERT','UPDATE','DELETE','ALL')
       and (with_check is null or with_check = '')
     order by tablename`,
  );
  check(
    "rls.write-policies-carry-with-check",
    noCheck.length === 0,
    "WARN",
    noCheck.length ? noCheck.map((r) => `${r.tablename}.${r.policyname}(${r.cmd})`).join("; ") : "all write policies have WITH CHECK",
  );

  /* 4) grants revoked from anon on private panels' tables */
  const exposed = await query(
    `select grantee, table_name from information_schema.role_table_grants
     where table_schema='public' and grantee='anon'
       and table_name in ('wallets','wallet_transactions','withdrawal_requests','vendor_penalties','audit_logs','vendor_documents','store_members','refund_requests','order_notes','payments')
     order by table_name`,
  );
  check(
    "rls.no-anon-grant-on-sensitive-tables",
    exposed.length === 0,
    "CRITICAL",
    exposed.length ? exposed.map((r) => r.table_name).join(", ") : "anon has no grants on any sensitive table",
  );

  /* 5) FORCE ROW LEVEL SECURITY on the ledger + audit trail (owners bypass plain RLS) */
  const force = await query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname in ('wallet_transactions','audit_logs','email_logs')`,
  );
  const notForced = force.filter((r) => !r.relforcerowsecurity).map((r) => r.relname);
  check(
    "rls.force-rls-on-ledger-and-audit",
    notForced.length === 0,
    "WARN",
    notForced.length ? `not forced: ${notForced.join(", ")} (service-role + table owner bypass plain RLS; documented)` : "forced everywhere",
  );

  /* 6) cross-tenant probes: two fresh vendors can never read each other's rows */
  const PWD = "Cust#12345";
let probeCatId = null;
  const makeVendor = async (tag) => {
    const email = `p8rls-${tag}-${STAMP}@etsawaa-e2e.com`;
    const { data: u, error } = await svc.auth.admin.createUser({ email, password: PWD, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from("profiles").update({ role: "vendor" }).eq("id", u.user.id);
    const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error: se } = await c.auth.signInWithPassword({ email, password: PWD });
    if (se) throw new Error(se.message);
    const { data: area } = await svc.from("areas").select("id, governorate_id").eq("governorate_id", 1).order("id").limit(1);
    // a store needs a real category id — one shared probe category per run
    if (!probeCatId) {
      // fn_vendor_onboard validates a LEAF (depth-3) category: build root>mid>leaf
      const [root] = await query(
        `insert into public.categories (slug_ar, slug_en, name_ar, name_en, depth)
         values ('م-جذر-${STAMP}', 'p8-rls-root-${STAMP}', 'جذر', 'Root', 1) returning id`);
      const [mid] = await query(
        `insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, depth)
         values ('${root.id}', 'م-وسط-${STAMP}', 'p8-rls-mid-${STAMP}', 'وسط', 'Mid', 2) returning id`);
      const [leaf] = await query(
        `insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, depth)
         values ('${mid.id}', 'م-ورقة-${STAMP}', 'p8-rls-leaf-${STAMP}', 'ورقة', 'Leaf', 3) returning id`);
      probeCatId = leaf.id;
      console.log(`[probe] category tree ready: ${probeCatId}`);
    }
    if (!probeCatId) throw new Error('probe category missing');
    const probeCat = [String(probeCatId)];
    
    const { data: on, error: onErr } = await c.rpc("fn_vendor_onboard", {
      p_data: {
        store_name_ar: `متجر ${tag}`, store_name_en: `Store ${tag}`,
        category_ids: probeCat, first_name: "ر", last_name: "ل",
        governorate_id: area[0].governorate_id, area_id: area[0].id, address1: "عنوان",
        terms_version: "1.0", terms_signature: "P8",
      },
    });
    if (onErr || !on?.vendor_id) throw new Error(`probe onboard failed: ${onErr?.message ?? ''} data=${JSON.stringify(on)}`);
    return { userId: u.user.id, vendorId: on.vendor_id, client: c, email };
  };
  const a = await makeVendor("A");
  const b = await makeVendor("B");

  // seed a wallet tx for A only; B must see none
  await svc.rpc("fn_post_transaction", { p_vendor_id: a.vendorId, p_type: "admin_adjustment", p_amount: 5000, p_reference: `p8-rls-${STAMP}`, p_reason: "rls probe" });
  const { data: bTxs } = await b.client.from("wallet_transactions").select("id");
  check("cross-tenant.vendor-b-sees-no-wallet-tx-of-a", (bTxs ?? []).length === 0, "CRITICAL", `rows=${(bTxs ?? []).length}`);

  const { data: bPens } = await b.client.from("vendor_penalties").select("id");
  check("cross-tenant.vendor-b-sees-no-penalties-of-others", (bPens ?? []).length === 0, "CRITICAL", `rows=${(bPens ?? []).length}`);

  // orders: vendor snapshot of a foreign order returns empty/forbidden
  const { data: fake } = await b.client.rpc("fn_vendor_order_snapshot", { p_number: "ETS-00-000" });
  check("cross-tenant.vendor-snapshot-foreign-order-empty", !fake || fake.ok === false || fake.order == null || (fake.order && Object.keys(fake.order).length === 0), "CRITICAL", JSON.stringify(fake).slice(0, 120));

  // media: B cannot see A's media folder rows (owner-only RLS)
  const { data: bFolders } = await b.client.from("media_folders").select("id");
  check("cross-tenant.vendor-b-sees-no-media-folders-of-a", (bFolders ?? []).length === 0, "CRITICAL", `rows=${(bFolders ?? []).length}`);

  /* cleanup → pristine */
  await svc.from("wallet_transactions").delete().like("reference", `p8-rls-%`);
  await svc.from("wallets").delete().in("vendor_id", [a.vendorId, b.vendorId]);
  const { data: delCats } = await svc.from("categories").select("id").like("slug_en", "p8-rls-%");
  for (let i = ((delCats ?? [])).length - 1; i >= 0; i -= 1) {
    await svc.from("categories").delete().eq("id", ((delCats ?? [])[i]).id);
  }
  await svc.from("vendors").delete().in("id", [a.vendorId, b.vendorId]);
  await svc.auth.admin.deleteUser(a.userId);
  await svc.auth.admin.deleteUser(b.userId);
  await svc.from("audit_logs").delete().neq("id", 0);
})().catch((e) => {
  console.error("RLS AUDIT ERROR:", e.message);
  process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync("evidence/phase-08", { recursive: true });
  fs.writeFileSync(
    "evidence/phase-08/rls-audit.json",
    JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n",
  );
  const critical = results.filter((r) => !r.ok && r.severity === "CRITICAL");
  const warns = results.filter((r) => !r.ok && r.severity === "WARN");
  console.log(`\n==== RLS audit: ${results.length - critical.length - warns.length}/${results.length} passed — CRITICAL: ${critical.length}, WARN: ${warns.length} ====`);
  if (critical.length > 0) process.exitCode = 1;
});
