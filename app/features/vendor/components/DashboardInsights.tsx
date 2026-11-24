import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";
import { publicMediaUrl } from "~/lib/media.shared";
import { AlertIcon, PackageIcon, StarIcon, TagIcon } from "~/components/ui/icons";
import type { ReactNode } from "react";

/**
 * Seller dashboard insights (fn_vendor_dashboard_cards + the live event from
 * fn_vendor_event_overview): a live-event notice, the store's categories with
 * the commission rate that applies, low stock per child (colour + size),
 * best sellers and products with no sale for N days.
 */

type Named = { name_ar: string; name_en: string };
export interface DashboardCards {
  ok: boolean;
  low_threshold: number;
  unsold_days: number;
  categories: Array<Named & { id: string; percent: number }>;
  low_stock: Array<Named & { variant_id: string; product_id: string; sku: string | null; stock: number; color_ar: string | null; color_en: string | null; color_hex: string | null; size_ar: string | null; size_en: string | null; image: string | null }>;
  low_stock_total: number;
  best: Array<Named & { product_id: string; units: number; revenue_piastres: number; image: string | null }>;
  unsold: Array<Named & { product_id: string; days: number; image: string | null }>;
  unsold_total: number;
}
export interface LiveEvent extends Named { id: string; ends_at: string; participation: string; max_percent: number | null; affected_products: number }

export function LiveEventNotice({ event, lang }: { event: LiveEvent; lang: "ar" | "en" }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const refused = event.participation === "refused";
  const ends = new Date(event.ends_at).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Link to={`/${lang}/vendor/events`} role="status"
      className={`flex items-center gap-3 rounded-xl border-2 p-3.5 transition-colors ${refused ? "border-border bg-surface hover:bg-surface-tint" : "border-action bg-action/10 hover:bg-action/15"}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${event.max_percent && !refused ? "bg-danger text-white" : "bg-surface text-action"}`}>
        {event.max_percent && !refused ? <b className="num text-sm">{event.max_percent}%</b> : <TagIcon className="size-5" />}
      </span>
      <span className="min-w-0 text-sm">
        <b className="block text-text">{t("vev.liveNow", { name: en ? event.name_en : event.name_ar })}</b>
        <span className="text-text-muted">
          {refused ? t("vev.liveRefused")
            : event.max_percent ? t("vev.liveDiscount", { percent: event.max_percent, count: event.affected_products })
            : t("vev.liveNoDiscount")}
          {" · "}<span className="num">{t("vev.endsAt", { date: ends })}</span>
        </span>
      </span>
    </Link>
  );
}

export function DashboardInsights({ cards, lang, supabaseUrl }: { cards: DashboardCards; lang: "ar" | "en"; supabaseUrl: string }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const N = (o: Named) => (en ? o.name_en || o.name_ar : o.name_ar || o.name_en);
  const thumb = (path: string | null) => (
    <span className="size-10 shrink-0 overflow-hidden rounded-md border border-border bg-surface-tint">
      {path ? <img src={publicMediaUrl(supabaseUrl, path)} alt="" loading="lazy" className="size-full object-cover" /> : null}
    </span>
  );
  const edit = (id: string) => `/${lang}/vendor/products/${id}/edit`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={<TagIcon className="size-4" />} title={t("vdash.categories")} hint={t("vdash.categoriesHint")}>
        {cards.categories.length === 0 ? <Empty>{t("vdash.noCategories")}</Empty> : (
          <ul className="flex flex-wrap gap-2">
            {cards.categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
                <span className="font-bold text-text">{N(c)}</span>
                <span className="num rounded-full bg-primary-soft px-2 py-0.5 text-xs font-black text-action">{c.percent}%</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel icon={<AlertIcon className="size-4" />} title={t("vdash.lowStock", { count: cards.low_stock_total })} hint={t("vdash.lowStockHint", { n: cards.low_threshold })}>
        {cards.low_stock.length === 0 ? <Empty>{t("vdash.noLowStock")}</Empty> : (
          <ul className="divide-y divide-border">
            {cards.low_stock.slice(0, 6).map((v) => (
              <li key={v.variant_id}>
                <Link to={edit(v.product_id)} className="flex items-center gap-3 py-2 hover:bg-surface-tint/60">
                  {thumb(v.image)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text">{N(v)}</span>
                    <span className="flex items-center gap-1.5 text-xs text-text-muted">
                      {v.color_hex ? <span className="size-3 rounded-full border border-border" style={{ background: v.color_hex }} /> : null}
                      {[en ? v.color_en : v.color_ar, en ? v.size_en : v.size_ar].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`num shrink-0 rounded-md px-2 py-1 text-xs font-black ${v.stock === 0 ? "bg-danger text-white" : "bg-warning-soft text-warning-strong"}`}>
                    {v.stock === 0 ? t("vdash.out") : v.stock}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel icon={<StarIcon className="size-4" />} title={t("vdash.best")} hint={t("vdash.bestHint")}>
        {cards.best.length === 0 ? <Empty>{t("vdash.noBest")}</Empty> : (
          <ol className="divide-y divide-border">
            {cards.best.map((b, i) => (
              <li key={b.product_id} className="flex items-center gap-3 py-2">
                <span className="num w-5 shrink-0 text-center text-sm font-black text-text-muted">{i + 1}</span>
                {thumb(b.image)}
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">{N(b)}</span>
                <span className="shrink-0 text-end text-xs">
                  <b className="num block text-text">{t("vdash.units", { count: b.units })}</b>
                  <span className="num text-text-muted">{formatPiastres(b.revenue_piastres, lang)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel icon={<PackageIcon className="size-4" />} title={t("vdash.unsold", { count: cards.unsold_total })} hint={t("vdash.unsoldHint", { n: cards.unsold_days })}>
        {cards.unsold.length === 0 ? <Empty>{t("vdash.noUnsold")}</Empty> : (
          <ul className="divide-y divide-border">
            {cards.unsold.map((u) => (
              <li key={u.product_id}>
                <Link to={edit(u.product_id)} className="flex items-center gap-3 py-2 hover:bg-surface-tint/60">
                  {thumb(u.image)}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">{N(u)}</span>
                  <span className="num shrink-0 text-xs text-text-muted">{t("vdash.daysLive", { count: u.days })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Panel({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
      <header>
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-text"><span className="text-action">{icon}</span>{title}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
      </header>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">{children}</p>;
}
