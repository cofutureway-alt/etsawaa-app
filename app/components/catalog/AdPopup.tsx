import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import type { ProductCard } from "~/features/storefront/api";
import { cardPricing } from "~/features/storefront/api";
import { formatPiastres } from "~/lib/money";
import { MediaImg } from "~/components/catalog/MediaImg";
import { XIcon } from "~/components/ui/icons";
import { sendAdEvent } from "~/features/ads/ad-tracking";

/** The popup designs the admin can allow in a package (the vendor picks one). */
export const POPUP_TEMPLATES = ["spotlight", "deal", "minimal"] as const;
export type PopupTemplate = (typeof POPUP_TEMPLATES)[number];

export interface PopupAd { campaign: string; template: string | null; card: ProductCard }

/**
 * Paid popup ad: one product in a designed popup, shown a few seconds after a
 * visitor lands, once per browser session, never on checkout / cart / account.
 * Counts one impression when shown and a click when opened.
 */
export function AdPopup({ ad, lang }: { ad: PopupAd | null; lang: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const blocked = /\/(checkout|cart|account|auth|order)\b/.test(location.pathname);

  useEffect(() => {
    if (!ad || blocked) return;
    try { if (sessionStorage.getItem("ad-popup-shown")) return; } catch { /* show */ }
    const id = window.setTimeout(() => {
      setOpen(true);
      try { sessionStorage.setItem("ad-popup-shown", "1"); } catch { /* ignore */ }
      sendAdEvent(ad.campaign, "view");
    }, 3500);
    return () => window.clearTimeout(id);
  }, [ad, blocked]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!ad || !open) return null;

  const en = lang === "en";
  const c = ad.card;
  const name = en ? c.name_en || c.name_ar : c.name_ar || c.name_en;
  const store = en ? c.store_name_en || c.store_name_ar : c.store_name_ar || c.store_name_en;
  const pricing = cardPricing(c);
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const href = `/${lang}/product/${encodeURIComponent(en ? c.slug_en || c.slug_ar : c.slug_ar || c.slug_en)}`;
  const template = (POPUP_TEMPLATES as readonly string[]).includes(ad.template ?? "") ? (ad.template as PopupTemplate) : "spotlight";
  const go = () => { sendAdEvent(ad.campaign, "click"); setOpen(false); };
  const close = (
    <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")}
      className="absolute end-3 top-3 z-10 grid size-9 cursor-pointer place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60">
      <XIcon className="size-4" />
    </button>
  );
  const image = c.main_image_path ? <MediaImg path={c.main_image_path} alt={name} width={480} height={480} className="size-full object-contain" /> : null;
  const price = (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="num text-2xl font-black">{money(pricing.now)}</span>
      {pricing.before != null ? <span className="num text-sm line-through opacity-70">{money(pricing.before)}</span> : null}
    </span>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={t("ads.sponsored")} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      {template === "deal" ? (
        // bold sale card: red header with the discount, product below
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-3">
          {close}
          <div className="bg-action px-5 pb-10 pt-6 text-center text-on-action">
            <p className="text-xs font-bold opacity-90">{t("ads.popup.dealKicker")}</p>
            <p className="mt-1 text-3xl font-black">{pricing.percent > 0 ? t("ads.popup.save", { percent: pricing.percent }) : t("ads.popup.dealTitle")}</p>
          </div>
          <div className="-mt-8 px-5 pb-5">
            <div className="mx-auto aspect-square w-48 overflow-hidden rounded-xl border-4 border-surface bg-white shadow-2">{image}</div>
            <p className="mt-3 line-clamp-2 text-center text-base font-extrabold text-text">{name}</p>
            <div className="mt-2 flex justify-center text-action">{price}</div>
            <Link to={href} onClick={go} className="mt-4 flex h-12 items-center justify-center rounded-xl bg-action text-base font-extrabold text-on-action hover:bg-action-hover">{t("ads.popup.cta")}</Link>
            <p className="mt-2 text-center text-2xs text-text-muted">{t("ads.sponsoredBy", { store })}</p>
          </div>
        </div>
      ) : template === "minimal" ? (
        // quiet card: image on the side, text and a link
        <div className="relative flex w-full max-w-lg items-stretch overflow-hidden rounded-2xl bg-surface shadow-3">
          {close}
          <div className="w-2/5 shrink-0 bg-white p-3">{image}</div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-5 pe-12">
            <span className="w-fit rounded-full border border-border px-2 py-0.5 text-2xs font-bold text-text-muted">{t("ads.sponsored")}</span>
            <p className="line-clamp-3 text-base font-extrabold text-text">{name}</p>
            <div className="text-text">{price}</div>
            <Link to={href} onClick={go} className="mt-1 w-fit text-sm font-extrabold text-action hover:underline">{t("ads.popup.cta")} ←</Link>
          </div>
        </div>
      ) : (
        // spotlight: large image, dark overlay text
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-black shadow-3">
          {close}
          <div className="aspect-square w-full bg-white">{image}</div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-5 pt-16 text-white">
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-2xs font-bold">{t("ads.sponsored")} · {store}</span>
            <p className="mt-2 line-clamp-2 text-lg font-extrabold">{name}</p>
            <div className="mt-1">{price}</div>
            <Link to={href} onClick={go} className="mt-3 flex h-11 items-center justify-center rounded-xl bg-white text-sm font-extrabold text-black hover:bg-white/90">{t("ads.popup.cta")}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
