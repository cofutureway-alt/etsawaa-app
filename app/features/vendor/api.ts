import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VENDOR_COLUMNS,
  parseVendorConfig,
  type VendorConfig,
  type VendorRow,
} from "./config";
import { peekViewerContext } from "~/lib/auth/guards";
import { isSharedClient } from "~/lib/supabase/request-scope";
import { scoped } from "~/lib/supabase/request-scope";

/**
 * Server-side vendor data access (loaders/actions). RLS scopes every read —
 * a vendor can only ever see their own row; `vendors` rows are never public.
 */

export async function fetchVendorRow(
  client: SupabaseClient,
  userId: string,
): Promise<VendorRow | null> {
  // the request's viewer context already carries the signed-in person's store
  const ctx = peekViewerContext(client);
  if (ctx && ctx.user.id === userId) return ctx.vendor;
  return scoped(client, `vendor-row:${userId}`, async () => {
    const { data } = await client
      .from("vendors")
      .select(VENDOR_COLUMNS)
      .eq("owner_id", userId)
      .maybeSingle();
    return (data as VendorRow | null) ?? null;
  }, isSharedClient(client));
}

export async function fetchVendorConfig(client: SupabaseClient): Promise<VendorConfig> {
  const { data, error } = await client.rpc("fn_vendor_config");
  if (error) {
    console.warn("[vendor] fn_vendor_config failed:", error.message);
    return parseVendorConfig(null);
  }
  return parseVendorConfig(data);
}

export interface VendorDocumentRow {
  id: string;
  vendor_id: string;
  type: string;
  path: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  status: "pending" | "verified" | "rejected";
  review_note: string | null;
  /** rejection reason code: blurry | unreadable | expired | mismatch | incomplete | wrong_document | other */
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export async function fetchVendorDocuments(
  client: SupabaseClient,
  vendorId: string,
): Promise<VendorDocumentRow[]> {
  const { data } = await client
    .from("vendor_documents")
    .select("id, vendor_id, type, path, original_name, mime, size_bytes, status, review_note, reject_reason, created_at, reviewed_at")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: true });
  return (data as VendorDocumentRow[] | null) ?? [];
}
