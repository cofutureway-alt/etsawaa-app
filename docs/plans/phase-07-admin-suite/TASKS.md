# Phase 07 — Admin Suite · TASKS

## Dashboard & money
- [ ] **A-01** Dashboard: quick actions (vendor/product approvals, pending withdrawals, pending verifications), sales + deep stats cards, monthly overview, daily chart, all-time stats, top vendors, top-rated products. DoD: every number traced to a documented query; period filter works.
- [ ] **A-02** Withdrawals: tabs, export CSV, approve/cancel with reason. DoD: wallet moves exactly once; audit entry written.
- [ ] **A-03** Reports: period/vendor filters, six cards + three charts, All logs, Admin earnings. DoD: totals reconcile with `wallet_transactions` and `payments`.

## Vendors
- [ ] **A-04** Vendors list + filters + row actions (edit/products/orders/ban/hide/penalty). DoD: every action audited; banned vendor hidden from public listings.
- [ ] **A-05** Vendor edit · General tab: selling permissions, direct publish, featured (timed/permanent), store data + media. DoD: saves independent of other tabs.
- [ ] **A-06** Vendor edit · Commissions tab: inherit / fixed / category-based with parent inheritance. DoD: preview shows the next order's commission.
- [ ] **A-07** Vendor edit · Social tab + verification details + penalties + wallet + ads history. DoD: no sensitive document URL without signed access.
- [ ] **A-08** Hide listings (confirm dialog) + unban with reason. DoD: reversible; products return on unhide.

## Catalog & products
- [ ] **A-09** Products list: all filters/columns + import/export + clone + view + archive. DoD: import validates rows and reports errors per line.
- [ ] **A-10** Product editor = wizard + admin vendor change + rejection reason. DoD: admin edits keep audit history.
- [ ] **A-11** Catalog: categories tree, brands, tags, attributes (shared editors with Phase 02). DoD: reordering persists.
- [ ] **A-12** Coupons: list + full form (code/generate, type, value, free shipping, scopes include/exclude, limits, stackable, exclude sale, validity) + usage explanations. DoD: invalid combinations blocked before save.
- [ ] **A-13** Reviews: five tabs + publish/reject/spam/delete with reason. DoD: product rating recalculated after moderation.

## Orders & refunds
- [ ] **A-14** Orders list: filters, bulk status change/delete, columns incl. shipment/origin/commission/vendor. DoD: bulk change validates each order and reports failures.
- [ ] **A-15** Order detail: billing/shipping/invoice, customer history, items + commission, notes private/public, manual edits with audit. DoD: every manual edit shows before/after.
- [ ] **A-16** Refunds queue + per-item decision, fault, amount, restock. DoD: vendor sees only their items after decision.
- [ ] **A-17** Execute refunds (Kashier API or manual record) + settle + notifications. DoD: idempotent; refund record matches payment method.

## Trust & growth
- [ ] **A-18** Penalties: rules CRUD (soft delete), applications list, waive with reason, manual apply from vendor page. DoD: history never lost; every penalty has a wallet transaction.
- [ ] **A-19** Levels & badges: CRUD, rewards, manual promote/demote, history. DoD: reward changes apply to future calculations only.
- [ ] **A-20** Ads: packages CRUD (placement/duration/price/discount window/visibility/slots), campaigns list, admin grants. DoD: grant creates an active campaign with `source=admin_grant` and no payment.
- [ ] **A-21** Events: CRUD, Black Friday preset, category discounts, product coupons, vendor list/refusals, manual hide. DoD: refusal hides products publicly within one request cycle.
- [ ] **A-22** Featured controls: product/vendor timed or permanent + hide-listings switch. DoD: expiry auto-clears at the minute level.

## Account & system
- [ ] **A-23** Customers CRUD + order history. DoD: deleting a customer with orders is blocked (anonymize instead).
- [ ] **A-24** Settings sections with independent save + preview + change log. DoD: every field listed in JOURNEYS §16.16 exists, including Notifications.
- [ ] **A-25** Email templates editor + test send; SMTP/Resend switch. DoD: preview matches the received email.
- [ ] **A-26** Roles & permissions matrix + users list (ban/delete/add). DoD: last admin cannot be demoted.
- [ ] **A-27** Blog admin: posts editor ar/en + categories + SEO + preview. DoD: drafts never public; slug conflicts blocked.
- [ ] **A-28** Audit log viewer with filters. DoD: sensitive values masked.
- [ ] **A-29** Manual wallet adjustment `fn_admin_adjust_wallet` (reason + reference + audit). DoD: cannot create a transaction without a reason.
- [ ] **A-30** Media settings page (shared with 02) inside Settings. DoD: changes reflected on the bucket and next upload.
- [ ] **A-31** Responsive admin: tables→cards, drawers for filters, one-handed actions. DoD: no horizontal scroll at 390.
- [ ] **A-32** Banners manager: hero/footer placements, image via MediaPicker, link, dates, order, active toggle. DoD: expired banner disappears automatically.
- [ ] **A-33** Static pages manager: create/edit pages, slug ar/en, content, header visibility, order. DoD: published page reachable; unpublished returns 404.
- [ ] **A-34** G1–G6 evidence pack + four breakpoints. DoD: stored in `plans/evidence/phase-07/`.
- [ ] **A-35** Shipping zones manager: governorates CRUD (name ar/en, shipping fee, active, sort) + areas CRUD under each governorate (name ar/en, pickup fee, active). DoD: validation (fees ≥ 0, unique name per parent); rows referenced by orders/vendors are **disabled, never hard-deleted**; every change audited; new orders use new fees while existing orders keep their snapshots.
- [ ] **A-36** Areas dataset: import the full Egypt areas set (markaz/neighborhoods per governorate) via admin CSV upload + idempotent seed. DoD: per-governorate counts verified, re-import creates no duplicates, admin can still add/edit a single area manually.
- [ ] **A-37** Document settings: paper size (invoice A4 / label A5 landscape), copies per document type (admin invoice, carrier label, vendor invoice, vendor label), header/footer text ar/en, logo (MediaPicker), terms note, show-commission toggle, cancelled watermark text, barcode height. DoD: changes apply to the next print without deploy; preview included.
- [ ] **A-38** Admin print center: from an order, print the full invoice + carrier label (one per order) + all vendor labels in one job; bulk print by date/status; every action logged. DoD: 3-vendor order prints 1 invoice + 1 carrier label + 3 vendor labels.
- [ ] **A-39** Admin/staff profile at `/admin/profile`: shared profile component (name/phone/phone_alt/password/avatar); permissions respected. DoD: staff edits only their own profile.
