# Etsawaa App — Phase 01 Foundation

Multi-vendor marketplace foundation: React 19 + React Router 7 (framework mode, SSR) + TypeScript strict +
Tailwind v4 tokens + real Supabase (Postgres/Auth/RLS). Arabic-first (RTL) with English.

## Quick start

```bash
npm install
cp .env.example .env        # then fill SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
npm run dev                 # http://localhost:3000 (redirects to /ar)
```

Production:

```bash
npm run build
npm run start               # node --env-file=.env react-router-serve build/server/index.js
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with SSR |
| `npm run build` | Production build (client + server) |
| `npm run start` | Serve the production build (loads `.env` via Node `--env-file`) |
| `npm run typecheck` | `react-router typegen && tsc` (strict) |
| `npm run lint` | oxlint over app/scripts/tests |
| `npm test` | Unit suites: phone normalization, RBAC, tokens/AA contrast, i18n key parity, auth schemas, OTP cooldown, money |
| `node --env-file=.env scripts/test-phase1-e2e.mjs` | Functional suite against the real Supabase project |
| `node scripts/scan-design.mjs` | G3 gate: zero emoji / zero gradients / no raw hex outside tokens |

## Database (Supabase)

- Migration: `supabase/migrations/20261029000000_phase01_foundation.sql`
  (roles, profiles, user_addresses, governorates, areas, settings, audit_logs, notifications,
  email_logs, email_templates + RLS + grants + triggers + RPCs `fn_resolve_email_from_phone`,
  `fn_bootstrap_profile`, `fn_admin_set_role`).
- Seed: `supabase/seed/seed.sql` — 27 governorates, areas scaffold, 4 roles,
  `site.general` + `settings.design`, welcome email template.
- RLS test suite: `scripts/rls-test-suite.sql` (14 assertions, run as postgres).

Apply with the Supabase CLI (`supabase db push` + `supabase db reset`) or run the files as
postgres via the SQL editor / Management API.

## First admin bootstrap

The `handle_new_user` trigger gives every new user the `customer` role. Promote the first
admin once, as postgres:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Then manage roles from `/ar/admin/users` (audited by `fn_admin_set_role`).

## Structure

```
app/
├─ routes/          # lang-prefixed routes (/ar, /en): home, auth/*, account, vendor, admin, ui
├─ layouts/         # public / auth / account / vendor / admin shells (server-side guards)
├─ components/ui/   # the 20 foundation primitives (F-04)
├─ features/        # auth schemas+otp, settings, notifications (bell + realtime)
├─ lib/             # supabase server/browser/admin clients, guards, tokens, phone, money, email, audit
└─ styles/          # tokens.css (brand palette) + globals.css (Tailwind v4 mapping)
supabase/           # migration + seed
scripts/            # e2e suite, RLS SQL suite, design scanner
tests/              # node:test unit suites
evidence/phase-01/  # G1–G6 artifacts (this phase's verification)
```

Design tokens are editable from `/ar/admin/settings` — they are stored in
`settings.design` and injected server-side by the root loader, so changing a color in the
database restyles the site with no deploy.
