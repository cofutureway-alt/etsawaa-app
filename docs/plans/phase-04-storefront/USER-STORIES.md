# Phase 04 — Storefront · USER STORIES

## US-01 · Visitor · home
As a visitor, I land on a home page that shows what the marketplace offers.
- AC: banners, category strip, featured vendors (border + mark), featured products, top-rated, event block when active; all clickable; SSR HTML contains product names.
- Edge: no featured items → section hidden, not an empty box.

## US-02 · Visitor · browse a category
As a visitor, I open a category and narrow down.
- AC: subcategory cards on top, products below, breadcrumbs; filters update results without full reload; count visible.
- Edge: empty category shows a friendly message + sibling suggestions.

## US-03 · Visitor · filter products
As a visitor, I filter by attributes relevant to the category.
- AC: only attributes of the current category appear; multi-select works; clear-all available; URL shareable and restored on back.
- Edge: filter combination with zero results → "remove last filter" shortcut.

## US-04 · Visitor · search
As a visitor, I search with a typo and still find the product.
- AC: suggestions before Enter; results include fuzzy matches; "Did you mean" when close.
- Edge: empty query → suggestions only; very long query trimmed; Arabic normalization matches alef/hamza variants and taa-marbuta/haa forms.

## US-05 · Visitor · product page
As a visitor, I inspect a product and choose a variant.
- AC: gallery swaps per color; unavailable sizes disabled with "Out of stock"; price/sale/schedule visible; specs table; vendor card with level badge.
- Edge: no image for a variant → falls back to product main image; sold-out product → "Notify me" instead of buy (if enabled) or disabled CTA with reason.

## US-06 · Visitor · add to cart
As a visitor, I add a product to the cart.
- AC: drawer opens with correct variant/image/price; quantity respects stock; toast confirms; cart count updates.
- Edge: item already in cart → quantity increments, not duplicate line; adding a different variant creates a separate line.

## US-07 · Visitor · language switch
As a visitor, I switch to English on a filtered listing.
- AC: same route, same filters, direction flips, numbers remain readable, images unchanged.
- Edge: missing English product name → falls back to Arabic with a neutral marker.

## US-08 · Visitor · store page
As a visitor, I open a vendor store and see their identity.
- AC: banner/logo, level badge (icon), rating, tabs for products/about/reviews/policies; only published products.
- Edge: vendor hidden by event → products show as unavailable with explanation; vendor suspended → store page shows a notice, products not purchasable.

## US-09 · Visitor · Seller Center
As a prospective seller, I visit `/sell` to understand how to start.
- AC: full 3-level category map (expandable) · vendor terms card · start-selling article + CTA · vendor articles.
- Edge: a category with no children shows as a leaf link only.

## US-10 · Visitor · static pages
As a visitor, I read policies and contact support.
- AC: pages from DB; header visibility respected; contact form validates and confirms sending; errors keep my message.
- Edge: page removed from header stays reachable by direct link unless unpublished.

## US-11 · Visitor · cart merge
As a guest who signs in, my cart survives.
- AC: localStorage cart merges with account cart; identical lines combine quantities; conflicts resolved to the higher quantity with a notice.
- Edge: merged quantity exceeds stock → capped with an explanation.

## US-12 · Visitor · wishlist
As a visitor, I save a product for later.
- AC: heart toggles; guest is prompted to sign in; after sign-in the item is saved.
- Edge: product becomes unavailable → wishlist shows it disabled with a reason.

## US-13 · Visitor · compare two products
As a visitor, I compare two products side by side before buying.
- AC: "Compare" on a card/product opens a picker for the second product; `/compare?ids=p1,p2` shows shared attributes + price/rating/vendor; URL is shareable; works on mobile with a stacked layout.
- Edge: same product twice → blocked; invalid/missing id → friendly state with "choose another product"; different categories → notice that only common fields are compared.

## US-14 · Visitor · recently viewed
As a visitor, I see the products I viewed before.
- AC: viewing a product records it; home and product pages show a "you viewed before" strip (newest first, deduped); signed-in users see the last 20 in their account; clear history works.
- Edge: guest history merges on login without duplicates; hidden/deleted products are skipped; the list never exceeds 20.
