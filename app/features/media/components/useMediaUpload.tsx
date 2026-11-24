/**
 * Media upload queue: hook owning the per-file upload state machine
 * (validate → queue → progress → done/error) plus the progress list UI
 * rendered inside the library dropzone.
 *
 * Extracted from media-ui.tsx; private to the media feature (not re-exported
 * from the media-ui barrel).
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "~/components/ui/icons";
import { mediaErrorText, validateUpload, validateImageDimensions, type MediaSettings } from "~/lib/media.shared";
import { uploadFile, type MediaFileRow } from "../api";

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  errorKey?: string;
  row?: MediaFileRow;
  signal: { aborted: boolean; abort?: () => void };
}

export interface UseMediaUploadOptions {
  settings: MediaSettings;
  currentId: string | null;
  bucket: "media" | "documents";
  refresh: () => Promise<void>;
}

/**
 * Upload queue state. `setUploads` is exposed because the retry action in the
 * progress list removes the failed item before re-queueing it.
 */
export function useMediaUpload({ settings, currentId, bucket, refresh }: UseMediaUploadOptions) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const doUpload = useCallback(
    async (items: File[]) => {
      // Dimension limit was stored in settings but never checked; validate it
      // here (async, before queueing) so oversized bitmaps are rejected early.
      const dims = await Promise.all(
        items.map((file) => validateImageDimensions(file, settings.max_dimensions_px)),
      );
      const queue: UploadItem[] = items.map((file, idx) => {
        const errorKey =
          validateUpload({ type: file.type, size: file.size, name: file.name }, settings) ?? dims[idx] ?? null;
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
          const row = await uploadFile(item.file, currentId, bucket, (pct) => {
            setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, progress: pct } : u)));
          }, item.signal);
          setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, status: "done", progress: 100, row } : u)));
          // Refresh in place. Bumping `page` to 0 was a no-op whenever the
          // picker was already on page 0 — the refresh key never changed, so
          // the new file only appeared after closing and reopening the dialog.
          await refresh();
        } catch (error) {
          const msg = error instanceof Error ? error.message : "error";
          const key = msg === "cancelled" ? "media.errors.cancelled"
            : msg === "infected" ? "media.errors.infected"
            : msg === "scan_unavailable" ? "media.errors.scanUnavailable"
            : msg === "bad_image" ? "media.errors.badImage"
            : msg.startsWith("media.errors.") ? msg
            : msg.startsWith("upload_4") ? "media.errors.mime" : "media.errors.failed";
          setUploads((cur) => cur.map((u) => (u.id === item.id ? { ...u, status: "error", errorKey: key } : u)));
        }
      }
    },
    // refresh() closes over the current folder tree, search and page, so the
    // reload after an upload lands on the listing the user is looking at.
    [settings, bucket, currentId, refresh],
  );

  return { uploads, setUploads, doUpload };
}

/* ---------------------------------------------------------------- UploadsPanel */
interface UploadsPanelProps {
  uploads: UploadItem[];
  onCancel: (item: UploadItem) => void;
  onRetry: (item: UploadItem) => void;
}

/** Upload progress list shown inside the dropzone; renders nothing when empty. */
export function UploadsPanel({ uploads, onCancel, onRetry }: UploadsPanelProps) {
  const { t } = useTranslation();
  if (uploads.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-col gap-1.5" aria-label={t("media.uploads")}>
      {uploads.map((u) => (
        <li key={u.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate font-bold text-text">{u.name}</span>
          {u.status === "uploading" ? (
            <>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-tint" role="progressbar" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100}>
                <span className="block h-full bg-action" style={{ width: `${u.progress}%` }} />
              </span>
              <button type="button" onClick={() => onCancel(u)} aria-label={t("media.cancel")} className="cursor-pointer text-text-muted hover:text-danger">
                <XIcon className="size-4" />
              </button>
            </>
          ) : u.status === "done" ? (
            <span className="font-bold text-success-strong">{t("media.done")}</span>
          ) : u.status === "error" ? (
            <>
              <span className="font-bold text-danger">{t(...mediaErrorText(u.errorKey ?? "media.errors.failed"))}</span>
              <button type="button" onClick={() => onRetry(u)} className="cursor-pointer font-bold text-action hover:underline">
                {t("media.retry")}
              </button>
            </>
          ) : (
            <span className="text-text-muted">{t("media.queued")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
