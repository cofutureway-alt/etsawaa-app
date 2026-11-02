# Phase 03 — Vendor Core · REPORT

**design skill: ui-ux-pro-max — invoked at step "after reading plans, before any vendor screen code" — output applied:**
wizard progress indicators (Stepper + "step N of 5" + aria-current), submit loading/disabled states on every primary action, labeled inputs with inline errors wired through aria-describedby/aria-invalid, focusable error summary (role=alert, tabindex=-1, items jump to the invalid field) on failed wizard submits, OTP paste allowed with `autocomplete="one-time-code"` (no paste blocking, WCAG 2.2 authentication), memoized variant-matrix rows for 100-row editing, matrix becomes cards under md (G5), aria-labels on every icon-only control, aria-hidden on decorative icons, errors announced via role=alert, color never the only indicator (badges carry text), persistent warning uses text-safe `--color-warning-strong` (7.1:1) on `--color-warning-soft`.

Carry-over (Phase 02 evidence, resolved first): `phase-02` re-tagged **lightweight at HEAD** so `git rev-parse phase-02` == `git log -1 --format=%H` == `51f33b02…` — ONE SHA; `evidence/phase-02/commit.txt` regenerated (ends with one SHA + clean `git status --porcelain`, file gitignored); evidence zip rebuilt without commit.txt and committed (commit `51f33b0225b2f55ead9c36a3e09e46beac7f9921`).

## Migration (applied via Management API SQL endpoint)

- `supabase/migrations/20261031000002_phase03_vendor_core.sql` — vendor_levels (+ seeded "New vendor"), vendors (owner_id UNIQUE = one store per user; status draft/pending/active/rejected/suspended; verification_status incl. grace_expired; grace_until; onboarding_step; terms snapshot), store_members, vendor_documents (UNIQUE per type), products (+ generated `search_tsv` 'arabic' + pg_trgm), product_attribute_values, product_facets, product_media, product_tags, variants (partial-unique option_key + SKU among live rows; tombstone `deleted_at` blocks regeneration), settings `verification`/`vendor_terms`/`vendors` + site.general vendor switches, RLS on all 10 tables + grants (child tables: reads only — every write through definer RPCs), storage documents owner policies reused, pg_cron job `expire-vendor-grace` (daily 03:10 UTC → `fn_expire_grace()`).
- `20261031000003_phase03_vendor_rpc_patch.sql` — drafts may lack a category; `fn_submit_product` validates completeness (names, leaf category, media, complete variants, required non-axis attributes) + selling gate; `fn_archive_product`.
- `20261031000004_seed_geography.sql` — the 27 real governorates + real areas.
- RPCs (definer, SECURITY DEFINER + pinned search_path, all revoke→grant to authenticated): `fn_vendor_config`, `fn_vendor_onboard`, `fn_vendor_autosave`, `fn_generate_variants` (desired-set diff: inserts missing combos, tombstones removed ones, NEVER recreates tombstoned, returns skipped), `fn_restore_variants`, `fn_save_variants`, `fn_save_product` (atomic product+attributes+facets+media+tags+specs in ONE call), `fn_submit_product`, `fn_clone_product` (draft "(copy)"/"(نسخة)" + `-C{n}` SKU suffixes + template-drift report), `fn_admin_review_product` (reason mandatory), `fn_admin_review_vendor`, `fn_admin_verify_vendor`, `fn_expire_grace`, helpers `fn_vendor_slug`/`fn_product_slug`/`fn_attr_in_template`/`product_is_public`/`product_owned_or_admin`/`vendor_can_sell`.

## V-01…V-20

| # | Task | Evidence |
|---|------|----------|
| V-01 | Vendor signup (name/email/phone/password/terms) + OTP + auto sign-in; dup email handled; one store per user | `/ar/sell` → `/ar/auth/register?intent=vendor` (`screens/vendor-signup-{390,768,1280,1440}.png`); OTP screen `screens/vendor-otp-{390,1280}.png` (see the G5 quota note); verify promotes the vendor server-side; **raw tests**: `rls-tests-raw.txt` §"duplicate email signup never completes" + §"vendor B cannot create a store owned by another user" + §"exactly 3 vendor rows for 3 vendors" |
| V-02 | Onboarding wizard shell: 5 steps, progress, autosave, resume, blocked incomplete submit | `screens/onboarding-step{1..5}-{390,768,1280,1440}.png` (all five steps at all four widths), Stepper + "خطوة N من 5" + "جارٍ الحفظ…/حُفظ HH:MM"; **draft survives re-login with exact values** (raw test: `{"store_name_ar":"متجر أ",…,"onboarding_step":2}` after a fresh sign-in) |
| V-03 | Step 1 store data + MediaPicker logo/banner + categories multi; unique slug auto-suggested | `screens/onboarding-step1-1280.png`; slug auto-filled from the English name (editable); MediaPickerDialog reused (`media.picker.choose`); uniqueness by `fn_vendor_slug` suffixing (raw: slugs `store`, `store-1`, `store-2`) |
| V-04 | Step 2 personal/address with governorate→area linkage | `screens/onboarding-step2-{390,768,1280,1440}.png`; changing governorate clears the area (client) and the RPC re-validates **area ∈ governorate** (raw: "area∉governorate rejected server-side") |
| V-05 | Step 3 optional verification + DocumentUploader (private bucket) | `screens/onboarding-step3-verification-{390,768,1280,1440}.png`; per-type uploader (config from settings), PDF/image + size enforced, progress bar, replace; skip allowed; **raw tests**: "anon direct GET on private object denied (HTTP 400)", "B cannot read A's document metadata", "B cannot sign A's object", "owner signs their own document" |
| V-06 | Grace engine: settings-driven, cron expiry, block selling, notifications | settings `verification` (7 days default); pg_cron `expire-vendor-grace` daily; **raw tests**: "fn_expire_grace flipped 1 vendor", "vendor C → grace_expired", "expired grace blocks publish at API level (`selling is blocked…`)", "grace-expired vendor product hidden from public", "grace-expired variants hidden from public", "admin verification → verified" restores publishing |
| V-07 | Persistent non-dismissible warning (dashboard + account icon) | rendered in the vendor layout on EVERY panel page + topbar badge — no close control; `screens/vendor-dashboard-{390,768,1280,1440}.png` show the warning strip + countdown "متبقي 6 يوم و23 ساعة"; disappears only on verify (raw: verification approve) or grace end |
| V-08 | Step 4 terms + typed signature | `screens/onboarding-step4-terms-{390,768,1280,1440}.png`; contract text from `settings.vendor_terms` (versioned); raw: "terms+signature mandatory" (empty signature rejected server-side) |
| V-09 | Step 5 review & submit + state banners | `screens/onboarding-step5-review-{390,768,1280,1440}.png` (summary with per-section edit links), `screens/onboarding-done-1280.png` (confirmation + next steps + grace date); state banners pending/rejected(with reason + resubmit)/suspended/grace-expired in `app/layouts/vendor.tsx` + `screens/grace-expired-dashboard-{390,1280}.png`; rejected + suspended banners with reasons: `vendor-dashboard-rejected-{390,1280}.png`, `vendor-dashboard-suspended-{390,1280}.png` |
| V-10 | Vendor shell + store settings; every route guarded | sidebar (dashboard/products/new/store/media + disabled 06 items) in `screens/vendor-dashboard-1280.png`; `screens/vendor-store-settings-{390,768,1280,1440}.png`; guards: layout redirects draft/no-store → `/vendor/onboarding` (no skip), all /vendor routes role-gated server-side |
| V-11 | CategoryPicker (3 levels) + leaf template load | `screens/product-wizard-step2-1280.png`; template = own-leaf defs + category_attributes links, ordered by `sort`; depth-2 categories complete the pick directly |
| V-12 | Wizard steps 1–2: ar/en names/desc, category, brand, tags, media, fragile | `screens/product-wizard-step{1,2}-{390,768,1280,1440}.png`; media via MediaPickerDialog (main = first), tags from admin dictionary |
| V-13 | Step 3: price, sale price, schedule | `screens/product-wizard-step3-{390,768,1280,1440}.png`; sale < price + schedule validity (zod + RPC); defaults pushed to generated variants, per-row overrides kept |
| V-14 | Step 4 attribute fields by type; admin options only | `screens/product-wizard-step4-{390,768,1280,1440}.png`; enum/color = Select of admin options (color swatches), number with unit, bool checkbox, text; **raw tests**: "forbidden value (option from another attribute) rejected", "vendors cannot write attribute values directly (grant revoked)" |
| V-15 | Axis picker + `fn_generate_variants` cartesian | **raw tests**: "3×4 cartesian generated = 12 rows", "12 live rows with distinct option_keys", "desired-set diff tombstones removed combos (4 removed)", "deleted combos NOT recreated (skipped=4)", "explicit restore revives a tombstoned combo" |
| V-16 | VariantMatrixEditor: per-row SKU/price/sale/stock/image + bulk; mobile cards | `screens/variant-matrix-desktop-{768,1280,1440}.png` (12 rows, swatches, thumbnails) + `screens/variant-matrix-mobile-cards-390.png` (cards — G5 rule); memoized rows; **raw**: "12 rows saved with unique SKUs", "duplicate SKU in one save blocked", "SKU colliding with an existing live row blocked" |
| V-17 | Step 5: weight/dims/class/mode + review/submit; draft vs pending clear | `screens/product-wizard-step{1..5}-{390,768,1280,1440}.png` (step 5 captured at all four widths — P3-2); "حفظ كمسودة" + "إرسال للمراجعة" separated; read-only mode + banner for pending/approved products; **raw**: "t-shirt submit → pending", "product is incomplete: …" validation |
| V-18 | Product list: filters, badges, clone, archive, edit | `screens/vendor-products-{390,768,1280,1440}.png`; **raw**: "clone creates draft (copy)" + "clone got unique SKU suffixes (-C1)" + "archive hides product from list" |
| V-19 | Admin approvals with mandatory reason + notifications | `screens/admin-products-queue-{390,768,1280,1440}.png`, `admin-product-review-dialog-{390,768,1280,1440}.png` (reason textarea), `screens/admin-vendors-queue-{390,768,1280,1440}.png`; **raw**: "product rejection reason mandatory", "admin rejects with reason", "vendor sees the rejection reason", "rejected product resubmits → pending", "approve publishes both products", "admin-only review RPC blocked for vendor", "admin-only verify RPC blocked for vendor"; vendor notified via `notifications` rows (`fn_notify` in every decision RPC) |
| V-20 | Tests: no variant, single variant, 3 axes, forbidden value, expired grace, draft resume | `evidence/phase-03/rls-tests-raw.txt` — **73/73 PASS** (`test-results.json`): no-axes TV = one plain row (`option_key=''`), 3-axis t-shirt = 12 SKUs, forbidden value rejected, grace-expired submit blocked + public-hidden, draft survives re-login, plus publish-rules-follow-settings ("review-off setting → submit publishes directly") |

## Extra journeys honored

- US-01 upgrade path: an existing customer email gets the "sign in then complete your store" message; a customer may enter `/vendor/onboarding` directly — `fn_vendor_onboard` promotes `customer → vendor` (raw: "onboarding promoted customer → vendor", fixtures started as customers).
- US-08/US-09/US-10/US-11/US-12 edges covered by the raw suite (removal confirmation → tombstone + explicit restore; two-tab staleness returns `stale` → warning banner; rejected resubmit; clone drift report `drifted_attributes`).
- Publish rules follow settings (product_review_required on/off) — raw test included.

## Gates

- **G1** functional acceptance: V-01…V-20 above (73/73 raw assertions).
- **G2** data/RLS + atomicity: direct-ID A/B isolation (vendor row, product, variants, attribute values, media, list-by-vendor_id), documents private (anon GET 400 / no cross-vendor sign / owner signs), admin-only RPCs blocked for vendors + anon (`fn_vendor_config` denied for anon); all multi-row writes are single definer RPCs.
- **G3** design: `scripts/scan-design.mjs` → **PASS** (zero emoji, zero gradients, hex only in token files); flat tokens; RTL-first (logical properties throughout).
- **G4** UX: autosave indicator ("جارٍ الحفظ…/حُفظ HH:MM"), beforeunload + dialog guard, focusable error summaries, removal confirmations (matrix diff count + archive dialog), read-only protection for pending/approved products, empty states everywhere.
- **G5** responsive — the real evidence set (`screens/`, 85 files):
  * 390/768/1280/1440 (complete): sell · onboarding steps 1, 2, 3(verification), 4(terms), 5(review) · product wizard steps 1–5 · vendor dashboard · admin products queue.
  * 390/1280 (both): vendor signup · vendor OTP screen · grace-expired dashboard · rejected-vendor dashboard · suspended-vendor dashboard.
  * 390/768/1280/1440: admin vendors queue; admin product review dialog (390/768/1440 + 1280 from the first round).
  * 390/768/1280/1440: variant matrix — 390 = cards (G5 rule), 768/1280/1440 = desktop table; vendor products and store settings (768 added on review; 390/1280/1440 from the first round).
  * 1280 only: onboarding-done confirmation (single-state screen).
 OTP note: the vendor OTP screenshots (`vendor-otp-390/1280.png`) show the exact redirect target the register action produces (`/ar/auth/verify?email=…&next=/vendor/onboarding` — same route and component as the real flow); the live signup could not be driven during the capture because the project email quota was exhausted by the test runs (`over_email_send_rate_limit`).
- **G6** noindex: `<meta name="robots" content="noindex, nofollow">` in PanelShell + onboarding shell + product wizard.

## Regression (final build)

- `npm run typecheck` — 0 errors · `npm run lint` (oxlint) — 0 warnings 0 errors · `npm test` — 40/40 (unit incl. new `tests/variant.test.ts`: cartesian 3×4=12, canonical keys, bulkFill semantics) · `npm run build` — OK · `scripts/scan-design.mjs` — PASS.
- API/RLS suite: `node --env-file=.env scripts/test-phase3-vendor.mjs` → `rls-tests-raw.txt` + `test-results.json` (73/73). DB pristine after cleanup (vendors=0, products=0, users=0).
- Screens: `node --env-file=.env scripts/phase3-screens.mjs` + `scripts/phase3-screens2.mjs` (review round P3-1..P3-4) + `scripts/phase3-otp-shot.mjs` → 85 PNGs, DB pristine after.

## Defect log (found & fixed during this phase)

1. `attribute_options.code` rejects 1-char codes (`{2,40}` check) — size options seeded `sm/md/lg/xl` with S/M/L/XL labels.
2. Template membership initially checked only `category_attributes`, missing own-leaf defs (phase-02 model) — added `fn_attr_in_template` used by generate/save/submit + loader.
3. Child-table RLS policies referenced `vendors` inline → anon got `permission denied` — owner/admin branch moved into the definer `product_owned_or_admin()`.
4. `fn_generate_variants` ambiguous `value` alias (jsonb_array_elements column) — renamed.
5. Products.leaf_category_id NOT NULL blocked category-less drafts — dropped; submit validates it.
6. MediaImage `srcSet` pointed at the image-render endpoint which 403s on this project (transformations not enabled) — plain public `src` restored.
7. CategoryPicker mis-synced depth-2 leaves — ancestor-walk + childless-level-2 completes the pick.
8. Wizard autosaved non-draft products (RPC correctly refused) — read-only mode for pending/approved with banner; autosave gated on editable.
9. Wizard autosave overwrite risk — `apply_defaults` only sent when pricing changed (per-row edits preserved); two-tab staleness → warning banner.
10. Phase-02 policy re-runs weren't idempotent — `drop policy if exists` added before every create.


## UX / speed audit (owner review round)

Measurements: `perf-audit.json` · fix verification: `ux-fixes-verify.json`.

**Throttled LCP — 4x CPU + slow-4G (Lighthouse mobile profile), authenticated vendor session:**

| Page | LCP |
|---|---|
| /ar/vendor (dashboard) | **652 ms** |
| /ar/vendor/onboarding (wizard) | **1 068 ms** |
| /ar/vendor/products | **760 ms** |
| /ar/vendor/products/:id/edit (wizard, 121-variant draft) | **1 516 ms** |

All under the 2.5 s gate; LCP element is text on every page (no panel hero images).

**Variant matrix at scale (V-16: 100 rows without lag):** a real 121-row product
(11 colors × 11 sizes) renders and edits — keystroke-to-paint p50 **75 ms**,
max **84 ms** (desktop-class, no CPU throttle), over 10 sampled inputs.

**Bundle:** 69 client chunks, 1 178 KB raw total; route code-splitting keeps the
heavy screens small — product-wizard 32 KB, onboarding 24 KB, media-ui 78 KB,
entry 211 KB.

**Defects found by the audit — both fixed and verified live:**
1. False two-tab warning: the staleness check compared every save against the
   loader-time timestamp, so the SECOND autosave of a session flagged itself
   stale. The save action now returns the fresh `updated_at` and the client
   advances its base (`verify: consecutive autosaves do NOT raise the stale banner`).
2. Store settings kept the previous governorate's area preselected after a
   governorate change (the submit then failed area∈governorate validation) —
   the area select now resets on change (`verify: area select resets...`),
   matching US-03's edge rule (the onboarding wizard already did this).

## Commit

Tag `phase-03` (lightweight) → one SHA quoted in `commit.txt` (same protocol as phase 02): `git rev-parse phase-03` + `git log -1 --format=%H` + `git status --porcelain` (clean; commit.txt gitignored).
