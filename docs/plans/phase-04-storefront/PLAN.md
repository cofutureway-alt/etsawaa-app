# Phase 04 — Storefront · PLAN

## 1) Goal
A fast, bilingual, SEO-first storefront where browsing feels effortless and every screen works on a phone.

## 2) Scope
**In:** home · category page · product listing + filters + search · product page · store page · vendors · brands · cart (guest + account + merge) · Seller Center public page · static pages · header/footer · baseline SEO.
**Out:** checkout/payment (05) · blog (08).

## 3) Decisions
- SSR for every public page + meta + JSON-LD (Product/Breadcrumb/ItemList/Organization/WebSite).
- Filters via `product_facets` + AR/EN FTS (hamza/tashkeel normalization) + pg_trgm.
- Featured = `featured_until` / `featured_permanent` from campaigns or admin grants; unified border + mark.
- Product page: variant selection disables impossible combos; sticky buy bar on mobile.
- Cart: guest localStorage; merge on sign-in; account gate only at checkout.
- All images via Storage + srcset; skeletons everywhere.

## 4) Architecture
**Read tables:** products/variants/media/facets/brands/categories/vendors/reviews/banners.
**Views:** `v_product_card`, `v_product_page`, `v_facet_counts`.
**Routes:** `/` · `/category/:slug` · `/products` · `/product/:slug` · `/store/:slug` · `/vendors` · `/brands` · `/search` · `/cart` · `/sell` · `/p/:slug` · `/contact`.
**Components:** ProductCard · Gallery · VariantSelector · FacetPanel · PriceTag · RatingStars · VendorCard · CartDrawer · StickyBuyBar · Skeletons · SellerCenterCards.

## 5) Tasks
See `TASKS.md` (S-01 … S-20).

## 6) Acceptance
Guest reaches a product and adds to cart in ≤3 clicks · filters correct and URL-shareable · search tolerance for minor typos · language switch preserves page/filters · LCP<2.5s on average 4G · every image has alt · Seller Center shows full 3-level map · static pages render from DB.

## 7) Verification gate
G1 full guest scenario twice · G2 no leakage of draft/pending products or hidden vendors; no prices for unpublished · G3 tokens only · G4 loading/empty/error on every list + back works · G5 four breakpoints · G6 schema valid + sitemap baseline + hreflang.

## 8) Risks
Slow facet queries → indexes + pagination · bilingual slugs → canonical + prefix · huge galleries → lazy + responsive sizes.
