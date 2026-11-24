/**
 * MediaLibraryCore — the full media library: folder tree navigation, upload
 * queue, drag & drop between folders, search/pagination, rename/move/delete,
 * and single/multi picker mode. Rendered directly by admin/vendor media routes
 * and wrapped by MediaPickerDialog.
 *
 * Split out of media-ui.tsx (barrel re-exports it and MediaLibraryProps;
 * import paths unchanged). Sub-parts live in media-*.tsx / useMediaUpload.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDropzone } from "react-dropzone";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { useToast } from "~/components/ui/Toast";
import { XIcon } from "~/components/ui/icons";
import { publicMediaUrl, VIDEO_MIMES, type MediaKind, type MediaSettings } from "~/lib/media.shared";
import {
  createFolder, listFilesPage, listFolders, moveFile, physicalDelete, renameFile,
  renameFolder, softDeleteFile, MEDIA_PAGE_SIZE,
  type MediaFileRow, type MediaFolderRow,
} from "../api";
import { FolderAside, breadcrumbPath, descendantIds } from "./media-folder-tree";
import { MediaPagination, MediaToolbar } from "./media-shared";
import { MediaContent } from "./media-content";
import { UploadsPanel, useMediaUpload } from "./useMediaUpload";
import { MediaLibraryDialogs, MoveDialog, RenameDialog } from "./media-dialogs";

/* ------------------------------------------------------------- MediaLibraryCore */
export interface MediaLibraryProps {
  settings: MediaSettings;
  uid: string;
  supabaseUrl: string;
  /** Picker mode: select one/many and confirm. Absent = manage mode. */
  select?: { mode: "single" | "multi"; kinds?: MediaKind[] };
  onConfirm?: (files: MediaFileRow[]) => void;
  onCancel?: () => void;
  bucket?: "media" | "documents";
}

const DRAG_PREFIX = "file:";

// `uid` stays on MediaLibraryProps (callers pass it) but is intentionally not
// destructured: the original component never used it.
export function MediaLibraryCore({ settings, supabaseUrl, select, onConfirm, onCancel, bucket = "media" }: MediaLibraryProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [folders, setFolders] = useState<MediaFolderRow[]>([]);
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Map<string, MediaFileRow>>(new Map());
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [renaming, setRenaming] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<MediaFileRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<MediaFileRow | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const descendantList = currentId === null ? [] : [...descendantIds(folders, currentId)];
      const [f, fl] = await Promise.all([
        listFolders(),
        listFilesPage({ selfId: currentId, folderIds: descendantList, search: search.trim(), page }),
      ]);
      if (!mounted.current) return;
      setFolders(f);
      setFiles(fl.rows);
      setCount(fl.count);
      setLoadError(false);
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [bucket, currentId, folders, search, page]);

  const loadOnce = useRef(false);
  if (!loadOnce.current) {
    loadOnce.current = true;
    void refresh();
  }
  const lastKey = useRef("");
  const stateKey = `${currentId ?? ""}|${page}|${search.trim()}`;
  if (lastKey.current !== stateKey) {
    lastKey.current = stateKey;
    void refresh();
  }

  const shownFiles = files;
  const childFolders = useMemo(
    () => folders.filter((f) => f.parent_id === currentId),
    [folders, currentId],
  );
  const crumbs = useMemo(() => breadcrumbPath(folders, currentId), [folders, currentId]);
  const currentDepth = currentId ? (folders.find((f) => f.id === currentId)?.depth ?? 0) : 0;

  const { uploads, setUploads, doUpload } = useMediaUpload({ settings, currentId, bucket, refresh });

  const { getRootProps, getInputProps, open: openPicker } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => void doUpload(accepted),
  });

  // the file dialog offers only what the settings allow; the upload guard
  // still decides (and the video mimes are allowed when the switch is on)
  const accept = [
    ...(settings.allow_images ? ["image/*"] : []),
    ...(settings.allow_video ? VIDEO_MIMES : []),
    ...(settings.allow_pdf ? ["application/pdf"] : []),
  ].join(",");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [lastMove, setLastMove] = useState<{ id: string; from: string | null } | null>(null);
  useEffect(() => {
    if (!lastMove) return;
    const timer = setTimeout(() => setLastMove(null), 5000);
    return () => clearTimeout(timer);
  }, [lastMove]);

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      if (!activeId.startsWith(DRAG_PREFIX) || !event.over) return;
      const fileId = activeId.slice(DRAG_PREFIX.length);
      const overId = String(event.over.id);
      const folderId = overId === "folder-root" ? null : overId.replace("folder:", "");
      const row = files.find((f) => f.id === fileId);
      if (!row || (row.folder_id ?? null) === folderId) return;
      const from = row.folder_id ?? null;
      try {
        await moveFile(fileId, folderId);
        setFiles((cur) => cur.map((f) => (f.id === fileId ? { ...f, folder_id: folderId } : f)));
        setLastMove({ id: fileId, from });
      } catch {
        toast.showToast("error", t("media.moveFailed"));
      }
    },
    [files, toast, t],
  );

  const undoLastMove = useCallback(async () => {
    if (!lastMove) return;
    try {
      await moveFile(lastMove.id, lastMove.from);
      void refresh();
    } catch {
      toast.showToast("error", t("media.moveFailed"));
    }
    setLastMove(null);
  }, [lastMove, toast, t]);

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const row = await createFolder(name, currentId);
      setFolders((cur) => [...cur, row]);
      setExpanded((cur) => (currentId ? new Set(cur).add(currentId) : cur));
      setNewFolderOpen(false);
      setNewFolderName("");
      toast.showToast("success", t("media.folderCreated"));
    } catch (error) {
      toast.showToast("error", error instanceof Error && error.message.includes("duplicate") ? t("media.folderDuplicate") : t("media.folderFailed"));
    }
  };

  const deleteFile = async (row: MediaFileRow) => {
    try {
      await softDeleteFile(row.id);
      try {
        await physicalDelete(row);
        toast.showToast("success", t("media.deleted"));
      } catch (err) {
        const usage = (err as { usage?: Array<{ ref_label: string }> }).usage ?? [];
        // Still referenced → say where. Any other physical-delete failure
        // leaves the soft delete in place, which is what the user asked for.
        if (usage.length > 0) {
          toast.showToast("info", t("media.deletedSoftInUse", { count: usage.length, places: usage.map((u) => u.ref_label).join("، ") }));
        } else {
          toast.showToast("success", t("media.deleted"));
        }
      }
      setSelectedRows((cur) => {
        const next = new Map(cur);
        next.delete(row.id);
        return next;
      });
    } catch {
      toast.showToast("error", t("media.deleteFailed"));
    }
  };

  const copyLink = async (row: MediaFileRow) => {
    try {
      await navigator.clipboard.writeText(publicMediaUrl(supabaseUrl, row.path));
      toast.showToast("success", t("common.copied"));
    } catch {
      toast.showToast("error", t("media.copyFailed"));
    }
  };

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const toggleSelected = useCallback((row: MediaFileRow) => {
    setSelectedRows((cur) => { const n = new Map(cur); if (n.has(row.id)) n.delete(row.id); else n.set(row.id, row); return n; });
  }, []);

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* Folder tree (start side, inline on desktop / drawer on mobile) */}
      <FolderAside
        folders={folders}
        currentId={currentId}
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
        onNavigate={setCurrentId}
        onNewFolder={() => setNewFolderOpen(true)}
        currentDepth={currentDepth}
      />

      {/* Main column */}
      <div className="min-w-0">
        <MediaToolbar
          crumbs={crumbs}
          onNavigate={setCurrentId}
          onOpenFolders={() => setFoldersOpen(true)}
          search={search}
          onSearchChange={setSearch}
          onUpload={openPicker}
        />

        {/* Dropzone = the grid area itself */}
        <div {...getRootProps()} className="rounded-lg border border-dashed border-border bg-surface p-3">
          <input {...getInputProps(accept ? { accept } : undefined)} />
          {/* Upload progress list */}
          <UploadsPanel
            uploads={uploads}
            onCancel={(u) => { u.signal.aborted = true; u.signal.abort?.(); }}
            onRetry={(u) => { setUploads((cur) => cur.filter((x) => x.id !== u.id)); void doUpload([u.file]); }}
          />

          <MediaContent
            loading={loading}
            loadError={loadError}
            childFolders={childFolders}
            files={shownFiles}
            select={select}
            selectedRows={selectedRows}
            supabaseUrl={supabaseUrl}
            onNavigate={setCurrentId}
            onUpload={openPicker}
            onNewFolder={() => setNewFolderOpen(true)}
            onPickSingle={(f) => setSelectedRows((cur) => (cur.has(f.id) ? new Map() : new Map([[f.id, f]])))}
            onToggleSelect={toggleSelected}
            onRename={(f) => setRenaming({ kind: "file", id: f.id, name: f.original_name })}
            onMove={setMoveTarget}
            onCopyLink={(f) => void copyLink(f)}
            onDelete={setDeleting}
          />
        </div>

        {/* pagination — 20 per page, server-side */}
        <MediaPagination
          count={count}
          page={page}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => ((p + 1) * MEDIA_PAGE_SIZE < count ? p + 1 : p))}
        />

        {/* M-04: undo toast — 5s window to restore the last move. */}
        {lastMove ? (
          <div role="status" className="fixed bottom-20 start-4 z-50 flex items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-2">
            <span className="text-sm font-bold text-text">{t("media.moved")}</span>
            <button type="button" onClick={() => void undoLastMove()} className="cursor-pointer text-sm font-bold text-action hover:underline">
              {t("media.undo")}
            </button>
            <button type="button" onClick={() => setLastMove(null)} aria-label={t("common.close")} className="cursor-pointer text-text-muted hover:text-text">
              <XIcon className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      {/* dialogs */}
      <MediaLibraryDialogs
        folders={folders}
        drawerOpen={foldersOpen}
        onDrawerClose={() => setFoldersOpen(false)}
        currentId={currentId}
        onNavigate={setCurrentId}
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
        newFolderOpen={newFolderOpen}
        onNewFolderClose={() => setNewFolderOpen(false)}
        newFolderName={newFolderName}
        onNewFolderNameChange={setNewFolderName}
        currentDepth={currentDepth}
        onSubmitNewFolder={() => void submitNewFolder()}
        deleting={deleting}
        onDeleteClose={() => setDeleting(null)}
        onDeleteConfirm={(row) => { setDeleting(null); void deleteFile(row); }}
      />

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title={t("media.rename")}>
        {renaming ? (
          <RenameDialog
            initial={renaming.name}
            onCancel={() => setRenaming(null)}
            onSubmit={async (name) => {
              if (renaming.kind === "folder") await renameFolder(renaming.id, name);
              else await renameFile(renaming.id, name);
              if (renaming.kind === "folder") setFolders((cur) => cur.map((f) => (f.id === renaming.id ? { ...f, name } : f)));
              else setFiles((cur) => cur.map((f) => (f.id === renaming.id ? { ...f, original_name: name } : f)));
              setRenaming(null);
              toast.showToast("success", t("media.renamed"));
            }}
          />
        ) : null}
      </Dialog>

      <Dialog open={moveTarget !== null} onClose={() => setMoveTarget(null)} title={t("media.moveTo")}>
        {moveTarget ? (
          <MoveDialog
            folders={folders}
            currentFolderId={moveTarget.folder_id}
            onCancel={() => setMoveTarget(null)}
            onSubmit={async (folderId) => {
              await moveFile(moveTarget.id, folderId);
              await refresh();
              setMoveTarget(null);
              toast.showToast("success", t("media.moved"));
            }}
          />
        ) : null}
      </Dialog>

      {/* picker footer */}
      {select ? (
        <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:col-span-2">
          <span className="text-sm font-bold text-text">{t("media.selectedCount", { count: selectedRows.size })}</span>
          <div className="flex flex-1 justify-end gap-2 sm:flex-none">
            <Button type="button" variant="ghost" onClick={() => { setSelectedRows(new Map()); onCancel?.(); }}>{t("common.cancel")}</Button>
            <Button
              type="button"
              disabled={selectedRows.size === 0}
              onClick={() => onConfirm?.([...selectedRows.values()])}
            >
              {t("media.pick")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
    </DndContext>
  );
}
