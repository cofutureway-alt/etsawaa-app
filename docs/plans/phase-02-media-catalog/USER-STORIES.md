# Phase 02 — Media + Catalog Setup · USER STORIES

> **Owner decision:** the media library is for vendors and admins only. Customers never get a library; their uploads (e.g., avatar) use the native device picker directly into the field.

## US-01 · Vendor/Admin · open my media
As a signed-in user, I open my media library and see only my folders and files.
- AC: default view = root folders + "All files"; breadcrumb navigates back; search filters within the current folder and subfolders.
- Edge: empty library → guided empty state with "Create folder" and "Upload".

## US-02 · Vendor/Admin · create folder
As a user, I create nested folders to organize uploads.
- AC: name required, duplicates blocked, max 3 levels (creating deeper is disabled with explanation).
- Edge: same name in another parent is allowed; rename updates the breadcrumb immediately.

## US-03 · Vendor/Admin · upload
As a user, I drag files onto the grid and they upload with progress.
- AC: allowed types/sizes per settings; per-file progress + success/fail; retry failed only.
- Edge: disallowed type shows the reason before the request; oversized file rejected instantly; interrupted upload can resume from the failed item only.

## US-04 · Vendor/Admin · organize
As a user, I drag a file to another folder.
- AC: drop target highlights; move persists; undo toast for 5 seconds.
- Edge: failure restores the file to its original folder with a message.

## US-05 · Product creator · pick media in a form
As a vendor/admin, I pick an image inside a form without leaving it.
- AC: "Choose from media" opens the dialog; I can create a folder, upload, then select; single or multiple based on the field; selected items show as thumbnails with remove.
- Edge: closing the dialog keeps the form untouched; selecting a deleted file shows a warning and asks to choose again.

## US-06 · Admin · upload limits
As an admin, I set allowed types and max sizes and they apply everywhere.
- AC: saving updates settings + bucket config; the next upload obeys new limits; a test-upload button validates configuration.
- Edge: lowering limits never deletes existing files, only blocks new ones.

## US-07 · Admin · privacy proof
As an admin, I verify user isolation.
- AC: test panel shows a user's file count vs another user; no cross-visibility; signed URL expires.
- Edge: sharing a direct `media` URL works only for public objects (catalog), documents require signed links.

## US-08 · Admin · category tree
As an admin, I build the category tree with images and ordering.
- AC: add/edit/delete (soft), drag order, per-locale slug, thumbnail via MediaPicker, header visibility toggle.
- Edge: deleting a parent with children is blocked until children are moved/archived; reordering recalculates paths.

## US-09 · Admin · attribute template
As an admin, I define attributes for a leaf category so vendor forms are generated correctly.
- AC: type selection drives the editor; "variant axis" visible only for selectable types; required/filterable toggles; ordering; options with ar/en labels + color swatch/image.
- Edge: deleting an option used by products is blocked; deleting an unused option with history soft-deletes it.

## US-10 · Vendor preview · template correctness
As an admin, I preview the generated form for a leaf category before vendors use it.
- AC: preview shows exactly the fields vendors will see, in order, with required marks.
- Edge: category without attributes → warning banner "add attributes before enabling products".
