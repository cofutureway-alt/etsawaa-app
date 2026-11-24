import { getSupabaseAdminClient } from "~/lib/supabase/admin";

/**
 * Rasvio (WhatsApp + SMS) REST client. The API key and webhook secret live
 * in Supabase Vault (set from Admin → Messages → Connection) and are read
 * here with the service role only; RASVIO_API_KEY / RASVIO_WEBHOOK_SECRET in
 * the server env win when present. Nothing here ever reaches a browser.
 */

export const DEFAULT_API_BASE = "https://vjbzpwcbqtbqkwpxbkug.supabase.co/functions/v1/api";

interface Secrets { apiKey: string | null; webhookSecret: string | null; apiBase: string }
let cache: { value: Secrets; expiresAt: number } | null = null;

export function forgetRasvioSecrets(): void { cache = null; }

export async function rasvioSecrets(): Promise<Secrets> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const admin = getSupabaseAdminClient();
  let apiKey = process.env.RASVIO_API_KEY?.trim() || null;
  let webhookSecret = process.env.RASVIO_WEBHOOK_SECRET?.trim() || null;
  let apiBase = DEFAULT_API_BASE;
  if (admin) {
    const [k, s, cfg] = await Promise.all([
      apiKey ? null : admin.rpc("fn_messaging_secret", { p_name: "rasvio_api_key" }),
      webhookSecret ? null : admin.rpc("fn_messaging_secret", { p_name: "rasvio_webhook_secret" }),
      admin.from("settings").select("value").eq("key", "messaging").maybeSingle(),
    ]);
    if (k && typeof k.data === "string" && k.data) apiKey = k.data;
    if (s && typeof s.data === "string" && s.data) webhookSecret = s.data;
    const base = (cfg.data?.value as { api_base?: string } | null)?.api_base;
    if (typeof base === "string" && /^https:\/\/[^\s]+$/.test(base)) apiBase = base.replace(/\/$/, "");
  }
  const value = { apiKey, webhookSecret, apiBase };
  cache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

export type RasvioResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message_ar: string; message_en: string; status: number };

const notConfigured = { ok: false as const, code: "not_configured", message_ar: "لم يتم ربط Rasvio بعد.", message_en: "Rasvio is not connected yet.", status: 0 };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<RasvioResult<T>> {
  const { apiKey, apiBase } = await rasvioSecrets();
  if (!apiKey) return notConfigured;
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message_ar?: string; message_en?: string } }) | null;
    if (!res.ok || !json || json.error) {
      const e = json?.error;
      return { ok: false, code: e?.code ?? `http_${res.status}`, message_ar: e?.message_ar ?? "تعذر الاتصال بخدمة الرسائل.", message_en: e?.message_en ?? "The messaging service could not be reached.", status: res.status };
    }
    return { ok: true, data: json };
  } catch (cause) {
    const timeout = cause instanceof Error && cause.name === "TimeoutError";
    return { ok: false, code: timeout ? "timeout" : "network", message_ar: "تعذر الاتصال بخدمة الرسائل.", message_en: "The messaging service could not be reached.", status: 0 };
  }
}

export interface RasvioBalance {
  plan?: { name_en?: string; name_ar?: string; ends_at?: string } | null;
  whatsapp?: { unlimited?: boolean; remaining?: number | null; total?: number; used?: number };
  sms?: { unlimited?: boolean; remaining?: number | null; total?: number; used?: number };
  wa_numbers?: { allowed?: number; used?: number };
}
export interface RasvioSession { session_id: string; label: string | null; name: string | null; status: string; connected_at: string | null }
export interface RasvioWhatsAppMessage { id: string; status: string; session_id?: string }
export interface RasvioSms { id: string; status: string; segments?: number }

export const rasvio = {
  balance: () => call<RasvioBalance>("GET", "/v1/balance"),
  sessions: () => call<{ data: RasvioSession[] }>("GET", "/v1/whatsapp/numbers"),
  sendWhatsApp: (input: { to: string; body: string; session_id?: string; reference?: string }, idempotencyKey: string) =>
    call<RasvioWhatsAppMessage>("POST", "/v1/whatsapp/messages", { type: "text", ...input }, idempotencyKey),
  sendSms: (input: { to: string; body: string; reference?: string }, idempotencyKey: string) =>
    call<RasvioSms>("POST", "/v1/sms/messages", input, idempotencyKey),
};
