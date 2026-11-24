import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { action } from "../app/routes/api/webhooks/auth-email";
import { drainAuthEmails, decryptAuthEmail } from "../app/lib/email/auth-queue.server";
import { EMAIL_DEFINITIONS } from "../app/lib/email/catalog";

test("signed Auth request queues encrypted mail, worker delivers correct language, replay cannot resend", async (t) => {
  const before = { ...process.env }, signing = randomBytes(32), encryption = randomBytes(32).toString("base64");
  Object.assign(process.env, { SUPABASE_URL: "https://email-test.invalid", SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", SITE_URL: "https://etsawaa.com", AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${signing.toString("base64")}`, AUTH_EMAIL_ENCRYPTION_KEY: encryption, SMTP_NOTIFY_USER: "pipeline@example.invalid", SMTP_NOTIFY_PASS: "test-only" });
  delete process.env.SUPABASE_INTERNAL_URL;
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k]; Object.assign(process.env, before); });
  const queue = new Map<string, { id: string; status: string; payload: string | null; attempts: number; updated_at: string }>();
  const deliveries: Array<{ html: string; subject: string }> = [], logs: unknown[] = [];
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async (email: { html: string; subject: string }) => { deliveries.push(email); return { messageId: "captured-not-sent", rejected: [] }; } }));
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://email-test.invalid", "the test cannot contact a real service");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.pathname.endsWith("/profiles")) return json({ locale: "en" });
    if (url.pathname.endsWith("/rpc/fn_enqueue_auth_email")) {
      if (!queue.has(body.p_id)) queue.set(body.p_id, { id: body.p_id, payload: body.p_payload, attempts: 0, status: "pending", updated_at: new Date().toISOString() });
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/rpc/fn_claim_auth_email")) {
      const row = queue.get(body.p_id)!;
      if (row.status === "sent") return json("sent");
      if (row.status === "sending") return json("busy");
      row.status = "sending"; row.attempts++; return json("claimed");
    }
    if (url.pathname.endsWith("/auth_email_deliveries")) {
      if (method === "GET") return json([...queue.values()].filter((r) => r.payload && r.status !== "sent"));
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      if (method === "PATCH" && id) Object.assign(queue.get(id)!, body);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/email_templates")) {
      const definition = EMAIL_DEFINITIONS.get(url.searchParams.get("key")!.replace(/^eq\./, ""))!;
      return json({ key: definition.key, content_ar: definition.content.ar, content_en: definition.content.en, is_active: true });
    }
    if (url.pathname.endsWith("/email_logs")) { logs.push(body); return new Response(null, { status: 201 }); }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  });
  const invoke = async (id: string, locale: string, valid = true) => {
    const raw = JSON.stringify({ user: { id: "00000000-0000-4000-8000-000000000001", email: "qa@example.invalid", user_metadata: { locale: "ar" } }, email_data: { email_action_type: "signup", token: "864219", token_hash: "private-test-hash", redirect_to: `https://etsawaa.com/${locale}/auth/verify` } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", signing).update(`${id}.${timestamp}.${raw}`).digest("base64");
    return action({ request: new Request("https://etsawaa.com/api/webhooks/auth-email", { method: "POST", body: raw, headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${valid ? signature : "invalid"}` } }), params: {}, context: {} } as Parameters<typeof action>[0]);
  };
  assert.equal((await invoke("bad", "en", false)).init?.status, 401); assert.equal(queue.size, 0);
  assert.deepEqual((await invoke("event-1", "en")).data, {});
  assert.equal(deliveries.length, 0, "Auth acknowledges durable queuing without waiting for SMTP");
  const queued = [...queue.values()][0]!;
  assert.ok(!queued.payload!.includes("864219"));
  assert.equal(decryptAuthEmail(queued.payload!, encryption).locale, "en");
  await drainAuthEmails();
  assert.equal(deliveries.length, 1); assert.ok(deliveries[0]!.html.includes('lang="en" dir="ltr"'));
  assert.ok(deliveries[0]!.html.includes("864219")); assert.ok(deliveries[0]!.html.includes("/en/auth/verify"));
  assert.equal(queued.payload, null, "ciphertext is erased after successful delivery");
  await invoke("event-1", "en"); await drainAuthEmails(); assert.equal(deliveries.length, 1);
  await invoke("event-2", "ar"); await drainAuthEmails(); assert.ok(deliveries[1]!.html.includes('lang="ar" dir="rtl"'));
  assert.ok(!JSON.stringify(logs).includes("864219")); assert.ok(!JSON.stringify(logs).includes("private-test-hash"));
});
