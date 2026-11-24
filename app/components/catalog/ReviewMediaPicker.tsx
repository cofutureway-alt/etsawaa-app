import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GalleryLightbox } from "./GalleryLightbox";
import { MediaImg } from "./MediaImg";
import { REVIEW_MEDIA_MAX, REVIEW_VIDEO_MAX, type ReviewMediaItem, type ReviewMediaKind } from "~/lib/review-media";
import type { GalleryItem } from "./Gallery";

/**
 * Buyer review attachments: up to 5 files (at most 2 videos), uploaded one by
 * one through /api/upload?op=reviewMedia and stored under the caller's own
 * u/<uid>/ prefix. The hidden field carries the resulting {kind, path} list.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime";
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-current">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function errorKey(reason: string | undefined): string {
  if (reason === "video_off") return "reviewMedia.videoOff";
  if (reason === "too_large") return "reviewMedia.tooLarge";
  if (reason === "invalid_file" || reason === "bad_mime") return "reviewMedia.invalid";
  if (reason === "infected") return "reviewMedia.infected";
  return "reviewMedia.uploadFailed";
}

export function ReviewMediaPicker({ value, onChange, name = "media", disabled = false }: {
  value: ReviewMediaItem[];
  onChange: (next: ReviewMediaItem[]) => void;
  /** hidden form field carrying the JSON list */
  name?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => { setError(null); input.current?.click(); };

  const uploadOne = async (file: File): Promise<{ ok: boolean; path?: string; kind?: ReviewMediaKind; reason?: string }> => {
    const body = new FormData();
    body.set("op", "reviewMedia");
    body.set("file", file);
    const res = await fetch("/api/upload", { method: "POST", body });
    return (await res.json()) as { ok: boolean; path?: string; kind?: ReviewMediaKind; reason?: string };
  };

  const onFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (value.length + files.length > REVIEW_MEDIA_MAX) {
      setError(t("reviewMedia.tooMany"));
      return;
    }
    const videos = files.filter((f) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name)).length;
    if (value.filter((v) => v.kind === "video").length + videos > REVIEW_VIDEO_MAX) {
      setError(t("reviewMedia.tooManyVideos"));
      return;
    }
    setError(null);
    setUploading(true);
    let next = [...value];
    try {
      for (const file of files) {
        try {
          const res = await uploadOne(file);
          if (!res.ok || !res.path || !res.kind) {
            setError(t(errorKey(res.reason)));
            continue;
          }
          next = [...next, { kind: res.kind, path: res.path }];
        } catch {
          setError(t("reviewMedia.uploadFailed"));
        }
      }
    } finally {
      onChange(next);
      setUploading(false);
    }
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-2">
      {name ? <input type="hidden" name={name} value={JSON.stringify(value)} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || uploading || value.length >= REVIEW_MEDIA_MAX}
          onClick={pick}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-action px-3 text-sm font-bold text-action hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          {uploading ? t("reviewMedia.uploading") : t("reviewMedia.add")}
        </button>
        <span className="text-2xs text-text-muted">{t("reviewMedia.hint")}</span>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => { void onFiles(event.target.files); event.target.value = ""; }}
      />

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <li key={`${item.path}-${index}`} className="relative size-16 overflow-hidden rounded-md border border-border bg-surface-tint">
              {item.kind === "video" ? (
                <span className="flex size-full items-center justify-center bg-ink text-white" aria-hidden="true"><PlayGlyph /></span>
              ) : (
                <MediaImg path={item.path} alt="" width={64} height={64} className="size-full object-cover" />
              )}
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => remove(index)}
                aria-label={t("common.remove")}
                className="absolute end-0.5 top-0.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-danger text-xs font-black text-white shadow-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="text-xs font-bold text-danger">{error}</p> : null}
    </div>
  );
}

/** Read-only thumbnails; a click opens the full-screen gallery on that review. */
export function ReviewMediaThumbs({ media, alt = "" }: { media: ReviewMediaItem[]; alt?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  if (media.length === 0) return null;
  const items: GalleryItem[] = media.map((m, i) => ({ id: `${i}-${m.path}`, path: m.path, kind: m.kind }));
  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2">
        {media.map((item, i) => (
          <li key={`${item.path}-${i}`}>
            <button
              type="button"
              onClick={() => setIndex(i)}
              className="relative flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint transition-colors hover:border-action"
              aria-label={alt ? `${alt} ${i + 1}` : `${i + 1}`}
            >
              {item.kind === "video" ? (
                <span className="flex size-full items-center justify-center bg-ink text-white"><PlayGlyph /></span>
              ) : (
                <MediaImg path={item.path} alt="" width={64} height={64} className="size-full object-cover" />
              )}
            </button>
          </li>
        ))}
      </ul>
      <GalleryLightbox
        open={index !== null}
        items={items}
        index={index ?? 0}
        alt={alt}
        onIndexChange={setIndex}
        onClose={() => setIndex(null)}
      />
    </>
  );
}
