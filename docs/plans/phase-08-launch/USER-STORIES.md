# Phase 08 — Content & Launch · USER STORIES

## US-01 · Visitor · read the blog
As a visitor, I read an article and discover products.
- AC: article with cover, TOC, reading progress; related products linked; share buttons; meta + BlogPosting schema.
- Edge: draft/unpublished → 404; moved article → 301 to new slug.

## US-02 · Google · crawl the site
As a search engine, I find every public page and none of the panels.
- AC: sitemap lists products/categories/stores/articles; robots blocks `/admin`, `/vendor`, `/account`, `/checkout`; hreflang pairs ar/en; canonical correct.
- Edge: unpublished/hidden entities excluded immediately after change.

## US-03 · Visitor · product rich result
As a visitor searching Google, I see price/availability/rating.
- AC: Product schema with price currency EGP, availability, rating only when real reviews exist.
- Edge: out-of-stock shows proper availability, not stale price.

## US-04 · Customer · mobile experience
As a customer on a small phone, I can complete any journey.
- AC: no horizontal scroll at 390; sticky buy bar; checkout usable one-handed; dialogs are sheets.
- Edge: landscape orientation keeps controls reachable.

## US-05 · Customer · reduced motion
As a customer who prefers reduced motion, animations are minimal.
- AC: page transitions instant, no parallax, no auto-playing motion.
- Edge: skeleton shimmer disabled too.

## US-06 · Admin · pre-launch verification
As an admin, I see a launch checklist with evidence links.
- AC: every item shows owner, date, proof (screenshot/report); failures highlighted.
- Edge: no item can be marked done without an attached artifact.

## US-07 · Security · tenant isolation proof
As the platform owner, I get a report proving no cross-tenant leakage.
- AC: automated script enumerates tables/policies; results listed; zero critical findings.
- Edge: new tables added later are auto-detected and flagged until covered.

## US-08 · Operations · failure recovery
As an operator, I can restore from backup and roll back a deploy.
- AC: runbook steps; restore drill completed; RTO/RPO documented.
- Edge: partial failure (email only) documented with a degraded-mode note.

## US-09 · Customer · support
As a customer, I contact support from the footer and get a confirmation.
- AC: form validates; success state; message delivered to support inbox/email log.
- Edge: attachment optional; spam protection silent (no captcha friction for humans).

## US-10 · Owner · go/no-go
As the owner, I sign the launch only when everything passes.
- AC: final evidence pack: G1–G6 for all phases, Lighthouse, RLS audit, e2e logs, content inventory, keys verified.
- Edge: any blocker → launch date moves, nothing is waived verbally.
