# Dimension 3 — Code Quality

**Score: 7.5 / 10**

## Strengths

- **Exceptional hygiene floor.** Counts across the entire `app/` tree (230 files): `TODO`/`FIXME`/`HACK` **0**, `console.log` **0** (13 tagged `console.error/warn` at error paths only), `debugger` **0**, `@ts-ignore`/`@ts-expect-error` **0**, `: any`/`as any` **0**. This is rare.
- **TypeScript strictness is real:** `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames`. Only 8 non-null `!.` assertions in the whole app (e.g. `app/features/orders/api.ts:175-176`, `app/routes/checkout.tsx:894`).
- **Zero empty catch blocks** (83 catches total; the terse ones carry intent comments, e.g. `app/features/cart/store.tsx:35,113,125`).
- **Robust client-state parsing:** every `JSON.parse(localStorage…)` is wrapped in try/catch with shape validation and qty clamping (`app/features/cart/store.tsx:18-30`, `app/features/discovery/recent.ts:16-28`, `compare.ts:12`).
- **`key={index}` usage (22 sites) is nearly all legitimate** static lists (skeletons, rating stars, breadcrumbs, timeline).
- **Error boundaries near-universal:** root `ErrorBoundary` renders standalone 404/500/403 documents with locale detection (`app/root.tsx:110-132`); a shared `RouteErrorBoundary` (correlationId + `console.error`) is imported by 66 route files.

## Issues needing attention

| # | Finding | Evidence | Impact |
|---|---|---|---|
| Q1 | **41 `as unknown as` casts** disabling type safety on Supabase embedded-join payloads — one systematic idiom `((rows ?? []) as unknown as Row[])` | concentrated in `app/routes/admin/*` (coupons, customers, levels, penalties, refunds, shipping, withdrawals, zones, dashboard, order-detail, reviews, events, ads) + `app/features/orders/api.ts` (7) | DB payload shape changes compile silently; a shared typed mapper would eliminate most |
| Q2 | **17 suppressed `react-hooks/exhaustive-deps`** | clustered in `app/features/products/components/product-wizard.tsx` (4), `app/routes/vendor/onboarding.tsx` (4), `app/routes/checkout.tsx` (3) — the deliberate-narrow-deps + ref pattern (e.g. `checkout.tsx:279-322`) is a classic stale-closure risk zone | Highest-probability latent bug class in the repo |
| Q3 | **86 i18n literal ternaries** bypassing the translation system | see `01-maintainability.md` M2 | Inconsistent style; un-auditable strings |
| Q4 | **Inline design-system residue:** 24 inline `style={{ }}` sites | Tailwind utilities are the norm; CI `scripts/scan-design.mjs` bans emoji/gradients/raw hex — the 24 inline sites predate/evade it | Minor inconsistency |
| Q5 | **`JSON.parse(JSON.stringify(...))` deep clone** | `app/routes/admin/levels.tsx:57` | Trivial: `structuredClone` |
| Q6 | **Missing return type on one export** | `breadcrumbLd` at `app/lib/seo.ts:61` | Trivial |

## Tests

- **Unit-strong, integration-outsourced:** `tests/` = 16 files, ~102 `test()` cases (node:test + tsx), all pure-function: money, pricing/event-discount, phone normalization, permissions, tokens/contrast, i18n key parity, postgrest helper, safe redirects (`next.ts`), OTP cooldown, session headers, auth schemas, store filters, coupon scopes, email template, variants, compare. CI (`.github/workflows/verify.yml`) runs them plus typecheck + lint + build + design scan.
- **Gap:** no React component tests, no route/loader tests in CI. The 10 `scripts/test-phase*.mjs` E2E suites (extensive: checkout fraud, RLS isolation, webhook idempotency) require a live DB + Chrome and run **manually only**.
- Verdict: "good core math, unguarded UI/integration surface."

## Verdict

The hygiene floor (zero any/TODO/console.log/ts-ignore) is the best I've measured in a codebase this size. Quality is deducted mainly for the systematic `as unknown as` typing escape hatch on DB payloads and the suppressed hook-deps clusters in the three wizard files — both addressable.
