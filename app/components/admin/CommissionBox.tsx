/**
 * Admin product review → "Platform commission": the rate checkout will
 * charge on this product (fn_admin_product_commission mirrors
 * fn_vendor_line_commission), where it comes from, and what it means in
 * pounds for each selling price. Admin panel only — sellers never see it.
 */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";

export interface ProductCommission {
  ok: boolean;
  rate?: number;
  base?: number;
  reduction?: number;
  source?: "vendor_category" | "vendor_fixed" | "category" | "parent_category" | "level" | "default";
  from_category_ar?: string | null;
  from_category_en?: string | null;
  level_ar?: string | null;
  level_en?: string | null;
  has_leaf?: boolean;
}

export interface PriceGroup { price: number | null; sale: number | null; sale_starts_at: string | null; sale_ends_at: string | null }

/** The price a shopper pays right now: the sale price while its window is open. */
export function sellingPrice(g: PriceGroup, now = Date.now()): number | null {
  if (g.price == null) return null;
  const saleOn = g.sale != null && g.sale < g.price
    && (!g.sale_starts_at || Date.parse(g.sale_starts_at) <= now)
    && (!g.sale_ends_at || Date.parse(g.sale_ends_at) > now);
  return saleOn ? g.sale : g.price;
}

/** Commission in piastres on one unit, rounded like checkout (rate rounded to 0.01%). */
export function commissionOn(pricePiastres: number, ratePercent: number): number {
  const bps = Math.round(ratePercent * 100);
  return Math.max(0, Math.round((pricePiastres * bps) / 10000));
}

export function CommissionBox({ data, groups, lang, loading }: { data: ProductCommission | null; groups: PriceGroup[]; lang: string; loading?: boolean }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const money = (v: number) => formatPiastres(v, en ? "en" : "ar");
  if (!data?.ok || data.rate == null) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 shadow-1">
        <h2 className="text-base font-extrabold text-text">{t("productReview.commission.title")}</h2>
        <p className="mt-1 text-sm text-text-muted" aria-live="polite">{t(loading ? "common.loading" : "productReview.commission.unavailable")}</p>
      </section>
    );
  }
  const rate = Number(data.rate);
  const pct = (n: number) => `${Number(n.toFixed(2))}%`;
  const cat = (en ? data.from_category_en || data.from_category_ar : data.from_category_ar || data.from_category_en) ?? "";
  const level = (en ? data.level_en || data.level_ar : data.level_ar || data.level_en) ?? "";
  const why = t(`productReview.commission.src_${data.source ?? "default"}`, { category: cat, level });
  const prices = [...new Set(groups.map((g) => sellingPrice(g)).filter((p): p is number => p != null))].sort((a, b) => a - b).slice(0, 6);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1" aria-labelledby="commission-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="commission-title" className="text-base font-extrabold text-text">{t("productReview.commission.title")}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t("productReview.commission.staffOnly")}</p>
        </div>
        <span className="num shrink-0 rounded-lg bg-surface-tint px-3 py-1.5 text-2xl font-black text-action" dir="ltr">{pct(rate)}</span>
      </div>

      <p className="text-sm text-text">{why}</p>
      {Number(data.reduction ?? 0) > 0 ? (
        <p className="text-xs text-text-muted">
          {t("productReview.commission.reduction", { base: pct(Number(data.base)), reduction: pct(Number(data.reduction)), level })}
        </p>
      ) : null}
      {!data.has_leaf ? <p className="text-xs text-warning-strong">{t("productReview.commission.noCategory")}</p> : null}

      {prices.length ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t("productReview.commission.tableCaption")}</caption>
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th scope="col" className="py-1.5 text-start font-bold">{t("productReview.commission.price")}</th>
              <th scope="col" className="py-1.5 text-start font-bold">{t("productReview.commission.amount")}</th>
              <th scope="col" className="py-1.5 text-start font-bold">{t("productReview.commission.net")}</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => {
              const c = commissionOn(p, rate);
              return (
                <tr key={p} className="border-b border-border last:border-0">
                  <td className="num py-1.5 text-text" dir="ltr">{money(p)}</td>
                  <td className="num py-1.5 font-bold text-action" dir="ltr">{money(c)}</td>
                  <td className="num py-1.5 text-text-muted" dir="ltr">{money(p - c)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <p className="text-2xs text-text-muted">{t("productReview.commission.note")}</p>
    </section>
  );
}

/**
 * The same box inside the product wizard: re-asked whenever the store or the
 * category changes, so the rate is right before the product is saved.
 * Rendered only for admin and staff viewers (the route decides).
 */
export function LiveCommissionBox({ vendorId, leafId, groups, lang }: { vendorId: string; leafId: string | null; groups: PriceGroup[]; lang: string }) {
  const fetcher = useFetcher<ProductCommission>();
  const { load } = fetcher;
  useEffect(() => {
    if (!vendorId) return;
    load(`/api/admin-commission?vendor=${encodeURIComponent(vendorId)}${leafId ? `&leaf=${encodeURIComponent(leafId)}` : ""}`);
  }, [vendorId, leafId, load]);
  return <CommissionBox data={fetcher.data ?? null} groups={groups} lang={lang} loading={fetcher.state !== "idle" || !fetcher.data} />;
}
