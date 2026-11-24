import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProductPage, VariantRow } from "~/features/storefront/api";
import { useCart } from "~/features/cart/store";
import { PriceTag } from "~/components/ui/PriceTag";
import { formatPiastres } from "~/lib/money";
import { useToast } from "~/components/ui/Toast";
import { CartIcon, CheckIcon, MinusIcon, PlusIcon } from "~/components/ui/icons";
import { Countdown } from "./Countdown";

/**
 * The buying panel shared by the product page and the "Choose options"
 * popup: colour (swatches) → size (chips) → quantity → add to cart. Only an
 * option with a single choice is pre-selected; "Add to cart" stays disabled until every option is chosen
 * and the exact child product + size exists with stock. Prices, the discount
 * countdown (end only — never the start) and the event discount follow the
 * selected size row.
 */

const ORDER: Record<string, number> = { color: 0, size: 1, memory: 2 };

function onSale(v: VariantRow, now: number): boolean {
  if (v.sale_price_piastres == null || v.price_piastres == null || v.sale_price_piastres >= v.price_piastres) return false;
  const start = v.sale_starts_at ? new Date(v.sale_starts_at).getTime() : -Infinity;
  const end = v.sale_ends_at ? new Date(v.sale_ends_at).getTime() : Infinity;
  return now >= start && now < end;
}

export function BuyBox({ page, lang, requestedKey = null, onColorImages, onAdded }: {
  page: ProductPage;
  lang: "ar" | "en";
  /** ?v=<option_key> deep link — the only case where options start selected */
  requestedKey?: string | null;
  /** fired with the picked colour's images (null = back to the product gallery) */
  onColorImages?: (images: string[] | null) => void;
  onAdded?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const cart = useCart();
  const card = page.card;
  const axes = useMemo(
    () => [...page.axes].sort((a, b) => (ORDER[a.code] ?? 9) - (ORDER[b.code] ?? 9)),
    [page.axes],
  );
  const live = page.variants;

  const [picks, setPicks] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    const deep = requestedKey ? live.find((v) => v.option_key === requestedKey) : undefined;
    if (deep) for (const axis of axes) {
      const hit = axis.options.find((o) => deep.option_ids.includes(o.id));
      if (hit) map.set(axis.attribute_id, hit.id);
    }
    // nothing to choose: an option with a single choice (e.g. only «9 كجم») starts selected
    for (const axis of axes) if (axis.options.length === 1 && !map.has(axis.attribute_id)) map.set(axis.attribute_id, axis.options[0]!.id);
    return map;
  });
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  // the clock only matters on the client (sale windows); SSR uses the request time
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  const complete = axes.every((axis) => picks.has(axis.attribute_id));
  const selected: VariantRow | null = useMemo(() => {
    if (!complete) return axes.length === 0 ? live[0] ?? null : null;
    return live.find((v) => axes.every((axis) => v.option_ids.includes(picks.get(axis.attribute_id)!))) ?? null;
  }, [complete, axes, live, picks]);

  // colour pick → that child's photos in the gallery
  const colorAxis = axes.find((a) => a.code === "color" || a.type === "color");
  const pickedColor = colorAxis ? picks.get(colorAxis.attribute_id) ?? null : null;
  useEffect(() => {
    if (!onColorImages) return;
    const group = page.groups.find((g) => g.color_option_id === pickedColor && g.images.length > 0);
    onColorImages(pickedColor && group ? group.images : null);
  }, [pickedColor, page.groups, onColorImages]);

  const available = (axisId: string, optionId: string) =>
    live.some((v) => v.stock > 0 && v.option_ids.includes(optionId) &&
      [...picks].every(([other, opt]) => other === axisId || v.option_ids.includes(opt)));

  const toggle = (axisId: string, optionId: string) => {
    setPicks((current) => {
      const next = new Map(current);
      if (next.get(axisId) === optionId) next.delete(axisId);
      else next.set(axisId, optionId);
      // a size that doesn't exist for the new colour is dropped, not kept invalid
      for (const axis of axes) {
        const chosen = next.get(axis.attribute_id);
        if (axis.attribute_id !== axisId && chosen &&
            !live.some((v) => v.option_ids.includes(chosen) && [...next].every(([, opt]) => v.option_ids.includes(opt)))) {
          next.delete(axis.attribute_id);
        }
      }
      return next;
    });
    setQty(1);
  };

  /* price: the selected size row, or a "from" price across the candidates.
     Every offer is priced the same way — regular → running sale → event cut —
     so "before" is always the regular price and "now" what the cart charges. */
  const candidates = selected ? [selected] : live.filter((v) => [...picks.values()].every((opt) => v.option_ids.includes(opt)));
  const priceOf = (v: VariantRow) => (onSale(v, now) ? v.sale_price_piastres! : v.price_piastres ?? 0);
  const withEvent = (piastres: number) => {
    if (card.event_percent <= 0) return piastres;
    const discounted = piastres - Math.trunc((piastres * card.event_percent) / 100);
    return card.event_max_piastres != null && discounted > card.event_max_piastres ? card.event_max_piastres : discounted;
  };
  const priced = candidates.filter((v) => v.price_piastres != null)
    .map((v) => ({ v, now: withEvent(priceOf(v)), regular: v.price_piastres ?? 0 }))
    .sort((x, y) => x.now - y.now || x.regular - y.regular);
  const best = priced[0] ?? null;
  const effective = best ? best.now : null;
  const before = best && best.regular > best.now ? best.regular : null;
  const percentOff = before && effective != null ? Math.max(1, Math.round(((before - effective) / before) * 100)) : 0;
  const saleActive = selected ? onSale(selected, now) : priced.some((x) => onSale(x.v, now));
  const fromPrice = !selected && priced.length > 1 && new Set(priced.map((x) => x.now)).size > 1;
  const eventOn = card.event_percent > 0 && effective != null;
  // countdown: the selected row's discount end, else the soonest among those on sale
  const saleEnds = (selected ? [selected] : candidates).filter((v) => onSale(v, now) && v.sale_ends_at)
    .map((v) => v.sale_ends_at!).sort()[0] ?? null;
  const candidateStock = candidates.reduce((sum, v) => sum + Math.max(0, v.stock), 0);

  const stock = selected?.stock ?? 0;
  const ready = Boolean(selected) && stock > 0;
  const missing = axes.filter((axis) => !picks.has(axis.attribute_id));

  const add = async () => {
    if (!selected || !ready || adding) return;
    setAdding(true);
    const res = await cart.add(selected.id, card.id, qty);
    setAdding(false);
    if (!res.ok) {
      toast.showToast("error", t(res.reason === "out_of_stock" ? "store.product.outOfStock" : "errors.generic"));
      return;
    }
    if (res.capped) toast.showToast("info", t("cart.cappedNotice"));
    onAdded?.();
    cart.openDrawer();
  };

  const label = (o: { label_ar: string; label_en: string }) => (lang === "ar" ? o.label_ar || o.label_en : o.label_en || o.label_ar);

  return (
    <div className="flex flex-col gap-4">
      {/* price + discounts */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-tint/60 p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          {effective != null ? (
            <>
              {fromPrice ? <span className="text-xs font-bold text-text-muted">{t("store.product.from")}</span> : null}
              <PriceTag pricePiastres={effective} comparePricePiastres={before} locale={lang} size="lg" badge={false} />
            </>
          ) : (
            <span className="text-sm text-text-muted">{t("store.product.noPrice")}</span>
          )}
          {before != null ? (
            <span className="num rounded-full bg-danger px-2.5 py-0.5 text-xs font-black text-white" dir="ltr">−{percentOff}%</span>
          ) : null}
        </div>
        {before != null && effective != null ? (
          <p className="text-xs font-bold text-success-strong">
            {t("store.product.youSave", { amount: formatPiastres(before - effective, lang) })}
          </p>
        ) : null}
        {eventOn && page.event ? (
          <div className="flex flex-col gap-1.5">
            <span className="w-fit rounded-full bg-[#6B3FA0] px-2.5 py-1 text-xs font-extrabold text-white">
              {t("store.product.eventBadge", { name: lang === "ar" ? page.event.name_ar : page.event.name_en, percent: card.event_percent })}
            </span>
            <Countdown endsAt={page.event.ends_at} tone="event" label={t("store.product.eventEndsIn")} />
          </div>
        ) : saleActive && saleEnds ? (
          <Countdown endsAt={saleEnds} label={t("store.product.saleEndsIn")} />
        ) : null}
      </div>

      {/* options */}
      {axes.map((axis) => {
        const current = picks.get(axis.attribute_id) ?? null;
        const currentOpt = axis.options.find((o) => o.id === current);
        const isColor = axis.code === "color" || axis.type === "color";
        return (
          <fieldset key={axis.attribute_id} className="min-w-0">
            <legend className="mb-2 text-sm font-extrabold text-text">
              {lang === "ar" ? axis.label_ar : axis.label_en}
              <span className="ms-0.5 text-danger">*</span>
              {currentOpt ? <span className="ms-1.5 font-bold text-text-muted">: {label(currentOpt)}</span> : null}
            </legend>
            <div className="flex flex-wrap gap-2">
              {axis.options.map((option) => {
                const active = current === option.id;
                const ok = available(axis.attribute_id, option.id);
                return isColor ? (
                  <button key={option.id} type="button" onClick={() => toggle(axis.attribute_id, option.id)} disabled={!ok}
                    aria-pressed={active} aria-label={label(option)} title={ok ? label(option) : t("store.product.outOfStockOption")}
                    className={`relative flex size-10 cursor-pointer items-center justify-center rounded-full transition-shadow disabled:cursor-not-allowed ${
                      active ? "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-action)]" : "hover:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-border-strong)]"}`}>
                    <span aria-hidden="true" className={`size-9 rounded-full border border-black/10 ${ok ? "" : "opacity-40"}`}
                      style={option.color_hex ? { backgroundColor: option.color_hex } : { background: "conic-gradient(#e53935,#fdd835,#43a047,#1e88e5,#8e24aa,#e53935)" }} />
                    {!ok ? <span aria-hidden="true" className="absolute h-0.5 w-9 rotate-45 rounded bg-text-muted" /> : null}
                  </button>
                ) : (
                  <button key={option.id} type="button" onClick={() => toggle(axis.attribute_id, option.id)} disabled={!ok} aria-pressed={active}
                    title={ok ? label(option) : t("store.product.outOfStockOption")}
                    className={`min-h-10 min-w-12 cursor-pointer rounded-md border-2 px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:border-dashed disabled:text-text-faint disabled:line-through ${
                      active ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-text"}`}>
                    {label(option)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {/* stock / guidance — live for the picked colour/size */}
      {selected ? (
        <p className={`flex items-center gap-1.5 text-sm font-extrabold ${stock > 0 ? (stock <= 5 ? "text-warning-strong" : "text-success-strong") : "text-danger"}`} aria-live="polite">
          {stock > 0 ? <CheckIcon className="size-4" /> : null}
          {stock > 0 ? (stock <= 5 ? t("store.product.onlyLeft", { count: stock }) : t("store.product.inStock", { count: stock })) : t("store.product.outOfStock")}
        </p>
      ) : (
        <>
          {candidateStock > 0 ? (
            <p className="text-xs font-bold text-text-muted" aria-live="polite">{t("store.product.stockAcross", { count: candidateStock })}</p>
          ) : null}
          {missing.length ? (
            <p className="text-sm font-bold text-text-muted">
              {t("store.product.chooseFirst", { options: missing.map((a) => (lang === "ar" ? a.label_ar : a.label_en)).join(lang === "ar" ? " و" : " & ") })}
            </p>
          ) : (
            <p className="text-sm font-extrabold text-danger">{t("store.product.comboUnavailable")}</p>
          )}
        </>
      )}

      {/* qty + add */}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-md border border-border">
          <button type="button" aria-label={t("cart.decrease")} disabled={!ready || qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="flex size-11 cursor-pointer items-center justify-center text-text hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
            <MinusIcon className="size-4" />
          </button>
          <span className="num w-10 text-center text-sm font-extrabold">{qty}</span>
          <button type="button" aria-label={t("cart.increase")} disabled={!ready || qty >= stock} onClick={() => setQty((q) => Math.min(stock, q + 1))}
            className="flex size-11 cursor-pointer items-center justify-center text-text hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
            <PlusIcon className="size-4" />
          </button>
        </div>
        <button type="button" onClick={() => void add()} disabled={!ready || adding}
          className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-action px-6 text-sm font-extrabold text-on-action transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50">
          <CartIcon aria-hidden="true" />
          {adding ? t("common.loading") : t("store.product.addToCart")}
        </button>
      </div>
    </div>
  );
}
