import type { ReactNode } from "react";
import { formatPiastres } from "~/lib/money";
import { CameraIcon, MegaphoneIcon, PackageIcon, RocketIcon, SparklesIcon, VideoIcon, WandIcon } from "~/components/ui/icons";

/**
 * Vendor services (migration 20261116000065): the catalogue shapes, the group
 * icons/colours, price wording and the order lifecycle — shared by the vendor
 * page (/vendor/services) and the admin page (/admin/services).
 */

export interface ServiceGroup {
  id: string; code: string | null; name_ar: string; name_en: string; desc_ar: string; desc_en: string;
  icon: string; sort: number; is_active: boolean;
}
export interface ServiceLine { ar: string; en: string }
export interface Service {
  id: string; group_id: string | null; code: string | null; name_ar: string; name_en: string; desc_ar: string; desc_en: string;
  pricing: "fixed" | "per_unit" | "quote"; price_piastres: number; unit_ar: string; unit_en: string; min_qty: number; max_qty: number;
  includes: ServiceLine[]; badge_ar: string; badge_en: string; delivery_days: number | null; cover_path: string | null;
  needs_products: boolean; sort: number; is_active: boolean; is_featured: boolean;
  upload_mode: "none" | "references" | "work"; units_included: number | null;
}
export interface ServiceOrder {
  id: string; number: string; vendor_id: string; service_id: string | null;
  service_snapshot: Partial<Service>; quantity: number; amount_piastres: number;
  payment_method: string | null; payment_status: string; status: ServiceStatus;
  brief: string; product_ids: string[]; attachments: string[]; preferred_date: string | null; scheduled_at: string | null;
  delivery_note: string | null; delivered_files: string[]; delivered_links: string[]; quote_note: string | null;
  reject_reason: string | null; refund_method: string | null; created_at: string; paid_at: string | null;
  delivered_at: string | null; completed_at: string | null;
}
export interface ServiceEvent { id: string; order_id: string; kind: string; note: string | null; data: Record<string, unknown>; created_at: string }

export type ServiceStatus = "awaiting_quote" | "pending_payment" | "new" | "scheduled" | "in_progress" | "delivered" | "completed" | "cancelled" | "rejected";

export const SERVICE_ICONS = ["camera", "video", "wand", "rocket", "megaphone", "sparkles", "package"] as const;

/** Icon + soft colour of a group (the admin picks the icon). */
export function groupLook(icon: string | null | undefined): { Icon: (p: { className?: string }) => ReactNode; tile: string } {
  switch (icon) {
    case "camera": return { Icon: CameraIcon, tile: "bg-action/10 text-action" };
    case "video": return { Icon: VideoIcon, tile: "bg-info-soft text-info" };
    case "wand": return { Icon: WandIcon, tile: "bg-success-soft text-success-strong" };
    case "rocket": return { Icon: RocketIcon, tile: "bg-warning-soft text-warning-strong" };
    case "megaphone": return { Icon: MegaphoneIcon, tile: "bg-primary-soft text-primary" };
    case "package": return { Icon: PackageIcon, tile: "bg-surface-tint text-text" };
    default: return { Icon: SparklesIcon, tile: "bg-accent-soft text-action" };
  }
}

export const pick = (en: boolean, ar: string | null | undefined, enText: string | null | undefined) =>
  (en ? enText || ar : ar || enText) ?? "";

/** "EGP 1,000" · "EGP 15 / photo" · "On quote" */
export function priceLabel(s: Pick<Service, "pricing" | "price_piastres" | "unit_ar" | "unit_en">, en: boolean, quoteText: string): { main: string; per: string } {
  if (s.pricing === "quote") return { main: quoteText, per: "" };
  const main = formatPiastres(s.price_piastres, en ? "en" : "ar");
  const unit = en ? s.unit_en || s.unit_ar : s.unit_ar || s.unit_en;
  return { main, per: s.pricing === "per_unit" && unit ? unit : "" };
}

export function statusTone(status: string): "success" | "danger" | "info" | "warning" | "neutral" {
  if (status === "delivered" || status === "completed") return "success";
  if (status === "rejected") return "danger";
  if (status === "cancelled") return "neutral";
  if (status === "pending_payment" || status === "awaiting_quote") return "warning";
  return "info";
}

/** The happy path shown as a progress bar: ordered → paid → scheduled → in progress → delivered → completed. */
export const PROGRESS = ["placed", "paid", "scheduled", "in_progress", "delivered", "completed"] as const;
export function progressReached(status: string): number {
  return ({ awaiting_quote: 1, pending_payment: 1, new: 2, scheduled: 3, in_progress: 4, delivered: 5, completed: 6 } as Record<string, number>)[status] ?? 0;
}

/**
 * How many files a vendor may upload for this order — follows the order size
 * (same rule as fn_service_upload_limit): per unit → the quantity (a "work"
 * service: up to max_qty, the files ARE the quantity), a bundle → its units.
 */
export function uploadLimit(s: Pick<Service, "upload_mode" | "pricing" | "max_qty" | "units_included">, qty: number): number {
  if (s.upload_mode === "none") return 0;
  if (s.pricing === "per_unit") return s.upload_mode === "work" ? s.max_qty : Math.max(1, Math.min(qty, s.max_qty));
  if (s.pricing === "fixed" && s.units_included) return s.units_included;
  return 20;
}

/** Orders that still need the team / the vendor. */
export const OPEN_STATUSES: ServiceStatus[] = ["awaiting_quote", "pending_payment", "new", "scheduled", "in_progress", "delivered"];
