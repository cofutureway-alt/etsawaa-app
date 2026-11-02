# Phase 06 — Vendor Operations · USER STORIES

## US-01 · Vendor · see my orders only
As a vendor, I open my orders and see only my items.
- AC: order number, date, my items, totals, status; filters by status/date; search by number/customer.
- Edge: order containing other vendors' items shows my group only, with no other vendor names or amounts.

## US-02 · Vendor · update fulfillment
As a vendor, I mark an order as handed to the carrier.
- AC: allowed transitions per settings; timeline entry with timestamp; customer notified.
- Edge: trying to skip a state → server rejects with explanation.

## US-03 · Vendor · request to ship
As a vendor with vendor-shipped products, I request to handle shipping.
- AC: request creates `pending_admin` and puts the group on hold; dashboard banner shows "Awaiting admin approval"; I cannot mark it shipped before approval.
- Edge: admin rejects → banner explains the platform will ship; no revenue posted.

## US-04 · Vendor · shipping revenue
As a vendor, when shipping is approved, I see the shipping revenue credited.
- AC: a `shipping_revenue` transaction with order reference appears in the wallet; total available updates.
- Edge: cancellation after approval reverses the revenue with an audit trail.

## US-05 · Vendor · pickup fee
As a vendor, I see the pickup fee deducted when I ship.
- AC: one transaction per group: quantity × my area rate, reason "Pickup fee", order reference; breakdown available.
- Edge: my area rate changes later → past transactions unchanged; shipping a group twice impossible.

## US-06 · Vendor · wallet card
As a vendor, I see my balance like a bank card.
- AC: available and pending clearly separated; level and next reward visible; last 5 transactions summarized.
- Edge: negative balance explained with the causing transaction, not a generic warning.

## US-07 · Vendor · transactions
As a vendor, I audit every movement.
- AC: filters by type/date; each row shows signed amount, reason, reference, balance after.
- Edge: a refund clawback after withdrawal shows negative available and a clear explanation.

## US-08 · Vendor · withdraw
As a vendor, I request a withdrawal.
- AC: amount ≤ available; method with details; minimum enforced; request appears as pending with date.
- Edge: available changes between opening dialog and submit → server rejects with updated amount.

## US-09 · Vendor · cancel withdrawal
As a vendor, I cancel a pending withdrawal.
- AC: allowed only while pending; funds become available again; audit recorded.
- Edge: already approved → cancel disabled with explanation.

## US-10 · Vendor · penalties
As a vendor, I see any penalties applied to me.
- AC: list with rule/manual source, amount, reason, reference, status (applied/waived).
- Edge: waived penalty shows who waived it and when.

## US-11 · Vendor · report
As a vendor, I check my period performance.
- AC: sales, commission, pickup, net; date range; export not required here.
- Edge: no data → zeros with an explanation, not a blank card.

## US-12 · Admin · approve shipping
As an admin, I decide vendor shipping requests.
- AC: queue with vendor, order, items, requested shipping share; approve → revenue posted + vendor notified; reject → reason required.
- Edge: order cancelled while pending → request auto-cancelled with notice.

## US-13 · Admin · commission-funded coupon
As an admin, I create a coupon whose discount is taken from the platform commission.
- AC: type `commission_percent` in the coupon form; customer sees a normal "X% off" and pays the reduced total; vendor receives the full item total; the platform's commission is reduced by the discount; zero-commission items produce zero discount; stacking follows the admin-chosen flag.
- Edge: 100 EGP / 10% commission / 30% coupon → exactly 3 EGP off; 100% coupon removes only the commission; changing the commission rate later never rewrites past orders (snapshot).
