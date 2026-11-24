import { BANNER_SIZES } from "~/components/catalog/FitBanner";
import { useEffect, useState, type ReactNode } from "react";
import { data, redirect, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/ads";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { parseMediaSettings, type MediaSettings } from "~/lib/media.shared";
import { getSiteUrl } from "~/lib/env.server";
import { loadKashierSettings, reconcileKashierOrder, resolveKashierMode, startKashierPayment } from "~/features/checkout/kashier.server";
import { MediaImg } from "~/components/catalog/MediaImg";
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import { POPUP_TEMPLATES } from "~/components/catalog/AdPopup";
import { Badge, Button, Dialog } from "~/components/ui";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { EmptyState } from "~/components/ui/EmptyState";
import { ChartIcon, CheckIcon, ChevronDownIcon, CreditCardIcon, EyeIcon, MegaphoneIcon, PackageIcon, PlusIcon, StoreIcon, TrashIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * Vendor ads (owner brief 2026-11-13): the packages the admin publishes, a
 * purchase flow — fill every slot of the package (which product, which banner
 * image, which home section / category / popup design, in your own order) →
 * pay by card (Kashier) or from the wallet, never cash on delivery — then the
 * order waits for the admin's review; approved ads start at once. Below: the
 * vendor's orders (with refunds of rejected ones) and live campaigns with
 * their impressions and clicks.
 */

interface PackageItem { placement: string; count: number; sections?: string[]; spots?: string[]; templates?: string[] }
interface PackageRow {
  id: string; name_ar: string; name_en: string; desc_ar: string; desc_en: string; duration_days: number;
  price_piastres: number; discount_percent: number; discount_ends_at: string | null; items: PackageItem[];
  pricing_model: string; impressions_included: number | null; is_featured: boolean;
}
interface PlacementRow { code: string; kind: string; name_ar: string; name_en: string; desc_ar: string; desc_en: string; needs_product: boolean; needs_image: boolean }
interface OrderRow {
  id: string; number: string; status: string; payment_status: string; payment_method: string; amount_piastres: number;
  created_at: string; decided_at: string | null; reject_reason: string | null; refund_method: string | null;
  starts_at: string | null; ends_at: string | null; package_snapshot: { name_ar?: string; name_en?: string; duration_days?: number };
}
interface CampaignRow {
  id: string; placement: string | null; status: string; started_at: string; ends_at: string; impressions: number; clicks: number;
  impressions_limit: number | null; product_id: string | null; section: string | null; source: string;
}
interface Slot { placement: string; product_id: string; image_path: string; link_url: string; section: string; spot: string; category_id: string; template: string }

const SECTIONS = ["best", "discounts", "best_selling", "top_rated", "recent"] as const;
const SPOTS = ["after_brands", "after_categories", "after_best", "after_best_selling", "after_top_rated", "after_vendors", "after_recent", "bottom"] as const;
const SECTION_LABEL: Record<string, string> = { best: "home.sections.best", discounts: "home.sections.discounts", best_selling: "home.sections.bestSellers", top_rated: "home.sections.topRated", recent: "home.sections.recent" };

const priceOf = (p: PackageRow) =>
  p.discount_percent > 0 && (!p.discount_ends_at || new Date(p.discount_ends_at) > new Date())
    ? Math.floor((p.price_piastres * (100 - p.discount_percent)) / 100) : p.price_piastres;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const { data: ownVendor } = await client.rpc("own_vendor_id");
  const vendorId = (ownVendor as string | null) ?? null;
  const url = new URL(request.url);
  // back from Kashier: settle the order now instead of waiting for the webhook
  const returned = url.searchParams.get("order");
  if (returned && url.searchParams.get("kashier") === "return") {
    const admin = getSupabaseAdminClient();
    if (admin) await reconcileKashierOrder(admin, "ad", returned).catch(() => null);
  }
  const [pkgs, places, orders, camps, prods, cats, wallet, media, kashier, store] = await Promise.all([
    client.from("ad_packages").select("id, name_ar, name_en, desc_ar, desc_en, duration_days, price_piastres, discount_percent, discount_ends_at, items, pricing_model, impressions_included, is_featured")
      .eq("is_active", true).eq("visibility", "vendors").order("sort").order("price_piastres"),
    client.from("ad_placements").select("code, kind, name_ar, name_en, desc_ar, desc_en, needs_product, needs_image").eq("is_active", true).order("sort"),
    vendorId ? client.from("ad_orders").select("id, number, status, payment_status, payment_method, amount_piastres, created_at, decided_at, reject_reason, refund_method, starts_at, ends_at, package_snapshot")
      .eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    vendorId ? client.from("ad_campaigns").select("id, placement, status, started_at, ends_at, impressions, clicks, impressions_limit, product_id, section, source")
      .eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    vendorId ? client.from("products").select("id, name_ar, name_en, slug_ar, slug_en, product_media(path, kind, position)").eq("vendor_id", vendorId)
      .eq("status", "approved").is("deleted_at", null).order("updated_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    client.from("categories").select("id, name_ar, name_en, depth, parent_id").lte("depth", 3).is("deleted_at", null).order("depth").order("sort").limit(800),
    vendorId ? client.from("wallets").select("available_piastres").eq("vendor_id", vendorId).maybeSingle() : Promise.resolve({ data: null }),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
    loadKashierSettings(client).then((s) => resolveKashierMode(s, viewer.profile.role)).catch(() => null),
    vendorId ? client.from("vendors").select("slug").eq("id", vendorId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const products = ((prods.data ?? []) as Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string; product_media: Array<{ path: string; kind: string; position: number | null }> | null }>)
    .map((p) => ({
      id: p.id, name: lang === "en" ? p.name_en || p.name_ar : p.name_ar || p.name_en,
      // a banner links to the product page in the vendor's language
      href: `/${lang}/product/${encodeURIComponent(lang === "en" ? p.slug_en || p.slug_ar : p.slug_ar || p.slug_en)}`,
      image: (p.product_media ?? []).filter((m) => m.kind === "image").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.path ?? null,
    }));
  // category names with their parent for the pickers ("Home › Kitchen")
  const catRows = (cats.data ?? []) as Array<{ id: string; name_ar: string; name_en: string; depth: number; parent_id: string | null }>;
  const byId = new Map(catRows.map((c) => [c.id, c]));
  const categories = catRows.filter((c) => c.depth >= 2).map((c) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    const L = (x: { name_ar: string; name_en: string }) => (lang === "en" ? x.name_en || x.name_ar : x.name_ar || x.name_en);
    return { id: c.id, label: L(c), group: parent ? L(parent) : "" };
  });
  return {
    lang,
    vendorId,
    storeSlug: (store.data as { slug?: string } | null)?.slug ?? "",
    packages: (pkgs.data ?? []) as PackageRow[],
    placements: (places.data ?? []) as PlacementRow[],
    orders: (orders.data ?? []) as OrderRow[],
    campaigns: (camps.data ?? []) as CampaignRow[],
    products,
    categories,
    balance: Number((wallet.data as { available_piastres?: number } | null)?.available_piastres ?? 0),
    cardOnline: kashier !== null,
    media: parseMediaSettings((media.data as { value?: unknown } | null)?.value) as MediaSettings,
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    returnedOrder: returned,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const payByCard = async (number: string, amount: number) => {
    const settings = await loadKashierSettings(client);
    const mode = resolveKashierMode(settings, viewer.profile.role);
    const admin = getSupabaseAdminClient();
    if (!mode || !admin) return data({ ok: false, reason: "card_unavailable" }, { status: 400 });
    const session = await startKashierPayment(admin, "ad", {
      mode, orderNumber: number, totalPiastres: amount, lang,
      siteUrl: getSiteUrl(request.url),
      returnPath: `/${lang}/vendor/ads?tab=orders&order=${encodeURIComponent(number)}`,
      customer: { email: viewer.user.email ?? "", reference: viewer.user.id },
      methods: settings.methods,
      description: `Etsawaa ads ${number}`,
    });
    if (!session.ok) return data({ ok: false, reason: "card_unavailable" }, { status: 502 });
    throw redirect(session.sessionUrl);
  };

  if (intent === "place") {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { return data({ ok: false, reason: "bad_input" }, { status: 400 }); }
    const { data: res, error } = await client.rpc("fn_vendor_place_ad_order", { p_payload: payload });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string; number?: string; status?: string; amount_piastres?: number; method?: string };
    if (!r.ok) return data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
    if (r.method === "card" && r.status === "pending_payment" && r.number) return payByCard(r.number, r.amount_piastres ?? 0);
    return { ok: true as const, number: r.number };
  }
  if (intent === "pay") {
    const number = String(form.get("number") ?? "");
    const { data: row } = await client.from("ad_orders").select("number, status, amount_piastres").eq("number", number).maybeSingle();
    const o = row as { number: string; status: string; amount_piastres: number } | null;
    if (!o || o.status !== "pending_payment") return data({ ok: false, reason: "not_awaiting_payment" }, { status: 400 });
    return payByCard(o.number, o.amount_piastres);
  }
  if (intent === "cancel") {
    const { data: res } = await client.rpc("fn_vendor_cancel_ad_order", { p_number: String(form.get("number") ?? "") });
    const r = res as { ok: boolean; reason?: string } | null;
    return r?.ok ? { ok: true as const } : data({ ok: false, reason: r?.reason ?? "failed" }, { status: 400 });
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function VendorAds({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, packages, placements, orders, campaigns, products, balance } = loaderData;
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const [params, setParams] = useSearchParams();
  const tab = (["packages", "orders", "campaigns"] as const).find((x) => x === params.get("tab")) ?? "packages";
  const [buying, setBuying] = useState<PackageRow | null>(null);
  const place = (code: string) => placements.find((p) => p.code === code);
  const placeName = (code: string | null) => { const p = code ? place(code) : undefined; return p ? (en ? p.name_en : p.name_ar) : "—"; };

  const now = Date.now();
  const live = campaigns.filter((c) => c.status === "active" && new Date(c.ends_at).getTime() > now);
  const impressions = campaigns.reduce((n, c) => n + c.impressions, 0);
  const clicks = campaigns.reduce((n, c) => n + c.clicks, 0);
  const waiting = orders.filter((o) => o.status === "in_review" || o.status === "pending_payment").length;
  const num = (n: number) => n.toLocaleString(en ? "en" : "ar-EG-u-nu-latn");
  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("va.title")} subtitle={t("va.hint2")} />

      {/* performance strip */}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<MegaphoneIcon />} label={t("va.statLive")} value={num(live.length)} accent />
        <Stat icon={<EyeIcon />} label={t("va.statImpressions")} value={num(impressions)} />
        <Stat icon={<ChartIcon />} label={t("va.statClicks")} value={num(clicks)} sub={impressions > 0 ? t("va.ctr", { ctr: ((clicks / impressions) * 100).toFixed(1) }) : undefined} />
        <Stat icon={<PackageIcon />} label={t("va.statWaiting")} value={num(waiting)} />
        <Stat icon={<CreditCardIcon />} label={t("va.wallet")} value={money(balance)} />
      </dl>

      <nav className="flex gap-1.5 rounded-lg border border-border bg-surface p-1.5 shadow-1" role="tablist">
        {(["packages", "orders", "campaigns"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            onClick={() => setParams((sp) => { sp.set("tab", k); sp.delete("order"); sp.delete("kashier"); return sp; }, { replace: true, preventScrollReset: true })}
            className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-extrabold transition-colors sm:flex-none ${tab === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint hover:text-text"}`}>
            {t(`va.tab.${k}`)}
            {k === "orders" && waiting ? <span className="num ms-1.5 rounded-full bg-on-action/20 px-1.5 text-2xs">{waiting}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "packages" ? (
        packages.length === 0 ? (
          <EmptyState title={t("va.noPackages")} body={t("va.noPackagesHint")} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((p) => {
              const price = priceOf(p);
              const discounted = price < p.price_piastres;
              return (
                <li key={p.id} className={`relative flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-1 transition-shadow hover:shadow-2 ${p.is_featured ? "border-action" : "border-border"}`}>
                  {p.is_featured ? <span className="absolute end-3 top-3 rounded-full bg-action px-2.5 py-1 text-2xs font-black text-on-action">{t("va.popular")}</span> : null}
                  <div className="flex flex-col gap-2 border-b border-border bg-gradient-to-b from-surface-tint/70 to-surface p-5">
                    <span className="grid size-11 place-items-center rounded-xl bg-action/10 text-action"><MegaphoneIcon className="size-5" /></span>
                    <h3 className="text-lg font-black text-text">{en ? p.name_en || p.name_ar : p.name_ar || p.name_en}</h3>
                    {(en ? p.desc_en : p.desc_ar) ? <p className="text-sm leading-6 text-text-muted">{en ? p.desc_en : p.desc_ar}</p> : null}
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="num text-2xl font-black text-action">{money(price)}</span>
                      {discounted ? <s className="num text-sm font-bold text-text-muted">{money(p.price_piastres)}</s> : null}
                      {discounted ? <Badge tone="danger">-{p.discount_percent}%</Badge> : null}
                    </p>
                    <p className="text-xs font-bold text-text-muted">
                      {p.pricing_model === "cpm" && p.impressions_included ? t("va.forImpressions", { count: p.impressions_included, days: p.duration_days }) : t("va.forDays", { count: p.duration_days })}
                    </p>
                  </div>
                  <ul className="flex flex-1 flex-col gap-2.5 p-5">
                    {p.items.map((it, i) => {
                      const pl = place(it.placement);
                      return (
                        <li key={i} className="flex items-start gap-2.5 text-sm">
                          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                          <span>
                            <b className="text-text">{pl?.kind === "service" ? placeName(it.placement) : t("va.itemCount", { count: it.count, name: placeName(it.placement) })}</b>
                            {pl ? <span className="block text-xs leading-5 text-text-muted">{en ? pl.desc_en : pl.desc_ar}</span> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="p-5 pt-0">
                    <Button className="w-full" onClick={() => setBuying(p)}>{t("va.buy")}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {tab === "orders" ? (
        orders.length === 0 ? <EmptyState title={t("va.noOrders")} body={t("va.noOrdersHint")} /> : (
          <ul className="flex flex-col gap-3">
            {orders.map((o) => <OrderCard key={o.id} order={o} lang={lang} highlight={o.number === loaderData.returnedOrder} cardOnline={loaderData.cardOnline} />)}
          </ul>
        )
      ) : null}

      {tab === "campaigns" ? (
        campaigns.length === 0 ? <EmptyState title={t("va.empty")} body={t("va.emptyHint2")} /> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {campaigns.map((c) => {
              const start = new Date(c.started_at).getTime(), end = new Date(c.ends_at).getTime();
              const isLive = c.status === "active" && end > now;
              const pct = c.impressions_limit ? Math.min(100, (c.impressions / c.impressions_limit) * 100) : Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
              const daysLeft = Math.max(0, Math.ceil((end - now) / 86_400_000));
              return (
                <li key={c.id} className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-1 ${isLive ? "border-action/40" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-text">{productName(c.product_id) ?? placeName(c.placement)}</p>
                      <p className="truncate text-xs text-text-muted">{placeName(c.placement)}{c.section ? ` · ${t(SECTION_LABEL[c.section] ?? "")}` : ""}</p>
                    </div>
                    <Badge tone={isLive ? "success" : c.status === "cancelled" ? "danger" : "neutral"} dot={isLive}>{t(`va.status_${isLive ? "active" : c.status === "active" ? "expired" : c.status}`)}</Badge>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-tint"><div className="h-full rounded-full bg-action" style={{ width: `${pct}%` }} /></div>
                  <dl className="grid grid-cols-4 gap-2 text-center">
                    <Mini label={t("va.impressions")} value={num(c.impressions)} />
                    <Mini label={t("va.clicks")} value={num(c.clicks)} />
                    <Mini label={t("va.ctrShort")} value={c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(1)}%` : "—"} />
                    <Mini label={t("va.daysLeft")} value={isLive ? num(daysLeft) : "—"} />
                  </dl>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {buying ? <BuyDialog pkg={buying} onClose={() => setBuying(null)} data={loaderData} /> : null}
    </div>
  );
}

function OrderCard({ order: o, lang, highlight, cardOnline }: { order: OrderRow; lang: string; highlight: boolean; cardOnline: boolean }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const fetcher = useFetcher();
  useActionToast(fetcher, { success: t("common.saved") });
  const tone = o.status === "approved" ? "success" : o.status === "rejected" || o.status === "cancelled" ? "danger" : o.status === "in_review" ? "info" : "warning";
  const day = (v: string | null) => (v ? new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const steps = ["pending_payment", "in_review", "approved"] as const;
  const reached = o.status === "approved" ? 3 : o.status === "in_review" ? 2 : o.status === "pending_payment" ? 1 : 0;
  return (
    <li className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-1 ${highlight ? "border-action ring-2 ring-action/20" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-extrabold text-text">{en ? o.package_snapshot.name_en || o.package_snapshot.name_ar : o.package_snapshot.name_ar || o.package_snapshot.name_en}</p>
          <p className="num text-xs text-text-muted" dir="ltr">{o.number} · {day(o.created_at)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={tone}>{t(`va.order.${o.status}`)}</Badge>
          <span className="num text-sm font-black text-text">{formatPiastres(o.amount_piastres, en ? "en" : "ar")}</span>
        </div>
      </div>
      {o.status !== "rejected" && o.status !== "cancelled" ? (
        <ol className="grid grid-cols-3 gap-1.5">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-col gap-1">
              <span className={`h-1.5 rounded-full ${i < reached ? "bg-action" : "bg-surface-tint"}`} />
              <span className={`text-2xs font-bold ${i < reached ? "text-text" : "text-text-faint"}`}>{t(`va.step.${s}`)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="text-xs text-text-muted">
        {t(`va.paidBy.${o.payment_method}`)}
        {o.status === "approved" && o.ends_at ? ` · ${t("va.runsUntil", { date: day(o.ends_at) })}` : ""}
      </p>
      {o.status === "rejected" ? (
        <div className="rounded-lg bg-danger-soft p-3 text-sm text-text">
          <b>{t("va.rejectedBecause")}</b> {o.reject_reason}
          {o.payment_status === "refunded" ? <p className="mt-1 text-xs font-bold text-text-muted">{t(o.refund_method === "withdrawal" ? "va.refundedWithdrawal" : "va.refundedWallet")}</p> : null}
        </div>
      ) : null}
      {o.status === "pending_payment" ? (
        <fetcher.Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="number" value={o.number} />
          {cardOnline ? <Button type="submit" name="intent" value="pay" size="sm" loading={fetcher.state !== "idle"}>{t("va.payNow")}</Button> : null}
          <Button type="submit" name="intent" value="cancel" size="sm" variant="ghost">{t("va.cancelOrder")}</Button>
        </fetcher.Form>
      ) : null}
    </li>
  );
}

/** Fill the package's slots, then choose how to pay. */
function BuyDialog({ pkg, onClose, data: d }: { pkg: PackageRow; onClose: () => void; data: Route.ComponentProps["loaderData"] }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const fetcher = useFetcher<{ ok: boolean; reason?: string; number?: string }>();
  const price = priceOf(pkg);
  const [step, setStep] = useState<1 | 2>(1);
  const [method, setMethod] = useState<"card" | "wallet">(d.cardOnline ? "card" : "wallet");
  const [notes, setNotes] = useState("");
  const [attemptKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`));
  const place = (code: string) => d.placements.find((p) => p.code === code);
  const [slots, setSlots] = useState<Slot[]>(() => pkg.items.flatMap((it) => {
    const pl = place(it.placement);
    if (!pl || pl.kind === "service") return [];
    // several home-section slots start on different sections (a 3-section package → one each)
    return Array.from({ length: Math.max(1, it.count) }, (_, k) => ({
      placement: it.placement, product_id: "", image_path: "", link_url: "", category_id: "",
      section: it.placement === "home_section" ? (it.sections?.length ? it.sections[k % it.sections.length]! : SECTIONS[k % SECTIONS.length]!) : "",
      spot: it.placement === "home_spot" ? (it.spots?.[0] ?? "after_categories") : "",
      template: it.placement === "popup" ? (it.templates?.[0] ?? "spotlight") : "",
    }));
  }));
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const set = (i: number, patch: Partial<Slot>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => setSlots((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length || s[j]!.placement !== s[i]!.placement) return s;
    const copy = s.slice(); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; return copy;
  });
  const missing = slots.some((s) => {
    const pl = place(s.placement);
    // banner slots: the team prepares and places the banner after payment
    return (pl?.needs_product && !s.product_id) || (s.placement === "category_featured" && !s.category_id);
  });
  const canWallet = d.balance >= price;
  const services = pkg.items.filter((it) => place(it.placement)?.kind === "service");
  const productOpts = d.products.map((p) => ({ value: p.id, label: p.name }));
  const linkOpts = [
    { value: "", label: t("va.linkNone") },
    ...(d.storeSlug ? [{ value: `/${d.lang}/store/${d.storeSlug}`, label: t("va.linkStore") }] : []),
  ];
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onClose(); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const assignments = slots.map((s, i) => ({ ...s, position: i + 1 }));
    fetcher.submit({ intent: "place", payload: JSON.stringify({ attempt_key: attemptKey, package_id: pkg.id, method, notes, assignments }) }, { method: "post" });
  };
  const productLabel = (id: string) => d.products.find((p) => p.id === id);
  const groupStart = (i: number) => i === 0 || slots[i - 1]!.placement !== slots[i]!.placement;

  return (
    <Dialog open onClose={onClose} title={`${t("va.buy")}: ${en ? pkg.name_en || pkg.name_ar : pkg.name_ar || pkg.name_en}`} size="lg">
      <ol className="mb-4 grid grid-cols-2 gap-2 text-xs font-bold">
        {[t("va.stepSlots"), t("va.stepPay")].map((s, i) => (
          <li key={s} className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${step === i + 1 ? "bg-action text-on-action" : "bg-surface-tint text-text-muted"}`}>
            <span className="num grid size-5 place-items-center rounded-full bg-black/10">{i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="flex flex-col gap-3">
          {slots.length === 0 ? <p className="text-sm text-text-muted">{t("va.noSlots")}</p> : null}
          {slots.map((s, i) => {
            const pl = place(s.placement)!;
            const it = pkg.items.find((x) => x.placement === s.placement);
            const nth = slots.slice(0, i + 1).filter((x) => x.placement === s.placement).length;
            return (
              <div key={i} className="flex flex-col gap-3">
                {groupStart(i) ? <p className="mt-1 text-sm font-black text-text">{en ? pl.name_en : pl.name_ar}</p> : null}
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-text-muted">{t("va.slotN", { n: nth })}</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => move(i, -1)} aria-label={t("va.moveUp")} className="grid size-8 cursor-pointer place-items-center rounded-md border border-border bg-surface hover:text-action"><ChevronDownIcon className="size-4 rotate-180" /></button>
                      <button type="button" onClick={() => move(i, 1)} aria-label={t("va.moveDown")} className="grid size-8 cursor-pointer place-items-center rounded-md border border-border bg-surface hover:text-action"><ChevronDownIcon className="size-4" /></button>
                    </span>
                  </div>
                  {pl.needs_product ? (
                    <div className="flex items-center gap-3">
                      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface">
                        {productLabel(s.product_id)?.image ? <MediaImg path={productLabel(s.product_id)!.image!} alt="" width={48} height={48} className="size-full object-cover" /> : <PackageIcon className="size-5 text-text-faint" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <SelectMenu label={t("va.pickProduct")} required searchable options={productOpts} value={s.product_id || null}
                          placeholder={t("va.pickProduct")} onChange={(v) => set(i, { product_id: v ?? "" })} />
                      </div>
                    </div>
                  ) : null}
                  {pl.kind === "banner" ? (
                    <div className="flex flex-col gap-2">
                      <p className="flex items-start gap-2 rounded-lg bg-info-soft p-3 text-sm leading-6 text-text">
                        <MegaphoneIcon className="mt-1 size-4 shrink-0 text-info" />
                        <span>{t("va.bannerByTeam")}</span>
                      </p>
                      <SelectMenu label={t("va.bannerLinkOptional")} searchable value={s.link_url}
                        options={[...linkOpts, ...d.products.map((p) => ({ value: p.href, label: p.name, group: t("va.linkProducts") }))]}
                        onChange={(v) => set(i, { link_url: v ?? "" })} />
                    </div>
                  ) : null}
                  {s.placement === "home_section" ? (
                    <SelectMenu label={t("va.pickSection")} required options={(it?.sections?.length ? it.sections : [...SECTIONS]).map((x) => ({ value: x, label: t(SECTION_LABEL[x] ?? x) }))}
                      value={s.section} onChange={(v) => set(i, { section: v ?? "best" })} />
                  ) : null}
                  {s.placement === "category_featured" ? (
                    <SelectMenu label={t("va.pickCategory")} required searchable options={d.categories.map((c) => ({ value: c.id, label: c.label, group: c.group }))}
                      value={s.category_id || null} placeholder={t("va.pickCategory")} onChange={(v) => set(i, { category_id: v ?? "" })} />
                  ) : null}
                  {s.placement === "popup" ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-bold text-text">{t("va.pickTemplate")}</span>
                      <div className="grid grid-cols-3 gap-2">
                        {(it?.templates?.length ? it.templates : [...POPUP_TEMPLATES]).map((tpl) => (
                          <button key={tpl} type="button" onClick={() => set(i, { template: tpl })}
                            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 p-2 text-xs font-bold ${s.template === tpl ? "border-action text-action" : "border-border text-text-muted"}`}>
                            <TemplateThumb tpl={tpl} />{t(`ads.tpl.${tpl}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {services.length ? (
            <div className="rounded-xl border border-border bg-surface-tint/50 p-3 text-sm">
              <p className="font-extrabold text-text">{t("va.servicesIncluded")}</p>
              <ul className="mt-1 list-inside list-disc text-text-muted">{services.map((s) => <li key={s.placement}>{en ? place(s.placement)?.name_en : place(s.placement)?.name_ar}</li>)}</ul>
              <p className="mt-1 text-xs text-text-muted">{t("va.servicesHint")}</p>
            </div>
          ) : null}
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("va.notes")}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000}
              className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal focus:border-action focus:outline-none sm:text-sm" placeholder={t("va.notesPh")} />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button disabled={missing} onClick={() => setStep(2)}>{t("common.next")}</Button>
          </div>
          {missing ? <p className="text-end text-xs text-text-muted">{t("va.fillAll")}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-tint/50 p-4">
            <span className="text-sm font-bold text-text-muted">{t("va.total")}</span>
            <span className="num text-2xl font-black text-action">{formatPiastres(price, en ? "en" : "ar")}</span>
          </div>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            <MethodCard on={method === "card"} disabled={!d.cardOnline} onPick={() => setMethod("card")} icon={<CreditCardIcon />}
              title={t("va.payCard")} hint={d.cardOnline ? t("va.payCardHint") : t("va.cardOff")} />
            <MethodCard on={method === "wallet"} disabled={!canWallet} onPick={() => setMethod("wallet")} icon={<StoreIcon />}
              title={t("va.payWallet")} hint={t("va.balance", { amount: formatPiastres(d.balance, en ? "en" : "ar") }) + (canWallet ? "" : ` — ${t("va.notEnough")}`)} />
          </div>
          <p className="text-xs leading-5 text-text-muted">{t("va.reviewNote")}</p>
          {err ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">{t(`va.err.${err}`, { defaultValue: t("va.err.failed") })}</p> : null}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>{t("common.back")}</Button>
            <Button loading={fetcher.state !== "idle"} disabled={(method === "card" && !d.cardOnline) || (method === "wallet" && !canWallet)} onClick={submit}>
              {method === "card" ? t("va.payAndSend") : t("va.sendForReview")}
            </Button>
          </div>
        </div>
      )}
      <MediaPickerDialog open={pickerFor !== null} onClose={() => setPickerFor(null)} title={t("va.bannerImage")} settings={d.media}
        uid={d.uid} supabaseUrl={d.supabaseUrl} mode="single" kinds={["image"]}
        onConfirm={(files) => { if (pickerFor !== null && files[0]) set(pickerFor, { image_path: files[0].path }); setPickerFor(null); }} />
    </Dialog>
  );
}

function MethodCard({ on, disabled, onPick, icon, title, hint }: { on: boolean; disabled: boolean; onPick: () => void; icon: ReactNode; title: string; hint: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-start disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-action bg-action/5" : "border-border bg-surface"}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg [&>svg]:size-5 ${on ? "bg-action text-on-action" : "bg-surface-tint text-text-muted"}`}>{icon}</span>
      <span className="min-w-0"><b className="block text-sm text-text">{title}</b><span className="text-xs text-text-muted">{hint}</span></span>
    </button>
  );
}

/** A tiny sketch of each popup design, for choosing. */
function TemplateThumb({ tpl }: { tpl: string }) {
  if (tpl === "deal") return <span className="flex h-14 w-full flex-col overflow-hidden rounded-md border border-border"><span className="h-5 bg-action" /><span className="mx-auto -mt-2 size-6 rounded bg-surface-tint ring-2 ring-surface" /><span className="mx-auto mt-1 h-1.5 w-8 rounded bg-action/60" /></span>;
  if (tpl === "minimal") return <span className="flex h-14 w-full overflow-hidden rounded-md border border-border"><span className="w-2/5 bg-surface-tint" /><span className="flex flex-1 flex-col justify-center gap-1 p-1"><span className="h-1.5 w-3/4 rounded bg-text-faint" /><span className="h-1.5 w-1/2 rounded bg-action/60" /></span></span>;
  return <span className="relative flex h-14 w-full overflow-hidden rounded-md border border-border bg-surface-tint"><span className="absolute inset-x-0 bottom-0 h-6 bg-black/70" /><span className="absolute bottom-1 start-1 h-1.5 w-8 rounded bg-white/80" /></span>;
}

function Stat({ icon, label, value, sub, accent = false }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border p-4 shadow-1 ${accent ? "border-action/30 bg-action/5" : "border-border bg-surface"}`}>
      <dt className="flex items-center gap-1.5 text-xs font-bold text-text-muted [&>svg]:size-4">{icon}{label}</dt>
      <dd className="num text-2xl font-black text-text">{value}</dd>
      {sub ? <span className="num text-2xs font-bold text-text-muted">{sub}</span> : null}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-2xs text-text-muted">{label}</dt>
      <dd className="num text-sm font-black text-text">{value}</dd>
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: stable skeleton while the loader streams. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

