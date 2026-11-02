# Phase 05 — Checkout & Orders · TASKS

## Checkout
- [ ] **O-01** Checkout shell: single page accordion, sticky summary, RTL, inline validation. DoD: keyboard-only completion works.
- [ ] **O-02** Address book: select/create, email read-only display, primary phone editable, **alternate phone required (≠ primary)**, governorate→area linkage, default address. DoD: invalid area cleared on governorate change; alternate equal to primary rejected inline and server-side.
- [ ] **O-03** Shipping calculation: one fee per governorate, recalculates on address change. DoD: no pickup fee ever visible to customer.
- [ ] **O-04** Coupon input + server recalculation; precise failure reasons. DoD: stackable/exclude-sale/limits respected.
- [ ] **O-05** Payment methods: Kashier + COD with disabled reasons. DoD: COD hidden when rules violated, with explanation.

## Orders
- [ ] **O-06** `fn_create_order`: validate + create order/groups/items + stock decrement + coupon redemption, all atomic. DoD: rollback on any failure; idempotency key per attempt.
- [ ] **O-07** Commission calculation per item on discounted price, snapshot rule + amount. DoD: recomputation matches ledger.
- [ ] **O-08** Kashier session + success/fail/cancel return routes. DoD: same order reused on retry.
- [ ] **O-09** `kashier-webhook`: HMAC verify, idempotent `fn_confirm_payment`, raw payload stored. DoD: duplicate call changes nothing.
- [ ] **O-10** COD flow: immediate confirm + payment_status cod_pending. DoD: admin can reconcile collection later.
- [ ] **O-11** Success page: number, status, summary, tracking link. DoD: refresh safe.
- [ ] **O-12** Tracking page: per-group timeline + notes. DoD: states ordered; unknown state handled.
- [ ] **O-13** Order emails: confirmation, payment success/failure, shipped, delivered, cancelled. DoD: templates from DB; test-send.

## Account
- [ ] **O-14** Account shell + profile edit + phone/email change with OTP. DoD: email change invalidates old verification.
- [ ] **O-15** Orders list/detail + reorder. DoD: only own orders (RLS).
- [ ] **O-16** Refund request wizard: windows 14/30 from delivered, multi-item/vendor, evidence upload. DoD: block duplicate per item; outside window disabled with reason.
- [ ] **O-17** Account addresses CRUD. DoD: deleting address keeps order snapshots intact.

## Quality
- [ ] **O-18** Tests: expired coupon, zero stock, COD>cap, vendor-ship COD, payment failure, duplicate webhook, stock race. DoD: all pass twice.
- [ ] **O-19** Error budgets + friendly pages for payment/network. DoD: no dead ends.
- [ ] **O-20** G1–G6 evidence pack + four breakpoints. DoD: stored in `plans/evidence/phase-05/`.
- [ ] **O-21** Wishlist account page: list, remove, move to cart, unavailable state. DoD: only own items; no duplicates.
- [ ] **O-22** Review submission: delivered-only, half-star rating, title/body, edit/delete, pending moderation. DoD: one review per order item; blocked duplicates.
- [ ] **O-23** Notification center page: list, filters, mark read, deep links to the referenced order/refund. DoD: unread badge count matches records.
- [ ] **O-28** Profile page (shared for all roles): full name, primary phone, alternate phone, other personal data, password change (current + new), avatar via MediaPicker; email change via OTP; vendor profile shows the store name. DoD: vendor profile writes the store logo as avatar; staff/admin keep personal avatars.
- [ ] **O-29** Recently viewed page: last 20 with dedupe, clear history, merge on login; empty state. DoD: guest history merges without duplicates.
- [ ] **O-24** Documents data model + numbering: `order_documents` log, ONE shipment number per order `ETS-YY-###` (same on every copy), immutable snapshot fields for print. DoD: reprints log a new row; numbers never change for an order.
- [ ] **O-25** Admin invoice (A4): full order — all vendor groups, items, subtotal, discount, shipping, total, commission, payment method, no tax line. DoD: 3-vendor order renders one invoice with all groups.
- [ ] **O-26** Carrier shipping label (A5 landscape, one per order) with Code128 (bwip-js SVG) of the shipment number: logo + etsawaa.com, shipment number, date, payment status, shipments count (= total item pieces, auto-calculated and editable at print), customer name, primary + alternate phone, full address, category (leaf), fragile note, products total, shipping fee, COD total. DoD: missing phone/address blocks with a clear message; barcode scans at 100%.
- [ ] **O-27** Vendor documents: vendor invoice + vendor label (A5) — same shipment number as **text only** (no barcode), only that vendor's items/category, customer NAME ONLY (no phone/address, no other vendors' amounts), amounts = that vendor's items only with shipping shown as "—"; print dialog with copies defaults, cancellation watermark, reprint, and `order_documents` logging. DoD: vendor A cannot render vendor B's documents (API test).
