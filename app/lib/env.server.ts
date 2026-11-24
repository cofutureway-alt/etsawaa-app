/**
 * Server-only environment access. `import.meta.env.VITE_*` works in the SSR
 * bundle too, but secrets (service role, Resend) must never be VITE_-prefixed;
 * they arrive via process.env (loaded from .env by vite.config in dev).
 */

import { readFileSync } from "node:fs";

/**
 * `node --env-file=.env` only covers `npm start`. Any other entry point
 * (`node build/server/index.js`, a preview server, a host that injects nothing)
 * would otherwise run without Supabase and quietly render the "not connected"
 * state. Load `.env` once as a fallback; the host's real env always wins.
 * Server-only module, so none of this reaches the browser bundle.
 */
let dotEnvLoaded = false;
function ensureDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  if (process.env.SUPABASE_URL) return;
  try {
    const file = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    for (const line of file.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      const key = match?.[1];
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = (match?.[2] ?? "").trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env present (production vars come from the host) — nothing to load.
  }
}

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function getSupabaseEnv(): SupabaseEnv | null {
  ensureDotEnv();
  const url = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Server-only. Returns null when not configured — callers must fail loudly, never fake. */
export function getServiceRoleKey(): string | null {
  ensureDotEnv();
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

export interface SmtpSender {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  replyTo: string | null;
}

/**
 * SMTP settings for one of our own mailboxes on mx.etsawaa.com (Stalwart).
 * Returns null when that mailbox's credentials are not configured — callers
 * must report it, never pretend the email was sent.
 */
export function getSmtpSender(kind: "notifications" | "support"): SmtpSender | null {
  ensureDotEnv();
  const env = process.env;
  const user = kind === "support" ? env.SMTP_SUPPORT_USER : env.SMTP_NOTIFY_USER;
  const pass = kind === "support" ? env.SMTP_SUPPORT_PASS : env.SMTP_NOTIFY_PASS;
  if (!user || !pass) return null;
  const from = kind === "support"
    ? env.EMAIL_FROM_SUPPORT ?? `Etsawaa Support <${user}>`
    : env.EMAIL_FROM_NOTIFY ?? `Etsawaa <${user}>`;
  return {
    host: env.SMTP_HOST ?? "mx.etsawaa.com",
    port: Number(env.SMTP_PORT ?? 465),
    user,
    pass,
    from,
    replyTo: kind === "support" ? null : env.EMAIL_REPLY_TO ?? "support@etsawaa.com",
  };
}

export function getSiteUrl(requestUrl: string): string {
  ensureDotEnv();
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

/* Kashier payment gateway — Merchant ID plus a Payment API key / Secret key
   pair per mode. Which mode a payment uses is an admin setting (payments →
   kashier_test_mode), not an env var; a mode without keys is unavailable.
   Secret keys contain "$" and are written as "\$" in .env so the dev server's
   dotenv-expand leaves them alone; `node --env-file` keeps the backslash, so
   it is stripped here. */
export type KashierMode = "live" | "test";
export interface KashierKeys {
  mode: KashierMode;
  apiKey: string;
  secretKey: string;
  /** REST host: test-api.kashier.io / api.kashier.io */
  apiBase: string;
}
export interface KashierEnv {
  merchantId: string;
  live: KashierKeys | null;
  test: KashierKeys | null;
}

export function getKashierEnv(): KashierEnv | null {
  ensureDotEnv();
  const merchantId = process.env.KASHIER_MERCHANT_ID?.trim() || null;
  if (!merchantId) return null;
  const keys = (mode: KashierMode): KashierKeys | null => {
    const prefix = mode === "live" ? "KASHIER_LIVE_" : "KASHIER_TEST_";
    const apiKey = process.env[`${prefix}API_KEY`]?.trim();
    const secretKey = process.env[`${prefix}SECRET_KEY`]?.trim().split("\\$").join("$");
    if (!apiKey || !secretKey) return null;
    return { mode, apiKey, secretKey, apiBase: mode === "live" ? "https://api.kashier.io" : "https://test-api.kashier.io" };
  };
  const live = keys("live");
  const test = keys("test");
  if (!live && !test) return null;
  return { merchantId, live, test };
}
