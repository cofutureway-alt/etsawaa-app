# Phase 08.5 — Admin & Buyer Experience Hardening · TASKS

> Every task requires: root cause note, evidence path, 4-width screenshots for UI, and a commit.
> No task is done without a test or a documented manual proof.

## Foundation & stability

- [ ] **H-01 Buyer account shell** — Move customer dashboard inside the storefront layout (header/footer/breadcrumbs); add "حسابي" to header user menu + footer; tabs Overview/Orders/Addresses/Wishlist/Reviews/Refunds/Profile; desktop sidebar, mobile tabs; empty/loading/error states.
  - DoD: header/footer visible at 390/768/1280/1440; direct URL works; no standalone layout; keyboard nav.
  - Evidence: 4 screens + route file diff.

- [ ] **H-02 Arabic font everywhere** — Self-host Cairo or IBM Plex Sans Arabic woff2; `@font-face` + `font-display: swap`; preload in root; apply tokens to storefront/admin/vendor/auth; Inter for Latin/numbers; no runtime Google Fonts.
  - DoD: Arabic glyphs on admin/vendor pages; Network tab shows woff2; no FOUT; all layouts.
  - Evidence: network screenshot + 4 screens.

- [ ] **H-03 i18n hardening** — Fix `vendorState.stetus.approved` → `vendorState.status.approved`; add all vendor states AR/EN; add raw-key scanner test (`a-z` + dot + `a-z`) across rendered admin pages.
  - DoD: zero raw keys in approvals and admin scan; test fails on regression.
  - Evidence: test output + screenshot.

- [ ] **H-04 Reviews + reports routes** — Implement `/admin/reviews` (5 tabs, filters, table, pagination 20, detail, publish/reject/spam/delete with reason, rating recalculation) and `/admin/reports` (period/vendor filters, 6 cards, 3 charts, CSV, reconciliation note).
  - DoD: no 404 from sidebar; empty/loading/error states; numbers traceable.
  - Evidence: 4 screens each + SQL/report proof.

- [ ] **H-05 Session stability** — One SSR client/request; refresh cookies in root/middleware; Path `/`, SameSite Lax, Secure prod; never sign out on network/5xx/abort; only invalid refresh token; preserve returnTo.
  - DoD: 30 navigations across expiry without logout; refresh persists; no redirect loop.
  - Evidence: auth test log + cookie trace.

- [ ] **H-06 Eliminate 500s** — Enumerate every menu route; hit each; add route ErrorBoundary + friendly page with error id; log route/user/request id; fix every reproducible 500; config errors show setup message, not 500.
  - DoD: route table all 200 (expected 404 only for unknown URLs); zero 500; regression tests.
  - Evidence: route status table before/after + logs.

- [ ] **H-07 Navigation speed** — Customers page server pagination 20, indexes for search/sort, parallel queries, no N+1; global top progress + route skeleton via `useNavigation`/Suspense; prefetch hover/focus; cancel stale; filters in URL.
  - DoD: skeleton <300ms; first data <1s local; 10-navigation test; no frozen old page.
  - Evidence: timing table + screenshots.

## Money & geography

- [ ] **H-08 Commission tree** — Remove fixed-only UI; `CommissionEditor` with full L1→L2→L3 tree, search, inherit/override, effective %, bulk apply, validation, unsaved guard, audit. Backend `category_commissions`; migration copies old fixed value; orders snapshot leaf commission; coupon `commission_percent` uses same; vendor override separate.
  - DoD: two categories with different % compute correctly; coupon math; old order unchanged; audit; vendor preview.
  - Evidence: SQL proof + order rows + 4 screens.

- [ ] **H-09 Shipping governorates + areas** — Fix grid: explicit columns (AR/EN, shipping fee EGP, areas count, active, actions); editable fee (inline or dialog); one sticky save/row dialog; drag handle order; no exposed sort numbers; remove 5000 (COD cap belongs payment settings); add `/admin/shipping/:gov/areas` CRUD (name AR/EN, pickup fee, active, sort, search, unique per gov, disable if referenced, CSV import).
  - DoD: Cairo fee 75 → new checkout 75; old order snapshot; no 5000; 27 gov/572 areas; CSVs idempotent; 4 widths.
  - Evidence: DB before/after, checkout screenshot, area screens.

## Admin CRUD

- [ ] **H-10 Attributes CRUD** — Category tree → attribute groups → definitions; add/edit/delete/select; types text/number/enum/color; units; required/filterable/variant axis; options CRUD; reorder; delete blocked if used; audit; vendor read-only dictionary.
  - DoD: create color/size; render in vendor form; delete blocked when used.
  - Evidence: CRUD screens + test.

- [ ] **H-11 Penalties CRUD** — Rules CRUD (soft delete), applications list, manual apply from vendor, waive with reason, wallet transaction, audit, stats/filters.
  - DoD: penalty creates exactly one wallet row; history retained; reason required.
  - Evidence: wallet rows + screens.

- [ ] **H-12 Levels & badges** — CRUD thresholds/rewards/icon; preview; manual promote/demote with reason; history; overlap validation; consistent cards/table.
  - DoD: reward changes affect future calculations only; history visible.
  - Evidence: screens + test.

- [ ] **H-13 Audit logs** — Translate action/entity/field via i18n map; server pagination 20/page; filters actor/action/entity/date; detail drawer; mask sensitive; export.
  - DoD: no raw keys; max 20 rows; count/pagination correct.
  - Evidence: screens + query plan.

- [ ] **H-14 Shipping requests** — Remove withdrawals block; link to separate page; tabs/status; table vendor/area/pieces/fee/date; approve/reject reason; bulk; stats; empty states.
  - DoD: no withdrawal section; link works; actions audited.
  - Evidence: 4 screens.

- [ ] **H-15 Withdrawals** — Stats cards (pending count/amount, approved, paid, rejected), filters/search, table, pagination 20, detail drawer, approve/cancel reason, CSV export, full translations.
  - DoD: money moves once; audit; translations complete.
  - Evidence: screens + wallet proof.

- [ ] **H-16 Coupon form** — Dialog/Drawer sections (basics, value, scopes, limits, validity, advanced); code generator; preview; validation; types product_percent/product_fixed/commission_percent/free shipping; explain commission_percent.
  - DoD: invalid combos blocked; used coupon edits don't rewrite history; 4 widths.
  - Evidence: screens + validation tests.

## Marketing

- [ ] **H-17 Ads** — DataTable + stats; package CRUD in Dialog; campaigns; admin grant Dialog (not dropdown); placement/slots/dates; source paid/admin_grant; audit.
  - DoD: grant creates active campaign with source=admin_grant and no payment.
  - Evidence: screens + DB row.

- [ ] **H-18 Events** — Same pattern; Black Friday preset; category discounts; vendor refusals; manual hide with confirm; stats.
  - DoD: refusal hides products publicly in one request cycle; opt-in returns.
  - Evidence: public listing before/after.

- [ ] **H-19 Banners** — Same pattern; MediaPicker; placements; dates/order/active; preview; expired auto-hide.
  - DoD: expired banner disappears; preview matches published.
  - Evidence: screens + runtime proof.

## Design & QA

- [ ] **H-20 Design system + QA** — Invoke `ui-ux-pro-max` before UI; Dialog/Drawer/DataTable/StatusBadge/EmptyState/Skeleton; no primitive inline/dropdown create forms; flat tokens, zero gradients/emojis, RTL, WCAG AA; 4 widths; confirm+reason+audit for destructive actions.
  - DoD: all changed pages consistent; screens 390/768/1280/1440; keyboard/focus.
  - Evidence: design report + screen matrix.

## Phase gates
- G1 foundation · G2 buyer · G3 money/geography · G4 CRUD · G5 design · G6 QA.
- e2e twice (distinct md5) + p5/p6 regressions + unit + route smoke + i18n scan + commit proof.
- Report H-01…H-20: status, root cause, evidence, commit.
- No Phase 09 import. No launch. No ZIP.
