import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "~/components/ui/icons";
import { MediaImg, mediaUrl } from "./MediaImg";
import { GalleryLightbox } from "./GalleryLightbox";

export type GalleryItem = { id: string; path: string; kind?: "image" | "video" };

/**
 * Product gallery (S-05 / US-05): images + videos, swipe, arrows, keyboard and
 * full-screen lightbox. The parent swaps the selected image when a colour is
 * picked; every move goes back through onSelect(path) so it stays controlled.
 */
export function Gallery({
  images,
  selectedPath,
  alt,
  eager = false,
  onSelect,
}: {
  images: GalleryItem[];
  /** current main item (variant image or product main) */
  selectedPath: string | null;
  alt: string;
  eager?: boolean;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const activeIndex = Math.max(0, images.findIndex((img) => img.path === selectedPath));
  const current = images[activeIndex];
  const thumbsRef = useRef<HTMLUListElement>(null);
  const dragStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);

  const selectIndex = useCallback(
    (next: number) => {
      if (images.length === 0) return;
      const item = images[(next + images.length) % images.length];
      if (item) onSelect(item.path);
    },
    [images, onSelect],
  );

  // keep the active thumbnail visible inside the single scrollable row
  useEffect(() => {
    const el = thumbsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [activeIndex]);

  if (images.length === 0 || !current) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-border bg-surface-tint">
        <span className="text-sm font-bold text-text-faint">{t("store.noImage")}</span>
      </div>
    );
  }

  const swipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // ignore mostly-vertical drags so the page keeps scrolling
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    suppressClick.current = true;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    // reading direction: RTL swiping right advances, LTR swiping left advances
    selectIndex(activeIndex + (rtl ? (dx > 0 ? 1 : -1) : dx < 0 ? 1 : -1));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectIndex(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectIndex(activeIndex - 1);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-roledescription="gallery"
        aria-label={t("store.gallery.label")}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          dragStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
          suppressClick.current = false;
        }}
        onPointerUp={swipe}
        onPointerCancel={() => { dragStart.current = null; }}
        className="relative overflow-hidden rounded-lg border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        {current.kind === "video" ? (
          <video
            key={current.path}
            src={mediaUrl(current.path)}
            controls
            playsInline
            preload="metadata"
            className="aspect-square w-full bg-black"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setLightboxOpen(true);
            }}
            aria-label={t("store.gallery.zoom")}
            className="block w-full cursor-zoom-in"
          >
            <MediaImg
              key={current.path}
              path={current.path}
              alt={alt}
              width={800}
              height={800}
              eager={eager && activeIndex === 0}
              sizes="(min-width: 1100px) 560px, 100vw"
              className="aspect-square w-full"
            />
          </button>
        )}

        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => selectIndex(activeIndex - 1)}
              aria-label={t("store.gallery.prev")}
              className="absolute start-2 top-1/2 z-10 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-text shadow-1 transition-colors duration-150 hover:text-action"
            >
              <ChevronLeftIcon aria-hidden="true" className="mirr size-4" />
            </button>
            <button
              type="button"
              onClick={() => selectIndex(activeIndex + 1)}
              aria-label={t("store.gallery.next")}
              className="absolute end-2 top-1/2 z-10 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-text shadow-1 transition-colors duration-150 hover:text-action"
            >
              <ChevronRightIcon aria-hidden="true" className="mirr size-4" />
            </button>
            <span
              className="absolute bottom-2 start-2 z-10 rounded-full bg-black/60 tabular-nums px-2 py-0.5 text-2xs font-bold text-white"
              dir="ltr"
              aria-label={t("store.gallery.counter", { index: activeIndex + 1, total: images.length })}
            >
              {activeIndex + 1} / {images.length}
            </span>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          aria-label={t("store.gallery.zoom")}
          title={t("store.gallery.zoom")}
          className="absolute bottom-2 end-2 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-text shadow-1 transition-colors duration-150 hover:text-action"
        >
          <SearchIcon aria-hidden="true" className="size-4" />
        </button>
      </div>

      {images.length > 1 ? (
        <ul
          ref={thumbsRef}
          role="listbox"
          aria-label={t("store.gallery.label")}
          className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((img, index) => {
            const active = index === activeIndex;
            return (
              <li key={img.id} className="shrink-0 snap-start">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={img.kind === "video" ? t("store.gallery.video") : t("store.gallery.thumb", { index: index + 1 })}
                  onClick={() => onSelect(img.path)}
                  className={`block cursor-pointer overflow-hidden rounded-md border-2 transition-colors duration-150 ${
                    active ? "border-action" : "border-border hover:border-border-strong"
                  }`}
                >
                  {img.kind === "video" ? (
                    <span className="flex size-16 items-center justify-center bg-black text-white">
                      <PlayGlyph className="size-6" />
                    </span>
                  ) : (
                    <MediaImg path={img.path} alt="" width={64} height={64} className="size-16" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <GalleryLightbox
        open={lightboxOpen}
        items={images}
        index={activeIndex}
        alt={alt}
        onIndexChange={selectIndex}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

function PlayGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
