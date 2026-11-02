# Phase 07 — Admin Suite · PLAN

## 1) Goal
One control panel that runs the marketplace end-to-end: approvals, money, marketing, content, settings — nothing requires database access.

## 2) Scope
**In:** dashboard · withdrawals · vendors (3 tabs/ban/hide/penalty) · products & approvals · orders · customers · coupons · catalog · reviews · refunds · penalties · levels · ads · events · reports · settings (15 sections) · roles/users · blog · audit logs · media settings · banners · static pages · **shipping zones (governorates + areas, CRUD + import)**.
**Out:** launch polish + final SEO (08).

## 3) Decisions
- Every list uses the shared `DataTable` (filters, sort, bulk, export).
- Destructive actions = confirm dialog + mandatory reason where applicable; everything audited.
- Commission per leaf category + vendor override (inherit/fixed/category).
- Refund decision final by admin; vendor executes.
- Ads: paid package or admin grant (`source`), never credit.
- Events: Black Friday default (all November); vendor refusal hides their products from home/listings and excludes discounts; manual hide with confirm.
- COD cap default 5,000 (setting) + vendor-shipping block (fixed).

## 4) Architecture
**Tables:** all previous + coupons/scopes · reviews · refunds · penalties · levels · ads · events · blogs · settings · roles · media.
**RPC:** `fn_admin_set_commission` · `fn_admin_apply_penalty` · `fn_admin_adjust_wallet` · `fn_admin_decide_refund` · `fn_admin_approve_withdrawal` · `fn_admin_grant_ad` · `fn_event_optout` · `fn_hide_vendor_listings` · `fn_publish_blog` · `fn_promote_vendor_level`.
**Routes:** `/admin/*` (see JOURNEYS §16).
**Components:** StatsCard · ChartCard · DataTable · StatusBadge · MoneyInput · CommissionEditor · CouponForm · SettingsForm · EmailTemplateEditor · ImageField · ConfirmDialog · LevelEditor · PackageEditor · EventEditor.

## 5) Tasks
See `TASKS.md` (A-01 … A-38).

## 6) Acceptance
Every dashboard number matches a documented query · approving a withdrawal moves money once · penalty creates a wallet transaction with reason · event refusal hides products publicly · commission change affects new orders only (unless explicitly backdated) · every settings section saves independently · audit log covers all sensitive actions · shipping-zone edits affect only new orders and referenced rows are disabled, never hard-deleted · the full areas dataset imports idempotently.

## 7) Verification gate
G1 one scenario per page · G2 staff with limited permissions sees only permitted routes/actions · G3 tokens only · G4 big tables → cards on mobile, filters usable one-handed · G5 four breakpoints · G6 noindex + no PII in logs.

## 8) Risks
Settings sprawl → sectioned forms + explicit save per section · money errors → atomic RPCs + idempotency · accidental destructive action → confirm + reason + audit.
