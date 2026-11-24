import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { sendEmail } from "./server";
import { z } from "zod";

const queuedEmailSchema = z.object({ to: z.string().email(), key: z.string().startsWith("auth:"), locale: z.enum(["ar", "en"]), variables: z.record(z.string(), z.string()) });
export type QueuedAuthEmail = z.infer<typeof queuedEmailSchema>;
function keyBytes(secret: string): Buffer {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) throw new Error("invalid_email_encryption_key");
  return key;
}
export function encryptAuthEmail(email: QueuedAuthEmail, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secret), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(email), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), bytes.toString("base64")].join(".");
}
export function decryptAuthEmail(value: string, secret: string): QueuedAuthEmail {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("invalid_email_ciphertext");
  const cipher = createDecipheriv("aes-256-gcm", keyBytes(secret), Buffer.from(iv, "base64"));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return queuedEmailSchema.parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(encrypted, "base64")), cipher.final()]).toString("utf8")));
}

let started = false, running = false, lastCleanup = 0;
export function ensureAuthEmailWorker(): void {
  if (started || !process.env.AUTH_EMAIL_ENCRYPTION_KEY) return;
  started = true;
  const timer = setInterval(() => { void drainAuthEmails().catch(() => console.error("[auth-email] queue unavailable")); }, 1000);
  timer.unref();
}

export async function drainAuthEmails(): Promise<void> {
  if (running) return;
  const admin = getSupabaseAdminClient(), key = process.env.AUTH_EMAIL_ENCRYPTION_KEY;
  if (!admin || !key) return;
  running = true;
  try {
    const now = new Date().toISOString();
    if (Date.now() - lastCleanup > 60_000) {
      await admin.from("auth_email_deliveries").update({ payload: null, status: "failed" }).lte("expires_at", now).not("payload", "is", null);
      await admin.from("auth_email_deliveries").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
      lastCleanup = Date.now();
    }
    const { data: queued } = await admin.from("auth_email_deliveries").select("id,payload,attempts,status,updated_at")
      .not("payload", "is", null).gt("expires_at", now).lte("next_attempt_at", now).lt("attempts", 5).neq("status", "sent")
      .order("updated_at").limit(10);
    for (const item of queued ?? []) {
      if (item.status === "sending" && Date.now() - new Date(item.updated_at).getTime() < 120_000) continue;
      const { data: claim, error } = await admin.rpc("fn_claim_auth_email", { p_id: item.id });
      if (error || claim !== "claimed") continue;
      let sent = false;
      try {
        const message = decryptAuthEmail(item.payload, key);
        sent = (await sendEmail(admin, { to: message.to, templateKey: message.key, locale: message.locale, variables: message.variables })).status === "sent";
      } catch { /* Never include the decrypted email or token in diagnostics. */ }
      const attempts = Number(item.attempts) + 1;
      const delay = [5, 30, 120, 300, 600][Math.min(attempts - 1, 4)]!;
      const { error: recorded } = await admin.from("auth_email_deliveries").update({ status: sent ? "sent" : "failed", ...(sent || attempts >= 5 ? { payload: null } : {}), updated_at: new Date().toISOString(), next_attempt_at: new Date(Date.now() + delay * 1000).toISOString() }).eq("id", item.id);
      if (recorded) console.error("[auth-email] delivery state could not be saved");
    }
  } finally { running = false; }
}
