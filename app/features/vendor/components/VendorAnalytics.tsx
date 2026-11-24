import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";
import { publicMediaUrl } from "~/lib/media.shared";
import { PackageIcon } from "~/components/ui/icons";
import { Rating } from "~/components/ui/Rating";

/** fn_vendor_analytics payload (one period vs the period before it). */
export interface VendorAnalyticsData {
  ok: true;
  days: number;
  kpi: {
    revenue: number; revenue_prev: number; orders: number; orders_prev: number; units: number; commission: number;
    cancelled: number; all_orders: number; delivered: number; in_progress: number; buyers: number; repeat_buyers: number;
    refunds: number; avg_ship_hours: number | null; rating_avg: number | null; rating_count: number; views: number;
    stock_units: number; stock_value: number; live_products: number;
  };
  series: Array<{ day: string; revenue: number; orders: number }>;
  top_products: Array<{ id: string; name_ar: string; name_en: string; image: string | null; units: number; revenue: number }>;
  top_categories: Array<{ name_ar: string; name_en: string; units: number; revenue: number }>;
  top_governorates: Array<{ name_ar: string; name_en: string; orders: number }>;
  status_mix: Record<string, number>;
}

const PERIODS = [7, 30, 90] as const;

function delta(now: number, prev: number): number | null {
  if (prev <= 0) return now > 0 ? 100 : null;
  return Math.round(((now - prev) / prev) * 100);
}

/**
 * Seller analytics: revenue / orders / AOV / net with change vs the previous
 * period, a daily revenue chart, best products & categories, where buyers
 * are, order health (cancellations, refunds, ship time) and inventory value.
 * Every number comes from fn_vendor_analytics — no estimates.
 */
export function VendorAnalytics({ data, lang, supabaseUrl }: { data: VendorAnalyticsData; lang: "ar" | "en"; supabaseUrl: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const k = data.kpi;
  const money = (p: number) => formatPiastres(p, lang);
  const L = (r: { name_ar: string; name_en: string }) => (lang === "ar" ? r.name_ar || r.name_en : r.name_en || r.name_ar);
  const aov = k.orders > 0 ? Math.round(k.revenue / k.orders) : 0;
  const aovPrev = k.orders_prev > 0 ? Math.round(k.revenue_prev / k.orders_prev) : 0;
  const cancelRate = k.all_orders > 0 ? Math.round((k.cancelled / k.all_orders) * 100) : 0;
  const repeatRate = k.buyers > 0 ? Math.round((Math.min(k.repeat_buyers, k.buyers) / k.buyers) * 100) : 0;

  const cards = [
    { key: "revenue", label: t("va2.revenue"), value: money(k.revenue), change: delta(k.revenue, k.revenue_prev) },
    { key: "orders", label: t("va2.orders"), value: String(k.orders), change: delta(k.orders, k.orders_prev) },
    { key: "aov", label: t("va2.aov"), value: money(aov), change: delta(aov, aovPrev) },
    { key: "net", label: t("va2.net"), value: money(Math.max(0, k.revenue - k.commission)), change: null, hint: t("va2.netHint", { commission: money(k.commission) }) },
    { key: "units", label: t("va2.units"), value: String(k.units), change: null },
    { key: "buyers", label: t("va2.buyers"), value: String(k.buyers), change: null, hint: t("va2.repeatHint", { percent: repeatRate }) },
  ];

  return (
    <section aria-labelledby="va2-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="va2-title" className="text-lg font-black text-text">{t("va2.title")}</h2>
          <p className="text-xs text-text-muted">{t("va2.subtitle", { days: data.days })}</p>
        </div>
        <div role="group" aria-label={t("va2.period")} className="flex gap-1 rounded-lg border border-border bg-surface p-1 shadow-1">
          {PERIODS.map((d) => {
            const next = new URLSearchParams(params);
            next.set("days", String(d));
            return (
              <Link key={d} to={`?${next.toString()}`} preventScrollReset replace aria-current={data.days === d ? "true" : undefined}
                className={`num rounded-md px-3 py-1.5 text-xs font-extrabold transition-colors ${data.days === d ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint hover:text-text"}`}>
                {t("va2.days", { count: d })}
              </Link>
            );
          })}
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <li key={c.key} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-1">
            <span className="text-xs font-bold text-text-muted">{c.label}</span>
            <span className="num text-xl font-black text-text">{c.value}</span>
            {c.change != null ? (
              <span className={`num w-fit rounded-full px-2 py-0.5 text-2xs font-black ${c.change >= 0 ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"}`} dir="ltr">
                {c.change >= 0 ? "▲" : "▼"} {Math.abs(c.change)}%
              </span>
            ) : c.hint ? <span className="text-2xs text-text-faint">{c.hint}</span> : null}
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RevenueChart series={data.series} lang={lang} />
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-1">
          <h3 className="text-sm font-extrabold text-text">{t("va2.health")}</h3>
          <Meter label={t("va2.delivered")} value={k.delivered} total={k.all_orders} tone="bg-success" />
          <Meter label={t("va2.inProgress")} value={k.in_progress} total={k.all_orders} tone="bg-warning" />
          <Meter label={t("va2.cancelled")} value={k.cancelled} total={k.all_orders} tone="bg-danger" />
          <dl className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <Stat label={t("va2.cancelRate")} value={`${cancelRate}%`} />
            <Stat label={t("va2.refunds")} value={String(k.refunds)} />
            <Stat label={t("va2.shipTime")} value={k.avg_ship_hours != null ? t("va2.hours", { count: Number(k.avg_ship_hours) }) : "—"} />
            <Stat label={t("va2.rating")} value={k.rating_avg != null ? (
              <span className="inline-flex items-center gap-1.5">
                <Rating value={Number(k.rating_avg)} size="sm" />
                <span>{Number(k.rating_avg).toFixed(1)}</span>
                <span className="text-text-muted">({k.rating_count})</span>
              </span>
            ) : "—"} />
          </dl>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t("va2.topProducts")} empty={data.top_products.length === 0} emptyText={t("va2.noSales")}>
          <ol className="flex flex-col gap-2.5">
            {data.top_products.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <span className="num w-4 text-xs font-black text-text-faint">{i + 1}</span>
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint text-text-faint">
                  {p.image ? <img src={publicMediaUrl(supabaseUrl, p.image)} alt="" width={40} height={40} loading="lazy" className="size-full object-cover" /> : <PackageIcon className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-text">{L(p)}</span>
                  <span className="num text-2xs text-text-muted">{t("va2.unitsSold", { count: p.units })}</span>
                </span>
                <span className="num text-sm font-extrabold text-text">{money(p.revenue)}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title={t("va2.topCategories")} empty={data.top_categories.length === 0} emptyText={t("va2.noSales")}>
          <BarList rows={data.top_categories.map((c) => ({ label: L(c), value: c.revenue, text: money(c.revenue) }))} />
        </Panel>
        <Panel title={t("va2.topGovernorates")} empty={data.top_governorates.length === 0} emptyText={t("va2.noSales")}>
          <BarList rows={data.top_governorates.map((g) => ({ label: L(g), value: g.orders, text: t("va2.ordersCount", { count: g.orders }) }))} />
        </Panel>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <InfoTile label={t("va2.liveProducts")} value={String(k.live_products)} />
        <InfoTile label={t("va2.stockUnits")} value={String(k.stock_units)} />
        <InfoTile label={t("va2.stockValue")} value={money(k.stock_value)} />
        <InfoTile label={t("va2.views")} value={String(k.views)} hint={t("va2.viewsHint")} />
      </ul>
    </section>
  );
}

function RevenueChart({ series, lang }: { series: VendorAnalyticsData["series"]; lang: "ar" | "en" }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...series.map((d) => d.revenue)), [series]);
  const total = series.reduce((sum, d) => sum + d.revenue, 0);
  const W = 640, H = 180, pad = 4;
  const bw = (W - pad * 2) / Math.max(1, series.length);
  const shown = hover != null ? series[hover] : null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold text-text">{t("va2.dailyRevenue")}</h3>
        <span className="num text-xs font-bold text-text-muted" aria-live="polite">
          {shown ? `${new Date(shown.day).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" })} · ${formatPiastres(shown.revenue, lang)} · ${t("va2.ordersCount", { count: shown.orders })}` : formatPiastres(total, lang)}
        </span>
      </div>
      {total === 0 ? (
        <p className="flex h-[180px] items-center justify-center rounded-lg bg-surface-tint text-sm text-text-muted">{t("va2.noSales")}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" role="img" aria-label={t("va2.dailyRevenue")} onMouseLeave={() => setHover(null)} direction="ltr">
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} stroke="var(--color-border)" strokeDasharray="3 4" />)}
          {series.map((d, i) => {
            const h = Math.max(d.revenue > 0 ? 3 : 0, ((H - 8) * d.revenue) / max);
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}>
                <rect x={pad + i * bw} y={0} width={bw} height={H} fill="transparent" />
                <rect x={pad + i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={h} rx={2}
                  fill={hover === i ? "var(--color-action-hover)" : "var(--color-action)"} opacity={hover == null || hover === i ? 1 : 0.55} />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function Meter({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs"><span className="font-bold text-text">{label}</span><span className="num text-text-muted">{value} · {pct}%</span></div>
      <span className="h-2 overflow-hidden rounded-full bg-surface-tint"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-md bg-surface-tint px-2.5 py-2"><dt className="text-2xs text-text-muted">{label}</dt><dd className="num font-extrabold text-text">{value}</dd></div>;
}

function Panel({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-1">
      <h3 className="text-sm font-extrabold text-text">{title}</h3>
      {empty ? <p className="py-6 text-center text-xs text-text-muted">{emptyText}</p> : children}
    </div>
  );
}

function BarList({ rows }: { rows: Array<{ label: string; value: number; text: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <div className="flex justify-between gap-2 text-xs"><span className="truncate font-bold text-text">{r.label}</span><span className="num shrink-0 text-text-muted">{r.text}</span></div>
          <span className="h-2 overflow-hidden rounded-full bg-surface-tint"><span className="block h-full rounded-full bg-action" style={{ width: `${(r.value / max) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

function InfoTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface px-4 py-3 shadow-1">
      <span className="text-xs font-bold text-text-muted">{label}</span>
      <span className="num text-lg font-black text-text">{value}</span>
      {hint ? <span className="text-2xs text-text-faint">{hint}</span> : null}
    </li>
  );
}
