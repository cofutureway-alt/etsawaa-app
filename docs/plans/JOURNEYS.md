# JOURNEYS — every flow, screen by screen

> Executable reference alongside the phase files. Each screen/state here is implemented as written; any deviation is documented in the phase file first.
> Format: screen → elements/fields → states & messages → edge cases.

## 0) Global rules
- Default Arabic RTL; EN switch is instant with no page loss.
- Every primary button has loading + disabled-while-sending + result feedback.
- Network error: "Connection failed. Try again" + retry, no input loss.
- No emoji, no gradients, tokens only.
- Empty screen: EmptyState with cause + action.
- Header: logo · search · categories · order tracking · wishlist · cart · account/login · language switch.
- Footer: about · policies · sell · blog · contact · payment methods (Kashier/COD) · social.
- Money rules: prices in EGP with piasters; totals change only after server recalculation.

## 1) Guest journey
1. Opens `/` → full SSR: banners, categories, featured vendors, featured products, top-rated, event block if active.
2. Browses `/products` or `/category/:slug`.
3. Opens a product → selects a variant → price/stock/image update instantly; "Add to cart" disabled with a reason when unavailable.
4. Adds to cart → CartDrawer opens (summary + "View cart" + "Checkout").
5. `/cart` → qty change/remove/coupon → "Checkout".
6. Sees **"Create your account to complete the order"** (cannot be skipped); cart transfers after signup.
7. Cart persists in localStorage; merging with the account cart on sign-in (nothing lost).

**Edge cases:** product deleted/hidden mid-browse → message + cart refresh · invalid coupon → reason + cart kept · network drop on add → retry.

## 1a) Seller Center (public) & static pages
**`/sell` Seller Center:** header CTAs **Create vendor account** · **Vendor sign in** · **Support**; then:
1. **Site map card:** every level-1 category with its subcategories and sub-subcategories (expandable), each links to its category page.
2. **Vendor terms card:** opens the vendor terms page (text from settings).
3. **Start selling card:** short pitch article + final **Create vendor account** button.
4. Remaining vendor articles listed under the mandatory "Vendor articles" blog category.

**Static pages:** contact (name/email/phone/subject/message + success state) · about · terms · privacy · returns policy — all DB-driven, header/footer visibility controlled from settings.

---

## 2) Auth journey (customer)
**Register:** name · email · phone · password + confirm → terms/privacy → submit → "Verify your email" (6-digit OTP, resend 60s, change email) → success → auto sign-in → return to the previous intent.
**Google:** one button → account picker → if new: mandatory phone + terms → in.
**Sign in:** email or phone + password → success → new device may require email OTP (setting) → in.
**Forgot password:** email or phone → email OTP → code → new password + confirm → in.
**States:** unverified email → resend · blocked account → reason screen + contact · too many attempts → rate limit message · weak password → visible rules.
**Note:** SMS OTP later — the same code screen, channel-driven.

## 3) Browse & search
1. `/products`: sidebar filters (category, price, brand, category attributes, rating, in-stock only) + sort + count.
2. A filter updates results instantly; URL reflects filters (shareable/back works).
3. `/category/:slug`: category header (image/description/banner) + subcategory cards + products.
4. Search: instant suggestions (products/stores/categories) + Enter for results + no-results state with broadening hints.
5. Language switch preserves filters.

**Edge cases:** zero-result filter → suggest removing the last filter · orphan page → friendly 404 with search.

## 4) Product page
1. Gallery (per-variant images) + zoom/swipe on mobile.
2. Axis selection in order: changing color swaps the gallery; unavailable sizes appear disabled with "Out of stock".
3. Price/sale/expiry, stock state, overall rating, optional governorate shipping estimate.
4. Vendor card (logo/level badge/rating/"Visit store").
5. Description + attribute spec table + tabs (specs/reviews/policies).
6. Reviews: average + star distribution + published only + "Verified purchase".
7. Similar products / more from the store.
8. Sticky buy bar on mobile (price + add).
9. **Wishlist:** heart toggle on cards/product; guests are prompted to sign in; saved items appear in the account.
10. **Recently viewed:** every product view is recorded; the account shows the last 20 products (newest first, deduplicated) with a "clear history" action; a "you viewed before" strip also appears on the home page and the product page.
11. **Compare:** "Compare" on a product → pick a second product → `/compare?ids=p1,p2`; the table shows shared attributes + price/rating/vendor; different categories show a notice that only common fields are compared.

**Edge cases:** unpublished product → 404 · suspended vendor / event-hidden product → visible in store only with "Currently unavailable" as applicable.

---

## 5) Cart
1. Add → instant drawer (image/name/variant/price/qty) + "Added".
2. `/cart`: groups by vendor + estimated shipping (final at checkout) + coupon.
3. Qty edit: instant stock check; if exceeded → auto-correct + notice.
4. Remove: no confirmation (undo toast "Removed — undo").
5. Coupon: apply → success shows discount and "You saved X"; failure explains exactly (expired/limit/not eligible/sale item). **Commission-funded coupons** (`commission_percent`, delivered in Phase 06) show a normal "X% off" label while the amount is computed on the platform commission — the customer never sees a different mechanic.
6. "Checkout": guest → account gate; signed-in → `/checkout`.

**Edge cases:** product becomes unavailable → "Unavailable" line + remove/replace · vendor suspended → remove their lines with a notice · price changed → separate alert before payment.

## 6) Checkout (single page, accordion)
**6.1 Account & address**
- Signed-in: saved addresses (default) + "New address".
- Fields: name · **email (read-only — copied from the account, never editable)** · **primary phone (editable)** · **alternate phone (required, must differ from the primary)** · governorate (27) · area (dependent) · address 1 · 2 (optional) · postal (optional) · "make default".
- Inline validation: Egyptian phones (primary + alternate), required fields, area belongs to governorate, alternate ≠ primary; email has no input, only display.
**6.2 Shipping**
- One fee by governorate (shown immediately) + "Delivered by Etsawaa".
- Pickup fees are never shown to the customer.
**6.3 Summary & coupon**
- Lines grouped per vendor, quantities, discount, shipping, total.
- Coupon behaves as in cart; totals recalculated server-side.
**6.4 Payment**
- Card/e-wallet (Kashier) · Cash on Delivery.
- COD shown disabled with a clear reason when: total > COD cap (default 5,000 EGP) or any item is vendor-shipped.
- Terms/return-policy checkbox.
**6.5 Confirm**
- "Place order" → loading → success: order page with number, status, next steps.
- Failure: reason + retry + no duplicate order (idempotency).

**Rules:** any address/qty change recalculates shipping and totals · no payment without complete address · cart locked once payment starts (back to edit).

## 7) Kashier
1. Order confirmed → create payment session → redirect to Kashier.
2. Success → back to `/order/:number?paid=1` + "Payment received" after webhook confirmation.
3. Failure/cancel → `?failed=1` + "Retry" (same order, no new one).
4. Late/duplicate webhook: never double-charges; order shows "Awaiting payment confirmation" until received.
5. Order never becomes processing before payment confirmation (except COD).

## 8) COD
1. COD selected (rules met) → immediate confirmation → order processing + payment_status=cod_pending.
2. Courier collects → vendor/admin updates status → completed.
3. Cancellation before shipping: reason required + stock restored.
4. COD is never allowed with any vendor-shipped item.

## 9) Order & tracking
1. Success page: order number, summary, status, "Track" + email notice.
2. `/order/:number/track`: timeline per vendor group (received from vendor → handed to carrier → out for delivery → delivered) + timestamps + notes.
3. Tracking updated manually by admin/vendor now; schema ready for carrier API.
4. Notifications: email + in-app on every status change.

## 9a) Order documents & printing
- **Shipment number:** one per order — `ETS-YY-###` (e.g., `ETS-26-235`); the same number appears on every copy and inside the Code128 barcode. Multi-vendor orders are still one shipment for the carrier.
- **Admin:** order → print: full invoice (A4: all vendor groups, items, subtotal, discount, shipping, total, commission, payment method) + the carrier label (A5) + each vendor's label.
- **Carrier label (one per order):** logo + etsawaa.com · shipment number · date · payment status (COD/paid) · shipments count (= total item pieces, auto and editable at print) · customer name · primary phone + alternate phone · full address (governorate/area) · category (leaf) · fragile note · products total · shipping fee · COD total ("فقط لا غير") · **Code128 barcode of the shipment number**.
- **Vendor label (one per vendor):** same shipment number (text only, no barcode), only that vendor's items/category and **customer name only** — no phone/address; amounts = that vendor's items only, shipping line shown as "—".
- **Copies:** defaults admin = invoice + labels, vendor = invoice + label, carrier = 2 labels; editable per document type in settings.
- **Print:** server-rendered HTML with `@page` A4/A5 landscape, RTL, Cairo; barcode as inline SVG; every print writes `order_documents` (who/when/type/copies).
- **Rules:** no tax lines; labels never show commission or internal notes; cancelled orders print with a "ملغي" watermark.
- **Edge cases:** missing phone/address blocks the carrier label with a clear message; reprint logs a new row; long addresses wrap without clipping; amounts on a vendor label are that vendor's own only.

---

## 10) Reviews
1. After delivery: CTA in account + email link.
2. Stars (half-star allowed) + title + body → submit.
3. Status: pending → published (after moderation) or spam/trash.
4. Store/product show published only; the buyer can edit/delete.
5. One review per order item (verified only).

## 11) Refund
**Entry:** account → order → item → "Request return" (within 14 days) or "Warranty" (up to 30 days) — counted from `delivered_at`.
1. Select items/quantities (multiple items and vendors allowed).
2. Reason (defect/wrong item/damaged/not received/change of mind) + description + photos/evidence (MediaPicker → documents).
3. Confirm: "Your request will be reviewed by admin" → status `pending_admin`.
4. Customer sees a timeline (admin review → decision → refund → closed).
5. Vendor sees only their items, labeled "under admin review", and takes no action.
6. Admin groups the request, sets fault per item (`vendor/shipping/customer/defect`) + amount + restock.
7. The decision is final; the vendor executes/documents only.
8. `vendor` → automatic penalty + wallet clawback; `shipping` → manual carrier claim.
9. Refund: Kashier online when possible, otherwise a documented manual transfer.
10. Close + notify both sides + log on the order.

**Edge cases:** outside window → button disabled with reason · duplicate request per item → blocked · partial refund → remainder can be requested later within the window.

---

## 12) Customer account
Tabs: Overview · Orders · Returns · Addresses · Reviews · Wishlist · **Recently viewed (last 20)** · Notifications · **Profile**.

**Profile (all roles):** full name · primary phone · alternate phone · other personal data · password change (current + new) · avatar via MediaPicker. Email changes go through the OTP flow (confirm on the new address). Vendor profile shows the **store name** with owner details underneath, and vendor avatar = store logo (editing it edits the store logo).
- **Overview:** recent orders + refund statuses + alerts (complete your profile).
- **Orders:** filters (all/active/completed/cancelled) → details + tracking + "Request return" + "Reorder" + simple invoice download.
- **Returns:** refund requests, statuses, amounts, refund method.
- **Addresses:** add/edit/delete/default — deleting an address used by an order does not affect it (snapshot).
- **Reviews:** published/pending + edit.
- **Wishlist:** add/remove + share.
- **Notifications:** list + mark read + filter.
- **Profile:** name/phone/email (email change requires OTP) + password + account deletion (request + verify).

---

## 13) Media journey (vendor/admin only)

> **Owner decision:** customers never get a media library. Customer uploads (e.g., avatar) use the native device picker and write the file straight into the target field. The account panel has no media tab.
1. Media icon in the vendor/admin panel → `/vendor/media` or `/admin/media` (same component). Customers have no equivalent entry point.
2. Folder tree on the side + file grid + breadcrumbs + in-media search.
3. **New folder:** button → dialog (name) → appears instantly (3 levels max, duplicates blocked).
4. **Upload:** drag & drop onto the grid or an upload button → pre-upload preview → per-file progress → per-file success/error.
5. **Drag files between folders** (dnd-kit) + a "Move to" menu.
6. **Select:** click = preview (size/type/copy link) · multi-select · delete (usage check first).
7. **From any image/file field:** "Choose from media" → popup with folders + inline upload + selection → returns and fills the field.
8. **Limits (admin settings):** allowed types (images/video/PDF), max sizes, max dimensions — enforced before and during upload and at the bucket.
9. **Privacy:** each user sees only their files; catalog images use unguessable UUID URLs.

**Edge cases:** disallowed type → clear reason before upload starts · oversized → immediate rejection · interrupted upload → separate retry · deleting a file used by a product → block deletion or warn "used in N places".

---

## 14) Vendor extra journeys (beyond 03/06)
- **Ads:** `/vendor/ads` → package cards (placement/duration/price/temporary discount/"not available to you") → choose product + banner art if needed → pay: available balance or Kashier → success: campaign pending_payment/active → basic stats (impressions/clicks) → auto-expire.
  - Insufficient balance: Kashier only + "Ads cannot be purchased on credit".
- **Levels:** dashboard card: current level + progress bar + available rewards + promotion history.
- **Penalties:** list + reason + reference + status (applied/waived).
- **Store badges:** the level badge appears next to the store name, icon from the level settings.

---

## 15) Notifications & email matrix
| Event | Customer | Vendor | Admin |
|---|---|---|---|
| Register/verify | OTP + welcome | welcome + onboarding steps | new vendor notice |
| New order | confirmation + number | order alert | alert |
| Payment success/failure | email + in-app | status update | failure alert |
| Shipped/delivered | tracking | action needed | — |
| Refund | received/decision/refunded | their items only | full request |
| Withdrawal | — | request status | new request |
| Product approved/rejected | — | reason + action | — |
| Grace period expired | — | red warning + selling blocked | alert |
| Event | — | red notice + opt-out option | — |
| Penalty | — | reason + amount | — |

Templates live in DB (subject + HTML ar/en + variables), editable with preview.

---

## 16) Admin journeys

### 16.1 Sign-in
Email/phone + password + email OTP → staff accounts see only permitted menu items. Blocked → reason + contact. No access to any `/admin` route without authorization (RLS + redirect).

### 16.2 Dashboard
- **Quick actions:** Vendor Approvals · Product Approvals · Pending Withdrawals · Pending Verifications — number + filtered list.
- **Statistics:** "Sales statistics" card + "Deep statistics" card — each opens its detail page (one button each).
- **Monthly Overview:** new products · active vendors · registered-but-unapproved vendors · new customers · recurring customers · average rating · order cancellation rate — filterable by month/year.
- **Daily Sales Chart** (7/30/90 days).
- **All-time stats:** products/vendors/customers/orders/sales/commissions.
- **Top Vendors:** table (vendor · orders · revenue · commission · level rank).
- **Top rated products:** table (product · average · reviewers count).

### 16.3 Withdrawals
Tabs Pending/Approved/Cancelled/All + Export CSV → row: amount · vendor · method · date · status → open request: payout details + "Approve"/"Cancel" with mandatory reason → wallet transaction recorded and request closed.

### 16.4 Vendors
- List: logo/name/email/categories/phone/date/status + filters + search.
- Actions: edit · vendor products (filtered) · vendor orders · ban/unban · **hide listings** (confirm dialog) · **apply penalty**.
- **Edit vendor** tabs:
  1. General: selling permissions · enable/disable selling · publish without approval · Featured (with duration) · store data (name/categories/logo/banner) · personal data/address.
  2. Commissions: Inherit (leaf category) · Fixed · Category Based with percent/fixed per leaf + parent-inheritance toggle.
  3. Social: all platform links.
- **Extra details:** verification + documents + level + penalties + wallet + ads + audit history.

### 16.5 Products
- List with all filters (status/category/stock/brand/vendor) + add/import/export.
- Columns: image · name · SKU · stock · price/sale · categories · tags · brand · date · computed commission · vendor · status · ID · actions (edit/delete/view/clone).
- Add/edit = the same 5-step wizard + admin-only vendor change + rejection reason.
- Delete = soft archive with audit.

### 16.6 Orders
- List: status filters + search + multi-select → bulk status change/delete.
- Columns: ID/customer · date · status · total · shipment · origin · commission · vendor (per group).
- Details: customer/billing/shipping/invoice · customer history (orders/revenue/AOV) · items + commissions · paid/method · status log · notes (private/public) · manual edit of every field with audit.

### 16.7 Refunds
- Tabs by status + search by order/customer/vendor.
- Open request: customer items + evidence + per-item decision (approve/partial/reject) + fault + amount + restock → "Approve" → execute refund → close.
- Only the concerned vendor sees their items, and only after the decision to execute/document.

### 16.8 Penalties
- Rules: create/edit/soft delete + enable/disable + trigger (returns/defect/rating/packaging) + threshold + amount.
- Applications: every application (auto/manual) + status + reference + "Waive" with reason.
- Manual from the vendor page.

### 16.9 Coupons
- List + filters + add/edit.
- Form: code (or generate) · description · type (percent/fixed) · value · free shipping (admin only) · limits (min/max) · validity · scopes (vendor/category/brand/product — include/exclude) · usage limits (coupon/user/item count) · stackable · exclude sale items · status.
- Usage-limit differences explained in-screen (tooltip/help).

### 16.10 Catalog
- Categories: tree + add/edit/delete + thumbnails + DnD ordering + header visibility.
- Brands · Tags: same pattern.
- Attributes: definitions + values + link to multiple categories + (required/filter/axis/unit).

### 16.11 Reviews
Tabs: All/Pending/Published/Spam/Trash → card: reviewer/product/vendor/date/stars → publish/reject/spam/delete + reason.

### 16.12 Levels & badges
- Level CRUD: name/icon/order/order threshold/rewards (commission discount/ad package/hold days/free featured days).
- Current vendors per level + manual promote/demote with reason.

### 16.13 Ads
- Packages: CRUD (placement/duration/price/temporary discount/visibility/slots).
- Campaigns: all campaigns + status + source (paid/grant) + stats.
- Admin grant: choose vendor/product + package + duration → no payment.

### 16.14 Events
- Event CRUD (name/dates/status) + ready Black Friday (all November).
- Edits: category discounts (%) + product coupons.
- Vendors: list (auto/eligible/refused) + stats.
- Manual hide any vendor from home/products (confirm).

### 16.15 Reports
Tab 1: filters (month/year/vendor/custom range) + cards (Net Sales · Commission · Vendors Signed · Awaiting Approval · Products Created · Awaiting Withdrawals) + charts (Sales/Orders/Commission).
Tab 2: All logs (admin actions).
Tab 3: Admin earnings (total/net/commission + chart).

### 16.16 Settings (15 sections — every field)
1. **Site:** site name · tagline · favicon · logo per language (ar/en) · default language · enable/disable each language · timezone (default Cairo) · date format · time format · week starts on.
2. **General:** vendor store URL pattern (default `Store`) · single-seller mode (restrict multi-vendor orders) · store category handling (None / Single / Multiple default) · show customer details (shipping + contact) to vendors · vendor onboarding mode (manual approval / automatic direct selling) · vendor address visibility on store page · vendor registration toggle · welcome message ar/en + force onboarding page on first login · require terms/contract acceptance at signup.
3. **Login:** Google (on) · Facebook (off) · Apple (off) + per-provider credentials — only enabled providers appear on auth screens.
4. **Vendors:** allow vendors to change order status · allow choosing any category at product creation · product status on create/edit (direct publish vs admin review) · allow product cloning · single vs multiple categories per product · allow vendors to add tags or pick existing only.
5. **Verification:** email OTP toggle · required documents checklist (ID front/back, commercial register, tax card, proof of residence) · grace period (hours/days/months) · behavior after grace (block selling, mark products unavailable) · red verified badge on verified stores.
6. **Financial:** commission type (fixed for all vs variable per category) · per-leaf-category percent/fixed/both · parent→child inheritance toggle for sub-categories.
7. **Withdrawals:** manual methods (wallet/bank/InstaPay) · minimum withdrawal · available-profit definition · eligible order status · hold days before withdrawal · returns policy interaction.
8. **Shipping:** shipment tracking toggle + tracking states (received from vendor → handed to carrier → arriving on DATE → out for delivery → delivered & collected) · carrier companies list + integration placeholder · **governorates (27): full CRUD (name ar/en, shipping fee, active, sort)** · **areas: full CRUD under each governorate (name ar/en, pickup fee, active)** · **delete rule: any row referenced by orders/vendors is disabled, never hard-deleted** · **areas dataset import (CSV + idempotent seed)** · show shipping inside the total (default on) after full customer data.
9. **Payments:** providers list (Kashier active; Paymob optional) + credentials + enable/disable each method · COD toggle + max invoice cap (default 5,000 EGP) + vendor-shipping COD block (always on).
10. **Policies:** default editable texts for vendor, customer, and checkout (privacy, terms, returns).
11. **Emails:** SMTP/Resend provider + credentials · every template (subject + HTML ar/en + variables) · editable logo, colors, and copy with preview and test-send.
12. **SEO:** titles/descriptions defaults · schema defaults · sitemap settings · robots.
13. **Design:** every site copy string · add pages + header visibility + ordering · detailed colors per token · fonts · radii/spacing · light/dark tokens.
14. **Media:** allowed mime types · max sizes (image/video/PDF) · max dimensions · PDF toggle.
15. **Notifications:** per-event channel toggles (in-app/email) · digest/instant · who receives admin alerts · quiet hours.

Every section: save with confirmation + preview where relevant + change log + no "tax" wording.

### 16.17 Users & roles
All accounts (filter/search/edit/ban/delete/add) + Roles matrix (create/edit permissions/enable).

### 16.18 Blog
Posts: list + editor (title/slug/content ar/en/cover/category/SEO/status) + blog categories + preview.

### 16.19 Oversight
Audit log for every sensitive action (before/after) + search/filter.

---

## 17) Journeys → phases
| Journeys | Phase |
|---|---|
| 1, 3, 4, 5 | 04 |
| 2 | 01 |
| 6, 7, 8, 9, 10, 11 | 05 |
| 12 (customer account) | 05 |
| 13 (media) | 02 |
| 14 (vendor extra: ads/levels) | 06 (view) + 07 (purchase/packages) |
| 15 (notifications) | 05 + 07 |
| 16 (admin) — including 16.18 blog | 07 |
| Verification/grace states | 03 |
