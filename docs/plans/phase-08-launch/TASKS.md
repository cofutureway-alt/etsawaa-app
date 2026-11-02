# Phase 08 — Content & Launch · TASKS

## Content
- [ ] **L-01** Blog listing + article page (TOC, reading progress, related, share). DoD: drafts invisible publicly.
- [ ] **L-02** Blog categories + archive + RSS. DoD: valid XML.
- [ ] **L-03** Static pages finalization (about/terms/privacy/returns/contact) + header/footer placement. DoD: every page has meta + canonical.
- [ ] **L-04** Banners cleanup: only approved art, correct links, expiring dates. DoD: expired banners auto-hide; broken links detected before publish.

## SEO
- [ ] **L-05** Meta coverage audit for every route (title/description/OG/Twitter). DoD: automated test fails on missing meta.
- [ ] **L-06** JSON-LD: Product, Breadcrumb, Organization, WebSite, BlogPosting, ItemList. DoD: Rich Results passes.
- [ ] **L-07** sitemap.xml + robots + hreflang + canonical. DoD: sitemap includes all published entities, no drafts.
- [ ] **L-08** 404/410 semantics + redirect map for moved slugs. DoD: old slug → new slug 301.

## Design & UX
- [ ] **L-09** Animation pass: page transitions, hover, skeletons; reduced-motion; no jank on low-end. DoD: recorded before/after.
- [ ] **L-10** Design consistency: tokens only, zero emoji/gradient scan, RTL audit on every screen. DoD: automated scan = 0.
- [ ] **L-11** Full responsive audit at 390/768/1280/1440 across all screens; fix all breakage. DoD: screenshots archived.

## Quality
- [ ] **L-12** Performance: image pipeline, JS trimming, code splitting, LCP<2.5s, CLS<0.1. DoD: Lighthouse mobile ≥90.
- [ ] **L-13** RLS audit script across all tables + cross-tenant tests. DoD: zero critical findings.
- [ ] **L-14** e2e suite: register→COD order→delivery→refund; Kashier sandbox; withdrawal; ad purchase; event opt-out. DoD: passes twice consecutively.
- [ ] **L-15** Production seeds: default settings + email templates + roles; demo data excluded. DoD: seed runs on an empty DB and produces a launch-ready baseline.
- [ ] **L-16** Monitoring: edge errors, webhook failures, cron failures → admin alerts. DoD: test alert received.
- [ ] **L-17** Backups + restore drill + rollback plan + ops runbook. DoD: documented RTO/RPO.
- [ ] **L-18** Launch checklist signed: legal pages, payment live keys, email domain verified, support inbox, owner sign-off. DoD: evidence pack complete.
- [ ] **L-19** Print QA: A4 invoice + A5 landscape labels on Chrome/Edge/Safari, Arabic wrapping, margins, Code128 scanned by a real scanner/phone, cancelled watermark, multi-vendor order (1 invoice + 1 carrier label + N vendor labels), vendor name-only rule. DoD: signed print checklist + photos of printed samples.
