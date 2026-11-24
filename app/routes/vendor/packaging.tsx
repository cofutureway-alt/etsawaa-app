import { useMemo, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/packaging";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { publicMediaUrl } from "~/lib/media.shared";
import { Badge, Button, EmptyState } from "~/components/ui";
import { CreditCardIcon, CashIcon, MinusIcon, PackageIcon, PlusIcon, ReceiptIcon, TrashIcon } from "~/components/ui/icons";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { PayMethodsNote } from "~/components/checkout/PayMethodsNote";
import { loadKashierSettings, resolveKashierMode, startKashierPayment } from "~/features/checkout/kashier.server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getSiteUrl } from "~/lib/env.server";
import {
  availableQty, baseQty, lineError, orderTotals, unitPrice, unitsFor, type PackagingItem, type PackagingUnit,
} from "~/features/packaging/pricing";

/**
 * Seller → Packaging store: browse the platform's packaging materials, buy
 * pieces / rolls (or metres of a roll) in any quantity, then choose
 *   • Full payment — card or cash on delivery, normal shipping fee
 *   • 50% now     — card only; the other half is collected from the wallet
 *                   with the first delivered order after this purchase.
 * Prices, stock and the plan rules are enforced by
 * fn_vendor_place_packaging_order; the cart here is a preview.
 */

interface StoreItem extends PackagingItem {
  sku: string; category: string; name_ar: string; name_en: string; description_ar: string; description_en: string;
  spec_ar: string; spec_en: string; image_path: string | null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const kashierMode = resolveKashierMode(await loadKashierSettings(client), viewer.profile.role);
  const { data: vendorId } = await client.rpc("own_vendor_id");
  const [items, cfg, vendor, open, deferred] = await Promise.all([
    client.from("packaging_items").select("id, sku, category, name_ar, name_en, description_ar, description_en, unit, roll_length_m, spec_ar, spec_en, price_piastres, meter_price_piastres, stock_base, min_qty, max_qty, image_path").order("sort").order("sku"),
    client.rpc("fn_packaging_settings"),
    client.from("vendors").select("status, governorates(shipping_fee_piastres)").eq("id", vendorId as string).maybeSingle(),
    client.from("packaging_balances").select("id", { count: "exact", head: true }).eq("status", "open"),
    client.rpc("fn_vendor_deferred_status"),
  ]);
  const settings = (cfg.data ?? {}) as { split_enabled?: boolean; split_percent?: number; max_open_balances?: number; cod_enabled?: boolean; deferred_enabled?: boolean; deferred_max_orders?: number };
  const v = vendor.data as { status: string; governorates: { shipping_fee_piastres: number } | null } | null;
  return {
    lang,
    items: (items.data ?? []) as StoreItem[],
    shipping: v?.governorates?.shipping_fee_piastres ?? 0,
    storeActive: v?.status === "active",
    splitPercent: settings.split_percent ?? 50,
    splitAllowed: (settings.split_enabled ?? true) && (open.count ?? 0) < (settings.max_open_balances ?? 1),
    splitBlockedByBalance: (open.count ?? 0) >= (settings.max_open_balances ?? 1),
    codEnabled: settings.cod_enabled ?? true,
    // pay from the first delivered order's earnings (no open balance allowed alongside)
    deferredAllowed: (settings.deferred_enabled ?? true) && (open.count ?? 0) < Math.max(1, settings.max_open_balances ?? 1),
    deferredEnabled: settings.deferred_enabled ?? true,
    deferredMaxOrders: settings.deferred_max_orders ?? 10,
    deferred: (deferred.data ?? { open: false }) as { open: boolean; amount_piastres?: number; number?: string; orders_taken?: number; max_orders?: number },
    cardOnline: kashierMode !== null,
    cardTest: kashierMode === "test",
    attemptKey: crypto.randomUUID(),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  let items: unknown;
  try { items = JSON.parse(String(form.get("items") ?? "[]")); } catch { items = null; }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return data({ ok: false, reason: "no_items" }, { status: 400 });
  const { data: res, error } = await client.rpc("fn_vendor_place_packaging_order", {
    p_payload: {
      attempt_key: String(form.get("attempt_key") ?? ""),
      plan: String(form.get("plan") ?? "full"),
      method: String(form.get("method") ?? "card"),
      notes: String(form.get("notes") ?? "").slice(0, 500),
      items,
    },
  });
  if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res as { ok: boolean; reason?: string; number?: string; due_now_piastres?: number };
  if (!r.ok || !r.number) return data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
  const orderPath = `/${lang}/vendor/packaging/orders/${encodeURIComponent(r.number)}`;
  // card + something due now → straight to the hosted payment page
  if ((r.due_now_piastres ?? 0) > 0) {
    const settings = await loadKashierSettings(client);
    const mode = resolveKashierMode(settings, viewer.profile.role);
    const admin = getSupabaseAdminClient();
    if (mode && admin) {
      const session = await startKashierPayment(admin, "packaging", {
        mode, orderNumber: r.number, totalPiastres: r.due_now_piastres ?? 0, lang,
        siteUrl: getSiteUrl(request.url), returnPath: orderPath,
        customer: { email: viewer.user.email ?? "", reference: viewer.user.id },
        methods: settings.methods,
        description: `Etsawaa packaging ${r.number}`,
      });
      if (session.ok) throw redirect(session.sessionUrl);
    }
  }
  throw redirect(`${orderPath}?placed=1`);
}

type Cart = Record<string, number>; // `${itemId}:${unit}` → qty

export default function VendorPackagingStore({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, items, shipping, splitPercent, supabaseUrl } = loaderData;
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, lang);
  const [cart, setCart] = useState<Cart>({});
  const [units, setUnits] = useState<Record<string, PackagingUnit>>({});
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<"full" | "split">("full");
  const [method, setMethod] = useState<"card" | "cod" | "deferred">(loaderData.cardOnline || !loaderData.codEnabled ? "card" : "cod");
  const [notes, setNotes] = useState("");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const baseInCart = (itemId: string, except?: string) => Object.entries(cart).reduce((s, [k, q]) => {
    const [id, u] = k.split(":") as [string, PackagingUnit];
    const it = byId.get(id);
    return id === itemId && k !== except && it ? s + baseQty(it, u, q) : s;
  }, 0);
  const lines = Object.entries(cart).map(([k, qty]) => {
    const [id, unit] = k.split(":") as [string, PackagingUnit];
    const item = byId.get(id)!;
    return { key: k, item, unit, qty, price: unitPrice(item, unit) ?? 0, error: lineError(item, unit, qty, baseInCart(id, k)) };
  }).filter((l) => l.item);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const effectivePlan = loaderData.splitAllowed ? plan : "full";
  const effectiveMethod = effectivePlan === "split" ? "card" : method === "deferred" && !loaderData.deferredAllowed ? "card" : method;
  const payLaterAll = effectiveMethod === "cod" || effectiveMethod === "deferred";
  const totals = orderTotals(subtotal, lines.length ? shipping : 0, effectivePlan, splitPercent);
  const invalid = lines.some((l) => l.error) || lines.length === 0;

  const add = (item: StoreItem) => {
    const unit = units[item.id] ?? unitsFor(item)[0]!;
    const qty = Math.max(qtys[item.id] ?? (unit === "meter" ? 10 : item.min_qty), 1);
    setCart((c) => ({ ...c, [`${item.id}:${unit}`]: (c[`${item.id}:${unit}`] ?? 0) + qty }));
  };
  const setLine = (key: string, qty: number) => setCart((c) => {
    const n = { ...c };
    if (qty <= 0) delete n[key]; else n[key] = qty;
    return n;
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("pkg.storeTitle")} subtitle={t("pkg.storeHint")}
        actions={<Link to={`/${lang}/vendor/packaging/orders`} className="rounded-md border border-border px-4 py-2 text-sm font-bold text-text hover:bg-surface-tint">{t("pkg.myOrders")}</Link>} />
      {loaderData.deferred.open ? (
        <p role="status" className={`rounded-md border p-3 text-sm text-text ${(loaderData.deferred.orders_taken ?? 0) >= (loaderData.deferred.max_orders ?? 10) ? "border-danger/40 bg-danger-soft" : "border-info/30 bg-info-soft"}`}>
          {t((loaderData.deferred.orders_taken ?? 0) >= (loaderData.deferred.max_orders ?? 10) ? "pkg.deferredCapReached" : "pkg.deferredOpen", {
            number: loaderData.deferred.number, amount: money(loaderData.deferred.amount_piastres ?? 0),
            taken: loaderData.deferred.orders_taken ?? 0, max: loaderData.deferred.max_orders ?? 10,
          })}
        </p>
      ) : null}
      {!loaderData.storeActive ? <p role="status" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-text">{t("pkg.storeNotActive")}</p> : null}

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <section className="lg:col-span-8">
          {items.length === 0 ? <EmptyState title={t("pkg.emptyStore")} /> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const unitOptions = unitsFor(item);
                const unit = units[item.id] ?? unitOptions[0]!;
                const price = unitPrice(item, unit) ?? 0;
                const left = availableQty(item, unit);
                const out = left === 0;
                return (
                  <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-1">
                    <div className="flex gap-3">
                      <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint text-text-faint">
                        {item.image_path ? <img src={publicMediaUrl(supabaseUrl, item.image_path)} alt="" loading="lazy" className="size-full object-cover" /> : <PackageIcon className="size-8" />}
                      </span>
                      <div className="min-w-0">
                        <p className="font-extrabold text-text">{en ? item.name_en : item.name_ar}</p>
                        {item.spec_ar ? <p className="text-xs text-text-muted">{en ? item.spec_en : item.spec_ar}</p> : null}
                        <p className="mt-1"><b className="num text-lg text-action">{money(price)}</b> <span className="text-xs text-text-muted">/ {t(`pkg.unit_${unit}`)}</span></p>
                        <p className={`text-xs font-bold ${out ? "text-danger" : "text-text-muted"}`}>
                          {out ? t("pkg.outOfStock") : t("pkg.inStock", { n: left, unit: t(`pkg.unit_${unit}`) })}
                        </p>
                      </div>
                    </div>
                    {(en ? item.description_en : item.description_ar) ? <p className="text-xs text-text-muted">{en ? item.description_en : item.description_ar}</p> : null}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {unitOptions.length > 1 ? (
                        <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label={t("pkg.unit")}>
                          {unitOptions.map((u) => (
                            <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnits((s) => ({ ...s, [item.id]: u }))}
                              className={`rounded px-2.5 py-1 text-xs font-bold ${unit === u ? "bg-action text-on-action" : "text-text-muted"}`}>{t(`pkg.by_${u}`)}</button>
                          ))}
                        </div>
                      ) : null}
                      <label className="sr-only" htmlFor={`q-${item.id}`}>{t("pkg.qty")}</label>
                      <input id={`q-${item.id}`} type="number" min={1} inputMode="numeric" dir="ltr" value={qtys[item.id] ?? (unit === "meter" ? 10 : item.min_qty)}
                        onChange={(e) => setQtys((s) => ({ ...s, [item.id]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))}
                        className="w-20 rounded-md border border-border bg-surface p-1.5 text-center text-sm" />
                      <Button size="sm" disabled={out} onClick={() => add(item)}><PlusIcon className="size-4" /> {t("pkg.addToCart")}</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1 lg:sticky lg:top-4 lg:col-span-4">
          <h2 className="text-sm font-extrabold text-text">{t("pkg.cart")}</h2>
          {lines.length === 0 ? <p className="text-sm text-text-muted">{t("pkg.cartEmpty")}</p> : (
            <ul className="flex flex-col divide-y divide-border">
              {lines.map((l) => (
                <li key={l.key} className="flex flex-col gap-1 py-2">
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0 text-text">{en ? l.item.name_en : l.item.name_ar} <span className="text-xs text-text-muted">· {t(`pkg.unit_${l.unit}`)}</span></span>
                    <b className="num shrink-0">{money(l.price * l.qty)}</b>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" aria-label="−" onClick={() => setLine(l.key, l.qty - 1)} className="rounded border border-border p-1"><MinusIcon className="size-3.5" /></button>
                    <span className="num w-10 text-center text-sm">{l.qty}</span>
                    <button type="button" aria-label="+" onClick={() => setLine(l.key, l.qty + 1)} className="rounded border border-border p-1"><PlusIcon className="size-3.5" /></button>
                    <button type="button" aria-label={t("common.remove")} onClick={() => setLine(l.key, 0)} className="ms-auto rounded p-1 text-text-muted hover:text-danger"><TrashIcon className="size-4" /></button>
                  </div>
                  {l.error ? <p className="text-xs font-bold text-danger">{t(`pkg.err_${l.error}`)}</p> : null}
                </li>
              ))}
            </ul>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-bold text-text-muted">{t("pkg.planTitle")}</legend>
            <PlanOption checked={effectivePlan === "full"} onSelect={() => setPlan("full")} title={t("pkg.plan_full")} body={t("pkg.planFullHint")} />
            <PlanOption checked={effectivePlan === "split"} disabled={!loaderData.splitAllowed} onSelect={() => setPlan("split")}
              title={t("pkg.plan_split")} body={loaderData.splitBlockedByBalance ? t("pkg.splitBlocked") : t("pkg.planSplitHint", { p: splitPercent })} />
          </fieldset>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs font-bold text-text-muted">{t("pkg.methodTitle")}</legend>
            <MethodOption checked={effectiveMethod === "card"} onSelect={() => setMethod("card")} icon={<CreditCardIcon className="size-4" />} label={t("pkg.method_card")} />
            <MethodOption checked={effectiveMethod === "cod"} disabled={effectivePlan === "split" || !loaderData.codEnabled} onSelect={() => setMethod("cod")} icon={<CashIcon className="size-4" />} label={t("pkg.method_cod")} />
            {loaderData.deferredEnabled ? (
              <MethodOption checked={effectiveMethod === "deferred"} disabled={effectivePlan === "split" || !loaderData.deferredAllowed} onSelect={() => setMethod("deferred")} icon={<ReceiptIcon className="size-4" />} label={t("pkg.method_deferred")} />
            ) : null}
          </fieldset>
          {effectiveMethod === "deferred" ? (
            <p className="rounded-md bg-info-soft px-3 py-2 text-xs leading-relaxed text-info">{t("pkg.deferredHint", { count: loaderData.deferredMaxOrders })}</p>
          ) : loaderData.deferredEnabled && !loaderData.deferredAllowed ? (
            <p className="text-xs text-text-muted">{t("pkg.deferredBlocked")}</p>
          ) : null}
          {effectiveMethod === "card" && loaderData.cardOnline ? <PayMethodsNote test={loaderData.cardTest} /> : null}
          {effectiveMethod === "card" && !loaderData.cardOnline ? <p className="text-xs text-warning-strong">{t("pkg.cardOffline")}</p> : null}
          <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">{t("pkg.notes")}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} className="rounded-md border border-border bg-surface p-2 text-sm text-text" />
          </label>

          <dl className="grid grid-cols-2 gap-y-1 border-t border-border pt-2 text-sm">
            <dt className="text-text-muted">{t("pkg.subtotal")}</dt><dd className="num text-end">{money(totals.subtotal)}</dd>
            <dt className="text-text-muted">{t("pkg.shipping")}</dt><dd className="num text-end">{money(totals.shipping)}</dd>
            <dt className="font-extrabold">{t("pkg.total")}</dt><dd className="num text-end font-black">{money(totals.total)}</dd>
            <dt className="font-bold text-action">{t("pkg.payNow")}</dt><dd className="num text-end font-black text-action">{money(payLaterAll ? 0 : totals.dueNow)}</dd>
            {totals.later > 0 ? (<><dt className="text-xs text-text-muted">{t("pkg.payLater")}</dt><dd className="num text-end text-xs font-bold">{money(totals.later)}</dd></>) : null}
            {effectiveMethod === "cod" ? (<><dt className="text-xs text-text-muted">{t("pkg.onDelivery")}</dt><dd className="num text-end text-xs font-bold">{money(totals.total)}</dd></>) : null}
            {effectiveMethod === "deferred" ? (<><dt className="text-xs text-text-muted">{t("pkg.fromFirstOrder")}</dt><dd className="num text-end text-xs font-bold">{money(totals.total)}</dd></>) : null}
          </dl>

          <fetcher.Form method="post">
            <input type="hidden" name="attempt_key" value={loaderData.attemptKey} />
            <input type="hidden" name="plan" value={effectivePlan} />
            <input type="hidden" name="method" value={effectiveMethod} />
            <input type="hidden" name="notes" value={notes} />
            <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ item_id: l.item.id, unit: l.unit, qty: l.qty })))} />
            <Button type="submit" block disabled={invalid || !loaderData.storeActive} loading={fetcher.state !== "idle"}>
              {effectiveMethod === "cod" ? t("pkg.placeCod") : effectiveMethod === "deferred" ? t("pkg.placeDeferred") : t("pkg.placeCard", { amount: money(totals.dueNow) })}
            </Button>
          </fetcher.Form>
          {effectivePlan === "split" ? <Badge tone="info">{t("pkg.splitNote")}</Badge> : null}
        </aside>
      </div>
    </div>
  );
}

function PlanOption({ checked, disabled, onSelect, title, body }: { checked: boolean; disabled?: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <label className={`flex items-start gap-2 rounded-md border p-2.5 text-sm ${checked ? "border-action bg-action/5" : "border-border"} ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onSelect} className="mt-0.5 accent-[var(--color-action)]" />
      <span><b className="block text-text">{title}</b><span className="text-xs text-text-muted">{body}</span></span>
    </label>
  );
}
function MethodOption({ checked, disabled, onSelect, icon, label }: { checked: boolean; disabled?: boolean; onSelect: () => void; icon: React.ReactNode; label: string }) {
  return (
    <label className={`flex flex-1 items-center justify-center gap-2 rounded-md border p-2 text-sm font-bold ${checked ? "border-action bg-action/5 text-action" : "border-border text-text"} ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="radio" className="sr-only" checked={checked} disabled={disabled} onChange={onSelect} />{icon}{label}
    </label>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}
