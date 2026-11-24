# Dimension 2 — Clean Architecture

**Score: 8.0 / 10**

## Strengths

- **Clean dependency direction:** `routes (loader/action) → features (typed api/schemas/server modules) → lib (supabase clients, guards, env, i18n, postgrest guards) → components/ui`. Feature-to-feature imports are only 4, all shallow (`features/account/AddToCartButton.tsx`, `ReorderButton.tsx` → `features/cart/store`; `features/products/components/product-wizard.tsx`, `variant-matrix.tsx` → `features/media/components/media-ui`). **No cycles found.**
- **Single source of routing truth:** `app/routes.ts` (194 lines) — explicit config-based `RouteConfig` array over 5 layout shells; all user-facing URLs nest under `:lang` (`/ar|/en/...`); bare `/` redirects to `/ar`. Locale-agnostic resource routes (`api/cart`, `api/webhooks/kashier`, `robots.txt`, `sitemap.xml`) correctly sit outside the locale prefix.
- **Server/client boundary is architectural, not accidental:** `*.server.ts` naming + request-scoped `createSupabaseServerClient` (`app/lib/supabase/server.ts:38-77`, httpOnly+lax+secure cookies, Set-Cookie forwarding, boot-time TLS warm-up) + module-singleton service-role client (`app/lib/supabase/admin.ts`). Vite config deliberately whitelists only URL/anon key to `VITE_*` (`vite.config.ts:19-29`) so the service role key can never leak to the bundle.
- **Auth as a guard library:** `requirePanelAccess` (`app/lib/auth/guards.ts:77-99`) distinguishes definitive-401 vs transient session staleness (a Supabase blip never logs users out); RBAC matrix in `app/lib/permissions.ts` (51 lines) with permission data in DB `roles.permissions` jsonb.
- **DB as the transactional boundary:** all financial atomicity lives in 22 `security definer` Postgres RPCs (`fn_create_order`, `fn_apply_coupon`, `fn_confirm_payment`, `fn_wishlist_toggle`, …); RLS on essentially every table (77 `enable row level security` vs 74 tables); a dedicated `scripts/rls-test-suite.sql` with 14 assertion tests.
- **SSR-first data flow:** zero `clientLoader`/`clientAction` anywhere; server loaders are the source of truth; client state is deliberately tiny (CartProvider context + localStorage for guest cart/wishlist/compare/recent, `useFetcher` mutations in 55 files).

## Issues needing attention

| # | Finding | Evidence | Impact |
|---|---|---|---|
| A1 | **Component → feature import inversion (11 catalog components)** | e.g. `app/components/catalog/ProductCard.tsx:7` imports `effectivePrice` + `toggleCompare` from `features/discovery/compare`; `CartDrawer.tsx:8` imports `useCart` | UI layer reaching "up" into business logic; mild but contradicts the declared layering |
| A2 | **Staff authorization is panel-granular at the UI layer** | `canAccessPanel("admin")` (`app/lib/permissions.ts:31-40`) admits any `staff` to every admin route; fine-grained `can()` enforced only inside SECURITY DEFINER RPCs | UI-level least privilege depends entirely on DB-side checks; 7 RPCs needed guard prologues per `20261103000001_fix_coupon_anon_and_fn_guards.sql` — evidence the class was real |
| A3 | **`app/root.tsx` imports `~/features/settings/api`** (bootstrap concern) | `app/root.tsx` loader | Acceptable pragmatism, but breaks the strict layer reading (root should sit above features) |
| A4 | **Self-admitted deviation in `app/lib/postgrest.ts`** | module documents PostgREST filter-injection risk and provides guards, yet 4 call sites bypass them (see `04-security.md` §5) | Convention exists but isn't enforced mechanically (no lint rule / type-level barrier) |

## Verdict

This is a genuinely well-layered codebase — the strongest dimension. The architecture correctly pushes transactionality and authorization into Postgres and keeps server secrets behind naming conventions. Deductions are for the mild inversion, panel-granular UI authorization, and a guard convention that isn't machine-enforced.
