import { useEffect, useMemo, useState, type ReactNode } from "react";
import { data, redirect, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/services";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { parseMediaSettings, type MediaSettings } from "~/lib/media.shared";
import { getSiteUrl } from "~/lib/env.server";
import { loadKashierSettings, reconcileKashierOrder, resolveKashierMode, startKashierPayment } from "~/features/checkout/kashier.server";
import { MediaImg, mediaUrl } from "~/components/catalog/MediaImg";
import { MediaPickerDialog } from "~/features/media/components/MediaPickerDialog";
import { Badge, Button, Dialog, Drawer } from "~/components/ui";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { EmptyState } from "~/components/ui/EmptyState";
import {
  CalendarIcon, CheckIcon, ClockIcon, CreditCardIcon, DownloadIcon, LinkIcon, MinusIcon, PackageIcon, PlusIcon,
  ShieldIcon, SparklesIcon, StoreIcon, TrashIcon, VideoIcon,
} from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";
import {
  OPEN_STATUSES, PROGRESS, groupLook, pick, priceLabel, progressReached, statusTone, uploadLimit,
  type Service, type ServiceEvent, type ServiceGroup, type ServiceOrder,
} from "~/features/services/shared";

/**
 * Vendor → Services (owner brief 2026-11-16): photography, video, editing /
 * background removal, starter bundles and campaign management from the
 * platform team, grouped by section with the published prices. A vendor
 * orders with a quantity, the products to work on, reference images, a
 * preferred date and a brief, pays by card or from the wallet ("on quote"
 * services get a price first), then follows the order step by step and
 * downloads the delivered files.
 */

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
    if (admin) await reconcileKashierOrder(admin, "service", returned).catch(() => null);
  }
  const [groups, services, orders, prods, wallet, media, kashier] = await Promise.all([
    client.from("service_groups").select("id, code, name_ar, name_en, desc_ar, desc_en, icon, sort, is_active").eq("is_active", true).order("sort"),
    client.from("services").select("id, group_id, code, name_ar, name_en, desc_ar, desc_en, pricing, price_piastres, unit_ar, unit_en, min_qty, max_qty, includes, badge_ar, badge_en, delivery_days, cover_path, needs_products, sort, is_active, is_featured, upload_mode, units_included")
      .eq("is_active", true).is("deleted_at", null).order("sort"),
    vendorId ? client.from("service_orders").select("*").eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    vendorId ? client.from("products").select("id, name_ar, name_en, product_media(path, kind, position)").eq("vendor_id", vendorId)
      .is("deleted_at", null).order("updated_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    vendorId ? client.from("wallets").select("available_piastres").eq("vendor_id", vendorId).maybeSingle() : Promise.resolve({ data: null }),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
    loadKashierSettings(client).then((s) => resolveKashierMode(s, viewer.profile.role)).catch(() => null),
  ]);
  const orderRows = (orders.data ?? []) as ServiceOrder[];
  const { data: eventRows } = orderRows.length
    ? await client.from("service_order_events").select("id, order_id, kind, note, data, created_at").in("order_id", orderRows.map((o) => o.id)).order("created_at")
    : { data: [] };
  const products = ((prods.data ?? []) as Array<{ id: string; name_ar: string; name_en: string; product_media: Array<{ path: string; kind: string; position: number | null }> | null }>)
    .map((p) => ({
      id: p.id, name: lang === "en" ? p.name_en || p.name_ar : p.name_ar || p.name_en,
      image: (p.product_media ?? []).filter((m) => m.kind === "image").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.path ?? null,
    }));
  return {
    lang,
    vendorId,
    groups: (groups.data ?? []) as ServiceGroup[],
    services: (services.data ?? []) as Service[],
    orders: orderRows,
    events: (eventRows ?? []) as ServiceEvent[],
    products,
    balance: Number((wallet.data as { available_piastres?: number } | null)?.available_piastres ?? 0),
    cardOnline: kashier !== null,
    media: parseMediaSettings((media.data as { value?: unknown } | null)?.value) as MediaSettings,
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const number = String(form.get("number") ?? "");

  const payByCard = async (orderNumber: string, amount: number) => {
    const settings = await loadKashierSettings(client);
    const mode = resolveKashierMode(settings, viewer.profile.role);
    const admin = getSupabaseAdminClient();
    if (!mode || !admin) return data({ ok: false, reason: "card_unavailable" }, { status: 400 });
    await client.rpc("fn_vendor_mark_service_card", { p_number: orderNumber });
    const session = await startKashierPayment(admin, "service", {
      mode, orderNumber, totalPiastres: amount, lang,
      siteUrl: getSiteUrl(request.url),
      returnPath: `/${lang}/vendor/services?tab=orders&order=${encodeURIComponent(orderNumber)}`,
      customer: { email: viewer.user.email ?? "", reference: viewer.user.id },
      methods: settings.methods,
      description: `Etsawaa services ${orderNumber}`,
    });
    if (!session.ok) return data({ ok: false, reason: "card_unavailable" }, { status: 502 });
    throw redirect(session.sessionUrl);
  };
  const rpcResult = (res: unknown) => {
    const r = res as { ok: boolean; reason?: string } | null;
    return r?.ok ? { ok: true as const } : data({ ok: false, reason: r?.reason ?? "failed" }, { status: 400 });
  };

  if (intent === "place") {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { return data({ ok: false, reason: "bad_input" }, { status: 400 }); }
    const { data: res, error } = await client.rpc("fn_vendor_place_service_order", { p_payload: payload });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string; number?: string; status?: string; amount_piastres?: number; method?: string | null };
    if (!r.ok) return data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
    if (r.method === "card" && r.status === "pending_payment" && r.number) return payByCard(r.number, r.amount_piastres ?? 0);
    return { ok: true as const, number: r.number };
  }
  if (intent === "pay_card") {
    const { data: row } = await client.from("service_orders").select("number, status, amount_piastres").eq("number", number).maybeSingle();
    const o = row as { number: string; status: string; amount_piastres: number } | null;
    if (!o || o.status !== "pending_payment") return data({ ok: false, reason: "not_awaiting_payment" }, { status: 400 });
    return payByCard(o.number, o.amount_piastres);
  }
  if (intent === "pay_wallet") return rpcResult((await client.rpc("fn_vendor_pay_service_wallet", { p_number: number })).data);
  if (intent === "cancel") return rpcResult((await client.rpc("fn_vendor_cancel_service_order", { p_number: number })).data);
  if (intent === "accept" || intent === "revision") {
    return rpcResult((await client.rpc("fn_vendor_service_feedback", {
      p_number: number, p_action: intent, p_note: String(form.get("note") ?? "").slice(0, 2000),
    })).data);
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function VendorServices({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, groups, services, orders } = loaderData;
  const en = lang === "en";
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "orders" ? "orders" : "catalog";
  const [group, setGroup] = useState<string>("all");
  const [ordering, setOrdering] = useState<Service | null>(null);
  const openNumber = params.get("order");
  const openOrder = orders.find((o) => o.number === openNumber) ?? null;
  const active = orders.filter((o) => OPEN_STATUSES.includes(o.status)).length;
  const setTab = (k: string) => setParams((sp) => { sp.set("tab", k); sp.delete("order"); sp.delete("kashier"); return sp; }, { replace: true, preventScrollReset: true });

  const shownGroups = groups.filter((g) => (group === "all" || g.id === group) && services.some((s) => s.group_id === g.id));
  const ungrouped = group === "all" ? services.filter((s) => !s.group_id || !groups.some((g) => g.id === s.group_id)) : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("svc.title")} subtitle={t("svc.subtitle")} />

      {/* promise strip: what every service guarantees */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-l from-action/90 to-primary p-5 text-on-action shadow-1 sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 size-48 rounded-full bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 end-24 size-40 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xl font-black sm:text-2xl">{t("svc.heroTitle")}</p>
            <p className="mt-1.5 text-sm leading-6 text-on-action/90">{t("svc.heroBody")}</p>
          </div>
          <ul className="grid gap-2 text-sm font-bold sm:grid-cols-3 lg:w-auto">
            {[
              { icon: <SparklesIcon className="size-4" />, text: t("svc.promise1") },
              { icon: <ShieldIcon className="size-4" />, text: t("svc.promise2") },
              { icon: <ClockIcon className="size-4" />, text: t("svc.promise3") },
            ].map((p) => (
              <li key={p.text} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 backdrop-blur-sm">{p.icon}<span>{p.text}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <nav className="flex gap-1.5 rounded-lg border border-border bg-surface p-1.5 shadow-1" role="tablist">
        {(["catalog", "orders"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-extrabold transition-colors sm:flex-none ${tab === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint hover:text-text"}`}>
            {t(`svc.tab.${k}`)}
            {k === "orders" && active ? <span className={`num rounded-full px-1.5 text-2xs ${tab === k ? "bg-on-action/20" : "bg-action text-on-action"}`}>{active}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "catalog" ? (
        services.length === 0 ? <EmptyState title={t("svc.noServices")} body={t("svc.noServicesHint")} /> : (
          <>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={t("svc.sections")}>
              <Chip on={group === "all"} onClick={() => setGroup("all")}>{t("svc.all")}</Chip>
              {groups.filter((g) => services.some((s) => s.group_id === g.id)).map((g) => {
                const { Icon } = groupLook(g.icon);
                return <Chip key={g.id} on={group === g.id} onClick={() => setGroup(g.id)}><Icon className="size-4" />{pick(en, g.name_ar, g.name_en)}</Chip>;
              })}
            </div>
            {shownGroups.map((g) => {
              const { Icon, tile } = groupLook(g.icon);
              return (
                <section key={g.id} aria-labelledby={`sg-${g.id}`} className="flex flex-col gap-3">
                  <header className="flex items-start gap-3">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${tile}`}><Icon className="size-5" /></span>
                    <div className="min-w-0">
                      <h2 id={`sg-${g.id}`} className="text-lg font-black text-text">{pick(en, g.name_ar, g.name_en)}</h2>
                      {pick(en, g.desc_ar, g.desc_en) ? <p className="text-sm leading-6 text-text-muted">{pick(en, g.desc_ar, g.desc_en)}</p> : null}
                    </div>
                  </header>
                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {services.filter((s) => s.group_id === g.id).map((s) => <ServiceCard key={s.id} s={s} icon={g.icon} lang={lang} onOrder={() => setOrdering(s)} />)}
                  </ul>
                </section>
              );
            })}
            {ungrouped.length ? (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {ungrouped.map((s) => <ServiceCard key={s.id} s={s} icon={null} lang={lang} onOrder={() => setOrdering(s)} />)}
              </ul>
            ) : null}
          </>
        )
      ) : (
        <OrdersList data={loaderData} onOpen={(n) => setParams((sp) => { sp.set("order", n); return sp; }, { preventScrollReset: true })} onBrowse={() => setTab("catalog")} />
      )}

      {ordering ? <OrderDialog service={ordering} onClose={() => setOrdering(null)} data={loaderData}
        onPlaced={(n) => { setOrdering(null); setParams((sp) => { sp.set("tab", "orders"); if (n) sp.set("order", n); return sp; }, { preventScrollReset: true }); }} /> : null}
      <OrderDrawer order={openOrder} data={loaderData} onClose={() => setParams((sp) => { sp.delete("order"); sp.delete("kashier"); return sp; }, { replace: true, preventScrollReset: true })} />
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${on ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action hover:text-action"}`}>
      {children}
    </button>
  );
}

function ServiceCard({ s, icon, lang, onOrder }: { s: Service; icon: string | null; lang: string; onOrder: () => void }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const { Icon, tile } = groupLook(icon);
  const price = priceLabel(s, en, t("svc.onQuote"));
  const badge = pick(en, s.badge_ar, s.badge_en);
  return (
    <li className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-1 transition-shadow hover:shadow-2 ${s.is_featured || badge ? "border-action/60" : "border-border"}`}>
      {s.cover_path ? (
        <div className="aspect-[16/9] overflow-hidden bg-surface-tint">
          <MediaImg path={s.cover_path} alt="" width={640} height={360} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        </div>
      ) : null}
      {badge ? <span className="absolute end-3 top-3 rounded-full bg-action px-2.5 py-1 text-2xs font-black text-on-action shadow-1">{badge}</span> : null}
      <div className="flex flex-1 flex-col gap-3 p-5">
        {!s.cover_path ? <span className={`grid size-11 place-items-center rounded-xl ${tile}`}><Icon className="size-5" /></span> : null}
        <div>
          <h3 className="text-base font-black leading-7 text-text">{pick(en, s.name_ar, s.name_en)}</h3>
          {pick(en, s.desc_ar, s.desc_en) ? <p className="mt-0.5 text-sm leading-6 text-text-muted">{pick(en, s.desc_ar, s.desc_en)}</p> : null}
        </div>
        <p className="flex flex-wrap items-baseline gap-1.5">
          <span className={`num font-black ${s.pricing === "quote" ? "text-lg text-text" : "text-2xl text-action"}`}>{price.main}</span>
          {price.per ? <span className="text-sm font-bold text-text-muted">/ {price.per}</span> : null}
        </p>
        {s.includes?.length ? (
          <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
            {s.includes.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text">
                <CheckIcon className="mt-1 size-3.5 shrink-0 text-success" /><span>{pick(en, line.ar, line.en)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs font-bold text-text-muted">
          {s.delivery_days ? <span className="flex items-center gap-1 rounded-full bg-surface-tint px-2.5 py-1"><ClockIcon className="size-3.5" />{t("svc.deliveryDays", { count: s.delivery_days })}</span> : null}
          {s.pricing === "per_unit" ? <span className="rounded-full bg-surface-tint px-2.5 py-1">{t("svc.qtyRange", { min: s.min_qty, max: s.max_qty })}</span> : null}
        </div>
        <Button className="w-full" onClick={onOrder}>{s.pricing === "quote" ? t("svc.requestQuote") : t("svc.order")}</Button>
      </div>
    </li>
  );
}

/** Order a service: quantity, products, references, date, brief → pay. */
function OrderDialog({ service: s, onClose, onPlaced, data: d }: { service: Service; onClose: () => void; onPlaced: (number?: string) => void; data: LoaderData }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<{ ok: boolean; reason?: string; number?: string }>();
  const [qty, setQty] = useState(s.min_qty);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [brief, setBrief] = useState("");
  const [method, setMethod] = useState<"card" | "wallet">(d.cardOnline ? "card" : "wallet");
  const [picker, setPicker] = useState(false);
  const [attemptKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`));
  const quote = s.pricing === "quote";
  const work = s.upload_mode === "work";
  // a per-unit "work" service: the uploaded files ARE the quantity
  const filesDriveQty = work && s.pricing === "per_unit";
  const units = filesDriveQty ? attachments.length : qty;
  const limit = uploadLimit(s, qty);
  const overLimit = attachments.length > limit;
  const total = s.pricing === "per_unit" ? s.price_piastres * units : s.pricing === "fixed" ? s.price_piastres : 0;
  const kinds: Array<"image" | "video"> = work ? (/video/i.test(s.unit_en) ? ["video"] : ["image"]) : ["image", "video"];
  const canWallet = d.balance >= total;
  const unit = pick(en, s.unit_ar, s.unit_en);
  const clamp = (n: number) => Math.min(s.max_qty, Math.max(s.min_qty, Number.isFinite(n) ? Math.round(n) : s.min_qty));
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  const busy = fetcher.state !== "idle";
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onPlaced(fetcher.data.number); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const submit = () => fetcher.submit({ intent: "place", payload: JSON.stringify({
    attempt_key: attemptKey, service_id: s.id, quantity: filesDriveQty ? attachments.length : qty, method, brief, product_ids: productIds, attachments, preferred_date: date,
  }) }, { method: "post" });
  const missingFiles = work && (attachments.length === 0 || (filesDriveQty && attachments.length < s.min_qty));
  const blocked = missingFiles || overLimit || (!quote && ((method === "card" && !d.cardOnline) || (method === "wallet" && !canWallet)));

  return (
    <Dialog open onClose={onClose} title={quote ? t("svc.requestQuote") : t("svc.order")} size="lg">
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-tint/50 p-4">
          <div className="min-w-0">
            <p className="font-black text-text">{pick(en, s.name_ar, s.name_en)}</p>
            {pick(en, s.desc_ar, s.desc_en) ? <p className="mt-0.5 text-sm text-text-muted">{pick(en, s.desc_ar, s.desc_en)}</p> : null}
          </div>
          <span className="num shrink-0 text-end text-sm font-black text-action">
            {priceLabel(s, en, t("svc.onQuote")).main}{priceLabel(s, en, "").per ? <span className="block text-2xs font-bold text-text-muted">/ {unit}</span> : null}
          </span>
        </div>

        {s.pricing === "per_unit" && !filesDriveQty ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-text">{t("svc.quantity", { unit: unit || t("svc.unitDefault") })}</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center overflow-hidden rounded-lg border border-border-strong">
                <button type="button" onClick={() => setQty((q) => clamp(q - 1))} disabled={qty <= s.min_qty} aria-label={t("svc.less")}
                  className="grid size-11 cursor-pointer place-items-center text-text hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"><MinusIcon className="size-4" /></button>
                <input type="number" inputMode="numeric" min={s.min_qty} max={s.max_qty} value={qty} dir="ltr" aria-label={t("svc.quantity", { unit })}
                  onChange={(e) => setQty(clamp(Number(e.target.value)))}
                  className="num h-11 w-20 border-x border-border-strong bg-surface text-center text-base font-black text-text focus:outline-none" />
                <button type="button" onClick={() => setQty((q) => clamp(q + 1))} disabled={qty >= s.max_qty} aria-label={t("svc.more")}
                  className="grid size-11 cursor-pointer place-items-center text-text hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"><PlusIcon className="size-4" /></button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[10, 25, 50, 100].filter((n) => n >= s.min_qty && n <= s.max_qty).map((n) => (
                  <button key={n} type="button" onClick={() => setQty(n)}
                    className={`num cursor-pointer rounded-full border px-3 py-1.5 text-xs font-bold ${qty === n ? "border-action bg-action/10 text-action" : "border-border text-text-muted hover:border-action"}`}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {s.needs_products ? (
          <SelectMenu label={t("svc.products")} multiple searchable value={productIds} onChange={setProductIds}
            hint={t("svc.productsHint")} placeholder={t("svc.productsPh")}
            options={d.products.map((p) => ({
              value: p.id, label: p.name,
              icon: p.image ? <MediaImg path={p.image} alt="" width={24} height={24} className="size-6 rounded object-cover" /> : <PackageIcon className="size-4 text-text-faint" />,
            }))} />
        ) : null}

        {s.upload_mode !== "none" ? (
          <div className={`flex flex-col gap-2 ${work ? "rounded-xl border-2 border-dashed border-action/40 bg-action/[0.03] p-4" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-bold text-text">
                {work ? t("svc.workFiles", { unit: unit || t("svc.unitDefault") }) : t("svc.references")}
                {work ? <span className="text-danger"> *</span> : null}
              </span>
              <span className={`num text-xs font-bold ${overLimit ? "text-danger" : "text-text-muted"}`}>{t("svc.filesCount", { count: attachments.length, max: limit })}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {attachments.map((path) => (
                <span key={path} className="relative size-20 overflow-hidden rounded-lg border border-border bg-surface-tint">
                  {/\.(mp4|mov|webm|m4v)$/i.test(path) ? <span className="grid size-full place-items-center text-text-muted"><VideoIcon className="size-6" /></span>
                    : <MediaImg path={path} alt="" width={80} height={80} className="size-full object-cover" />}
                  <button type="button" onClick={() => setAttachments((a) => a.filter((x) => x !== path))} aria-label={t("common.remove")}
                    className="absolute end-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full bg-black/55 text-white"><TrashIcon className="size-3.5" /></button>
                </span>
              ))}
              {attachments.length < limit ? (
                <button type="button" onClick={() => setPicker(true)}
                  className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-surface text-2xs font-bold text-text-muted hover:border-action hover:text-action">
                  <PlusIcon className="size-5" />{work ? t("svc.uploadWork") : t("svc.addImages")}
                </button>
              ) : null}
            </div>
            {attachments.length > 1 ? <button type="button" onClick={() => setAttachments([])} className="self-start text-xs font-bold text-text-muted hover:text-danger">{t("svc.clearFiles")}</button> : null}
            <p className="text-2xs leading-5 text-text-muted">
              {work ? (filesDriveQty ? t("svc.workHintUnits", { max: limit, unit: unit || t("svc.unitDefault") }) : t("svc.workHint", { max: limit })) : t("svc.referencesHintN", { max: limit })}
            </p>
            {overLimit ? <p className="text-xs font-bold text-danger">{t("svc.overLimit", { max: limit })}</p> : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            <span className="flex items-center gap-1.5"><CalendarIcon className="size-4 text-text-muted" />{t("svc.preferredDate")}</span>
            <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} dir="ltr"
              className="h-11 rounded-md border border-border-strong bg-surface px-3 text-base font-normal focus:border-action focus:outline-none sm:text-sm" />
          </label>
          <div className="flex flex-col justify-end text-xs leading-5 text-text-muted">{t("svc.preferredDateHint")}</div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
          {quote ? <span>{t("svc.briefQuote")} <span className="text-danger">*</span></span> : t("svc.brief")}
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={3000} placeholder={t("svc.briefPh")}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base font-normal focus:border-action focus:outline-none sm:text-sm" />
        </label>

        {quote ? (
          <p className="rounded-lg bg-info-soft p-3 text-sm text-text">{t("svc.quoteNote")}</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface-tint/50 p-4">
              <span className="text-sm font-bold text-text-muted">
                {t("svc.total")}{s.pricing === "per_unit" ? <span className="num ms-1 text-xs">({units} × {money(s.price_piastres)})</span> : null}
              </span>
              <span className="num text-2xl font-black text-action">{money(total)}</span>
            </div>
            <div role="radiogroup" aria-label={t("svc.payMethod")} className="grid gap-2 sm:grid-cols-2">
              <MethodCard on={method === "card"} disabled={!d.cardOnline} onPick={() => setMethod("card")} icon={<CreditCardIcon />}
                title={t("va.payCard")} hint={d.cardOnline ? t("va.payCardHint") : t("va.cardOff")} />
              <MethodCard on={method === "wallet"} disabled={!canWallet} onPick={() => setMethod("wallet")} icon={<StoreIcon />}
                title={t("va.payWallet")} hint={t("va.balance", { amount: money(d.balance) }) + (canWallet ? "" : ` — ${t("va.notEnough")}`)} />
            </div>
          </>
        )}

        {err ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">{t(`svc.err.${err}`, { defaultValue: t("svc.err.failed") })}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={busy} disabled={blocked || (quote && brief.trim().length < 5)} onClick={submit}>
            {quote ? t("svc.sendQuote") : method === "card" ? t("svc.payCardNow", { amount: money(total) }) : t("svc.payWalletNow", { amount: money(total) })}
          </Button>
        </div>
      </div>
      <MediaPickerDialog open={picker} onClose={() => setPicker(false)} title={work ? t("svc.workFiles", { unit: unit || t("svc.unitDefault") }) : t("svc.references")} settings={d.media}
        uid={d.uid} supabaseUrl={d.supabaseUrl} mode="multi" kinds={kinds}
        onConfirm={(files) => setAttachments((a) => [...new Set([...a, ...files.map((f) => f.path)])].slice(0, limit))} />
    </Dialog>
  );
}

function MethodCard({ on, disabled, onPick, icon, title, hint }: { on: boolean; disabled: boolean; onPick: () => void; icon: ReactNode; title: string; hint: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-action bg-action/5" : "border-border hover:border-border-strong"}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${on ? "bg-action text-on-action" : "bg-surface-tint text-text-muted"}`}>{icon}</span>
      <span><span className="block text-sm font-extrabold text-text">{title}</span><span className="block text-xs text-text-muted">{hint}</span></span>
    </button>
  );
}

function OrdersList({ data: d, onOpen, onBrowse }: { data: LoaderData; onOpen: (n: string) => void; onBrowse: () => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const list = d.orders.filter((o) => filter === "all" || (filter === "open" ? OPEN_STATUSES.includes(o.status) : !OPEN_STATUSES.includes(o.status)));
  const groupIcon = (o: ServiceOrder) => d.groups.find((g) => g.id === o.service_snapshot.group_id)?.icon ?? null;
  const day = (v: string) => new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
  if (d.orders.length === 0) return <EmptyState title={t("svc.noOrders")} body={t("svc.noOrdersHint")} action={<Button onClick={onBrowse}>{t("svc.browse")}</Button>} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2" role="group">
        {(["open", "done", "all"] as const).map((k) => <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{t(`svc.filter.${k}`)}</Chip>)}
      </div>
      {list.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("svc.nothingHere")}</p> : null}
      <ul className="flex flex-col gap-3">
        {list.map((o) => {
          const { Icon, tile } = groupLook(groupIcon(o));
          const reached = progressReached(o.status);
          const needsYou = o.status === "pending_payment" || o.status === "delivered";
          return (
            <li key={o.id}>
              <button type="button" onClick={() => onOpen(o.number)}
                className={`flex w-full cursor-pointer flex-col gap-3 rounded-xl border bg-surface p-4 text-start shadow-1 transition-shadow hover:shadow-2 ${needsYou ? "border-action/50" : "border-border"}`}>
                <div className="flex items-start gap-3">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${tile}`}><Icon className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-text">{pick(en, o.service_snapshot.name_ar, o.service_snapshot.name_en)}</p>
                    <p className="num text-xs text-text-muted" dir="ltr">{o.number} · {day(o.created_at)}{o.quantity > 1 ? ` · ×${o.quantity}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={statusTone(o.status)}>{t(`svc.status.${o.status}`)}</Badge>
                    {o.amount_piastres > 0 ? <span className="num text-sm font-black text-text">{formatPiastres(o.amount_piastres, en ? "en" : "ar")}</span> : null}
                  </div>
                </div>
                {o.status !== "cancelled" && o.status !== "rejected" ? (
                  <ol className="grid grid-cols-6 gap-1" aria-label={t("svc.progress")}>
                    {PROGRESS.map((step, i) => <li key={step} className={`h-1.5 rounded-full ${i < reached ? "bg-action" : "bg-surface-tint"}`} title={t(`svc.step.${step}`)} />)}
                  </ol>
                ) : null}
                {needsYou ? <p className="text-xs font-extrabold text-action">{t(o.status === "pending_payment" ? "svc.needPay" : "svc.needReview")}</p> : null}
                {o.status === "scheduled" && o.scheduled_at ? (
                  <p className="flex items-center gap-1.5 text-xs font-bold text-text"><CalendarIcon className="size-3.5 text-info" />{t("svc.scheduledFor", { date: new Date(o.scheduled_at).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) })}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One order: summary, what to do now, deliverables, timeline. */
function OrderDrawer({ order: o, data: d, onClose }: { order: ServiceOrder | null; data: LoaderData; onClose: () => void }) {
  const { t } = useTranslation();
  const en = d.lang === "en";
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher, { success: t("common.saved") });
  const [revision, setRevision] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { setRevision(false); setNote(""); }, [o?.id]);
  if (!o) return <Drawer open={false} onClose={onClose} title=""><span /></Drawer>;
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const when = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const events = d.events.filter((e) => e.order_id === o.id);
  const products = d.products.filter((p) => o.product_ids.includes(p.id));
  const busy = fetcher.state !== "idle";
  const canWallet = d.balance >= o.amount_piastres;
  const isVideo = (p: string) => /\.(mp4|mov|webm|m4v)$/i.test(p);
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;

  return (
    <Drawer open onClose={onClose} title={pick(en, o.service_snapshot.name_ar, o.service_snapshot.name_en)}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="num text-sm font-bold text-text-muted" dir="ltr">{o.number}</span>
          <Badge tone={statusTone(o.status)}>{t(`svc.status.${o.status}`)}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-tint/40 p-4 text-sm">
          <div><dt className="text-xs text-text-muted">{t("svc.amount")}</dt><dd className="num font-black text-text">{o.amount_piastres > 0 ? money(o.amount_piastres) : t("svc.onQuote")}</dd></div>
          <div><dt className="text-xs text-text-muted">{t("svc.qty")}</dt><dd className="num font-black text-text">{o.quantity}</dd></div>
          {o.preferred_date ? <div><dt className="text-xs text-text-muted">{t("svc.preferredDate")}</dt><dd className="font-bold text-text">{o.preferred_date}</dd></div> : null}
          {o.scheduled_at ? <div><dt className="text-xs text-text-muted">{t("svc.scheduled")}</dt><dd className="font-bold text-text">{when(o.scheduled_at)}</dd></div> : null}
        </dl>

        {/* what the vendor can do now */}
        {o.status === "pending_payment" ? (
          <section className="flex flex-col gap-3 rounded-xl border-2 border-action/40 p-4">
            <p className="text-sm font-extrabold text-text">{t("svc.payToStart", { amount: money(o.amount_piastres) })}</p>
            {o.quote_note ? <p className="rounded-md bg-info-soft p-2.5 text-sm text-text">{o.quote_note}</p> : null}
            <fetcher.Form method="post" className="flex flex-wrap gap-2">
              <input type="hidden" name="number" value={o.number} />
              {d.cardOnline ? <Button type="submit" name="intent" value="pay_card" loading={busy}><CreditCardIcon className="size-4" />{t("va.payCard")}</Button> : null}
              <Button type="submit" name="intent" value="pay_wallet" variant="outline" disabled={!canWallet || busy}><StoreIcon className="size-4" />{t("va.payWallet")}</Button>
              <Button type="submit" name="intent" value="cancel" variant="ghost" disabled={busy}>{t("svc.cancelOrder")}</Button>
            </fetcher.Form>
            {!canWallet ? <p className="text-xs text-text-muted">{t("va.balance", { amount: money(d.balance) })} — {t("va.notEnough")}</p> : null}
          </section>
        ) : null}
        {o.status === "awaiting_quote" ? (
          <section className="flex flex-col gap-3 rounded-xl bg-info-soft p-4 text-sm text-text">
            <p>{t("svc.waitingQuote")}</p>
            <fetcher.Form method="post"><input type="hidden" name="number" value={o.number} />
              <Button type="submit" name="intent" value="cancel" variant="ghost" size="sm" disabled={busy}>{t("svc.cancelOrder")}</Button>
            </fetcher.Form>
          </section>
        ) : null}
        {o.status === "rejected" ? (
          <section className="rounded-xl bg-danger-soft p-4 text-sm text-text">
            <b>{t("svc.rejectedBecause")}</b> {o.reject_reason}
            {o.payment_status === "refunded" ? <p className="mt-1 text-xs font-bold text-text-muted">{t("va.refundedWallet")}</p> : null}
          </section>
        ) : null}

        {/* deliverables */}
        {(o.delivered_files.length || o.delivered_links.length) ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-black text-text">{t("svc.deliverables")}</h3>
            {o.delivery_note ? <p className="rounded-md bg-surface-tint p-3 text-sm text-text">{o.delivery_note}</p> : null}
            {o.delivered_files.length ? (
              <ul className="grid grid-cols-3 gap-2">
                {o.delivered_files.map((p) => (
                  <li key={p} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-tint">
                    {isVideo(p) ? <span className="grid size-full place-items-center text-text-muted"><VideoIcon className="size-7" /></span>
                      : <MediaImg path={p} alt="" width={160} height={160} className="size-full object-cover" />}
                    <a href={mediaUrl(p)} download target="_blank" rel="noopener noreferrer" aria-label={t("svc.download")}
                      className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-md bg-black/60 py-1 text-2xs font-bold text-white opacity-90 hover:opacity-100">
                      <DownloadIcon className="size-3.5" />{t("svc.download")}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {o.delivered_links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 truncate rounded-lg border border-border px-3 py-2.5 text-sm font-bold text-action hover:bg-surface-tint" dir="ltr">
                <LinkIcon className="size-4 shrink-0" /><span className="truncate">{l}</span>
              </a>
            ))}
            {o.status === "delivered" ? (
              <div className="flex flex-col gap-2 rounded-xl border-2 border-action/40 p-4">
                <p className="text-sm font-extrabold text-text">{t("svc.reviewDelivery")}</p>
                {revision ? (
                  <fetcher.Form method="post" className="flex flex-col gap-2">
                    <input type="hidden" name="number" value={o.number} />
                    <textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} required placeholder={t("svc.revisionPh")}
                      className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base focus:border-action focus:outline-none sm:text-sm" />
                    <div className="flex gap-2">
                      <Button type="submit" name="intent" value="revision" size="sm" loading={busy} disabled={note.trim().length < 3}>{t("svc.sendRevision")}</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRevision(false)}>{t("common.cancel")}</Button>
                    </div>
                  </fetcher.Form>
                ) : (
                  <fetcher.Form method="post" className="flex flex-wrap gap-2">
                    <input type="hidden" name="number" value={o.number} />
                    <Button type="submit" name="intent" value="accept" size="sm" loading={busy}><CheckIcon className="size-4" />{t("svc.accept")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setRevision(true)}>{t("svc.askRevision")}</Button>
                  </fetcher.Form>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
        {err ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">{t(`svc.err.${err}`, { defaultValue: t("svc.err.failed") })}</p> : null}

        {/* what was asked */}
        {o.brief || products.length || o.attachments.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-black text-text">{t("svc.yourRequest")}</h3>
            {o.brief ? <p className="whitespace-pre-line rounded-md bg-surface-tint p-3 text-sm text-text">{o.brief}</p> : null}
            {products.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {products.map((p) => <li key={p.id} className="rounded-full border border-border px-2.5 py-1 text-xs font-bold text-text">{p.name}</li>)}
              </ul>
            ) : null}
            {o.attachments.length ? (
              <>
                <p className="text-xs font-bold text-text-muted">{t(o.service_snapshot.upload_mode === "work" ? "svc.uploadedWork" : "svc.uploadedRefs", { count: o.attachments.length })}</p>
                <ul className="flex flex-wrap gap-2">
                  {o.attachments.map((p) => <li key={p} className="size-14 overflow-hidden rounded-md border border-border"><MediaImg path={p} alt="" width={56} height={56} className="size-full object-cover" /></li>)}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-black text-text">{t("svc.timeline")}</h3>
          <ol className="flex flex-col gap-0">
            {events.map((e, i) => (
              <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                {i < events.length - 1 ? <span aria-hidden="true" className="absolute start-[7px] top-5 h-[calc(100%-12px)] w-0.5 bg-border" /> : null}
                <span aria-hidden="true" className={`mt-1.5 size-4 shrink-0 rounded-full border-2 ${i === events.length - 1 ? "border-action bg-action" : "border-action bg-surface"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text">{t(`svc.ev.${e.kind}`, { defaultValue: e.kind })}</p>
                  <p className="text-xs text-text-muted">{when(e.created_at)}</p>
                  {e.note ? <p className="mt-1 whitespace-pre-line rounded-md bg-surface-tint px-2.5 py-1.5 text-sm text-text">{e.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Drawer>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}
