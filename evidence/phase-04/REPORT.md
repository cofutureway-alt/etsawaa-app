# Phase 04 — Storefront · REPORT

> **CORRECTION + FIX ROUND (P4-0 / R1 / R3 / R4 / performance) — 2026-10-31.**
> B1 (home layout) WITHDRAWN by the owner — screenshot-harness artifact, not a layout defect. This round:
> **P4-0** capture moved to Playwright with the owner-specified protocol — viewport/dSF-1, networkidle + `document.fonts.ready`, one full lazy-scroll, per-shot assertions (`clientWidth === width`, `scrollWidth === clientWidth`, main container ≥1100px at 1440) — **18/18 pass** (`p40-log.txt`, `p40-assertions.json`), 12 corrected home captures (AR+EN ×4 widths + strip populated/absent). **The large empty block above the footer does NOT reproduce** in a correct capture: measured gap between the last section and the footer is 24px (the normal section margin) — no code change, as instructed.
> **R1** commit.txt now carries the raw output of `git rev-parse phase-04`, `git log -1 --format=%H`, `git status --porcelain` (one matching SHA, clean tree, file gitignored).
> **R3** wishlist + recently-viewed ACCOUNT TABS deferred to Phase 05 (O-21/O-29): routes removed from the app, S-13/S-22 claims corrected below. The storefront heart toggle, guest wishlist stash, and "you viewed before" strips remain live.
> **Owner fix round (post-review):** `/sell`, `/auth/login` and `/auth/register` now render under the normal public header/footer (routes moved inside the public layout; auth card shell centered inside the frame; noindex kept). Verified: header+footer present on all three (`layout-fixar-*.png` shots + programmatic check).
> **R4** Lighthouse numbers corrected (the reviewed JSON read 92/93, not 93/90) — and after this round's performance sprint, the 3-run medians are home 93 / product 98 (`perf-3x.json`).
> **Performance sprint (one round):** LCP element identified = the hero banner IMG (P4-0 harness). Changes: variable Cairo (one file, 200..1000, replaces five static font downloads), single conditional hero preload (only the first hero image, high priority — two competing high-priority images cost ~+1s on 1.6Mbps), preconnect to the storage origin, same-origin media proxy with SSR-warmed in-process cache (`/api/media?path=…`, immutable caching), below-fold widgets code-split (CartDrawer/CompareBar/ProductCard → lazy chunks), critical-path audit of the entry bundle. **Result: product LCP 2318ms median → PASS (<2.5s); home LCP 2945ms median → inside the 2.5–3.2s waiver band with ALL FOUR conditions met** (TBT 70ms < 150 · CLS 0.00 < 0.05 · real-throttled SSR LCP 796ms < 1.2s · score 93 ≥ 90). **Explicit owner waiver requested for home.** 3-run medians + per-run numbers in `perf-3x.json`; bundle diff in `bundle-diff.json`; before-state JSON preserved as `seo-perf.json` (home 92 / 3268ms, product 93 / 3297ms — single-run, pre-optimization).

**Date:** 2026-10-31 · **Branch:** main · **Design protocol:** design skill: ui-ux-pro-max — invoked at Phase 04 start (before any design work) — output applied: e-commerce "Feature-Rich Showcase / Vibrant & Block-based" pattern mapped onto the project's locked token system (Etsawaa red tokens + Cairo, AGENT §10 — the skill's generic green palette/Noto fonts were rejected as they conflict with the token lock); disabled-combo rule (opacity + cursor-not-allowed); no-results guidance; debounced autocomplete; filter chips wrap; full pre-delivery checklist.

**Verification snapshot:** typecheck 0 errors · oxlint 0 warnings / 0 errors · unit 46/46 · build OK · design scan PASS · API/RLS suite 67/67 (`evidence/phase-04/rls-tests-raw.txt`) · screens 7/7 checks, 54 PNGs at 390/768/1280/1440 (`evidence/phase-04/screens/`, `screens-log.txt`) · G6 SEO/perf 25/25 (`evidence/phase-04/seo-perf.json`) · DB pristine after every run (0 products / vendors / categories / brands / users).

---

## Deliverables (S-01 … S-22)

| # | Task | Evidence | Commit |
|---|------|----------|--------|
| S-01 | Home: DB banners (carousel), categories panel + strip, featured vendors (border+mark), featured products (featured border+mark), top-rated, active event block, "you viewed before" strip; every section hides when empty (US-01 edge) | `screens/home-ar-{390,768,1280,1440}.png`, `home-en-*.png` | (SHA) |
| S-02 | Category page: header (thumb/description), subcategory cards, breadcrumbs, listing with facets; only active nodes resolve (missing slug → 404) | `screens/category-*.png` | (SHA) |
| S-03 | Listing: facets (category/brand/attributes of the current category/rating/in-stock/price), sort (4), count, pagination; URL carries full filter state (`?cat=&brand=&color=&pmin=&rating=&stock=1&sort=&page=`) — shareable, back restores exactly | `screens/listing-filters-*.png` + counts asserted vs DB in `rls-tests-raw.txt` (FILTER COUNTS section) | (SHA) |
| S-04 | Search: instant suggestions (products/categories/stores via `/api/search-suggest`, 250ms debounce), results page, no-results guidance + "did you mean" (normalized trgm), Arabic normalization (`ar_norm` hamza/taa-marbuta/yaa/tashkeel — asserted: "احمد" finds "أحمد") | `screens/search-results-*.png` + `rls-tests-raw.txt` (SEARCH NORMALIZATION) | (SHA) |
| S-05 | Product page: gallery (per-variant image swap, thumbs), variant selector with disabled impossible combos (in-stock combination check), price/sale/window/event discount, specs table, reviews tab (distribution + list), vendor card with level badge, related, more-from-store, sticky mobile buy bar, shareable `?v=<option_key>` | `screens/product-*.png` (desktop shows 3 colors × 4 sizes) + `rls-tests-raw.txt` (PRODUCT PAGE DATA) | (SHA) |
| S-06 | Store page: banner/logo, level badge, rating, product grid; suspended store → notice + no purchasable grid; event-refused vendor → notice + products visible HERE only with badges | `screens/store-*.png` + `rls-tests-raw.txt` (STORE PAGE DATA) | (SHA) |
| S-07 | Vendors: featured section + full list with category + level filters; suspended/hidden vendors excluded (view flag `is_listable`) | `screens/vendors-*.png` | (SHA) |
| S-08 | Brands list + `/brand/:slug` page (reuses listing engine); empty brands → friendly empty state; empty brand (0 products) renders its page with the empty state | `screens/brands-*.png` | (SHA) |
| S-09 | Cart: page + drawer, guest localStorage / user DB (RPC-only writes), merge on sign-in (`fn_cart_merge`: combines identical lines, conflicts → higher qty, caps at stock with per-line notices), coupon baseline (`fn_apply_coupon` percent/fixed/min-subtotal/scopes/exclude-sale/limits — full validation matrix in `rls-tests-raw.txt`), qty > stock auto-corrected with notice, checkout gate (account creation forced, phase-05 payment honestly disabled with reason) | `screens/cart-*.png`, `cart-drawer-{1280,390}.png` + `rls-tests-raw.txt` (CART + COUPON sections) | (SHA) |
| S-10 | Header/footer bilingual: working search with suggestions, categories menu (level-1 + children), wishlist link, cart count badge + drawer, language switch preserving path/filters, DB-driven static-page links, seller link; mobile menu keyboard-accessible (focus-trapped drawer, Escape) | visible in every screen; `home-en-*.png` for LTR flip | (SHA) |
| S-11 | Seller Center `/sell`: expandable 3-level site map (every node links to its live `/category/:slug`), vendor terms card (DB text), start-selling article + CTA honoring `vendor_registration_enabled`, vendor sign-in | `screens/sell-*.png` | (SHA) |
| S-12 | Static pages from DB (`/p/:slug`, bilingual content, `show_in_header` respected — 4 seeded pages with real baseline content) + contact page with validated form (success state; errors keep the message; anon insert via RLS, anon read denied — asserted) | `screens/static-page-*.png` + `rls-tests-raw.txt` (STATIC PAGES + CONTACT) | (SHA) |
| S-13 | Wishlist: heart on cards/product; guests prompted to sign-in with the item stashed and saved automatically after sign-in; persisted per user; dedupe proven by the composite PK. **Account wishlist tab ships in Phase 05 (O-21).** | `rls-tests-raw.txt` (WISHLIST) + heart visible in `screens/` | (SHA) |
| S-14 | SEO: meta per page (title/description/canonical/hreflang ar+en+x-default/OG/Twitter/robots), JSON-LD (Organization, WebSite+SearchAction, Product+Offer+AggregateRating, BreadcrumbList, ItemList) — parse-validated; dynamic `/sitemap.xml` with hreflang alternates; panel/auth noindex | `seo-perf.json` (meta 14/14 pages, json-ld 3/3, sitemap) | (SHA) |
| S-15 | Images: public-bucket `MediaImg` with explicit dimensions (CLS 0.00 in Lighthouse — `seo-perf.json`), lazy loading, eager+preload for LCP hero, alt from product name. **Deviation:** CDN render-transform srcset omitted — the render endpoint 403s on this project (transforms not enabled; phase-03 finding), so plain public URLs are shipped | `seo-perf.json` (cls: 0) | (SHA) |
| S-16 | Error pages: 404 with product-search form, 500 with retry, error states without stack traces. **Offline banner omitted:** connection-status banners are banned forever (standing owner rule) — failed actions show "Connection failed / retry" per JOURNEYS §0 instead | root.tsx (standalone 404/500) | (SHA) |
| S-17 | Skeletons: product grid skeleton (same cell shape → no layout jump), cart skeleton, facet skeleton; client navigations show skeletons while pending | `screens/listing-filters-*.png`, `cart-*.png` | (SHA) |
| S-18 | Accessibility pass: focus rings (focus-within/focus: tokens), labels on all inputs, keyboard nav (drawer/menu/tabs focus traps + arrow keys), disabled states announced, contrast AA (tokens), Lighthouse accessibility 91 (home) / 94 (product) | `seo-perf.json` | (SHA) |
| S-19 | Performance (after the correction-round sprint; 3-run medians in `perf-3x.json`): Lighthouse mobile performance **93 (home) / 98 (product)**, TBT 70/58ms, CLS 0.00. Lighthouse LCP: home **2945ms** (waiver band — conditions met, waiver requested above) / product **2318ms (<2.5s — pass)**. Throttled SSR LCP (4x CPU + slow-4G, observed): home 796ms, product 836ms, listing 556ms, category 780ms — all < 1.2s. Fonts: single variable Cairo file. LCP image: same-origin proxy, immutable cache, SSR-warmed | `perf-3x.json`, `bundle-diff.json`, `seo-perf.json` (before-state) | (SHA) |
| S-20 | Evidence pack at four breakpoints under `evidence/phase-04/` (this report + raw test output + screenshots via the Playwright harness + `perf-3x.json` + `p40-assertions.json` + `bundle-diff.json` + seo-perf + test-results) | this file | (SHA) |
| S-21 | Compare: action on cards/product → staging bar (max 2, dedupe) → `/compare?ids=p1,p2`; shared attributes (same attribute_id valued on both sides) + price/rating/vendor rows; different-category notice; mobile stacked layout; invalid/missing ids → friendly state; same product twice blocked; pure logic unit-tested | `screens/compare-*.png` + `tests/compare.test.ts` (unit 6/6) | (SHA) |
| S-22 | Recently viewed: guest localStorage (dedupe, newest first), signed-in DB (`fn_record_view`), merge on sign-in (`fn_recently_viewed_merge`), hard cap 20 (asserted with 23 products), clear history, strips on home + product page (hidden when empty — proven by the populated/absent capture pair). **Account recently-viewed tab ships in Phase 05 (O-29).** | `rls-tests-raw.txt` (RECENTLY VIEWED) + `home-ar-*.png` vs `home-ar-empty-recent-*.png` strip pair | (SHA) |

## Gates G1–G6

| Gate | Result | Evidence |
|------|--------|----------|
| G1 functional (guest reaches product, adds to cart ≤3 clicks — asserted live; browse/filter/search/compare flows) | PASS | `screens-log.txt` (G1 section), full flows across `screens/` |
| G2 no leakage: draft/pending/suspended/refused/hidden products and vendor data never reach anon (views hard-code visibility; vendors table has NO anon grant — store names via `v_storefront_stores` only) | PASS | `rls-tests-raw.txt` (NO LEAKAGE + STORE PAGE DATA + contact/wishlist/cart RLS asserts) |
| G3 design: tokens only, zero gradients, zero emojis (scan), RTL-first logical layout | PASS | `scan-design.mjs` output (PASS) + screenshots |
| G4 UX: loading/empty/error on every list; zero-result filter → "remove all filters" shortcut; confirms before destructive actions; cart survives navigation; disabled CTAs carry reasons | PASS | screenshots + flows |
| G5 responsive 390/768/1280/1440 | PASS | Playwright-protocol captures (P4-0): per-shot `clientWidth`/`scrollWidth` assertions + container ≥1100px at 1440; corrected home set (AR+EN+strip states) + full pages/screens at the 4 widths |
| G6 SEO/perf: meta 14/14, JSON-LD valid, hreflang, sitemap, Lighthouse mobile ≥90 | PASS | `seo-perf.json` (25/25) |

## Defect log (all fixed + covered by regression)

| # | Defect | Fix | Regression |
|---|--------|-----|------------|
| D-01 | `fn_search_products` facet SQL corrupted by global `replace()` on empty brand condition | facet WHERE composed from parts (no replace) | API suite FILTER COUNTS 67/67 |
| D-02 | **RLS never enabled** on the 13 new tables (policies existed but inert) — caught by the inactive-banner test | `ENABLE ROW LEVEL SECURITY` on all 13 (folded PATCH 4f) | suite BANNERS/CONTACT/WISHLIST asserts |
| D-03 | `did-you-mean` compared un-normalized words (hamza variants missed) | compare `ar_norm(word)` vs `ar_norm(q)` | suite SEARCH NORMALIZATION |
| D-04 | attribute dictionary had no **anon** policies (product-page variant selector empty for guests) | `attribute_defs_read_anon` / `attribute_options_read_anon` (PATCH 4g) | screens product page shows selector |
| D-05 | API resource routes registered under `:lang` while clients called `/api/...` → 405 | moved to root level (locale-agnostic) | screens cart/drawer checks |
| D-06 | peek endpoint embedded `vendors(...)` → 500 for guests (vendors has no anon grant) | store names via `v_storefront_stores` | probe: peek 200 hydrated |
| D-07 | `<li>` inside `<li>` (categories menu) → React #418 hydration failure on every page with categories | plain `<div>` wrapper | screens + SPA-nav probe clean |
| D-08 | meta `link:` descriptors wrong shape → canonical/hreflang never rendered | `tagName: "link"` descriptors | G6 meta 14/14 |
| D-09 | `siteUrl()` read `process.env` in client meta → crash during SPA navigation | vite `define` + `import.meta.env.SITE_URL` | SPA-nav probe clean |
| D-10 | 188 new i18n keys used single-brace placeholders (i18next needs `{{}}`) | converted both dictionaries | G6 + screens text |
| D-11 | product-page axes derived from `product_attribute_values` (axis options live in variants) | axes derived from `variants.option_ids` | screens product selector |
| D-12 | facet upsert hit rows twice (options repeated across variants) | dedupe by option before upsert | suite fixtures |
| D-13 | category cleanup hit FK RESTRICT (parents deleted before children/users) | users-first cleanup order (all scripts) | pristine checks |
| D-14 | attribute options with 1-char codes (`s/m/l`) rejected by the phase-02 check — repeated phase-03 mistake | `sm/md/lg/xl` codes | suite fixtures |
| D-15 | Mobile (owner report): header wrapped to two lines at 390px (logo + language switch + icons exceeded the viewport) | compact logo `h-9` (<420px), tighter gaps/padding, compact language switch — one line at 390px, verified | `screens/mobile-header-footer-390.png` + regenerated 390-wide set |
| D-16 | Mobile (owner report): dead white space under the footer (static `pb-16` reserving compare-bar space even when hidden) | in-flow spacer rendered only while the compare bar is visible; footer touches the document bottom (gap 0) | same probe: `gapBelow: 0` |

## Notes / honest scope statements

- **Events** tables + visibility flags are read-side only (`active`, `refused`); admin event management ships with the admin suite (07). `event_hidden` honors the ARCHITECTURE §5d column.
- **Coupons**: validation + cart display shipped (JOURNEYS §5); redemption rows are written at order time (phase 05 `fn_create_order`).
- **Checkout CTA** on the cart page is disabled with an explicit reason for signed-in users; guests see the real forced-account gate (JOURNEYS §1.6).
- **Lighthouse simulated LCP** (3.1–3.4s at 150ms RTT + 4x CPU) vs direct slow-4G SSR LCP (0.5–0.8s): LH's emulation includes image transfer in its lab conditions; the plan gate ("LCP<2.5s on average 4G") is measured by the throttled-SSR numbers in `seo-perf.json`.
- Reviews submission ships with orders (phase 05); the product page reads published reviews (empty state until then).
- "Offline banner" from S-16 intentionally omitted: connection-status banners are banned forever (standing owner rule).

## Do not start Phase 05

Per the standing instruction — awaiting the owner's Phase 04 verdict first.
