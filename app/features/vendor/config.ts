import { z } from "zod";

/**
 * Vendor-facing configuration read through `fn_vendor_config()` (definer RPC).
 * Mirrors the seeded `verification` / `vendor_terms` / `vendors` settings —
 * vendors must never read the settings table directly (RLS).
 */

export const DOCUMENT_TYPES = [
  "id_front",
  "id_back",
  "commercial_register",
  "tax_card",
  "residence",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const requiredDocumentsSchema = z.object({
  id_front: z.boolean(),
  id_back: z.boolean(),
  commercial_register: z.boolean(),
  tax_card: z.boolean(),
  residence: z.boolean(),
});

export const vendorConfigSchema = z.object({
  registration_enabled: z.boolean(),
  onboarding_mode: z.enum(["manual", "direct"]),
  force_onboarding: z.boolean(),
  review_required: z.boolean(),
  allow_clone: z.boolean(),
  required_documents: requiredDocumentsSchema,
  grace_value: z.number().int().positive(),
  grace_unit: z.enum(["hours", "days", "months"]),
  max_document_mb: z.number().int().positive(),
  terms_version: z.string(),
  terms_ar: z.string(),
  terms_en: z.string(),
});

export type VendorConfig = z.infer<typeof vendorConfigSchema>;

export function parseVendorConfig(raw: unknown): VendorConfig {
  const parsed = vendorConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Definer defaults keep the wizard functional even if settings regress.
  return {
    registration_enabled: true,
    onboarding_mode: "manual",
    force_onboarding: true,
    review_required: true,
    allow_clone: true,
    required_documents: {
      id_front: true,
      id_back: true,
      commercial_register: false,
      tax_card: false,
      residence: false,
    },
    grace_value: 7,
    grace_unit: "days",
    max_document_mb: 5,
    terms_version: "1.0",
    terms_ar: "",
    terms_en: "",
  };
}

export type VendorStatus = "draft" | "pending" | "active" | "rejected" | "suspended";
export type VerificationStatus =
  | "unverified"
  | "submitted"
  | "verified"
  | "rejected"
  | "grace_expired";

export interface VendorRow {
  id: string;
  slug: string;
  store_name_ar: string;
  store_name_en: string;
  short_desc_ar: string;
  short_desc_en: string;
  welcome_msg_ar: string;
  welcome_msg_en: string;
  logo_path: string | null;
  banner_path: string | null;
  category_ids: string[];
  first_name: string;
  last_name: string;
  phone: string | null;
  governorate_id: number | null;
  area_id: number | null;
  address1: string;
  address2: string;
  postal_code: string;
  socials: Record<string, string>;
  status: VendorStatus;
  rejection_reason: string | null;
  verification_status: VerificationStatus;
  verification_note: string | null;
  grace_until: string | null;
  onboarding_step: number;
  terms_version: string | null;
  terms_accepted_at: string | null;
  terms_signature: string | null;
}

export const VENDOR_COLUMNS = `id, slug, store_name_ar, store_name_en, short_desc_ar,
  short_desc_en, welcome_msg_ar, welcome_msg_en, logo_path, banner_path, category_ids,
  first_name, last_name, phone, governorate_id, area_id, address1, address2, postal_code,
  socials, status, rejection_reason, verification_status, verification_note, grace_until,
  onboarding_step, terms_version, terms_accepted_at, terms_signature` as const;

/** Selling blocked server-side when grace expires (US-04 edge). */
export function isGraceExpired(vendor: Pick<VendorRow, "verification_status">): boolean {
  return vendor.verification_status === "grace_expired";
}

/** "grace active" = unverified with a future grace_until. */
export function isGraceActive(vendor: Pick<VendorRow, "verification_status" | "grace_until">): boolean {
  return (
    vendor.verification_status === "unverified" &&
    vendor.grace_until !== null &&
    new Date(vendor.grace_until).getTime() > Date.now()
  );
}

/** Milliseconds left in the grace window (negative = expired). */
export function graceMsLeft(vendor: Pick<VendorRow, "grace_until">): number {
  if (!vendor.grace_until) return 0;
  return new Date(vendor.grace_until).getTime() - Date.now();
}
