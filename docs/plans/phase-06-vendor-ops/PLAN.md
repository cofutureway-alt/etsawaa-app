# Phase 06 — Vendor Operations · PLAN

## 1) Goal
The vendor manages orders, approves shipping responsibility, understands every pound in the wallet, and withdraws safely.

## 2) Scope
**In:** vendor orders list/detail · allowed status changes · vendor shipping flow (hold → admin approval) · tracking updates · pickup fee at ship · wallet UI + transactions · withdrawals · penalties view · simple vendor report · **vendor documents printing (own invoice + own label + print history)** · **vendor profile (store name + store logo as avatar)** · **commission-funded coupon extension (commission_percent) post-checkout**.
**Out:** refund decisions (07) · ads purchase (07).

## 3) Decisions
- Each vendor sees only their `order_vendor_groups` + customer shipping data per `show_customer_details`.
- Vendor-shipped order → group `on_hold` + `vendor_ship_status=pending_admin`; admin approves/rejects.
- Approved → `shipping_revenue` transaction + vendor ships + COD stays blocked. Rejected → no transaction, platform ships.
- **Pickup fee at ship:** quantity × vendor-area rate, one transaction per group with reason + order reference.
- Earnings → pending at delivery; available after `hold_until` (default 14 days, level override).
- Balance may go negative (refund/penalty) and does not block withdrawal by itself.
- Withdrawal: request → admin review → manual transfer → approved; never above available.
- **Vendor documents:** prints only its own group's invoice/label; same shipment number as text (no barcode); customer name only; shipping line "—"; every print logged.
- **Vendor profile:** shared profile page; display name = store name; avatar = store logo (writes `vendors.logo_url`).

## 4) Architecture
**Tables:** order_vendor_groups · order_items · wallets · wallet_transactions · withdrawal_requests · vendor_penalties · areas · vendor_levels.
**RPC:** `fn_vendor_set_fulfillment` · `fn_request_vendor_shipping` · `fn_approve_vendor_shipping` · `fn_post_pickup_fee` · `fn_request_withdrawal` · `fn_release_earnings`.
**Routes:** `/vendor/orders` · `/vendor/orders/:id` · `/vendor/orders/:id/print/:doc` · `/vendor/wallet` · `/vendor/withdrawals` · `/vendor/reports` · `/vendor/profile`.
**Components:** WalletCard (bank-card style) · TransactionsTable · WithdrawDialog · FulfillmentStepper · PickupFeeBreakdown · LevelProgressCard · PrintActions · ProfileForm.

## 5) Tasks
See `TASKS.md` (VO-01 … VO-22).

## 6) Acceptance
Vendor knows withdrawable balance without asking · every pound has a visible reason and reference · pickup charged only at ship time and correctly · withdrawal reaches admin instantly with status · shipping approval flow cannot be bypassed client-side · vendor prints only its own group documents (other groups → 403) · vendor profile shows the store name and the avatar updates the store logo · commission-funded coupon: 100 EGP item / 10% commission / 30% coupon → 3 EGP discount, vendor keeps 100, platform net 7; zero-commission → zero discount; stacking follows the coupon flag.

## 7) Verification gate
G1 all tasks · G2 every money RPC idempotent; cross-vendor isolation tests · G3 tokens only · G4 numbers readable, no LTR/RTL breakage in figures, clear empty states · G5 tables become cards at four breakpoints · G6 noindex.

## 8) Risks
Duplicate pickup deduction → idempotency on group+shipment · double withdrawal → wallet row lock · timezone drift in hold calculation → compute in UTC, display Cairo.
