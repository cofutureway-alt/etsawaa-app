# Dimension 4 — Security

**Score: 5.0 / 10**

The foundation is genuinely strong (RLS everywhere, hardened cookies, HMAC-verified webhooks, injection guards, secret discipline) — but several findings sit directly on OWASP Top 10 classes (A01 broken access control via the coupon RPC, A03 injection/XSS, A05 misconfiguration via missing headers and upload controls), and two are payment-adjacent. That caps the score at 5.0.

## Strengths (verified)

- **Sessions:** `@supabase/ssr` cookies with `httpOnly: true, sameSite: "lax", secure: NODE_ENV==="production"` explicitly set against library defaults (`app/lib/supabase/server.ts:48-53,66-70`) — prevents XSS token theft.
- **Payments:** Kashier flow is the strongest area — HMAC-SHA256 over canonical fields, **timing-safe** webhook signature check before parsing (`app/features/checkout/kashier.server.ts:20-22,59-108`), merchant-ID check, status whitelist, idempotent `fn_confirm_payment`; browser return query never trusted (`app/routes/api/webhooks/kashier.ts:8-12`).
- **Order placement is server-authoritative:** `app/routes/checkout.tsx:121-190` → `fn_create_order` re-locks cart rows, joins real variant prices, applies sale windows in-DB (`20261031000000_phase05_checkout_orders.sql:374-793`); client sends no prices.
- **Open-redirect guard:** `safeNext()` (`app/lib/auth/next.ts`) rejects `//host`, `/\host`, control chars, scheme-in-path — unit-tested.
- **Route-guard coverage:** every sampled admin/vendor route guards **both loader and action** via `requirePanelAccess` (verified sweep found no single-guarded route); blocked users redirected (`guards.ts:92-94`); password change re-verifies current password (`account/profile.tsx:92-98`); logout POST-only.
- **RLS discipline:** 77 `enable row level security` vs 74 tables; `scripts/rls-audit.mjs` + 14-assertion SQL test suite; SECURITY DEFINER RPCs re-check auth server-side (7 guard prologues added in `20261103000001_fix_coupon_anon_and_fn_guards.sql`).
- **Secrets in source: none.** All secret usage flows through `app/lib/env.server.ts`; Vite deliberately whitelists only URL/anon key.
- **Private documents handled well:** strict path regex + signed URL minted with caller's own client so storage RLS applies, 60 s expiry, `no-store` (`app/routes/api/document.ts`).

## Findings (ranked)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | **Critical** | Unauthenticated coupon oracle + client-trusted discount math; `fn_apply_coupon` granted to `anon`, computes discount from client-supplied `unit_price_piastres × qty`, percent cap only via optional `max_discount_piastres` | `app/routes/api/coupon.ts:14-23`; `20261101000002_phase06_coupon_commission.sql:70-171`; `20261103000001_fix_coupon_anon_and_fn_guards.sql` (anon grant) |
| S2 | **Critical** | Stored XSS: blog `content_ar/en` rendered via `dangerouslySetInnerHTML` with **no sanitization** (no DOMPurify in project); `withHeadingIds()` only injects ids | `app/routes/blog.$slug.tsx:274`, `:51-59` |
| S3 | **Critical** | Uploads: any MIME ≤ 50 MB accepted server-side into the public `media` bucket; `bucket` name client-controlled; existing `validateUpload()` never called server-side; buckets configured with size limit but **no `allowed_mime_types`** | `app/routes/api/media-library.ts:98-108`; `app/lib/media.shared.ts:58-66` (client-only); `20261031000000_phase02_media_catalog.sql:248-266` |
| S4 | **Critical (ops)** | Live `SUPABASE_SERVICE_ROLE_KEY` (full RLS bypass) + `SUPABASE_ACCESS_TOKEN` (Management API, full SQL) on disk in `.env` — untracked, but one host/backup leak is total DB compromise | `.env` lines 3,5,15 |
| S5 | **High** | PostgREST filter injection: raw URL terms interpolated into `.or()` strings, violating the project's own `postgrest.ts` guard convention | `app/routes/admin/customers.tsx:52`; `app/routes/admin/orders.tsx:64`; `app/features/media/server-api.ts:45,50` |
| S6 | **High** | Zero security headers: no CSP / X-Frame-Options / HSTS / Referrer-Policy / Permissions-Policy on any response (no `entry.server.ts` customization) | `app/root.tsx` (renders whole document, no headers); only `nosniff` on `api/media.ts:32` |
| S7 | **Medium** | No app-level rate limiting; OTP resend cooldown is a **client-side UI timer** only (`app/features/auth/otp.ts:3`); `/api/coupon`, search, login rely wholly on Supabase Auth throttles | `app/routes/auth/verify.tsx:60-66` |
| S8 | **Medium** | Staff RBAC panel-granular at UI layer; fine-grained `can()` only inside RPCs | `app/lib/permissions.ts:31-40` |
| S9 | **Medium** | Email HTML injection: `renderTemplate()` substitutes `{{vars}}` into admin-editable templates without HTML-escaping (order names/phones flow in) | `app/lib/email/server.ts:35-40` |
| S10 | **Low** | `auth/verify.tsx:96-102` promotes signup→vendor from user metadata after OTP — metadata origin is app-controlled OTP flow, but deserves a comment/audit trail | `app/routes/auth/verify.tsx:96-102` |
| S11 | **Low** | Edge function CORS falls back to `Access-Control-Allow-Origin: "*"` if `SITE_URL` unset (auth inside is correct) | `supabase/functions/admin-update-bucket/index.ts:8` |
| S12 | **Low** | CSRF: no tokens anywhere; mitigations = SameSite=Lax + POST-only logout + action semantics; no Origin/Sec-Fetch-Site verification on state-changing actions | project-wide |

## OWASP Top 10 mapping

- **A01 Broken Access Control** → S1 (anon RPC), S8 · **A03 Injection** → S2 (XSS), S5 (PostgREST), S9 (email HTML) · **A04 Insecure Design** → S7 (no rate limits) · **A05 Misconfiguration** → S3 (uploads), S6 (headers), S11 (CORS) · **A07 Auth failures** → S7, S10 · **A08 Data integrity** → covered (HMAC webhooks, idempotent RPCs) · **A09 Logging** → partial (tagged console errors, no structured logging) · **A10 SSRF** → not applicable (no server-side URL fetching of user input found).
