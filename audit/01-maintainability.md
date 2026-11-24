# Dimension 1 — Maintainability

**Score: 7.5 / 10**

## Strengths

- **Consistent naming & conventions.** kebab-case route files mirroring URLs (`app/routes/`, 112 files), PascalCase components (`app/components/`, 51), feature modules with a fixed vocabulary: `api.ts` (typed reads), `*.server.ts` (secret ops), `schemas.ts` (zod), `store.tsx` (context). The `.server.ts` suffix convention makes the server/client boundary visible in the filename.
- **Documentation is unusually rich:** `README.md`, `docs/ARCHITECTURE.md`, `docs/AGENT.md` (locked engineering decisions), `docs/plans/00-MASTER.md` + 12 phase specs, evidence reports, and 10 Arabic self-audit reports under `docs/التقارير/`. Migrations carry header banners and `comment on table` statements.
- **Centralized primitives:** money (`app/lib/money.ts`, integer piastres), phone (`app/lib/phone.ts`, E.164 +20), SEO/JSON-LD (`app/lib/seo.ts`), design tokens (`app/lib/tokens.ts`), postgrest guards (`app/lib/postgrest.ts`). Future modifications touch one place.
- **Static i18n with parity tests:** `app/lib/i18n/ar.ts` (2062 lines) / `en.ts` (2065), 3124 `t()` call sites, `tests/i18n-keys.test.ts` enforces key parity in CI.

## Issues needing attention

| # | Finding | Evidence | Impact |
|---|---|---|---|
| M1 | **7 god-files over 600 lines** mixing loader + action + multi-step UI in one module | `app/routes/vendor/onboarding.tsx` (1147), `app/features/products/components/product-wizard.tsx` (1105), `app/routes/checkout.tsx` (922), `app/features/media/components/media-ui.tsx` (790), `app/routes/admin/order-detail.tsx` (736), `app/routes/admin/catalog/attributes.tsx` (721), `app/layouts/public.tsx` (713) | Hardest files to modify safely; merge conflicts; hidden coupling between steps |
| M2 | **86 i18n bypass ternaries** (`en ? "…" : "…"`) despite complete i18next setup | worst: `app/routes/admin/orders.tsx` (16 sites), `admin/dashboard.tsx` (12), `vendor/reports.tsx` (8), `layouts/admin.tsx` (7); Arabic data literals at `app/routes/compare.tsx:65-66` | Inconsistent translation workflow; keys can't be audited; parity test blind to them |
| M3 | **Doc drift:** `docs/AGENT.md` stack table claims TanStack Query + Framer Motion — neither is installed | stale comment also at `app/features/notifications/NotificationBell.tsx:9` | Misleads contributors and future AI sessions |
| M4 | **No logger module** — 13 tagged `console.error/warn` calls at error paths, no levels/destinations | e.g. `app/lib/email/server.ts`, `app/routes/api/webhooks/kashier.ts` | Hard to evolve to structured logging later |
| M5 | **51 one-off `scripts/*.mjs`** verification harnesses (screenshots, E2E, perf) of varying durability | `scripts/scan-design.mjs` is CI-wired; others are per-phase artifacts | Script sprawl; unclear which are canonical tooling |

## Verdict

Strong conventions and exceptional docs put this well above typical; the deductions are concentrated in a handful of oversized route/wizard files and the i18n bypass residue. Both are mechanical to fix.
