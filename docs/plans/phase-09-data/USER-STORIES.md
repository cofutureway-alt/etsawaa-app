# Phase 09 — Data Import · USER STORIES

## US-01 · Admin · import categories
As an admin, I import the full category tree from the source file.
- AC: 10/38/170 levels imported; each node has AR/EN name and a slug; parents correct; no orphan; tree preview matches the file.
- Edge: duplicate node under the same parent → rejected with line number; missing Arabic → flagged, English used as fallback until fixed.

## US-02 · Admin · product types & templates
As an admin, I review product types and their templates before publishing.
- AC: 955 exact-mapped types auto-linked; 399 new templates listed for review; each shows family, fields count, variant axes; approve/adjust/reject.
- Edge: a type without an approved template cannot be published; editing a template after products exist creates a new version, existing products keep snapshots.

## US-03 · Vendor · correct form per type
As a vendor, I pick a product type and see only its fields.
- AC: T-shirt shows material/fit/sleeve/color/size; TV shows inches/panel/resolution; washing machine shows capacity/programs/energy; no field from another type.
- Edge: incomplete required fields block submit with inline errors; Brand comes from the product field, never duplicated in specs.

## US-04 · Customer · specs & filters
As a customer, I see grouped specs and can filter by relevant attributes.
- AC: spec groups appear as tabs/sections; only filterable attributes appear in the sidebar; values come from dictionaries (no free-text duplicates).
- Edge: a product with missing specs hides empty groups instead of showing blank rows.

## US-05 · Admin · geography import
As an admin, I import governorates and areas with fees.
- AC: 27 governorates at 100 EGP shipping; 572 areas at 20 EGP pickup; area must belong to one governorate; duplicates inside the same governorate rejected.
- Edge: same area name in two governorates is allowed and shown with its governorate.

## US-06 · Operations · safe re-import & rollback
As an operator, I can re-run the import safely or roll it back.
- AC: second run inserts 0 rows; rollback by batch restores counts; every run logged with a batch id and a diff report.
- Edge: partial failure never leaves half-imported data; the transaction rolls back.
