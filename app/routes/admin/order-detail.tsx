import { data } from "react-router";
import type { Route } from "./+types/order-detail";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { getOwnOrder, getOrderParts, getGeoNames, type ItemRow } from "~/features/orders/api";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { OrderDetailHeader } from "~/components/admin/orders/OrderDetailHeader";
import { VendorGroupCards } from "~/components/admin/orders/VendorGroupCards";
import { StatusTimeline } from "~/components/admin/orders/StatusTimeline";
import { OrderNotes } from "~/components/admin/orders/OrderNotes";
import { FinancialSummaryCard } from "~/components/admin/orders/FinancialSummaryCard";
import { DeliveryInfoCard } from "~/components/admin/orders/DeliveryInfoCard";
import { PrintCenterCard } from "~/components/admin/orders/PrintCenterCard";
import { ReturnsPanel, type Refundables, type ReturnRow } from "~/components/admin/orders/ReturnsPanel";


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
  // returns & refunds: what each line can still return + every return on this order
  const [refundables, returnsRes] = await Promise.all([
    client.rpc("fn_admin_order_refundables", { p_order_id: order.id }),
    client.from("refund_requests")
      .select(`id, source, kind, status, logistics_status, items_refund_piastres, shipping_refund_piastres, deduction_piastres,
               refund_total_piastres, refund_method, refund_reference, description, created_at,
               refund_request_items(order_item_id, qty, reason, decision, fault, refund_amount_piastres, vendor_debit_piastres, restock, restocked_qty),
               refund_events(id, event, note, created_at)`)
      .eq("order_id", order.id)
      .order("created_at", { ascending: false }),
  ]);
  const returns: ReturnRow[] = ((returnsRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as ReturnRow),
    items: (r.refund_request_items ?? []) as ReturnRow["items"],
    events: ((r.refund_events ?? []) as ReturnRow["events"]).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
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
    refundables: (refundables.data ?? null) as Refundables | null,
    returns,
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

  // returns: admin picks lines + qty; the server computes, caps and settles
  if (intent === "create_return") {
    let payload: unknown;
    try { payload = JSON.parse(String(form.get("payload") ?? "")); } catch { payload = null; }
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
      return data({ ok: false, reason: "bad_payload" }, { status: 400 });
    }
    const { data: res, error } = await client.rpc("fn_admin_create_return", { p_order_id: order.id, p_payload: payload });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  if (intent === "return_received" || intent === "execute_refund") {
    const requestId = String(form.get("request_id") ?? "");
    const { data: res, error } = intent === "return_received"
      ? await client.rpc("fn_admin_return_received", { p_request_id: requestId, p_note: null })
      : await client.rpc("fn_admin_execute_refund", {
          p_request_id: requestId,
          p_note: String(form.get("note") ?? ""),
          p_method: String(form.get("method") ?? "original"),
          p_reference: String(form.get("reference") ?? ""),
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

export default function AdminOrderDetail({ loaderData }: Route.ComponentProps) {
  const { i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { order, groups, items, documents } = loaderData;

  // Copies/pieces stay here so the header quick actions and the print center
  // build their print URLs from the same state.
  const [copies, setCopies] = useState(1);
  const [pieces, setPieces] = useState<number | "auto">("auto");

  const itemRows = items as ItemRow[];
  const piecesAuto = itemRows.reduce((s, i) => s + i.qty, 0);
  const piecesFinal = pieces === "auto" ? piecesAuto : pieces;
  const printQs = `copies=${copies}&pieces=${piecesFinal}&lang=${en ? "en" : "ar"}`;
  const print = (doc: string, vendor?: string) =>
    // The print view is a root-level route (/order/:number/print/:doc); the language travels as ?lang=.
    `/order/${encodeURIComponent(order.number)}/print/${doc}?${printQs}${vendor ? `&vendor=${encodeURIComponent(vendor)}` : ""}`;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <OrderDetailHeader lang={loaderData.lang} order={order} en={en} print={print} />

      {/* Main Grid: Left Details & Right Summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column (8 cols): Packages, Timeline & Notes */}
        <div className="space-y-6 lg:col-span-8">
          <VendorGroupCards groups={groups} items={itemRows} en={en} />
          <ReturnsPanel items={itemRows} groups={groups} refundables={loaderData.refundables} returns={loaderData.returns} en={en} />
          <StatusTimeline history={loaderData.history} en={en} />
          <OrderNotes notes={loaderData.notes} en={en} />
        </div>

        {/* Right Column (4 cols): Order Financial Summary, Delivery Info, Print Center */}
        <aside className="space-y-6 lg:col-span-4">
          <FinancialSummaryCard order={order} en={en} />
          <DeliveryInfoCard order={order} geo={loaderData.geo} en={en} />
          <PrintCenterCard
            groups={groups}
            documents={documents}
            en={en}
            copies={copies}
            pieces={pieces}
            setCopies={setCopies}
            setPieces={setPieces}
            piecesAuto={piecesAuto}
            print={print}
          />
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
