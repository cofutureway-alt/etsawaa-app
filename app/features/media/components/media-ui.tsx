import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDropzone } from "react-dropzone";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog, Drawer } from "~/components/ui/Overlay";
import { useToast } from "~/components/ui/Toast";
import {
  CheckIcon, FolderIcon, FolderPlusIcon, TrashIcon, PencilIcon, MoveIcon, CopyIcon,
  VideoIcon, FileIcon, UploadIcon, XIcon, ChevronRightIcon, ChevronLeftIcon, SearchIcon,
} from "~/components/ui/icons";
import { publicMediaUrl, validateUpload, validateImageDimensions, type MediaKind, type MediaSettings } from "~/lib/media.shared";
import {
  createFolder, listFilesPage, listFolders, moveFile, physicalDelete, renameFile,
  renameFolder, softDeleteFile, uploadFile, MEDIA_PAGE_SIZE,
  type MediaFileRow, type MediaFolderRow,
} from "../api";

/* ------------------------------------------------------------------ MediaImage */
interface MediaImageProps {
  path: string;
  alt: string;
  width?: number;
  height?: number;
  eager?: boolean;
  className?: string;
  supabaseUrl: string;
}
/** M-09: public media image with CDN srcset, explicit dims, lazy, no CLS. */
export function MediaImage({ path, alt, width, height, eager = false, className = "", supabaseUrl }: MediaImageProps) {
  return (
    <img
      src={publicMediaUrl(supabaseUrl, path)}
      alt={alt}
      width={width ?? 400}
      height={height ?? 300}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={`bg-surface-tint object-cover ${className}`}
    />
  );
}

/* -------------------------------------------------------------- folder helpers */
interface FolderNode extends MediaFolderRow {
  children: FolderNode[];
}

function buildTree(folders: MediaFolderRow[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  for (const f of byId.values()) {
    if (f.parent_id && byId.has(f.parent_id)) byId.get(f.parent_id)!.children.push(f);
    else roots.push(f);
  }
  return roots;
}

function descendantIds(folders: MediaFolderRow[], rootId: string): Set<string> {
  const out = new Set<string>();
  let frontier = [rootId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (out.has(id)) continue;
      out.add(id);
      next.push(...folders.filter((f) => f.parent_id === id).map((f) => f.id));
    }
    frontier = next;
  }
  return out;
}

function breadcrumbPath(folders: MediaFolderRow[], currentId: string | null): MediaFolderRow[] {
  const path: MediaFolderRow[] = [];
  let cur = folders.find((f) => f.id === currentId) ?? null;
  while (cur) {
    path.unshift(cur);
    cur = folders.find((f) => f.id === cur!.parent_id) ?? null;
  }
  return path;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 102.4)) / 10} MB`;
}

/* --------------------------------------------------------------- drag helpers */
function DraggableFile({ file, children }: { file: MediaFileRow; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `file:${file.id}` });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`touch-none ${isDragging ? "opacity-40" : ""}`}>
      {children}
    </div>
  );
}

function DroppableFolder({ id, children }: { id: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={isOver ? "ring-2 ring-action rounded-md bg-surface-tint" : ""}>
      {children}
    </div>
  );
}

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

interface UploadItem {
  id: string;
  file: File;
  name: string;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  errorKey?: string;
  row?: MediaFileRow;
  signal: { aborted: boolean; abort?: () => void };
}

const DRAG_PREFIX = "file:";

export function MediaLibraryCore({ settings, uid, supabaseUrl, select, onConfirm, onCancel, bucket = "media" }: MediaLibraryProps) {
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
  const [uploads, setUploads] = useState<UploadItem[]>([]);
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

  const doUpload = useCallback(
    async (items: File[]) => {
      // Dimension limit was stored in settings but never checked; validate it
      // here (async, before queueing) so oversized bitmaps are rejected early.
      const dims = await Promise.all(
        items.map((file) => validateImageDimensions(file, settings.max_dimensions_px)),
      );
      const queue: UploadItem[] = items.map((file, idx) => {
        const errorKey =
          validateUpload({ type: file.type, size: file.size }, settings) ?? dims[idx] ?? null;
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          status: errorKey ? "error" : "queued",
          progress: 0,
          errorKey: errorKey ?? undefined,
          signal: { aborted: false },
        };
      });
      setUploads((cur) => [...cur, ...queue]);
      for (const item of queue) {
        if (item.status === "error") continue;
        setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, status: "uploading" } : u)));
        try {
          const row = await uploadFile(uid, bucket, item.file, currentId, (pct) => {
            setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, progress: pct } : u)));
          }, item.signal);
          setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, status: "done", progress: 100, row } : u)));
          setPage(0);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "error";
          const key = msg === "cancelled" ? "media.errors.cancelled" : msg.startsWith("upload_4") ? "media.errors.mime" : "media.errors.failed";
          setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, status: "error", errorKey: key } : u)));
        }
      }
    },
    [settings, uid, bucket, currentId],
  );

  const { getRootProps, getInputProps, open: openPicker } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => void doUpload(accepted),
  });

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
        toast.showToast("info", t("media.deletedSoftInUse", { count: usage.length, places: usage.map((u) => u.ref_label).join("، ") }));
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

  const kindIcon = (kind: MediaKind) => (kind === "video" ? <VideoIcon className="size-5" /> : <FileIcon className="size-5" />);

  const renderTree = (nodes: ReturnType<typeof buildTree>, level: number) => (
    <ul className={level === 0 ? "" : "ms-3 border-s border-border ps-2"}>
      {nodes.map((node) => (
        <li key={node.id}>
          <DroppableFolder id={`folder:${node.id}`}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={expanded.has(node.id)}
                onClick={() => setExpanded((cur) => { const n = new Set(cur); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; })}
                className={`flex size-5 cursor-pointer items-center justify-center text-text-muted transition-transform ${node.children.length === 0 ? "invisible" : ""} ${expanded.has(node.id) ? "rotate-90" : ""} ltr:rotate-0`}
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentId(node.id)}
                aria-current={currentId === node.id}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] font-bold transition-colors duration-150 hover:bg-surface-tint ${currentId === node.id ? "bg-surface-tint text-action" : "text-text"}`}
              >
                <FolderIcon className="size-4 shrink-0 text-warning-strong" />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
          </DroppableFolder>
          {expanded.has(node.id) ? renderTree(node.children, level + 1) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* Folder tree (start side, inline on desktop / drawer on mobile) */}
      <aside className="hidden rounded-lg border border-border bg-surface p-2.5 lg:block" aria-label={t("media.folders")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-extrabold text-text">{t("media.folders")}</span>
          <button
            type="button"
            onClick={() => setNewFolderOpen(true)}
            disabled={currentDepth >= 3}
            title={currentDepth >= 3 ? t("media.depthLimit") : t("media.newFolder")}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FolderPlusIcon className="size-4" />
          </button>
        </div>
        <DroppableFolder id="folder-root">
          <button
            type="button"
            onClick={() => setCurrentId(null)}
            aria-current={currentId === null}
            className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] font-bold transition-colors duration-150 hover:bg-surface-tint ${currentId === null ? "bg-surface-tint text-action" : "text-text"}`}
          >
            <FolderIcon className="size-4 text-warning-strong" />
            {t("media.allFiles")}
          </button>
        </DroppableFolder>
        {renderTree(buildTree(folders), 0)}
        {folders.length === 0 ? <p className="px-1.5 py-2 text-[12px] text-text-muted">{t("media.noFolders")}</p> : null}
      </aside>

      {/* Main column */}
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <nav aria-label={t("media.folders")} className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
            <button type="button" onClick={() => setCurrentId(null)} className="cursor-pointer font-bold text-text hover:text-action">
              {t("media.allFiles")}
            </button>
            {crumbs.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRightIcon className="size-3.5 text-text-muted mirr" aria-hidden="true" />
                <button type="button" onClick={() => setCurrentId(c.id)} className="cursor-pointer font-bold text-text hover:text-action">
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFoldersOpen(true)}
              aria-haspopup="dialog"
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] font-bold text-text transition-colors duration-150 hover:bg-surface-tint lg:hidden"
            >
              <FolderIcon className="size-4" aria-hidden="true" />
              {t("media.folders")}
            </button>
            <label className="relative">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("media.search")}
                aria-label={t("media.search")}
                className="w-44 rounded-md border border-border bg-surface py-2 pe-2.5 ps-8 text-[13px] text-text placeholder:text-text-faint focus:border-action focus:outline-none"
              />
            </label>
            <Button type="button" size="sm" onClick={openPicker}>
              <UploadIcon className="size-4" aria-hidden="true" />
              {t("media.upload")}
            </Button>
          </div>
        </div>

        {/* Dropzone = the grid area itself */}
        <div {...getRootProps()} className="rounded-lg border border-dashed border-border bg-surface p-3">
          <input {...getInputProps()} />
          {/* Upload progress list */}
          {uploads.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1.5" aria-label={t("media.uploads")}>
              {uploads.map((u) => (
                <li key={u.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px]">
                  <span className="min-w-0 flex-1 truncate font-bold text-text">{u.name}</span>
                  {u.status === "uploading" ? (
                    <>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-tint" role="progressbar" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100}>
                        <span className="block h-full bg-action" style={{ width: `${u.progress}%` }} />
                      </span>
                      <button type="button" onClick={() => { u.signal.aborted = true; u.signal.abort?.(); }} aria-label={t("media.cancel")} className="cursor-pointer text-text-muted hover:text-danger">
                        <XIcon className="size-4" />
                      </button>
                    </>
                  ) : u.status === "done" ? (
                    <span className="font-bold text-success-strong">{t("media.done")}</span>
                  ) : u.status === "error" ? (
                    <>
                      <span className="font-bold text-danger">{t(u.errorKey ?? "media.errors.failed")}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setUploads((cur) => cur.filter((x) => x.id !== u.id));
                          void doUpload([u.file]);
                        }}
                        className="cursor-pointer font-bold text-action hover:underline"
                      >
                        {t("media.retry")}
                      </button>
                    </>
                  ) : (
                    <span className="text-text-muted">{t("media.queued")}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {loading ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-md bg-surface-tint" />
              ))}
            </div>
          ) : loadError ? (
            <p className="py-10 text-center text-[13px] font-bold text-text-muted">{t("errors.dataUnavailable")}</p>
          ) : (
            <>
              {/* sub-folders */}
              {childFolders.length > 0 ? (
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {childFolders.map((f) => (
                    <DroppableFolder key={f.id} id={`folder:${f.id}`}>
                      <button
                        type="button"
                        onClick={() => setCurrentId(f.id)}
                        className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-3.5 transition-colors duration-150 hover:bg-surface-tint"
                      >
                        <FolderIcon className="size-8 text-warning-strong" />
                        <span className="w-full truncate text-center text-[12px] font-bold text-text">{f.name}</span>
                      </button>
                    </DroppableFolder>
                  ))}
                </div>
              ) : null}

              {shownFiles.length === 0 && childFolders.length === 0 ? (
                <div className="py-14 text-center">
                  <UploadIcon className="mx-auto size-10 text-text-faint" aria-hidden="true" />
                  <p className="mt-2 text-sm font-extrabold text-text">{t("media.emptyTitle")}</p>
                  <p className="mt-1 text-[13px] text-text-muted">{t("media.emptyBody")}</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button type="button" size="sm" onClick={openPicker}>{t("media.upload")}</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>{t("media.newFolder")}</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                  {shownFiles.map((f) => {
                    const checked = selectedRows.has(f.id);
                    const kindMatch = !select?.kinds || select.kinds.includes(f.kind);
                    return (
                      <DraggableFile key={f.id} file={f}>
                        <div
                          className={`group relative flex flex-col overflow-hidden rounded-md border bg-surface transition-colors duration-150 ${checked ? "border-action" : "border-border"} ${kindMatch ? "cursor-pointer hover:bg-surface-tint" : "opacity-50"}`}
                          onClick={() => {
                            if (!kindMatch) return;
                            if (!select) return;
                            if (select.mode === "single") { onConfirm?.([f]); return; }
                            setSelectedRows((cur) => { const n = new Map(cur); if (n.has(f.id)) n.delete(f.id); else n.set(f.id, f); return n; });
                          }}
                        >
                          <div className="flex h-24 items-center justify-center bg-surface-tint">
                            {f.kind === "image" ? (
                              <MediaImage path={f.path} alt={f.original_name} supabaseUrl={supabaseUrl} className="h-24 w-full" width={240} height={192} />
                            ) : (
                              kindIcon(f.kind)
                            )}
                          </div>
                          <div className="min-w-0 px-2 py-1.5">
                            <p className="truncate text-[12px] font-bold text-text">{f.original_name}</p>
                            <p className="text-[11px] text-text-muted">{formatBytes(f.size_bytes)}</p>
                          </div>
                          {checked ? <span aria-hidden="true" className="absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-action text-on-action"><CheckIcon className="size-3" /></span> : null}
                          {!select ? (
                            <div className="absolute end-1.5 top-1.5 flex gap-1 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
                              <IconBtn label={t("media.rename")} onClick={() => setRenaming({ kind: "file", id: f.id, name: f.original_name })}><PencilIcon className="size-3.5" /></IconBtn>
                              <IconBtn label={t("media.moveTo")} onClick={() => setMoveTarget(f)}><MoveIcon className="size-3.5" /></IconBtn>
                              <IconBtn label={t("media.copyLink")} onClick={() => void copyLink(f)}><CopyIcon className="size-3.5" /></IconBtn>
                              <IconBtn label={t("common.delete")} onClick={() => setDeleting(f)}><TrashIcon className="size-3.5" /></IconBtn>
                            </div>
                          ) : null}
                        </div>
                      </DraggableFile>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* pagination — 20 per page, server-side */}
        {count > MEDIA_PAGE_SIZE ? (
          <nav aria-label={t("media.pagination")} className="mt-3 flex items-center justify-center gap-3 text-[13px] font-bold text-text">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label={t("common.back")}
              className="flex cursor-pointer items-center rounded-md border border-border bg-surface px-3 py-1.5 transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </button>
            <span className="num">
              {t("media.pageOf", { page: page + 1, total: Math.max(1, Math.ceil(count / MEDIA_PAGE_SIZE)) })}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => ((p + 1) * MEDIA_PAGE_SIZE < count ? p + 1 : p))}
              disabled={(page + 1) * MEDIA_PAGE_SIZE >= count}
              aria-label={t("media.next")}
              className="flex cursor-pointer items-center rounded-md border border-border bg-surface px-3 py-1.5 transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </button>
          </nav>
        ) : null}

        {/* undo toast — 5s window (M-04) */}
        {lastMove ? (
          <div role="status" className="fixed bottom-20 start-4 z-50 flex items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-2">
            <span className="text-[13px] font-bold text-text">{t("media.moved")}</span>
            <button type="button" onClick={() => void undoLastMove()} className="cursor-pointer text-[13px] font-bold text-action hover:underline">
              {t("media.undo")}
            </button>
            <button type="button" onClick={() => setLastMove(null)} aria-label={t("common.close")} className="cursor-pointer text-text-muted hover:text-text">
              <XIcon className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      {/* dialogs */}
      {/* mobile folder drawer (P2-7): same tree, closes on selection */}
      <Drawer open={foldersOpen} onClose={() => setFoldersOpen(false)} title={t("media.folders")}>
        <div className="p-2.5">
          <DroppableFolder id="drawer-root">
            <button
              type="button"
              onClick={() => { setCurrentId(null); setFoldersOpen(false); }}
              aria-current={currentId === null}
              className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-2 text-[13px] font-bold transition-colors duration-150 hover:bg-surface-tint ${currentId === null ? "bg-surface-tint text-action" : "text-text"}`}
            >
              <FolderIcon className="size-4 text-warning-strong" />
              {t("media.allFiles")}
            </button>
          </DroppableFolder>
          {renderTree(buildTree(folders), 0)}
        </div>
      </Drawer>

      <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} title={t("media.newFolder")}>
        <form onSubmit={(e) => { e.preventDefault(); void submitNewFolder(); }} className="flex flex-col gap-3">
          <Input label={t("media.folderName")} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} required maxLength={80} inputClassName="bg-surface" />
          <p className="text-[12px] text-text-muted">{t("media.depthNote", { depth: currentDepth + 1 })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setNewFolderOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit">{t("common.confirm")}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("common.confirm")}>
        {deleting ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text">{t("media.deleteConfirm", { name: deleting.original_name })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="button" onClick={() => { const row = deleting; setDeleting(null); void deleteFile(row); }}>{t("common.confirm")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

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
      {select?.mode === "multi" ? (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3">
          <span className="text-[13px] font-bold text-text">{t("media.selectedCount", { count: selectedRows.size })}</span>
          <div className="flex gap-2">
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

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex size-6 cursor-pointer items-center justify-center rounded-sm border border-border bg-surface text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
    >
      {children}
    </button>
  );
}

function RenameDialog({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (name: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit(name.trim()); }} className="flex flex-col gap-3">
      <Input label={t("media.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} inputClassName="bg-surface" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit">{t("common.save")}</Button>
      </div>
    </form>
  );
}

function MoveDialog({ folders, currentFolderId, onSubmit, onCancel }: {
  folders: MediaFolderRow[];
  currentFolderId: string | null;
  onSubmit: (folderId: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(currentFolderId);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit(target); }} className="flex flex-col gap-3">
      <fieldset className="max-h-72 overflow-y-auto rounded-md border border-border p-2">
        <legend className="px-1 text-[12px] text-text-muted">{t("media.targetFolder")}</legend>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint">
          <input type="radio" name="target" checked={target === null} onChange={() => setTarget(null)} className="accent-[var(--color-action)]" />
          {t("media.allFiles")}
        </label>
        {folders.map((f) => (
          <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint" style={{ paddingInlineStart: `${(f.depth - 1) * 14 + 8}px` }}>
            <input type="radio" name="target" checked={target === f.id} onChange={() => setTarget(f.id)} className="accent-[var(--color-action)]" />
            <FolderIcon className="size-4 text-warning-strong" aria-hidden="true" />
            {f.name}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit">{t("media.move")}</Button>
      </div>
    </form>
  );
}

/** M-04: undo toast — 5s window to restore the last move. */
/* --------------------------------------------------------- MediaPickerDialog */
export function MediaPickerDialog({ open, onClose, title, settings, uid, supabaseUrl, mode, kinds, onConfirm }: {
  open: boolean;
  onClose: () => void;
  title: string;
  settings: MediaSettings;
  uid: string;
  supabaseUrl: string;
  mode: "single" | "multi";
  kinds?: MediaKind[];
  onConfirm: (files: MediaFileRow[]) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="max-h-[70vh] overflow-y-auto p-1">
        <MediaLibraryCore
          settings={settings}
          uid={uid}
          supabaseUrl={supabaseUrl}
          select={{ mode, kinds }}
          onConfirm={(files) => { onConfirm(files); onClose(); }}
          onCancel={onClose}
        />
      </div>
    </Dialog>
  );
}
