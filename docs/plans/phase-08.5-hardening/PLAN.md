# Phase 08.5 — Admin & Buyer Experience Hardening

## 1) Status & context
- Phase 08 is PASS (code/content/UX); launch is **NO-GO** (B4 LCP + B5 integration + L-18).
- Phase 09 (data import) is **PAUSED** until this phase passes.
- Trigger: owner walkthrough found 20 issues across buyer account, admin CRUD, i18n, fonts, auth, routing, performance, commission and shipping geography.
- This is a hardening phase, not a redesign of the business model.

## 2) Goal
Make the admin and buyer surfaces stable, fast, consistent and operable:
- no raw i18n keys, no 500s, no random logouts, no 404 menu links;
- Arabic typography everywhere;
- correct commission and geography editing;
- every admin entity has real CRUD via dialogs, not primitive inline/dropdown forms;
- buyer account lives inside the storefront shell;
- consistent design system at 390/768/1280/1440.

## 3) Non-goals
- No Phase 09 catalog import.
- No production launch, no public market opening.
- No server migration / R2 / Cloudflare Images in this phase.
- No new business rules beyond fixing commission + geography as specified.
- No full visual rebranding; use existing tokens and components.

## 4) Issue register (H-01 … H-20)
| ID | Owner issue | Severity | Workstream |
|---|---|---|---|
| H-01 | Buyer dashboard outside header/footer + weak UX (1) | P0 | Buyer |
| H-02 | Arabic font missing on admin/vendor dashboards (2) | P0 | Foundation |
| H-03 | Raw key `vendorState.stetus.approved` (3) | P0 | Foundation |
| H-04 | Reviews and reports return 404 (11, 14b) | P0 | Admin routes |
| H-05 | Random logout during navigation (15) | P0 | Foundation |
| H-06 | Many pages return 500 (16) | P0 | Foundation |
| H-07 | Customers/navigation slow; no skeleton (17) | P0 | Performance |
| H-08 | Commission is fixed-only; needs category tree (19) | P0 | Money |
| H-09 | Shipping zones fee not editable; 5000/sort noise; no areas page (18, 20) | P0 | Geography |
| H-10 | Attributes page has no add/edit/delete/select (10) | P1 | Admin CRUD |
| H-11 | Penalties page poor; no CRUD (12) | P1 | Admin CRUD |
| H-12 | Levels & badges primitive; no usable CRUD (13) | P1 | Admin CRUD |
| H-13 | Logs untranslated; loads too many rows (14a) | P1 | Admin CRUD |
| H-14 | Shipping requests primitive; withdrawals block duplicated (4) | P1 | Admin CRUD |
| H-15 | Withdrawals untranslated; no stats; weak design (5) | P1 | Admin CRUD |
| H-16 | Coupon form primitive (6) | P1 | Admin CRUD |
| H-17 | Ads page/package/grant design rejected (7) | P2 | Marketing |
| H-18 | Events page same as ads (8) | P2 | Marketing |
| H-19 | Banners page same as ads/events (9) | P2 | Marketing |
| H-20 | Cross-cutting design system + QA (all) | P0/P1 | Design |

## 5) Workstreams
### A. Foundation
Font, i18n scanner, auth/session, 500 elimination, route smoke, navigation skeletons, reviews/reports routes.

### B. Buyer
Account route inside storefront layout; tabs; overview; responsive; empty/loading/error states.

### C. Money & geography
Commission tree with inheritance and order snapshots; shipping governorates with editable fees; areas CRUD; CSV import; COD cap separated from shipping.

### D. Admin CRUD
Attributes, penalties, levels, logs, coupons, shipping requests, withdrawals, reviews, reports: list + filters + pagination + dialog forms + destructive confirmations + audit.

### E. Marketing
Ads, events, banners: packages/campaigns/grants/presets/media/dates/order/active; dialog-based create/edit; DataTable; stats.

### F. Design system & QA
Dialog/Drawer, DataTable, StatusBadge, EmptyState, Skeleton, form sections, sticky save, responsive tables; tokens only; zero gradients/emojis; RTL-first; WCAG AA.

## 6) Key architecture decisions
### Commission
- New `category_commissions(category_id, percent, updated_by, updated_at)` (or an existing category column if already present).
- Any node may hold a percent; children inherit unless they have an explicit override.
- **Orders use the effective commission of the leaf category only.**
- Migration copies the previous fixed commission into the default/leaf values so behavior does not silently change.
- Order lines snapshot the effective percent at creation; editing affects new orders only.
- Vendor override (inherit / fixed / category) remains a separate vendor tab with next-order preview.
- Coupons with `commission_percent` use the same effective commission.

### Geography
- `governorates.shipping_fee_egp` and `areas.pickup_fee_egp` are explicit columns; `cod_max` belongs to payment settings and must never render in the shipping table.
- Unique area name per governorate; duplicate names across governorates allowed.
- Referenced governorates/areas are disabled, never hard-deleted; new orders use new fees; existing orders keep snapshots.
- The grid has explicit column definitions; no implicit array order, no per-row save noise, no exposed sort numbers.

### Auth
- One Supabase SSR client per request; cookie refresh in root/middleware.
- Sign out only on definitively invalid refresh token; never on network/5xx/abort.
- Preserve returnTo; no redirect loops.

### i18n & font
- Self-host Arabic woff2; preload; apply to every layout.
- Raw-key scanner in tests; zero occurrences.

## 7) Acceptance gates
- **G1 Foundation:** font loaded on all layouts; zero raw i18n keys; 30 navigations without logout; all menu routes 200; zero 500 in smoke.
- **G2 Buyer:** account inside header/footer at 4 widths; tabs and states work.
- **G3 Money:** commission math proof for two categories + coupon + snapshot; shipping fee edit reflected in checkout; old orders unchanged; 27 governorates / 572 areas.
- **G4 CRUD:** attributes, penalties, levels, coupons, areas, ads, events, banners support add/edit/delete/disable with confirm + audit.
- **G5 Design:** dialogs/tables/stats; flat tokens; zero gradients/emojis; RTL; WCAG AA; 4 widths.
- **G6 QA:** e2e twice, p5/p6 regressions, unit, i18n scan, route smoke, screenshots, commit proof.

## 8) Evidence
`phase-08.5/evidence/`: screenshots 390/768/1280/1440; route status table; auth test log; i18n scan; commission SQL/order proof; shipping checkout proof; CRUD logs; test logs; commit SHA/tag.

## 9) Risks & mitigations
- Commission migration changes money math → migrate old fixed value as default, snapshot on order, test before/after.
- Shipping fee confusion with COD cap → separate labels/columns, remove 5000 from shipping, add test.
- Auth changes can log users out → staged cookie changes, 30-navigation test.
- Large refactor → workstream commits, no unrelated redesign.
- CRUD deletion breaks history → soft delete/disable + reference checks.

## 10) Delivery
- One phase, ordered workstreams; separate commits per workstream.
- Report H-01…H-20 with status, root cause, evidence, commit.
- No ZIP. No Phase 09 import. No launch.
