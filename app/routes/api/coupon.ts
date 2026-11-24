import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { priceCouponLines } from "~/features/checkout/pricing.server";
import { clientKey, rateLimit } from "~/lib/rate-limit.server";

/**
 * POST /:lang/api/coupon — validate a coupon against cart lines (S-09).
 * Guests may apply (JOURNEYS §5); the redemption row is written at order
 * time (phase 05), so per-user limits only apply to signed-in users.
 *
 * Hardened: the body only IDENTIFIES variants and quantities — every price,
 * vendor, category and on-sale flag is recomputed server-side by
 * `priceCouponLines()` (the same rules `fn_create_order` applies), and the
 * RPC runs through the service client because `anon` execute on
 * `fn_apply_coupon` is revoked (20261103000012_security_hardening.sql). A
 * direct PostgREST caller can therefore no longer use this engine as a
 * discount oracle against invented prices. A fixed-window rate limit caps
 * coupon-code enumeration.
 */

// Postgres accepts any 8-4-4-4-12 hex string as a uuid; zod's `.uuid()` is
// stricter (RFC 9562 version/variant nibbles) and would falsely reject
// valid-looking DB ids (e.g. QA seed rows). These ids are opaque lookup keys
// here — a well-formed-but-unknown id simply yields no priced line.
const PG_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const couponRequestSchema = z.object({
  code: z.string().trim().min(1).max(40),
  lines: z
    .array(
      z.object({
        product_id: z.string().regex(PG_UUID),
        variant_id: z.string().regex(PG_UUID),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(60),
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const admin = getSupabaseAdminClient();
  if (!admin) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });

  // Enumeration cap. Signed-in callers are limited per account; guests per IP
  // when a trusted proxy supplies it, otherwise against one generous shared
  // ceiling (a shared per-visitor bucket would let one client lock everyone
  // out of the preview; checkout re-validates the coupon regardless).
  const { data: auth } = await client.auth.getUser();
  const userId = auth.user?.id ?? null;
  const ip = clientKey(request);
  const allowed = userId
    ? rateLimit(`coupon:user:${userId}`, 20, 60_000)
    : ip
      ? rateLimit(`coupon:ip:${ip}`, 20, 60_000)
      : rateLimit("coupon:guests", 600, 60_000);
  if (!allowed) return data({ ok: false, reason: "rate_limited" }, { status: 429, headers });

  const parsed = await request
    .json()
    .then((value) => couponRequestSchema.safeParse(value))
    .catch(() => null);
  if (!parsed?.success) return data({ ok: false, reason: "bad_request" }, { status: 400, headers });

  try {
    // Server-authoritative lines — the client never supplies prices.
    const lines = await priceCouponLines(admin, parsed.data.lines);
    if (lines.length === 0) return data({ ok: false, reason: "not_eligible" }, { headers });

    // fn_apply_coupon enforces max_uses_per_user only when auth.uid() is set,
    // so a signed-in caller must run it under their own session (authenticated
    // keeps execute); guests have no per-user limit and use the service client
    // because anon execute is revoked.
    const engine = userId ? client : admin;
    const { data: res, error } = await engine.rpc("fn_apply_coupon", {
      p_code: parsed.data.code,
      p_lines: lines,
    });
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500, headers });
    return data(res, { headers });
  } catch {
    return data({ ok: false, reason: "query_failed" }, { status: 500, headers });
  }
}
