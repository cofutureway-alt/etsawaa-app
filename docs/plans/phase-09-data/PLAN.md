# Phase 09 — Data Import · PLAN

## 1) Goal
Import the owner's real catalog and geography data into the platform with maximum accuracy, staging-first, fully auditable, idempotent, and reversible.

## 2) Data inventory (from the source files)
| Dataset | Count |
|---|---|
| Categories L1 → L2 → L3 | 10 → 38 → 170 |
| Product types (L4) | 1,354 unique (1,391 rows) |
| Specification dictionary | 1,270 (963 text / 307 number + units) |
| Specification groups | 1,000 (10,409 group↔spec links, 8–19 each) |
| Types with an exact group | 955 |
| Types without any group (new templates) | 399 (family-based, Brand excluded) |
| Shared products across categories | 32 |
| Governorates | 27 (shipping 100 EGP each) |
| Areas | 572 (pickup 20 EGP each) |

## 3) Model decisions
- **3-level categories** for browsing; **Product Type** is a separate dimension (1,354) attached to the L3 leaf.
- Attributes are grouped (`attribute_groups`) and attached to product types; enum/color/axis values come from admin dictionaries only.
- **Brand is a product field** (`brand_id`) and is removed from every spec/group.
- Variant axes: Color / Size / Storage / RAM / Capacity — option dictionaries are seeded by us and replaceable later.
- Shared products use `product_categories` (primary + secondary); no duplicated products.
- Duplicate area names are allowed across governorates; uniqueness is per governorate.

## 4) Import order
1. Governorates + areas (with fees).
2. Categories L1→L3.
3. Specification dictionary.
4. Specification groups + links.
5. Product types (955 exact + 399 new templates) + category paths.
6. Shared-product category links.
7. Variant dictionaries (colors with hex, sizes, storage, RAM).
8. Validation report + counts reconciliation.
9. Publish (only after owner approval of the 399 templates).

## 5) Staging & safety
- All imports into `staging_*` tables first; production publish is a separate reviewed step.
- Every run gets a `batch_id`; rollback deletes by batch.
- Idempotent: natural keys (`slug`/`code`/normalized name) upsert; re-run creates no duplicates.
- Rejected rows go to `data/rejected/` with a reason.

## 6) Acceptance
- Counts match the source exactly (10/38/170/1354/1270/1000/10409/27/572).
- 0 rows with missing EN name; AR fallback flagged (never silently blank).
- 0 types without a template; 0 specs named "Brand".
- Re-import is a no-op; rollback restores the previous state.
- Every product type renders the correct form and the product page shows grouped specs.

## 7) Gates
G1 counts/rows · G2 RLS + staging isolation · G3 no template leaks · G4 review queue for 399 · G5 previews at vendor form · G6 bilingual completeness report.

## 8) Risks
Category drift after import → templates versioned; duplicate areas → per-governorate uniqueness; template errors → publish gate + owner review; huge imports → batched transactions.
