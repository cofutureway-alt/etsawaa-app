# Phase 07 — Admin Suite · USER STORIES

## US-01 · Admin · morning dashboard
As an admin, I open the dashboard and know what needs attention.
- AC: four quick-action cards with counts → filtered lists; sales/deep stats cards each open a detail page; monthly overview filterable by month/year; daily chart 7/30/90; all-time stats; top vendors with level rank; top-rated products.
- Edge: empty data → zero-state cards with "no data for this period", never blank charts.

## US-02 · Admin · withdraw approval
As an admin, I approve a vendor withdrawal.
- AC: request shows vendor balance, method, details; approve requires confirmation; wallet decreases once; vendor notified; audit recorded.
- Edge: insufficient balance due to concurrent adjustment → blocked with explanation.

## US-03 · Admin · edit vendor
As an admin, I edit a vendor's permissions and commission.
- AC: three tabs work independently; commission modes inherit/fixed/category with per-leaf values; changes apply to new orders; audit with before/after.
- Edge: switching mode shows a preview of the next order's commission.

## US-04 · Admin · hide a vendor
As an admin, I hide a vendor's products from listings.
- AC: confirm dialog explains effect; products disappear from home/listings/search; store page remains with a notice; reversible.
- Edge: hidden vendor's products in existing carts show unavailable at checkout.

## US-05 · Admin · decide a refund
As an admin, I review a refund request and decide per item.
- AC: see evidence, choose fault (vendor/shipping/customer/defect), amount, restock; approve → vendor notified; vendor-fault creates penalty + clawback; shipping-fault creates no vendor charge.
- Edge: partial approval leaves remaining items closed with reasons; cannot approve twice.

## US-06 · Admin · apply penalty manually
As an admin, I apply a penalty from the vendor page.
- AC: amount + reason required; wallet transaction with reference; vendor sees it.
- Edge: waiving later reverses with a distinct transaction, not deletion.

## US-07 · Admin · coupon builder
As an admin, I create a complex coupon.
- AC: code generate; percent/fixed; free shipping (admin only); scopes include/exclude by vendor/category/brand/product; min/max; per-coupon/per-user/item limits; stackable; exclude sale items; validity; owner shown.
- Edge: conflicting scopes warned before save; editing a used coupon doesn't rewrite history.

## US-08 · Admin · review moderation
As an admin, I moderate reviews.
- AC: tabs All/Pending/Published/Spam/Trash; approve/reject/spam/delete with reason; product rating recalculated.
- Edge: deleting a review used in reports keeps aggregates consistent.

## US-09 · Admin · levels
As an admin, I configure silver/gold rewards.
- AC: threshold orders; rewards (commission discount, ad package, hold days, featured days); icon; manual promote/demote with reason; history visible.
- Edge: lowering a threshold doesn't retro-promote until the next cron run (documented).

## US-10 · Admin · ad packages
As an admin, I create and price ad packages.
- AC: placement, duration, price, temporary discount window, visibility (vendors/admins), slots; grant to a vendor without payment.
- Edge: overlapping campaigns in one slot follow rotation rules; sold-out slot prevents purchase.

## US-11 · Admin · Black Friday
As an admin, I run the November event.
- AC: preset event; category discounts; product coupons; vendors auto-enrolled with red notice; refusals listed; refusing vendors' products hidden from home/listings and excluded from discounts.
- Edge: enabling an event mid-month applies from activation timestamp; vendor can accept after refusing (products return).

## US-12 · Admin · settings
As an admin, I change shipping fees and see them applied.
- AC: governorate table + areas + pickup fees; save per section; confirmation; change log.
- Edge: changing a fee never rewrites past orders.

## US-13 · Admin · email templates
As an admin, I edit an email template and preview it.
- AC: subject/body ar+en, variables list, logo/colors editable, test send to my email; invalid variables highlighted.
- Edge: missing English body falls back to Arabic with a warning.

## US-14 · Admin · roles
As an admin, I create a limited staff role.
- AC: permission matrix; user assigned sees only allowed menus and is blocked by RLS server-side too.
- Edge: removing a permission hides routes immediately after next request.

## US-15 · Admin · audit
As an admin, I investigate a change.
- AC: filter by actor/entity/date; before/after diff; links to affected entity.
- Edge: sensitive values (keys) masked in logs.

## US-16 · Admin · manage governorates
As an admin, I manage the governorate list and its shipping fees.
- AC: table of 27 governorates with name ar/en, shipping fee, active toggle, sort order; add/edit inline or in a dialog; validation (fee ≥ 0, unique name per locale); every change audited with before/after; new orders use the new fee immediately.
- Edge: a governorate referenced by orders/vendors cannot be hard-deleted — the delete action is replaced by "disable" with an explanation; disabled governorates disappear from checkout but keep old orders intact.

## US-17 · Admin · manage areas and pickup fees
As an admin, I manage areas under each governorate and their pickup fees.
- AC: areas filtered by governorate; add/edit name ar/en + pickup fee + active + sort; search inside the list; bulk enable/disable; validation (fee ≥ 0, unique name within the same governorate).
- Edge: deleting an area used by a vendor or an order is blocked and offers "disable"; an area must belong to exactly one governorate and re-parenting is not allowed once used.

## US-18 · Admin · import the full areas dataset
As an admin, I import the complete Egypt areas dataset instead of typing hundreds of rows.
- AC: CSV upload with columns governorate, area_ar, area_en, pickup_fee; validation report before applying (row errors listed with line numbers); idempotent import (re-running creates no duplicates); summary of created/updated/skipped counts; import recorded in audit logs.
- Edge: unknown governorate in a row → row rejected, others still import; duplicate area in the same file → last one wins with a warning; empty pickup fee → falls back to the governorate default and is flagged.

## US-19 · Operations · fee changes are not retroactive
As an operator, I change a shipping or pickup fee without corrupting past orders.
- AC: existing orders keep their snapshotted shipping fee and pickup amount; only new orders/groups use the new values; the change is visible in the audit log with the effective timestamp.
- Edge: changing a fee while a checkout session is open → server recalculates at submit and shows the new total before payment; a mismatch never silently charges the old price.

## US-20 · Vendor · area drives pickup fee
As a vendor, my pickup fee follows my registered area.
- AC: the wallet deduction at ship time uses the pickup fee of the area on file at order creation; the breakdown shows area name, rate, quantity, and the order reference.
- Edge: I change my area after an order → that order keeps the old rate; future orders use the new one; if my area is disabled, I am asked to pick a new area before publishing or shipping.
