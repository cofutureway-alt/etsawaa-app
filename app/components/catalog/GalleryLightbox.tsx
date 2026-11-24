import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useOverlay } from "~/components/ui/Overlay";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, RotateIcon, XIcon } from "~/components/ui/icons";
import { MediaImg, mediaUrl } from "./MediaImg";
import type { GalleryItem } from "./Gallery";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Full-screen product media viewer: big image, zoom/pan, swipe between items,
 * keyboard shortcuts and a thumbnail strip. Portal-rendered; body scroll is
 * locked and focus returns to the opener through useOverlay.
 */
export function GalleryLightbox({
  open,
  items,
  index,
  alt,
  label,
  onIndexChange,
  onClose,
}: {
  open: boolean;
  items: GalleryItem[];
  index: number;
  alt: string;
  /** what is being viewed — defaults to the product gallery wording */
  label?: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const containerRef = useOverlay(open, onClose);
  const heading = label ?? t("store.gallery.label");
  const [scale, setScale] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gestureStart = useRef<{ id: number; x: number; y: number; pointerType: string } | null>(null);
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const moved = useRef(false);

  const current = items[index];
  const isVideo = current?.kind === "video";

  const reset = useCallback(() => {
    setScale(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }, []);

  // a new item or a closed viewer always starts at 1×
  useEffect(() => { reset(); }, [index, open, reset]);

  /** How far the image content can pan at a given zoom, per axis. */
  const limits = useCallback((nextScale: number) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    const width = img.naturalWidth || rect.width;
    const height = img.naturalHeight || rect.height;
    const fit = Math.min(rect.width / width, rect.height / height);
    return {
      x: Math.max(0, (width * fit * nextScale - rect.width) / 2),
      y: Math.max(0, (height * fit * nextScale - rect.height) / 2),
    };
  }, []);

  const applyScale = useCallback((next: number) => {
    const value = clamp(next, MIN_ZOOM, MAX_ZOOM);
    setScale(value);
    setOffset((prev) => {
      if (value <= MIN_ZOOM) return { x: 0, y: 0 };
      const limit = limits(value);
      return { x: clamp(prev.x, -limit.x, limit.x), y: clamp(prev.y, -limit.y, limit.y) };
    });
  }, [limits]);

  // wheel zoom: non-passive listener so the page under the dialog cannot scroll
  useEffect(() => {
    if (!open || isVideo) return;
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyScale(scaleRef.current + (event.deltaY < 0 ? 0.25 : -0.25));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, isVideo, applyScale]);

  // ←/→ move, +/−/0 zoom (Escape is handled by useOverlay)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length);
        return;
      }
      if (isVideo) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        applyScale(scaleRef.current + 0.5);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        applyScale(scaleRef.current - 0.5);
      } else if (event.key === "0") {
        event.preventDefault();
        applyScale(MIN_ZOOM);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, index, items.length, onIndexChange, applyScale, isVideo]);

  const distance = () => {
    const values = [...pointers.current.values()];
    const first = values[0];
    const second = values[1];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isVideo) return;
    if (pointers.current.size === 0) {
      gestureStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType };
      moved.current = false;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 2) {
      pinchStart.current = { dist: distance(), scale };
      panStart.current = null;
    } else if (scale > MIN_ZOOM) {
      panStart.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchStart.current && pointers.current.size >= 2) {
      const ratio = distance() / (pinchStart.current.dist || 1);
      applyScale(pinchStart.current.scale * ratio);
      moved.current = true;
      return;
    }
    const start = panStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    const limit = limits(scale);
    setOffset({ x: clamp(start.ox + dx, -limit.x, limit.x), y: clamp(start.oy + dy, -limit.y, limit.y) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const start = gestureStart.current?.id === event.pointerId ? gestureStart.current : null;
    const dx = start ? event.clientX - start.x : 0;
    const dy = start ? event.clientY - start.y : 0;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved.current = true;

    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      panStart.current = null;
      gestureStart.current = null;
    }
    if (isVideo) return;

    // double-tap toggles zoom (double-click covers mouse users below)
    if (!moved.current && start?.pointerType !== "mouse") {
      const now = Date.now();
      const previous = lastTap.current;
      if (previous && now - previous.at < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 30) {
        applyScale(scale > MIN_ZOOM ? MIN_ZOOM : DOUBLE_TAP_ZOOM);
        lastTap.current = null;
        return;
      }
      lastTap.current = { at: now, x: event.clientX, y: event.clientY };
    }

    // at 1× a horizontal swipe changes image, following the reading direction
    if (scale <= MIN_ZOOM && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
      const rtl = containerRef.current ? getComputedStyle(containerRef.current).direction === "rtl" : false;
      const forward = rtl ? dx > 0 : dx < 0;
      onIndexChange((index + (forward ? 1 : -1) + items.length) % items.length);
    }
    moved.current = false;
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      panStart.current = null;
      gestureStart.current = null;
    }
  };

  if (!open || typeof document === "undefined" || !current) return null;

  const prev = () => onIndexChange((index - 1 + items.length) % items.length);
  const next = () => onIndexChange((index + 1) % items.length);

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `${alt} — ${heading}` : heading}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white outline-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2">
        {items.length > 1 ? (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold tabular-nums" dir="ltr">
            {index + 1} / {items.length}
          </span>
        ) : <span />}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("store.gallery.close")}
          className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
        >
          <XIcon aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={() => { if (!isVideo) applyScale(scale > MIN_ZOOM ? MIN_ZOOM : DOUBLE_TAP_ZOOM); }}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
      >
        {isVideo ? (
          <video
            key={current.path}
            src={mediaUrl(current.path)}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full bg-black object-contain"
          />
        ) : (
          <img
            ref={imgRef}
            key={current.path}
            src={mediaUrl(current.path)}
            alt={alt}
            width={1600}
            height={1600}
            draggable={false}
            className="absolute inset-0 m-auto size-full object-contain"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > MIN_ZOOM ? "grab" : "zoom-in",
            }}
          />
        )}

        {items.length > 1 ? (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label={t("store.gallery.prev")}
              className="absolute start-2 top-1/2 z-10 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
            >
              <ChevronLeftIcon aria-hidden="true" className="mirr size-5" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label={t("store.gallery.next")}
              className="absolute end-2 top-1/2 z-10 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
            >
              <ChevronRightIcon aria-hidden="true" className="mirr size-5" />
            </button>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-3 py-2">
        {!isVideo ? (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => applyScale(scale - 0.5)}
              aria-label={t("store.gallery.zoomOut")}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
            >
              <MinusIcon aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => applyScale(MIN_ZOOM)}
              aria-label={t("store.gallery.zoomReset")}
              className="num flex h-9 min-w-16 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-bold text-white transition-colors duration-150 hover:bg-white/20"
            >
              <RotateIcon aria-hidden="true" className="size-4" />
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => applyScale(scale + 0.5)}
              aria-label={t("store.gallery.zoomIn")}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
            >
              <PlusIcon aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null}

        {items.length > 1 ? (
          <ul className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((item, itemIndex) => (
              <li key={item.id} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => onIndexChange(itemIndex)}
                  aria-label={item.kind === "video" ? t("store.gallery.video") : t("store.gallery.thumb", { index: itemIndex + 1 })}
                  aria-current={itemIndex === index}
                  className={`block cursor-pointer overflow-hidden rounded-md border-2 transition-opacity duration-150 ${
                    itemIndex === index ? "border-white" : "border-transparent opacity-70 hover:opacity-100"
                  }`}
                >
                  {item.kind === "video" ? (
                    <span className="flex size-14 items-center justify-center bg-black text-white">
                      <PlayGlyph className="size-6" />
                    </span>
                  ) : (
                    <MediaImg path={item.path} alt="" width={56} height={56} className="size-14" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function PlayGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
