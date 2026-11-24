# Fix Log

Running log of every fix applied, updated as each wave lands. Final post-fix scores at the bottom.

## Baseline verify (2026-11-03, before fixes)

`npm run verify` → **exit 0** (typegen + tsc strict + oxlint + 16 node:test suites (~102 cases) + vite build client/SSR + design scanner). Warnings only: 5 React Router v8 future-flag warnings; Vite chunking notes for mixed static/dynamic imports (`env.server.ts`, `ProductCard.tsx`, `supabase/admin.ts`, `kashier.server.ts`).

## Wave 1 — P0 Security ✅

**Gate:** typecheck clean · oxlint 0 errors · 107/107 tests (18 suites) · build OK · migration applied (HTTP 201) · RLS audit 4/5 (0 critical) · anon RPC revoke verified live (`permission denied for function fn_apply_coupon`) · bucket MIME allowlists verified live.

1. **Coupon oracle closed** — `app/routes/api/coupon.ts` rewritten: zod schema (`code` ≤40, 1–60 lines of `{product_id uuid, variant_id uuid, qty 1–99}`); prices/vendors/categories/on-sale recomputed server-side via new `priceCouponLines()` in `app/features/checkout/pricing.server.ts` (same rules as `fn_create_order`: sale window → event discount → listability); RPC now runs via the service client; fixed-window rate limit (20/min per IP).
2. **Migration `supabase/migrations/20261103000012_security_hardening.sql` applied** — revoked `anon` execute on `fn_apply_coupon` (verified: anon PostgREST call → 42501); `storage.buckets` gained `allowed_mime_types` (media: jpeg/png/webp/gif/mp4/webm/quicktime/pdf; documents: jpeg/png/webp/gif/pdf) + explicit size limits (50 MB media / 10 MB documents) — both verified live.
3. **Client coupon call slimmed** — `app/features/cart/api.ts` `applyCoupon` now sends only `{product_id, variant_id, qty}`.
4. **Upload validation enforced server-side** (`app/routes/api/media-library.ts`, `app/features/media/server-api.ts`) — bucket allowlist `media|documents`, DB-backed `MediaSettings` + `validateUpload()` on every upload at both route and feature layer (defense in depth), `?self=`/folder-id `isSafeFilterValue` guards, search via `safeLikeTerm`. New `tests/media-server-guard.test.ts` (9 cases).
5. **Stored XSS fixed** — new `app/lib/sanitize.ts` (isomorphic-dompurify wrapper, restrictive tag/attr allowlist, ids/classes preserved); `app/routes/blog.$slug.tsx` sanitizes before `dangerouslySetInnerHTML`. New `tests/sanitize.test.ts`.
6. **Security headers** — `app/root.tsx` now exports site-wide `headers()`: CSP (script/style `'self' 'unsafe-inline'` — inline needed for RR7 hydration + DB design tokens; nonce upgrade path documented), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (geolocation=self — MapPin uses it), HSTS, `X-Frame-Options: DENY`; CSP includes Supabase origin + wss (Realtime) + `photon.komoot.io` (client-side reverse geocoding).
7. **PostgREST filter injection closed** — `admin/orders.tsx` guarded via `safeLikeTerm` (`admin/customers.tsx` was already guarded in HEAD; verified), `app/features/media/server-api.ts` refusals before query.
8. **Email injection fixed** — `app/lib/email/server.ts` `renderTemplate` HTML-escapes substituted values.
9. **App-level rate limiting** — new `app/lib/rate-limit.server.ts`; applied to `/api/coupon` (20/min), login (10/5min), OTP resend (3/5min). Both auth routes previously relied solely on Supabase throttles.
10. `tests/sanitize.test.ts` + `tests/media-server-guard.test.ts` wired into the `test` script / CI.

**Note (pre-existing, observed during gate):** `scripts/rls-audit.mjs` probe errors with `forbidden_admin_only` at the vendor-onboard step — caused by the Nov-3 RPC guard batch, not this migration. The audit script's probe flow needs updating (out of scope here).

## Wave 2 — Bugs & Performance

- [ ] pending

## Wave 2 — Bugs & Performance ✅

**Gate:** typecheck clean · oxlint 0 errors · 107/107 tests · build OK.

1. **N+1 eliminated** — `app/routes/compare.tsx` loader now batches both products' facet options in ONE `.in("option_id", ids)` query (was one round trip per option); loader/component shapes unchanged.
2. **Media LRU bounded** — `app/lib/media-cache.server.ts`: 2 MB per-item cap (video streams served, never cached), 64 MB total budget, O(1) Map-order eviction replacing the O(n) `shift()`; 120-item ceiling kept; public API unchanged.
3. **Root loader TTL cache** — `app/features/settings/api.ts`: 60 s in-process TTL + single-flight for `loadPublicSettings` (was one PostgREST hit per request site-wide); `saveSettings` invalidates; degraded reads cached deliberately.
4. **Unhandled promises** — `CartDrawer.tsx` + `cart.tsx` guest-detail fetches now `.catch`-fall back to raw lines. `NotificationBell.tsx` verified safe as-is (internal try/catch).
5. **EvidenceUploader** — one `auth.getUser()` per batch (was per file, up to 5×); uploads parallelized via `Promise.all`.
6. **ReorderButton left sequential deliberately** — verified `cart.add` is a read-modify-write on localStorage for guests and a `setLines(res.lines)` overwrite for members; parallelizing would lose updates. Not a bug.
7. `admin/levels.tsx` JSON deep-clone → `structuredClone`; `breadcrumbLd` return type annotated (`app/lib/seo.ts`).

## Wave 3 — Mechanical quality ✅

**Gate:** typecheck clean · oxlint 0 errors · 107/107 tests · build OK.

1. **i18n ternaries converted: 84 sites across 32 files** (56 in pass one + 28 in the residue pass, including a raw Arabic-only string in `vendor/dashboard.tsx`); **75+ new keys** added to both `ar.ts`/`en.ts` (parity enforced at 2063=2063 by `tests/i18n-keys.test.ts`); existing keys reused where values matched. Remaining `en ?`/`lang === "ar" ?` matches are locale-logic branches (locale codes, date/number formats, join separators) and DB-field selects — not copy. `root.tsx`'s standalone error-page COPY object intentionally kept.
2. **41 `as unknown as` casts → single audited chokepoint** — new `app/lib/supabase/typed.ts` (`asRows<T>`/`asRow<T>` with `Array.isArray` runtime check + optional guard); `features/orders/api.ts` fully converted (7 casts); `admin/customers.tsx` + `admin/coupons.tsx` converted and `customers` `select("*")` narrowed to the 7 consumed columns.
3. **Hook-deps suppressions resolved (all 17)** — 8 properly fixed (fetcher-toast effects gained their stable deps in admin/vendors, admin/products, vendor/products, vendor/store, product-wizard ×3; variants/template + value/categories syncs), 9 kept as deliberate with explanatory comments (checkout prefill/quote ref-guards ×3, autosave debounce, addresses exactly-once init, MapPin mount-once, plus the agent-fixed toast effects documented in place).
4. **Doc drift fixed** — `docs/AGENT.md` stack table now reflects reality (React 19, RR7 framework SSR, no TanStack Query/Framer Motion; CSS transitions; adds dropzone/leaflet/bwip-js rows); `NotificationBell.tsx` stale TanStack comment rewritten to the actual 20 s interval + Realtime mechanism.
5. Blog SEO note: Arabic blog meta title suffix now uses `app.name` ("— اتسوء") instead of hardcoded "— Etsawaa".

## Wave 4 — Refactors

- [ ] pending

## Wave 4 — Refactors ✅

**Gate:** typecheck clean · oxlint 0 errors · 107/107 tests · build OK · live smoke test passed.

1. **All 7 god-files split, zero behavior change** (route-module exports kept in place; every WHY comment moved with its code):
   | File | Before | After | Extracted to |
   |---|---:|---:|---|
   | `routes/vendor/onboarding.tsx` | 1147 | 188 | `features/vendor/onboarding/` — server.ts, useOnboarding.ts, step-shell + 5 step components + done screen |
   | `features/products/components/product-wizard.tsx` | 1105 | 415 | `wizard/` — 13 files (types, helpers, validate-step, 5 step components, category-picker, attribute-field, header, banners, dialogs) |
   | `routes/checkout.tsx` | 933 | 293 | `features/checkout/` (checkout.server, useCheckoutQuote, useCheckoutAddressForm, types) + `components/checkout/` (4 step sections, OrderSummary, StepHeader, CheckoutNotices, GuestGate, money) |
   | `features/media/components/media-ui.tsx` | 790 | 19 (barrel) | 8 files — MediaImage, MediaLibraryCore, MediaPickerDialog, content/folder-tree/upload/dialogs/shared (all export paths preserved) |
   | `routes/admin/order-detail.tsx` | 736 | 178 | `components/admin/orders/` — 8 cards (header, vendor-group cards, timeline, notes, financial, delivery, print center, shared) |
   | `routes/admin/catalog/attributes.tsx` | 721 | 330 | `components/admin/catalog/` — shared types + form, list, preview, leaf picker, 5 dialogs |
   | `layouts/public.tsx` | 713 | 113 | `components/layout/public/` — header, categories menu, user menu, nav drawer, footer, shared |
2. **Component→feature inversion resolved** — `CartDrawer` physically moved to `features/cart/components/` (importer updated); 9 remaining feature imports documented as deliberate exceptions at the import site (feature-owned hooks/logic); 17 type-only imports left per house constraint; grep confirms no stale paths.
3. **Live smoke test (production build, `npm start`)** — `/ar` 200 with full SSR + hydration manifest; all 6 security headers present on responses; `/api/coupon` hardened endpoint verified live: invalid body → 400 `bad_request`, valid-shape unknown ids → 200 `not_eligible`; `/ar/products`, `/ar/cart`, `/ar/checkout`, `/ar/compare`, `/en/products`, sitemap, robots all 200.
4. **One schema refinement found by the smoke test** — zod 4's `.uuid()` enforces RFC 9562 nibbles (stricter than Postgres); replaced with a Postgres-compatible 8-4-4-12 hex regex in `api/coupon.ts` so valid DB ids are never falsely rejected (a well-formed-but-unknown id still safely yields `not_eligible`).

## Final gate (2026-11-03)

`npm run verify` → **all green**: typegen + tsc strict 0 errors · oxlint **0 errors** (36 pre-existing-style warnings, down from 38) · **107/107 tests** across 18 suites · client + SSR builds ✓.

## Ops actions for the owner (not code)

- **Rotate `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN`** — both are live high-privilege secrets currently in `.env` on disk. Move to a secret manager; scope the access token; keep only the minimum in `.env`.
- Review the two `script + service-role` powered harnesses (`shot.mjs`, `scripts/test-phase*.mjs`) before sharing the workspace.
- `scripts/rls-audit.mjs` probe flow needs updating for the Nov-3 RPC guard batch (probe fails at vendor-onboard with `forbidden_admin_only`; audit itself reports 0 critical).

## Post-fix scores

| Dimension | Before | After | What moved |
|---|---:|---:|---|
| Security | 5.0 | **8.5** | Coupon oracle closed (server-side pricing + anon revoke, verified live), XSS sanitized, uploads validated server-side + bucket MIME allowlists live, security headers + CSP live, filter injection closed, email escaping, app-level rate limiting |
| Clean Architecture | 8.0 | **9.0** | All god-files decomposed along feature boundaries, inversion resolved (moved + documented), typed Supabase boundary chokepoint |
| Maintainability | 7.5 | **9.0** | No file over ~420 lines in the previously-flagged set, i18n fully unified (84 conversions), doc drift fixed |
| Code Quality | 7.5 | **8.5** | `as unknown as` centralized into one audited chokepoint, all 17 hook-deps suppressions resolved or documented, structuredClone, return types |
| Performance | 7.5 | **8.5** | N+1 eliminated, bounded O(1) LRU, root-loader TTL cache + single-flight, batched uploads, unhandled promises fixed |
| **Weighted overall** | **6.9** | **8.7** | (30/20/20/15/15 weights) |

Remaining known gaps (documented, accepted): CSP `script-src` still needs `'unsafe-inline'` for RR7 hydration (nonce upgrade path documented in `root.tsx`); rate limiting is in-memory per instance (multi-instance deploys need a shared store); ReorderButton stays sequential by design (cart write semantics); zero component tests (unit + manual E2E scripts cover the rest).

## Review follow-up (2026-11-03) — corrections to Waves 1–4

**Gate:** typecheck clean · oxlint 0 errors · 113/113 tests (19 suites) · build OK. Migration `20261103000013` written, **not applied**.

1. **Rate limiter** (`app/lib/rate-limit.server.ts`) — the leftmost `X-Forwarded-For` entry was client-forgeable, and without a proxy every visitor shared one `"direct"` bucket (10 logins / 5 min site-wide). `clientKey()` now trusts only `TRUSTED_PROXY_HOPS` proxy hops and returns `null` otherwise; the map is hard-capped (oldest buckets evicted). Login counts **failures only**, per account (10 / 15 min) plus per IP when trusted (50 / 15 min); OTP resend is keyed per email (+ IP when trusted); the coupon preview per user, per trusted IP, or a 600/min shared guest ceiling. Login now shows `auth.login.rateLimited` instead of the generic error. New `tests/rate-limit.test.ts`.
2. **Coupon preview per-user limits** — running `fn_apply_coupon` via the service client made `auth.uid()` null, so `max_uses_per_user` was never checked. Signed-in callers now run it under their own session; guests keep the service client. Pricing errors return `query_failed` JSON, and the new reasons have cart messages. Still open: `authenticated` can call the RPC directly with invented prices (code-enumeration only; `fn_create_order` re-prices).
3. **Checkout quote** — `useCheckoutQuote` now re-quotes when `selectedGovId` changes (switching saved addresses kept the old governorate's shipping/COD).
4. **Email subjects** — new `renderSubject()` (plain text, CR/LF collapsed); HTML escaping stays for bodies only.
5. **Bucket alignment** — KYC uploads are clamped to `DOCUMENTS_BUCKET_MAX_MB` (10) and only write the `vendor_documents` row after a 2xx from Storage. Migration `20261103000013_media_bucket_avif.sql` adds `image/avif` (offered by admin media settings) to the `media` bucket allowlist.
6. **Store page** — "store has no products" now uses the unfiltered count, so the zero-results-with-filters state (and its clear-filters link) is reachable.
7. **Media physical delete** — the server reads the row by id under RLS instead of trusting a client-sent row; the client keeps the usage list on `in_use`, and other failures no longer show "in use in 0 places".

## Browser-session uploads moved server-side (2026-11-03)

**Gate:** typecheck clean · oxlint 0 errors · 113/113 tests · build OK. Not exercised against the live project.

The auth cookie is httpOnly, so the browser Supabase client never has a session; four features still called Storage/RPCs from the browser and could never succeed. They now go through routes that run under the request cookie:

- **New `POST /api/upload`** (`app/routes/api/upload.ts`): `op=image` (avatar → `media`, refund evidence → `documents`; jpeg/png/webp ≤ 5 MB) and `op=vendorDocument` (KYC → `documents` + `vendor_documents` upsert; the vendor comes from the session, type/size re-checked against `fn_vendor_config` clamped to the 10 MB bucket cap; the object is removed if the row write fails).
- `AvatarField`, `EvidenceUploader` and the onboarding step-3 `DocumentUploader` use it (`app/features/account/client.ts`; KYC keeps XHR upload progress).
- KYC "open" links use `GET /api/document?path=…&redirect=1` (new redirect mode; same RLS-checked 60 s signed URL).
- **New `GET /api/attribute-usage?id=`** replaces the browser `fn_attribute_usage` call in admin attributes.
- Remaining browser-client user: `NotificationBell`'s Realtime subscription (likely receives nothing as anon; the 20 s polling keeps the badge correct).

## Self-hosted Supabase deployment (suba.fakarli.com, 2026-11-03)

- `.env` now targets the VPS instance (legacy anon/service_role JWTs; verified against the server's own keys by hash). Old hosted values kept in `.env.hosted.bak` (gitignored).
- **Migrations:** all 39 files applied in order as `postgres` via `/root/etsawaa-migrations/apply.sh` on the VPS (`docker exec supabase-db psql`), each recorded in `supabase_migrations.schema_migrations`; re-running skips applied versions. Base `supabase/seed/seed.sql` applied (roles, settings, 27 governorates / 76 areas, 7 email templates). QA seed not loaded.
- **Edge function** `admin-update-bucket` deployed to `/opt/supabase/volumes/functions/`. Fixed: it now updates only the `media` bucket (it used to overwrite the private `documents` bucket with media settings, which would have rejected KYC PDFs), and the media-settings save sends the admin's access token (it sent the anon key → 401 on every save).
- **New migration `20261103000014_kyc_and_usage_guards.sql`:** vendors can no longer INSERT `status`/review columns on `vendor_documents` (self-verification via PostgREST); replacing a document file resets it to `pending`; `fn_attribute_usage`/`fn_attribute_option_usage` now require `is_admin()`. `/api/upload` replaces the upsert (which needed UPDATE on every column and always failed) with insert-or-update and deletes the replaced object.
- `scripts/rls-test-suite.sql` assertion 4 updated: `media` is in the public settings allowlist by design (`is_public_setting_key`). Suite: **14/14** (run inside a rolled-back transaction).
- **End-to-end (local production build → VPS): 55/55** — public pages, security headers/CSP, guest guards, coupon preview (guest + signed-in), customer avatar + refund evidence + signed URLs, vendor onboarding draft + KYC upload/replace, admin panels, media library upload/list/delete, attribute usage, media-settings edge function. All test users/objects/rows removed afterwards.
- **Open (server config, needs the owner):** GoTrue has `ENABLE_EMAIL_AUTOCONFIRM=true` and `SMTP_HOST=supabase-mail` (a dev mail catcher that is not running), so no signup OTP or password-reset email can be sent; the app's register → OTP → verify flow (and vendor-intent promotion on verify) needs real SMTP, autoconfirm off, and a confirmation template containing `{{ .Token }}`. `GOTRUE_SITE_URL` / `ADDITIONAL_REDIRECT_URLS` should be set to the app's public URL once known.

## Phase 09 — data migrated into the live catalog (2026-11-03)

**Source:** `data/normalized/*.json` (copied from `etsawaa V4/plans/phase-09-data`). **Applied to:** suba.fakarli.com. **Gate:** reconcile 100% · re-run = no-op (0 rows inserted or rewritten) · RLS 14/14 · regression e2e 55/55 · catalog e2e 26/26 · verify (117 tests, build) green.

**Model** (migration `20261103000015_catalog_types_dictionary.sql`) — fitted onto the existing catalog machinery so every existing screen manages the data, no parallel tables:
- L1 → L2 → L3 browse categories (10 / 38 / 170) → **L4 product type** (1,354 types, 1,391 placements; the 35 types listed under two L3s get a node under each). Depth cap 3 → 4; header menus still show L1–L3.
- **Global spec dictionary**: `attribute_defs.category_id` NULL = shared attribute (1,269 from specs.json, Brand excluded + 70 fields the family templates use that the dictionary lacked — Arabic labels for those 70 were translated for this import, please review). One spec = one row: an admin edit reaches every type.
- **Template** of a type = `category_attributes` rows (12,158 links, 5–18 fields each, template order kept); the wizard, `fn_attr_in_template`, `fn_save_product` and variant generation already honour links.
- **Variant axes**: Color (type color, 23 options with hex) and Size (enum, 28 options: apparel XXS–5XL, Free Size, EU 35–47, bedding) — filterable, admin-editable dictionaries. Storage/RAM/Capacity stay numeric specs (no source values); an admin can convert them later.
- **Subtree rules**: coupon scopes, event discounts (SQL + `pricing.server.ts` mirror) and vendor commission overrides on an L1–L3 node now cover its product types (`fn_category_within`). Commissions already walked ancestors.
- Facets: global attributes surface per leaf; `fn_search_products` de-duplicates; `fn_storefront_facet_defs(category)` feeds the listing loader.
- `categories.source_key` (stable import key) and a unique area name per governorate.

**Import** (`scripts/build-catalog-import.mjs` → `supabase/seed/catalog-import.sql`, one transaction, ON CONFLICT DO NOTHING on natural keys, reconcile-or-rollback): categories 10/38/170/1,391 · 1,339 dictionary specs · 51 options · 12,158 links · 27 governorates at 100 EGP · 570 areas at 20 EGP (2 in-governorate duplicates rejected: Cairo/الجمالية, Matrouh/مرسى مطروح). The 63 placeholder areas that match the master list were adopted; the other 13 were deactivated (`supabase/seed/catalog-import-cleanup.sql`). Report: `data/catalog-import-report.json`.

**App changes for a 1,600-node catalog:** `fetchAll()` pages every whole-table read (PostgREST silently caps responses at 1,000 rows): admin categories / attributes / events, vendor wizard, sitemap, `getCategories`. Menus/home load depth ≤ 3, onboarding/store/sell depth ≤ 2, listing breadcrumbs via the node's own path. Cascading category picker (any depth). Admin attribute leaf picker: one-pass counts (was ~22 billion comparisons with this data), search, parent name. Template order follows the link sort in the wizard and admin.

**Also fixed (pre-existing):** migration `20261103000016` — the catalog audit trigger read `new.id` on `category_attributes` (no id column), so admins could never link/unlink an attribute.

**Not used any more:** the staging pipeline (`scripts/import-phase09.mjs`, `staging_*` tables, admin Data Import pages, `fn_admin_publish_batch` which always refuses with `publish_deferred_D16`). Left in place; safe to remove later.

**Admin account:** `mo22menmo7ammed@gmail.com` (Moamen Mohammed, +201050073086), role admin, email confirmed.

## Critical DB holes closed (2026-11-04)

Found during the remediation audit (`07-remediation-plan.md`, SEC-01/SEC-02), both reproduced live with the public anon key before the fix.

- **Writable views (SEC-01).** Supabase default privileges had granted INSERT/UPDATE/DELETE on every view to `anon`/`authenticated`; `v_storefront_categories` is auto-updatable and runs as its owner, so an anonymous `PATCH /rest/v1/v_storefront_categories` rewrote categories past RLS. Migration `20261104000000_close_view_writes_and_phone_lookup.sql` revokes all client writes on `public` views and changes postgres's default privileges so new relations no longer inherit client write grants (new client-writable tables must grant explicitly — every existing migration already does).
- **Phone → email lookup (SEC-02).** `fn_resolve_email_from_phone` was anon-executable and returned the account email for any phone. Now `service_role` only. New `app/features/auth/phone-email.server.ts` does the lookup with the service client; `auth/login.tsx` uses it after the rate-limit check; `auth/forgot.tsx` uses it and no longer sends the email to the browser (the code step posts back the typed identifier, resolved again server-side).

**Verified:** anon and authenticated get `42501 permission denied` for the view write and the RPC (SQL as each role, and real HTTP with the anon key); `service_role` still resolves; storefront reads unchanged (1,609 categories, facets 1,711 rows); 0 client write grants left on views; `contact_messages` anon INSERT unaffected. `npm run verify` green (117/117). Browser: forgot-password with an unknown phone shows "no registered email"; server-side lookup resolves a registered phone. Not done in the browser: a successful phone login (needs the admin password) and a full reset email (SMTP not configured — CFG-01).

## Admin redesign + EGP + levels/badges + users (2026-11-04)

**Money in pounds.** Every admin/vendor price field takes EGP (`1` = 1 EGP, `1.5` = 1 EGP 50 pt); storage stays integer piastres. Helpers `egpToPiastres` / `signedEgpToPiastres` / `piastresToEgp` in `app/lib/money.ts` (tested). Converted: ads, coupons, fines, refunds, zones (+CSV `pickup_fee_egp`), shipping share, settings (min withdrawal, COD cap), vendor penalty, wallet adjustment, vendor withdrawal.

**Pages.** Shipping: withdrawals box removed. Ads: header "New package" → popup (create/edit), store picker for grants, visibility incl. reward-only packages. Banners: header button → popup with working media picker + preview cards; dates are Cairo calendar days (end date = end of that day); hero banners now link, auto-rotate, larger dots. Data Import removed (routes, pages, reject-ledger API, nav, i18n; script archived; `staging_*` tables kept). Attributes: 30 product types per page, server-side search via `fn_admin_leaf_page`; the editor loads only the open type's attributes. Fines: redesigned (stats, tables, popups for new/edit/delete/waive), EGP, "Operator" → "Reason for fine", new "Responsible" (admin/staff) per rule. Customers page removed; Users & roles rebuilt (role totals, filters, avatars, ban/unban, hide/show a seller's products) with a profile page per user (`/admin/users/:id`; sellers: personal, store with per-category commission + manual level + badges, statistics incl. delivery performance, orders, withdrawals + ledger, finance; customers: account + addresses, orders, statistics).

**Levels & badges** (`20261104000003`, `…04`): goals shared by levels and badges (successful orders, ratings ≥ N★, withdrawals, products, membership days/months/years); level rewards (ad package once on reaching, N home-featured products, commission reduction in points across all categories); icon library + colour; hourly `pg_cron` evaluation + "Recalculate now"; stores only move up automatically. Badges show as compact icons on the store page; seller dashboard shows level, progress to the next level, badges and active rewards; sellers pin featured products with the star on their products list.

**Fixed along the way.**
- Order commission ignored per-store category overrides and fixed mode — `fn_vendor_line_commission` is now the single source used by `fn_create_order`.
- Ban/unban never worked (direct `profiles` update refused by RLS/column grants) — `fn_admin_set_user_status` also blocks sign-in and ends sessions.
- SEC-03: vendors could write platform-owned product columns — guard trigger `trg_products_guard_privileged`.
- UI-11: admins without a store are sent to Admin → Vendors instead of seller onboarding.

**Verified:** typecheck, 118/118 tests, build; engine tested in rolled-back SQL (promotion, 5% → 4% commission, 3 featured slots, badge award, idempotent re-run, anon refused); ban/hide/overview RPCs tested the same way; every changed admin page and each "New …" popup opened in Chrome with no errors; removed pages return 404.

## Storefront redesign (2026-11-04)

Migration `20261104000006`: `categories.icon`, `brands.description_ar/en`; storefront views expose them, and "featured" now also covers ad-promoted products (active featured-product campaign) and stores (any active campaign / featured flags). Category icon library `app/components/catalog/CategoryIcon.tsx` (admin picker in the category editor; the 10 top-level categories got default icons). Admin brands: description fields. New `Carousel` (scroll-snap, RTL-aware). Home: hero panel + mega menu show category icons; assurance strip desktop-only; event ("White Friday") block removed; sections now All categories (image cards, carousel) → Our best products (featured + promoted, topped up to 10 with regular products when fewer than 5, regulars never marked featured) → Brands → Stores (featured/promoted first) → Recently added (20, grid). Brand page: logo + description intro. Category page: duplicate header removed, sub-categories as a compact chip carousel, false "1 filter active" fixed. Filters: colour swatches, size chips, long lists collapse after 6, zero-count options hidden, collapsible sections. Contact page redesigned. Verified at 1366 px and 390 px (ar/en): no overflow, no page errors; 118/118 tests, build OK.

## Child products, verification, moderation, seller tools (2026-11-04)

Migrations `20261104000007`–`20261104000015`:
- **Child products** (07–08): colour groups with their own price, discount and window, and images. Sizes are per-size variants with stock and an auto SKU. Size types are assigned to categories. Existing products were migrated. Cards show colour swatches.
- **Structured attributes** (09): country, material, etc. are now searchable bilingual dropdowns.
- **Seller verification** (10): commercial register / tax card / national ID, with several images each. Each image is reviewed with a reason. `needs_changes`, back-to-pending at any time, and full status history. Rejection = suspension: the seller can sign in and read the reason, but every seller RPC and withdrawal approval is refused server-side.
- **Product review** (11): dedicated page `/admin/products/:id` with images, children, prices, stock, specs and history. Decisions: approve / approve with notes / reject (fixable) / reject permanently. Permanent rejection locks save, children and submit in the DB.
- **Store settings changes** (12): an active store's identity fields become change requests (old vs new). Admin queue `/admin/store-changes`; approve applies, reject requires a reason. A trigger refuses direct owner writes.
- **Events** (13): stores without an answer are now really enrolled. `v_active_event_vendors` previously required a row, so they got no discount. `fn_vendor_event_overview` gives phase, participation ("Not participating"), discounts per category/product and the max %.
- **Dashboard cards** (14): categories with commission, child-level low stock, best sellers, unsold for 10+ days.
- **fn_notify** (15): removed the in-body admin-only check. It made every seller- or customer-started flow that notifies (product submit, onboarding, cancel, refund, store-change request) fail with `forbidden_admin_only`. The function stays non-executable for users (grant).

UI:
- **Admin:**
  - Verification tab on the seller profile, with per-image approve/reject, status actions, suspend/reinstate and history.
  - The Stores list links to it instead of the popup.
- **Seller:**
  - Verification page.
  - Store Settings moved last, with a pending-changes diff.
  - Events redesign with an opt-out confirm.
  - Live-event notice and insight cards on the dashboard.
- **My Ads:** the 500 was caused by selecting a missing `starts_at` column (the column is `started_at`). The page was also redesigned (totals, campaign cards with time left, packages).

**Verified:**
- typecheck, 118/118 tests, build;
- SQL tests in rolled-back transactions (decisions, permanent lock, change request + approval, owner direct write refused, event overview, dashboard cards);
- `scripts/review-phase-screens.mjs`: 11 pages × 1280/390 all 200, with zero horizontal overflow. Temporary users and store were removed.

## Returns, packaging, pickup billing, legal documents (2026-11-04)

**Migrations 16–20 (applied on the VPS):**
- **`20261104000016_ledger_pickup_billing`**
  - **Ledger helpers are internal now.** `fn_post_transaction`, `fn_post_earnings` and `fn_post_pickup_fee` are guarded by grants, not by an admin-only caller check. That check made a seller's "handed to carrier" fail at the pickup-fee step.
  - **Idempotency key changed** to (vendor, type, reference), and a `meta` jsonb column was added.
  - **Commission was deducted twice.** The earning was already net of commission, and then a commission debit was posted as well. Now the earning is gross, the commission is debited, both are held as pending, and the release moves the net.
  - **Pickup billing.** New `pickup_charges` table; `settings.pickup.billing_mode` is per shipment or per product. Vendor-shipped groups are no longer charged.
- **`20261104000017_partial_returns_refunds`**
  - **One engine (`fn_refund_apply`)** for admin-created (`fn_admin_create_return`) and buyer-requested returns:
    - per line: quantity and amount caps;
    - per seller: earnings reversal, commission share, and a vendor-fault penalty plus return pickup fee;
    - restock on receipt (`fn_admin_return_received`);
    - the refund is executed with a method and reference, and `orders.payment_status` becomes `partially_refunded` / `refunded`;
    - history in `refund_events`.
  - **Fixed in the old decide function:** it restocked the whole purchased quantity and booked every vendor-fault charge on one seller.
- **`20261104000018_packaging`**
  - Tables for the catalog, orders, items, payments, balances, returns and events.
  - Full and 50% plans; card webhook and admin-recorded payments; COD collected on delivery; cancel with refund; returns that reduce the open balance first.
  - The balance is collected once, from `fn_post_earnings`.
  - Price sheet imported: 14 items.
- **`20261104000019_legal_documents`**
  - Versioned `legal_documents` and `legal_acceptances`.
  - Terms v2.0 imported from the uploaded `.docx` files (22 sections and 95 clauses, Arabic and English matched).
  - Seller agreement v1.0, taken from the existing wizard text.
  - Acceptance is recorded at sign-up (trigger) and at onboarding (trigger), and store approval requires it.
- **`20261104000020_legal_status_scope`**: the seller gate applies only to stores past onboarding.

**App:**
- **Admin:**
  - order page "Returns & refunds" panel;
  - refunds queue: receive, method and reference, shipping refund and deduction;
  - settings: Pickup fees and Packaging sections;
  - `/admin/packaging`, `/admin/packaging/orders` and `/admin/packaging/orders/:number`;
  - `/admin/legal`.
- **Seller:**
  - `/vendor/packaging` and its orders pages;
  - wallet shows the open balance and the pickup breakdown;
  - `/vendor/agreement`.
- **Public and account:**
  - `/legal/terms`, `/legal/seller-agreement` and `/legal/accept` (mandatory gate in `requirePanelAccess`, checkout loader and place action);
  - register and Google completion record the version;
  - profile lists the accepted documents.
- **Shared:**
  - printable packaging invoice, label and return label at `/packaging/:number/print/:doc`;
  - Kashier webhook routes `PKG-` numbers to `fn_confirm_packaging_payment`.
- **Reference:** `docs/order-lifecycle.md` explains the whole flow for buyer, seller and admin.

**Verified:**
- typecheck, 124/124 tests (6 new: `tests/refund-packaging-math.test.ts`), build;
- **SQL tests in rolled-back transactions:**
  - two-seller order: per-product and per-shipment pickup, seller actor, retry with no double charge;
  - partial returns: quantity and amount caps, vendor fault and penalty, restock of the exact quantity, execute, payment status;
  - packaging: split, failed, wrong-amount and duplicate payments, overpayment flagged, balance collected once over two deliveries, COD, return and refund, non-seller refused;
  - legal: sign-up record, stale version refused, approval blocked without the agreement.
- `scripts/ops-phase-screens.mjs`: 19 pages × 1280/390 plus 2 print documents, all 200 with zero overflow; the gate redirects a user who has not accepted. Temporary data was removed.

## Notifications showing "—" and profile picture not saving (2026-11-04)

**Notifications.** Ten database flows store plain fields instead of the bilingual `{ar, en, link}` payload: store submitted, store change request/approved/rejected, product pending/approved/rejected, verification decisions and grace expiry. The page and the bell only read the bilingual shape, so these showed "—". Their stored links also lacked the language prefix.
- **Fix:** `app/features/notifications/format.ts` formats every shape. Bilingual payloads are used as they are. The field-only types get translated titles and bodies (store or product name, reason) and a link derived from their ids (e.g. a pending product links to `/admin/products/:id`). Every link is put under the reader's language. Unknown types read "Account update".
- **Used by:** the notifications page and the bell (which now has an "Open" link too).

**Profile picture.** For anyone who owns a store, including an admin who owns one, the profile page sent the uploaded picture to the store logo. For an active store, that became a pending store-change request. Nothing was written to `profiles.avatar_url`, so the picture vanished on reload and never reached the header.
- **Fix:** the picture always saves to `profiles.avatar_url`, and only the caller's own upload path is accepted. Store owners see their store logo, and any logo awaiting review, as a separate card linking to Store settings. The picker shows "Picture saved" and reverts its preview if the save is refused.

**Verified in a real browser with temporary users:**
- customer and admin-who-owns-an-active-store: upload, save and reload all keep the picture, with `avatar_url` set and no change request created;
- the notification page in Arabic and English renders all 7 payload shapes with correct `/ar` and `/en` links;
- typecheck, 124/124 tests, build.

## Packaging: extra-large envelope weight limit

Owner confirmed 12 kg (the Arabic price-sheet tab said 10 kg). Migration `20261104000021_packaging_xl_envelope_12kg` renames the catalog item to SKU `ENV-XL-12`, "ظرف كبير جداً حتى 12 كجم" / "Extra-large envelope ≤ 12 kg". No past packaging orders used the old SKU. Seed in migration 18 updated to match.

## Kashier — payment sessions, test mode, webhook (2026-11-04)

- Rebuilt on Kashier's Payment Sessions API (`POST /v3/payment/sessions`, secret key + payment API key). The legacy query-string checkout only offered card; the hosted session page now offers card, mobile wallets, installments, BNPL and every other method active on the account (admin can restrict to card / wallet / bank installments).
- Keys live only in `.env` (MID-19766-155, live + test pairs; `$` escaped as `\$`). The old `kashier_key` / `kashier_merchant` settings fields were removed from the DB and the page.
- Admin setting **Payments → Test payments**: off / admins only / everyone. Every card order stores `payment_mode` (+ `kashier_session_id`); the webhook proves its mode by which Payment API key signed it, and `fn_confirm_payment` / `fn_confirm_packaging_payment` refuse a mode mismatch.
- Test orders never touch money: `fn_post_transaction`, `fn_post_earnings`, `fn_charge_pickup` skip them; a test 50% packaging order opens no balance; dashboard KPIs/daily sales/top vendors and reports count live orders only; TEST badge on admin/vendor order views. (migrations 23, 24)
- Webhook: new signature scheme (hex HMAC-SHA256 over sorted `signatureKeys`, verified against the docs' vector in `tests/kashier.test.ts`), `{event,data}` body, PENDING/refund events ignored. Webhook URL shown (copyable) in admin settings and sent per session as `serverWebhook` when the site is public https.
- Fallback settlement: the order pages and `/api/order-status` read the session server-to-server (`GET …/sessions/:id/payment`, secret key) — works when the webhook is late or the site is on localhost. Same `TX-…` id as the webhook, so the two paths are idempotent together.
- Verified end to end in Kashier's test environment: packaging order (50% plan, admin with a store) → hosted page with card + wallet + installments → test Visa with 3-D Secure → order confirmed / deposit paid, `mode=test`, no balance created; webhook replays: duplicate → idempotent, live-signed on a test order → `mode_mismatch`, forged/unsigned → 400.
- Kashier rejects a `merchantRedirect` with a port, so on localhost:3000 the browser lands on `http://localhost/…` after paying; opening the order again settles it. On the real domain the redirect works normally.

## 2026-11-05 — Staff permissions v2, manual user creation, nav reorder, mobile bottom bar
- Permission catalog (12 groups, 45 keys) in `app/lib/permissions.ts`. Staff defaults: dashboard, orders view/add/edit/approve, sellers view/add/edit/approve, users view/add/edit/ban, products view.
- DB: `user_permissions` (per-person grant/remove), `has_permission()` = admin → all, blocked → none, staff → role ± overrides. New RPCs `fn_my_permissions`, `fn_admin_set_user_permissions` (no self-edit), `fn_admin_finalize_new_user`. 78 RLS policies and 55 RPCs moved from `is_admin()` to a specific permission (migration 20261105000002). Settings, roles, commissions and email templates stay admin-only.
- Route gate: `requirePanelAccess(…"admin")` checks `features/admin/nav.ts` per path (loaders and actions) → 403. The same table drives the reordered, permission-filtered admin menu.
- Roles page redesigned (role summaries, grouped switch matrix with search and a sticky save bar, staff list tab). Per-person editor on staff profiles.
- Create user dialog (Customer/Seller/Staff/Admin; password or invite; optional alternate phone; staff permission customisation). Invite links reuse `/auth/forgot?type=invite`. New email templates `user_invite` and `account_created`.
- Seller menu reordered (Sell / Money / Grow / Store set-up). Phone bottom bar (`MobileBottomNav`) on storefront, account, seller and admin panels.
- Verified e2e: 3 roles created via UI; duplicate email error; staff menu filtered; settings/roles/coupons 403 → coupons 200 after a per-person grant; removing orders.approve blocks cancel; staff cannot ban admins or edit own permissions; invite page works; bottom bar in AR/EN with no horizontal scroll, hidden on checkout and desktop. Test users deleted.

## 2026-11-05 — Dashboard links in storefront menus + site audit fixes
- Header user menu and phone drawer now show "Seller dashboard" (vendor) or "Admin panel" (admin/staff); customers see neither (`panelLink` in components/layout/public/shared.ts). Verified per role with test accounts (deleted).
- Security/CSP: added `media-src` (self, blob, Supabase storage) and `frame-src` (approved video hosts) — blog video embeds and uploaded videos were blocked by `default-src 'self'`. EMBED_HOSTS moved to lib/embed-hosts.ts, shared by the sanitizer and the CSP.
- SEO: home page H1 (visually hidden); stores page always has an H1; legal pages get title + description + canonical + hreflang; auth pages get a page title + noindex; empty categories are noindex and the sitemap lists only categories with products (1,622 → 17 URLs today).
- Blog article: draft preview follows `blog.manage` (staff with the permission can preview), dead code removed.
- Audit checks that passed: anon cannot read private tables or call admin RPCs; security headers present; private pages noindex; 404s return 404; robots.txt and sitemap valid.

## 2026-11-05 — Google profile completion + production deploy
- Google sign-in copies full name + photo (photo stored in our media bucket) — `app/features/auth/google-profile.server.ts`, `routes/auth/google-callback.tsx`.
- Complete-profile page now asks name + two different phones, Terms only when not yet accepted — `routes/auth/complete.tsx`, `completeProfileSchema`, `lib/profile-complete.ts`; site-wide reminder `components/layout/CompleteProfileBanner.tsx`.
- BUG: `profiles.phone_alternate` had no UPDATE grant for `authenticated` → saving the alternate phone failed everywhere. Fixed in `20261105000005_profile_alternate_phone_grant.sql` (+ format / differ checks).
- Deploy: `deploy/` (Docker runtime behind supabase-caddy, Cloudflare Full). Windows build path fix `scripts/fix-build-paths.mjs` (postbuild).
- Caddy: Cloudflare real-IP (`trusted_proxies` + CF-Connecting-IP), `no-store` default so Cloudflare never browser-caches 404s.
- Supabase Auth: SITE_URL=https://etsawaa.com, redirect allow-list etsawaa.com + localhost.

## 2026-11-05 — Google register/link, tagline, payment logos, mobile search
- Resend verified from production (no-reply@etsawaa.com → delivered).
- Shared `components/auth/GoogleButton.tsx` (G mark + "or" divider) on login and register.
- Profile "Google account": link via `routes/auth/google-link.ts` (linkIdentity, login_hint); callback `?link=1` unlinks and refuses a Google account whose email differs; unlink when another sign-in method exists. Supabase auth: GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true; Google provider env wired but GOOGLE_ENABLED=false until credentials arrive.
- Tagline → "تسوّق من بائعين مصريين موثوقين في مكان واحد" / "Shop trusted Egyptian sellers, all in one place" (i18n, settings default + DB, PDFs).
- `public/payments/` (methods strip: Visa, Mastercard, Fawry, Vodafone Cash; single tiles) in footer and Kashier option at checkout.
- Mobile SearchBox: pill field with inset round button, 16px input (no iOS zoom).
- Auth layout: "Welcome back" line only on the login screen.
- PROD BUG (2026-11-05): every route action returned 400 on etsawaa.com — React Router's CSRF check compared `Origin: https://etsawaa.com` with the proxied `request.url` (`http://…`). Fixed with `allowedActionOrigins` in `react-router.config.ts`; foreign origins still get 400.
- CSP form-action now allows Supabase, accounts.google.com and *.kashier.io (redirects after form posts); Cloudflare Web Analytics allowed.
- PROD BUG: sign-up never sent a code — Supabase had MAILER_AUTOCONFIRM=true and SMTP pointed at a local fake mailbox (also broke password-reset and email-change codes); the only mail was the app's "welcome / account ready". Now: Supabase SMTP → Resend (smtp.resend.com:465, no-reply@etsawaa.com), autoconfirm off, bilingual code templates `public/mail/*.html` (fetched by auth from http://etsawaa-app:3000/mail/…), OTP valid 1h. Welcome email moved to after successful verification.
- Verify page: resend countdown starts from the real send time (`sent` param from register/login/email-change) and is kept in localStorage per address, so a refresh no longer resets it to 60s.
- Verified live: register → code email delivered → code accepted → /ar/account → welcome email delivered.

## 2026-11-05 — Admin Products page, product details, review cards
- `routes/admin/products.tsx` rewritten: "Products" (was "Product approvals"); all products by default; status tabs with counts; server-side search (ar/en name), store, main category (subtree via categories.path), sort; 25 per page; columns image · names · options · store (logo) · category · price/sale/range · stock · status · added; row opens /admin/products/:id; clone/archive kept; card layout under lg.
- `routes/admin/product-review.tsx`: summary header (main image, store with logo, category/brand, View on site / Store page links) + stats strip (price range, total stock, options, images, submitted, updated).
- `routes/admin/dashboard.tsx`: "Needs review" section — Stores pending review (new applications + store detail changes + verification documents) and Products pending review, each with breakdown, oldest wait and next-in-line list; CTA opens the first non-empty queue.

## 2026-11-06 — Admin: delete/select users, sidebar review badges
- Migration `20261106000001_admin_delete_user_nav_counts.sql`: `fn_admin_delete_user` (needs `users.delete`; admin-only for staff/admin targets; refuses self, last admin, accounts with orders / store sales / packaging orders / wallet balance; clears "reviewed by" refs; audited `user.deleted`) and `fn_admin_nav_counts` (pending counts per menu entry, filtered by the caller's permissions).
- `users.tsx`: row checkboxes + select-all, bulk ban / unban / delete with per-account failure report, per-row delete button, confirm dialog with warning + reason.
- Sidebar: counter pills on Orders (on hold), Refunds, Shipping approvals, Packaging orders, Sellers (applications + verification), Store change requests, Withdrawals, Products, Reviews; dot on the collapsed rail.
- New permission `users.delete` (not in staff defaults). Verified live as a temp admin (deleted).

## 2026-11-06 — Users page redesign, role change, toast loop
- `admin/users.tsx` rebuilt: role cards double as filters (All/Customers/Sellers/Staff/Admins/Banned), search + result count toolbar that becomes the bulk bar, desktop table (user, role, store + store status, status, joined, ⋯ menu), mobile cards.
- Role changeable in place (coloured dropdown → confirm dialog showing old → new role and what it means) and in bulk (radio list). Non-admins only get customer/seller; DB `fn_admin_set_role` still enforces. Errors mapped to `users.err.*`.
- Bug: `useActionToast` re-fired on every re-render → "Saved" toast stacked endlessly after any action on any admin page. Now announces each result once (ref guard).
- Verified live in the browser with temp accounts (deleted): single + bulk role change, one toast each, phone layout without horizontal scroll.

## 2026-11-06 — Settings page clean-up (/admin/settings/sections)
- Removed cards whose values nothing read: General (URL pattern, single seller, customer details, welcome text), Login provider toggles, Financial commission defaults, Policies text, SEO, Email provider/SMTP, Notifications; removed unused fields (allow_status_change, allow_own_tags, after_grace, eligible_status).
- New "Connected services" card: live status of Resend (key + sender, "send me a test email"), sign-up/password codes and Google sign-in (read from GoTrue /auth/v1/settings), Kashier keys.
- Bugs fixed: COD cap was saved to `payments` but checkout read `checkout`; COD on/off switch was never checked (now enforced in checkout UI + fn_create_order `cod_disabled`, migration 20261106000002); seller-registration toggle saved to `general` but /sell reads `site.general`; every card save replaced the whole stored value (wiping hidden keys like verification.required_documents) — now merges. Added max document size field.

## 2026-11-06 — Brand catalogue import, brand details, commissions
- Data: 1,500 brands imported from `Brands_1500_with_descriptions .xls` (AR/EN name, description, country of origin, founding year; slugs generated). Each brand linked to site categories via a 75-label → sub-category mapping (2,422 links, every brand ≥1). Logos from `Brands.rar`: all 1,476 matched files checked visually against names (24 contact sheets, no mismatches); 10 brands reuse a sibling logo (Bosch←Bosch Auto, Dior Beauty←Dior, Guess←Guess Watches, …); 14 have no logo in the folder (MSI, Gigabyte, AOC, BenQ, ViewSonic, Lexar, Transcend, SteelSeries, Bloody, Colgate, Ismail Yassin, El Bawan, Svenson, Yvolution). 1,486 converted to WebP (≤720×400, 13.2 MB total, was 538 MB) → storage `media/brands/*.webp`, registered in the media library (folder "Brands"). 21 image files had no matching brand (HTC, Tech21, Redmi, …) and were skipped.
- Commissions: 170 level-3 categories from `جدول عمولات اتسوء.xlsx`, minimum of each range (4–12%); level-4 types inherit. Audited as `commission.bulk_import`.
- Migrations 20261106000003 (brands.country_ar/en, founded_year; brand_categories + RLS; v_storefront_brands adds them + category_ids/root_category_ids) and 20261106000004 (fn_save_product rejects a brand not linked to the product's category branch: `brand_not_in_category`).
- Seller wizard: brands paged past the 1000-row cap; brand picker shows only brands linked to the chosen category or its parents (searchable); changing category clears a brand that no longer fits.
- Admin: brands list rebuilt (search, category/logo/status filters, 30 per page, visibility toggle); new add/details page `/admin/catalog/brands/new|:id` with all fields, categories multi-select, logo, live store preview.
- Storefront: /brands directory with search + main-category chips + lazy loading (48 per batch on scroll, "show more" fallback); brand page shows origin, founded year, product count and "sells in" category chips; home strip limited to top 16 brands. `/api/media` now also serves `brands/*` paths.

## 2026-11-06 — Bug sweep: brands + add-product wizard
- Seller couldn't clear a product's brand (wizard dropped "", fn_save_product kept the old value); with the category-filtered picker this made saves fail after a category change. Wizard always sends brand_id; fn_save_product treats a present key as the value ("" = none) and checks the effective brand × category (migration 20261106000005).
- fn_submit_product crashed on every INCOMPLETE product ("malformed array literal") — the missing list used `|| 'text'`; now array_append, so sellers get "Still missing: …" (migration 20261106000006).
- Wizard: separate fetchers for autosave / child products / submit (a shared one let autosave abort a children save); first autosave of a new product no longer navigates (it remounted the wizard back to step 1 and lost typing) — id kept in state, URL replaced; no second draft created while the first save is in flight; submit flushes the latest fields and cancels the pending autosave (it used to race and fail on the locked product); children save returns updated_at (false "edited in another tab" warning); server errors mapped to clear messages (missing items, store blocked, locked, duplicate colour/size, sale price); gallery skips duplicate images; "save draft" hidden on read-only products; leave-page warning covers unsaved child products.
- Checkout: a chosen COD resets when it stops being allowed.
- Brands: lazy loading requested each batch twice and looped on deep links (?page=N) — fixed; stable sort tie-break; admin brand save adds new category links before removing old ones.
- Verified with a temporary seller (deleted): draft creation stays on step 2 with one draft, brand list filtered (120 for smartphones, no fashion brands), category change clears brand and saves, incomplete submit returns the missing list, full submit reaches pending review.

## 2026-11-07 — Product specs: per-category options, multi-select, product page

**Reported:** a shirt showed «قصة البنطلون» (pants cut) and a material list with plastic, metal, marble…; no spec could take two values; specs saved on a live product never appeared on its page.

**Root causes**
- Options are global per attribute and shared by every linked category (material: 48 options × 841 categories; `fit` = pants cuts, linked to 208 categories incl. shirts, watches, belts, shoes).
- `product_attribute_values` PK (product, attribute) → one value per spec.
- Product page loader fetched option labels for variant options only → every option-based spec had no label and was filtered out (`app/features/storefront/api.ts`). Compare page used the filterable-only facet view for labels.

**Fixes**
- `20261107000001_attributes_multi_scoped.sql`: `attribute_defs.is_multi`, `category_attributes.allowed_option_ids` (null = all), `product_attribute_values.option_ids` (option_id = first). `fn_save_product` accepts `option_ids`, rejects several options on single specs, rejects options not offered in the category, skips empty values, writes one facet row per option and a `values` array in the specs snapshot. `fn_clone_product` copies `option_ids`.
- `20261107000002_attributes_curation.sql`: option scopes for material / main_material / fabric_material / body_material by category family (garments = textiles, outerwear & bottoms + leathers, shoes, bags, jewellery, kitchen, home, electronics, kids, office, care, sport, pets, cleaning); `fit` renamed «القصة», unlinked from non-garments, tops get regular/slim/relaxed/oversized/athletic, bottoms get all cuts; `length_style` «فئة طول البنطلون» → «الطول»; sleeve length (unit removed) unlinked from bottoms/accessories and added to tops; `neckline` turned into an option list (16 collars/necklines, scoped for shirts / polos / tees) and linked to tops; closure scoped for shoes/bottoms and unlinked from tape/bubble wrap/trash bags; power_source unit "W" removed; multi-select on material, fabric_material, occasion, pattern, suitable_skin_type, age_group, suitable_age_group, power_source; ه→ة label spelling.
- Wizard: template loader applies the category scope (and loads all options in one paged query instead of one per spec); multi specs use the checkbox `SelectMenu` with a hint; values no longer offered are dropped instead of being rejected on save; "Other"/"Mixed" stay last.
- Product page, admin review and compare show every chosen option ("قطن، إيلاستين").
- Admin → Attributes: "Multi-select" toggle on enum specs; per-category tick boxes on each option chip to offer/hide it in that category, with "offer all options" reset; template preview shows what sellers see.

**Verified:** dry-run + live DB tests as the product owner (multi stored, single rejected, out-of-scope rejected, facets/specs written); live product page now lists material / fit / pattern / occasion; temp seller in the wizard: shirt material = 19 textiles, no plastic, two picked and autosaved; fit = 5 garment cuts. Temp seller/draft deleted. typecheck + 140 tests pass.
- Fit option «سليم» renamed «سليم فيت (ضيق)» / "Slim fit" (read as "healthy" in Arabic) — migration 20261107000003.

## 2026-11-07 — Full spec dictionary review (migration 20261107000004, generated)

Audited all 1,201 used specs and every category template (grouped categories by identical spec lists to find templates copied from another product family).

- **Wrong templates (≈200 categories re-templated; links holding product values kept):** printer specs on soft/energy/yogurt drinks and cufflinks; book specs (ISBN, publisher, pages) on school bags, kids' shoes, water dispensers, paper napkins, gift wrap, office furniture; drill specs + voltage on espadrilles, makeup brushes, hair styling tools; SPF/skin type/shade on hair ties, razors, nail clippers, ice cream; cookware specs on yoga pants; food specs on juicers, rice cookers, water filters/RO; cable specs on card holders, suitcases, pencil cases; audio specs on contact lenses, camera straps/lenses; computer specs on hard drives, memory cards, monitors, blood-pressure monitors; furniture specs on bedsheets, tablets, vegetable choppers; pet specs on trumpets; string-instrument specs (strings, fretboard, pickup) on drums/winds; power source on clothing; voltage on hand tools and car fluids; colour/material on food; duplicate power specs (power + electrical_power / wattage).
- **Names:** 108 Arabic spelling fixes (ه→ة, أقصى, أو, أنواع, البطارية…); clearer names («رمات» → «الذاكرة العشوائية (RAM)», «قصى وزن…» → «أقصى وزن للمستخدم», «الصيغة» → «نوع النسخة (ورقي / إلكتروني)», «المستوى» → «المستوى (مبتدئ / محترف)», «مقاسات الأكياس» → «مقاس الشنطة»…); «المعلن/المعلنة» and Declared/Advertised dropped where no clash; English labels capitalised.
- **Units:** `count` removed (99 specs); wrong units removed (GB on storage conditions, Ah on power banks, L on perfume capacity, W on connectors, MP on screen resolution); «عدد …» free-text specs → number fields. New `app/lib/units.ts`: Arabic unit names (سم، كجم، وات…) in the wizard, product page, admin review and template preview; free-text specs typed as a bare number now show their unit.
- **Category names:** four computing categories had shifted Arabic names (laptop-bags was «راوترات وكابلات», mice-and-keyboards «حقائب لابتوب», scanners-and-ink «ماوس وكيبورد», monitors «شاشات وهارد وفلاش ميموري») — corrected.
- Verified: dry-run + post-apply audit (no foreign-family specs, no two specs with one name in a category); live product page renders specs; typecheck + 142 tests.

## 2026-11-07 — Specs review, second pass (`20261107000005_specs_review_2.sql`)
- **Names:** «مبرد موفق»→«مبرد مرفق», «عدد الانوية»→«عدد الأنوية», «اعدادات المؤقت», «تحتوي علي بودرة», «الروية الليلية»→«الرؤية الليلية», «ايقاف عند نفاذ الكمية»→«إيقاف تلقائي عند نفاد المياه», «نوع الدمية Doll Type», the remaining «… المعلن» names. Same-name pairs now say what they are: breast-pump vs kitchen-hood «نوع الشفاط», bulb base «نوع قاعدة اللمبة (E27 / E14…)», instruments «خامة جسم الآلة».
- **CPU threads:** a new `cpu_thread_count` spec, «عدد مسارات المعالجة (Threads)», replaces fabric «عدد الخيوط» on processors. Fabric thread count was also removed from gloves, sponges, brooms, mops, bins, squeegees and gua sha.
- **Wrong-family leftovers removed:**
  - jewellery specs on gel nail lamps;
  - hair type and fragrance-free on car shampoo; skin type and shade on car sunshades;
  - flavour on pyjamas, car fresheners (replaced by scent) and pet beds, bowls, collars and toys;
  - USB ports on micellar water;
  - power and voltage on safety glasses, masks, spirit levels, workbenches, scissors and combs;
  - heat and ion specs on epilators, IPL and skin scrubbers;
  - HDR and resolution on guitar amps;
  - energy rating on dishwasher detergent;
  - make-up coverage on routers and Switch games;
  - the generic template (size and finish) copied onto solid perfume, insect repellent, mouthwash tablets, face paint and lip tint;
  - fragrance-free and skin type on perfumes; fragrance specs on empty refill atomizers.
- **Thin templates:** 17 categories had only 1–3 specs (gaming mouse pads, headset stands, camera straps, hair ties, wigs, razors, filter cartridges…) and now have the basics.
- **Checks:** re-audit clean (no duplicate names per category; the remaining cross-family hits are legitimate, e.g. power on electric pet feeders). Links holding product values were kept.

## 2026-11-07 — Specs review, third pass (`20261107000006_specs_review_3.sql`)
This pass read all 1,391 category templates line by line, not only automated checks.
- **Empty size field:** 355 categories offered «المقاس», but no size chart applies to them, so there was nothing to pick (power banks, watches, guitars, notebooks, cables, furniture, cosmetics…). The field is removed there. Wearables that really need sizes are now linked to the right size chart:
  - clothing sizes: hats, gloves, belts, costumes, helmets, rain ponchos, aprons, shin guards;
  - shoe sizes: motorcycle boots, flip-flops, roller skates.
- **Template padding removed (≈180 categories):**
  - screen size, resolution and HDR on speakers and headphones;
  - food specs (net weight, ingredient, storage) on pet beds, bowls, collars and toys;
  - the make-up template (skin type, shade, SPF) on five perfume categories, now replaced by the perfume template;
  - bag size, strap and lining on luggage scales, tags, locks, sleep masks and neck pillows;
  - iron specs on ironing boards;
  - power, voltage and speed on spanners, pliers and tool boxes;
  - microwave and freezer on kitchen scales, timers, thermometers and knife sharpeners;
  - heat-source and non-stick on graters and peelers;
  - "matte/glossy" on 23 shampoos, gels, deodorants and soaps (net volume or weight added instead);
  - heat and ion settings on shavers, trimmers and LED masks;
  - energy rating and programs on whisks, kettles, blenders and waffle makers;
  - capacity and programs on fans;
  - instrument type and body material on music stands, cases and metronomes;
  - router specs on Nintendo consoles, and laptop specs on portable monitors (both replaced by the right sibling template).
- **Duplicates collapsed per category:**
  - الخامة + الخامة الأساسية
  - الخامة + خامة القماش
  - two dimensions fields
  - the 3 age-group variants
  - عدد القطع ×2
  - net weight + pack size
  - two battery lives
  - power + rated power
  - voltage + operating voltage
  - capacity + total capacity
  - two storage fields on phones
  - parcel weight and W×D×H on clothing
- **Additions:**
  - all shoe categories get upper material, sole material, size system and closure;
  - watches get movement, strap material and water resistance;
  - other thin pet and accessory templates are filled out.
- **Labels:**
  - فئه → فئة; الإنتاج; الموصل الأول/الثاني; الفيديو; «شكل/عدد شرائح الذاكرة»; «عدد منافذ SATA»; «اللزوجة (SAE)»; CCA;
  - «يحتوي على كحول» (was «كحل»); «أطوال النصل» (was «أطوال الاتصال»); «نمط التقاط الصوت»; «لغة اللعبة»;
  - «الحد الأدنى/الأقصى للاعبين»; «موديلات التابلت المتوافقة»; سعة; إيقاف; أوضاع; الأشخاص; الأمونيا; ألوان; رأس; «رؤوس البرد المرفقة»…
- **Checks:**
  - dry run, then a guarded apply;
  - no duplicate names in any category, no category without specs, no size field without sizes;
  - label audit clean;
  - links holding product values kept.

## 2026-11-07 — Specs review, fourth pass with five parallel review agents (`…000007_specs_review_agents.sql`, `…000008_parent_category_names.sql`)
- **How:** the 1,391 leaf templates were split into five slices of about 280 each. Each agent read its slice plus the full spec dictionary (labels, types, options and how many categories use each spec) and wrote findings as JSON. A merger then checked every finding against live data: the slug exists, a removed spec is actually linked, an added spec exists, and renames don't conflict. 0 findings were invalid. One rename conflict (`detergent_form`) was resolved. One category rename was skipped: «شامبو وبلسم» → «شامبو» would clash with «الشامبو».
- **Specs removed (~430, across ~400 categories):**
  - «مدة الضمان» on food, cosmetics, perfume, cleaning products, consumables and clothing;
  - «الخامة» where it repeats upper, frame, base, strap, hair or deck material (all shoes, glasses, jewellery, wigs, skateboards…);
  - «مقاس الشنطة» where W×D×H is already there;
  - laptop specs (graphics) on phones; «طول الكم» on tank/tube/halter tops and waistcoats; strap material on pocket watches; flame-failure safety on electric hobs; power on play tents;
  - age group on parents' tools (sterilisers, pumps, warmers); duplicate ingredients and piece counts in personal care; sunglasses specs on swim goggles; specs for swappable-lens cameras on webcams.
- **Specs added (~75):**
  - processor and screen size on laptops and PCs; connection interface on drives;
  - suction rate on hoods; ball size on balls; speed settings on fans; filter stages on RO units;
  - main camera and battery on phones; heel type moved from ballet flats to heels;
  - color on sports shoes and swimwear; max user weight on trampolines and swings.
- **Labels (39):**
  - «أقل/أقصى وزن للحفاض» → «للطفل»
  - «شكل مسحوق الغسيل» → «شكل المنظف (بودرة / سائل / أقراص)»
  - «المحيط أو الطول الخارجي» → «المحيط الداخلي أو الطول»
  - «حامل العدسة» → «نوع ماونت العدسة»
  - «مقاس الإطار» → «مقاس الفريم (الهيكل)» (bicycles)
  - «القدرة الخارجة» → «قدرة الخرج»
  - «قطر مكبر الصوت» → «قطر وحدة الصوت (الدرايفر)»
  - «عدد أقسام الفرز» → «عدد الأقسام»
  - «المرفقات المرفقة» → «الملحقات المرفقة»
  - «يُشطف أم يُترك» → «طريقة الاستخدام (بالشطف / بدون شطف)»
  - «أأطوال…» → «أطوال…»
  - «الإدراج» → «الأدراج»
  - plus others; the GB unit was removed from «نوع الكارت».
- **Category names (30 leaf + 9 parent):**
  - Parent «الآلات الموسيقية», which was named «الشاشات والأنظمة الصوتية».
  - amplifiers (was named like soundbars), headphones (was «سماعات بلوتوث», like speakers), «بنطلون كولوت» (was «كيلوت»).
  - gold (was «ذهب و فضة»), «ألعاب الطاولة والكروت», «حبوب الإفطار», «واقي الشاشة», «شال باشمينا».
  - «قلايات هوائية بدون زيت», «غلايات المياه الكهربائية», «المناديل والمنتجات الورقية».
  - Two «منشر الغسيل» siblings told apart.
- **Checks:**
  - dry run, then a guarded apply;
  - no duplicate spec names per category, no category without specs, no size field without sizes, no sibling categories with the same name;
  - label audit clean; links holding product values kept.
- **Open, left for the owner:** near-duplicate leaf categories (`shampoo` / `shampoos`, `sunscreen` / `sunscreens`, `hair-oils-and-serums` / `hair-serums-and-oils`) should probably be merged. Books have no "author" spec; one would need to be created.

## 2026-11-07 — Plain names for "output power" (`…000009_output_power_labels.sql`)
- «قدرة الخرج» (engineering jargon) → «قوة الصوت (وات)» on speakers, amplifiers, subwoofers and soundbars. Its unit is now W, so the product page shows "50 وات".
- Related labels: «أقصى قوة شحن (وات)» on power banks and chargers, «قدرة الباور سبلاي (وات)», «قوة الميكروويف (وات)», «أنواع منافذ الشحن (USB-C / USB-A)».
- Follow-up (`…000010_no_khorj_labels.sql`): no label uses «خرج / مخرج / مخارج» any more:
  - «عدد / نوع البرايز» on power strips and extension cords;
  - «أنواع البرايز المتوافقة» on plug adapters;
  - «منافذ توصيل الشاشة (HDMI / DisplayPort)» on graphics cards;
  - «منفذ HDMI».
- Reverted at the owner's request (`…000011_revert_khorj_labels.sql`): the six socket / port labels changed in 000010 are back to their original names.

## 2026-11-07 — specs become choices (migrations 012, 013)
- 6 agents reviewed all 868 free-text specs: 741 converted to choice lists (multi-choice where a product can have several values), 127 kept as text (model numbers, compatible models, ingredients, authors, generic «النوع»/«الستايل»).
- 8 categories that still had no real choice got their own choice specs (extension cords, film cameras, contact lenses, RO purifiers, paper napkins, trash bags, camera batteries, car fluids).
- 5 agents scoped 197 shared choice specs per category: 1,823 links narrowed (e.g. phone OS = Android/iOS/HarmonyOS). 3 wrong links + tank-top sleeve length removed.
- Checks after: every leaf category has ≥1 real choice spec; no choice spec has <2 options in any category; no duplicate names.
- Not enforced: no spec is marked required, so sellers may still skip choices (fn_submit_product only checks required specs).

## 2026-11-07 — main choices required per category (migration 014 + app)
- New `category_attributes.is_required`: required in that category only. `fn_submit_product` refuses submit while one is empty (tested: missing «القصة» → `product is incomplete: attribute:fit`; the draft rolled back).
- Seeded: each category's first 3 choice specs in template order (not colour/size, country, occasion, pattern, sizing system). 3,314 links; all 1,391 categories have at least one.
- Wizard loader marks these as required (red star + step validation). Admin «الخصائص» page: per-category switch «مطلوب في هذا القسم / اختياري».
- Products already approved are untouched until they are resubmitted.

## 2026-11-07 — owner round (32-item list) — migrations 015/016
- Storefront: card shows before/after price + discount ribbon (view now returns `min_regular_piastres`, `max_discount_percent`, `sold_count`); product page price/stock follow the picked variant; rating badge beside the title; gallery dedupes images (unique index + `on conflict do nothing` in fn_save_product / fn_save_children); related + same-store carousels; post-purchase review prompt.
- 404s: old route chunks are now kept across deploys (`/opt/etsawaa/assets-keep`, 21 days) + one-time reload on a stale chunk; blog accepts either language's slug and 301s to the right one.
- Home: brand logos first under the hero, then categories; "Best Products"; Best selling (units sold) + Top rated (real reviews) — hidden while empty; admin banners have a placement between sections + "Preview on home" (`?bannerPreview=<id>`).
- Digits: every `ar-EG` formatter → `ar-EG-u-nu-latn`; Eastern digits removed from ar.ts.
- Roles: avatar menu lists admin/staff · seller · customer dashboards; staff may open a store (vendor panel); staff defaults widened (products add/edit/delete/review, sellers, catalog, contact inbox — commission stays admin-only, its UI hidden for staff); custom roles (`profiles.staff_role`, create/rename/delete, per-role matrix, assign per staff member).
- Vendor: grace banner red and larger; grace length change re-dates vendors still in the window (months bug fixed — they were counted as years); store under review cannot add products (UI + fn_save_product); product table redesigned (price, stock, sales, rating, KPI filters); analytics (fn_vendor_analytics) on the dashboard; wizard folds the sidebar, confirms leaving, autosaves children, offers resume/discard of the last draft, drops short description + dimensions, platform shipping by default and forced for `settings.shipping_rules` categories (AC + water purifiers), apparel/shoe size chart with diagrams (size guide on the product page).
- Review: "Return for changes" (needs a reason) also on approved products; yellow banner on every seller page; email via the event mailer.
- Emails: every notification type has an `event:<type>` template (on/off per event, grouped by audience); in-process worker sends them (notify-worker.server.ts).
- Contact: customer/seller form switch, photo/video attachments (signed uploads to private `contact` bucket, limits re-checked server-side), Resend to team + acknowledgement, channels + social links below; admin/staff inbox with colour-coded source badges and email replies kept in a thread.
- Settings: social links, contact channels and shipping rules cards; audit found every remaining field has a reader.
