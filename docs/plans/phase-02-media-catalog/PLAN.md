# Phase 02 — Media + Catalog Setup · PLAN

## 1) Goal
A media library for **vendors and admins** (owner decision: customers never get one) used as the single picker everywhere, plus the category tree and attribute templates every product depends on.

## 2) Scope
**In:** vendor/admin media library (`/vendor/media`, `/admin/media`) · MediaPicker dialog · admin upload limits · buckets/policies · categories (3 levels) · brands · tags · attribute definitions + options + category linking + variant-axis flags · admin catalog pages.
**Out:** products themselves (Phase 03). Customer uploads (e.g., avatar) use the native device picker, not a library.

## 3) Decisions
- No drop-in React library covers folders + RLS + Supabase Storage → in-house: `react-dropzone` (upload/DnD) + `dnd-kit` (move/sort) + Storage + tables.
- `media` bucket public-read with `u/{uid}/{uuid}` paths (product images must render for visitors); `documents` bucket private with signed URLs.
- RLS owner-only on `media_folders`/`media_files`; visibility of an object never implies listing.
- Upload limits stored in `settings.media` and enforced in UI + edge guard + bucket config (via `admin-update-bucket` with service_role).
- Categories: max 3 levels, slug per locale, drag-order, thumbnails, header visibility.
- Attributes: `enum|color` and all axes must reference admin options; `text|number` accept free values and filter by range/search.
- Deleting a used attribute/category = soft delete + RESTRICT; never cascade data loss.

## 4) Architecture
**Tables:** `media_folders` (owner, parent, name, depth≤3) · `media_files` (owner, folder, bucket, path, mime, size, kind, dims, deleted_at) · `categories` (parent, depth, path, slug_ar/en, thumb, sort, active) · `brands` · `tags` · `attribute_defs` (leaf category, code, type, unit, required, filterable, is_variant_axis, sort) · `attribute_options` (labels ar/en, color_hex, image, sort).
**Components:** FolderTree · MediaGrid · UploadDropzone · MediaPickerDialog · MediaBreadcrumbs · FileCard · QuotaBar · CategoryTreeEditor · AttributeBuilder · OptionEditor.
**API:** `useMedia()` (list/createFolder/move/rename/delete/upload/url).
**Single entry point:** every image/file field uses "Choose from media"; no bare file inputs in the final product.

## 5) Tasks
See `TASKS.md` (M-01 … M-18).

## 6) Acceptance
Upload only allowed types/sizes · 3-level folders · create folder + upload + select without leaving the form · moving files by drag works with undo on failure · vendor/admin B sees nothing of vendor/admin A (API test) · deleting a referenced file is blocked with a list of usages · attribute template for a leaf category renders later (Phase 03) exactly as configured.

## 7) Verification gate (phase-specific)
G1 all tasks · G2 RLS + object policies + signed URLs for documents · G3 tokens only · G4 max two steps to upload, clear per-file errors · G5 grid 2/3/5 columns at four breakpoints · G6 lazy images, no layout shift.

## 8) Risks
Orphan files → usage check; huge uploads → pre-check + progress; nested loops → hard depth cap; option duplicates → UNIQUE(attribute_id, code).
