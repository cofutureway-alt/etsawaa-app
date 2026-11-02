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

export function isDatabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

/** Server-only. Returns null when not configured — callers must fail loudly, never fake. */
export function getServiceRoleKey(): string | null {
  ensureDotEnv();
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

export function getResendApiKey(): string | null {
  ensureDotEnv();
  return process.env.RESEND_API_KEY ?? null;
}

export function getEmailFrom(): string {
  ensureDotEnv();
  return process.env.EMAIL_FROM ?? "Etsawaa <no-reply@etsawaa.com>";
}

export function getSiteUrl(requestUrl: string): string {
  ensureDotEnv();
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

/* Kashier payment gateway (phase 05) — real keys only; without them the
   Kashier method is unavailable and the checkout shows COD or nothing. */
export interface KashierEnv {
  merchantId: string;
  hmacSecret: string;
  mode: "test" | "live";
  baseUrl: string;
}

export function getKashierEnv(): KashierEnv | null {
  ensureDotEnv();
  const merchantId = process.env.KASHIER_MERCHANT_ID ?? null;
  const hmacSecret = process.env.KASHIER_HMAC_SECRET ?? null;
  if (!merchantId || !hmacSecret) return null;
  const mode = process.env.KASHIER_MODE === "live" ? "live" : "test";
  const baseUrl = process.env.KASHIER_BASE_URL ?? "https://checkout.kashier.io";
  return { merchantId, hmacSecret, mode, baseUrl };
}
