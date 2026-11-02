import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Drawer } from "~/components/ui/Overlay";
import { Button } from "~/components/ui/Button";
import { formatPiastres } from "~/lib/money";
import { MinusIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { useCart, ensureGuestDetails } from "~/features/cart/store";
import type { CartLine } from "~/features/cart/api";
import { MediaImg } from "./MediaImg";

/**
 * Cart drawer (JOURNEYS §5.1): opens right after "Add to cart" with the
 * line (image/name/variant/price/qty), subtotal, "View cart". Quantity
 * respects live stock; guests resolve display data on open.
 */
export function CartDrawer() {
  const { t } = useTranslation();
  const params = useParams();
  const lang = params.lang === "en" ? "en" : "ar";
  const cart = useCart();
  const [detailed, setDetailed] = useState<CartLine[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    if (!cart.drawerOpen) return;
    const guestMissing = cart.lines.some((l) => !l.name_ar);
    if (guestMissing) {
      void ensureGuestDetails(cart.lines).then(setDetailed);
    } else {
      setDetailed(cart.lines);
    }
  }, [cart.drawerOpen, cart.lines]);

  const lines = detailed.length > 0 || cart.lines.every((l) => l.name_ar) ? cart.lines : detailed;
  const subtotal = lines.reduce((sum, l) => sum + (l.price_piastres ?? 0) * l.qty, 0);
  const anyCapped = lines.some((l) => l.capped);

  const changeQty = async (line: CartLine, qty: number) => {
    setWorking(line.variant_id);
    await cart.setQty(line.variant_id, qty);
    setWorking(null);
  };

  const removeLine = async (line: CartLine) => {
    setWorking(line.variant_id);
    await cart.remove(line.variant_id);
    setWorking(null);
  };

  return (
    <Drawer open={cart.drawerOpen} onClose={cart.closeDrawer} title={t("cart.drawer.title")}>
      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-extrabold text-text">{t("cart.empty.title")}</p>
          <p className="text-sm text-text-muted">{t("cart.empty.body")}</p>
          <Button type="button" variant="outline" onClick={cart.closeDrawer}>
            {t("cart.empty.browse")}
          </Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {lines.map((line) => {
              const name = lang === "ar" ? line.name_ar || line.name_en : line.name_en || line.name_ar;
              return (
                <li key={line.variant_id} className="flex gap-2.5 border-b border-border pb-3 last:border-none">
                  <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border">
                    {line.image_path ? (
                      <MediaImg path={line.image_path} alt={name ?? ""} width={64} height={64} className="size-16" />
                    ) : (
                      <div className="flex size-16 items-center justify-center bg-surface-tint text-2xs text-text-faint">
                        {t("store.noImage")}
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      to={`/${lang}/product/${encodeURIComponent((lang === "en" ? line.slug_en || line.slug_ar : line.slug_ar || line.slug_en) ?? "")}`}
                      onClick={cart.closeDrawer}
                      className="line-clamp-2 text-sm font-bold text-text transition-colors duration-150 hover:text-action"
                    >
                      {name}
                    </Link>
                    {line.store_name_ar || line.store_name_en ? (
                      <span className="truncate text-2xs text-text-muted">
                        {lang === "ar" ? line.store_name_ar || line.store_name_en : line.store_name_en || line.store_name_ar}
                      </span>
                    ) : null}
                    <span className="num text-sm font-extrabold text-text">
                      {line.price_piastres != null ? formatPiastres(line.price_piastres, lang) : ""}
                    </span>
                    {line.capped ? (
                      <span className="text-2xs font-bold text-warning-strong">{t("cart.cappedNotice")}</span>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-md border border-border">
                        <button
                          type="button"
                          aria-label={t("cart.decrease")}
                          disabled={working === line.variant_id}
                          onClick={() => void changeQty(line, line.qty - 1)}
                          className="flex size-8 cursor-pointer items-center justify-center text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MinusIcon className="size-3.5" />
                        </button>
                        <span className="num w-8 text-center text-sm font-extrabold">{line.qty}</span>
                        <button
                          type="button"
                          aria-label={t("cart.increase")}
                          disabled={working === line.variant_id || (line.stock != null && line.qty >= line.stock)}
                          onClick={() => void changeQty(line, line.qty + 1)}
                          className="flex size-8 cursor-pointer items-center justify-center text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
                          title={line.stock != null && line.qty >= line.stock ? t("cart.stockMax") : undefined}
                        >
                          <PlusIcon className="size-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={t("cart.remove")}
                        disabled={working === line.variant_id}
                        onClick={() => void removeLine(line)}
                        className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {anyCapped ? (
            <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs font-bold text-warning-strong">
              {t("cart.cappedSummary")}
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-bold text-text-muted">{t("cart.subtotal")}</span>
            <span className="num text-base font-black text-text">{formatPiastres(subtotal, lang)}</span>
          </div>
          <p className="mt-1 text-2xs text-text-faint">{t("cart.shippingNote")}</p>

          <div className="mt-4 flex flex-col gap-2">
            <Link
              to={`/${lang}/checkout`}
              onClick={cart.closeDrawer}
              className="flex min-h-11 items-center justify-center rounded-md bg-action text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
            >
              {t("cart.checkout")}
            </Link>
            <Link
              to={`/${lang}/cart`}
              onClick={cart.closeDrawer}
              className="flex min-h-11 items-center justify-center rounded-md border border-border text-sm font-extrabold text-text transition-colors duration-150 hover:bg-surface-tint"
            >
              {t("cart.viewCart")}
            </Link>
            <Button type="button" variant="outline" onClick={cart.closeDrawer}>
              {t("common.continue")}
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}
