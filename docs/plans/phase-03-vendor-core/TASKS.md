# Phase 03 — Vendor Core · TASKS

## Vendor account
- [ ] **V-01** Vendor signup (email+phone+password, terms) + OTP verify + auto sign-in. DoD: duplicate email/phone handled; one store per user enforced.
- [ ] **V-02** Onboarding wizard shell: 5 steps, progress, autosave, resume, block incomplete submit. DoD: refresh/re-login restores exact step and values.
- [ ] **V-03** Step 1 store data + MediaPicker for logo/banner + categories multi-select. DoD: unique store slug auto-suggested.
- [ ] **V-04** Step 2 personal/address data with governorate/area linkage. DoD: area must belong to governorate.
- [ ] **V-05** Step 3 optional verification + DocumentUploader (private bucket). DoD: skip allowed; documents never exposed publicly.
- [ ] **V-06** Grace period engine: calculate from settings, cron expiry, block selling, notifications. DoD: expiry flips all products to unavailable without manual action.
- [ ] **V-07** Persistent verification warning (dashboard + account icon). DoD: cannot be dismissed; disappears only on verify or grace end.
- [ ] **V-08** Step 4 terms + typed signature. DoD: acceptance stored with timestamp/version.
- [ ] **V-09** Step 5 review & submit + status states (pending/active/rejected/suspended). DoD: each state has its own dashboard banner + next action.
- [ ] **V-10** Vendor shell (sidebar/topbar/store switcher) + store settings page. DoD: every route guarded; switching store (if ever allowed) clears stale cache.

## Products
- [ ] **V-11** CategoryPicker (3 levels) + load leaf attribute template. DoD: template renders in exact configured order.
- [ ] **V-12** Product wizard step 1-2: titles/desc ar/en, category, brand, tags, media, fragile. DoD: required fields per settings.
- [ ] **V-13** Step 3: price, sale price, sale schedule. DoD: sale < price; schedule valid.
- [ ] **V-14** Step 4: attribute fields by type + validation. DoD: options only from admin dictionary.
- [ ] **V-15** Variant axis picker + `fn_generate_variants` cartesian generation. DoD: UNIQUE(product, option_key) respected; deleted combos not recreated.
- [ ] **V-16** VariantMatrixEditor: per-row SKU/price/sale/stock/image + bulk fill. DoD: 100 rows editable without lag; mobile cards.
- [ ] **V-17** Step 5: weight, dimensions, shipping class, shipping mode, review/submit. DoD: draft vs pending actions clear.
- [ ] **V-18** Product list: filters, status badges, clone, archive, edit. DoD: clone produces draft "(copy)".
- [ ] **V-19** Admin approvals: approve/reject with mandatory reason + notifications. DoD: vendor sees reason on product page.
- [ ] **V-20** Tests: no variant, single variant, 3 axes, forbidden value, expired grace, draft resume. DoD: all pass in CI.
