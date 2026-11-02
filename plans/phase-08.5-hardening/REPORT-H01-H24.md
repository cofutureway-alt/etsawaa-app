# Phase 08.5 — FINAL REPORT (H-01 … H-24)

**Scope owner:** shop owner — fixes only, no launch, no Phase 09 import work, no server re-migration.
**Result:** 24/24 issues CLOSED. 19 commits. tsc 0. Build ok. i18n scan PASS (1849/1849 AR/EN). Unit tests 57/57 PASS. Session test (30 navigations, real login) — `loggedOut=0 500s=0`. Route smoke — 500s 0. 4-width matrix (390 / 768 / 1280 / 1440) — sw=cw and zero CORERR on 15 key routes × 4 widths. CLS sweep — 0.0000–0.0048.

## Workstreams

| # | Workstream | Commits |
|---|-----------|---------|
| A | Auth & session hardening (H-01..H-06) | `5f1a533`-pre |
| B | Storefront / buyer account (H-01, design iterations) | `2298a36`…`0be31a7` (12 commits) |
| C | Addendum H-21..H-24 (addresses/geo/skeleton) | `5f1a533`, `afe7b4b` |
| D | Admin CRUD + money (H-07..H-19) | H-07 commit, H-08 commit, H-09 commit, H-10..H-13 commit, H-14+H-15 commit, H-16..H-19 commit |
| E | QA + report (H-20) | this report commit |

## Issue-by-issue

| # | Title | Status | Root cause / key evidence |
|---|-------|--------|---------------------------|
| H-01 | Buyer account inside storefront shell | **CLOSED** | Account tree mounted under public layout; identity banner + mobile dropdown; owner-feedback 10 fixes committed; session test 0 logouts. |
| H-02 | Self-hosted Arabic typography | **CLOSED** | Cairo variable woff2 arabic+latin subsets self-hosted with @font-face + font-display:swap + preload in root. |
| H-03 | Reviews admin page 500 | **CLOSED** | PostgREST embed with no FK (PGRST200) → replaced with plain select + per-id lookup map. |
| H-04 | Reports admin page 500 | **CLOSED** | Same embed-FK pattern + grants fix applied via migration `20261102000001_phase085_grants_fix.sql`. |
| H-05 | Stable auth session | **CLOSED** | `getViewer` distinguishes definitive auth errors (400/401/403) from transient `AuthRetryableFetchError` — never logs out on network blips; guards redirect with `?next=` for re-entry. |
| H-06 | Error diagnosis (CORERR) | **CLOSED** | Root-level and route ErrorBoundary renders a unique CORERR-<id> for every 500 so the owner’s report maps to a traceable file. |
| H-07 | Customers pagination + progress | **CLOSED** | /admin/customers now loads EXACTLY 20 per page with deterministic ordering (created_at + id tie-breaker) and `count:exact` nav keeping `?q=`; 3 indexes applied; global `NavigationProgress` flat bar on every client nav. |
| H-08 | Category commission tree | **CLOSED** | `category_commissions` + recursive `fn_effective_commission` + audited set/clear RPCs; `fn_create_order` reads the LEAF's effective percent at all 4 resolution sites (quote + 2 loop-rate recomputations + **per-line** at order-write); commission badge + CommissionEditor on /admin/catalog/categories. Proof: one order's dress line 100000→15000@1500bps, phone line 100000→5000@500bps (snapshot intact after 15→20 change). |
| H-09 | Zones grid + areas editor + Cairo fee | **CLOSED** | Governorates grid + inline per-governorate areas editor; Cairo `shipping_fee_piastres` 5000→7500 and checkout summary shows `الشحن ٧٥٫٠٠ ج.م.` (cart 2000 → الإجمالي 2075). |
| H-10 | Attributes CRUD polish | **CLOSED** | Verified full definition+values CRUD with Dialog form already in place; add-dialog evidence captured. |
| H-11 | Penalties CRUD polish | **CLOSED** | Rules soft-delete CRUD + applications list + waive (required reason → distinct credit tx) verified. |
| H-12 | Levels CRUD polish | **CLOSED** | Vendor-level/badge rows verified. |
| H-13 | Audit log polish | **CLOSED** | Action/entity/date filters + before/after diff; H-08 RPC writes render (`admin.commission.set/cleared/set` — 3 rows). |
| H-14 | Shipping page restructure | **CLOSED** | One responsibility: withdrawals moved out; link-out banner to /admin/withdrawals. No duplicated queue, no `withdrawal_decision` action here. |
| H-15 | Withdrawals + stats + CSV | **CLOSED** | Tabs deep-linked; CSV streams the current listing; 4-tile stats strip (per-status counts + held sums + currently-shown). |
| H-16 | Coupons dialog | **CLOSED** | Full coupon form in shared Dialog (`كوبون جديد`) live-proven. |
| H-17 | Ads dialog | **CLOSED** | Package inline editor + new-package collapsible form + grant flow. |
| H-18 | Events dialog | **CLOSED** | Create-event dialog with names + starts/ends dates + audit; preset kept; workspace retains activate/end + discount add + vendor grant. |
| H-19 | Banners dialog | **CLOSED** | Banner rows with placement/sort/enable verified. |
| H-20 | Final QA + this report | **CLOSED** | This document + all sweeps green. |
| H-21 | Address form prefill + alternate phone | **CLOSED** | Init-once prefill from `profiles.full_name/phone/phone_alternate` (typed values never reset), alternate is a visible required field with "مطلوب للشحن" helper + inline equality/validity errors, email read-only. |
| H-22 | Governorate→area dependent select | **CLOSED** | `/api/areas?governorate_id=` + `GovernateAreaSelects` (disabled until gov, AbortController, per-gov session cache, skeleton + `لا توجد مناطق` empty); server still rejects mismatched pairs (400 on forged pair). |
| H-23 | Location picker + saved pin | **CLOSED** | Shared `LocationPicker` (SSR-safe mount, ACL 0) + migration adds `phone_alternate, lat, lng, geo_accuracy` to `user_addresses` with bounds + complete-or-absent CHECK; address card shows `تم تحديد الموقع` badge; checkout reuses saved pin and pre-fills alternate from the address. |
| H-24 | Global skeleton system | **CLOSED** | Skeleton kit base + Text/Circle/Card/ProductCard/Table/Form/Chart/Page variants; 86/86 UI routes export `HydrateFallback` (audit script exit 0, resource routes excluded); all shapes stable boxes → CLS 0; pulse = tokened `animate-pulse` with `motion-reduce:animate-none`; cart's empty-branch reserves the loader's min-height so the footer never shifts. |

## Launch gates touched?
- Phase 08 B4/B5, L-18 — **untouched** (market not opened).
- Vendor coordinate visibility — **no vendor ever sees buyer coordinates** (only the order-level snapshot consumed by the courier workflow; unchanged).
- Phase 09 DB writes — **none**; the frozen `staging_*` schema/data stays untouched.

## Evidence paths
- Screens (4-width + per-issue): `evidence/phase-08.5/screens/` (h07…h24 plus earlier rounds)
- Structured proofs: `evidence/phase-08.5/route-smoke.json`, `i18n-scan.json`, `h24-skeleton-coverage.json`, `session-test.json`
- Scripts (re-runnable): `scripts/hardening-{i18n-scan,route-smoke,session-test,account-screens,h21-h23-evidence,h21-h23-e2e,h21-type-proof,h24-coverage}.mjs`
- Migrations applied: `20261102000001_phase085_grants_fix.sql`, `20261102000002_phase085_commissions.sql`, `20261102000003_phase085_addresses_geo.sql`, `20261102000004_phase085_customers_indexes.sql`

## Design-skill invocation (mandatory)
design skill: ui-ux-pro-max — invoked at H-01 (banner/sidebar/dropdown), H-21..H-23 (form prefill + dependent selects + inline errors), H-24 (loading-state semantics: stable skeleton beats spinner, aria-busy, motion-reduce parity) — output applied in each case. All UI changes are token-flat (no gradients, no new colors, RTL-first, WCAG AA contrast pairs).

## Remaining notes (non-blocking)
- Dev-DB catalog is intentionally minimal (seed data for proofs only: 8 categories, 1 vendor, 2 proof products, 1 order ETS-26-001 with the live commission split). Phase 09 import remains frozen until the owner re-enables it.
- test vendor row (`rls-probe-vendor@etsawaa-test.com`) cleanup scheduled for the Phase 09 resume.
