import type { BadgeTone } from "~/components/ui/Badge";
import { formatPiastres } from "~/lib/money";

/**
 * Shared types + helpers for the admin order-detail route UI
 * (app/routes/admin/order-detail.tsx) and its extracted section components.
 */

/** Wire shape of the admin order-detail action: ok, or ok:false + machine reason. */
export type OrderActionData = { ok: boolean; reason?: string };

/** One A-15 order note: private (admin/staff) + public (customer-visible). */
export interface OrderNoteRow {
  id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
  author: string;
}

/** One order_documents row shown in the print-center log (loader select). */
export interface OrderDocumentRow {
  id: string;
  doc_type: string;
  vendor_id: string | null;
  copies: number;
  created_at: string;
}

/** Map an order/group status to the shared Badge tone (header + vendor cards). */
export function getOrderStatusTone(status: string): BadgeTone {
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

/** Currency formatter bound to the active admin language (integer piastres → EGP string). */
export function makeMoneyFormatter(en: boolean | undefined) {
  return (p: number) => formatPiastres(p, en ? "en" : "ar");
}
