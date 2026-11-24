/**
 * Media folder-tree primitives: pure tree helpers plus the droppable tree used
 * by the desktop aside and (via MediaLibraryDialogs) the mobile drawer.
 *
 * Extracted from media-ui.tsx; private to the media feature (not re-exported
 * from the media-ui barrel).
 */
import { useTranslation } from "react-i18next";
import { useDroppable } from "@dnd-kit/core";
import { ChevronRightIcon, FolderIcon, FolderPlusIcon } from "~/components/ui/icons";
import type { MediaFolderRow } from "../api";
import type { ReactNode } from "react";

/* -------------------------------------------------------------- folder helpers */
interface FolderNode extends MediaFolderRow {
  children: FolderNode[];
}

export function buildTree(folders: MediaFolderRow[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  for (const f of byId.values()) {
    if (f.parent_id && byId.has(f.parent_id)) byId.get(f.parent_id)!.children.push(f);
    else roots.push(f);
  }
  return roots;
}

export function descendantIds(folders: MediaFolderRow[], rootId: string): Set<string> {
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

export function breadcrumbPath(folders: MediaFolderRow[], currentId: string | null): MediaFolderRow[] {
  const path: MediaFolderRow[] = [];
  let cur = folders.find((f) => f.id === currentId) ?? null;
  while (cur) {
    path.unshift(cur);
    cur = folders.find((f) => f.id === cur!.parent_id) ?? null;
  }
  return path;
}

/* --------------------------------------------------------------- drag helpers */
/** Drop target for files being moved into a folder (also "folder-root"/"drawer-root"). */
export function DroppableFolder({ id, children }: { id: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={isOver ? "ring-2 ring-action rounded-md bg-surface-tint" : ""}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- FolderTreeView */
interface FolderTreeViewProps {
  nodes: FolderNode[];
  currentId: string | null;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onNavigate: (id: string) => void;
  level: number;
}

/** Recursive folder tree (was the inline `renderTree` of MediaLibraryCore). */
export function FolderTreeView({ nodes, currentId, expanded, onToggleExpanded, onNavigate, level }: FolderTreeViewProps) {
  return (
    <ul className={level === 0 ? "" : "ms-3 border-s border-border ps-2"}>
      {nodes.map((node) => (
        <li key={node.id}>
          <DroppableFolder id={`folder:${node.id}`}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={expanded.has(node.id)}
                onClick={() => onToggleExpanded(node.id)}
                className={`flex size-5 cursor-pointer items-center justify-center text-text-muted transition-transform ${node.children.length === 0 ? "invisible" : ""} ${expanded.has(node.id) ? "rotate-90" : ""} ltr:rotate-0`}
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate(node.id)}
                aria-current={currentId === node.id}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm font-bold transition-colors duration-150 hover:bg-surface-tint ${currentId === node.id ? "bg-surface-tint text-action" : "text-text"}`}
              >
                <FolderIcon className="size-4 shrink-0 text-warning-strong" />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
          </DroppableFolder>
          {expanded.has(node.id) ? (
            <FolderTreeView
              nodes={node.children}
              currentId={currentId}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              onNavigate={onNavigate}
              level={level + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------- FolderAside */
interface FolderAsideProps {
  folders: MediaFolderRow[];
  currentId: string | null;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onNavigate: (id: string | null) => void;
  onNewFolder: () => void;
  currentDepth: number;
}

/** Desktop folder sidebar (hidden below lg; mobile uses the drawer instead). */
export function FolderAside({ folders, currentId, expanded, onToggleExpanded, onNavigate, onNewFolder, currentDepth }: FolderAsideProps) {
  const { t } = useTranslation();
  return (
    <aside className="hidden rounded-lg border border-border bg-surface p-2.5 lg:block" aria-label={t("media.folders")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-extrabold text-text">{t("media.folders")}</span>
        <button
          type="button"
          onClick={onNewFolder}
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
          onClick={() => onNavigate(null)}
          aria-current={currentId === null}
          className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm font-bold transition-colors duration-150 hover:bg-surface-tint ${currentId === null ? "bg-surface-tint text-action" : "text-text"}`}
        >
          <FolderIcon className="size-4 text-warning-strong" />
          {t("media.allFiles")}
        </button>
      </DroppableFolder>
      <FolderTreeView
        nodes={buildTree(folders)}
        currentId={currentId}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        onNavigate={onNavigate}
        level={0}
      />
      {folders.length === 0 ? <p className="px-1.5 py-2 text-xs text-text-muted">{t("media.noFolders")}</p> : null}
    </aside>
  );
}
