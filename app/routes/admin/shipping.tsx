import { data, useFetcher } from "react-router";
import type { Route } from "./+types/shipping";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
// Surfaces the action result: these pages used to discard {ok:false} and
// render nothing, so a failed write looked like a dead button.
import { useActionToast } from "~/components/layout/ActionFeedback";


/**
 * Admin shipping decisions (VO-05 / US-12): pending vendor-shipping groups
 * (definer queue) with approve (posting the shipping share) / reject
 * (reason required, posts NOTHING). Withdrawals moved to /admin/withdrawals
 * in H-14 so this page has ONE responsibility.
 */

interface ShipRow {
  group_id: string; order_id: string;
  number: string; ship_name: string; total_piastres: number; shipping_fee_piastres: number;
  vendor_store_ar: string; vendor_store_en: string; vendor_owner: string;
  items_subtotal_piastres: number; created_at: string;
}
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  // pending vendor-shipping groups (admin sees all; RLS + is_admin gate)
  const { data: shipRows, error } = await client
    .from("order_vendor_groups")
    .select(`id, order_id, items_subtotal_piastres, created_at,
             orders!inner(id, number, ship_name, total_piastres, shipping_fee_piastres, status),
             vendors!inner(id, store_name_ar, store_name_en, owner_id),
             order_items(id, qty)`)
    .eq("vendor_ship_status", "pending_admin")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  const ship = ((shipRows ?? []) as unknown as ShipRowRaw[]).map((g) => ({
    group_id: g.id,
    order_id: g.order_id,
    number: g.orders.number,
    ship_name: g.orders.ship_name,
    total_piastres: g.orders.total_piastres,
    shipping_fee_piastres: g.orders.shipping_fee_piastres,
    vendor_store_ar: g.vendors.store_name_ar,
    vendor_store_en: g.vendors.store_name_en,
    vendor_owner: g.vendors.owner_id,
    items_subtotal_piastres: g.items_subtotal_piastres,
    created_at: g.created_at,
  }));

  return { lang, ship: JSON.parse(JSON.stringify(ship)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "ship_decision") {
    const groupId = String(form.get("group_id") ?? "");
    const decision = String(form.get("decision") ?? "");
    const note = String(form.get("note") ?? "");
    const share = Math.max(0, Math.trunc(Number(form.get("shipping_piastres") ?? 0)) || 0);
    const { data: res, error } = await client.rpc("fn_approve_vendor_shipping", {
      p_group_id: groupId, p_decision: decision, p_shipping_piastres: share, p_note: note || null,
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }


  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

type ShipRowRaw = {
  id: string; order_id: string; items_subtotal_piastres: number; created_at: string;
  orders: { number: string; ship_name: string; total_piastres: number; shipping_fee_piastres: number };
  vendors: { store_name_ar: string; store_name_en: string; owner_id: string };
  order_items: Array<{ qty: number }>;
};

export default function AdminShippingPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const [rejectTarget, setRejectTarget] = useState<ShipRow | null>(null);
  const busy = fetcher.state !== "idle";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("vendorShip.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {loaderData.ship.length} {en ? "Pending" : "معلق"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Review vendor self-shipping requests, approve shipping fee shares, or reject non-eligible packages."
              : "متابعة طلبات الشحن الذاتي من التجار، اعتماد نسب مصاريف التوصيل، وفحص الطلبات المؤهلة."}
          </p>
        </div>
      </div>

      {/* shipping queue */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-extrabold text-text">{t("vendorShip.queue")}</h2>
        {loaderData.ship.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6 shadow-1">
            <EmptyState title={t("vendorShip.empty")} body={t("vendorShip.approveDone")} />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {loaderData.ship.map((g: ShipRow) => (
              <li key={g.group_id} className="rounded-lg border border-border bg-surface p-4 sm:p-5 shadow-1 transition-all duration-150 hover:shadow-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-border pb-3">
                  <span className="font-extrabold text-action text-base" dir="ltr">{g.number}</span>
                  <span className="font-bold text-text">{en ? g.vendor_store_en : g.vendor_store_ar}</span>
                  <span className="text-text-muted">{g.ship_name}</span>
                  <span className="tabular-nums font-bold text-text">{t("order.vendorNet")}: {money(g.items_subtotal_piastres)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <fetcher.Form method="post" preventScrollReset className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="ship_decision" />
                    <input type="hidden" name="group_id" value={g.group_id} />
                    <input type="hidden" name="decision" value="approve" />
                    <label htmlFor={`share-${g.group_id}`} className="text-xs font-bold text-text">{t("vendorShip.shippingShare")}</label>
                    <input id={`share-${g.group_id}`} name="shipping_piastres" type="number" min={0} step={1}
                      defaultValue={g.shipping_fee_piastres}
                      className="w-28 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text font-bold" dir="ltr" />
                    <Button type="submit" size="sm" disabled={busy}>{t("vendorShip.approve")}</Button>
                  </fetcher.Form>
                  <button
                    type="button" onClick={() => setRejectTarget(g)}
                    className="cursor-pointer rounded-md border border-danger/50 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft transition-colors"
                  >
                    {t("vendorShip.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* H-14: withdrawal review moved to its OWN page (US-02: tabs + stats + CSV).
          Link out, never duplicate CRUD surfaces. */}
      <section className="mt-2" aria-label={t("wallet.withdrawals")}>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-4 shadow-1">
          <div>
            <p className="text-sm font-bold text-text">{t("wd.movedToOwnPage")}</p>
            <p className="text-xs text-text-muted">{en ? "Manage merchant wallet requests and settlements" : "إدارة تسويات ومحافظ التجار وسحب الأرباح"}</p>
          </div>
          <a href={`/${loaderData.lang}/admin/withdrawals`} className="rounded-md bg-action px-3.5 py-2 text-xs font-black text-on-action hover:bg-action-hover transition-colors shadow-1">
            {t("wd.openPage")}
          </a>
        </div>
      </section>

      {/* reject dialog — reason required (US-12) */}
      <Dialog open={rejectTarget !== null} onClose={() => setRejectTarget(null)} title={t("vendorShip.reject")}>
        {rejectTarget ? (
          <fetcher.Form method="post" preventScrollReset className="flex flex-col gap-3 p-1" onSubmit={() => setTimeout(() => setRejectTarget(null), 50)}>
            <input type="hidden" name="intent" value="ship_decision" />
            <input type="hidden" name="group_id" value={rejectTarget.group_id} />
            <input type="hidden" name="decision" value="reject" />
            <p className="text-sm text-text" dir="ltr">{rejectTarget.number}</p>
            <Input id="rj-note" name="note" required label={t("vendorShip.rejectReason")} />
            <Button type="submit" loading={busy} block>{t("vendorShip.reject")}</Button>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
