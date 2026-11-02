# Phase 05 — Checkout & Orders · PLAN

## 1) Goal
A simple, secure checkout that turns guests into customers and produces financially correct orders per vendor, with Kashier/COD and server-enforced COD rules.

## 2) Scope
**In:** single-page checkout · addresses · governorate shipping · coupons · COD rules · Kashier hosted + webhook · atomic order creation + vendor groups · success + tracking · customer account · refund request (14/30) · order emails · **order documents (invoices + shipping labels, A4/A5, Code128, copies + print log)**.
**Out:** wallet/withdrawals (06) · refund decisions (07).

## 3) Decisions
- Guest → checkout gate: account creation required; cart resumes after signup.
- **COD disabled** when total > `settings.cod_max_total` (default 5,000 EGP) or any item is vendor-shipped — inside `fn_create_order`.
- **One shipping fee** per order by governorate; pickup fees internal.
- Kashier: hosted session + HMAC webhook + idempotency `provider_ref`.
- Commission on price **after discounts**; order split into `order_vendor_groups`.
- Statuses: `pending_payment → processing / on_hold / cancelled → completed`; fulfillment states per group.
- Refund windows stored with the order from `delivered_at`.

## 4) Architecture
**Tables:** carts/cart_items · orders · order_vendor_groups · order_items · order_status_history · order_notes · payments · refund_requests · refund_request_items.
**RPC:** `fn_create_order` (validate stock/coupon/COD/shipping → create → decrement stock → redeem coupon) · `fn_confirm_payment` · `fn_cancel_order` · `fn_request_refund`.
**Edge:** `kashier-webhook` · `send-email`.
**Routes:** `/checkout` · `/order/:number` · `/order/:number/track` · `/account/orders` · `/account/returns`.
**Components:** CheckoutAccordion · AddressForm · PaymentMethods · OrderSummary · CouponInput · TrackingTimeline · RefundWizard.

## 5) Tasks
See `TASKS.md` (O-01 … O-27).

## 6) Acceptance
Cart-to-success ≤90s · email is displayed read-only (never editable) · primary phone editable · alternate phone required and different from the primary · forged COD/shipping blocked at API · 3-vendor order = 3 groups + one shipping line · duplicate webhook never double-charges · refund visible only to admin + concerned vendor · confirmation emails sent for success/failure · admin invoice A4 + one A5 label per group with Code128 · vendor invoice/label show only that vendor's items and only the customer name (no phone/address) · carrier label shows full customer data + shipments count · every print logged.

## 7) Verification gate
G1 full purchase twice · G2 every RPC reviewed: permission, atomicity, idempotency; stock race test · G3 tokens only · G4 payment errors understandable + retry without losing cart · G5 checkout usable at four breakpoints · G6 payment/order pages noindex + no data leakage.

## 8) Risks
Stock race → row locks + transaction · late webhook → reconcilable pending state · guest cart loss → merge before redirect · coupon race → redemption count inside transaction.
