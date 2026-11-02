# Phase 09 — Data Import · TASKS

- [ ] **D-01** Staging schema (`staging_categories`, `staging_types`, `staging_specs`, `staging_groups`, `staging_areas`, `import_batches`). DoD: rollback by batch id works.
- [ ] **D-02** Import categories L1→L3 (10/38/170) with AR/EN slugs and parent links. DoD: count match + no orphans.
- [ ] **D-03** Import 1,354 product types with category paths; 32 shared-product links into `product_categories`. DoD: unique type names; multi-category rows linked, no duplicates.
- [ ] **D-04** Import 1,270 specs (EN/AR, type, unit) — **Brand excluded**. DoD: 0 records named Brand; units mapped.
- [ ] **D-05** Import 1,000 groups + 10,409 links. DoD: every link points to an existing spec; no orphan groups.
- [ ] **D-06** Generate the 399 new templates from `all294_templates` (family fields + variants). DoD: 0 types without a template; 0 zero-field templates.
- [ ] **D-07** Seed variant dictionaries: colors (hex), apparel sizes, shoe sizes, storage/RAM/capacity. DoD: admin can edit; vendors cannot add values.
- [ ] **D-08** Import 27 governorates + 572 areas; shipping 100 EGP, pickup 20 EGP; uniqueness per governorate. DoD: duplicate names across governorates allowed, within blocked.
- [ ] **D-09** Validation suite: counts, missing AR, duplicate types, unknown refs, fee presence. DoD: report generated with 0 unexplained rows.
- [ ] **D-10** Idempotency test: run import twice; second run inserts 0 rows. DoD: diff = 0.
- [ ] **D-11** Rollback test: delete by batch; counts return to the previous snapshot. DoD: documented.
- [ ] **D-12** Owner review flow for the 399 templates: approve / adjust / new group. DoD: only approved templates are publishable.
- [ ] **D-13** Preview: vendor form renders exactly the type's groups; product page shows grouped specs. DoD: t-shirt vs TV vs washing machine screenshots.
- [ ] **D-14** Publish gate: no product type without an approved template. DoD: publish attempt blocked with reason.
- [ ] **D-15** Final report: counts, rejects, template approvals, batch id, commit/tag. DoD: evidence pack under `phase-09-data/evidence/`.
- [ ] **D-16** Production import + post-import counts reconciliation. DoD: live DB equals staging counts.
