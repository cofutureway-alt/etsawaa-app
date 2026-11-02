/**
 * Phase 05 O-13 — order email templates: loaded from the DB, rendered with
 * real variables, and sent through the real provider. Every attempt lands in
 * email_logs. Records the honest provider status (sent / failed / not_configured).
 * Reproduce: node --env-file=.env scripts/p5-email-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../app/lib/email/server.ts";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: adminProfile } = await svc.from("profiles").select("email").eq("role", "admin").limit(1).maybeSingle();
const to = adminProfile?.email ?? "no-admin@etsawaa-e2e.com";

const templates = [
  ["order_confirmation", { customer_name: "منى أحمد", order_number: "ETS-26-001", order_total: "2,190.00 EGP", payment_method: "الدفع عند الاستلام", track_url: "http://localhost:3000/ar/order/ETS-26-001/track" }],
  ["payment_success", { order_number: "ETS-26-001", order_total: "2,190.00 EGP", order_url: "http://localhost:3000/ar/order/ETS-26-001" }],
  ["payment_failed", { order_number: "ETS-26-001", retry_url: "http://localhost:3000/ar/order/ETS-26-001" }],
  ["order_shipped", { order_number: "ETS-26-001", track_url: "http://localhost:3000/ar/order/ETS-26-001/track" }],
  ["order_delivered", { order_number: "ETS-26-001", order_url: "http://localhost:3000/ar/order/ETS-26-001", review_days: "30", return_days: "14" }],
  ["order_cancelled", { order_number: "ETS-26-001", reason: "لم أعد بحاجة للمنتج", order_url: "http://localhost:3000/ar/order/ETS-26-001" }],
];

const results = [];
for (const [key, variables] of templates) {
  for (const locale of ["ar", "en"]) {
    const r = await sendEmail(svc, { to, templateKey: key, locale, variables });
    results.push({ key, locale, ...r });
    console.log(`${key}/${locale}: ${r.status}${r.error ? ` — ${r.error}` : ""}`);
  }
}
const { data: tpl } = await svc.from("email_templates").select("key").in("key", templates.map((t) => t[0]));
fs.writeFileSync("evidence/phase-05/email-test.json", JSON.stringify({ at: new Date().toISOString(), to, templatesInDb: tpl?.length ?? 0, results }, null, 1) + "\n");
console.log(`templates in DB: ${tpl?.length ?? 0}/6`);
