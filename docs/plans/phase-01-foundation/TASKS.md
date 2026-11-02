# Phase 01 — Foundation · TASKS

Legend: ID · task · depends on · definition of done (DoD).

## Setup
- [ ] **F-01** Initialize React Router 7 framework mode + Vite + TS strict. DoD: dev/build/typecheck/lint pass in CI script.
- [ ] **F-02** Tailwind + tokens.css + token provider from `settings.design`. DoD: changing a token in DB changes the rendered page without code edits.
- [ ] **F-03** i18n (ar/en) + direction switch + language-prefixed routes. DoD: deep-link keeps page, direction flips, no missing keys in either language.
- [ ] **F-04** UI primitives (20) + preview page. DoD: every component has states idle/hover/focus/disabled/loading and RTL verified.

## Data & security
- [ ] **F-05** Migrations: profiles/roles/settings/governorates/areas/audit_logs/notifications/email_logs/email_templates (10 tables). DoD: migration up/down works, indexes present.
- [ ] **F-06** RLS + grants for all ten tables. DoD: role matrix test script passes for guest/customer/vendor/staff/admin.
- [ ] **F-07** Seeds. DoD: 27 governorates, areas scaffold, four roles, default settings.
- [ ] **F-08** Audit log helper + triggers on role/settings changes. DoD: before/after JSON recorded with actor.

## Auth
- [ ] **F-09** Email+password register with OTP verify. DoD: resend throttled, change-email path works.
- [ ] **F-10** Login by email/phone; phone→email resolver. DoD: both paths land in the same session; invalid phone rejected.
- [ ] **F-11** Forgot-password via email OTP. DoD: OTP expiry enforced; old password invalid after reset.
- [ ] **F-12** Google OAuth; new Google users must add phone + accept terms. DoD: existing email merges without duplicate profile.

## Shells
- [ ] **F-13** Four layouts (public/account/vendor/admin) + route guards. DoD: unauthorized user is redirected, never sees a flash of protected UI.
- [ ] **F-14** ErrorBoundary + 404/500 pages. DoD: simulated route error shows friendly page with retry.
- [ ] **F-15** Skeleton/EmptyState/Toast wiring at layout level. DoD: any query has a visible loading and empty state by default.
- [ ] **F-16** Baseline RLS + auth e2e tests. DoD: all scenarios run in CI; failures block merge.
- [ ] **F-17** Notifications infrastructure: `notifications` + `email_logs` tables, in-app bell/center shell, Realtime channel, mark-as-read. DoD: a test notification reaches only its user and survives refresh.
- [ ] **F-18** Email provider wiring (Resend default + SMTP switch) with one system template (welcome). DoD: test email delivered and logged in `email_logs`.
