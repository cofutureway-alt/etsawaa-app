import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/orders";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "~/components/ui/icons";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { listOwnOrders } from "~/features/orders/api";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui/Overlay";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import {
  CopyIcon,
  SearchIcon,
  ChevronLeftIcon,
  CheckIcon,
} from "~/components/ui/icons";


/**
 * A-14 — Admin orders list (JOURNEYS §16.6): status filters + search +
 * multi-select → bulk status change with a mandatory reason (validated per
 * order server-side via fn_admin_bulk_order_status, failures reported).
 * Detail actions (COD reconcile, group statuses, printing) live on the
 * order page.
 */

type OrderRow = {
  id: string; number: string; ship_name: string; status: string;
  payment_method: string; payment_status: string; total_piastres: number;
  created_at: string; commission_piastres?: number;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const filterParam = url.searchParams.get("filter") ?? "all";
  const filter = (["all", "active", "completed", "cancelled"] as const).includes(filterParam as "all")
    ? (filterParam as "all" | "active" | "completed" | "cancelled")
    : "all";
  const q = url.searchParams.get("q")?.trim() ?? "";
  let orders = await listOwnOrders(client, filter, 200);
  if (q) orders = orders.filter((o) => o.number.includes(q) || o.ship_name.includes(q));
  return { lang, filter, q, orders: JSON.parse(JSON.stringify(orders)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  if (String(form.get("intent")) !== "bulk_status") {
    return data({ ok: false, reason: "bad_intent" }, { status: 400 });
  }
  const ids = form.getAll("order_id").map(String).filter(Boolean);
  const status = String(form.get("status") ?? "");
  const reason = String(form.get("reason") ?? "");
  const res = await client.rpc("fn_admin_bulk_order_status", {
    p_order_ids: ids, p_status: status, p_reason: reason,
  });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean; reason?: string; changed?: number };
  return r.ok ? { ok: true as const, changed: r.changed } : data({ ok: false, reason: r.reason }, { status: 400 });
}

export default function AdminOrdersPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("processing");
  const [reason, setReason] = useState("");
  const lang = loaderData.lang;

  const orders = loaderData.orders as OrderRow[];

  // Dynamic metrics computed from live database rows
  const totalCount = orders.length;
  const activeCount = orders.filter((o) =>
    ["processing", "pending_payment", "on_hold"].includes(o.status),
  ).length;
  const completedCount = orders.filter((o) => o.status === "completed").length;
  const cancelledCount = orders.filter((o) => o.status === "cancelled").length;
  const totalRevenue = orders.reduce(
    (sum, o) => sum + (o.status !== "cancelled" ? o.total_piastres : 0),
    0,
  );

  const filters: Array<{ key: string; label: string; count: number }> = [
    { key: "all", label: t("orders.filterAll"), count: totalCount },
    { key: "active", label: t("orders.filterActive"), count: activeCount },
    { key: "completed", label: t("orders.filterCompleted"), count: completedCount },
    { key: "cancelled", label: t("orders.filterCancelled"), count: cancelledCount },
  ];

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checked.size === orders.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(orders.map((o) => o.id)));
    }
  }

  const busy = fetcher.state !== "idle";

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("adminNav.orders")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {totalCount} {en ? "Orders" : "طلب"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Monitor customer fulfillment, payment status, and order reconciliation in real-time."
              : "متابعة وتحديث طلبات المتاجر، تأكيد المدفوعات، وإصدار بوالص الشحن والفواتير."}
          </p>
        </div>

        {/* Search Bar */}
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="filter" value={loaderData.filter} />
          <div className="relative">
            <input
              name="q"
              defaultValue={loaderData.q}
              placeholder={t("orders.search")}
              className="w-56 sm:w-64 rounded-m border border-border bg-surface px-3 py-2 text-[13px] text-text shadow-1 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {loaderData.q ? (
              <Link
                to={`/${lang}/admin/orders?filter=${loaderData.filter}`}
                className="absolute inset-y-0 end-2 my-auto flex size-5 items-center justify-center rounded-full text-xs text-text-faint hover:bg-surface-tint hover:text-text"
                title={t("common.clear", "مسح")}
              >
                <CloseIcon aria-hidden="true" className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <Button type="submit" size="sm" variant="outline">
            <SearchIcon aria-hidden="true" className="size-3.5" />
            <span>{t("common.search")}</span>
          </Button>
        </form>
      </div>

      {/* KPI Stat Cards (Real Live Data) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-l border border-border bg-surface p-3.5 shadow-1 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-bold text-text-muted">{t("orders.filterAll")}</p>
          <p className="mt-1 text-xl font-black text-text tabular-nums">{totalCount}</p>
          <p className="mt-0.5 text-[11px] text-text-faint">{en ? "Current query" : "إجمالي المعروض"}</p>
        </div>
        <div className="rounded-l border border-warning/30 bg-surface p-3.5 shadow-1 transition-transform hover:-translate-y-0.5 border-t-2 border-t-warning">
          <p className="text-xs font-bold text-warning-strong">{t("orders.filterActive")}</p>
          <p className="mt-1 text-xl font-black text-text tabular-nums">{activeCount}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">{en ? "Requires action" : "تحتاج تجهيز ومتابعة"}</p>
        </div>
        <div className="rounded-l border border-success/30 bg-surface p-3.5 shadow-1 transition-transform hover:-translate-y-0.5 border-t-2 border-t-success">
          <p className="text-xs font-bold text-success-strong">{t("orders.filterCompleted")}</p>
          <p className="mt-1 text-xl font-black text-text tabular-nums">{completedCount}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">{en ? "Successfully delivered" : "تم التسليم بنجاح"}</p>
        </div>
        <div className="rounded-l border border-danger/30 bg-surface p-3.5 shadow-1 transition-transform hover:-translate-y-0.5 border-t-2 border-t-danger">
          <p className="text-xs font-bold text-danger">{t("orders.filterCancelled")}</p>
          <p className="mt-1 text-xl font-black text-text tabular-nums">{cancelledCount}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">{en ? "Returned / voided" : "ملغاة أو مسترجعة"}</p>
        </div>
        <div className="col-span-2 sm:col-span-4 lg:col-span-1 rounded-l border border-border bg-surface p-3.5 shadow-1 transition-transform hover:-translate-y-0.5 border-t-2 border-t-action">
          <p className="text-xs font-bold text-text-muted">{t("cart.total")}</p>
          <p className="mt-1 text-lg font-black text-action tabular-nums">{money(totalRevenue)}</p>
          <p className="mt-0.5 text-[11px] text-text-faint">{en ? "Gross value" : "إجمالي قيمة الطلبات"}</p>
        </div>
      </div>

      {/* Filter Tabs & Content Container */}
      <div className="rounded-l border border-border bg-surface shadow-1 overflow-hidden">
        {/* Status Tabs with Live Badges */}
        <div className="flex border-b border-border bg-surface-alt px-3 pt-2 gap-1 overflow-x-auto scrollbar-none">
          {filters.map((f) => {
            const active = loaderData.filter === f.key;
            return (
              <Link
                key={f.key}
                to={`/${lang}/admin/orders?filter=${f.key}${loaderData.q ? `&q=${encodeURIComponent(loaderData.q)}` : ""}`}
                className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-bold transition-all whitespace-nowrap ${
                  active
                    ? "border-action text-action bg-surface"
                    : "border-transparent text-text-muted hover:text-text hover:bg-surface/50"
                }`}
              >
                <span>{f.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
                    active ? "bg-primary-soft text-action" : "bg-surface text-text-muted border border-border"
                  }`}
                >
                  {f.count}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Table Content */}
        {orders.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title={t("orders.empty")}
              body={
                loaderData.q
                  ? (en ? "No orders matched your search criteria." : "لم يتم العثور على طلبات مطابقة لكلمات البحث.")
                  : (en ? "No orders found in this category." : "لا توجد طلبات في هذا التصنيف حالياً.")
              }
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-start text-[13px]">
              <thead className="border-b border-border bg-surface-alt text-start text-xs font-black text-text-muted uppercase tracking-wider">
                <tr>
                  <th className="w-10 px-3.5 py-3 text-start">
                    <input
                      type="checkbox"
                      aria-label={t("orders.selectAll", "تحديد الكل")}
                      checked={checked.size > 0 && checked.size === orders.length}
                      onChange={toggleAll}
                      className="size-4 rounded accent-[var(--color-action)] cursor-pointer"
                    />
                  </th>
                  <th className="px-3.5 py-3 text-start">{t("order.number")}</th>
                  <th className="px-3.5 py-3 text-start">{t("order.customer")}</th>
                  <th className="px-3.5 py-3 text-start">{t("order.status")}</th>
                  <th className="px-3.5 py-3 text-start">{t("order.payment")}</th>
                  <th className="px-3.5 py-3 text-start">{t("cart.total")}</th>
                  <th className="px-3.5 py-3 text-start">{t("order.date")}</th>
                  <th className="px-3.5 py-3 text-center">{t("common.actions", "الإجراء")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => {
                  const isChecked = checked.has(o.id);
                  const tone =
                    o.status === "completed"
                      ? "success"
                      : o.status === "processing"
                      ? "warning"
                      : o.status === "cancelled"
                      ? "danger"
                      : o.status === "pending_payment"
                      ? "info"
                      : "neutral";

                  return (
                    <tr
                      key={o.id}
                      className={`transition-colors duration-150 hover:bg-surface-tint/50 ${
                        isChecked ? "bg-surface-tint" : ""
                      }`}
                    >
                      <td className="px-3.5 py-3">
                        <input
                          type="checkbox"
                          aria-label={o.number}
                          checked={isChecked}
                          onChange={() => toggle(o.id)}
                          className="size-4 rounded accent-[var(--color-action)] cursor-pointer"
                        />
                      </td>

                      <td className="px-3.5 py-3 font-extrabold">
                        <div className="flex items-center gap-1.5" dir="ltr">
                          <Link
                            to={`/${lang}/admin/orders/${encodeURIComponent(o.number)}`}
                            className="text-action hover:underline"
                          >
                            {o.number}
                          </Link>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(o.number)}
                            className="text-text-faint hover:text-text p-1 transition-colors rounded"
                            title={t("common.copy", "نسخ")}
                          >
                            <CopyIcon className="size-3" />
                          </button>
                        </div>
                      </td>

                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-alt font-black text-xs text-text-muted border border-border">
                            {o.ship_name ? o.ship_name.charAt(0) : "ع"}
                          </div>
                          <span className="truncate max-w-[170px] font-bold text-text">
                            {o.ship_name || "—"}
                          </span>
                        </div>
                      </td>

                      <td className="px-3.5 py-3">
                        <Badge tone={tone} dot>
                          {t(`order.status_${o.status}`)}
                        </Badge>
                      </td>

                      <td className="px-3.5 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-[12.5px] text-text">
                            {o.payment_method === "cod"
                              ? t("checkout.pay_cod")
                              : t("checkout.pay_kashier")}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${
                              o.payment_status === "paid"
                                ? "text-success-strong"
                                : "text-text-faint"
                            }`}
                          >
                            {t(`order.pay_${o.payment_status}`)}
                          </span>
                        </div>
                      </td>

                      <td className="px-3.5 py-3">
                        <span className="font-black text-text tabular-nums">
                          {money(o.total_piastres)}
                        </span>
                      </td>

                      <td className="px-3.5 py-3 text-text-muted text-xs" dir="ltr">
                        {new Date(o.created_at).toLocaleDateString(
                          en ? "en-EG" : "ar-EG",
                          { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
                        )}
                      </td>

                      <td className="px-3.5 py-3 text-center">
                        <Link
                          to={`/${lang}/admin/orders/${encodeURIComponent(o.number)}`}
                          className="inline-flex items-center gap-1 rounded-s border border-border bg-surface px-2.5 py-1 text-xs font-bold text-text transition-colors hover:border-action hover:text-action"
                        >
                          <span>{t("common.details", "تفاصيل")}</span>
                          <ChevronLeftIcon className="size-3 rtl:rotate-180" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar (when rows selected) */}
      {checked.size > 0 ? (
        <div className="fixed bottom-6 inset-x-0 mx-auto z-50 flex w-fit max-w-[90vw] items-center gap-3 rounded-full border border-border bg-side px-5 py-2.5 text-white shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <span className="flex items-center gap-2 text-xs font-extrabold">
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-black text-white">
              {checked.size}
            </span>
            <span>{t("orders.selected", { count: checked.size })}</span>
          </span>
          <div className="h-4 w-px bg-white/20" />
          <Button
            size="sm"
            variant="outline"
            className="!border-white/30 !text-white hover:!bg-white/10"
            onClick={() => setBulkOpen(true)}
          >
            {t("orders.bulkStatus")}
          </Button>
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="cursor-pointer text-xs font-bold text-white/70 hover:text-white transition-colors"
          >
            {t("orders.clearSelection")}
          </button>
        </div>
      ) : null}

      {/* Bulk Status Dialog — reason mandatory, validated per order server-side */}
      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t("orders.bulkTitle")}
      >
        <fetcher.Form
          method="post"
          onSubmit={(e) => {
            if (reason.trim().length < 3) e.preventDefault();
          }}
          className="flex flex-col gap-3"
        >
          {Array.from(checked).map((id) => (
            <input key={id} type="hidden" name="order_id" value={id} />
          ))}
          <input type="hidden" name="intent" value="bulk_status" />

          <div className="rounded-m border border-border bg-surface-tint p-3 text-xs text-text-muted">
            <p>
              {en
                ? `You are updating the status for ${checked.size} selected order(s).`
                : `سيتم تطبيق الحالة الجديدة على ${checked.size} طلب دفعة واحدة وتسجيلها في سجل التدقيق.`}
            </p>
          </div>

          <div>
            <label
              htmlFor="bulk-status"
              className="text-[13px] font-bold text-text block mb-1"
            >
              {t("orders.newStatus")}
            </label>
            <select
              id="bulk-status"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="w-full rounded-m border border-border bg-surface p-2.5 text-[13px] text-text"
            >
              <option value="processing">{t("order.status_processing")}</option>
              <option value="completed">{t("order.status_completed")}</option>
              <option value="cancelled">{t("order.status_cancelled")}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="bulk-reason"
              className="text-[13px] font-bold text-text block mb-1"
            >
              {t("wd.reason")}
            </label>
            <textarea
              id="bulk-reason"
              rows={3}
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={en ? "Enter the operational reason..." : "اكتب سبب تغيير الحالة الإداري..."}
              className="w-full rounded-m border border-border bg-surface p-2.5 text-[13px] text-text"
            />
            <p className="mt-1 text-xs text-text-muted">{t("orders.bulkNote")}</p>
          </div>

          <div className="mt-2 flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBulkOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={busy || reason.trim().length < 3}
            >
              {t("orders.bulkApply")}
            </Button>
          </div>
        </fetcher.Form>
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
