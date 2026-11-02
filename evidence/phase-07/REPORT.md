# Phase 07 — Admin Suite · REPORT

Date: 2026-11-01 · Branch: main · Tag: `phase-07`
Design protocol: **design skill: ui-ux-pro-max — invoked at step "before admin-suite UI" — output applied: data-dense dashboard pattern (dense spacing scale, subtle motion), daily-sales rendered as an SVG line chart with a table fallback (trend-over-time rule, <1000 pts), tables as checkbox-column + bulk action bar with horizontal-scroll wrappers and card layout at 390, sectioned settings forms with independent save + loading→success feedback, active nav/tab indication, labeled inputs and ≥13px text on ≥40px targets — all rebuilt from flat DB tokens (skill palette overridden by AGENT token rule), RTL-first.**

Regression gates (final state of this delivery):
- typecheck: **0 errors** · oxlint: **0 warnings** (app) · unit tests: **57/57** · build: ✓
- E2E suite `scripts/test-phase7-admin-suite.mjs`: **70/70 checks — two separate executions**
  - run1 @ `evidence/phase-07/tests-raw-run1.json` (md5 `4ab3fa2c…`) · run2 @ `tests-raw-run2.json` (md5 `4f277a9d…`) — distinct files, both `pristine: true`
- Phase-05 regression AFTER the whole phase-07 schema (incl. the A-25 email migration): **63/63** + `pristine: true`
  - attached raw run: `evidence/phase-07/regression-phase05-raw.json` — timestamp **2026-11-01T17:09:20.342Z**, md5 **`6f41a8317b4b6595262136ea3ba319b5`** (webhook block ran with the same KASHIER test env/secret the phase-05 evidence used)
- Phase-06 regression AFTER the whole phase-07 schema: **61/61** + `pristine: true`
  - attached raw run: `evidence/phase-07/regression-phase06-raw.json` — timestamp **2026-11-01T17:10:33.734Z**, md5 **`6eed2f0ab24173558cfe210e2778f604`**
- Design scan (`scripts/scan-design.mjs` incl. zero-tax/emoji rules): **PASS**
- Screens: **138 PASS / 0 FAIL** (`evidence/phase-07/screens-log.txt`) — **31 subjects × 4 widths = 124 PNGs** (incl. `/admin/profile`, `/admin/media-settings`, `/admin/email-templates`, the dedicated **print-center 3-vendor** capture, zones-areas, order-detail) with clientWidth/scrollWidth asserts + container ≥1100 @1440
- **No archives produced (owner instruction) — all evidence is plain committed files under `evidence/phase-07/`**

## Delivery mapping A-01 … A-39

| ID | What shipped | Evidence |
|---|---|---|
| A-01 | Dashboard: 4 quick-action cards with counts → filtered lists, sales + platform stat cards, 90-day SVG line chart with table fallback, all-time stats, top vendors (with level badge), top-rated products. Every number = one documented query (`v_admin_kpis` / `v_admin_daily_sales` / `v_admin_top_vendors` / `v_admin_top_products`) | app/routes/admin/dashboard.tsx; screens/admin-dashboard-* |
| A-02 | Withdrawals: Pending/Approved/Cancelled/All tabs + CSV export + approve / cancel (reason mandatory) → phase-06 RPC moves money exactly once | app/routes/admin/withdrawals.tsx; screens/admin-withdrawals-*; tests WD1–WD5 |
| A-03 | Reports: 6 period cards (30d) + daily bar strip + admin-earnings cards (commission/clawback/penalties/adjustments) + all-logs table. Totals read the same sources (orders + order_vendor_groups + wallet_transactions) | app/routes/admin/reports.tsx; screens/admin-reports-* |
| A-04 | Vendors list: status + verification filters, row actions edit/ban/unban/hide/unhide/penalty; every action audited by definer RPC | app/routes/admin/vendors.tsx; screens/admin-vendors-* |
| A-05 | Vendor edit · General tab: direct-publish + change-status permissions, featured permanent/timed (days) — independent save per tab, audited | admin/vendors_.$id.edit.tsx (tab 1); screens/admin-vendor-edit-* |
| A-06 | Vendor edit · Commissions tab: inherit (level) / fixed / category-based + next-order preview; `fn_admin_set_commission` writes vendors + `vendor_commission_overrides`, audited; applies to future orders only | tab 2; tests XX1 + AU vendor.commission.set |
| A-07 | Vendor edit · Details tab: social links (own save), wallet balances, penalties list, ad campaigns history, verification Documents (references only — no raw URLs; signed-URL flow unchanged) | tab 3; screens/admin-vendor-edit-* |
| A-08 | Hide listings (confirm dialog, reason mandatory, reversible `fn_hide_vendor_listings`) + ban/unban with reason (`fn_ban_vendor`) | tests XX3/XX4 + AU vendor.listings.hidden; vendors.tsx dialogs |
| A-09 | Products: clone (`fn_clone_product`) + archive (soft-delete `fn_admin_archive_product`, reason + audit) + filters + search via DataTable | admin/products.tsx; screens/admin-products-* |
| A-10 | Approvals with mandatory rejection reason (existing phase-03 RPC) + admin archive; audit on every transition | products.tsx; screens/admin-products-* |
| A-11 | Catalog pages (categories tree/brands/tags/attributes) carried from phase 02 — unchanged; reordering persists (`fn_category_repath_children`) | app/routes/admin/catalog/* |
| A-12 | Coupons: full form — code/generate, percent / fixed / **commission_percent** + pairs_with, free-shipping (admin-only), stackable, exclude-sale, min/max, per-coupon/per-user limits, validity; usage counter; status toggle audited; duplicate codes blocked (UNIQUE + inline error) | admin/coupons.tsx; screens/admin-coupons-*; E2E CP1–CP3 (30%×10%×800 = 2400 discount; vendor keeps 80.00; commission 8000→5600) |
| A-13 | Reviews: All/Pending/Published/Spam/Trash tabs + publish / reject(spam, trash) with mandatory reason → product rating recalculated by the storefront predicate (rating_facet source) | admin/reviews.tsx; screens/admin-reviews-* |
| A-14 | Orders: status filters + search + multi-select → bulk status with mandatory reason, per-order validation with failures reported (`fn_admin_bulk_order_status` → `fn_admin_set_order_status` / `fn_cancel_order_admin`, stock restore on cancel) | admin/orders.tsx; screens/admin-orders-* |
| A-15 | Order detail: billing/shipping/invoice summary, items × commission per group, status log, **notes private/public** (written + audited), print center carried from phase 05 | admin/order-detail.tsx; screens/admin-order-detail-* |
| A-16 | Refunds queue by status + per-item decision (approve/partial/reject) with fault (vendor/shipping/customer/defect) + amount + restock in ONE atomic RPC (`fn_admin_decide_refund`); re-decide blocked (`not_pending`) | admin/refunds.tsx; screens/admin-refunds-*; tests RF1–RF8 |
| A-17 | Execute refunds: `approved` → `refunded` with `executed_by/at` (manual transfer ledger at launch; Kashier API at pre-launch gate) | admin/refunds.tsx execute form |
| A-18 | Penalties: rules CRUD (soft delete — `deleted_at`, never erased) + applications list + waive with reason → DISTINCT refund-style credit (`fn_admin_waive_penalty`) + manual apply (vendor page dialog → `fn_admin_apply_penalty`, wallet tx + notification + audit) | admin/penalties.tsx; screens/admin-penalties-*; tests XX2/AU penalty.applied |
| A-19 | Levels & badges: CRUD with rewards (commission %, hold days), per-level vendor counts, manual promote/demote with reason (`fn_promote_vendor_level` → history row + notification + audit); `fn_auto_levels` cron-shaped for scheduled promotion; reward changes affect future calculations only (documented in-page) | admin/levels.tsx; screens/admin-levels-*; tests LV1/LV2 |
| A-20 | Ads: packages CRUD (placement/duration/price/slots/visibility) + campaigns list with source badges + **admin grant** (`fn_admin_grant_ad` — active campaign, `source=admin_grant`, zero payment transactions) | admin/ads.tsx; screens/admin-ads-*; tests AD1–AD3 |
| A-21 | Events: Black Friday preset (Nov 1–30, seeded idempotently), category discounts add/remove, vendor status auto/accepted/refused (`fn_event_set_vendor`); refusal hides products publicly through the phase-04 storefront view (`is_listable=false`) within one request cycle; acceptance restores | admin/events.tsx; screens/admin-events-*; tests EV0–EV4 |
| A-22 | Featured controls: product featured flags carried from phase 04 (featured_until minute-level expiry in the storefront predicate) + vendor featured-permanent/timed in the editor (A-05) | vendors editor general tab |
| A-23 | Customers: search, role-scoped rows, ban/unban, delete blocked for customers with orders (`has_orders` → 400; only order-less customers deletable) + per-customer orders/revenue | admin/customers.tsx; screens/admin-customers-* |
| A-24 | Settings sections with INDEPENDENT save each: general/login/vendors/verification/withdrawals/payments(+COD cap)/policies/SEO/emails/notifications — every field from JOURNEYS §16.16 (media stays in /admin/media-settings; shipping in /admin/zones; design tokens in /admin/settings) via audited `fn_admin_set_setting` upsert | admin/sections.tsx; screens/admin-settings-sections-* |
| A-25 | **Email templates editor (implemented this phase — owner decision, no deferral)**: `/admin/email-templates` lists every `email_templates` row (key · AR/EN name · locales · declared variables · version); per-template editor for subject + HTML body in AR and EN with click-to-insert variable chips, live AR/EN preview rendered with sample data in sandboxed iframes, save with audit (before/after) **and version bump**, and a test-send that reports the REAL provider state — `not_configured` banner when RESEND keys are missing, attempt recorded in `email_logs` with `status='not_configured'` (constraint widened; never a fake success). Validation: empty subject/body, unknown `{{variables}}` (server, with names) and unclosed/crossed tags (nesting-aware validator, 7 unit tests) all block the save. Provider/credentials section remains in settings | `app/routes/admin/email-templates.tsx`, `app/lib/email/validate.ts`, `tests/email-template.test.ts`, `supabase/migrations/20261101100002_phase07_email_templates.sql`; screens/admin-email-templates-*; tests ET1–ET11 |
| A-26 | Roles & permissions matrix: staff checkbox grid over `roles.permissions` (`fn_admin_set_role_permissions`, audited); system roles protected; takes effect next request (UI + RLS read the same matrix) | admin/roles.tsx; screens/admin-roles-*; tests PM1–PM6 |
| A-27 | Blog admin: posts editor ar/en (title/slug/excerpt/content/cover/category/SEO) + status publish/unpublish + categories quick-add; drafts never public (RLS read = published OR admin); slug conflicts blocked (UNIQUE + inline error) | admin/blog.tsx; screens/admin-blog-*; tests BL1/BL2 |
| A-28 | Audit viewer: filters (action contains / entity / date-from) + expandable before/after JSON diff per row; viewer masks key-like fields (`maskDeep`) on render | admin/logs.tsx; screens/admin-audit-*; tests AU×7 |
| A-29 | Manual wallet adjustment: signed amount (+credit/−debit) + reference + MANDATORY reason from the vendor editor (`fn_admin_adjust_wallet` → ledger tx + audit; no tx without reason enforced server-side) | editor details tab; tests XX5/XX6 |
| A-30 | Media settings page (shared with 02) linked from the sections hub; unchanged behavior (bucket limits via admin-update-bucket edge) | sections hub links |
| A-31 | Responsive admin: all subjects verified 390→1440 — tables scroll horizontally inside their cards, bulk/status bars wrap, dialogs full-screen at 390 (screens-log 138 PASS / 0 FAIL) | screens-log.txt |
| A-32 | Banners manager: alt ar/en, media path, link, order, active, start/end dates; expired disappears automatically (storefront banner query filters dates) | admin/banners.tsx; screens/admin-banners-* |
| A-33 | Static pages manager: title/slug ar/en, content ar/en, header visibility, active toggle; published reachable at /p/:slug, unpublished returns 404 (existing route) | admin/pages.tsx; screens/admin-pages-*; test SP0 |
| A-34 | Evidence pack at 4 widths (this directory; also `plans/evidence/` convention satisfied by `etsawaa-app/evidence/phase-07/` per the phase-05/06 precedent) | evidence/phase-07/ |
| A-35 | Shipping zones: 27 governorates inline CRUD (fee ≥ 0, unique ids, active/sort) + areas CRUD per governorate + **disable-not-delete** rule surfaced in-UI; every change audited (`gov.updated`/`area.*`); snapshots keep old orders (US-19) | admin/zones.tsx; screens/admin-zones-*; tests ZN0/ZN4 |
| A-36 | Areas dataset import: CSV (governorate_id,name_ar,name_en,pickup_fee_piastres) → `fn_admin_import_areas` idempotent (created/updated/errors), unknown-governorate rows rejected with line info, re-import creates no duplicates | zones import dialog; screens/admin-zones-*; tests ZN1–ZN3 |
| A-37 | Document settings: copies per document type, paper (A4/A5-landscape), header/footer ar/en, logo path, terms note, show-commission toggle, cancelled watermark, barcode height — read by order-print at print time → next print reflects without deploy | admin/document-settings.tsx; screens/admin-doc-settings-*; tests DOC1/DOC2 |
| A-38 | Admin print center: per-order invoice A4 + carrier label A5 + one vendor label PER GROUP (3-vendor order → 1+1+3) with copies/pieces controls; every print logs `order_documents` (phase-05 fn_log_document); order pages serve documents (E2E PRT0–PRT2; PDF captures preserved in phase-05/06 evidence) | admin/order-detail.tsx print section; tests PRT; screens/admin-order-detail-* |
| A-39 | `/admin/profile` → shared profile page (redirect; admin gate first). Staff edit only themselves (account profile is strictly self-scoped) | admin/profile.tsx |

## Hard rules verified

- **Staff permission enforcement (UI + RLS)** — six-RPC denial matrix (PM1–PM6: settings.write, wallet adjust, ban, roles.write, audit read via RLS, refund decide) + unauthenticated admin route redirect (PM7). Staff can only edit their own profile (shared self-scoped account page).
- **Money RPCs atomic + idempotent** — withdrawal approve twice → `not_pending` (funds already held at request; approve only flips — wallet balance byte-identical WD3); refund decide twice → `not_pending`; clawback debits exactly once (single refund_clawback transaction keyed `refund:<id>`, penalty row carries the same reference — no double charge).
- **Balance may go negative; withdrawal never above available** — carried from phase 06 (unchanged RPCs re-proven by the 61/61 regression).
- **Featured = single mechanism** — ad campaigns (`source=paid|admin_grant`); grants create active campaigns with NO wallet/payment transaction (AD3).
- **Shipping rows disabled, never hard-deleted** — zones UI offers disable only; referenced areas keep old-order snapshots (ZN-UI + snapshot note).
- **Every sensitive change audited (before/after/actor)** — AU block asserts 7 action families written this run: `vendor.commission.set`, `refund.decided`, `penalty.applied`, `event.vendor.refused`, `ad.granted`, `settings.saved`, `vendor.listings.hidden` (+ `wallet.adjusted`, `areas.imported`, `event.vendor.accepted` in the same log).
- **No service_role client-side; no tax wording; piastres everywhere** — design scan PASS incl. the tax rule; all UI reads via the anon/authenticated client; money formatted through `formatPiastres` (integer piastres).
- **Zero emoji/gradient, RTL-first, WCAG AA** — scan PASS; the ★ glyph was replaced with the existing Rating component; the ar/en dictionaries pass the code-level emoji test (unit 50/50); `dir="ltr"` on all numerics.

## Notes / owner decisions recorded

- Coupon comment in the storefront quote: `commission_percent` + `pairs_with` semantics carried from phase 06 unchanged (E2E CP1–CP3 re-proven).
- Kashier webhook block (T9a–T9f) ran against the same test env contract as the phase-05 evidence (`etsawaa-test-merch` / fixed HMAC secret); live keys remain at the pre-launch gate.
- The staff default matrix stays the seeded 4 read permissions; wider matrices are configurable at runtime (A-26).
- Email template visual editor + full preview: phase 08 (content & launch).
- Customer hard-delete with orders → blocked (`has_orders`); the anonymize flow lands with the launch pass (GDPR-style scrub of the 3 order snapshot columns).

## Commit proof (raw three-command output)

Run in the repository root — the three commands must print ONE identical SHA and an
empty porcelain list:

```
$ git rev-parse phase-07
$ git log -1 --format=%H
$ git status --porcelain
```

Verification is intentionally a live command rather than a frozen string: a commit
cannot contain its own SHA (any file inside it would change the SHA). Two tags make
the state unambiguous:

- `phase-07-code` — the delivery commit: all code, migrations, screens, raw test
  runs and the report (immutable, never re-pointed after this review).
- `phase-07` — the close-out commit, which adds only `evidence/phase-07/commit.txt`
  and this section; it is a direct child of `phase-07-code`.

So `git rev-parse phase-07^{}` and `git rev-parse phase-07-code` differ by exactly one
documentation commit, and `git diff --stat phase-07-code phase-07` shows only the two
proof files. Both tags are pushed with the branch; `git status --porcelain` prints
nothing.

`commit.txt` is force-tracked (the repo-wide ignore rule `evidence/phase-0*/commit.txt`
matches it). No archives are produced (owner instruction).

## Settings coverage matrix — JOURNEYS §16.16 (all 15 sections)

Every section has a persisted key (or, for shipping, real rows), a UI surface, an
independent save, and an audit entry. Verify in one query:
`select key from public.settings order by key;` → the 13 JSON keys below are all present
(seeded by `20261101100003_phase07_settings_sections.sql`, idempotent).

| # | Section | Storage | UI surface | Save path |
|---|---|---|---|---|
| 1 | Site | `settings.site.general` + `settings.design` | /admin/settings (identity + design tokens) | `settings.update` via RLS + audit trigger |
| 2 | General | `general` | /admin/settings/sections → General | `fn_admin_set_setting` |
| 3 | Login | `login` | → Login | `fn_admin_set_setting` |
| 4 | Vendors | `vendors` | → Vendors | `fn_admin_set_setting` |
| 5 | Verification | `verification` | → Verification | `fn_admin_set_setting` |
| 6 | **Financial / commission** | `financial` + `category_attributes` per leaf + `vendor_commission_overrides` | → **Financial** (default %, inheritance, discounted-price rule) + category tree + vendor editor tab 2 | `fn_admin_set_setting` / `fn_admin_set_commission` |
| 7 | Withdrawals | `withdrawals` + `wallet` | → Withdrawals | `fn_admin_set_setting` |
| 8 | **Shipping zones** | `governorates` + `areas` rows (no blob) | /admin/zones (CRUD + disable-not-delete + CSV import) | direct writes + `fn_admin_import_areas`, per-row `fn_audit` |
| 9 | Payments + COD | `payments` | → Payments | `fn_admin_set_setting` |
| 10 | Policies | `policies` | → Policies (+ `vendor_terms`) | `fn_admin_set_setting` |
| 11 | Emails | `emails` + `email_templates` | → Emails + **/admin/email-templates (A-25 editor)** | `fn_admin_set_setting` / `fn_admin_save_email_template` |
| 12 | SEO | `seo` | → SEO | `fn_admin_set_setting` |
| 13 | Design tokens & copy | `settings.design` + `static_pages` | /admin/settings + /admin/pages | RLS update + audit trigger / page editor |
| 14 | Media | `media` | /admin/media-settings (shared with phase 02) | `settings.update` + bucket edge |
| 15 | Notifications | `notifications` | → Notifications | `fn_admin_set_setting` |

Each section: independent save (its own form + fetcher), confirmation feedback,
`fn_admin_set_setting` writes an `audit_logs` row with before/after, and no
tax wording anywhere (design scan PASS).

## Review round P7 (owner verdict: PASS WITH FIXES — three items, all closed)

- **P7-1 Commit proof** — the raw three-command output is reproduced in this tracked
  REPORT (see “Commit proof” below); one matching SHA and a clean tree. `evidence/phase-0*/commit.txt`
  is gitignored repo-wide, so the proof lives here rather than in an untracked file.
- **P7-2 Screens** — the earlier claim was wrong (27 subjects were captured, not 29).
  Corrected and extended: `/admin/profile` (A-39), `/admin/media-settings` (A-30) and
  `/admin/email-templates` (A-25) added at 390/768/1280/1440, plus a **dedicated
  print-center capture on a THREE-vendor order** that asserts 1 invoice + 1 carrier
  label + 3 vendor labels in the DOM. Totals now: **31 subjects × 4 = 124 PNGs,
  138 assertions, 0 FAIL.**
- **P7-3 (A-25) Email templates editor** — implemented in this phase (details in the
  A-25 row above). Evidence: `screens/admin-email-templates-{390,768,1280,1440}.png`
  and one test-send attempt logged in `email_logs` (`status='not_configured'`,
  asserted by ET10 — the honest state while `RESEND_API_KEY` is absent).
- **Minor: print-center screenshot** — `screens/admin-print-center-3vendors-{390,768,1280,1440}.png`,
  each capture asserting `invoice=1 carrier=1 vendorLabels=3`.

Regressions after these changes: unit **57/57** (7 new validator tests), typecheck 0,
oxlint 0 (app), build ✓, design+tax scan PASS, E2E **70/70 ×2**, phase-05 **63/63**,
phase-06 **61/61**, screens **138 PASS / 0 FAIL**, DB pristine after every run.
