import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/order-detail";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { getOwnOrder, getOrderParts, getGeoNames, type GroupRow, type ItemRow } from "~/features/orders/api";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { Badge, type BadgeTone } from "~/components/ui/Badge";
import { CopyIcon, CheckIcon, TruckIcon, PackageIcon, CashIcon, CreditCardIcon, ReceiptIcon, FileIcon, UserIcon, PinIcon, ChevronLeftIcon, ChevronRightIcon, MailIcon, StoreIcon } from "~/components/ui/icons";


/**
 * Admin order detail: full split per vendor, status updates per group,
 * COD reconciliation (US-13) and the print center (copies + pieces dialog,
 * AGENT §28): invoice A4 + carrier label A5 + every vendor label.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const order = await getOwnOrder(client, params.number ?? "");
  if (!order) throw new Response("Not found", { status: 404 });
  const [parts, geo] = await Promise.all([
    getOrderParts(client, order.id),
    getGeoNames(client, order.governorate_id, order.area_id),
  ]);
  const { data: docs } = await client
    .from("order_documents")
    .select("id, doc_type, vendor_id, copies, created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(20);
  // A-15 — notes: private (admin/staff) + public (customer-visible)
  const { data: notes } = await client
    .from("order_notes")
    .select("id, body, is_internal, created_at, profiles(full_name)")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true })
    .limit(50);
  const noteRows = ((notes ?? []) as unknown as Array<Record<string, unknown>>).map((n) => ({
    id: n.id as string,
    body: n.body as string,
    is_internal: n.is_internal as boolean,
    created_at: n.created_at as string,
    author: (n.profiles as { full_name: string } | null)?.full_name ?? "",
  }));
  return {
    lang,
    order: JSON.parse(JSON.stringify(order)),
    groups: JSON.parse(JSON.stringify(parts.groups)),
    items: JSON.parse(JSON.stringify(parts.items)),
    history: parts.history,
    geo: JSON.parse(JSON.stringify(geo)),
    documents: docs ?? [],
    notes: noteRows,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const order = await getOwnOrder(client, params.number ?? "");
  if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });

  if (intent === "cod_collect") {
    const { data: res, error } = await client.rpc("fn_set_cod_collected", { p_order_id: order.id });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "group_status") {
    const groupId = String(form.get("group_id") ?? "");
    const status = String(form.get("status") ?? "");
    const note = String(form.get("note") ?? "");
    const { data: res, error } = await client.rpc("fn_update_group_status", {
      p_group_id: groupId, p_status: status, p_note: note,
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  // A-15 — private/public note (audited manual entry)
  if (intent === "add_note") {
    const body = String(form.get("body") ?? "").trim();
    if (body.length < 1 || body.length > 2000) {
      return data({ ok: false, reason: "bad_body" }, { status: 400 });
    }
    const isInternal = String(form.get("visibility") ?? "private") !== "public";
    const { error } = await client.from("order_notes").insert({
      order_id: order.id, body, is_internal: isInternal, author: viewer.user.id,
    });
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: "order.note.added", p_entity: "orders", p_entity_id: order.id,
      p_before: null, p_after: { internal: isInternal },
    });
    return { ok: true as const };
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

const GROUP_TARGETS = ["preparing", "handed_to_carrier", "out_for_delivery", "delivered", "cancelled"] as const;

function getOrderStatusTone(status: string): BadgeTone {
  switch (status) {
    case "completed":
    case "delivered":
      return "success";
    case "processing":
    case "preparing":
    case "handed_to_carrier":
    case "out_for_delivery":
      return "info";
    case "pending":
    case "cod_pending":
      return "warning";
    case "cancelled":
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export default function AdminOrderDetail({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const statusFetcher = useFetcher<typeof action>();
  const codFetcher = useFetcher<typeof action>();
  const noteFetcher = useFetcher<typeof action>();
  const { order, groups, items, history, documents } = loaderData;

  const [copied, setCopied] = useState(false);
  const [copies, setCopies] = useState(1);
  const [pieces, setPieces] = useState<number | "auto">("auto");

  const handleCopyOrderNumber = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(order.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const itemsByGroup = new Map<string, ItemRow[]>();
  for (const it of items as ItemRow[]) {
    const arr = itemsByGroup.get(it.group_id) ?? [];
    arr.push(it);
    itemsByGroup.set(it.group_id, arr);
  }
  const piecesAuto = (items as ItemRow[]).reduce((s, i) => s + i.qty, 0);
  const piecesFinal = pieces === "auto" ? piecesAuto : pieces;
  const printQs = `copies=${copies}&pieces=${piecesFinal}&lang=${en ? "en" : "ar"}`;
  const print = (doc: string, vendor?: string) =>
    `/${loaderData.lang}/order/${encodeURIComponent(order.number)}/print/${doc}?${printQs}${vendor ? `&vendor=${vendor}` : ""}`;

  const orderDateStr = order.created_at
    ? new Date(order.created_at).toLocaleString(en ? "en-EG" : "ar-EG", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-text-muted">
            <Link
              to={`/${loaderData.lang}/admin/orders`}
              className="inline-flex items-center gap-1 font-semibold text-action hover:underline"
            >
              {en ? <ChevronLeftIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
              {t("adminNav.orders")}
            </Link>
            <span className="text-border">/</span>
            <span className="font-mono font-medium text-text">#{order.number}</span>
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-text">
              {t("order.title")}{" "}
              <span dir="ltr" className="font-mono text-action">
                {order.number}
              </span>
            </h1>

            <button
              type="button"
              onClick={handleCopyOrderNumber}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-tint/50 px-2 py-1 text-xs font-semibold text-text-muted hover:border-action hover:text-action transition-colors cursor-pointer"
              title="Copy Order Number"
            >
              {copied ? (
                <>
                  <CheckIcon className="size-3.5 text-success" />
                  <span className="text-success font-bold text-2xs">Copied</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-3.5" />
                  <span className="text-2xs">Copy</span>
                </>
              )}
            </button>

            <Badge tone={getOrderStatusTone(order.status)} dot>
              {t(`order.status_${order.status}`)}
            </Badge>
          </div>

          {orderDateStr ? (
            <p className="text-xs text-text-muted">
              {orderDateStr}
            </p>
          ) : null}
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t border-border/40 md:border-t-0">
          <a
            href={print("invoice_admin")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold text-text hover:bg-surface-tint transition-colors shadow-sm"
          >
            <ReceiptIcon className="size-4 text-action" />
            {t("order.printInvoiceA4")}
          </a>
          <a
            href={print("label_carrier")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-action px-3 py-2 text-xs font-bold text-on-action hover:bg-action-hover transition-colors shadow-sm"
          >
            <TruckIcon className="size-4" />
            {t("order.printCarrierA5")}
          </a>
        </div>
      </div>

      {/* Main Grid: Left Details & Right Summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column (8 cols): Packages, Timeline & Notes */}
        <div className="space-y-6 lg:col-span-8">
          {/* Vendor Packages / Groups */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-text flex items-center gap-2">
                <PackageIcon className="size-5 text-action" />
                <span>حزم المنتجات والمتاجر</span>
                <span className="rounded-full bg-surface-tint px-2 py-0.5 text-xs font-bold text-text-muted">
                  {groups.length}
                </span>
              </h2>
            </div>

            {groups.map((g: GroupRow) => {
              const groupItems = itemsByGroup.get(g.id) ?? [];
              const storeName = en ? g.vendor.store_name_en : g.vendor.store_name_ar;

              return (
                <section
                  key={g.id}
                  className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-sm transition-all"
                >
                  {/* Group Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-surface-tint/30 px-4 sm:px-6 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-surface border border-border/80 text-action font-black text-xs shadow-sm">
                        {storeName ? storeName.charAt(0).toUpperCase() : <StoreIcon className="size-4" />}
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-text">{storeName}</h3>
                        <p className="text-2xs text-text-muted">
                          {groupItems.reduce((acc, it) => acc + it.qty, 0)} قطع
                        </p>
                      </div>
                    </div>

                    <Badge tone={getOrderStatusTone(g.status)} dot>
                      {t(`order.status_${g.status}`)}
                    </Badge>
                  </div>

                  {/* Group Line Items */}
                  <div className="divide-y divide-border/50 px-4 sm:px-6">
                    {groupItems.map((it) => (
                      <div
                        key={it.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-tint/40 text-text-muted font-bold text-xs">
                            <PackageIcon className="size-5 text-text-faint" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-text leading-snug">
                              {en ? it.product_name_en : it.product_name_ar}
                            </p>
                            <p className="text-xs text-text-muted font-mono mt-0.5">
                              × {it.qty}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-4 text-xs sm:text-right border-t border-border/30 pt-2 sm:border-0 sm:pt-0">
                          <div>
                            <span className="block font-bold text-text font-mono text-sm">
                              {money(it.line_total_piastres)}
                            </span>
                            <span className="block text-2xs text-text-muted font-mono">
                              {t("order.commissionShort")}: {money(it.commission_piastres)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Group Financial Subtotal */}
                  <div className="border-t border-border/60 bg-surface-tint/10 px-4 sm:px-6 py-3">
                    <dl className="flex flex-wrap items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-2">
                        <dt className="text-text-muted">{t("order.itemsSubtotal")}:</dt>
                        <dd className="font-bold font-mono text-text">{money(g.items_subtotal_piastres)}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="text-text-muted">{t("order.commission")}:</dt>
                        <dd className="font-bold font-mono text-action">{money(g.commission_piastres)}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Group Status Action (if active) */}
                  {g.status !== "delivered" && g.status !== "cancelled" ? (
                    <div className="border-t border-border/60 bg-surface px-4 sm:px-6 py-3.5">
                      <statusFetcher.Form method="post" preventScrollReset className="flex flex-wrap items-center gap-2.5">
                        <input type="hidden" name="intent" value="group_status" />
                        <input type="hidden" name="group_id" value={g.id} />

                        <div className="flex-1 min-w-[140px]">
                          <select
                            name="status"
                            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text shadow-sm focus:border-action focus:outline-none focus:ring-1 focus:ring-action"
                            defaultValue={g.status === "pending" ? "preparing" : "handed_to_carrier"}
                          >
                            {GROUP_TARGETS.map((s) => (
                              <option key={s} value={s}>
                                {t(`order.status_${s}`)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex-[2] min-w-[180px]">
                          <input
                            name="note"
                            placeholder={t("order.notePlaceholder")}
                            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm placeholder:text-text-faint focus:border-action focus:outline-none focus:ring-1 focus:ring-action"
                          />
                        </div>

                        <button
                          type="submit"
                          className="cursor-pointer rounded-lg border border-action bg-surface px-3.5 py-2 text-xs font-bold text-action hover:bg-action hover:text-on-action transition-colors shadow-sm shrink-0"
                        >
                          {t("order.updateStatus")}
                        </button>
                      </statusFetcher.Form>

                      {statusFetcher.data && !statusFetcher.data.ok ? (
                        <p role="alert" className="mt-2 text-xs font-semibold text-danger">
                          {t("order.updateFailed")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          {/* Activity & History Timeline */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm">
            <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
              <ReceiptIcon className="size-4 text-action" />
              {t("order.historyTitle")}
            </h2>

            <div className="mt-4 flow-root">
              <ol className="relative border-s border-border/80 ms-3 space-y-4">
                {history.map((h: { id: string; status: string; note: string; created_at: string }, idx: number) => (
                  <li key={h.id || idx} className="ms-5">
                    <span className="absolute -start-2 flex size-4 items-center justify-center rounded-full bg-surface border-2 border-action ring-2 ring-surface" />
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-xs font-bold text-text">
                        {t(`order.status_${h.status}`)}
                      </span>
                      <time className="text-2xs font-mono text-text-muted" dir="ltr">
                        {new Date(h.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}
                      </time>
                    </div>
                    {h.note && h.note !== "order_created" ? (
                      <p className="mt-1 text-xs text-text-muted bg-surface-tint/40 p-2 rounded-lg border border-border/40">
                        {h.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Internal / Public Order Notes (A-15) */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
                <FileIcon className="size-4 text-action" />
                {t("note.title")}
              </h2>
              <span className="text-xs font-mono text-text-muted">
                {loaderData.notes.length}
              </span>
            </div>

            <div className="mt-4">
              <noteFetcher.Form method="post" preventScrollReset className="space-y-3">
                <input type="hidden" name="intent" value="add_note" />
                <textarea
                  name="body"
                  rows={2}
                  required
                  maxLength={2000}
                  placeholder={t("note.placeholder")}
                  className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-text placeholder:text-text-faint focus:border-action focus:outline-none focus:ring-1 focus:ring-action shadow-sm"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-text font-medium cursor-pointer">
                    <input type="hidden" name="visibility" value="private" />
                    <input
                      type="checkbox"
                      name="visibility"
                      value="public"
                      className="size-4 rounded border-border accent-action cursor-pointer"
                    />
                    {t("note.makePublic")}
                  </label>

                  <button
                    type="submit"
                    className="cursor-pointer rounded-lg bg-action px-4 py-2 text-xs font-bold text-on-action hover:bg-action-hover transition-colors shadow-sm"
                  >
                    {t("note.save")}
                  </button>
                </div>
                {noteFetcher.data && !noteFetcher.data.ok ? (
                  <p role="alert" className="text-xs font-semibold text-danger">
                    {t("order.updateFailed")}
                  </p>
                ) : null}
              </noteFetcher.Form>
            </div>

            {loaderData.notes.length > 0 ? (
              <div className="mt-4 space-y-2.5 divide-y divide-border/40 pt-2">
                {(loaderData.notes as Array<{ id: string; body: string; is_internal: boolean; created_at: string; author: string }>).map((n) => (
                  <div key={n.id} className="pt-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={n.is_internal ? "danger" : "success"} dot>
                        {n.is_internal ? t("note.private") : t("note.public")}
                      </Badge>
                      <time className="text-2xs font-mono text-text-muted" dir="ltr">
                        {new Date(n.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}
                      </time>
                    </div>
                    <p className="text-xs text-text font-normal leading-relaxed">{n.body}</p>
                    <p className="text-2xs text-text-faint">
                      بواسطة: {n.author || "—"}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        {/* Right Column (4 cols): Order Financial Summary, Delivery Info, Print Center */}
        <aside className="space-y-6 lg:col-span-4">
          {/* Financial Summary */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-extrabold text-text flex items-center gap-2 border-b border-border/60 pb-3">
              <ReceiptIcon className="size-4 text-action" />
              {t("order.summary")}
            </h2>

            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("cart.subtotal")}</dt>
                <dd className="font-bold font-mono text-text">{money(order.subtotal_piastres)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("cart.discount")}</dt>
                <dd className="font-bold font-mono text-success">−{money(order.discount_piastres)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("cart.shipping")}</dt>
                <dd className="font-bold font-mono text-text">{money(order.shipping_fee_piastres)}</dd>
              </div>
              <div className="flex justify-between border-t border-border/80 pt-3 text-sm">
                <dt className="font-black text-text">{t("cart.total")}</dt>
                <dd className="font-black font-mono text-action text-base">{money(order.total_piastres)}</dd>
              </div>
            </dl>

            <div className="rounded-lg border border-border/60 bg-surface-tint/30 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted flex items-center gap-1.5">
                  {order.payment_method === "cod" ? (
                    <CashIcon className="size-4 text-action" />
                  ) : (
                    <CreditCardIcon className="size-4 text-action" />
                  )}
                  {t("order.paymentMethod")}:
                </span>
                <span className="font-bold text-text">
                  {order.payment_method === "cod" ? t("checkout.pay_cod") : t("checkout.pay_kashier")}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">الحالة:</span>
                <Badge
                  tone={
                    order.payment_status === "paid"
                      ? "success"
                      : order.payment_status === "cod_pending"
                      ? "warning"
                      : "neutral"
                  }
                  dot
                >
                  {t(`order.pay_${order.payment_status}`)}
                </Badge>
              </div>
            </div>

            {order.payment_method === "cod" && order.payment_status === "cod_pending" ? (
              <codFetcher.Form method="post" preventScrollReset>
                <input type="hidden" name="intent" value="cod_collect" />
                <button
                  type="submit"
                  className="w-full cursor-pointer rounded-lg bg-action px-4 py-2.5 text-xs font-extrabold text-on-action hover:bg-action-hover transition-colors shadow-sm"
                >
                  {t("order.codCollect")}
                </button>
              </codFetcher.Form>
            ) : null}

            {codFetcher.data && !codFetcher.data.ok ? (
              <p role="alert" className="text-xs font-semibold text-danger">
                {codFetcher.data.reason === "already_collected"
                  ? t("order.codAlreadyCollected")
                  : t("order.updateFailed")}
              </p>
            ) : null}
          </section>

          {/* Delivery & Customer Info */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm space-y-3.5 text-xs">
            <h2 className="text-sm font-extrabold text-text flex items-center gap-2 border-b border-border/60 pb-3">
              <UserIcon className="size-4 text-action" />
              {t("order.deliveryDetails")}
            </h2>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <UserIcon className="size-4 text-text-muted shrink-0" />
                <span className="font-bold text-text">{order.ship_name}</span>
              </div>

              <div className="flex items-center gap-2 font-mono text-text" dir="ltr">
                <span className="text-text-muted text-2xs">TEL:</span>
                <span>{order.phone_primary}</span>
                {order.phone_alternate ? (
                  <span className="text-text-muted">/ {order.phone_alternate}</span>
                ) : null}
              </div>

              <div className="flex items-start gap-2 text-text-muted">
                <PinIcon className="size-4 text-action shrink-0 mt-0.5" />
                <div>
                  <p className="text-text font-medium">
                    {order.address1}
                    {order.address2 ? `، ${order.address2}` : ""}
                  </p>
                  <p className="text-text-muted text-2xs mt-0.5">
                    {en ? loaderData.geo.governorate?.name_en : loaderData.geo.governorate?.name_ar} ·{" "}
                    {en ? loaderData.geo.area?.name_en : loaderData.geo.area?.name_ar}
                  </p>
                </div>
              </div>

              {order.email ? (
                <div className="flex items-center gap-2 text-text-faint" dir="ltr">
                  <MailIcon className="size-3.5 shrink-0" />
                  <span className="font-mono">{order.email}</span>
                </div>
              ) : null}
            </div>
          </section>

          {/* Print Center */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-extrabold text-text flex items-center gap-2 border-b border-border/60 pb-3">
              <FileIcon className="size-4 text-action" />
              {t("order.printCenter")}
            </h2>

            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span className="text-text-muted font-medium">{t("order.copies")}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="w-20 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-center font-mono text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <label className="flex items-center justify-between gap-2">
                <span className="text-text-muted font-medium">{t("order.pieces")}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={pieces === "auto" ? piecesAuto : pieces}
                    onChange={(e) => setPieces(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                    className="w-20 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-center font-mono text-text shadow-sm focus:border-action focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPieces("auto")}
                    className={`text-2xs font-bold cursor-pointer ${pieces === "auto" ? "text-action" : "text-text-faint hover:text-text"}`}
                  >
                    {t("order.piecesAuto")}
                  </button>
                </div>
              </label>

              <div className="space-y-2 pt-2">
                <a
                  href={print("invoice_admin")}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-action bg-surface px-3 py-2 text-center text-xs font-bold text-action hover:bg-surface-tint transition-colors shadow-sm"
                >
                  <ReceiptIcon className="size-4" />
                  {t("order.printInvoiceA4")}
                </a>

                <a
                  href={print("label_carrier")}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-action bg-surface px-3 py-2 text-center text-xs font-bold text-action hover:bg-surface-tint transition-colors shadow-sm"
                >
                  <TruckIcon className="size-4" />
                  {t("order.printCarrierA5")}
                </a>

                {groups.map((g: GroupRow) => (
                  <a
                    key={g.id}
                    href={print("label_vendor", g.vendor_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-center text-xs font-semibold text-text hover:bg-surface-tint transition-colors shadow-sm"
                  >
                    <PackageIcon className="size-3.5 text-text-muted" />
                    <span>{t("order.printVendorLabel")} — {en ? g.vendor.store_name_en : g.vendor.store_name_ar}</span>
                  </a>
                ))}
              </div>
            </div>

            {documents.length > 0 ? (
              <details className="border-t border-border/60 pt-3 text-xs">
                <summary className="cursor-pointer font-bold text-text-muted hover:text-text">
                  {t("order.printLog")} ({documents.length})
                </summary>
                <ul className="mt-2 space-y-1 font-mono text-2xs text-text-faint">
                  {documents.map((d: { id: string; doc_type: string; copies: number; created_at: string }) => (
                    <li key={d.id} className="flex justify-between gap-2 border-b border-border/20 py-1">
                      <span>{t(`order.doc_${d.doc_type}`)}</span>
                      <span dir="ltr">×{d.copies} · {new Date(d.created_at).toLocaleTimeString(en ? "en-EG" : "ar-EG")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
