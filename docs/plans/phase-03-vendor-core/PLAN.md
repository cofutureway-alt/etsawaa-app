# Phase 03 — Vendor Core · PLAN

## 1) Goal
A vendor can sign up, complete onboarding, verify (optional), create full products with variants and images, and reach admin review.

## 2) Scope
**In:** vendor signup · OTP verify · onboarding wizard (5 steps) · optional verification + grace period · store profile (logo/banner/social) · vendor shell · product wizard (5 steps) · variant matrix · MediaPicker integration · product list (clone/archive) · basic admin product approvals.
**Out:** orders/wallet (06) · reports (07).

## 3) Vendor journey (implementation reference)
### 3.1 Entry
`/sell` → intro page → **Create vendor account**.
### 3.2 Signup (single short screen)
Full name · email · phone · password + confirm · terms → submit → OTP screen (6 digits, 60s resend, change email) → auto sign-in → forced `/vendor/onboarding` (cannot skip).
### 3.3 Onboarding wizard (progress bar, autosave, resume)
1. Store: name ar/en · short description · categories (multi) · logo · banner (MediaPicker) · welcome message.
2. Details: first/last name · phone · country (Egypt fixed) · governorate · area · address 1/2 · postal · social links.
3. **Verification — optional:** name/address as on ID · ID front/back · commercial register · tax card · proof of residence.
   - Skipping is allowed → **persistent warning** on dashboard + account icon until verified or grace expires (settings: hours/days/months).
   - After grace: red banner + all products unavailable for sale + forced upload.
4. Terms: contract text from settings + checkbox + typed name signature.
5. Review & submit → status pending (or active if direct-selling setting on).
### 3.4 States
pending · active · grace active · grace expired · rejected (reason + resubmit) · suspended.
## 4) Product decisions
- 5-step wizard: basics · category/brand/tags/media · price/sale · attributes (from leaf template) · shipping/review.
- **Fields:** name/desc/short (ar+en) · leaf category · brand · tags · main image + gallery + optional video · fragile toggle · price · sale price + schedule · weight · dimensions · shipping class · shipping mode (platform/vendor).
- **Template generates the form**; `is_variant_axis` attributes → cartesian product rows (SKU/price/sale/stock/image each).
- Autosave draft per step · vendors cannot add attribute values · clone creates draft "(copy)".
- Status: draft → pending → approved/rejected (reason). Admin setting can skip review.

## 5) Architecture
**Tables:** vendors · store_members · vendor_documents · products · product_attribute_values · product_facets · product_media · variants.
**RPC:** `fn_vendor_onboard` · `fn_generate_variants` · `fn_submit_product` · `fn_admin_review_product` · `fn_expire_grace`.
**Routes:** `/sell` · `/vendor/onboarding` · `/vendor/store` · `/vendor/products(/new,/:id/edit)` · `/admin/products`.
**Components:** VendorOnboardingStepper · DocumentUploader · ProductWizard · AttributeField · VariantMatrixEditor · CategoryPicker · MediaPicker.

## 6) Tasks
See `TASKS.md` (V-01 … V-20).

## 7) Acceptance
Onboarding ≤6 min with ≤10 visible fields per screen · skipping verification leaves a permanent warning that never hides by itself · grace expiry blocks selling at API level · t-shirt product produces an SKU per combination · TV product works in the same wizard without variants · admin rejection reason visible to vendor · draft survives refresh and re-login.

## 8) Verification gate
G1 all tasks · G2 vendor B cannot see A's products/variants/documents (direct ID tests) · G3 tokens only · G4 autosave indicator + unsaved-changes guard + clear warnings · G5 variant matrix becomes cards on mobile · G6 vendor + onboarding pages noindex.

## 9) Risks
Variant explosion → batched save + progress + no double submit · template drift → template version + value snapshot · documents privacy → private bucket + signed URLs.
