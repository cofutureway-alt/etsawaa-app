import { useEffect, useState, type ReactNode } from "react";
import { data, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/ads";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres, piastresToEgp } from "~/lib/money";
import { Badge, Button, Dialog, Input } from "~/components/ui";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { EmptyState } from "~/components/ui/EmptyState";
import { MediaImg } from "~/components/catalog/MediaImg";
import { BANNER_SIZES } from "~/components/catalog/FitBanner";
import { MediaPickerDialog } from "~/features/media/components/MediaPickerDialog";
import { parseMediaSettings, type MediaSettings } from "~/lib/media.shared";
import { POPUP_TEMPLATES } from "~/components/catalog/AdPopup";
import { CheckIcon, PackageIcon, PencilIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";

/**
 * Admin → Ads (owner brief 2026-11-13).
 *  - Orders: paid ad orders waiting for review, with every slot the vendor
 *    filled (product, banner image, section / category / popup design);
 *    approve → the campaigns start now; reject (with a reason) → refund to the
 *    vendor's wallet or as a withdrawal request on their payout method.
 *  - Packages: build a package from placements — each with a number of slots
 *    and, where it applies, which home sections / spots / popup designs the
 *    vendor may choose — plus price, temporary discount, duration (or included
 *    impressions for in-product-page ads) and visibility.
 *  - Campaigns: what runs now, with impressions / clicks; stop an order early.
 */

interface PackageItem { placement: string; count: number; sections?: string[]; spots?: string[]; templates?: string[] }
interface PkgRow {
  id: string; name_ar: string; name_en: string; desc_ar: string; desc_en: string; duration_days: number; price_piastres: number;
  discount_percent: number; discount_ends_at: string | null; visibility: string; is_active: boolean; items: PackageItem[];
  pricing_model: string; impressions_included: number | null; sort: number; is_featured: boolean;
}
interface PlacementRow { code: string; kind: string; name_ar: string; name_en: string; needs_product: boolean; needs_image: boolean }
interface Assignment { placement: string; product_id?: string; image_path?: string; link_url?: string; section?: string; spot?: string; category_id?: string; template?: string; position?: number }
interface OrderRow {
  id: string; number: string; status: string; payment_status: string; payment_method: string; amount_piastres: number; created_at: string;
  paid_at: string | null; notes: string; reject_reason: string | null; refund_method: string | null; ends_at: string | null;
  package_snapshot: { name_ar?: string; name_en?: string; duration_days?: number }; assignments: Assignment[];
  vendors: { store_name_ar: string; store_name_en: string; slug: string } | null;
}

const SECTIONS = ["best", "discounts", "best_selling", "top_rated", "recent"];
const SPOTS = ["after_brands", "after_categories", "after_best", "after_best_selling", "after_top_rated", "after_vendors", "after_recent", "bottom"];
const SECTION_LABEL: Record<string, string> = { best: "home.sections.best", discounts: "home.sections.discounts", best_selling: "home.sections.bestSellers", top_rated: "home.sections.topRated", recent: "home.sections.recent" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const [pkgs, places, orders, camps, bannerRows, allCats, media] = await Promise.all([
    client.from("ad_packages").select("id, name_ar, name_en, desc_ar, desc_en, duration_days, price_piastres, discount_percent, discount_ends_at, visibility, is_active, items, pricing_model, impressions_included, sort, is_featured").order("sort").order("created_at"),
    client.from("ad_placements").select("code, kind, name_ar, name_en, needs_product, needs_image").eq("is_active", true).order("sort"),
    client.from("ad_orders").select("id, number, status, payment_status, payment_method, amount_piastres, created_at, paid_at, notes, reject_reason, refund_method, ends_at, package_snapshot, assignments, vendors(store_name_ar, store_name_en, slug)")
      .neq("status", "cancelled").order("created_at", { ascending: false }).limit(200),
    client.from("ad_campaigns").select("id, order_id, placement, section, status, started_at, ends_at, impressions, clicks, impressions_limit, product_id, vendors(store_name_ar, store_name_en)")
      .order("created_at", { ascending: false }).limit(200),
    // the banners system: an admin may reuse one of these for a paid banner slot
    client.from("banners").select("id, title_ar, title_en, image_path, placement, is_active, vendor_id").order("created_at", { ascending: false }).limit(100),
    client.from("categories").select("id, name_ar, name_en, depth, parent_id").lte("depth", 3).is("deleted_at", null).order("depth").order("sort").limit(800),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);
  const orderRows = (orders.data ?? []) as unknown as OrderRow[];
  // names / images of the products and categories the orders point at
  const productIds = [...new Set([...orderRows.flatMap((o) => (o.assignments ?? []).map((a) => a.product_id ?? "")),
    ...((camps.data ?? []) as Array<{ product_id: string | null }>).map((c) => c.product_id ?? "")].filter(Boolean))];
  const catIds = [...new Set(orderRows.flatMap((o) => (o.assignments ?? []).map((a) => a.category_id ?? "")).filter(Boolean))];
  const [prods, cats] = await Promise.all([
    productIds.length ? client.from("products").select("id, name_ar, name_en, product_media(path, kind, position)").in("id", productIds) : Promise.resolve({ data: [] }),
    catIds.length ? client.from("categories").select("id, name_ar, name_en").in("id", catIds) : Promise.resolve({ data: [] }),
  ]);
  const products: Record<string, { name: string; image: string | null }> = {};
  for (const p of (prods.data ?? []) as Array<{ id: string; name_ar: string; name_en: string; product_media: Array<{ path: string; kind: string; position: number | null }> | null }>) {
    products[p.id] = { name: lang === "en" ? p.name_en || p.name_ar : p.name_ar || p.name_en,
      image: (p.product_media ?? []).filter((m) => m.kind === "image").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.path ?? null };
  }
  const categories: Record<string, string> = {};
  for (const c of (cats.data ?? []) as Array<{ id: string; name_ar: string; name_en: string }>) categories[c.id] = lang === "en" ? c.name_en || c.name_ar : c.name_ar || c.name_en;
  return {
    lang,
    packages: (pkgs.data ?? []) as PkgRow[],
    placements: (places.data ?? []) as PlacementRow[],
    orders: orderRows,
    campaigns: (camps.data ?? []) as unknown as Array<{ id: string; order_id: string | null; placement: string | null; section: string | null; status: string; started_at: string; ends_at: string; impressions: number; clicks: number; impressions_limit: number | null; product_id: string | null; vendors: { store_name_ar: string; store_name_en: string } | null }>,
    products,
    categories,
    banners: (bannerRows.data ?? []) as Array<{ id: string; title_ar: string; title_en: string; image_path: string; placement: string; is_active: boolean; vendor_id: string | null }>,
    categoryOptions: (() => {
      const rows = (allCats.data ?? []) as Array<{ id: string; name_ar: string; name_en: string; depth: number; parent_id: string | null }>;
      const byId = new Map(rows.map((c) => [c.id, c]));
      const L = (x: { name_ar: string; name_en: string }) => (lang === "en" ? x.name_en || x.name_ar : x.name_ar || x.name_en);
      return rows.filter((c) => c.depth >= 1).map((c) => ({ value: c.id, label: L(c), group: c.parent_id && byId.get(c.parent_id) ? L(byId.get(c.parent_id)!) : "" }));
    })(),
    media: parseMediaSettings((media.data as { value?: unknown } | null)?.value) as MediaSettings,
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "pkg_save") {
    const id = String(form.get("id") ?? "");
    let items: PackageItem[] = [];
    try { items = JSON.parse(String(form.get("items") ?? "[]")); } catch { return data({ ok: false, reason: "bad_items" }, { status: 400 }); }
    items = items.filter((it) => it && typeof it.placement === "string").map((it) => ({
      placement: it.placement, count: Math.max(1, Math.min(20, Math.trunc(Number(it.count) || 1))),
      ...(it.sections?.length ? { sections: it.sections.filter((s) => SECTIONS.includes(s)) } : {}),
      ...(it.spots?.length ? { spots: it.spots.filter((s) => SPOTS.includes(s)) } : {}),
      ...(it.templates?.length ? { templates: it.templates.filter((s) => (POPUP_TEMPLATES as readonly string[]).includes(s)) } : {}),
    }));
    if (!items.length) return data({ ok: false, reason: "no_items" }, { status: 400 });
    const discountEnds = String(form.get("discount_ends_at") ?? "");
    const payload = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      desc_ar: String(form.get("desc_ar") ?? "").trim().slice(0, 600),
      desc_en: String(form.get("desc_en") ?? "").trim().slice(0, 600),
      duration_days: Math.max(1, Math.trunc(Number(form.get("duration_days") ?? 30))),
      price_piastres: egpToPiastres(form.get("price_egp")) ?? 0,
      discount_percent: Math.max(0, Math.min(90, Math.trunc(Number(form.get("discount_percent") ?? 0)))),
      discount_ends_at: discountEnds ? new Date(discountEnds).toISOString() : null,
      visibility: ["vendors", "rewards", "admins"].includes(String(form.get("visibility"))) ? String(form.get("visibility")) : "vendors",
      pricing_model: ["fixed", "cpm", "cpc"].includes(String(form.get("pricing_model"))) ? String(form.get("pricing_model")) : "fixed",
      impressions_included: Math.trunc(Number(form.get("impressions_included") ?? 0)) || null,
      sort: Math.trunc(Number(form.get("sort") ?? 0)) || 0,
      is_featured: form.get("is_featured") === "on",
      is_active: form.get("is_active") === "on",
      items, slots: items.reduce((n, it) => n + it.count, 0),
    };
    if (!payload.name_ar || !payload.name_en) return data({ ok: false, reason: "name_required" }, { status: 400 });
    const res = id ? await client.from("ad_packages").update(payload).eq("id", id) : await client.from("ad_packages").insert(payload);
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 400 });
    return { ok: true as const };
  }
  if (intent === "pkg_toggle") {
    const res = await client.from("ad_packages").update({ is_active: form.get("on") === "1" }).eq("id", String(form.get("id") ?? ""));
    return res.error ? data({ ok: false, reason: res.error.message }, { status: 400 }) : { ok: true as const };
  }
  if (intent === "decide") {
    const { data: res, error } = await client.rpc("fn_admin_decide_ad_order", {
      p_order_id: String(form.get("id") ?? ""), p_decision: String(form.get("decision") ?? ""),
      p_reason: String(form.get("reason") ?? "") || null, p_refund_method: String(form.get("refund") ?? "wallet"),
      p_banners: (() => { try { return JSON.parse(String(form.get("banners") ?? "[]")); } catch { return []; } })(),
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  if (intent === "stop") {
    const { data: res } = await client.rpc("fn_admin_stop_ad_order", { p_order_id: String(form.get("id") ?? "") });
    return (res as { ok?: boolean } | null)?.ok ? { ok: true as const } : data({ ok: false, reason: "failed" }, { status: 400 });
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminAds({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, packages, placements, orders, campaigns, products, categories } = loaderData;
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const [params, setParams] = useSearchParams();
  const tab = (["orders", "packages", "campaigns"] as const).find((x) => x === params.get("tab")) ?? "orders";
  const [editing, setEditing] = useState<PkgRow | "new" | null>(null);
  const [deciding, setDeciding] = useState<OrderRow | null>(null);
  const fetcher = useFetcher();
  useActionToast(fetcher, { success: t("common.saved") });
  const placeName = (code: string | null) => { const p = placements.find((x) => x.code === code); return p ? (en ? p.name_en : p.name_ar) : code ?? "—"; };
  const review = orders.filter((o) => o.status === "in_review");
  const day = (v: string | null) => (v ? new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const store = (o: { vendors: { store_name_ar: string; store_name_en: string } | null }) => (o.vendors ? (en ? o.vendors.store_name_en || o.vendors.store_name_ar : o.vendors.store_name_ar || o.vendors.store_name_en) : "—");
  const now = Date.now();
  const live = campaigns.filter((c) => c.status === "active" && new Date(c.ends_at).getTime() > now);
  const revenue = orders.filter((o) => o.payment_status === "paid").reduce((n, o) => n + o.amount_piastres, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("aa.title")} subtitle={t("aa.hint")}
        actions={<Button onClick={() => setEditing("new")}><PlusIcon className="size-4" />{t("aa.newPackage")}</Button>} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("aa.toReview")} value={String(review.length)} warn={review.length > 0} />
        <Tile label={t("aa.live")} value={String(live.length)} />
        <Tile label={t("aa.activePackages")} value={String(packages.filter((p) => p.is_active).length)} />
        <Tile label={t("aa.revenue")} value={money(revenue)} />
      </dl>

      <nav className="flex gap-1.5 rounded-lg border border-border bg-surface p-1.5 shadow-1" role="tablist">
        {(["orders", "packages", "campaigns"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true, preventScrollReset: true })}
            className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-extrabold sm:flex-none ${tab === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint"}`}>
            {t(`aa.tab.${k}`)}{k === "orders" && review.length ? <span className="num ms-1.5 rounded-full bg-on-action/20 px-1.5 text-2xs">{review.length}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "orders" ? (
        orders.length === 0 ? <EmptyState title={t("aa.noOrders")} body={t("aa.noOrdersHint")} /> : (
          <ul className="flex flex-col gap-3">
            {orders.map((o) => (
              <li key={o.id} className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-1 ${o.status === "in_review" ? "border-warning/60" : "border-border"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-text">{en ? o.package_snapshot.name_en : o.package_snapshot.name_ar} <span className="text-sm font-bold text-text-muted">· {store(o)}</span></p>
                    <p className="num text-xs text-text-muted" dir="ltr">{o.number} · {day(o.created_at)} · {t(`va.paidBy.${o.payment_method}`)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num font-black text-text">{money(o.amount_piastres)}</span>
                    <Badge tone={o.status === "approved" ? "success" : o.status === "rejected" ? "danger" : o.status === "in_review" ? "warning" : "neutral"}>{t(`va.order.${o.status}`)}</Badge>
                  </div>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(o.assignments ?? []).map((a, i) => (
                    <li key={i} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-alt p-2">
                      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-white">
                        {a.image_path ? <MediaImg path={a.image_path} alt="" width={96} height={48} className="size-full object-contain" />
                          : a.product_id && products[a.product_id]?.image ? <MediaImg path={products[a.product_id]!.image!} alt="" width={48} height={48} className="size-full object-cover" />
                          : <PackageIcon className="size-5 text-text-faint" />}
                      </span>
                      <span className="min-w-0 text-xs">
                        <b className="block truncate text-text">{placeName(a.placement)}</b>
                        <span className="block truncate text-text-muted">
                          {[a.product_id ? products[a.product_id]?.name : null, a.section ? t(SECTION_LABEL[a.section] ?? a.section) : null,
                            a.spot ? t(`bn.place.${a.spot}`) : null, a.category_id ? categories[a.category_id] : null, a.template ? t(`ads.tpl.${a.template}`) : null]
                            .filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {o.notes ? <p className="rounded-md bg-surface-tint px-3 py-2 text-sm text-text"><b>{t("va.notes")}:</b> {o.notes}</p> : null}
                {o.status === "rejected" ? <p className="text-sm text-danger"><b>{t("va.rejectedBecause")}</b> {o.reject_reason} {o.refund_method ? `(${t(`aa.refund.${o.refund_method}`)})` : ""}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {o.status === "in_review" ? <Button size="sm" onClick={() => setDeciding(o)}>{t("aa.review")}</Button> : null}
                  {o.status === "approved" && o.ends_at && new Date(o.ends_at).getTime() > now ? (
                    <fetcher.Form method="post"><input type="hidden" name="id" value={o.id} />
                      <Button size="sm" variant="ghost" type="submit" name="intent" value="stop">{t("aa.stop")}</Button></fetcher.Form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "packages" ? (
        packages.length === 0 ? <EmptyState title={t("aa.noPackages")} body={t("aa.noPackagesHint")} /> : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-extrabold text-text">{en ? p.name_en : p.name_ar}</p>
                  <Badge tone={p.is_active ? "success" : "neutral"}>{t(p.is_active ? "aa.active" : "aa.inactive")}</Badge>
                </div>
                <p className="num text-lg font-black text-action">{money(p.price_piastres)}{p.discount_percent ? <span className="ms-2 text-xs text-danger">-{p.discount_percent}%</span> : null}</p>
                <p className="text-xs text-text-muted">{t("va.forDays", { count: p.duration_days })} · {t(`aa.vis.${p.visibility}`)}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {(p.items ?? []).map((it, i) => <li key={i} className="rounded-full bg-surface-tint px-2.5 py-1 text-2xs font-bold text-text">{it.count}× {placeName(it.placement)}</li>)}
                </ul>
                <div className="mt-auto flex gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><PencilIcon className="size-4" />{t("common.edit")}</Button>
                  <fetcher.Form method="post"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="on" value={p.is_active ? "0" : "1"} />
                    <Button size="sm" variant="ghost" type="submit" name="intent" value="pkg_toggle">{t(p.is_active ? "aa.deactivate" : "aa.activate")}</Button></fetcher.Form>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "campaigns" ? (
        campaigns.length === 0 ? <EmptyState title={t("aa.noCampaigns")} body={t("aa.noCampaignsHint")} /> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-1">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-tint/50 text-xs text-text-muted">
                <tr>{["store", "placement", "product", "period", "impressions", "clicks", "status"].map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold">{t(`aa.col.${h}`)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns.map((c) => {
                  const isLive = c.status === "active" && new Date(c.ends_at).getTime() > now;
                  return (
                    <tr key={c.id}>
                      <td className="px-3 py-2.5 font-bold text-text">{store(c)}</td>
                      <td className="px-3 py-2.5">{placeName(c.placement)}{c.section ? <span className="block text-2xs text-text-muted">{t(SECTION_LABEL[c.section] ?? c.section)}</span> : null}</td>
                      <td className="px-3 py-2.5 text-text-muted">{c.product_id ? products[c.product_id]?.name ?? "—" : "—"}</td>
                      <td className="num px-3 py-2.5 text-xs text-text-muted">{day(c.started_at)} → {day(c.ends_at)}</td>
                      <td className="num px-3 py-2.5">{c.impressions}{c.impressions_limit ? ` / ${c.impressions_limit}` : ""}</td>
                      <td className="num px-3 py-2.5">{c.clicks}</td>
                      <td className="px-3 py-2.5"><Badge tone={isLive ? "success" : "neutral"} dot={isLive}>{t(`va.status_${isLive ? "active" : c.status === "active" ? "expired" : c.status}`)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {editing ? <PackageDialog pkg={editing === "new" ? null : editing} placements={placements} lang={lang} onClose={() => setEditing(null)} /> : null}
      {deciding ? <DecideDialog order={deciding} data={loaderData} onClose={() => setDeciding(null)} /> : null}
    </div>
  );
}

const BANNER_PLACES = ["hero", "after_categories", "after_brands", "after_best", "after_best_selling", "after_top_rated", "after_vendors", "after_recent", "bottom", "category", "product_page"] as const;
interface BannerPick { mode: "new" | "existing"; image_path: string; banner_id: string; placement: string; category_id: string; link_url: string }

/** Approve (with the team's banner for every banner slot) or reject with a refund. */
function DecideDialog({ order, data: d, onClose }: { order: OrderRow; data: Route.ComponentProps["loaderData"]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = d.lang;
  const en = lang === "en";
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [refund, setRefund] = useState<"wallet" | "withdrawal">("wallet");
  const [reason, setReason] = useState("");
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  useActionToast(fetcher, { success: t("common.saved") });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onClose(); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = order.payment_status === "paid" && order.amount_piastres > 0;
  const kindOf = (code: string) => d.placements.find((p) => p.code === code)?.kind;
  const placeName = (code: string) => { const p = d.placements.find((x) => x.code === code); return p ? (en ? p.name_en : p.name_ar) : code; };
  const assignments = order.assignments ?? [];
  const [picks, setPicks] = useState<Array<BannerPick | null>>(() => assignments.map((a) => kindOf(a.placement) === "banner" ? {
    mode: "new", image_path: a.image_path ?? "", banner_id: "", link_url: a.link_url ?? "",
    placement: a.placement === "home_hero" ? "hero" : a.placement === "category_banner" ? "category" : a.placement === "product_banner" ? "product_page" : a.spot || "after_categories",
    category_id: a.category_id ?? "",
  } : null));
  const set = (i: number, patch: Partial<BannerPick>) => setPicks((x) => x.map((p, j) => (j === i && p ? { ...p, ...patch } : p)));
  const incomplete = picks.some((p) => p && ((p.mode === "new" ? !p.image_path : !p.banner_id) || (p.placement === "category" && !p.category_id)));
  const payload = picks.map((p) => !p ? {} : p.mode === "existing"
    ? { banner_id: p.banner_id, placement: p.placement, category_id: p.category_id, link_url: p.link_url }
    : { image_path: p.image_path, placement: p.placement, category_id: p.category_id, link_url: p.link_url });
  const bannerOpts = d.banners.map((b) => ({
    value: b.id, label: (en ? b.title_en || b.title_ar : b.title_ar || b.title_en) || t("aa.untitledBanner"),
    keywords: t(`bn.place.${b.placement}`, { defaultValue: b.placement }),
    icon: <MediaImg path={b.image_path} alt="" width={48} height={20} className="h-5 w-12 rounded object-cover" />,
    group: b.is_active ? t("aa.bannersActive") : t("aa.bannersInactive"),
  }));
  const sizeOf = (place: string) => BANNER_SIZES[place === "hero" ? "hero" : place === "category" ? "category" : place === "product_page" ? "product" : "section"];
  const box = "rounded-md border border-border-strong bg-surface px-3 py-2 text-base focus:border-action focus:outline-none sm:text-sm";

  return (
    <Dialog open onClose={onClose} title={`${t("aa.review")} ${order.number}`} size="lg">
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="decide" />
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="decision" value={decision} />
        <input type="hidden" name="refund" value={refund} />
        <input type="hidden" name="banners" value={JSON.stringify(payload)} />
        <div className="grid grid-cols-2 gap-2">
          {(["approve", "reject"] as const).map((x) => (
            <button key={x} type="button" onClick={() => setDecision(x)}
              className={`cursor-pointer rounded-lg border-2 p-3 text-sm font-extrabold ${decision === x ? (x === "approve" ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger") : "border-border text-text-muted"}`}>
              {t(`aa.${x}`)}
            </button>
          ))}
        </div>
        {order.notes ? <p className="rounded-md bg-surface-tint px-3 py-2 text-sm text-text"><b>{t("va.notes")}:</b> {order.notes}</p> : null}
        {decision === "approve" ? (
          <>
            {picks.map((p, i) => p ? (
              <section key={i} className="flex flex-col gap-3 rounded-xl border-2 border-action/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-text">{t("aa.bannerSlot", { n: picks.slice(0, i + 1).filter(Boolean).length })} · {placeName(assignments[i]!.placement)}</h3>
                  <div className="flex rounded-md border border-border p-0.5 text-xs font-bold">
                    {(["new", "existing"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => set(i, { mode: m })}
                        className={`cursor-pointer rounded px-2.5 py-1 ${p.mode === m ? "bg-action text-on-action" : "text-text-muted"}`}>{t(`aa.bannerMode.${m}`)}</button>
                    ))}
                  </div>
                </div>
                {p.mode === "new" ? (
                  <div className="flex flex-col gap-1.5">
                    {p.image_path ? (
                      <div className="relative overflow-hidden rounded-lg border border-border bg-white">
                        <MediaImg path={p.image_path} alt="" width={640} height={200} className="block h-auto max-h-40 w-full object-contain" />
                        <button type="button" onClick={() => set(i, { image_path: "" })} aria-label={t("common.remove")} className="absolute end-2 top-2 grid size-8 cursor-pointer place-items-center rounded-full bg-black/50 text-white"><TrashIcon className="size-4" /></button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setPickerFor(i)} className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-sm font-bold text-text-muted hover:border-action hover:text-action">
                        <PlusIcon className="size-5" />{t("aa.uploadBanner")}
                      </button>
                    )}
                    <p className="text-2xs font-bold text-info">{t("bn.bestSize", sizeOf(p.placement))}</p>
                  </div>
                ) : (
                  <SelectMenu label={t("aa.pickBanner")} searchable options={bannerOpts} value={p.banner_id || null}
                    placeholder={t("aa.pickBanner")} onChange={(v) => set(i, { banner_id: v ?? "" })} />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectMenu label={t("aa.bannerPlace")} required options={BANNER_PLACES.map((x) => ({ value: x, label: x === "category" ? t("aa.placeCategory") : t(`bn.place.${x}`) }))}
                    value={p.placement} onChange={(v) => set(i, { placement: v ?? "hero" })} />
                  {p.placement === "category" ? (
                    <SelectMenu label={t("va.pickCategory")} required searchable options={d.categoryOptions} value={p.category_id || null}
                      placeholder={t("va.pickCategory")} onChange={(v) => set(i, { category_id: v ?? "" })} />
                  ) : null}
                </div>
                <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("aa.bannerLink")}
                  <input value={p.link_url} onChange={(e) => set(i, { link_url: e.target.value })} dir="ltr" placeholder="/ar/store/…" className={`h-11 ${box}`} /></label>
              </section>
            ) : null)}
            <p className="text-sm text-text-muted">{t("aa.approveHint", { days: order.package_snapshot.duration_days ?? 0 })}</p>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("aa.reason")} <span className="text-danger">*</span>
              <textarea name="reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-base font-normal focus:border-action focus:outline-none sm:text-sm" />
            </label>
            {paid ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-text">{t("aa.refundTo", { amount: formatPiastres(order.amount_piastres, en ? "en" : "ar") })}</span>
                {(["wallet", "withdrawal"] as const).map((r) => (
                  <label key={r} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border-2 p-3 ${refund === r ? "border-action" : "border-border"}`}>
                    <input type="radio" checked={refund === r} onChange={() => setRefund(r)} className="mt-1 accent-[var(--color-action)]" />
                    <span><b className="block text-sm text-text">{t(`aa.refund.${r}`)}</b><span className="text-xs text-text-muted">{t(`aa.refundHint.${r}`)}</span></span>
                  </label>
                ))}
              </div>
            ) : null}
          </>
        )}
        {fetcher.data && !fetcher.data.ok ? <p className="text-sm font-bold text-danger">{t(`aa.err.${fetcher.data.reason}`, { defaultValue: t("va.err.failed") })}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={fetcher.state !== "idle"} disabled={decision === "reject" ? !reason.trim() : incomplete}>{t("common.confirm")}</Button>
        </div>
      </fetcher.Form>
      <MediaPickerDialog open={pickerFor !== null} onClose={() => setPickerFor(null)} title={t("aa.uploadBanner")} settings={d.media}
        uid={d.uid} supabaseUrl={d.supabaseUrl} mode="single" kinds={["image"]}
        onConfirm={(files) => { if (pickerFor !== null && files[0]) set(pickerFor, { image_path: files[0].path }); setPickerFor(null); }} />
    </Dialog>
  );
}

function PackageDialog({ pkg, placements, lang, onClose }: { pkg: PkgRow | null; placements: PlacementRow[]; lang: string; onClose: () => void }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  const [items, setItems] = useState<PackageItem[]>(pkg?.items?.length ? pkg.items : [{ placement: "home_section", count: 1 }]);
  const [model, setModel] = useState(pkg?.pricing_model ?? "fixed");
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onClose(); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const setItem = (i: number, patch: Partial<PackageItem>) => setItems((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  const chips = (all: string[], chosen: string[] | undefined, label: (v: string) => string, onChange: (next: string[]) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {all.map((v) => (
        <button key={v} type="button" onClick={() => onChange(toggle(chosen, v))}
          className={`cursor-pointer rounded-full border px-2.5 py-1 text-2xs font-bold ${chosen?.includes(v) ? "border-action bg-action text-on-action" : "border-border text-text-muted"}`}>
          {label(v)}
        </button>
      ))}
    </div>
  );
  const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  return (
    <Dialog open onClose={onClose} title={pkg ? t("aa.editPackage") : t("aa.newPackage")} size="lg">
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="pkg_save" />
        {pkg ? <input type="hidden" name="id" value={pkg.id} /> : null}
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <input type="hidden" name="pricing_model" value={model} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="pk-name-ar" name="name_ar" label={t("aa.nameAr")} required defaultValue={pkg?.name_ar ?? ""} dir="rtl" />
          <Input id="pk-name-en" name="name_en" label={t("aa.nameEn")} required defaultValue={pkg?.name_en ?? ""} dir="ltr" />
          <Input id="pk-desc-ar" name="desc_ar" label={t("aa.descAr")} defaultValue={pkg?.desc_ar ?? ""} dir="rtl" />
          <Input id="pk-desc-en" name="desc_en" label={t("aa.descEn")} defaultValue={pkg?.desc_en ?? ""} dir="ltr" />
        </div>

        <section className="flex flex-col gap-2">
          <p className="text-sm font-black text-text">{t("aa.items")}</p>
          <p className="-mt-1 text-xs text-text-muted">{t("aa.itemsHint")}</p>
          {items.map((it, i) => {
            const pl = placements.find((p) => p.code === it.placement);
            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-alt p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-end gap-2">
                  <SelectMenu label={t("aa.placement")} options={placements.map((p) => ({ value: p.code, label: en ? p.name_en : p.name_ar, group: t(`aa.kind.${p.kind}`) }))}
                    value={it.placement} onChange={(v) => setItem(i, { placement: v ?? it.placement, sections: undefined, spots: undefined, templates: undefined })} />
                  <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
                    {t("aa.count")}
                    <input type="number" min={1} max={20} value={it.count} disabled={pl?.kind === "service"} onChange={(e) => setItem(i, { count: Number(e.target.value) })}
                      className="h-11 rounded-md border border-border bg-surface px-2 text-base disabled:opacity-50 sm:text-sm" dir="ltr" />
                  </label>
                  <button type="button" onClick={() => setItems((s) => s.filter((_, j) => j !== i))} aria-label={t("common.remove")} disabled={items.length === 1}
                    className="grid size-11 cursor-pointer place-items-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40"><TrashIcon className="size-4" /></button>
                </div>
                {it.placement === "home_section" ? <><span className="text-2xs font-bold text-text-muted">{t("aa.allowedSections")}</span>{chips(SECTIONS, it.sections, (v) => t(SECTION_LABEL[v] ?? v), (n) => setItem(i, { sections: n }))}</> : null}
                {it.placement === "home_spot" ? <><span className="text-2xs font-bold text-text-muted">{t("aa.allowedSpots")}</span>{chips(SPOTS, it.spots, (v) => t(`bn.place.${v}`), (n) => setItem(i, { spots: n }))}</> : null}
                {it.placement === "popup" ? <><span className="text-2xs font-bold text-text-muted">{t("aa.allowedTemplates")}</span>{chips([...POPUP_TEMPLATES], it.templates, (v) => t(`ads.tpl.${v}`), (n) => setItem(i, { templates: n }))}</> : null}
              </div>
            );
          })}
          <button type="button" onClick={() => setItems((s) => [...s, { placement: "home_section", count: 1 }])}
            className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border text-sm font-bold text-action hover:border-action">
            <PlusIcon className="size-4" />{t("aa.addItem")}
          </button>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <Input id="pk-price" name="price_egp" label={t("aa.price")} required type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" defaultValue={pkg ? String(piastresToEgp(pkg.price_piastres)) : ""} />
          <Input id="pk-days" name="duration_days" label={t("aa.days")} required type="number" min={1} dir="ltr" defaultValue={String(pkg?.duration_days ?? 30)} />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("aa.model")}
            <select value={model} onChange={(e) => setModel(e.target.value)} className="h-11 rounded-md border border-border bg-surface px-2 text-base sm:text-sm">
              {["fixed", "cpm", "cpc"].map((m) => <option key={m} value={m}>{t(`aa.modelName.${m}`)}</option>)}
            </select>
          </label>
          {model === "cpm" ? <Input id="pk-imp" name="impressions_included" label={t("aa.impressions")} type="number" min={1000} step={1000} dir="ltr" defaultValue={String(pkg?.impressions_included ?? 10000)} /> : null}
          <Input id="pk-disc" name="discount_percent" label={t("aa.discount")} type="number" min={0} max={90} dir="ltr" defaultValue={String(pkg?.discount_percent ?? 0)} />
          <Input id="pk-disc-end" name="discount_ends_at" label={t("aa.discountEnds")} type="datetime-local" dir="ltr" defaultValue={local(pkg?.discount_ends_at ?? null)} />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("aa.visibility")}
            <select name="visibility" defaultValue={pkg?.visibility ?? "vendors"} className="h-11 rounded-md border border-border bg-surface px-2 text-base sm:text-sm">
              {["vendors", "rewards", "admins"].map((v) => <option key={v} value={v}>{t(`aa.vis.${v}`)}</option>)}
            </select>
          </label>
          <Input id="pk-sort" name="sort" label={t("aa.sort")} type="number" dir="ltr" defaultValue={String(pkg?.sort ?? 0)} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm font-bold text-text">
          <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={pkg?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />{t("aa.active")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="is_featured" defaultChecked={pkg?.is_featured ?? false} className="size-4 accent-[var(--color-action)]" />{t("aa.featuredPkg")}</label>
        </div>
        {fetcher.data && !fetcher.data.ok ? <p className="text-sm font-bold text-danger">{t(`aa.err.${fetcher.data.reason}`, { defaultValue: fetcher.data.reason })}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={fetcher.state !== "idle"}><CheckIcon className="size-4" />{t("common.save")}</Button>
        </div>
      </fetcher.Form>
    </Dialog>
  );
}

function Tile({ label, value, warn = false }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-1 ${warn ? "border-warning/60 bg-warning-soft" : "border-border bg-surface"}`}>
      <dt className="text-xs font-bold text-text-muted">{label}</dt>
      <dd className="num mt-1 text-2xl font-black text-text">{value}</dd>
    </div>
  );
}

/** H-06: friendly route error page */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}


