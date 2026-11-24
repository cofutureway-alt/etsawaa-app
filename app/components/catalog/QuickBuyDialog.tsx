import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { ProductPage } from "~/features/storefront/api";
import { Dialog } from "~/components/ui/Overlay";
import { BuyBox } from "./BuyBox";
import { MediaImg } from "./MediaImg";

/**
 * "Choose options" popup from a product card: the same colour/size/quantity
 * flow as the product page (BuyBox), with the picked colour's photos.
 */
export function QuickBuyDialog({ slug, lang, open, onClose }: { slug: string; lang: "ar" | "en"; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<ProductPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [colorImages, setColorImages] = useState<string[] | null>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!open || page) return;
    let cancelled = false;
    setFailed(false);
    fetch(`/api/product-quick?slug=${encodeURIComponent(slug)}`, { credentials: "same-origin" })
      .then((r) => r.json() as Promise<{ ok: boolean; page?: ProductPage }>)
      .then((res) => { if (!cancelled) { if (res.ok && res.page) setPage(res.page); else setFailed(true); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, page, slug]);

  const onColorImages = useCallback((paths: string[] | null) => { setColorImages(paths); setShown(0); }, []);
  const images = page ? (colorImages ?? page.media.filter((m) => m.kind === "image").map((m) => m.path)) : [];
  const name = page ? (lang === "ar" ? page.card.name_ar || page.card.name_en : page.card.name_en || page.card.name_ar) : "";

  return (
    <Dialog open={open} onClose={onClose} title={name || t("store.card.chooseOptions")} size="xl">
      {!page ? (
        <div className="flex min-h-60 items-center justify-center text-sm text-text-muted">
          {failed ? t("errors.generic") : t("common.loading")}
        </div>
      ) : (
        <div className="grid gap-5 p-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-xl border border-border bg-surface-tint">
              {images[shown] ? (
                <MediaImg path={images[shown]!} alt={name} width={520} height={520} className="aspect-square w-full object-cover" />
              ) : <div className="aspect-square" />}
            </div>
            {images.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.slice(0, 8).map((path, i) => (
                  <button key={`${path}-${i}`} type="button" onClick={() => setShown(i)} aria-label={`${i + 1}`}
                    className={`size-14 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 ${i === shown ? "border-action" : "border-transparent"}`}>
                    <MediaImg path={path} alt="" width={56} height={56} className="size-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <BuyBox page={page} lang={lang} onColorImages={onColorImages} onAdded={onClose} />
            <Link to={`/${lang}/product/${encodeURIComponent(slug)}`} onClick={onClose}
              className="text-sm font-bold text-action hover:underline">
              {t("store.card.fullDetails")}
            </Link>
          </div>
        </div>
      )}
    </Dialog>
  );
}
