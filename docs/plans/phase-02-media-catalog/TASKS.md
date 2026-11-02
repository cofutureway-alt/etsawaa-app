# Phase 02 — Media + Catalog Setup · TASKS

## Media
- [ ] **M-01** Migrations: media_folders, media_files, settings.media defaults, RLS, bucket policies. DoD: owner-only listing proven by test; public URL works for a `media` object.
- [ ] **M-02** MediaLibraryPage (folder tree, grid, breadcrumbs, search, rename, soft delete). DoD: 3-level navigation without page reload.
- [ ] **M-03** UploadDropzone: multi-file, drag & drop, per-file progress, retry, cancel. DoD: one failed file never blocks the rest.
- [ ] **M-04** Move files between folders with dnd-kit + "Move to" menu + undo toast. DoD: move persists after refresh.
- [ ] **M-05** MediaPickerDialog (single/multi, accept kinds, folder scoping) + wire into logo/banner fields. DoD: selecting a file fills the field and closes dialog; creating a folder inside the dialog works.
- [ ] **M-06** Admin Media Settings page + Edge `admin-update-bucket`. DoD: new limits apply to the next upload and to the bucket itself.
- [ ] **M-07** Reference check before delete (product/store/post/template). DoD: blocked delete lists usages with links.
- [ ] **M-08** RLS test suite for media (two vendors/admins, direct ID access, object URL, customer has no library route). DoD: zero leakage.
- [ ] **M-09** Image serving helper with srcset + lazy + placeholder. DoD: no CLS jump on cards.

## Catalog
- [ ] **M-10** Categories CRUD + tree editor + DnD order + thumbnails + slug ar/en + header toggle. DoD: moving a node preserves children and depth≤3.
- [ ] **M-11** Brands CRUD + order + thumbnails. DoD: slug unique.
- [ ] **M-12** Tags CRUD. DoD: duplicate tag names blocked case-insensitively.
- [ ] **M-13** Attributes CRUD: type, unit, required, filterable, is_variant_axis. DoD: axis attributes cannot be `text|number` free values.
- [ ] **M-14** Attribute options editor: labels ar/en, color_hex (color type), image, order. DoD: duplicate code blocked.
- [ ] **M-15** Category↔attribute linking (multi-category) + ordering. DoD: leaf category shows exactly its linked attributes.
- [ ] **M-16** Public category pages data checks (no UI yet beyond listing) — ensure only active nodes exposed. DoD: inactive/archived nodes return 404 or are excluded, verified by test.
- [ ] **M-17** Seeds: sample tree (fashion, electronics, home) with 2 levels each for QA only, disabled by default. DoD: seed is idempotent and can be toggled off without touching real data.
- [ ] **M-18** Responsive + G1–G6 evidence pack. DoD: screenshots at 4 breakpoints attached in `plans/evidence/phase-02/`.
