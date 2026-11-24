import { useMemo, useState } from "react";
import { htmlToText, isRichHtml, sanitizeProductHtml } from "~/lib/sanitize";
import { useTranslation } from "react-i18next";
import type { AttributeView } from "~/features/storefront/api";
import { unitLabel, withUnit } from "~/lib/units";
import { ChevronDownIcon, InfoIcon, ListIcon, TruckIcon } from "~/components/ui/icons";

/**
 * Product page "Description & specifications": a readable description card
 * (long text collapses after a few lines), key facts as chips, then grouped
 * specification cards — product details and shipping/handling — laid out as
 * label/value rows that scan well on phones and desktops.
 */
export function ProductDetails({ description, attributes, isFragile, weightG, shippingMode, brand, category, lang, axes = [], skus = [], aside }: {
  description: string;
  /** the product's options (colours, sizes…) listed as information only */
  axes?: Array<{ id: string; label: string; values: string[]; hexes?: Array<string | null> }>;
  /** SKUs of the live stock rows */
  skus?: string[];
  attributes: AttributeView[];
  isFragile: boolean;
  weightG: number | null;
  shippingMode: string;
  /** shown under "Shipping details" (the product page ad carousel) */
  aside?: React.ReactNode;
  brand: string | null;
  category: string | null;
  lang: "ar" | "en";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // descriptions from the editor are HTML; older ones are plain text
  const rich = isRichHtml(description);
  const html = useMemo(() => (rich ? sanitizeProductHtml(description) : ""), [rich, description]);
  const long = htmlToText(description).length > 420;

  const valueOf = (attr: AttributeView): string | null => {
    if (attr.options.length) {
      // multi-choice specs read "قطن، إيلاستين" / "Cotton, Elastane"
      return attr.options.map((o) => (lang === "ar" ? o.label_ar || o.label_en : o.label_en || o.label_ar)).filter(Boolean).join(lang === "ar" ? "، " : ", ") || null;
    }
    const text = lang === "en" ? attr.value_text_en || attr.value_text : attr.value_text || attr.value_text_en;
    if (text) return withUnit(text, attr.unit, lang);
    if (attr.value_number != null) return `${attr.value_number}${unitLabel(attr.unit, lang) ? ` ${unitLabel(attr.unit, lang)}` : ""}`;
    if (attr.value_bool != null) return t(attr.value_bool ? "common.yes" : "common.no");
    return null;
  };
  const specs = attributes
    .filter((a) => !a.is_axis)
    .map((a) => ({ id: a.attribute_id, label: lang === "ar" ? a.label_ar : a.label_en, value: valueOf(a), hex: a.options.length === 1 ? a.color_hex : null, ltr: false }))
    .filter((r) => r.value);
  // SKU + available colours / sizes lead the table (information only — choosing happens in the buy box)
  const skuList = [...new Set(skus.filter(Boolean))];
  const lead = [
    skuList.length ? { id: "sku", label: t("store.product.sku"), value: skuList.length > 4 ? `${skuList.slice(0, 4).join(" · ")} …` : skuList.join(" · "), hex: null, ltr: true } : null,
    ...axes.filter((a) => a.values.length).map((a) => ({ id: `axis-${a.id}`, label: a.label, value: a.values.join(lang === "ar" ? "، " : ", "), hex: null, ltr: false })),
  ].filter((r): r is { id: string; label: string; value: string; hex: null; ltr: boolean } => Boolean(r));
  specs.unshift(...lead);
  const shipping = [
    weightG ? { id: "w", label: t("store.product.weight"), value: t("store.product.grams", { count: weightG }) } : null,
    { id: "m", label: t("store.product.shippedBy"), value: t(shippingMode === "vendor" ? "store.product.shippedByVendor" : "store.product.shippedByPlatform") },
    isFragile ? { id: "f", label: t("store.product.fragile"), value: t("store.product.fragileYes") } : null,
  ].filter((r): r is { id: string; label: string; value: string } => Boolean(r));
  const facts = [brand ? { k: t("store.product.brand"), v: brand } : null, category ? { k: t("store.product.category"), v: category } : null]
    .filter((f): f is { k: string; v: string } => Boolean(f));

  return (
    <div className="flex flex-col gap-5">
      {description ? (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-6">
          <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-text">
            <InfoIcon className="size-5 text-action" />{t("store.product.description")}
          </h2>
          <div className={`relative ${long && !expanded ? "max-h-48 overflow-hidden" : ""}`}>
            {rich ? (
              <div className="richText text-[15px] leading-8 text-text" dangerouslySetInnerHTML={{ __html: html /* sanitizeProductHtml */ }} />
            ) : (
              <p className="whitespace-pre-line text-[15px] leading-8 text-text">{description}</p>
            )}
            {long && !expanded ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" /> : null}
          </div>
          {long ? (
            <button type="button" onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex cursor-pointer items-center gap-1 text-sm font-bold text-action hover:underline">
              {expanded ? t("store.product.showLess") : t("store.product.readMore")}
              <ChevronDownIcon className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          ) : null}
        </section>
      ) : null}

      {facts.length ? (
        <ul className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <li key={f.k} className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs">
              <span className="text-text-muted">{f.k}: </span><span className="font-bold text-text">{f.v}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {specs.length ? (
          <SpecCard title={t("store.product.specsTitle")} icon={<ListIcon className="size-5 text-action" />} rows={specs} />
        ) : null}
        <div className="flex min-w-0 flex-col gap-5">
          <SpecCard title={t("store.product.shippingTitle")} icon={<TruckIcon className="size-5 text-action" />} rows={shipping} />
          {aside}
        </div>
      </div>
    </div>
  );
}

function SpecCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: Array<{ id: string; label: string; value: string | null; hex?: string | null; ltr?: boolean }> }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
      <h2 className="flex items-center gap-2 border-b border-border bg-surface-tint/40 px-5 py-3.5 text-base font-extrabold text-text">{icon}{title}</h2>
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-5 py-3 text-sm odd:bg-surface even:bg-surface-tint/20">
            <dt className="text-text-muted">{r.label}</dt>
            <dd className="flex items-center gap-2 font-bold text-text">
              {r.hex ? <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: r.hex }} /> : null}
              <span className={`min-w-0 break-words ${r.ltr ? "num" : ""}`} dir={r.ltr ? "ltr" : undefined}>{r.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
