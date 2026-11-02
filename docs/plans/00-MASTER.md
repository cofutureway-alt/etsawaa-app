# 00 — MASTER PLAN (phases & verification)

> This file governs every phase. No phase is "done" without documented verification.

## Non-negotiables
- No agent/developer may say "done" before **G1–G6** pass with evidence.
- A weak UX cannot be justified as "fine" — G4 criteria decide, not opinion.
- Any defect found in an earlier phase is fixed the same day plus a regression test.

## Verification gates G1–G6 (mandatory per phase)
| Gate | What is checked | Evidence |
|---|---|---|
| G1 Functional | Every acceptance item in the phase file | Signed checklist + repro steps |
| G2 Data/Security | RLS per new table · no service_role client-side · atomic RPCs · constraints | SQL test results (before/after) |
| G3 Design | Zero emoji · zero gradients · tokens only · correct RTL | Screenshots + code scan (hex/gradient/emoji) |
| G4 UX | ≤3 clicks for the core task · skeletons · empty states · human errors · confirmations | Written scenario + screenshots |
| G5 Responsive | 390 / 768 / 1280 / 1440 · no horizontal scroll · nav works · tables become cards | 4 screenshots per main screen |
| G6 SEO/Perf | SSR + meta + schema (public) · noindex panels · LCP<2.5s · srcset | Lighthouse + Rich Results test |

## Phase folder structure
Every phase lives in `plans/phase-XX-<name>/` and contains exactly three documents:
1. `PLAN.md` — deep implementation plan: goal, scope, decisions, architecture, acceptance, gates, risks.
2. `TASKS.md` — every task with ID, dependencies, and per-task definition of done.
3. `USER-STORIES.md` — complete user stories with acceptance criteria and edge cases ("boring detail").

## Dependency map
```
01 Foundation ─► 02 Media + catalog setup ─► 03 Vendor core ─► 04 Storefront
                                                        └► 05 Checkout & orders
                                                              └► 06 Vendor ops (wallet/shipping)
                                                                    └► 07 Admin suite
                                                                          └► 08 Launch
```

## Phase table
| # | Phase | Folder | Exit condition |
|---|---|---|---|
| 01 | Foundation | `phase-01-foundation/` | Auth/roles/settings work + G1–G6 |
| 02 | Media + catalog setup | `phase-02-media-catalog/` | Folder upload + picker everywhere + categories/attributes |
| 03 | Vendor core | `phase-03-vendor-core/` | Vendor signs up, verifies, publishes a product with variants |
| 04 | Storefront | `phase-04-storefront/` | Browse/search/product/store/cart complete |
| 05 | Checkout & orders | `phase-05-checkout-orders/` | Full Kashier/COD order + COD rules + emails |
| 06 | Vendor ops | `phase-06-vendor-ops/` | Shipping/pickup/wallet/withdrawals/refund view |
| 07 | Admin suite | `phase-07-admin-suite/` | Every admin page, settings, ads/levels/events |
| 08 | Content & launch | `phase-08-launch/` | SEO complete + QA + RLS audit + launch |
