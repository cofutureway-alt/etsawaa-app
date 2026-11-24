import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

/**
 * Horizontal carousel: native scroll-snap (swipe on touch, wheel/trackpad on
 * desktop) plus previous/next buttons that page by the visible width. Works
 * in RTL (the buttons follow reading direction). No dependency, no layout
 * shift: items size themselves with the `itemClassName` widths.
 *
 *   <Carousel itemClassName="w-40 sm:w-48">{cards}</Carousel>
 */
export function Carousel({ children, itemClassName = "w-44 sm:w-52", label, gapClassName = "gap-3", autoplay }: {
  children: ReactNode;
  /** width classes applied to every slide */
  itemClassName?: string;
  label?: string;
  gapClassName?: string;
  /** auto-advance one page every N ms; absent = manual only */
  autoplay?: number;
}) {
  const { t } = useTranslation();
  const region = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // scrollLeft is 0…max in LTR and 0…-max in RTL — compare magnitudes
    const pos = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: pos <= 2, end: pos >= max - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = useCallback((forward: boolean) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    // page by the number of WHOLE items in view: brand rows that fit an exact
    // count move a full row, fixed-width rows never skip a half-visible card
    const [a, b] = [el.children[0], el.children[1]] as (HTMLElement | undefined)[];
    const stride = a && b ? Math.abs(b.offsetLeft - a.offsetLeft) : 0;
    const whole = stride > 0 ? Math.max(1, Math.floor((el.clientWidth + (stride - (a?.offsetWidth ?? 0))) / stride + 0.05)) * stride : el.clientWidth * 0.85;
    const step = whole * (forward ? 1 : -1) * (rtl ? -1 : 1);
    el.scrollBy({ left: step, behavior: "smooth" });
  }, []);

  // Auto-advance: pauses on hover, focus, drag (resumes 6 s later), when the
  // tab is hidden, when the carousel is off screen, and for reduced motion.
  // Only touches window/document inside this effect (SSR-safe).
  useEffect(() => {
    if (!autoplay) return;
    const el = track.current;
    const box = region.current;
    if (!el || !box) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;
    let hovered = false;
    let focused = false;
    let dragging = false;
    let onScreen = false;
    let hidden = document.hidden;
    let resumeAt = 0; // drag release must not be undone by the trailing pointerleave

    const holds = () => reduced.matches || hovered || focused || dragging || hidden || !onScreen;
    const stop = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    const schedule = (delay: number) => {
      stop();
      if (holds()) return;
      timer = window.setTimeout(advance, Math.max(delay, resumeAt - Date.now()));
    };
    const advance = () => {
      timer = 0;
      resumeAt = 0;
      if (holds()) return;
      // nothing overflows → nothing to move, but keep polling for a later resize
      if (el.scrollWidth - el.clientWidth <= 2) return schedule(autoplay);
      const atEnd = Math.abs(el.scrollLeft) >= el.scrollWidth - el.clientWidth - 2;
      if (atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
      else page(true);
      schedule(autoplay);
    };

    const onEnter = () => { hovered = true; stop(); };
    const onLeave = () => { hovered = false; schedule(autoplay); };
    const onFocusIn = () => { focused = true; stop(); };
    const onFocusOut = (event: FocusEvent) => {
      focused = box.contains(event.relatedTarget as Node | null);
      if (!focused) schedule(autoplay);
    };
    const onDown = () => { dragging = true; stop(); };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      resumeAt = Date.now() + 6000; // let the swipe settle before the next auto page
      schedule(0);
    };
    const onVisibility = () => { hidden = document.hidden; schedule(autoplay); };
    const onMotion = () => { if (reduced.matches) stop(); else schedule(autoplay); };

    box.addEventListener("pointerenter", onEnter);
    box.addEventListener("pointerleave", onLeave);
    box.addEventListener("focusin", onFocusIn);
    box.addEventListener("focusout", onFocusOut);
    box.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotion);

    // Play only while ~30% of the track is in view
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      if (onScreen) schedule(autoplay);
      else stop();
    }, { threshold: 0.3 });
    io.observe(el);

    return () => {
      stop();
      io.disconnect();
      box.removeEventListener("pointerenter", onEnter);
      box.removeEventListener("pointerleave", onLeave);
      box.removeEventListener("focusin", onFocusIn);
      box.removeEventListener("focusout", onFocusOut);
      box.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotion);
    };
  }, [autoplay, page]);

  // phones: small button inset inside the edges so it is never clipped;
  // md+: the original larger button, half outside the track.
  const button = (forward: boolean) => {
    const hidden = forward ? edges.end : edges.start;
    return (
      <button
        type="button"
        onClick={() => page(forward)}
        aria-label={forward ? t("common.next") : t("common.back")}
        tabIndex={hidden ? -1 : 0}
        className={`absolute top-1/2 z-10 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-surface/90 text-text shadow-2 transition-opacity duration-150 hover:text-action md:size-10 md:bg-surface ${
          forward ? "end-1 md:end-0 md:translate-x-1/2 md:rtl:-translate-x-1/2" : "start-1 md:start-0 md:-translate-x-1/2 md:rtl:translate-x-1/2"
        } ${hidden ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        {forward ? <ChevronRightIcon className="size-4 mirr md:size-5" /> : <ChevronLeftIcon className="size-4 mirr md:size-5" />}
      </button>
    );
  };

  return (
    <div ref={region} className="relative" role="region" aria-roledescription="carousel" aria-label={label}>
      {button(false)}
      <ul
        ref={track}
        onScroll={measure}
        className={`flex snap-x snap-mandatory overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${gapClassName}`}
      >
        {Children.map(children, (child) => (
          <li className={`shrink-0 snap-start ${itemClassName}`}>{child}</li>
        ))}
      </ul>
      {button(true)}
    </div>
  );
}
