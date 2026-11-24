/**
 * Media library content area: loading skeleton, load-error state, sub-folder
 * tiles, empty state and the draggable/selectable file grid.
 *
 * Extracted from media-ui.tsx; private to the media feature (not re-exported
 * from the media-ui barrel).
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { Button } from "~/components/ui/Button";
import {
  CheckIcon, PencilIcon, MoveIcon, CopyIcon, TrashIcon,
  VideoIcon, FileIcon, UploadIcon, FolderIcon,
} from "~/components/ui/icons";
import type { MediaKind } from "~/lib/media.shared";
import { publicMediaUrl } from "~/lib/media.shared";
import type { MediaFileRow, MediaFolderRow } from "../api";
import { MediaImage } from "./MediaImage";
import { DroppableFolder } from "./media-folder-tree";

/* ----------------------------------------------------------------- file bits */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 102.4)) / 10} MB`;
}

function kindIcon(kind: MediaKind) {
  return kind === "video" ? <VideoIcon className="size-5" /> : <FileIcon className="size-5" />;
}

/** Drag handle wrapper: the whole tile starts a dnd-kit file drag. */
function DraggableFile({ file, children, disabled = false }: { file: MediaFileRow; children: ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `file:${file.id}`, disabled });
  // picker mode: no dragging, so a finger on a tile still scrolls the grid
  if (disabled) return <div>{children}</div>;
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`touch-none ${isDragging ? "opacity-40" : ""}`}>
      {children}
    </div>
  );
}

/** Small square icon button (tile manage-mode actions); stops tile click bubbling. */
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

/* --------------------------------------------------------------- MediaFileTile */
interface MediaFileTileProps {
  file: MediaFileRow;
  checked: boolean;
  select?: { mode: "single" | "multi"; kinds?: MediaKind[] };
  supabaseUrl: string;
  onPickSingle: (file: MediaFileRow) => void;
  onToggleSelect: (row: MediaFileRow) => void;
  onRename: (row: MediaFileRow) => void;
  onMove: (row: MediaFileRow) => void;
  onCopyLink: (row: MediaFileRow) => void;
  onDelete: (row: MediaFileRow) => void;
}

function MediaFileTile({ file, checked, select, supabaseUrl, onPickSingle, onToggleSelect, onRename, onMove, onCopyLink, onDelete }: MediaFileTileProps) {
  const { t } = useTranslation();
  const kindMatch = !select?.kinds || select.kinds.includes(file.kind);
  return (
    <DraggableFile file={file} disabled={Boolean(select)}>
      <div
        className={`group relative flex flex-col overflow-hidden rounded-md border bg-surface transition-colors duration-150 ${checked ? "border-action" : "border-border"} ${kindMatch ? "cursor-pointer hover:bg-surface-tint" : "opacity-50"}`}
        onClick={() => {
          if (!kindMatch) return;
          if (!select) return;
          // single and multi alike: a tap marks the file, "Use selected" confirms
          if (select.mode === "single") { onPickSingle(file); return; }
          onToggleSelect(file);
        }}
      >
        <div className="flex aspect-square items-center justify-center bg-surface-tint sm:aspect-auto sm:h-24">
          {file.kind === "image" ? (
            <MediaImage path={file.path} alt={file.original_name} supabaseUrl={supabaseUrl} className="size-full object-cover sm:h-24" width={240} height={192} />
          ) : file.kind === "video" ? (
            <span className="relative block size-full bg-ink">
              <video src={publicMediaUrl(supabaseUrl, file.path)} muted playsInline preload="metadata" aria-label={file.original_name} className="size-full object-cover" />
              <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                <span className="grid size-8 place-items-center rounded-full bg-ink/70 text-white"><VideoIcon className="size-4" /></span>
              </span>
            </span>
          ) : (
            kindIcon(file.kind)
          )}
        </div>
        <div className="min-w-0 px-2 py-1.5">
          <p className="truncate text-xs font-bold text-text">{file.original_name}</p>
          <p className="text-2xs text-text-muted">{formatBytes(file.size_bytes)}</p>
        </div>
        {checked ? <span aria-hidden="true" className="absolute end-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-action text-on-action shadow-1"><CheckIcon className="size-3.5" /></span> : null}
        {checked ? <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-inset ring-action" /> : null}
        {!select ? (
          <div className="absolute end-1.5 top-1.5 flex gap-1 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
            <IconBtn label={t("media.rename")} onClick={() => onRename(file)}><PencilIcon className="size-3.5" /></IconBtn>
            <IconBtn label={t("media.moveTo")} onClick={() => onMove(file)}><MoveIcon className="size-3.5" /></IconBtn>
            <IconBtn label={t("media.copyLink")} onClick={() => onCopyLink(file)}><CopyIcon className="size-3.5" /></IconBtn>
            <IconBtn label={t("common.delete")} onClick={() => onDelete(file)}><TrashIcon className="size-3.5" /></IconBtn>
          </div>
        ) : null}
      </div>
    </DraggableFile>
  );
}

/* ---------------------------------------------------------------- MediaContent */
interface MediaContentProps {
  loading: boolean;
  loadError: boolean;
  childFolders: MediaFolderRow[];
  files: MediaFileRow[];
  select?: { mode: "single" | "multi"; kinds?: MediaKind[] };
  selectedRows: Map<string, MediaFileRow>;
  supabaseUrl: string;
  onNavigate: (id: string) => void;
  onUpload: () => void;
  onNewFolder: () => void;
  onPickSingle: (file: MediaFileRow) => void;
  onToggleSelect: (row: MediaFileRow) => void;
  onRename: (row: MediaFileRow) => void;
  onMove: (row: MediaFileRow) => void;
  onCopyLink: (row: MediaFileRow) => void;
  onDelete: (row: MediaFileRow) => void;
}

/** Everything rendered inside the dropzone below the upload progress list. */
export function MediaContent({ loading, loadError, childFolders, files, select, selectedRows, supabaseUrl, onNavigate, onUpload, onNewFolder, onPickSingle, onToggleSelect, onRename, onMove, onCopyLink, onDelete }: MediaContentProps) {
  const { t } = useTranslation();
  return (
    <>
      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-5" aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-md bg-surface-tint" />
          ))}
        </div>
      ) : loadError ? (
        <p className="py-10 text-center text-sm font-bold text-text-muted">{t("errors.dataUnavailable")}</p>
      ) : (
        <>
          {/* sub-folders */}
          {childFolders.length > 0 ? (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {childFolders.map((f) => (
                <DroppableFolder key={f.id} id={`folder:${f.id}`}>
                  <button
                    type="button"
                    onClick={() => onNavigate(f.id)}
                    className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-3.5 transition-colors duration-150 hover:bg-surface-tint"
                  >
                    <FolderIcon className="size-8 text-warning-strong" />
                    <span className="w-full truncate text-center text-xs font-bold text-text">{f.name}</span>
                  </button>
                </DroppableFolder>
              ))}
            </div>
          ) : null}

          {files.length === 0 && childFolders.length === 0 ? (
            <div className="py-14 text-center">
              <UploadIcon className="mx-auto size-10 text-text-faint" aria-hidden="true" />
              <p className="mt-2 text-sm font-extrabold text-text">{t("media.emptyTitle")}</p>
              <p className="mt-1 text-sm text-text-muted">{t("media.emptyBody")}</p>
              <div className="mt-3 flex justify-center gap-2">
                <Button type="button" size="sm" onClick={onUpload}>{t("media.upload")}</Button>
                <Button type="button" size="sm" variant="outline" onClick={onNewFolder}>{t("media.newFolder")}</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-5">
              {files.map((f) => (
                <MediaFileTile
                  key={f.id}
                  file={f}
                  checked={selectedRows.has(f.id)}
                  select={select}
                  supabaseUrl={supabaseUrl}
                  onPickSingle={onPickSingle}
                  onToggleSelect={onToggleSelect}
                  onRename={onRename}
                  onMove={onMove}
                  onCopyLink={onCopyLink}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
