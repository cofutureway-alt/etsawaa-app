/**
 * Small shared UI bits of the media library: the toolbar (folder breadcrumbs,
 * search, upload) and the server-side pagination bar.
 *
 * Extracted from media-ui.tsx; private to the media feature (not re-exported
 * from the media-ui barrel).
 */
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { ChevronRightIcon, ChevronLeftIcon, FolderIcon, SearchIcon, UploadIcon } from "~/components/ui/icons";
import { MEDIA_PAGE_SIZE, type MediaFolderRow } from "../api";

/* ---------------------------------------------------------------- MediaToolbar */
interface MediaToolbarProps {
  crumbs: MediaFolderRow[];
  onNavigate: (id: string | null) => void;
  onOpenFolders: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onUpload: () => void;
}

/** Breadcrumbs + mobile folders button + search + upload, above the grid. */
export function MediaToolbar({ crumbs, onNavigate, onOpenFolders, search, onSearchChange, onUpload }: MediaToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <nav aria-label={t("media.folders")} className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => onNavigate(null)} className="cursor-pointer font-bold text-text hover:text-action">
          {t("media.allFiles")}
        </button>
        {crumbs.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRightIcon className="size-3.5 text-text-muted mirr" aria-hidden="true" />
            <button type="button" onClick={() => onNavigate(c.id)} className="cursor-pointer font-bold text-text hover:text-action">
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="flex w-full items-center gap-2 sm:ms-auto sm:w-auto">
        <button
          type="button"
          onClick={onOpenFolders}
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 text-sm font-bold text-text transition-colors duration-150 hover:bg-surface-tint lg:hidden"
        >
          <FolderIcon className="size-4" aria-hidden="true" />
          {t("media.folders")}
        </button>
        <label className="relative min-w-0 flex-1 sm:flex-none">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("media.search")}
            aria-label={t("media.search")}
            className="w-full rounded-md border border-border bg-surface py-2 pe-2.5 ps-8 text-sm text-text placeholder:text-text-faint focus:border-action focus:outline-none sm:w-44"
          />
        </label>
        <Button type="button" size="sm" onClick={onUpload}>
          <UploadIcon className="size-4" aria-hidden="true" />
          {t("media.upload")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- MediaPagination */
interface MediaPaginationProps {
  count: number;
  page: number;
  onPrev: () => void;
  onNext: () => void;
}

/** Pagination — 20 per page, server-side. */
export function MediaPagination({ count, page, onPrev, onNext }: MediaPaginationProps) {
  const { t } = useTranslation();
  if (count <= MEDIA_PAGE_SIZE) return null;
  return (
    <nav aria-label={t("media.pagination")} className="mt-3 flex items-center justify-center gap-3 text-sm font-bold text-text">
      <button
        type="button"
        onClick={onPrev}
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
        onClick={onNext}
        disabled={(page + 1) * MEDIA_PAGE_SIZE >= count}
        aria-label={t("media.next")}
        className="flex cursor-pointer items-center rounded-md border border-border bg-surface px-3 py-1.5 transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
      </button>
    </nav>
  );
}
