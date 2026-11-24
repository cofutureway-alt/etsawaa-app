import { createHash } from "node:crypto";
import { data, type ActionFunctionArgs } from "react-router";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { encryptAuthEmail, ensureAuthEmailWorker } from "~/lib/email/auth-queue.server";
import { authEmailPayloadSchema, authEmailMessages, authEmailLocale, verifyAuthEmailHook } from "~/lib/email/auth-hook.server";
import { recipientLocale } from "~/lib/locale-preference.server";

export async function action({ request }: ActionFunctionArgs) {
  const secret = process.env.AUTH_EMAIL_HOOK_SECRET;
  const encryptionKey = process.env.AUTH_EMAIL_ENCRYPTION_KEY;
  const admin = getSupabaseAdminClient();
  if (!secret || !encryptionKey || !admin) return data({ error: { message: "Email service is unavailable" } }, { status: 503, headers: { "Retry-After": "true" } });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 128_000 || !verifyAuthEmailHook(raw, request.headers, secret)) return data({ error: { message: "Invalid signature" } }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { body = null; }
  const parsed = authEmailPayloadSchema.safeParse(body);
  if (!parsed.success) return data({ error: { message: "Unsupported email event" } }, { status: 422 });
  const site = process.env.SITE_URL ?? "https://etsawaa.com";
  const saved = await recipientLocale(admin, parsed.data.user.email, parsed.data.user.user_metadata?.locale === "en" ? "en" : "ar");
  const locale = authEmailLocale(parsed.data, site, saved);
  try {
    const messages = authEmailMessages(parsed.data, locale, site, Number(process.env.AUTH_EMAIL_OTP_EXP ?? 3600));
    for (const message of messages) {
      const id = createHash("sha256").update(`${request.headers.get("webhook-id")}:${message.to}:${message.key}`).digest("hex");
      const payload = encryptAuthEmail({ ...message, locale }, encryptionKey);
      const { error } = await admin.rpc("fn_enqueue_auth_email", { p_id: id, p_payload: payload, p_expires_at: new Date(Date.now() + Number(process.env.AUTH_EMAIL_OTP_EXP ?? 3600) * 1000).toISOString() });
      if (error) return data({ error: { message: "Email delivery is unavailable" } }, { status: 503, headers: { "Retry-After": "true" } });
    }
    ensureAuthEmailWorker();
    return data({});
  } catch {
    return data({ error: { message: "Email delivery failed" } }, { status: 503, headers: { "Retry-After": "true" } });
  }
}
export const loader = () => data({ ok: false }, { status: 405 });
