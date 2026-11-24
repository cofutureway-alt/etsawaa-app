# Dimension 5 — Performance

**Score: 7.5 / 10**

## Strengths

- **Loader parallelism is excellent:** 47 `Promise.all` sites; `app/routes/home.tsx:41` fires 6 queries in one batch; `app/routes/product.tsx:47` same.
- **Caching is deliberate:** same-origin image proxy (`app/routes/api/media.ts`) with `Cache-Control: immutable, max-age=31536000` backed by a hand-rolled LRU (`app/lib/media-cache.server.ts`, 120 items); `Cache-Control` also on sitemap/rss/areas.
- **Front-end care is visible:** preconnect to storage origin (`app/root.tsx:63-66`), self-hosted preloaded Cairo fonts (`:74-75`), fire-and-forget LCP media warming (`app/routes/home.tsx:55`, `product.tsx:59`), lazy-loaded CartDrawer/CompareBar/ProductCard, no client loaders (server HTML first byte).
- **DB client is lean:** request-scoped `createServerClient` per request with boot-time TLS warm-up (`app/lib/supabase/server.ts:22-32`); module-singleton service client; no per-request pool churn.
- **Money math is integer piastres** throughout — no float drift.

## Findings (ranked)

| # | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| P1 | **High** | **N+1 in compare loader**: one `v_storefront_facet_options` round trip per attribute option inside a for-loop (×2 products → dozens of sequential round trips) | `app/routes/compare.tsx:51-68` | Compare page latency grows linearly with option count |
| P2 | **High** | **In-process media LRU caches raw bytes including `video/*`**, unbounded per-item size, O(n) `shift()` eviction — memory-pressure candidate under video traffic | `app/lib/media-cache.server.ts:12-33` | Per-instance heap blowup; O(n) eviction under load |
| P3 | **Medium** | **Root loader hits PostgREST on every request** for settings + design tokens (`loadPublicSettings`) with no caching | `app/root.tsx:35` → `app/features/settings/api.ts` | Adds TTFB site-wide on every navigation |
| P4 | **Medium** | **Sequential client awaits**: `ReorderButton.tsx:29-34` serial `cart.add` per line; `EvidenceUploader.tsx:24-30` re-awaits `auth.getUser()` per file (up to 5×) | both files | Slower UX; trivially batchable |
| P5 | **Low** | **Admin list views over-fetch** `select("*")` then reshape in JS; plus a `JSON.parse(JSON.stringify())` deep clone | `admin/coupons.tsx:51`, `admin/customers.tsx:67`, `admin/levels.tsx:57` | Admin-only; bandwidth + GC noise |
| P6 | **Low** | Server bundle is **2,026 kB** (`build/server/index.js` chain) — acceptable for SSR but worth watching | build output | Memory per instance |

## Verdict

Above average with real optimization work already done (parallel loaders, immutable image caching, fonts/preconnect). The two significant deductions — the compare N+1 and the video-caching LRU — are both single-file fixes.
