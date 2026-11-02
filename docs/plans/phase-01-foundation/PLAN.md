# Phase 01 — Foundation · PLAN

## 1) Goal
A runnable project from day one: design system, auth, roles, settings, RLS, layouts, seeds. Every later phase plugs into this without rework.

## 2) Scope
**In:** React Router 7 framework mode + Vite + TS strict · Tailwind + CSS tokens · 20 UI primitives · i18n ar/en + RTL · Supabase project + first migrations · profiles/roles/user_addresses/governorates/areas/settings/audit_logs · auth (email+password, email OTP, Google) · four layouts · seeds (27 governorates, areas, roles, defaults) · baseline error pages · RLS harness.
**Out:** products, media, orders, payments.

## 3) Decisions
- RBAC from `roles.permissions` jsonb; no permission literals in code.
- `settings` key/value jsonb drives everything, including design tokens.
- Email OTP only; one code screen with channel-aware copy.
- Sign-in by email or phone; phone resolved to email through Edge `resolve-email`.
- Tokens injected in SSR `<style>` from `settings.design`.
- UI: Button, Input, Select, Combobox, Dialog, Drawer, Tabs, Table, DataTable, Stepper, Badge, Card, Toast, Skeleton, EmptyState, Breadcrumbs, Rating, PriceTag, FileUpload, Timeline.
- ErrorBoundary + 404/500 with search and home links; every fetch has loading/empty/error states.

## 4) Architecture
**Tables (10):** profiles (role, phone unique, locale, status) · roles (slug, permissions) · user_addresses · governorates (shipping fee) · areas (pickup fee) · settings (key/value) · audit_logs · notifications · email_logs · email_templates.
**RPC:** `fn_bootstrap_profile`, `fn_admin_set_role`.
**Trigger:** `on_auth_user_created` → create profile with role `customer`.
**Routes:** `/auth/login`, `/auth/register`, `/auth/forgot`, `/auth/verify`; layout shells for public/admin/vendor/account.
**Seeds:** 27 governorates + all areas placeholder fees, default settings (site name, languages ar/en, timezone Cairo, COD cap 5000, hold 14 days), roles admin/staff/vendor/customer.

## 5) Tasks
See `TASKS.md` (F-01 … F-16).

## 6) Acceptance
- Register → OTP → auto sign-in → return to intent works end-to-end.
- Login by email and by phone; forgot-password resets via email OTP.
- Admin can change a role and access actually changes (API test).
- Settings edited in DB reflect on rendered pages (site name, logo, tokens).
- Both languages render with correct direction and no layout break.
- Audit log records role and settings changes.

## 7) Verification gate (phase-specific)
G1 every auth path tested twice · G2 visitor cannot read profiles/roles/settings-private; RLS test per table · G3 zero emoji/gradient, tokens only · G4 inline validation, loading, empty, error, no input loss · G5 390/768/1280/1440 screenshots · G6 auth and panel pages noindex.

## 8) Risks
- SSR/client boundary mistakes → framework-mode conventions only.
- Open settings table → explicit public-key allowlist, everything else admin/staff only.
- Phone login collisions → unique phone index + normalization (+20, strip spaces).
