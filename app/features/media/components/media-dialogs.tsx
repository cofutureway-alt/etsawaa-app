/**
 * Media library dialogs: the rename / move forms and the shared dialog cluster
 * (mobile folder drawer, new-folder dialog, delete confirmation). The rename
 * and move <Dialog> wrappers stay in MediaLibraryCore because their submit
 * callbacks read the narrowed dialog state.
 *
 * Extracted from media-ui.tsx; private to the media feature (not re-exported
 * from the media-ui barrel).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog, Drawer } from "~/components/ui/Overlay";
import { FolderIcon } from "~/components/ui/icons";
import type { MediaFileRow, MediaFolderRow } from "../api";
import { DroppableFolder, FolderTreeView, buildTree } from "./media-folder-tree";

/* --------------------------------------------------------------- RenameDialog */
export function RenameDialog({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (name: string) => Promise<void>; onCancel: () => void }) {
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

/* ----------------------------------------------------------------- MoveDialog */
export function MoveDialog({ folders, currentFolderId, onSubmit, onCancel }: {
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
        <legend className="px-1 text-xs text-text-muted">{t("media.targetFolder")}</legend>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
          <input type="radio" name="target" checked={target === null} onChange={() => setTarget(null)} className="accent-[var(--color-action)]" />
          {t("media.allFiles")}
        </label>
        {folders.map((f) => (
          <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-bold text-text hover:bg-surface-tint" style={{ paddingInlineStart: `${(f.depth - 1) * 14 + 8}px` }}>
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

/* --------------------------------------------------------- MediaLibraryDialogs */
interface MediaLibraryDialogsProps {
  folders: MediaFolderRow[];
  drawerOpen: boolean;
  onDrawerClose: () => void;
  currentId: string | null;
  onNavigate: (id: string | null) => void;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  newFolderOpen: boolean;
  onNewFolderClose: () => void;
  newFolderName: string;
  onNewFolderNameChange: (value: string) => void;
  currentDepth: number;
  onSubmitNewFolder: () => void;
  deleting: MediaFileRow | null;
  onDeleteClose: () => void;
  onDeleteConfirm: (row: MediaFileRow) => void;
}

function DeleteConfirm({ row, onClose, onConfirm }: { row: MediaFileRow; onClose: () => void; onConfirm: (row: MediaFileRow) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text">{t("media.deleteConfirm", { name: row.original_name })}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" onClick={() => onConfirm(row)}>{t("common.confirm")}</Button>
      </div>
    </div>
  );
}

/** Mobile folder drawer (P2-7) + new-folder dialog + delete confirmation. */
export function MediaLibraryDialogs({ folders, drawerOpen, onDrawerClose, currentId, onNavigate, expanded, onToggleExpanded, newFolderOpen, onNewFolderClose, newFolderName, onNewFolderNameChange, currentDepth, onSubmitNewFolder, deleting, onDeleteClose, onDeleteConfirm }: MediaLibraryDialogsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* mobile folder drawer (P2-7): same tree, closes on selection */}
      <Drawer open={drawerOpen} onClose={onDrawerClose} title={t("media.folders")}>
        <div className="p-2.5">
          <DroppableFolder id="drawer-root">
            <button
              type="button"
              onClick={() => { onNavigate(null); onDrawerClose(); }}
              aria-current={currentId === null}
              className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-2 text-sm font-bold transition-colors duration-150 hover:bg-surface-tint ${currentId === null ? "bg-surface-tint text-action" : "text-text"}`}
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
        </div>
      </Drawer>

      <Dialog open={newFolderOpen} onClose={onNewFolderClose} title={t("media.newFolder")}>
        <form onSubmit={(e) => { e.preventDefault(); void onSubmitNewFolder(); }} className="flex flex-col gap-3">
          <Input label={t("media.folderName")} value={newFolderName} onChange={(e) => onNewFolderNameChange(e.target.value)} required maxLength={80} inputClassName="bg-surface" />
          <p className="text-xs text-text-muted">{t("media.depthNote", { depth: currentDepth + 1 })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onNewFolderClose}>{t("common.cancel")}</Button>
            <Button type="submit">{t("common.confirm")}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={onDeleteClose} title={t("common.confirm")}>
        {deleting ? <DeleteConfirm row={deleting} onClose={onDeleteClose} onConfirm={onDeleteConfirm} /> : null}
      </Dialog>
    </>
  );
}
