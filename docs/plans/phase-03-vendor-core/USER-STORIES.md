# Phase 03 — Vendor Core · USER STORIES

## US-01 · New vendor · sign up
As a new vendor, I create an account from the Seller Center.
- AC: form validates email, Egyptian phone, strong password, terms; submit → OTP screen; verifying signs me in and lands on onboarding step 1 (no other page reachable).
- Edge: existing customer account using the same email → offer upgrade to vendor (one store per user) or sign-in; wrong OTP → attempts counter + resend cooldown.

## US-02 · Vendor · store info
As a vendor, I fill my store name, logo, banner, categories.
- AC: names ar+en; logo/banner via MediaPicker; slug auto-suggested and editable; validation inline.
- Edge: duplicate store name → suggested alternative; missing banner shows a neutral placeholder (never a broken image).

## US-03 · Vendor · personal & address
As a vendor, I provide contact and address details.
- AC: phone, governorate, area (dependent), address lines, optional postal, social links; save & continue.
- Edge: changing governorate clears an invalid area and asks to reselect.

## US-04 · Vendor · skip verification
As a vendor, I can skip the verification step and start selling during the grace period.
- AC: skip allowed; a permanent (non-dismissible) warning appears on dashboard + account icon; countdown = grace from settings; warning never disappears on its own.
- Edge: after grace expiry → red banner, product pages show "unavailable", attempts to publish/sell are blocked server-side.

## US-05 · Vendor · upload documents
As a vendor, I upload KYC documents privately.
- AC: only configured document types; sizes enforced; upload progress; statuses per document (pending/verified/rejected with reason).
- Edge: rejected document can be replaced without redoing other steps; documents never appear in the public media library.

## US-06 · Vendor · accept terms
As a vendor, I accept the contract with a typed signature.
- AC: checkbox + typed full name; stored with version + timestamp.
- Edge: updated contract version requires re-acceptance before next publish.

## US-07 · Vendor · review & submit
As a vendor, I review everything and submit for activation.
- AC: summary with edit links per section; submit → pending (or active if direct-selling); confirmation screen explains what happens next.
- Edge: network error on submit → nothing partially saved; retry safe.

## US-08 · Vendor · create a clothing product with variants
As a vendor, I add a t-shirt with colors and sizes.
- AC: choose leaf category → form appears; pick colors from admin options; sizes per color; generate matrix (e.g., 3 colors × 4 sizes = 12 rows); each row gets SKU, price, sale (optional), stock, image; bulk fill works; validation blocks empty SKU/price.
- Edge: removing a color removes its rows with confirmation; re-adding does not resurrect deleted rows silently; duplicate SKU blocked.

## US-09 · Vendor · create a TV without variants
As a vendor, I add a TV where the category has no axes.
- AC: no variant section; single price/stock/SKU fields; specs table from attributes (inches, panel, resolution).
- Edge: category with axes but product has one variant → one row, clearly labeled.

## US-10 · Vendor · draft safety
As a vendor, I leave mid-product and come back later.
- AC: autosave indicator "Saved"; reopening restores exact data + step; explicit "Leave" confirmation if unsaved.
- Edge: two tabs editing the same product → last save wins with a warning banner.

## US-11 · Admin · review product
As an admin, I approve or reject submitted products with a reason.
- AC: queue with filters; detail preview as the storefront sees it; reject requires a reason; vendor notified.
- Edge: bulk approve only for products with no warnings; rejected product can be edited and resubmitted.

## US-12 · Vendor · clone product
As a vendor, I duplicate an existing product to save time.
- AC: clone copies fields + variants but creates a draft named "(copy)"; SKUs must be unique → auto-suffix suggestion.
- Edge: cloning a template-drifted product warns that some attributes are no longer in the current template.
