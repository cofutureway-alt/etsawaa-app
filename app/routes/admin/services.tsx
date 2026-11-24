import { useEffect, useMemo, useState, type ReactNode } from "react";
import { data, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/services";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres, piastresToEgp } from "~/lib/money";
import { parseMediaSettings, type MediaSettings } from "~/lib/media.shared";
import { Badge, Button, Dialog, Drawer, Input } from "~/components/ui";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { EmptyState } from "~/components/ui/EmptyState";
import { MediaImg, mediaUrl } from "~/components/catalog/MediaImg";
import { MediaPickerDialog } from "~/features/media/components/MediaPickerDialog";
import {
  CalendarIcon, CheckIcon, LinkIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon, VideoIcon,
} from "~/components/ui/icons";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import {
  OPEN_STATUSES, SERVICE_ICONS, groupLook, pick, priceLabel, statusTone,
  type Service, type ServiceEvent, type ServiceGroup, type ServiceLine, type ServiceOrder,
} from "~/features/services/shared";

/**
 * Admin → Services (owner brief 2026-11-16): the team's queue of vendor
 * service orders (price a quote, schedule, start, deliver files / links,
 * complete, message, cancel with a wallet refund), the services catalogue
 * (sections, pricing — fixed, per unit or on quote — what is included,
 * badges, cover images) and its sections.
 */

type OrderRow = ServiceOrder & { vendors: { store_name_ar: string; store_name_en: string; slug: string; phone: string | null } | null };

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const [groups, services, orders, media] = await Promise.all([
    client.from("service_groups").select("id, code, name_ar, name_en, desc_ar, desc_en, icon, sort, is_active").order("sort"),
    client.from("services").select("id, group_id, code, name_ar, name_en, desc_ar, desc_en, pricing, price_piastres, unit_ar, unit_en, min_qty, max_qty, includes, badge_ar, badge_en, delivery_days, cover_path, needs_products, sort, is_active, is_featured, upload_mode, units_included")
      .is("deleted_at", null).order("sort"),
    client.from("service_orders").select("*, vendors(store_name_ar, store_name_en, slug, phone)").order("created_at", { ascending: false }).limit(300),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);
  const orderRows = (orders.data ?? []) as unknown as OrderRow[];
  const productIds = [...new Set(orderRows.flatMap((o) => o.product_ids ?? []))];
  const [events, prods] = await Promise.all([
    orderRows.length ? client.from("service_order_events").select("id, order_id, kind, note, data, created_at").in("order_id", orderRows.map((o) => o.id)).order("created_at") : Promise.resolve({ data: [] }),
    productIds.length ? client.from("products").select("id, name_ar, name_en, slug_ar, slug_en").in("id", productIds) : Promise.resolve({ data: [] }),
  ]);
  const products: Record<string, { name: string; href: string }> = {};
  for (const p of (prods.data ?? []) as Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string }>) {
    products[p.id] = { name: lang === "en" ? p.name_en || p.name_ar : p.name_ar || p.name_en, href: `/${lang}/product/${encodeURIComponent(lang === "en" ? p.slug_en || p.slug_ar : p.slug_ar || p.slug_en)}` };
  }
  return {
    lang,
    groups: (groups.data ?? []) as ServiceGroup[],
    services: (services.data ?? []) as Service[],
    orders: orderRows,
    events: (events.data ?? []) as ServiceEvent[],
    products,
    media: parseMediaSettings((media.data as { value?: unknown } | null)?.value) as MediaSettings,
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

const str = (form: FormData, k: string, max = 400) => String(form.get(k) ?? "").trim().slice(0, max);
const int = (form: FormData, k: string, fallback: number) => {
  const n = Number(form.get(k));
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const fail = (reason: string, status = 400) => data({ ok: false as const, reason }, { status });

  if (intent === "order") {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { return fail("bad_input"); }
    const { data: res, error } = await client.rpc("fn_admin_service_order", { p_order: str(form, "id", 60), p_action: str(form, "action", 20), p_payload: payload });
    if (error) return fail("server_error", 500);
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : fail(r.reason ?? "failed");
  }

  if (intent === "svc_save") {
    let includes: ServiceLine[] = [];
    try {
      includes = (JSON.parse(String(form.get("includes") ?? "[]")) as ServiceLine[])
        .map((l) => ({ ar: String(l.ar ?? "").trim().slice(0, 160), en: String(l.en ?? "").trim().slice(0, 160) }))
        .filter((l) => l.ar || l.en).slice(0, 12);
    } catch { return fail("bad_input"); }
    const pricing = str(form, "pricing", 10);
    if (!["fixed", "per_unit", "quote"].includes(pricing)) return fail("bad_input");
    const nameAr = str(form, "name_ar", 160), nameEn = str(form, "name_en", 160);
    if (!nameAr || !nameEn) return fail("name_required");
    const price = pricing === "quote" ? 0 : (egpToPiastres(Number(form.get("price") ?? 0)) ?? 0);
    if (pricing !== "quote" && !(price > 0)) return fail("price_required");
    const minQ = pricing === "per_unit" ? Math.max(1, int(form, "min_qty", 1)) : 1;
    const maxQ = pricing === "per_unit" ? Math.max(minQ, int(form, "max_qty", 1000)) : 1;
    const days = int(form, "delivery_days", 0);
    const row = {
      group_id: str(form, "group_id", 60) || null,
      name_ar: nameAr, name_en: nameEn,
      desc_ar: str(form, "desc_ar", 600), desc_en: str(form, "desc_en", 600),
      pricing, price_piastres: price,
      unit_ar: pricing === "per_unit" ? str(form, "unit_ar", 30) : "", unit_en: pricing === "per_unit" ? str(form, "unit_en", 30) : "",
      min_qty: minQ, max_qty: maxQ, includes,
      badge_ar: str(form, "badge_ar", 40), badge_en: str(form, "badge_en", 40),
      delivery_days: days > 0 ? days : null,
      cover_path: /^u\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/.test(str(form, "cover_path", 200)) ? str(form, "cover_path", 200) : null,
      needs_products: form.get("needs_products") === "on",
      upload_mode: ["none", "references", "work"].includes(str(form, "upload_mode", 12)) ? str(form, "upload_mode", 12) : "references",
      units_included: pricing === "fixed" && int(form, "units_included", 0) > 0 ? int(form, "units_included", 0) : null,
      sort: int(form, "sort", 0),
      is_active: form.get("is_active") === "on",
      is_featured: form.get("is_featured") === "on",
      updated_at: new Date().toISOString(),
    };
    const id = str(form, "id", 60);
    const res = id ? await client.from("services").update(row).eq("id", id) : await client.from("services").insert(row);
    return res.error ? fail("save_failed", 500) : { ok: true as const };
  }
  if (intent === "svc_toggle") {
    const res = await client.from("services").update({ is_active: form.get("on") === "1", updated_at: new Date().toISOString() }).eq("id", str(form, "id", 60));
    return res.error ? fail("save_failed", 500) : { ok: true as const };
  }
  if (intent === "svc_delete") {
    // soft delete: past orders keep their snapshot
    const res = await client.from("services").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", str(form, "id", 60));
    return res.error ? fail("save_failed", 500) : { ok: true as const };
  }
  if (intent === "grp_save") {
    const nameAr = str(form, "name_ar", 120), nameEn = str(form, "name_en", 120);
    if (!nameAr || !nameEn) return fail("name_required");
    const icon = str(form, "icon", 20);
    const row = {
      name_ar: nameAr, name_en: nameEn, desc_ar: str(form, "desc_ar", 400), desc_en: str(form, "desc_en", 400),
      icon: (SERVICE_ICONS as readonly string[]).includes(icon) ? icon : "sparkles",
      sort: int(form, "sort", 0), is_active: form.get("is_active") === "on",
    };
    const id = str(form, "id", 60);
    const res = id ? await client.from("service_groups").update(row).eq("id", id) : await client.from("service_groups").insert(row);
    return res.error ? fail("save_failed", 500) : { ok: true as const };
  }
  if (intent === "grp_delete") {
    const id = str(form, "id", 60);
    const { count } = await client.from("services").select("id", { count: "exact", head: true }).eq("group_id", id).is("deleted_at", null);
    if ((count ?? 0) > 0) return fail("group_not_empty");
    const res = await client.from("service_groups").delete().eq("id", id);
    return res.error ? fail("save_failed", 500) : { ok: true as const };
  }
  return fail("bad_intent");
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function AdminServices({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, orders } = loaderData;
  const en = lang === "en";
  const [params, setParams] = useSearchParams();
  const tab = (["orders", "catalog", "groups"] as const).find((x) => x === params.get("tab")) ?? "orders";
  const openOrder = orders.find((o) => o.number === params.get("order")) ?? null;
  const count = (s: string[]) => orders.filter((o) => s.includes(o.status)).length;
  const revenue = orders.filter((o) => o.payment_status === "paid").reduce((n, o) => n + o.amount_piastres, 0);
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [editingGroup, setEditingGroup] = useState<ServiceGroup | "new" | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("asv.title")} subtitle={t("asv.subtitle")}
        actions={tab === "catalog" ? <Button onClick={() => setEditing("new")}><PlusIcon className="size-4" />{t("asv.newService")}</Button>
          : tab === "groups" ? <Button onClick={() => setEditingGroup("new")}><PlusIcon className="size-4" />{t("asv.newGroup")}</Button> : undefined} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={t("asv.kNew")} value={count(["new"])} warn={count(["new"]) > 0} />
        <Tile label={t("asv.kQuote")} value={count(["awaiting_quote"])} warn={count(["awaiting_quote"]) > 0} />
        <Tile label={t("asv.kWorking")} value={count(["scheduled", "in_progress"])} />
        <Tile label={t("asv.kDelivered")} value={count(["delivered"])} />
        <Tile label={t("asv.kRevenue")} value={formatPiastres(revenue, en ? "en" : "ar")} />
      </dl>

      <nav className="flex gap-1.5 rounded-lg border border-border bg-surface p-1.5 shadow-1" role="tablist">
        {(["orders", "catalog", "groups"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            onClick={() => setParams((sp) => { sp.set("tab", k); sp.delete("order"); return sp; }, { replace: true, preventScrollReset: true })}
            className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-extrabold sm:flex-none ${tab === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint"}`}>
            {t(`asv.tab.${k}`)}
          </button>
        ))}
      </nav>

      {tab === "orders" ? <OrdersTab data={loaderData} onOpen={(n) => setParams((sp) => { sp.set("order", n); return sp; }, { preventScrollReset: true })} /> : null}
      {tab === "catalog" ? <CatalogTab data={loaderData} onEdit={setEditing} /> : null}
      {tab === "groups" ? <GroupsTab data={loaderData} onEdit={setEditingGroup} /> : null}

      {editing ? <ServiceDialog service={editing === "new" ? null : editing} data={loaderData} onClose={() => setEditing(null)} /> : null}
      {editingGroup ? <GroupDialog group={editingGroup === "new" ? null : editingGroup} lang={lang} onClose={() => setEditingGroup(null)} /> : null}
      <OrderDrawer order={openOrder} data={loaderData} onClose={() => setParams((sp) => { sp.delete("order"); return sp; }, { replace: true, preventScrollReset: true })} />
    </div>
  );
}

function Tile({ label, value, warn = false }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-lg border bg-surface p-4 shadow-1 ${warn ? "border-action/50" : "border-border"}`}>
      <dt className="text-xs font-bold text-text-muted">{label}</dt>
      <dd className={`num mt-1 text-xl font-black ${warn ? "text-action" : "text-text"}`}>{value}</dd>
    </div>
  );
}

function OrdersTab({ data: d, onOpen }: { data: LoaderData; onOpen: (n: string) => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const [filter, setFilter] = useState<"open" | "all" | string>("open");
  const [q, setQ] = useState("");
  const statuses = ["awaiting_quote", "pending_payment", "new", "scheduled", "in_progress", "delivered", "completed", "rejected", "cancelled"];
  const store = (o: OrderRow) => (o.vendors ? pick(en, o.vendors.store_name_ar, o.vendors.store_name_en) : "—");
  const needle = q.trim().toLowerCase();
  const list = d.orders.filter((o) => (filter === "all" ? true : filter === "open" ? OPEN_STATUSES.includes(o.status) : o.status === filter))
    .filter((o) => !needle || o.number.toLowerCase().includes(needle) || store(o).toLowerCase().includes(needle)
      || pick(en, o.service_snapshot.name_ar, o.service_snapshot.name_en).toLowerCase().includes(needle));
  const day = (v: string) => new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short" });
  if (d.orders.length === 0) return <EmptyState title={t("asv.noOrders")} body={t("asv.noOrdersHint")} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["open", "all", ...statuses].map((s) => {
            const n = s === "open" ? d.orders.filter((o) => OPEN_STATUSES.includes(o.status)).length : s === "all" ? d.orders.length : d.orders.filter((o) => o.status === s).length;
            if (n === 0 && s !== "open" && s !== "all") return null;
            return (
              <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${filter === s ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action"}`}>
                {s === "open" ? t("svc.filter.open") : s === "all" ? t("svc.filter.all") : t(`svc.status.${s}`)}<span className="num opacity-80">{n}</span>
              </button>
            );
          })}
        </div>
        <label className="relative lg:w-72">
          <span className="sr-only">{t("asv.search")}</span>
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("asv.search")}
            className="h-10 w-full rounded-md border border-border-strong bg-surface ps-9 pe-3 text-base focus:border-action focus:outline-none sm:text-sm" />
        </label>
      </div>
      <ul className="flex flex-col gap-2">
        {list.map((o) => {
          const { Icon, tile } = groupLook(d.groups.find((g) => g.id === o.service_snapshot.group_id)?.icon);
          return (
            <li key={o.id}>
              <button type="button" onClick={() => onOpen(o.number)}
                className="grid w-full cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-border bg-surface p-3 text-start shadow-1 hover:border-action/50 sm:p-4">
                <span className={`grid size-10 place-items-center rounded-lg ${tile}`}><Icon className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block truncate font-extrabold text-text">{pick(en, o.service_snapshot.name_ar, o.service_snapshot.name_en)}{o.quantity > 1 ? <span className="num ms-1.5 text-sm text-text-muted">×{o.quantity}</span> : null}</span>
                  <span className="block truncate text-xs text-text-muted"><span className="num" dir="ltr">{o.number}</span> · {store(o)} · {day(o.created_at)}{o.preferred_date ? ` · ${t("asv.wants", { date: o.preferred_date })}` : ""}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Badge tone={statusTone(o.status)}>{t(`svc.status.${o.status}`)}</Badge>
                  {o.amount_piastres > 0 ? <span className="num text-sm font-black text-text">{formatPiastres(o.amount_piastres, en ? "en" : "ar")}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {list.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("svc.nothingHere")}</p> : null}
    </div>
  );
}

/** One order: vendor request + the next step for the team + timeline. */
function OrderDrawer({ order: o, data: d, onClose }: { order: OrderRow | null; data: LoaderData; onClose: () => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher, { success: t("common.saved") });
  const [quote, setQuote] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [links, setLinks] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [notify, setNotify] = useState(true);
  const [picker, setPicker] = useState(false);
  const [panel, setPanel] = useState<"" | "reject">("");
  useEffect(() => {
    setQuote(o && o.amount_piastres > 0 ? String(piastresToEgp(o.amount_piastres)) : "");
    setNote(""); setWhen(""); setFiles(o?.delivered_files ?? []); setLinks((o?.delivered_links ?? []).join("\n")); setReason(""); setMsg(""); setPanel("");
  }, [o?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) { setNote(""); setMsg(""); setReason(""); setPanel(""); } }, [fetcher.state, fetcher.data]);
  if (!o) return <Drawer open={false} onClose={onClose} title=""><span /></Drawer>;
  const busy = fetcher.state !== "idle";
  const run = (action: string, payload: Record<string, unknown> = {}) =>
    fetcher.submit({ intent: "order", id: o.id, action, payload: JSON.stringify(payload) }, { method: "post" });
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fmt = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const events = d.events.filter((e) => e.order_id === o.id);
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  const isVideo = (p: string) => /\.(mp4|mov|webm|m4v)$/i.test(p);
  const canWork = ["new", "scheduled", "in_progress", "delivered"].includes(o.status);
  const field = "rounded-md border border-border-strong bg-surface px-3 py-2 text-base focus:border-action focus:outline-none sm:text-sm";

  return (
    <Drawer open onClose={onClose} title={`${o.number} · ${pick(en, o.service_snapshot.name_ar, o.service_snapshot.name_en)}`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone={statusTone(o.status)}>{t(`svc.status.${o.status}`)}</Badge>
          <span className="num text-lg font-black text-text">{o.amount_piastres > 0 ? money(o.amount_piastres) : t("svc.onQuote")}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-tint/40 p-4 text-sm">
          <div><dt className="text-xs text-text-muted">{t("asv.store")}</dt><dd className="font-bold text-text">{o.vendors ? pick(en, o.vendors.store_name_ar, o.vendors.store_name_en) : "—"}</dd></div>
          <div><dt className="text-xs text-text-muted">{t("asv.phone")}</dt><dd className="num font-bold text-text" dir="ltr">{o.vendors?.phone || "—"}</dd></div>
          <div><dt className="text-xs text-text-muted">{t("svc.qty")}</dt><dd className="num font-bold text-text">{o.quantity}</dd></div>
          <div><dt className="text-xs text-text-muted">{t("asv.payment")}</dt><dd className="font-bold text-text">{o.payment_status === "paid" ? t(`va.paidBy.${o.payment_method ?? "card"}`) : t(`asv.pay.${o.payment_status}`)}</dd></div>
          {o.preferred_date ? <div><dt className="text-xs text-text-muted">{t("svc.preferredDate")}</dt><dd className="font-bold text-text">{o.preferred_date}</dd></div> : null}
          {o.scheduled_at ? <div><dt className="text-xs text-text-muted">{t("svc.scheduled")}</dt><dd className="font-bold text-text">{fmt(o.scheduled_at)}</dd></div> : null}
        </dl>

        {o.brief || o.product_ids.length || o.attachments.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-black text-text">{t("asv.request")}</h3>
            {o.brief ? <p className="whitespace-pre-line rounded-md bg-surface-tint p-3 text-sm text-text">{o.brief}</p> : null}
            {o.product_ids.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {o.product_ids.map((id) => d.products[id] ? <li key={id}><a href={d.products[id]!.href} target="_blank" rel="noopener noreferrer" className="block rounded-full border border-border px-2.5 py-1 text-xs font-bold text-action hover:underline">{d.products[id]!.name}</a></li> : null)}
              </ul>
            ) : null}
            {o.attachments.length ? (
              <>
                <p className="text-xs font-bold text-text-muted">{t(o.service_snapshot.upload_mode === "work" ? "svc.uploadedWork" : "svc.uploadedRefs", { count: o.attachments.length })} · {t("asv.openToDownload")}</p>
                <ul className="flex flex-wrap gap-2">
                  {o.attachments.map((p) => <li key={p}><a href={mediaUrl(p)} download target="_blank" rel="noopener noreferrer" className="block size-16 overflow-hidden rounded-md border border-border"><MediaImg path={p} alt="" width={64} height={64} className="size-full object-cover" /></a></li>)}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {/* next step */}
        {o.status === "awaiting_quote" || o.status === "pending_payment" ? (
          <section className="flex flex-col gap-2 rounded-xl border-2 border-action/40 p-4">
            <h3 className="text-sm font-black text-text">{t("asv.setQuote")}</h3>
            <div className="flex flex-col gap-2">
              <Input label={t("asv.quoteAmount")} type="number" min={1} step="0.01" dir="ltr" value={quote} onChange={(e) => setQuote(e.target.value)} />
              <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.quoteNote")}
                <input value={note} onChange={(e) => setNote(e.target.value)} className={`h-11 ${field}`} placeholder={t("asv.quoteNotePh")} /></label>
            </div>
            <Button size="sm" loading={busy} disabled={!(Number(quote) > 0)} onClick={() => run("quote", { amount_piastres: egpToPiastres(Number(quote)), note })}>{t("asv.sendQuote")}</Button>
          </section>
        ) : null}
        {o.status === "new" || o.status === "scheduled" ? (
          <section className="flex flex-col gap-2 rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-black text-text"><CalendarIcon className="size-4 text-info" />{t("asv.schedule")}</h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.when")}
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} dir="ltr" className={`h-11 ${field}`} /></label>
              <Button size="sm" variant="outline" loading={busy} disabled={!when} onClick={() => run("schedule", { scheduled_at: new Date(when).toISOString(), note })}>{t("asv.saveSchedule")}</Button>
              <Button size="sm" loading={busy} onClick={() => run("start", { note })}>{t("asv.start")}</Button>
            </div>
          </section>
        ) : null}
        {canWork ? (
          <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
            <h3 className="text-sm font-black text-text">{t("asv.deliver")}</h3>
            <div className="flex flex-wrap gap-2">
              {files.map((p) => (
                <span key={p} className="relative size-16 overflow-hidden rounded-md border border-border bg-surface-tint">
                  {isVideo(p) ? <span className="grid size-full place-items-center text-text-muted"><VideoIcon className="size-6" /></span> : <MediaImg path={p} alt="" width={64} height={64} className="size-full object-cover" />}
                  <button type="button" onClick={() => setFiles((f) => f.filter((x) => x !== p))} aria-label={t("common.remove")} className="absolute end-0.5 top-0.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/55 text-white"><TrashIcon className="size-3" /></button>
                </span>
              ))}
              <button type="button" onClick={() => setPicker(true)} className="flex size-16 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border text-2xs font-bold text-text-muted hover:border-action hover:text-action"><PlusIcon className="size-4" />{t("asv.files")}</button>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text"><span className="flex items-center gap-1.5"><LinkIcon className="size-4 text-text-muted" />{t("asv.links")}</span>
              <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={2} dir="ltr" placeholder="https://drive.google.com/…" className={field} /></label>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.deliveryNote")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={field} /></label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy} disabled={files.length === 0 && !links.trim()}
                onClick={() => run("deliver", { files, links: links.split(/\s+/).map((x) => x.trim()).filter(Boolean), note })}>
                <CheckIcon className="size-4" />{o.status === "delivered" ? t("asv.redeliver") : t("asv.markDelivered")}
              </Button>
              {o.status === "delivered" || o.status === "in_progress" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run("complete", { note })}>{t("asv.complete")}</Button> : null}
            </div>
          </section>
        ) : null}

        {err ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">{t(`svc.err.${err}`, { defaultValue: t("svc.err.failed") })}</p> : null}

        {/* message the vendor / internal note */}
        <section className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.message")}
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} className={field} placeholder={t("asv.messagePh")} /></label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-[var(--color-action)]" />{t("asv.notifyVendor")}</label>
            <Button size="sm" variant="outline" disabled={busy || msg.trim().length < 2} onClick={() => run("note", { note: msg, notify })}>{t("asv.addNote")}</Button>
          </div>
        </section>

        {!["completed", "cancelled", "rejected"].includes(o.status) ? (
          panel === "reject" ? (
            <section className="flex flex-col gap-2 rounded-xl bg-danger-soft p-4">
              <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.rejectReason")}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={field} /></label>
              {o.payment_status === "paid" ? <p className="text-xs font-bold text-text">{t("asv.refundNote", { amount: money(o.amount_piastres) })}</p> : null}
              <div className="flex gap-2">
                <Button size="sm" loading={busy} disabled={reason.trim().length < 3} onClick={() => run("reject", { note: reason })}>{t("asv.confirmReject")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPanel("")}>{t("common.cancel")}</Button>
              </div>
            </section>
          ) : <button type="button" onClick={() => setPanel("reject")} className="self-start text-sm font-bold text-danger hover:underline">{t("asv.reject")}</button>
        ) : null}

        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-black text-text">{t("svc.timeline")}</h3>
          <ol className="flex flex-col gap-3">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-action" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text">{t(`svc.ev.${e.kind}`, { defaultValue: e.kind })} <span className="text-xs font-normal text-text-muted">· {fmt(e.created_at)}</span></p>
                  {e.note ? <p className="whitespace-pre-line text-sm text-text-muted">{e.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <MediaPickerDialog open={picker} onClose={() => setPicker(false)} title={t("asv.files")} settings={d.media}
        uid={d.uid} supabaseUrl={d.supabaseUrl} mode="multi" kinds={["image", "video", "pdf", "file"]}
        onConfirm={(fs) => setFiles((f) => [...new Set([...f, ...fs.map((x) => x.path)])].slice(0, 60))} />
    </Drawer>
  );
}

function CatalogTab({ data: d, onEdit }: { data: LoaderData; onEdit: (s: Service) => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const fetcher = useFetcher<{ ok: boolean }>();
  useActionToast(fetcher, { success: t("common.saved") });
  const sections = [...d.groups.map((g) => ({ g, list: d.services.filter((s) => s.group_id === g.id) })),
    { g: null as ServiceGroup | null, list: d.services.filter((s) => !s.group_id || !d.groups.some((g) => g.id === s.group_id)) }].filter((x) => x.list.length);
  if (d.services.length === 0) return <EmptyState title={t("asv.noServices")} body={t("asv.noServicesHint")} />;
  return (
    <div className="flex flex-col gap-5">
      {sections.map(({ g, list }) => {
        const { Icon, tile } = groupLook(g?.icon);
        return (
          <section key={g?.id ?? "none"} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-base font-black text-text"><span className={`grid size-8 place-items-center rounded-lg ${tile}`}><Icon className="size-4" /></span>{g ? pick(en, g.name_ar, g.name_en) : t("asv.noGroup")}
              {g && !g.is_active ? <Badge tone="neutral">{t("asv.hidden")}</Badge> : null}</h2>
            <ul className="grid gap-2 lg:grid-cols-2">
              {list.map((s) => {
                const price = priceLabel(s, en, t("svc.onQuote"));
                return (
                  <li key={s.id} className={`flex items-center gap-3 rounded-xl border bg-surface p-3 shadow-1 ${s.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
                    {s.cover_path ? <MediaImg path={s.cover_path} alt="" width={56} height={56} className="size-14 shrink-0 rounded-lg object-cover" /> : <span className={`grid size-14 shrink-0 place-items-center rounded-lg ${tile}`}><Icon className="size-6" /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold text-text">{pick(en, s.name_ar, s.name_en)}</p>
                      <p className="text-sm"><span className="num font-black text-action">{price.main}</span>{price.per ? <span className="text-text-muted"> / {price.per}</span> : null}
                        <span className="ms-2 text-xs text-text-muted">{t(`asv.pricing.${s.pricing}`)}</span></p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!s.is_active ? <Badge tone="neutral">{t("asv.hidden")}</Badge> : null}
                        {pick(en, s.badge_ar, s.badge_en) ? <Badge tone="featured">{pick(en, s.badge_ar, s.badge_en)}</Badge> : null}
                        {s.is_featured ? <Badge tone="info">{t("asv.featured")}</Badge> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button size="sm" variant="outline" onClick={() => onEdit(s)}><PencilIcon className="size-3.5" />{t("common.edit")}</Button>
                      <fetcher.Form method="post">
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="on" value={s.is_active ? "0" : "1"} />
                        <Button size="sm" variant="ghost" type="submit" name="intent" value="svc_toggle" className="w-full">{s.is_active ? t("asv.hide") : t("asv.show")}</Button>
                      </fetcher.Form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ServiceDialog({ service: s, data: d, onClose }: { service: Service | null; data: LoaderData; onClose: () => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher, { success: t("common.saved") });
  const [pricing, setPricing] = useState<Service["pricing"]>(s?.pricing ?? "fixed");
  const [uploadMode, setUploadMode] = useState<Service["upload_mode"]>(s?.upload_mode ?? "references");
  const [groupId, setGroupId] = useState<string | null>(s?.group_id ?? d.groups[0]?.id ?? null);
  const [lines, setLines] = useState<ServiceLine[]>(s?.includes?.length ? s.includes : [{ ar: "", en: "" }]);
  const [cover, setCover] = useState(s?.cover_path ?? "");
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onClose(); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  const groupOpts = useMemo(() => [{ value: "", label: t("asv.noGroup") }, ...d.groups.map((g) => ({ value: g.id, label: pick(en, g.name_ar, g.name_en) }))], [d.groups, en, t]);
  const box = "rounded-md border border-border-strong bg-surface px-3 py-2 text-base focus:border-action focus:outline-none sm:text-sm";

  return (
    <Dialog open onClose={onClose} title={s ? t("asv.editService") : t("asv.newService")} size="lg">
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="svc_save" />
        {s ? <input type="hidden" name="id" value={s.id} /> : null}
        <input type="hidden" name="pricing" value={pricing} />
        <input type="hidden" name="upload_mode" value={uploadMode} />
        <input type="hidden" name="group_id" value={groupId ?? ""} />
        <input type="hidden" name="includes" value={JSON.stringify(lines)} />
        <input type="hidden" name="cover_path" value={cover} />

        <SelectMenu label={t("asv.group")} options={groupOpts} value={groupId ?? ""} onChange={(v) => setGroupId(v || null)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input name="name_ar" label={t("asv.nameAr")} required defaultValue={s?.name_ar ?? ""} maxLength={160} />
          <Input name="name_en" label={t("asv.nameEn")} required defaultValue={s?.name_en ?? ""} maxLength={160} dir="ltr" />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.descAr")}<textarea name="desc_ar" rows={2} defaultValue={s?.desc_ar ?? ""} className={box} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.descEn")}<textarea name="desc_en" rows={2} defaultValue={s?.desc_en ?? ""} dir="ltr" className={box} /></label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold text-text">{t("asv.pricingTitle")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["fixed", "per_unit", "quote"] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={pricing === p} onClick={() => setPricing(p)}
                className={`cursor-pointer rounded-xl border-2 p-3 text-start ${pricing === p ? "border-action bg-action/5" : "border-border hover:border-border-strong"}`}>
                <span className="block text-sm font-extrabold text-text">{t(`asv.pricing.${p}`)}</span>
                <span className="block text-xs text-text-muted">{t(`asv.pricingHint.${p}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {pricing !== "quote" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Input name="price" label={pricing === "per_unit" ? t("asv.unitPrice") : t("asv.price")} type="number" min={0.01} step="0.01" required dir="ltr"
              defaultValue={s && s.price_piastres ? String(piastresToEgp(s.price_piastres)) : ""} />
            {pricing === "fixed" ? (
              <Input name="units_included" label={t("asv.unitsIncluded")} type="number" min={1} dir="ltr" hint={t("asv.unitsIncludedHint")}
                defaultValue={s?.units_included ? String(s.units_included) : ""} />
            ) : null}
            {pricing === "per_unit" ? (
              <>
                <Input name="unit_ar" label={t("asv.unitAr")} defaultValue={s?.unit_ar || "صورة"} maxLength={30} />
                <Input name="unit_en" label={t("asv.unitEn")} defaultValue={s?.unit_en || "photo"} maxLength={30} dir="ltr" />
                <Input name="min_qty" label={t("asv.minQty")} type="number" min={1} dir="ltr" defaultValue={String(s?.min_qty ?? 1)} />
                <Input name="max_qty" label={t("asv.maxQty")} type="number" min={1} dir="ltr" defaultValue={String(s?.max_qty ?? 1000)} />
              </>
            ) : null}
          </div>
        ) : <p className="rounded-lg bg-info-soft p-3 text-sm text-text">{t("asv.quoteExplain")}</p>}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold text-text">{t("asv.uploadTitle")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["work", "references", "none"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={uploadMode === m} onClick={() => setUploadMode(m)}
                className={`cursor-pointer rounded-xl border-2 p-3 text-start ${uploadMode === m ? "border-action bg-action/5" : "border-border hover:border-border-strong"}`}>
                <span className="block text-sm font-extrabold text-text">{t(`asv.upload.${m}`)}</span>
                <span className="block text-xs text-text-muted">{t(`asv.uploadHint.${m}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold text-text">{t("asv.includes")}</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input value={l.ar} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, ar: e.target.value } : y)))} placeholder={t("asv.lineAr")} aria-label={t("asv.lineAr")} className={`h-10 ${box}`} />
              <input value={l.en} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, en: e.target.value } : y)))} placeholder={t("asv.lineEn")} aria-label={t("asv.lineEn")} dir="ltr" className={`h-10 ${box}`} />
              <button type="button" onClick={() => setLines((x) => x.filter((_, j) => j !== i))} aria-label={t("common.remove")} className="grid size-10 cursor-pointer place-items-center rounded-md border border-border text-text-muted hover:text-danger"><TrashIcon className="size-4" /></button>
            </div>
          ))}
          {lines.length < 12 ? <button type="button" onClick={() => setLines((x) => [...x, { ar: "", en: "" }])} className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-sm font-bold text-action hover:border-action"><PlusIcon className="size-4" />{t("asv.addLine")}</button> : null}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-4">
          <Input name="badge_ar" label={t("asv.badgeAr")} defaultValue={s?.badge_ar ?? ""} maxLength={40} placeholder={t("asv.badgePh")} />
          <Input name="badge_en" label={t("asv.badgeEn")} defaultValue={s?.badge_en ?? ""} maxLength={40} dir="ltr" />
          <Input name="delivery_days" label={t("asv.deliveryDays")} type="number" min={0} dir="ltr" defaultValue={s?.delivery_days ? String(s.delivery_days) : ""} hint={t("asv.deliveryDaysHint")} />
          <Input name="sort" label={t("asv.sort")} type="number" dir="ltr" defaultValue={String(s?.sort ?? 0)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-text">{t("asv.cover")}</span>
          <div className="flex items-center gap-3">
            {cover ? <MediaImg path={cover} alt="" width={160} height={90} className="h-20 w-36 rounded-lg border border-border object-cover" /> : <span className="grid h-20 w-36 place-items-center rounded-lg border-2 border-dashed border-border text-xs text-text-muted">{t("asv.noCover")}</span>}
            <div className="flex flex-col gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setPicker(true)}>{cover ? t("asv.changeCover") : t("asv.pickCover")}</Button>
              {cover ? <Button type="button" size="sm" variant="ghost" onClick={() => setCover("")}>{t("common.remove")}</Button> : null}
            </div>
          </div>
          <p className="text-2xs text-text-muted">{t("asv.coverHint")}</p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text">
          <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={s?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />{t("asv.active")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="is_featured" defaultChecked={s?.is_featured ?? false} className="size-4 accent-[var(--color-action)]" />{t("asv.featured")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="needs_products" defaultChecked={s?.needs_products ?? true} className="size-4 accent-[var(--color-action)]" />{t("asv.needsProducts")}</label>
        </div>

        {err ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">{t(`asv.err.${err}`, { defaultValue: t("svc.err.failed") })}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {s ? (confirmDelete ? (
            <span className="flex items-center gap-2 text-sm"><span className="font-bold text-danger">{t("asv.deleteConfirm")}</span>
              <Button type="button" size="sm" onClick={() => fetcher.submit({ intent: "svc_delete", id: s.id }, { method: "post" })}>{t("common.delete")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</Button></span>
          ) : <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-bold text-danger hover:underline">{t("common.delete")}</button>) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" loading={fetcher.state !== "idle"}><CheckIcon className="size-4" />{t("common.save")}</Button>
          </div>
        </div>
      </fetcher.Form>
      <MediaPickerDialog open={picker} onClose={() => setPicker(false)} title={t("asv.cover")} settings={d.media}
        uid={d.uid} supabaseUrl={d.supabaseUrl} mode="single" kinds={["image"]}
        onConfirm={(fs) => { if (fs[0]) setCover(fs[0].path); }} />
    </Dialog>
  );
}

function GroupsTab({ data: d, onEdit }: { data: LoaderData; onEdit: (g: ServiceGroup) => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  if (d.groups.length === 0) return <EmptyState title={t("asv.noGroups")} body={t("asv.noGroupsHint")} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {d.groups.map((g) => {
        const { Icon, tile } = groupLook(g.icon);
        const n = d.services.filter((s) => s.group_id === g.id).length;
        return (
          <li key={g.id} className={`flex items-start gap-3 rounded-xl border bg-surface p-4 shadow-1 ${g.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
            <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${tile}`}><Icon className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-text">{pick(en, g.name_ar, g.name_en)}</p>
              <p className="line-clamp-2 text-xs text-text-muted">{pick(en, g.desc_ar, g.desc_en)}</p>
              <p className="mt-1 text-xs font-bold text-text-muted">{t("asv.servicesCount", { count: n })}{!g.is_active ? ` · ${t("asv.hidden")}` : ""}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onEdit(g)}><PencilIcon className="size-3.5" />{t("common.edit")}</Button>
          </li>
        );
      })}
    </ul>
  );
}

function GroupDialog({ group: g, lang, onClose }: { group: ServiceGroup | null; lang: string; onClose: () => void }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher, { success: t("common.saved") });
  const [icon, setIcon] = useState(g?.icon ?? "sparkles");
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onClose(); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  const box = "rounded-md border border-border-strong bg-surface px-3 py-2 text-base focus:border-action focus:outline-none sm:text-sm";
  void lang;
  return (
    <Dialog open onClose={onClose} title={g ? t("asv.editGroup") : t("asv.newGroup")}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="grp_save" />
        {g ? <input type="hidden" name="id" value={g.id} /> : null}
        <input type="hidden" name="icon" value={icon} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input name="name_ar" label={t("asv.nameAr")} required defaultValue={g?.name_ar ?? ""} />
          <Input name="name_en" label={t("asv.nameEn")} required defaultValue={g?.name_en ?? ""} dir="ltr" />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.descAr")}<textarea name="desc_ar" rows={2} defaultValue={g?.desc_ar ?? ""} className={box} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">{t("asv.descEn")}<textarea name="desc_en" rows={2} defaultValue={g?.desc_en ?? ""} dir="ltr" className={box} /></label>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-bold text-text">{t("asv.icon")}</legend>
          <div className="flex flex-wrap gap-2">
            {SERVICE_ICONS.map((k) => {
              const { Icon, tile } = groupLook(k);
              return (
                <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={k} onClick={() => setIcon(k)}
                  className={`grid size-12 cursor-pointer place-items-center rounded-xl border-2 ${icon === k ? "border-action" : "border-transparent"} ${tile}`}><Icon className="size-5" /></button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 items-end gap-3">
          <Input name="sort" label={t("asv.sort")} type="number" dir="ltr" defaultValue={String(g?.sort ?? 0)} />
          <label className="flex h-11 items-center gap-2 text-sm text-text"><input type="checkbox" name="is_active" defaultChecked={g?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />{t("asv.active")}</label>
        </div>
        {err ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">{t(`asv.err.${err}`, { defaultValue: t("svc.err.failed") })}</p> : null}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {g ? <button type="button" onClick={() => fetcher.submit({ intent: "grp_delete", id: g.id }, { method: "post" })} className="text-sm font-bold text-danger hover:underline">{t("common.delete")}</button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" loading={fetcher.state !== "idle"}>{t("common.save")}</Button>
          </div>
        </div>
      </fetcher.Form>
    </Dialog>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}
