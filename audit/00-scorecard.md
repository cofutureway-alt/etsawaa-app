# Etsawaa — Code Quality Audit Scorecard

**Date:** 2026-11-03 · **Scope:** `Main App Etsawaa` (~230 app source files, 37 SQL migrations, 16 test suites)
**Stack:** React Router 7 (framework mode, SSR) · React 19 · TypeScript 5.9 strict · Supabase (PostgREST + RLS + RPCs) · Tailwind v4 · i18next (ar/en) · zod 4

---

## Overall Weighted Score

| Dimension | Audit | **Post-fix** | Weight | Weighted (post-fix) |
|---|---:|---:|---:|---:|
| Security | 5.0 / 10 | **8.5 / 10** | 30% | 2.55 |
| Clean Architecture | 8.0 / 10 | **9.0 / 10** | 20% | 1.80 |
| Maintainability | 7.5 / 10 | **9.0 / 10** | 20% | 1.80 |
| Code Quality | 7.5 / 10 | **8.5 / 10** | 15% | 1.28 |
| Performance | 7.5 / 10 | **8.5 / 10** | 15% | 1.28 |
| **Overall** | **6.9 / 10** | **8.7 / 10** | | |

> Weights reflect a production e-commerce platform: security dominates, architecture/maintainability next, quality/performance equal. Detailed justification per dimension in `01`–`05`. Every fix and its verification evidence is in `06-fix-log.md`; all fixes are applied and gated by the repo's own verify suite (tsc strict, oxlint, 107 unit tests, client+SSR builds) plus a live production smoke test.

**Baseline verify (before fixes):** see `06-fix-log.md` for the `npm run verify` output snapshot.

---

## Top 5 Critical Issues (ranked by priority)

### 1. Unauthenticated coupon oracle with client-trusted prices — **Critical**

**Status: FIXED** — server-side price recompute + service client + zod + rate limit; anon grant revoked in applied migration `20261103000012` (verified live: anon RPC → 42501).
- `app/routes/api/coupon.ts:14-23` forwards client-supplied `unit_price_piastres`, `qty`, `on_sale`, `vendor_id`, `commission_bps` straight into `fn_apply_coupon`.
- Migration `supabase/migrations/20261103000001_fix_coupon_anon_and_fn_guards.sql` **grants `execute` to `anon`** so guests can preview coupons.
- Combined: any anonymous caller can enumerate coupon codes (validity/reason leakage: `min_subtotal|limit|not_eligible`) and compute a working discount against **inflated client prices**. In-app the display-only path is harmless; a direct PostgREST caller gets a discount calculator.
- **Fix:** zod-validate the body; recompute lines server-side from DB prices (mirror `fn_create_order`'s server-built lines); revoke `anon` execute; route calls RPC via service client after server-side recompute.

### 2. Stored XSS via blog HTML + zero security headers — **Critical**

**Status: FIXED** — isomorphic-dompurify sanitization at render + site-wide security headers/CSP (verified live on responses).
- `app/routes/blog.$slug.tsx:274` renders `content_ar/en` with `dangerouslySetInnerHTML`; `withHeadingIds()` (`:51-59`) only injects ids — no sanitization, no DOMPurify anywhere in the project. Anyone who can edit `blog_posts` (admin/staff) can persist script.
- No `entry.server.ts` customization, no CSP / `X-Frame-Options` / HSTS / `Referrer-Policy` / `Permissions-Policy` on any response (`app/root.tsx` renders the whole document with none). Only `nosniff` exists on the media proxy.
- **Fix:** add `isomorphic-dompurify` and sanitize at render; export site-wide security headers from `app/root.tsx` (CSP allowing inline *style* only, required by the DB-driven design-token injection at `root.tsx:83`).

### 3. Unvalidated file uploads to the public bucket — **Critical**

**Status: FIXED** — server-side validateUpload + bucket allowlist (app layer) + allowed_mime_types/size limits on both buckets (applied migration, verified live).
- `app/routes/api/media-library.ts:98-108` accepts any `file instanceof File`, never calls the existing `validateUpload()` (`app/lib/media.shared.ts:58-66`, which exists but is client-side only), and takes `bucket` from the form with **no allowlist**.
- Bucket config (`20261031000000_phase02_media_catalog.sql:248-255`) sets a 50 MB size limit but **no `allowed_mime_types`** → any authenticated user can host arbitrary content (phishing/malware hosting, stored-XSS-adjacent on the storage origin).
- **Fix:** enforce `validateUpload()` + dimension checks server-side; bucket allowlist `media|documents`; set `allowed_mime_types` on both buckets via migration.

### 4. Live high-privilege secrets on disk — **Critical (ops)**

**Status: OPS ACTION** — rotation instructions in `06-fix-log.md`; no hardcoded secrets in source (verified).
- `.env` (repo root, properly git-ignored) holds a live `SUPABASE_SERVICE_ROLE_KEY` (full RLS bypass) **and** `SUPABASE_ACCESS_TOKEN` (Management API — full SQL access to the project). One build-host leak, backup, or zip is total DB compromise.
- No hardcoded secrets in source (verified by scan — all usage flows through `app/lib/env.server.ts`); `vite.config.ts:19-29` deliberately avoids exposing the service key to the client. The discipline is good; the residual risk is purely disk/ops.
- **Fix (ops action):** rotate both keys; store in a secret manager; scope the access token; never leave it in `.env` on shared machines.

### 5. PostgREST filter injection in admin search — **High**

**Status: FIXED** — safeLikeTerm/isSafeFilterValue guards at all flagged sites + app-level rate limiting added to coupon/login/OTP.
- `app/routes/admin/customers.tsx:52`, `app/routes/admin/orders.tsx:64`, `app/features/media/server-api.ts:45,50` interpolate raw URL terms into PostgREST `.or()` filter strings, violating the project's own guard convention (`app/lib/postgrest.ts` `safeSlug`/`safeLikeTerm`, documented at `:1-13`).
- Impact is predicate rewriting / error-based probing (RLS still applies — no row escalation), but it contradicts the codebase's own rule and enables 400-noise DoS.
- **Fix:** route every interpolated term through the existing guards. Related gap: no app-level rate limiting anywhere (OTP cooldown is client-side only, `app/features/auth/otp.ts:3`).

---

## What's unusually good (worth keeping)

- **Layering discipline:** `routes → features → lib → supabase`, zero cycles, `.server.ts` convention, request-scoped Supabase clients, httpOnly/Lax/secure cookies, timing-safe webhook HMAC verification, `safeNext()` open-redirect guard (unit-tested).
- **Hygiene floor:** zero `TODO`/`FIXME`/`any`/`ts-ignore`/`console.log`/`debugger` across the whole app tree; strict TS with `noUncheckedIndexedAccess`; design-token gate in CI.
- **Money correctness:** integer piastres end-to-end, mirrored between TS helpers and SQL RPCs; order placement recomputes all prices server-side in `fn_create_order`.
- **Verification culture:** 16 node:test suites (~102 cases) + design scanner in CI; RLS audit script; per-phase evidence reports.
- **Perf care:** parallel loaders (47 `Promise.all` sites), immutable-cached same-origin image proxy with LRU, preconnects, self-hosted fonts, lazy drawers.

## Scorecard delta after fixes

See `06-fix-log.md` (updated as each wave lands) — final post-fix scores recorded there.
