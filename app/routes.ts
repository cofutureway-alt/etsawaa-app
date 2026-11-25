import {
  type RouteConfig,
  index,
  prefix,
  route,
} from "@react-router/dev/routes";

/**
 * Route map. Every user-facing route is language-prefixed (/ar, /en —
 * F-03). The bare root redirects to the default locale (/ar).
 */
export default [
  index("routes/root-redirect.ts"),

  ...prefix(":lang", [
    // Public storefront shell — auth + Seller Center render under the SAME
    // header/footer as the storefront (owner request: natural layout)
    route("", "layouts/public.tsx", [
      index("routes/home.tsx"),
      route("sell", "routes/sell.tsx"),

      // Auth (own centered card shell INSIDE the public frame; noindex kept)
      route("auth", "layouts/auth.tsx", [
        route("login", "routes/auth/login.tsx"),
        route("register", "routes/auth/register.tsx"),
        route("forgot", "routes/auth/forgot.tsx"),
        route("verify", "routes/auth/verify.tsx"),
        route("complete", "routes/auth/complete.tsx"),
        route("phone", "routes/auth/phone.tsx"),
      ]),
      // Logout is a POST-only resource route (CSRF-safe), outside the auth shell
      route("auth/logout", "routes/auth/logout.ts"),
      // Google OAuth starter (POST) — real Supabase signInWithOAuth
      route("auth/google", "routes/auth/google.ts"),
      // Link a Google identity to the signed-in account (POST, same email only)
      route("auth/google/link", "routes/auth/google-link.ts"),
      // OAuth callback (GET) — server-side code exchange
      route("auth/callback/google", "routes/auth/google-callback.tsx"),
      route("category/:slug", "routes/category.tsx"),
      route("products", "routes/products.tsx"),
      route("search", "routes/search.tsx"),
      route("product/:slug", "routes/product.tsx"),
      route("store/:slug", "routes/store.tsx"),
      route("vendors", "routes/vendors.tsx"),
      route("brands", "routes/brands.tsx"),
      route("brand/:slug", "routes/brand.tsx"),
      route("site-map", "routes/site-map.tsx"),
      route("cart", "routes/cart.tsx"),
      route("compare", "routes/compare.tsx"),
      route("contact", "routes/contact.tsx"),
      route("p/:slug", "routes/static-page.tsx"),
      // Terms & seller agreement (versioned) + the mandatory acceptance step
      route("legal/accept", "routes/legal-accept.tsx"),
      route("legal/:kind", "routes/legal.tsx"),
      // Phase 08 — public content (L-01/L-02): blogs outside the panel shell
      route("blog", "routes/blog.tsx"),
      route("blog/:slug", "routes/blog.$slug.tsx"),

      // Phase 05 — checkout + order pages (noindex; order pages are private)
      route("checkout", "routes/checkout.tsx"),
      route("order/:number", "routes/order.tsx"),
      route("order/:number/track", "routes/order-track.tsx"),
    ]),


    // H-01 — Buyer account INSIDE the storefront shell: the account tree
    // mounts under the public layout (header/footer/breadcrumbs/user menu
    // remain), with the existing account layout providing its tabs as a
    // nested panel between the public frame and the tab pages.
    route("account", "layouts/public.tsx", { id: "account-public-frameshell" }, [
      // pathless nested layout: the URL comes entirely from the parent
      // "account" segment (a second "account" child would double the path)
      route("", "layouts/account.tsx", { id: "account-shell" }, [
        index("routes/account/overview.tsx"),
        route("notifications", "routes/account/notifications.tsx"),
        // phase 05 — orders + returns + addresses + reviews + wishlist + recent + profile
        route("orders", "routes/account/orders.tsx"),
        route("orders/:number", "routes/account/order-detail.tsx"),
        route("orders/:number/return", "routes/account/return-new.tsx"),
        route("returns", "routes/account/returns.tsx"),
        // phase A — customer wallet (refund + gift balance)
        route("wallet", "routes/account/wallet.tsx"),
        route("addresses", "routes/account/addresses.tsx"),
        route("reviews", "routes/account/reviews.tsx"),
        route("wishlist", "routes/account/wishlist.tsx"),
        route("recent", "routes/account/recent.tsx"),
        route("profile", "routes/account/profile.tsx"),
      ]),
    ]),

    // Vendor onboarding wizard — OUTSIDE the vendor panel layout on purpose:
    // a focused full-screen flow with no panel navigation (US-01: no other
    // page reachable). Any authenticated user may enter (customer = upgrade).
    route("vendor/onboarding", "routes/vendor/onboarding.tsx"),

    // Vendor panel — /vendor/media is the vendor media library (owner rule)
    route("vendor", "layouts/vendor.tsx", [
      index("routes/vendor/dashboard.tsx"),
      route("media", "routes/vendor/media.tsx"),
      route("products", "routes/vendor/products.tsx"),
      route("products/new", "routes/vendor/product-wizard.tsx", { id: "vendor-product-new" }),
      route("products/:id/edit", "routes/vendor/product-wizard.tsx", { id: "vendor-product-edit" }),
      route("store", "routes/vendor/store.tsx"),
      // phase 05 — vendor's own order groups + their documents
      route("orders", "routes/vendor/orders.tsx"),
      // phase 06 — wallet/withdrawals + penalties + report + profile (VO)
      route("wallet", "routes/vendor/wallet.tsx"),
      // ARCHITECTURE §7 lists these; they were missing from the panel
      route("ads", "routes/vendor/ads.tsx"),
      route("services", "routes/vendor/services.tsx", { id: "vendor-services" }),
      route("events", "routes/vendor/events.tsx"),
      route("reviews", "routes/vendor/reviews.tsx"),
      route("print-history", "routes/vendor/print-history.tsx"),
      route("penalties", "routes/vendor/penalties.tsx"),
      route("reports", "routes/vendor/reports.tsx"),
      route("profile", "routes/vendor/profile.tsx"),
      route("verification", "routes/vendor/verification.tsx"),
      // packaging store (buy from the platform) + orders; the signed agreement
      route("packaging", "routes/vendor/packaging.tsx", { id: "vendor-packaging" }),
      route("packaging/orders", "routes/vendor/packaging-orders.tsx", { id: "vendor-packaging-orders" }),
      route("packaging/orders/:number", "routes/vendor/packaging-order.tsx", { id: "vendor-packaging-order" }),
      route("agreement", "routes/vendor/agreement.tsx"),
      route("categories", "routes/vendor/categories.tsx"),
      route("levels", "routes/vendor/levels.tsx"),
    ]),

    // Admin panel (role-gated; minimal phase-01 pages)
    route("admin", "layouts/admin.tsx", [
      index("routes/admin/dashboard.tsx"),
      route("users", "routes/admin/users.tsx"),
      route("users/:id", "routes/admin/user-profile.tsx", { id: "admin-user-profile" }),
      route("settings", "routes/admin/settings.tsx"),
      route("logs", "routes/admin/logs.tsx"),
      // Phase 02 — media library + limits + catalog setup
      route("media", "routes/admin/media.tsx"),
      route("media-settings", "routes/admin/media-settings.tsx"),
      route("catalog/categories", "routes/admin/catalog/categories.tsx"),
      route("catalog/brands", "routes/admin/catalog/brands.tsx"),
      route("catalog/brands/:id", "routes/admin/catalog/brand-edit.tsx"),
      route("catalog/tags", "routes/admin/catalog/tags.tsx"),
      route("catalog/attributes", "routes/admin/catalog/attributes.tsx"),
      route("catalog/size-types", "routes/admin/catalog/size-types.tsx"),
      // Phase 03 — approvals (products with mandatory reason; vendor stores)
      route("products", "routes/admin/products.tsx"),
      route("products/:id", "routes/admin/product-review.tsx", { id: "admin-product-review" }),
      route("products/:id/edit", "routes/admin/product-edit.tsx", { id: "admin-product-edit" }),
      route("vendors", "routes/admin/vendors.tsx"),
      route("store-changes", "routes/admin/store-changes.tsx"),
      // H-25 — vendor detail page (read-first full profile) BEFORE the edit route
      route("vendors/:id", "routes/admin/vendors_.$id.tsx", { id: "admin-vendor-detail" }),
      route("vendors/:id/edit", "routes/admin/vendors_.$id.edit.tsx", { id: "admin-vendor-edit" }),
      // Phase 05 — orders: list, detail (COD reconcile + group statuses + print center)
      route("orders", "routes/admin/orders.tsx"),
      route("orders/:number", "routes/admin/order-detail.tsx"),
      // Phase 06 — vendor shipping decisions + withdrawal review (VO-05/14)
      route("shipping", "routes/admin/shipping.tsx"),
      // Phase 07 — admin suite
      route("withdrawals", "routes/admin/withdrawals.tsx"),
      route("reports", "routes/admin/reports.tsx"),
      route("refunds", "routes/admin/refunds.tsx"),
      // phase A — customer wallets (balances, gifts, ledger)
      route("customer-wallets", "routes/admin/customer-wallets.tsx"),
      route("customer-wallets/:id", "routes/admin/customer-wallets_.$id.tsx", { id: "admin-customer-wallet" }),
      route("coupons", "routes/admin/coupons.tsx"),
      route("reviews", "routes/admin/reviews.tsx"),
      route("penalties", "routes/admin/penalties.tsx"),
      route("levels", "routes/admin/levels.tsx"),
      route("badges", "routes/admin/badges.tsx"),
      route("ads", "routes/admin/ads.tsx"),
      route("services", "routes/admin/services.tsx", { id: "admin-services" }),
      route("events", "routes/admin/events.tsx"),
      route("email-templates", "routes/admin/email-templates.tsx"),
      route("messages", "routes/admin/messages.tsx"),
      route("settings/sections", "routes/admin/sections.tsx", { id: "admin-settings-sections" }),
      route("zones", "routes/admin/zones.tsx"),
      route("document-settings", "routes/admin/document-settings.tsx"),
      route("blog", "routes/admin/blog.tsx"),
      route("banners", "routes/admin/banners.tsx"),
      route("mega-menu", "routes/admin/mega-menu.tsx"),
      route("pages", "routes/admin/pages.tsx"),
      route("roles", "routes/admin/roles.tsx"),
      // contact inbox (admin + staff with contact.manage)
      route("contact", "routes/admin/contact.tsx"),
      route("contact/:id", "routes/admin/contact-thread.tsx", { id: "admin-contact-thread" }),
      route("profile", "routes/admin/profile.tsx"),
      // packaging catalog + operations; legal documents + acceptance register
      route("packaging", "routes/admin/packaging.tsx", { id: "admin-packaging" }),
      route("packaging/orders", "routes/admin/packaging-orders.tsx", { id: "admin-packaging-orders" }),
      route("packaging/orders/:number", "routes/admin/packaging-order.tsx", { id: "admin-packaging-order" }),
      route("legal", "routes/admin/legal.tsx", { id: "admin-legal" }),
    ]),

    // Design-system preview page (F-04)
    route("ui", "routes/ui-preview.tsx"),

    // Notifications API (F-17): list + mark-as-read for the signed-in user
    route("api/notifications", "routes/api/notifications.ts"),
    // H-22 — areas of one governorate, fetched on demand (abortable + session-cached)
    route("api/areas", "routes/api/areas.ts"),
  ]),

  // Locale-agnostic resource routes (phase 04/05) — the client calls them
  // without a lang segment, so they live OUTSIDE the :lang prefix
  route("api/cart", "routes/api/cart.ts"),
  route("api/preferences/locale", "routes/api/preferences-locale.ts"),
  route("api/webhooks/auth-email", "routes/api/webhooks/auth-email.ts"),
  route("api/webhooks/rasvio", "routes/api/webhooks/rasvio.ts"),
  route("api/compare-items", "routes/api/compare-items.ts"),
  route("api/media", "routes/api/media.ts"),
  route("api/media-library", "routes/api/media-library.ts"),
  // avatar / refund evidence / vendor KYC uploads under the session cookie
  route("api/upload", "routes/api/upload.ts"),
  // writes the cropped avatar/cover path — the account LAYOUT owns those
  // buttons, so the action cannot live on the profile page alone
  route("api/profile-media", "routes/api/profile-media.ts"),
  // contact-form attachments: signed upload slots into the private contact bucket
  route("api/contact-upload", "routes/api/contact-upload.ts"),
  // admin attribute archive pre-check (fn_attribute_usage under the cookie)
  route("api/attribute-usage", "routes/api/attribute-usage.ts"),
  // platform commission for a store + category (product wizard, admin/staff only)
  route("api/admin-commission", "routes/api/admin-commission.ts"),
  route("api/phone-code", "routes/api/phone-code.ts"),
  // private `documents` bucket (refund evidence, KYC) via signed URL
  route("api/document", "routes/api/document.ts"),
  route("api/wishlist", "routes/api/wishlist.ts"),
  route("api/recent", "routes/api/recent.ts"),
  route("api/coupon", "routes/api/coupon.ts"),
  route("api/search-suggest", "routes/api/search-suggest.ts"),
  // admin / vendor product search dropdown (image + title)
  route("api/panel-product-suggest", "routes/api/panel-product-suggest.ts"),
  // paid placement impressions / clicks
  route("api/ad-event", "routes/api/ad-event.ts"),
  // product-card "Choose options" popup payload
  route("api/product-quick", "routes/api/product-quick.ts"),
  // phase 05 — order status polling + reorder payload + Kashier webhook
  route("api/order-status", "routes/api/order-status.ts"),
  route("api/reorder", "routes/api/reorder.ts"),
  route("api/wishlist-default-variant", "routes/api/wishlist-default-variant.ts"),
  route("api/webhooks/kashier", "routes/api/webhooks/kashier.ts"),

  // Technical routes (AGENT.md §7)
  route("robots.txt", "routes/robots[.txt].ts"),
  route("sitemap.xml", "routes/sitemap[.xml].ts"),
  route("rss.xml", "routes/rss[.xml].ts"),

  // Print documents — ROOT-level leaf: the loader returns the raw document
  // Response (nested loaders only feed data to layouts). Language via ?lang=.
  route("order/:number/print/:doc", "routes/order-print.tsx"),
  route("packaging/:number/print/:doc", "routes/packaging-print.tsx"),
  // Sell page — category site map as a PDF download (ar | en)
  route(":lang/sell/sitemap.pdf", "routes/sell-sitemap-pdf.ts"),
  // the owner's site-map document in the page language (downloads bucket)
  route(":lang/sitemap-file", "routes/sitemap-file.ts"),

  // Unmatched URLs: lets the root loader redirect links missing /ar|/en, else 404
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
