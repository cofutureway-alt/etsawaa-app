# Phase 06 — Vendor Operations · TASKS

## Orders
- [ ] **VO-01** Orders list: filters (status/date/vendor group), search by order number/customer. DoD: pagination + empty state.
- [ ] **VO-02** Order detail: items snapshot, customer shipping per setting, timeline, printable label. DoD: no hidden admin-only fields leaked.
- [ ] **VO-03** Fulfillment updates allowed by settings; status transitions validated server-side. DoD: invalid transition rejected with reason.
- [ ] **VO-04** Vendor shipping request → `pending_admin` + hold + notifications. DoD: cannot ship before approval.
- [ ] **VO-05** Admin approve/reject actions (shared component with 07) + `shipping_revenue` posting on approval. DoD: rejection posts nothing, platform ships.
- [ ] **VO-06** Tracking manual updates + notes. DoD: every update appends, never overwrites history.

## Wallet
- [ ] **VO-07** Wallet card UI: available/pending, level progress, skeleton on load. DoD: matches ledger sum test.
- [ ] **VO-08** Transactions table: type, signed amount, reason, reference (order/item/ad), date, filters. DoD: every row opens its reference.
- [ ] **VO-09** Pickup fee posting at ship time: quantity × area rate, idempotent. DoD: re-shipping same group never double-charges.
- [ ] **VO-10** Earnings release cron: pending → available after hold, batch + audit. DoD: no double release; timezone test.
- [ ] **VO-11** Penalties view: list + reason + reference + status. DoD: waived shown distinctly.

## Withdrawals
- [ ] **VO-12** Withdraw dialog: amount, method (wallet/bank/InstaPay), details, min-amount validation. DoD: exceeding available blocked client + server.
- [ ] **VO-13** Request list + statuses + cancel while pending. DoD: cancel restores nothing if not applied (no double hold).
- [ ] **VO-14** Admin review hooks (approve/cancel) with audit. DoD: approval reduces available exactly once.

## Reporting & quality
- [ ] **VO-15** Simple report: sales, commission, pickup, net for a period. DoD: totals match wallet transactions.
- [ ] **VO-16** Mobile layouts: tables → cards; sticky filters. DoD: no horizontal scroll at 390.
- [ ] **VO-17** Tests: ship with/without approval, pickup correctness, over-balance withdrawal, negative balance, duplicate actions. DoD: all pass twice.
- [ ] **VO-18** G1–G6 evidence pack + four breakpoints. DoD: stored in `plans/evidence/phase-06/`.
- [ ] **VO-21** Vendor profile: shared profile page at `/vendor/profile` showing the **store name** (owner details underneath); name/phone/phone_alt/password; **avatar = store logo** (writes `vendors.logo_url` through MediaPicker). DoD: editing the avatar updates the store page logo immediately.
- [ ] **VO-22** Commission-funded coupon extension (`commission_percent`) — post-checkout coupon engine: `discount = coupon_percent × commission` per item (rounded to piastre), customer sees a normal "X% off", vendor earnings unchanged (full item total), platform net commission reduced; zero-commission items → zero discount; stacking follows the coupon's `stackable` flag (product-funded first, then commission-funded on the reduced commission); extend `fn_apply_coupon` for cart display and `fn_create_order` for the final math; coupon records accept the new type (admin UI ships in 07 / A-12). DoD: fixture 100 EGP / 10% commission / 30% coupon → exactly 3 EGP discount, vendor 100, platform net 7; sum of item discounts = order discount; no negative commission.
- [ ] **VO-19** Vendor print center: print my invoice + my label from the order page (same shipment number, name only), copies dialog, and bulk print for selected orders. DoD: only my documents render; bulk respects page filters.
- [ ] **VO-20** Print history: list `order_documents` entries for my groups (type/copies/date/printed by) + reprint. DoD: reprint logs a new row.
