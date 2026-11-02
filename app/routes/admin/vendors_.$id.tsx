import { data, Link } from "react-router";
import type { Route } from "./+types/vendors_.$id";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Badge } from "~/components/ui/Badge";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { MediaImage } from "~/features/media/components/media-ui";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * H-25 (owner) — Vendor DETAIL page: the admin clicks a store in the list and
 * sees EVERYTHING about it in one read-first page: real stats (approved
 * products, order groups, sales, rating), wallet, penalties, ads, and the 10
 * most recent order groups linking to each order. Editing controls stay on
 * the existing 3-tab edit page (linked from here) — this page is read-only.
 */

interface GroupRow {
  id: string; order_id: string; status: string;
  items_subtotal_piastres: number; commission_piastres: number; created_at: string;
  orders: { number: string };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const vendorId = String(params.id ?? "");
  const SUPABASE_URL = process.env.SUPABASE_URL ?? "";

  const vendorRes = await client
    .from("vendors")
    .select(`id, slug, store_name_ar, store_name_en, short_desc_ar, short_desc_en,
             logo_path, banner_path, phone, status, verification_status, verification_note,
             level_id, hidden_from_listings, is_featured,
             socials, created_at, submitted_at, reviewed_at,
             vendor_levels(name_ar, name_en),
             areas(name_ar, name_en)`)
    .eq("id", vendorId)
    .maybeSingle();
  if (!vendorRes.data) throw new Response("vendor not found", { status: 404 });
  const v = vendorRes.data as {
    id: string; slug: string; store_name_ar: string; store_name_en: string;
    short_desc_ar: string; short_desc_en: string; logo_path: string | null; banner_path: string | null;
    phone: string | null; status: string; verification_status: string; verification_note: string | null;
    hidden_from_listings: boolean; is_featured: boolean;
    socials: Record<string, string> | null; created_at: string; submitted_at: string | null; reviewed_at: string | null;
    vendor_levels: { name_ar: string; name_en: string } | null;
    areas: { name_ar: string; name_en: string } | null;
  };

  const [
    { count: productsCount },
    { data: groupAgg, error: aggErr },
    { data: ratingAgg },
    { data: wallet },
    { data: penalties },
    { data: ads },
    { data: recentGroups },
    owner,
  ] = await Promise.all([
    client.from("products").select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId).eq("status", "approved").is("deleted_at", null),
    client.from("order_vendor_groups")
      .select("items_subtotal_piastres, commission_piastres")
      .eq("vendor_id", vendorId),
    client.from("reviews")
      .select("rating").eq("vendor_id", vendorId).eq("status", "published"),
    client.from("wallets").select("available_piastres, pending_piastres").eq("vendor_id", vendorId).maybeSingle(),
    client.from("vendor_penalties").select("id, amount_piastres, reason, status, created_at")
      .eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(10),
    client.from("ad_campaigns").select("id, source, status, started_at, ends_at, ad_packages(name_ar, name_en)")
      .eq("vendor_id", vendorId)
      .order("started_at", { ascending: false }).limit(10),
    client.from("order_vendor_groups")
      .select(`id, order_id, status, items_subtotal_piastres, commission_piastres, created_at,
               orders!inner(number)`)
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(10),
    (async () => {
      const { data: m } = await client.from("store_members").select("user_id").eq("vendor_id", vendorId).eq("role", "owner").maybeSingle();
      if (!m) return null;
      const { data: p } = await client.from("profiles").select("email, phone, full_name").eq("id", (m as { user_id: string }).user_id).maybeSingle();
      return p as { email: string | null; phone: string | null; full_name: string | null } | null;
    })(),
  ]);
  if (aggErr) throw new Error(aggErr.message);

  const ordersCount = (groupAgg ?? []).length;
  const salesSum = (groupAgg ?? []).reduce((s: number, g: { items_subtotal_piastres: number }) => s + (g.items_subtotal_piastres ?? 0), 0);
  const commissionSum = (groupAgg ?? []).reduce((s: number, g: { commission_piastres: number }) => s + (g.commission_piastres ?? 0), 0);
  const ratings = (ratingAgg ?? []) as Array<{ rating: number }>;
  const ratingAvg = ratings.length
    ? Math.round((ratings.reduce((s, r) => s + Number(r.rating), 0) / ratings.length) * 10) / 10
    : null;

  const adsForVendor = ((ads ?? []) as unknown as Array<Record<string, unknown>>);

  return data({
    lang,
    supabaseUrl: SUPABASE_URL,
    vendor: JSON.parse(JSON.stringify(v)),
    stats: {
      products: productsCount ?? 0,
      orders: ordersCount,
      sales: salesSum,
      commission: commissionSum,
      ratingAvg,
      ratingCount: ratings.length,
    },
    wallet: JSON.parse(JSON.stringify(wallet ?? { available_piastres: 0, pending_piastres: 0 })),
    penalties: JSON.parse(JSON.stringify(penalties ?? [])),
    ads: JSON.parse(JSON.stringify(adsForVendor)),
    recentOrders: JSON.parse(JSON.stringify(recentGroups ?? [])) as GroupRow[],
    owner: JSON.parse(JSON.stringify(owner ?? null)),
  });
}

export default function AdminVendorDetail({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number | null | undefined) => formatPiastres(Number(p ?? 0), en ? "en" : "ar");
  const v = loaderData.vendor;
  const s = loaderData.stats;
  const socials = (v.socials ?? {}) as Record<string, string>;
  const statusTone = v.status === "active" ? "success" : v.status === "pending" ? "warning" : v.status === "draft" ? "neutral" : "danger";

  const infoRows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t("vd.email"), value: <span dir="ltr" className="num">{loaderData.owner?.email ?? "—"}</span> },
    { label: t("vd.ownerName"), value: loaderData.owner?.full_name ?? "—" },
    { label: t("vd.phone"), value: v.phone ? <span dir="ltr" className="num">{v.phone}</span> : "—" },
    { label: t("vd.area"), value: v.areas ? (en ? v.areas.name_en : v.areas.name_ar) : "—" },
    { label: t("vd.level"), value: v.vendor_levels ? (en ? v.vendor_levels.name_en : v.vendor_levels.name_ar) : "—" },
    { label: t("vd.slug"), value: <span dir="ltr" className="num">{v.slug}</span> },
    { label: t("vd.submittedAt"), value: v.submitted_at ? v.submitted_at.slice(0, 10) : "—" },
    { label: t("vd.reviewedAt"), value: v.reviewed_at ? v.reviewed_at.slice(0, 10) : "—" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint">
            {v.logo_path ? (
              <MediaImage path={v.logo_path} alt="" width={56} height={56} supabaseUrl={loaderData.supabaseUrl} className="size-full object-cover" />
            ) : (
              <span aria-hidden="true" className="text-lg font-black text-text-faint">{(en ? v.store_name_en : v.store_name_ar).slice(0, 1)}</span>
            )}
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-text">{en ? v.store_name_en : v.store_name_ar}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={statusTone}>{t(`vendorStates.status.${v.status}`)}</Badge>
              <Badge tone={v.verification_status === "verified" ? "success" : "neutral"}>
                {t(`vendorStates.verification.${v.verification_status}`)}
              </Badge>
              {v.hidden_from_listings ? <Badge tone="warning">{t("vd.hidden")}</Badge> : null}
            </div>
          </div>
        </div>
        <Link
          to={`/${loaderData.lang}/admin/vendors/${v.id}/edit`}
          className="rounded-md bg-action px-4 py-2 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
        >
          {t("vd.editSettings")}
        </Link>
      </div>

      {/* stats tiles */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: t("vd.statProducts"), value: s.products, money: null as number | null },
          { label: t("vd.statOrders"), value: s.orders, money: null },
          { label: t("vd.statSales"), value: null, money: s.sales },
          { label: t("vd.statRating"), value: s.ratingAvg != null ? s.ratingAvg : "—", money: null },
        ].map((tile) => (
          <div key={tile.label} className="rounded-md border border-border bg-surface p-3">
            <dt className="text-xs font-bold text-text-muted">{tile.label}</dt>
            <dd className="num mt-1 text-lg font-extrabold text-text">{tile.value ?? money(tile.money)}</dd>
            {tile.label === t("vd.statRating") && s.ratingCount > 0 ? (
              <dd className="mt-0.5 text-2xs text-text-faint">{t("vd.ratingCount", { count: s.ratingCount })}</dd>
            ) : null}
          </div>
        ))}
      </dl>

      {/* basic info grid */}
      <section aria-label={t("vd.infoTitle")} className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("vd.infoTitle")}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {infoRows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
              <dt className="text-xs font-bold text-text-muted">{row.label}</dt>
              <dd className="min-w-0 truncate text-sm font-bold text-text">{row.value}</dd>
            </div>
          ))}
        </dl>
        {Object.keys(socials).length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(socials).filter(([, url]) => url).map(([key, url]) => (
              <a key={key} href={url} target="_blank" rel="noreferrer"
                className="rounded-md border border-border px-2.5 py-1 text-xs font-bold text-primary hover:bg-surface-tint" dir="ltr">
                {key}
              </a>
            ))}
          </div>
        ) : null}
      </section>

      {/* wallet + penalties + ads (summary; full control lives on the edit page) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label={t("vd.wallet")} className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-extrabold text-text">{t("vd.wallet")}</h2>
          <p className="num mt-2 text-lg font-extrabold text-text" dir="ltr">{money(loaderData.wallet.available_piastres)}</p>
          <p className="mt-0.5 text-2xs text-text-faint">
            {t("vd.pending")}: <span className="num" dir="ltr">{money(loaderData.wallet.pending_piastres)}</span>
          </p>
        </section>

        <section aria-label={t("vd.penalties")} className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-extrabold text-text">{t("vd.penalties")}</h2>
          {loaderData.penalties.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{t("vd.none")}</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border/60">
              {loaderData.penalties.map((p: { id: string; amount_piastres: number; reason: string; status: string; created_at: string }) => (
                <li key={p.id} className="py-1.5 text-sm">
                  <span className="num font-bold text-text" dir="ltr">{money(p.amount_piastres)}</span>
                  <span className="ms-2 rounded-md bg-surface-tint px-1.5 py-0.5 text-2xs font-bold text-text-muted">{t(`pen.status_${p.status}`)}</span>
                  <span className="block truncate text-xs text-text-muted" title={p.reason}>{p.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={t("vd.ads")} className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-extrabold text-text">{t("vd.ads")}</h2>
          {loaderData.ads.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{t("vd.none")}</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border/60">
              {loaderData.ads.map((a: { id: string; source: string; status: string; started_at: string; ad_packages?: { name_ar: string; name_en: string } | null }) => (
                <li key={a.id} className="py-1.5 text-sm">
                  <span className="font-bold text-text">{a.ad_packages ? (en ? a.ad_packages.name_en : a.ad_packages.name_ar) : "—"}</span>
                  <span className="ms-2 rounded-md bg-surface-tint px-1.5 py-0.5 text-2xs font-bold text-text-muted">{t(`ads.source_${a.source}`)}</span>
                  <span className="block text-xs text-text-muted" dir="ltr">{a.started_at?.slice(0, 10)} · {a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* recent orders */}
      <section aria-label={t("vd.ordersTitle")} className="rounded-md border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-extrabold text-text">{t("vd.ordersTitle")}</h2>
        {loaderData.recentOrders.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t("vd.noOrders")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-tint">
                <tr>
                  <th className="p-2.5 text-start font-bold">{t("vd.colNumber")}</th>
                  <th className="p-2.5 text-start font-bold">{t("vd.colStatus")}</th>
                  <th className="p-2.5 text-start font-bold">{t("vd.colTotal")}</th>
                  <th className="p-2.5 text-start font-bold">{t("vd.colCommission")}</th>
                  <th className="p-2.5 text-start font-bold">{t("vd.colDate")}</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.recentOrders.map((g: GroupRow) => (
                  <tr key={g.id} className="border-t border-border/60">
                    <td className="p-2.5">
                      <Link to={`/${loaderData.lang}/order/${g.orders.number}`} className="num font-bold text-primary hover:underline" dir="ltr">
                        {g.orders.number}
                      </Link>
                    </td>
                    <td className="p-2.5"><Badge tone={g.status === "delivered" ? "success" : g.status === "cancelled" ? "danger" : "info"}>{t(`order.status_${g.status}`, { defaultValue: g.status })}</Badge></td>
                    <td className="num p-2.5 font-bold text-text" dir="ltr">{money(g.items_subtotal_piastres)}</td>
                    <td className="num p-2.5 text-text-muted" dir="ltr">{money(g.commission_piastres)}</td>
                    <td className="num p-2.5 text-xs text-text-muted" dir="ltr">{g.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** H-06: friendly route error page */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: stable hydrate fallback */
export function HydrateFallback() {
  return <SkeletonTable rows={6} cols={4} />;
}
