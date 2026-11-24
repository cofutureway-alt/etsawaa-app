import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getKashierEnv, type KashierEnv, type KashierKeys, type KashierMode } from "~/lib/env.server";
import { parseKashierSettings, type KashierMethod, type KashierSettings } from "~/features/checkout/kashier.shared";

/**
 * Kashier — Payment Sessions API (developers.kashier.io).
 *
 *  1. Our order is created first (pending payment) and stamped with the
 *     Kashier mode it will be paid in (orders / packaging_orders.payment_mode).
 *  2. POST {api}/v3/payment/sessions (Authorization: secret key, api-key:
 *     payment API key) returns a `sessionUrl` on Kashier's hosted checkout —
 *     cards, mobile wallets, installments… whatever `allowedMethods` lets
 *     through (empty = every method enabled on the merchant account).
 *  3. Payment state is written ONLY by
 *       - the signed webhook (x-kashier-signature = hex HMAC-SHA256 of the
 *         sorted `signatureKeys` of `data`, keyed with the Payment API key —
 *         the key that verifies it also proves the mode), or
 *       - a server-to-server read of the session (GET …/sessions/:id/payment
 *         with the secret key) — the fallback when a webhook is late or the
 *         site is not reachable from the internet.
 *     Both feed the same idempotent confirm RPCs; the browser's return query
 *     is never trusted.
 *
 * Test mode (admin setting payments.kashier_test_mode): "off" | "admins" |
 * "everyone". A test-mode order is paid with Kashier test cards / wallets,
 * and the database keeps it out of every wallet, earning, pickup fee and
 * packaging balance (migration 20261104000023).
 */

export { KASHIER_METHODS, parseKashierSettings } from "~/features/checkout/kashier.shared";
export type { KashierMethod, KashierSettings, TestScope } from "~/features/checkout/kashier.shared";

export async function loadKashierSettings(client: SupabaseClient): Promise<KashierSettings> {
  const { data } = await client.from("settings").select("value").eq("key", "payments").maybeSingle();
  return parseKashierSettings(data?.value);
}

/** The mode a NEW payment by this viewer uses, or null when card payment is unavailable. */
export function resolveKashierMode(settings: KashierSettings, role: string | null | undefined): KashierMode | null {
  const env = getKashierEnv();
  if (!env || !settings.enabled) return null;
  const test = settings.testScope === "everyone" || (settings.testScope === "admins" && role === "admin");
  const mode: KashierMode = test ? "test" : "live";
  return env[mode] ? mode : null;
}

function keysFor(mode: KashierMode): { env: KashierEnv; keys: KashierKeys } | null {
  const env = getKashierEnv();
  const keys = env?.[mode] ?? null;
  return env && keys ? { env, keys } : null;
}

/** Kashier rejects a merchantRedirect with a port; locally the browser comes back to the bare host. */
function redirectUrl(siteUrl: string, path: string): string {
  const url = new URL(path, siteUrl);
  url.port = "";
  return url.toString();
}

/** A public https URL Kashier can POST to; null for localhost / private hosts. */
export function webhookUrl(siteUrl: string): string | null {
  const url = new URL("/api/webhooks/kashier", siteUrl);
  if (url.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname) || url.hostname.endsWith(".localhost")) return null;
  return url.toString();
}

/**
 * Kashier refuses a second session with the same `order` reference, so every
 * attempt gets a suffix: "<our number>_<attempt>". The webhook / session read
 * map it back with orderNumberFromRef().
 */
export function kashierOrderRef(orderNumber: string): string {
  return `${orderNumber}_${Date.now().toString(36)}`;
}
export function orderNumberFromRef(ref: string): string {
  const i = ref.lastIndexOf("_");
  return i > 0 ? ref.slice(0, i) : ref;
}

export interface KashierSessionInput {
  mode: KashierMode;
  orderNumber: string;
  totalPiastres: number;
  lang: "ar" | "en";
  siteUrl: string;
  /** where Kashier sends the browser back (default: the customer order page) */
  returnPath?: string;
  customer: { email: string; reference: string };
  methods: KashierMethod[];
  description?: string;
}

export type KashierSessionResult =
  | { ok: true; sessionId: string; sessionUrl: string }
  | { ok: false; reason: string };

/** Create a hosted-checkout session for a pending order. */
export async function createKashierSession(input: KashierSessionInput): Promise<KashierSessionResult> {
  const ctx = keysFor(input.mode);
  if (!ctx) return { ok: false, reason: "not_configured" };
  const back = input.returnPath ?? `/${input.lang}/order/${encodeURIComponent(input.orderNumber)}`;
  const hook = webhookUrl(input.siteUrl);
  const body: Record<string, unknown> = {
    merchantId: ctx.env.merchantId,
    order: kashierOrderRef(input.orderNumber),
    amount: (input.totalPiastres / 100).toFixed(2),
    currency: "EGP",
    paymentType: "credit",
    type: "one-time",
    display: input.lang,
    // our own marker only — the query is never trusted for payment state
    merchantRedirect: redirectUrl(input.siteUrl, `${back}${back.includes("?") ? "&" : "?"}kashier=return`),
    failureRedirect: true,
    maxFailureAttempts: 3,
    expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    // omitted = every method active on the account (Kashier rejects "")
    ...(input.methods.length ? { allowedMethods: input.methods.join(",") } : {}),
    brandColor: "#be0404",
    description: input.description ?? `Etsawaa ${input.orderNumber}`,
    customer: { email: input.customer.email || "customer@etsawaa.com", reference: input.customer.reference },
    metaData: { orderNumber: input.orderNumber, mode: input.mode },
    ...(hook ? { serverWebhook: hook } : {}),
  };
  try {
    const res = await fetch(`${ctx.keys.apiBase}/v3/payment/sessions`, {
      method: "POST",
      headers: { Authorization: ctx.keys.secretKey, "api-key": ctx.keys.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const json = (await res.json().catch(() => null)) as { _id?: string; sessionUrl?: string; message?: string } | null;
    if (!res.ok || !json?._id || !json.sessionUrl) {
      console.error("[kashier] session create failed:", res.status, json?.message ?? "");
      return { ok: false, reason: json?.message ?? `http_${res.status}` };
    }
    return { ok: true, sessionId: json._id, sessionUrl: json.sessionUrl };
  } catch (error) {
    console.error("[kashier] session create error:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "network" };
  }
}

export interface KashierPaymentState {
  status: "succeeded" | "failed" | "pending";
  orderNumber: string;
  transactionId: string;
  amountPiastres: number;
  raw: Record<string, unknown>;
}

/** Server-to-server read of a session's payment (secret key) — trusted like the webhook. */
export async function readKashierSession(mode: KashierMode, sessionId: string): Promise<KashierPaymentState | null> {
  const ctx = keysFor(mode);
  if (!ctx || !/^[a-f0-9]{24}$/i.test(sessionId)) return null;
  try {
    const res = await fetch(`${ctx.keys.apiBase}/v3/payment/sessions/${sessionId}/payment`, {
      headers: { Authorization: ctx.keys.secretKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
    const d = json?.data;
    if (!d || d.merchantId !== ctx.env.merchantId) return null;
    const status = String(d.status ?? "").toUpperCase();
    const mapped: KashierPaymentState["status"] =
      ["PAID", "SUCCESS", "SUCCESSFUL", "CAPTURED", "AUTHORIZED"].includes(status) ? "succeeded"
        : ["FAILED", "FAILURE", "EXPIRED", "ABANDONED", "DECLINED"].includes(status) ? "failed"
          : "pending";
    // the same "TX-…" id the webhook carries as data.transactionId, so a late
    // webhook after a session read is recognised as the same payment
    const tx = String(d.targetTransactionId ?? d.transactionId ?? "");
    return {
      status: mapped,
      orderNumber: orderNumberFromRef(String(d.merchantOrderId ?? "")),
      transactionId: tx && tx !== "NA" ? tx : `session:${sessionId}`,
      amountPiastres: Math.round(Number(d.amount ?? 0) * 100),
      raw: d,
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- webhook */

/** Encode like query-string's strict mode (Kashier's reference implementation). */
function encodeValue(value: unknown): string {
  const s = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The signature payload: sorted signatureKeys as key=urlencoded(value) joined by "&". */
export function webhookSignaturePayload(data: Record<string, unknown>): string {
  const keys = Array.isArray(data.signatureKeys) ? (data.signatureKeys as unknown[]).map(String) : [];
  return [...keys].sort().map((k) => `${k}=${encodeValue(data[k])}`).join("&");
}

export function webhookSignature(apiKey: string, data: Record<string, unknown>): string {
  return createHmac("sha256", apiKey).update(webhookSignaturePayload(data)).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type WebhookVerdict =
  | { ok: true; mode: KashierMode; event: string; orderNumber: string; transactionId: string; status: "succeeded" | "failed" | "pending"; amountPiastres: number; data: Record<string, unknown> }
  | { ok: false; reason: "not_configured" | "bad_payload" | "bad_signature" };

/** Verify a Kashier webhook; the key that matches tells live from test. */
export function verifyKashierWebhook(rawBody: string, signatureHeader: string | null): WebhookVerdict {
  const env = getKashierEnv();
  if (!env) return { ok: false, reason: "not_configured" };
  if (!signatureHeader) return { ok: false, reason: "bad_signature" };
  let body: { event?: unknown; data?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  const data = (body.data && typeof body.data === "object" ? body.data : null) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.signatureKeys) || data.signatureKeys.length === 0) return { ok: false, reason: "bad_payload" };

  const mode = (["live", "test"] as const).find((m) => {
    const keys = env[m];
    return keys ? safeEqual(webhookSignature(keys.apiKey, data), signatureHeader.trim()) : false;
  });
  if (!mode) return { ok: false, reason: "bad_signature" };

  const ref = String(data.merchantOrderId ?? "");
  const transactionId = String(data.transactionId ?? "");
  if (!ref || !transactionId) return { ok: false, reason: "bad_payload" };
  const st = String(data.status ?? "").toUpperCase();
  const status = st === "SUCCESS" ? "succeeded" as const : st === "FAILURE" ? "failed" as const : "pending" as const;
  const amountPiastres = Math.round(Number(data.amount) * 100);
  if (!Number.isFinite(amountPiastres)) return { ok: false, reason: "bad_payload" };
  return {
    ok: true, mode, event: String(body.event ?? ""), orderNumber: orderNumberFromRef(ref),
    transactionId, status, amountPiastres, data,
  };
}

/* ------------------------------------------------------- confirm / reconcile */

/** What a Kashier payment settles, and the table that holds it. */
export type KashierOrderKind = "order" | "packaging" | "ad" | "service";
const KASHIER_TABLE: Record<KashierOrderKind, string> = { order: "orders", packaging: "packaging_orders", ad: "ad_orders", service: "service_orders" };

export type ConfirmResult = { ok: boolean; idempotent?: boolean; reason?: string };

/** Feed a verified result into the right confirm RPC (customer order or packaging). */
export async function applyKashierResult(admin: SupabaseClient, r: {
  mode: KashierMode; orderNumber: string; transactionId: string; status: "succeeded" | "failed"; amountPiastres: number; raw: Record<string, unknown>;
}): Promise<ConfirmResult> {
  // PKG- = packaging orders, AD- = paid ad packages, SV- = vendor services, anything else = a shop order
  const fn = r.orderNumber.startsWith("PKG-") ? "fn_confirm_packaging_payment"
    : r.orderNumber.startsWith("AD-") ? "fn_confirm_ad_payment"
    : r.orderNumber.startsWith("SV-") ? "fn_confirm_service_payment" : "fn_confirm_payment";
  const { data, error } = await admin.rpc(fn, {
    p_number: r.orderNumber,
    p_provider_ref: r.transactionId,
    p_status: r.status,
    p_amount_piastres: r.amountPiastres,
    p_raw: r.raw,
    p_mode: r.mode,
  });
  if (error) {
    console.error(`[kashier] ${fn} failed:`, error.message);
    return { ok: false, reason: "rpc_error" };
  }
  return data as ConfirmResult;
}

/**
 * Ask Kashier for the latest session of an unpaid order and apply a final
 * result. Safe to call on every page view: it only reads, and the confirm
 * RPCs are idempotent on the transaction id.
 */
export async function reconcileKashierOrder(admin: SupabaseClient, kind: KashierOrderKind, orderNumber: string): Promise<ConfirmResult | null> {
  const table = KASHIER_TABLE[kind];
  const { data: row } = await admin.from(table).select("number, payment_mode, kashier_session_id, payment_status").eq("number", orderNumber).maybeSingle();
  const order = row as { number: string; payment_mode: KashierMode; kashier_session_id: string | null; payment_status: string } | null;
  if (!order?.kashier_session_id) return null;
  if (kind === "order" ? order.payment_status === "paid" : order.payment_status !== "unpaid") return null;
  const state = await readKashierSession(order.payment_mode, order.kashier_session_id);
  if (!state || state.status === "pending" || state.orderNumber !== order.number) return null;
  return applyKashierResult(admin, {
    mode: order.payment_mode, orderNumber: order.number, transactionId: state.transactionId,
    status: state.status, amountPiastres: state.amountPiastres, raw: { source: "session_read", ...state.raw },
  });
}

/**
 * Stamp the order with the mode, open a session, remember the session id.
 * The mode is written BEFORE the session exists, so a webhook can never find
 * the order in a different mode than the one it was paid in.
 */
export async function startKashierPayment(admin: SupabaseClient, kind: KashierOrderKind, input: Omit<KashierSessionInput, "mode"> & { mode: KashierMode }): Promise<KashierSessionResult> {
  const table = KASHIER_TABLE[kind];
  // an order that already had a session keeps its mode: an earlier session
  // can still be paid, and its result must land in the same mode
  const { data: current } = await admin.from(table).select("payment_mode, kashier_session_id").eq("number", input.orderNumber).maybeSingle();
  const prior = current as { payment_mode: KashierMode; kashier_session_id: string | null } | null;
  if (!prior) return { ok: false, reason: "order_not_found" };
  const mode = prior.kashier_session_id ? prior.payment_mode : input.mode;
  if (!prior.kashier_session_id) {
    const stamp = await admin.from(table).update({ payment_mode: mode }).eq("number", input.orderNumber);
    if (stamp.error) return { ok: false, reason: "stamp_failed" };
  }
  const session = await createKashierSession({ ...input, mode });
  if (session.ok) await admin.from(table).update({ kashier_session_id: session.sessionId }).eq("number", input.orderNumber);
  return session;
}
