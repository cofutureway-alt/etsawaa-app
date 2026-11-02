# AGENT.md — Etsawaa

> Mandatory engineering and design reference. If a verbal request conflicts with this file, this file wins unless the owner explicitly approves a change.

## 1) Locked Decisions (Do Not Reopen)

| # | Decision |
|---|----------|
| 1 | **No taxes anywhere** — no tax field, no tax line, no mention of "tax/VAT" in UI, receipts, or emails. Single exception: the KYC document name "Tax Card" (a document only, never a calculation). |
| 2 | **Zero emojis** in UI, emails, or generated content. |
| 3 | **Zero gradients** — flat colors only. |
| 4 | Brand identity (colors/fonts/logo) is delivered later by the client; everything is driven by design tokens editable from admin settings. |
| 5 | **Coupons are admin-only** — vendors cannot create coupons at all. |
| 6 | **Commission is configured per leaf category** as percent / fixed / both. |
| 7 | **Variant axes are unbounded and flexible** — axes come from the leaf-category template; one image per variant. |
| 8 | **Vendors cannot create attribute values** — they pick from the admin dictionary only. |
| 9 | **One shipping fee per order** (governorate rate) + **pickup fee per product** deducted from the vendor wallet at ship time. |
| 10 | **Kashier** for cards + e-wallets, plus **COD**. |
| 11 | **Email OTP only** at launch (registration, login, password reset). SMS later. |
| 12 | Social login: **Google only**. |
| 13 | **Website only** — no mobile app in this phase. |
| 14 | **React Router 7 (framework mode)** — SSR + SPA together. Next.js is forbidden. |
| 15 | **Supabase** = Postgres + Auth + Storage + Realtime + Edge Functions. |
| 16 | **Real data only** — no mockups in the final product. |
| 17 | Languages: **Arabic (default) + English**, RTL-first. |
| 18 | Guest checkout allowed until checkout; **account creation is forced** to continue. |

## 2) Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 19 + TypeScript (strict) | React Router 7 framework mode + Vite |
| Styling | Tailwind + CSS variables (tokens) | Tokens come from DB, injected at SSR |
| Motion | Framer Motion | 150–300ms, ease-out, respects reduced-motion |
| Data/state | TanStack Query + Supabase JS | No Redux |
| Forms | React Hook Form + Zod | Schemas shared with RPC validation |
| i18n | react-i18next + bilingual DB content | URL prefix `/ar` and `/en` |
| Backend | Supabase (Postgres 15+) | RLS on every exposed table |
| Sensitive ops | Postgres functions (RPC) + Edge Functions | Wallet, commission, webhooks |
| Storage | Supabase Storage (buckets) | Products, store assets, documents, blog |
| Email | Resend (default) + custom SMTP | Templates stored in DB |
| Payments | Kashier hosted checkout + COD | Signed webhook (HMAC) |
| Search | Postgres FTS (AR/EN) + pg_trgm + facets | No external engine at launch |
| Hosting | Node SSR host + Supabase Cloud | Sitemap/robots served by the router |

## 3) Folder Structure

```
etsawaa/
├─ app/
│  ├─ routes/                 # framework-mode route files
│  ├─ components/             # shared UI (ui/, layout/, catalog/, checkout/)
│  ├─ features/               # domain logic (products, cart, wallet, admin…)
│  ├─ lib/                    # supabase, i18n, tokens, zod schemas, money
│  ├─ styles/                 # tokens.css, globals.css
│  └─ root.tsx
├─ supabase/
│  ├─ migrations/
│  ├─ functions/              # edge functions
│  └─ seed/
├─ public/
└─ AGENT.md · ARCHITECTURE.md · plans/
```

## 4) Roles & Isolation

- `admin` — full access.
- `staff` — permission matrix from the Roles page.
- `vendor` — own data only (RLS).
- `customer` — own data only.
- `guest` — public catalog read only.

Rule: UI gating is never security. Every exposed table has RLS enabled + explicit grants + policies on `auth.uid()` and `store_members`.

## 5) Enums (Source of Truth)

- **Product:** `draft` · `pending` · `approved` · `rejected` (+ `rejection_reason`)
- **Vendor:** `pending` · `active` · `suspended`
- **Vendor verification:** `unverified` · `submitted` · `verified` · `rejected` · `grace_expired`
- **Order:** `pending_payment` · `processing` · `on_hold` · `completed` · `cancelled` · `refunded` · `failed` · `draft`
- **Fulfillment (per vendor group):** `received_from_vendor` · `handed_to_carrier` · `out_for_delivery` · `delivered` · `returned`
- **Refund request:** `pending_admin` · `approved` · `rejected` · `completed` · `cancelled` — **Refund record:** `pending` · `processing` · `settled`
- **Vendor shipping approval:** `pending_admin` · `approved` · `rejected`
- **Withdrawal:** `pending` · `approved` · `cancelled`
- **Review:** `pending` · `published` · `spam` · `trash`
- **Coupon:** `active` · `expired` · `disabled`
- **Shipping mode (per product):** `platform` · `vendor`

## 6) Catalog Rules (Product Type System)

1. Admin builds a **leaf-category template**: a list of attributes, each with type (`text|number|bool|enum|color`), unit, required, filterable, **variant axis**, order.
2. Vendor picks the category (3 levels) → **the form is generated from the template**. No hard-coded fields.
3. Axes are the attributes flagged `is_variant_axis`; any number of axes, ordered.
4. On save: **cartesian product** of axes → `variants` rows; each with unique SKU + price + sale price + stock + image.
   - Uniqueness key: sorted option ids joined as `option_key`, `UNIQUE(product_id, option_key)`.
   - Deliberately absent combinations are not generated and are not recreated automatically.
5. Displayed base price = `MIN(variant.price)` — never duplicated on the product row.
6. `enum|color` attributes and all axes must reference admin `attribute_options` (FK). `text|number` attributes accept free descriptive values and are filtered by range/search, not by options.
7. Filtering uses `product_facets` (one row per filter value) + `specs jsonb` for fast display only.
8. Deleting/changing a used attribute = soft delete + `ON DELETE RESTRICT` on references.

## 7) Money (Vendor Wallet)

- Currency **EGP**; every amount stored as integer piastres (`*_piastres`). Floats are forbidden.
- **Commission is calculated on the final price after event/coupon discounts.**
- `wallet_transactions` is the source of truth; wallet balances are derived/updated by triggers.
- Transaction types: `earning` · `commission` · `pickup_fee` · `shipping_revenue` · `penalty` · `ad_purchase` · `withdrawal` · `withdrawal_refund` · `admin_adjustment` · `refund_clawback`.
- Shipping revenue is credited only when admin approves vendor shipping; rejection posts nothing (platform ships).
- Every transaction carries amount, sign, reference (order/item/withdrawal/adjustment), **mandatory reason for deductions**, and actor.
- Earnings become `pending` on delivery and `available` after **N days** (setting, default 14, overridden per vendor level).
- Pickup fee at ship time = quantity × vendor-area pickup rate, one transaction with order reference.
- Balance **may go negative** (refund after withdrawal) — by design.
- Withdrawal: request → admin review → manual transfer (wallet/bank/InstaPay) → approval, fully audited.

## 8) Shipping

- One shipping fee per order, based on the customer's governorate (all 27 governorates in settings).
- **Pickup fee per product**, based on vendor area (area → governorate → pickup rate).
- **Vendor shipping (per product option):** if `vendor`, the order group is `on_hold` pending admin approval.
  - Approved → vendor ships, shipping revenue belongs to the vendor, no platform deduction.
  - Rejected → platform ships, order continues normally.
- Shipment tracking is manual for now, with a schema ready for carrier APIs.

## 9) Payments

- Kashier hosted checkout (cards + e-wallets). Webhook verified with HMAC + idempotency inside an Edge Function.
- COD: confirmed immediately, cash handled offline, payment status managed during fulfillment.
- Refunds: via Kashier when possible; COD refunds are documented manual transfers.
- Keys are managed from admin settings (sandbox/production).

## 10) Design Rules

- **Forbidden:** emojis, gradients, heavy shadows, glow borders, colors outside tokens.
- **Colors:** flat tokens (`--color-*`: primary/secondary/surface/border/text/semantic). Light theme first; dark via tokens.
- **Typography:** `--font-*` replaceable from admin (temporary fallback: IBM Plex Sans Arabic).
- **Motion:** fade+rise 200ms, page transitions 250ms, hover 150ms, skeletons, disabled under `prefers-reduced-motion`.
- **Accessibility:** WCAG AA contrast, visible focus ring, full keyboard navigation, associated labels.
- **RTL:** logical spacing (`inline-start/end`), directional icons mirror automatically.
- **Data-driven UI:** public copy, banners and pages come from DB (only i18n keys live in code).

## 11) SEO

- SSR for every public page + Meta (title/description/OG/Twitter) + `hreflang` ar/en.
- **JSON-LD:** `Organization`, `WebSite` (search), `Product`, `BreadcrumbList`, `BlogPosting`, `ItemList`.
- Dynamic `sitemap.xml` + `robots.txt`; canonical URLs; slug per locale.
- Dashboards and auth pages are explicitly `noindex`.

## 12) Security

- `service_role` is server-side only (Edge/RPC) — never in the browser.
- RLS enabled + default grants revoked + one policy test per table.
- Uploads validated in a function; sensitive documents served via short-lived signed URLs.
- `audit_logs` records every sensitive admin action (before/after/actor/time).

## 13) Performance (Mandatory Indexes)

`products.search_tsv` GIN · `product_facets(attribute_id, option_id)` · `variants(product_id, option_key)` · `order_items(order_id, vendor_id)` · `wallet_transactions(vendor_id, created_at desc)` · `orders(customer_id, created_at desc)` · `orders(status)` · `pg_trgm` on product/store names and SKU.

## 14) Notifications & Email

- `notifications` table (in-app + Realtime).
- `email_templates` in DB (subject + HTML, ar/en + variables), editable with preview.
- Triggers: welcome, verify, new order, payment, shipped, delivered, refund, withdrawal, new vendor, product approved/rejected, event notice, penalty.

## 15) Code Standards

- TypeScript strict; no `any` without a justified comment.
- Money is always `*_piastres: number`.
- Any multi-row write (order/wallet/variants) is **one atomic RPC** — never a client-side sequence.
- Zod schemas shared between UI and RPC (double validation).
- Naming: tables snake_case plural, components PascalCase, files kebab-case.
- No business logic in components — hooks/features only.
- Migrations are dated, descriptive, and reversible.

## 16) Phases (governed by `plans/00-MASTER.md` + `plans/JOURNEYS.md`)

1. **01 Foundation** — `plans/phase-01-foundation/`
2. **02 Media + Catalog setup** — `plans/phase-02-media-catalog/`
3. **03 Vendor core** — `plans/phase-03-vendor-core/`
4. **04 Storefront** — `plans/phase-04-storefront/`
5. **05 Checkout & orders** — `plans/phase-05-checkout-orders/`
6. **06 Vendor operations** — `plans/phase-06-vendor-ops/`
7. **07 Admin suite** — `plans/phase-07-admin-suite/`
8. **08 Content & launch** — `plans/phase-08-launch/`

Each phase folder contains `PLAN.md`, `TASKS.md`, `USER-STORIES.md`.

## 17) Refunds & Warranty

- Two windows: `return` 14 days · `warranty` 30 days, counting from `delivered_at`, both configurable.
- Customer opens a request for one or more items (may span vendors).
- **Admin reviews first**; vendor sees only their items with "under admin review".
- Admin sets fault per item: `vendor` · `shipping` · `customer` · `defect`.
  - `shipping` → carrier bears the cost (documented manual claim), no vendor deduction.
  - `vendor` → automatic penalty + refund clawback from wallet (negative allowed).
- Statuses: `pending_admin` → `approved` | `rejected` → `completed` | `cancelled`.
- **Admin decision is final**; the vendor executes only (no rejection right).
- Stock is restored automatically unless admin opts out.

## 18) Penalties

- Penalty Rules page: create/edit/**soft delete** (history preserved).
- Rule triggers: returns count, defect order, low ratings over a period, packaging complaint (manual).
- Manual apply from the vendor detail page with amount + reason.
- Every penalty posts a wallet transaction with reason and reference; cancellation is `waived` with a reason.

## 19) Ads

- Packages on three placements: `hero_banner`, `footer_banner`, `featured_product`.
- Each package: duration (days), price, temporary discount window, visibility (`vendors|admins`), slots, active flag.
- Vendor pays via **Kashier** or **available unencumbered balance**. Ads can never be bought on credit; a negative balance from other causes does not block online payment.
- Lifecycle: `pending_payment` → `active` → `expired` / `cancelled`; impressions/clicks counters.
- Featured products show the border/mark on home, product listing, and store page until expiry.
- **Single mechanism:** source is `paid` or `admin_grant` (free grant with duration).

## 20) Levels & Badges (single system)

- **Badge = level.** One system: name, icon/badge, promotion rule, rewards shown in the store page.
- Admin manages levels: name, icon, required successful orders, rewards (commission discount %, ad package, hold days, free featured days).
- Default: **"New vendor"**. Silver at 30 successful orders (delivered + hold passed). Gold at 50+.
- Rewards are configurable per level; hold days can be shortened per level.
- Promotion is automatic (cron/RPC) and logged in `vendor_level_history`, with a notification.

## 21) Events

- Admin manages events; default **Black Friday — all of November**.
- Inside an event: category percentage discounts + product coupons (full coupon rules), applied to final product price.
- Vendors are **auto-enrolled** with a red warning notice; they may refuse.
- Refusal → products hidden from home and product listings (store page keeps them) and excluded from event discounts. Acceptance → discounts apply automatically.
- **Manual hide** for any vendor from the Vendors page, with a confirmation dialog.

## 22) COD Restrictions

- **Invoice cap:** admin setting, default **5,000 EGP**; above it COD is disabled.
- **Vendor shipping:** if any item in the order has `shipping_mode = vendor`, COD is **always disabled** (not configurable).
- Both rules are enforced in the UI and inside `fn_create_order`.

## 23) Shared Components & UX

- All UI from `components/ui`: Button, Input, Select, Combobox, Dialog, Drawer, Tabs, DataTable (filters/sort/bulk/export), Stepper, Badge, Card, Toast, Skeleton, EmptyState, FileUpload, Rating, PriceTag, VariantSelector, Timeline, Breadcrumbs, Accordion, Pagination.
- Feature folders: `features/<domain>/{components,hooks,api,schemas}` — no business logic in pages.
- UX rules: skeletons instead of blanks · inline validation · autosave in the product wizard · guided empty states · confirmation before destructive actions · sticky buy bar on mobile · unavailable variant combinations disabled · single-page accordion checkout · order timeline · human-readable errors.

## 24) Media Library

- **Vendor/admin media library** (owner decision — customers never get a library): folder tree (3 levels) + file grid + drag & drop + search + move + preview/copy link/delete. Customer uploads (e.g., avatar) use the native device picker straight into the field.
- **From any image/file field:** "Choose from media" opens the **MediaPicker dialog** (my folders + new folder + upload + single/multi select). No bare file inputs in the final product.
- **Implementation:** custom build = `react-dropzone` (upload/DnD) + `dnd-kit` (move/sort) + Supabase Storage + `media_folders` / `media_files`. (No drop-in library covers folders + RLS + Supabase; Cloudinary/Uppy add vendor lock.)
- **Limits from settings:** allowed mime types, max sizes per kind, max dimensions, PDF toggle — enforced in the UI, before upload, and at bucket level (Edge `admin-update-bucket`).
- **Privacy:** RLS owner-only on both media tables; `media` bucket is public-read with unguessable UUID paths (product images must render for visitors); `documents` bucket is private with signed URLs for KYC and refund evidence.
- **Safe delete:** reference check before actual deletion.

## 25) Verification Gate (Definition of Done)

- **Never** claim a phase is complete before passing **G1–G6** with evidence under `plans/evidence/`:
  G1 functional acceptance · G2 data/RLS + atomicity · G3 design (tokens, zero emoji/gradient, RTL) · G4 UX (≤3 clicks, loading/empty/error, confirms, no data loss) · G5 responsive at 390/768/1280/1440 · G6 SEO/perf (SSR/meta/schema, noindex for panels).
- **No-contradiction rule:** a UX flaw may not be rationalized as "fine"; written G4 criteria decide.
- Any logged defect stays open until fixed and covered by a regression test.

## 26) Journeys

- `plans/JOURNEYS.md` is the single source of truth for every journey (guest, customer, vendor, admin, media, notifications), screen by screen, with states and edge cases.
- Each phase implements its mapped journeys literally; deviations are documented in the phase file before coding.

---

## 27) Workflow: implement in Antigravity, review in Minis

- Implementation happens in **Antigravity**; this repo is the contract (AGENT + ARCHITECTURE + plans).
- After every phase the implementer submits `plans/REPORT-TEMPLATE.md` filled + evidence under `plans/evidence/phase-XX/`.
- Minis reviews against `plans/REVIEW-PROTOCOL.md` and returns: **PASS / PASS WITH FIXES / FAIL** + blockers/majors/minors.
- No phase is closed and no next phase starts without a verdict.
- Owner decisions requested in a report are answered explicitly before the following review.

---

## 28) Order documents & printing

- **Shipment number:** ONE per order — `ETS-YY-###` (e.g., `ETS-26-235`), printed on every label copy and encoded in the Code128 barcode. Multi-vendor orders keep the same shipment number; the carrier receives one shipment.
- **Documents:** admin invoice (A4, full order: all groups, totals, commission, payment method) · carrier shipping label (A5, **one per order**, full customer data: name + primary phone + alternate phone + address, shipments count = total item pieces auto-calculated and editable at print, category, fragile note, products total, shipping fee, COD total, **Code128 of the shipment number**) · vendor label (A5, **one per vendor**, same shipment number as text only, only that vendor's items/category, **customer name only** — no phone/address, amounts = that vendor's items only with the shipping line shown as "—") · packing slip (optional).
- **Copies:** defaults admin = invoice + labels; vendor = own invoice + own label; carrier = 2 labels. Counts editable in settings per document type.
- **Paper:** invoices A4; labels A5 landscape. Server-rendered HTML + `@page` CSS (RTL, Cairo); barcode as inline SVG (`bwip-js`).
- **Access:** vendors print only their own group documents; admins print everything; every print writes `order_documents`.
- **No taxes:** subtotal, discount, shipping, total, COD amount — never a tax line.


---

## 29) Checkout identity rules

- **Email:** displayed read-only at checkout; it is the account email and can never be edited in the checkout flow (changing it requires the profile flow with OTP).
- **Primary phone:** editable at checkout (prefilled from the account).
- **Alternate phone:** mandatory at checkout and must differ from the primary; validated client-side and inside `fn_create_order`.
- Both phones are stored on the order snapshot and used on the carrier label (primary + alternate). Vendor labels never show phone numbers.

---

## 30) Discovery & account features

- **Wishlist:** heart toggle on product cards and the product page; guests are prompted to sign in; one row per (user, product); account page lists items with unavailable states and "move to cart".
- **Recently viewed:** every product page view records (user, product, viewed_at); the account shows the **last 20** products (most recent first), deduplicated, with a "clear history" action. Guests use localStorage; signed-in users use the DB and merge on login. A "you viewed before" strip also appears on the home page and the product page.
- **Compare:** users can compare **two products** side by side at `/compare?ids=p1,p2` (any categories); the table renders the attributes shared by both products plus price/rating/vendor, with a notice when categories differ. URL-based (no table).
- **Profile page (all roles):** shared profile screen for customer/vendor/admin/staff — edit full name, primary phone, alternate phone, other personal data, password change (current + new), and avatar via MediaPicker. **Email changes require the OTP flow.** **Vendor profile shows the store name** (owner details underneath) and **vendor avatar = store logo** (`vendors.logo_url`); admin/staff keep a personal avatar.

---

## 31) Coupon funding types

- **`product_percent` / `product_fixed`** — the classic discount on the product price; the vendor bears it (commission is computed on the discounted price).
- **`commission_percent`** — NEW: the coupon value is a percentage **of the platform commission**, not of the product price.
  - Formula (per item): `commission = rate × item_total` → `discount = coupon_percent × commission`.
  - Example: item 100 EGP, commission 10% = 10 EGP, coupon 30% → discount = **3 EGP** (never 30 EGP).
  - Customer sees a normal discount label ("خصم 30%") with the resulting amount; no mention of commission.
  - Vendor earnings are untouched (full item total); the platform's net commission is reduced by the discount.
  - The discount can never exceed the commission (by construction); zero-commission items produce zero discount.
  - Rounding: per item to the nearest piastre; the sum is the order-level commission-funded discount.
- **Stacking:** decided per coupon by the admin (`stackable` flag). When stacked, product-funded discounts apply first, then the commission-funded one is computed on the already-reduced commission.
- Coupons are admin-only; event coupons use the same engine but stay separate from ad packages.
- **Delivery:** `commission_percent` ships in **Phase 06** (post-checkout coupon extension). Phase 05 implements only `product_percent` / `product_fixed`.
