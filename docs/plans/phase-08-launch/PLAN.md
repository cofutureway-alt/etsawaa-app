# Phase 08 — Content & Launch · PLAN

## 1) Goal
The site is genuinely ready for people: published content, complete SEO, fast pages, polished UX, automated safety checks, and a signed launch.

## 2) Scope
**In:** public blog + static pages · full SEO (meta/schema/sitemap/hreflang) · animation review · full responsive audit · performance · RLS audit · e2e · production seeds · monitoring · backups/runbook · launch checklist.
**Out:** mobile app · carrier APIs · SMS.

## 3) Decisions
- Every public page SSR + meta + JSON-LD (Product/Breadcrumb/Organization/WebSite/BlogPosting).
- sitemap.xml generated dynamically; robots; hreflang ar/en; canonical.
- Motion 150–300ms, reduced-motion respected, never blocks reading or buying.
- No launch before all phases pass G1–G6 and the automated RLS scan is clean.
- Content: blog posts are authored by the owner; the system ships with drafts and a publishing flow, not placeholder articles.

## 4) Architecture
**Tables:** blog_posts · blog_categories · static_pages · banners.
**Routes:** `/blog` · `/blog/:slug` · `/p/:slug` · `/sitemap.xml` · `/robots.txt` · `/rss.xml`.
**Components:** ArticleCard · TOC · ShareRow · RelatedPosts · ReadingProgress.
**Jobs:** rebuild sitemap on publish · revalidate caches.

## 5) Tasks
See `TASKS.md` (L-01 … L-18).

## 6) Acceptance
Rich Results passes for a product and an article · no public page without meta · no horizontal scroll at 390 · silver/gold render correctly · RLS audit = 0 critical · every e2e scenario passes twice in a row · Lighthouse mobile ≥90 on home/product/article.

## 7) Verification gate
Full G1–G6 + a single final report bundling screenshots, Lighthouse, RLS results, e2e output under `plans/evidence/phase-08/`.

## 8) Risks
Prerender leaking panel data → route separation + noindex + build check · content not ready → drafts and progressive publishing · cache staleness → targeted revalidation on writes.
