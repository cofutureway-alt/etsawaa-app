import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Audit log writer (F-08). DB triggers record role/settings changes inside
 * Postgres; this helper exists for app-level sensitive actions that have no
 * trigger. Runs through an admin/service client or an admin user client —
 * RLS permits inserts from service_role only.
 */
export interface AuditEntry {
  actor: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

/** Build the insert payload (pure — unit-tested). */
export function buildAuditRow(entry: AuditEntry) {
  return {
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId,
    before: entry.before === undefined ? null : entry.before,
    after: entry.after === undefined ? null : entry.after,
    ip_address: entry.ip,
  };
}

export async function writeAudit(client: SupabaseClient, entry: AuditEntry): Promise<void> {
  const row = buildAuditRow(entry);
  const { error } = await client.from("audit_logs").insert(row);
  if (error) {
    // Audit failures must be loud in server logs but never break the request.
    console.error("[audit] failed to write audit entry", error.message, row);
  }
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return null;
}
