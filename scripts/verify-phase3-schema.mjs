// Verify phase-03 schema landed: tables, cron job, RPC presence, settings.
import { createClient } from "@supabase/supabase-js";
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const q = async (sql) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }),
  });
  return res.json();
};
const tables = await q("select table_name from information_schema.tables where table_schema='public' and table_name in ('vendor_levels','vendors','store_members','vendor_documents','products','product_attribute_values','product_facets','product_media','product_tags','variants') order by 1");
console.log("tables:", JSON.stringify(tables));
const cron = await q("select jobname, schedule, command from cron.job");
console.log("cron:", JSON.stringify(cron));
const fns = await q("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('fn_vendor_config','fn_vendor_onboard','fn_vendor_autosave','fn_generate_variants','fn_restore_variants','fn_save_variants','fn_save_product','fn_submit_product','fn_clone_product','fn_admin_review_product','fn_admin_review_vendor','fn_admin_verify_vendor','fn_expire_grace') order by 1");
console.log("rpcs:", JSON.stringify(fns));
const settings = await q("select key, jsonb_object_agg(k, v) from settings s, lateral jsonb_each(value) t(k,v) where key in ('verification','vendors','vendor_terms') group by key");
console.log("settings:", JSON.stringify(settings).slice(0, 500));
const { count } = await svc.from("vendor_levels").select("id", { count: "exact", head: true });
console.log("vendor_levels rows:", count);
