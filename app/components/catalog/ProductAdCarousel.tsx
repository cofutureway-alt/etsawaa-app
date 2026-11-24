/**
 * Product page ad box (under "Shipping details"): the banners placed on
 * "Product page" in Admin → Banners (or by approving a bought banner ad),
 * as a carousel that slides on its own every few seconds. It pauses while
 * hovered or focused and stays still for reduced-motion users. Hidden when
 * there is no banner.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BANNER_SIZES } from "~/components/catalog/FitBanner";
import { sendAdEvent } from "~/features/ads/ad-tracking";
import { ChevronLeftIcon, ChevronRightIcon } from "~/components/ui/icons";

export interface ProductPageBanner {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  image_path: string;
  link_url: string | null;
  /** the paid campaign behind it (clicks are counted), null for the platform's own */
  campaign: string | null;
}

const INTERVAL = 5000;
const src = (path: string) => `/api/media?path=${encodeURIComponent(path)}`;

export function ProductAdCarousel({ banners, lang }: { banners: ProductPageBanner[]; lang: string }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const count = banners.length;
  const timer = useRef<number | null>(null);
  const { w, h } = BANNER_SIZES.product;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);
  useEffect(() => {
    if (count < 2 || paused || reduced) return;
    timer.current = window.setTimeout(() => go(index + 1), INTERVAL);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [index, paused, reduced, count, go]);

  if (!count) return null;
  const title = (b: ProductPageBanner) => (lang === "en" ? b.title_en || b.title_ar : b.title_ar || b.title_en) ?? "";
  // slides move toward the reading direction
  const dir = lang === "ar" ? 1 : -1;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("store.product.adBox")}
      className="group relative overflow-hidden rounded-2xl border border-border bg-surface shadow-1"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${w} / ${h}` }}>
        <div
          className={`flex h-full ${reduced ? "" : "transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"}`}
          style={{ transform: `translateX(${dir * index * 100}%)` }}
        >
          {banners.map((b, i) => {
            const img = (
              <img src={src(b.image_path)} alt={title(b)} width={w} height={h} decoding="async" draggable={false}
                loading="lazy"
                className={`block size-full object-cover select-none ${reduced ? "" : "transition-transform duration-[6000ms] ease-out"} ${i === index && !reduced ? "scale-[1.04]" : "scale-100"}`} />
            );
            const link = b.link_url?.trim() ?? "";
            const onClick = () => { if (b.campaign) sendAdEvent(b.campaign, "click"); };
            return (
              <div key={b.id} className="relative h-full w-full shrink-0" role="group" aria-roledescription="slide"
                aria-label={t("store.product.adSlide", { n: i + 1, total: count })} aria-hidden={i !== index || undefined}
                inert={i !== index ? true : undefined}>
                {link ? (
                  link.startsWith("/")
                    ? <Link to={link.replace(/^\/(ar|en)(?=\/|$)/, `/${lang}`)} onClick={onClick} className="block size-full">{img}</Link>
                    : <a href={link} onClick={onClick} rel="noopener sponsored" className="block size-full">{img}</a>
                ) : img}
                {b.campaign ? (
                  <span className="absolute start-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-2xs font-bold text-white">{t("ads.sponsored")}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {count > 1 ? (
        <>
          <button type="button" onClick={() => go(index - 1)} aria-label={t("common.prev")}
            className="absolute start-2 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-surface/85 text-text opacity-0 shadow-1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
            <ChevronRightIcon className="size-4 rtl:rotate-0 ltr:rotate-180" />
          </button>
          <button type="button" onClick={() => go(index + 1)} aria-label={t("common.next")}
            className="absolute end-2 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-surface/85 text-text opacity-0 shadow-1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
            <ChevronLeftIcon className="size-4 rtl:rotate-0 ltr:rotate-180" />
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button key={b.id} type="button" onClick={() => go(i)} aria-label={t("store.product.adSlide", { n: i + 1, total: count })}
                aria-current={i === index || undefined}
                className="group/dot grid h-6 cursor-pointer place-items-center px-0.5">
                <span className={`block h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60 group-hover/dot:bg-white/90"}`} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
