import { useTranslation } from "react-i18next";
import { MediaImg } from "./MediaImg";

/**
 * Product gallery (S-05 / US-05): main image + thumbnails; the parent swaps
 * the image when a variant with its own image is selected (falls back to the
 * product main image when a variant has none).
 */
export function Gallery({
  images,
  selectedPath,
  alt,
  eager = false,
  onSelect,
}: {
  images: Array<{ id: string; path: string }>;
  /** current main image (variant image or product main) */
  selectedPath: string | null;
  alt: string;
  eager?: boolean;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-l border border-border bg-surface-tint">
        <span className="text-sm font-bold text-text-faint">{t("store.noImage")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-l border border-border bg-surface">
        <MediaImg
          key={selectedPath ?? images[0]?.path ?? "none"}
          path={selectedPath ?? images[0]?.path ?? ""}
          alt={alt}
          width={800}
          height={800}
          eager={eager}
          sizes="(min-width: 1100px) 560px, 100vw"
          className="aspect-square w-full"
        />
      </div>
      {images.length > 1 ? (
        <ul className="flex flex-wrap gap-2" role="listbox" aria-label={t("store.gallery.label")}>
          {images.map((img) => {
            const active = (selectedPath ?? images[0]?.path) === img.path;
            return (
              <li key={img.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={t("store.gallery.thumb", { index: images.indexOf(img) + 1 })}
                  onClick={() => onSelect(img.path)}
                  className={`block cursor-pointer overflow-hidden rounded-m border-2 transition-colors duration-150 ${
                    active ? "border-action" : "border-border hover:border-border-strong"
                  }`}
                >
                  <MediaImg path={img.path} alt="" width={64} height={64} className="size-16" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
