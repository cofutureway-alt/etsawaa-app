# Phase 08.5 — Admin & Buyer Experience Hardening · USER STORIES

## US-01 · Buyer · my account
As a customer, I open "حسابي" and stay inside the storefront.
- AC: header, footer and breadcrumbs remain; tabs Overview/Orders/Addresses/Wishlist/Reviews/Refunds/Profile; mobile tabs; empty states; 4 widths.
- Edge: direct URL works; session expired shows login then returns to the same tab; no duplicate standalone layout.

## US-02 · Admin · commission per category
As an admin, I set different commissions for different categories.
- AC: full L1→L2→L3 tree; inherit/override; effective % per leaf; bulk apply; search; audit before/after; save per node or all.
- Edge: editing a parent changes inheriting children only, not overridden ones; changing a leaf does not alter old orders; coupon commission_percent uses the same effective value.
- Money proof: Fashion 15% and Electronics 5% produce different commission rows for two orders; the old order keeps its snapshot.

## US-03 · Admin · shipping fees and areas
As an admin, I edit the shipping fee per governorate and manage its areas.
- AC: table shows AR/EN name, shipping fee EGP (editable), areas count (link), active, actions; one save or row dialog; drag handle order; no exposed sort numbers.
- AC: area page adds/edits/disables areas with pickup fee EGP, active, search; unique name per governorate.
- Edge: Cairo fee 75 → a new checkout shows 75; an old order keeps its snapshot; 5000 (COD cap) never appears here; deleting a referenced area is blocked and offers disable.
- Edge: 27 governorates / 572 areas; CSV import is idempotent and reports row errors.

## US-04 · Admin · create/edit a coupon
As an admin, I create a complex coupon from a proper dialog.
- AC: code generator; product_percent/product_fixed/commission_percent/free shipping; scopes include/exclude; min/max; limits; stackable; exclude sale; validity; live preview; validation before save.
- Edge: invalid combinations blocked; editing a used coupon does not rewrite history; commission_percent explains that it is a percentage of the platform commission.

## US-05 · Admin · ads, events, banners
As an admin, I manage marketing campaigns without primitive dropdown forms.
- AC: DataTable + stats; create/edit in Dialog/Drawer; package CRUD; admin grant; placement/slots/dates; source paid/admin_grant; event preset; vendor refusals; banner MediaPicker + preview; expired banners auto-hide.
- Edge: overlapping campaigns in one slot follow rotation; a sold-out slot blocks purchase; a refusing vendor's products disappear from public listings in one request cycle.

## US-06 · Admin · attributes
As an admin, I build the attribute dictionary.
- AC: category tree → groups → definitions; add/edit/delete/select; text/number/enum/color; units; required/filterable/variant axis; options CRUD; reorder; audit.
- Edge: deleting an attribute used by a product/template is blocked and offers disable; vendors cannot add dictionary values.

## US-07 · Admin · penalties and levels
As an admin, I manage penalties and vendor levels.
- AC: penalty rules CRUD (soft delete), manual apply, waive with reason, wallet transaction, history. Levels: thresholds/rewards/icon, preview, manual promote/demote with reason, history.
- Edge: every penalty has exactly one wallet transaction; level reward changes apply to future calculations only.

## US-08 · Admin · audit logs
As an admin, I inspect what changed.
- AC: action/entity/field translated; 20 rows per page; filters actor/action/entity/date; detail drawer; sensitive values masked; export.
- Edge: no raw i18n keys; loading 10k rows in one page is a defect.

## US-09 · Admin · shipping requests and withdrawals
As an admin, I process shipping requests and withdrawals separately.
- AC: shipping page has no withdrawal block; link to withdrawals; tabs/status; approve/reject with reason; stats; pagination 20; CSV export for withdrawals.
- Edge: money moves exactly once; a rejected request keeps its history; both pages fully translated.

## US-10 · Admin · reviews and reports
As an admin, I moderate reviews and read reports.
- AC: reviews five tabs, filters, detail, publish/reject/spam/delete with reason, rating recalculation; reports period/vendor filters, six cards, three charts, CSV, reconciliation note.
- Edge: no 404 from the sidebar; deleting a review used in reports keeps aggregates consistent.

## US-11 · Any user · stable session and fast navigation
As a user, I navigate without being logged out or staring at a frozen page.
- AC: 30 consecutive admin/vendor navigations across token expiry without logout; refresh keeps session; skeleton appears <300ms; old page never freezes for seconds.
- Edge: network error/5xx does not sign me out; only an invalid refresh token redirects to login with returnTo.

## US-12 · Any user · Arabic typography and errors
As an Arabic user, I see proper Arabic text and a useful error page.
- AC: Arabic font loaded on storefront/admin/vendor/auth; no raw translation keys; no 500 pages; an unexpected error shows a friendly page with an error id.
- Edge: Latin/numbers remain legible with Inter; missing translation falls back to Arabic/English, never a key.
