import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Legal documents (Terms & Conditions, Seller agreement): versioned rows in
 * legal_documents; acceptances in legal_acceptances (written only by
 * fn_accept_legal / the sign-up trigger / the onboarding trigger).
 */

import type { LegalDoc, LegalKind, LegalStatus } from "./legal.shared";
export * from "./legal.shared";

const COLS = "id, kind, version, title_ar, title_en, body, content_hash, effective_at, is_current, notes";

export async function getLegalDoc(client: SupabaseClient, kind: LegalKind, version?: string | null): Promise<LegalDoc | null> {
  let q = client.from("legal_documents").select(COLS).eq("kind", kind);
  q = version ? q.eq("version", version) : q.eq("is_current", true);
  const { data } = await q.maybeSingle();
  return (data as LegalDoc | null) ?? null;
}

export async function getLegalStatus(client: SupabaseClient): Promise<LegalStatus | null> {
  const { data } = await client.rpc("fn_legal_status");
  return (data as LegalStatus | null) ?? null;
}

/** Client IP + user agent recorded with an acceptance (evidence, never trusted for auth). */
export function acceptanceEvidence(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null };
}

