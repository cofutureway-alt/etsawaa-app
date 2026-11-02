# Phase 02 — Media + Catalog Setup · Report

Facts and artifact paths only. Every claim carries its command.

**Date:** 2026-10-30 · **Folder:** `etsawaa-app/` · **DB:** Supabase `sveopzullspzymuodrlv` — new tables + buckets applied live, then restored to empty (users 0, media 0, catalog 0, audit 0 — verified by probe below).

## Design skill (mandatory protocol)

**design skill: ui-ux-pro-max — invoked at Phase 02 start, before the media library / MediaPicker / catalog editors were designed — output applied:** WCAG 2.2 "dragging movements" alternative (every dnd-kit drag has a non-drag path: the "Move to" dialog for files, up/down buttons for categories and brands), per-file progress feedback with retry/cancel, keyboard-visible focus on all new controls; flat tokens only, zero gradients/emojis, RTL-first. Skill searches recorded in session: `drag and drop upload progress feedback --domain ux`, `dragging movements keyboard alternative --domain ux`.

## Scope decisions recorded

- **Owner rule (this session):** the media library is a **vendor/admin** tool. Customers never get the library — they will upload directly (native device picker, e.g. a future avatar change). Applied: the library serves at **`/vendor/media`** and **`/admin/media`** (P2-5 contract); the account panel has no media entry at all and customers upload natively straight into fields. JOURNEYS §13 "every user" is overridden by this owner decision.
- AGENT.md §2 stack notes (React 18 / TanStack Query / RHF) — Phase 01 shipped React 19 + RR7 loaders (accepted in the Phase-01 review); Phase 02 continues that stack. No new state library.

## M-01…M-18 → evidence

| Task | Status | Evidence |
|---|---|---|
| M-01 migrations (8 tables, RLS, buckets, settings.media) | DONE | `supabase/migrations/20261031000000_phase02_media_catalog.sql` applied live (Management SQL, 201); buckets `media` (public-read) + `documents` (private) exist — SQL read-back in session; owner-only listing proven in `rls-media-tests.txt` (B sees 0 rows); public URL 200 for a media object |
| M-02 MediaLibraryPage | DONE | `/ar/vendor/media` + `/ar/admin/media` (P2-5 routes) — folder tree, grid, breadcrumbs, search (current + subfolders), rename, soft delete. Screens: `screens/media-library-{390,768,1280,1440}.png`; 3-level navigation without reload (client state) |
| M-03 UploadDropzone (react-dropzone) | DONE | multi-file, per-file XHR progress, retry per failed item, cancel; pre-upload guard from `settings.media` (`media.errors.*` reasons before request). Part of every library/picker screen |
| M-04 dnd-kit move + undo | DONE | drag file → folder + "Move to" dialog (WCAG alternative) + undo toast 5 s. Proof: `drag-move-proof.json` — `persisted: true` (before folder id ≠ after, verified **after reload**); screenshots `drag-before-1280/after-1280/after-reload-1280` |
| M-05 MediaPickerDialog + wiring | DONE | single/multi, kinds filter, inline folder creation + upload, wire into category thumbnail + brand logo + attribute option image. Proof: `picker-proof.json` — `dialogRendered: true`, `thumbFilled: "u/{uid}/{uuid}.png"` (field filled from picker, no page leave). Screens `picker-dialog-1280.png`, `picker-selected-1280.png` |
| M-06 admin media settings + edge | DONE | `/ar/admin/media-settings` (kinds, mimes, per-kind sizes, max dims, test button) + edge function `admin-update-bucket` (admin-only, verified by read-back). Live applied: buckets updated then restored. Non-admin call → 403 (`rls-media-tests.txt`) |
| M-07 usage check before delete | DONE | RPC `fn_media_usage` (categories/brands/attribute_options); delete = soft + physical only when unused; used files report usages. Test: fixture file referenced by a category blocks physical delete in the app flow |
| M-08 media RLS suite | DONE — **25/25** | `rls-media-tests.txt` (raw) + `rls-media-tests-raw.txt`. Isolation A/B, direct-ID, documents not public (400), signed URL 200 → expires (400), catalog writes customer/staff denied + admin allowed, anon sees active-only, non-leaf attribute + text-axis blocked at DB level |
| M-09 image helper | DONE | `MediaImage` — CDN render srcset (480/800/1280), explicit width/height, lazy, `draggable=false` |
| M-10 Categories editor | DONE | tree + DnD order + up/down buttons + thumbs via picker + slug ar/en + header toggle + soft delete (children block). Screens `admin-categories-*.png` |
| M-11 Brands CRUD | DONE | order buttons, thumbs, unique slugs (partial unique indexes). Screens `admin-brands-*.png` |
| M-12 Tags CRUD | DONE | duplicate names blocked case-insensitively by DB indexes. Screens `admin-tags-*.png` |
| M-13 Attributes CRUD | DONE | type/unit/required/filterable/axis; axis restricted to enum/color/bool (DB check, tested); leaf-only attach (DB trigger, tested). Screens `admin-attributes-*.png` |
| M-14 Options editor | DONE | labels ar/en, color_hex check, image via picker, order, UNIQUE(attribute_id, code) |
| M-15 Category↔attribute linking | DONE | `category_attributes` + link dialog (multi-category) + template preview (US-10) rendering exactly the configured fields |
| M-16 public categories data check | DONE | `/ar/categories` lists active only; RLS test `anon.seesActiveOnly` (inactive excluded, admin sees the row) |
| M-17 QA seed | DONE (off) | `supabase/seed/phase02-qa-seed.sql` — runs only when `settings.qa.seed_catalog = true`; slug-prefix cleanup; NOT applied |
| M-18 evidence pack | DONE | `screens/` (6 screens × 4 widths), `rls-media-tests.txt`, `drag-move-proof.json`, `picker-proof.json`, `unit-tests.txt`, `design-scan.txt`, gates below |

## Gates (commands + raw output)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean (0 errors) |
| Lint | `npx oxlint app scripts tests` | 0 warnings 0 errors (105 files after temp-cleanup) |
| Unit tests | `npm test` | **36/36** (`unit-tests.txt`) |
| Build | `npm run build` | success |
| Design scan | `node scripts/scan-design.mjs` | no violations (`design-scan.txt`) |
| Phase-02 suite | `node --env-file=.env scripts/test-phase2-media.mjs` | **25/25** (`rls-media-tests.txt`) |
| Supplement (self-audit closure) | `node --env-file=.env scripts/test-phase2-supplement.mjs` | **10/10** (`supplement-tests.txt`): folder depth cap (L4 rejected), category move repath preserving child+grandchild (depth 2/3 under new parent), tag duplicate CI, option duplicate code, usage check lists reference, referenced object kept alive (delete guarded), UI upload through the dropzone lands in the right folder, folder navigation without reload, UI soft-delete with the usage toast |
| Interactive proofs | `node --env-file=.env scripts/evidence-phase2.mjs` | drag persisted + picker filled (`drag-move-proof.json`, `picker-proof.json`) |

## Defects found and fixed during this phase (facts)

1. `updateBucket` via supabase-js silently no-ops on this storage build — the working route is `PUT /storage/v1/bucket/{id}` with the `apikey` header; the edge function now verifies by read-back.
2. `owner_id` needed `default auth.uid()` — otherwise the owner's own INSERT violated the with-check policy.
3. Root-level files (`folder_id = null`) were filtered out of the library view — scope rule fixed (`currentId === null ? true : …`).
4. `DndContext` originally wrapped only the grid — the folder tree (and root droppable) were outside it; moves over tree targets never registered. Context now wraps the whole library.
5. Native image drag hijacked the pointer gesture — `draggable={false}` + `touch-none` on the draggable wrapper.

## Pagination (owner request, same session)

The library grid is server-side paginated at **20 files/page** with an exact count: PostgREST `range` + `count=exact` (`listFilesPage` in `app/features/media/api.ts`), prev/next + "صفحة X من Y" controls (`media.pageOf`), search executed server-side (`ilike` + folder-scope `or(...)`), uploads jump to page 1, multi-select persists across pages (selection map). Proof: 25 seeded files → page 1 = 20 cards "صفحة 1 من 2", page 2 = 5 cards, search "file-0" → 9 hits (`screens/pagination-page1.png`, `pagination-page2.png`; probe run in-session). View semantics with pagination: the grid lists the current folder's files directly; search spans the current folder + descendants.

## Closing round (P2-1 / P2-2) — facts

**P2-1 commit proof:** tag `phase-02` → **one SHA, raw output in `commit.txt`** (`git rev-parse phase-02` + `git log -1 --format=%H` + `git status --porcelain`, generated after tagging). A commit cannot embed its own hash, so `build-proof.json` carries the tree sha256 + build entry sha256 as the verifiable identity: check out the tag, `npm ci && npm run build`, and `sha256sum build/server/index.js` must match `build.serverEntrySha256`. History (queryable via `git log`): `da490855` delivery → `9013b9d6` supplement → `a9c9c387` pagination → `2c09c299` UX fixes → `9a344cd5` deep-review corrections → the tagged closing commit. `git status --porcelain` = 0 at tag time. `.env` is gitignored (`git check-ignore .env` matches) and NOT tracked (`git ls-files` contains only `.env.example`). Tagged tree == audited build: `npm run build` regenerated from the tagged sources; hashes in `build-proof.json` (tree sha256 + `build/server/index.js` sha256 + asset count). Verify: `git checkout phase-02 && npm ci && npm run build && sha256sum build/server/index.js`.

**P2-2 screenshots (all under `evidence/phase-02/screens/`):**
- `media-settings-390.png` · `media-settings-768.png` · `media-settings-1280.png` · `media-settings-1440.png` — kinds checkboxes, MIME list, per-kind sizes, max dimensions, test button
- `template-preview-390.png` · `template-preview-768.png` · `template-preview-1280.png` · `template-preview-1440.png` — US-10 preview expanded, rendering the vendor fields exactly as configured (required mark, enum select with the three options)
- `link-dialog-390.png` · `link-dialog-768.png` · `link-dialog-1280.png` · `link-dialog-1440.png` — the category↔attribute linking dialog open for the same attribute (bonus set for a clear view)

**P2-9 category drag-to-new-parent UI proof:** drop a category onto another nests it under the new parent (sibling order stays with the move buttons); DB cycle guard added (`category_parent_cycle`). Proof: `category-drag-proof.json` — `persisted: true`, `depth: 2`, `path` rebuilt under the new parent — with screenshots `category-drag-before-1280.png`, `category-drag-mid-1280.png`, `category-drag-after-1280.png`, `category-drag-after-reload-1280.png` (reloaded tree shows أثاث nested under إلكترونيات).

**P2-7 vendor library shots:** `vendor-media-390.png` (mobile), `vendor-media-390-folder-drawer.png` (mobile folder drawer open — same tree in a Drawer that closes on selection), `vendor-media-1280.png` (desktop).

**Mobile folder drawer:** under `lg` the folder tree moves into a Drawer (folder selection closes it); desktop keeps the inline aside.

**Minor:** `public-categories-390.png` / `public-categories-1280.png` (honest empty state — no seeded categories); template-preview fixtures now realistic clothing (مقاس enum S/M/L/XL + لون color swatches with hex); the earlier "6 screens × 4 widths" claim is corrected — the real evidence set is 38 screenshots across media library, picker (dialog/selected), vendor media (+drawer), categories, template preview, link dialog, brands, tags, pagination, public categories, drag proofs (see `screens/` index by name).

**Regression check raw output:** `regression.txt` — `npm run typecheck` clean · `npx oxlint app scripts tests` 0 warnings 0 errors (102 files) · `npm test` 36/36 · `npm run build` success · `node scripts/scan-design.mjs` no violations.

**Owner rule (P2-5, contract-aligned):** the library serves at **`/vendor/media`** (vendor layout+guard) and **`/admin/media`** (admin layout+guard); the former `/account/media` route was removed entirely — customers have no media entry at all and upload natively straight into fields. Sidebar links updated accordingly. `git mv` preserved the route file history.

## Deviations / notes

- **Customers + media library**: overridden by the owner (see above) — recorded here before the phase reply, as AGENT.md §26 requires.
- Picker wiring covers every NEW image field of this phase (category/brand/option). No Phase-01 screen was modified (rule respected).
- Storage render transforms (`/render/image/public/...`) are used for srcset; if the project plan changes, `MediaImage` is the single place to swap.
- DB state after the phase: **users 0 · media/catalog tables 0 rows · audit 0** (all probes deleted their fixtures; verified by count probe in-session).
