import { data } from "react-router";
import type { Route } from "./+types/order-print";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { getOwnOrder, getOrderParts, getGeoNames, type OrderRow, type GroupRow } from "~/features/orders/api";
import { SkeletonPage } from "~/components/ui/Skeleton";

import {
  renderAdminInvoice, renderCarrierLabel, renderVendorLabel, renderVendorInvoice,
  withCopies, type DocType,
} from "~/features/orders/documents.server";

/**
 * GET /:lang/order/:number/print/:doc — print view (server HTML).
 * Access (AGENT §28): admins print everything; vendors print ONLY their own
 * group documents — another vendor's doc is 403 (API-tested). Every render
 * writes an order_documents row via fn_log_document (reprints log new rows).
 * Copies + pieces override arrive as query params from the print dialog.
 */
const DOCS: DocType[] = ["invoice_admin", "label_carrier", "label_vendor", "invoice_vendor"];

export async function loader({ request, params }: Route.LoaderArgs) {
  // root-level leaf route — lang arrives as ?lang=ar|en (default ar)
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ar";
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) throw new Response("Forbidden", { status: 403 });

  const doc = (params.doc ?? "") as DocType;
  if (!DOCS.includes(doc)) throw new Response("Not found", { status: 404 });

  const ownOrder = await getOwnOrder(client, params.number ?? "");
  let order: OrderRow;
  if (ownOrder) {
    order = ownOrder;
  } else {
    // vendors: definer snapshot of the SAFE columns only (no phone/email/address).
    // A vendor asking for an order that is not theirs → 403 (never 404: the
    // existence of an order number is not leaked, and cross-vendor probing
    // is refused the same way a foreign ?vendor= is).
    const { data: snap } = await client.rpc("fn_vendor_order_snapshot", { p_number: decodeURIComponent(params.number ?? "") });
    if (!snap) {
      if (viewer.profile.role === "vendor") throw new Response("Forbidden", { status: 403 });
      throw new Response("Not found", { status: 404 });
    }
    const s = snap as Record<string, unknown>;
    order = {
      id: String(s.id), number: String(s.number), status: s.status as OrderRow["status"],
      payment_method: s.payment_method as OrderRow["payment_method"],
      payment_status: s.payment_status as OrderRow["payment_status"],
      email: "", phone_primary: "", phone_alternate: "",
      ship_name: String(s.ship_name ?? ""),
      governorate_id: Number(s.governorate_id), area_id: Number(s.area_id),
      address1: "", address2: null, postal_code: null,
      subtotal_piastres: Number(s.subtotal_piastres), discount_piastres: Number(s.discount_piastres),
      shipping_fee_piastres: Number(s.shipping_fee_piastres), total_piastres: Number(s.total_piastres),
      coupon_code: null,
      delivered_at: (s.delivered_at as string | null) ?? null,
      cancel_reason: (s.cancel_reason as string | null) ?? null,
      created_at: String(s.created_at),
    };
  }

  // Admin-only coordinate hydration: the snapshot projection deliberately
  // omits shipping_lat/lng (vendor isolation, e2e-asserted), but the CARRIER
  // label QR (https://maps.google.com/?q=lat,lng) is rendered exclusively for
  // admins — pull the pin straight from orders for that role, never vendors.
  if (viewer.profile.role === "admin" && order.shipping_lat == null && order.shipping_lng == null) {
    const { data: geoRow } = await client
      .from("orders")
      .select("shipping_lat, shipping_lng")
      .eq("id", order.id)
      .single();
    order.shipping_lat = geoRow?.shipping_lat ?? null;
    order.shipping_lng = geoRow?.shipping_lng ?? null;
  }

  const url = new URL(request.url);
  const copies = Math.max(1, Math.min(50, Number(url.searchParams.get("copies") ?? 1) || 1));
  const piecesParam = url.searchParams.get("pieces");
  const vendorParam = url.searchParams.get("vendor") ?? "";
  const isAdmin = viewer.profile.role === "admin";

  let vendorId: string | null = null; // for vendor docs
  if (doc === "invoice_admin" || doc === "label_carrier") {
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
  } else {
    // vendor documents: admins may pass any vendor; vendors are pinned to their own
    if (isAdmin) {
      vendorId = vendorParam || null;
      if (!vendorId) throw new Response("Not found", { status: 404 });
    } else {
      const { data: own } = await client
        .from("order_vendor_groups")
        .select("id, vendor_id")
        .eq("order_id", order.id)
        .eq("vendor_id", (await client.rpc("own_vendor_id")).data ?? "00000000-0000-0000-0000-000000000000");
      const mine = ((own ?? []) as Array<{ id: string; vendor_id: string }>)[0];
      // isolation: a vendor can only ever render their own group documents —
      // any requested ?vendor= that is not theirs is refused, never resolved
      if (!mine) throw new Response("Forbidden", { status: 403 });
      if (vendorParam && vendorParam !== mine.vendor_id) throw new Response("Forbidden", { status: 403 });
      vendorId = mine.vendor_id;
    }
  }

  const parts = await getOrderParts(client, order.id);
  const groups = parts.groups as GroupRow[];
  const group = vendorId ? groups.find((g) => g.vendor_id === vendorId) : undefined;
  if (doc !== "invoice_admin" && doc !== "label_carrier" && !group) {
    throw new Response("Forbidden", { status: 403 });
  }

  const geo = await getGeoNames(client, order.governorate_id, order.area_id);

  // label category names: leaf categories of the items in scope
  const catIds = [...new Set(parts.items
    .filter((i) => (doc === "invoice_admin" || doc === "label_carrier" ? true : i.group_id === group!.id))
    .map((i) => i.leaf_category_id))];
  const categoryNames: string[] = [];
  if (catIds.length > 0) {
    const { data: cats } = await client.from("categories").select("name_ar, name_en").in("id", catIds);
    for (const c of (cats ?? []) as Array<{ name_ar: string; name_en: string }>) {
      categoryNames.push(lang === "en" ? c.name_en : c.name_ar);
    }
  }

  const docInput = {
    order, groups, items: parts.items,
    governorate: geo.governorate, area: geo.area,
    lang: lang === "en" ? ("en" as const) : ("ar" as const),
    piecesOverride: piecesParam ? Math.max(1, Math.min(999, Number(piecesParam) || 1)) : null,
    categoryNames,
  };

  let html: string;
  if (doc === "invoice_admin") html = renderAdminInvoice(docInput);
  else if (doc === "label_carrier") html = await renderCarrierLabel(docInput);
  else if (doc === "label_vendor") html = renderVendorLabel(docInput, group!);
  else html = renderVendorInvoice(docInput, group!);

  // every print/reprint logs a row (copies recorded for the dialog audit)
  await client.rpc("fn_log_document", {
    p_order_id: order.id,
    p_doc_type: doc,
    p_vendor_id: vendorId,
    p_copies: copies,
  });

  const finalHtml = withCopies(html, copies);
  return new Response(finalHtml, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
