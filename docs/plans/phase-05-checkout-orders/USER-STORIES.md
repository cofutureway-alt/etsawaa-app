# Phase 05 — Checkout & Orders · USER STORIES

## US-01 · Guest · forced account at checkout
As a guest, I reach checkout and am asked to create an account.
- AC: I keep my cart; after signup/verify I return to checkout with selections intact; no order can be placed as guest.
- Edge: I already have a phone but different email → sign-in path offered; abandoned signup keeps cart for next visit.

## US-02 · Customer · address
As a customer, I choose or create a delivery address.
- AC: saved addresses listed with default marker; new address shows my email read-only (cannot be edited), lets me edit the primary phone, and **requires an alternate phone different from the primary**; validates area (must belong to governorate); can set default.
- Edge: alternate equals primary → inline error, blocked server-side; address outside Egypt blocked; missing postal code allowed.

## US-03 · Customer · shipping fee
As a customer, I see one shipping fee based on my governorate.
- AC: fee updates immediately on governorate change; displayed in summary; total recalculated server-side.
- Edge: unsupported governorate (disabled) → message + cannot continue.

## US-04 · Customer · coupon
As a customer, I apply a coupon and see the discount.
- AC: success shows saved amount and updated total; failure explains exactly (expired, limit reached, not eligible, sale items excluded).
- Edge: changing cart invalidates coupon → notice + option to reapply; stacking blocked unless allowed.

## US-05 · Customer · COD above cap
As a customer with a 6,000 EGP cart, I cannot choose COD.
- AC: COD shown disabled with "Cash on delivery unavailable for orders above 5,000 EGP"; forged request rejected by API.
- Edge: splitting the order below cap is not suggested automatically (no dark patterns).

## US-06 · Customer · vendor-shipped COD
As a customer buying a vendor-shipped item, COD is unavailable.
- AC: reason shown; only Kashier available; API rejects COD regardless of client state.
- Edge: mixed carts (one vendor-shipped item) disable COD for the whole order, not just the item.

## US-07 · Customer · pay with card
As a customer, I pay via Kashier.
- AC: redirect, return, "Payment received" only after webhook; failure returns with retry (same order); pending shows "Awaiting confirmation".
- Edge: closing the browser mid-payment → order remains pending_payment with a resume link on the order page.

## US-08 · System · duplicate webhook
As the platform, I never double-charge or double-confirm.
- AC: identical `provider_ref` processed once; second call is a no-op with 200.
- Edge: out-of-order webhooks (paid after cancel) follow a documented reconciliation rule, never silent overwrite.

## US-09 · Customer · multi-vendor order
As a customer, I order from three vendors in one checkout.
- AC: one shipping fee; three vendor groups internally; I see one order with grouped items; each vendor sees only their group.
- Edge: one group cancelled later does not cancel the others; refund is per item.

## US-10 · Customer · track order
As a customer, I follow my order status.
- AC: timeline per vendor group with timestamps and notes; status changes notify me by email + in-app.
- Edge: manual tracking with no updates shows "Preparing your shipment" rather than an empty timeline.

## US-11 · Customer · request refund
As a customer, I request a return within 14 days or warranty within 30.
- AC: choose items/quantities across vendors; reasons list; evidence upload; submit → "Under admin review"; timeline visible.
- Edge: outside window → disabled with remaining-days message; duplicate per item blocked; partial quantity allowed.

## US-12 · Customer · account orders
As a customer, I review my orders and reorder.
- AC: filters, order details, reorder adds available items to cart with a notice for unavailable ones.
- Edge: reorder of a deleted product skipped with summary.

## US-13 · Admin · reconcile COD
As an admin, I mark a COD order as paid after collection.
- AC: updates payment_status with actor + timestamp; appears in reports; no double-collection warnings.
- Edge: reconciling an already-paid COD order is blocked with a clear message; reversal requires a documented adjustment.

## US-14 · Admin · print the full invoice and labels
As an admin, I print a complete invoice for an order plus the shipping labels.
- AC: invoice A4 shows all vendor groups, items, subtotal, discount, shipping, total, payment method, commission — no tax line; the carrier label A5 (one per order) carries the shipment number `ETS-YY-###`, Code128, full customer data, shipments count; vendor labels follow; copies dialog respects settings.
- Edge: cancelled order prints with a "ملغي" watermark; missing recipient phone/address blocks the carrier label with a clear message; reprint writes a new `order_documents` row.

## US-15 · Vendor · print only my items
As a vendor, I print my invoice and label without seeing other vendors' or the customer's private data.
- AC: vendor invoice/label show only my items and my category; the label shows the customer NAME only — no phone, no address, no other vendors' amounts; same shipment number as text (no barcode); amounts are my items only and the shipping line shows "—"; server blocks any other vendor's document.
- Edge: direct URL to another vendor's print route returns 403; order on hold (vendor shipping) shows the correct status; long addresses never appear on the vendor copy at all.

## US-16 · Carrier · scan the label
As a carrier, I scan the label barcode and match it to the shipment.
- AC: Code128 SVG encodes the order shipment number; label shows customer name, primary + alternate phone, full address, category, fragile note, products total, shipping fee, COD total, and shipments count (auto = total pieces, editable at print).
- Edge: barcode scans at 100% print scale on A5 landscape; long addresses wrap without clipping; the label never shows commission or internal notes.

## US-17 · Any account · manage my profile
As a customer, vendor, admin, or staff member, I manage my profile from one page.
- AC: edit full name, primary phone, alternate phone, other personal data; change password with the current password; change avatar via MediaPicker; email change requires OTP on the new address; vendor profile shows the store name and the avatar is the store logo.
- Edge: wrong current password blocks the change; duplicate phone rejected; changing the vendor avatar updates the store page immediately; staff without permission can edit only their own profile.
