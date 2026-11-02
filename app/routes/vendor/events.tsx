import { data, useFetcher } from "react-router";
import type { Route } from "./+types/events";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * Vendor events (ARCHITECTURE §7 lists /vendor/events; the route was missing).
 * AGENT §21: vendors are auto-enrolled and may REFUSE — refusal hides their
 * products from home/listings and excludes them from event discounts, so this
 * is the one action a vendor owns here. Acceptance is the default.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: ownVendor } = await client.rpc("own_vendor_id");
  const vendorId = (ownVendor as string | null) ?? null;

  // Only events that are currently live or upcoming are actionable.
  const { data: events, error } = await client
    .from("events")
    .select("id, name_ar, name_en, starts_at, ends_at, status")
    .in("status", ["active", "draft"])
    .order("starts_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const ids = ((events ?? []) as Array<{ id: string }>).map((e) => e.id);
  let mine: Array<{ event_id: string; status: string }> = [];
  if (vendorId && ids.length > 0) {
    const { data: rows } = await client
      .from("event_vendors")
      .select("event_id, status")
      .eq("vendor_id", vendorId)
      .in("event_id", ids);
    mine = (rows ?? []) as Array<{ event_id: string; status: string }>;
  }
  return {
    lang,
    events: JSON.parse(JSON.stringify(events ?? [])),
    mine: Object.fromEntries(mine.map((m) => [m.event_id, m.status])),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const eventId = String(form.get("event_id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!eventId || !["accepted", "refused"].includes(status)) {
    return data({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  // fn_event_set_vendor validates ownership and the event state server-side.
  const { data: res, error } = await client.rpc("fn_vendor_event_opt", {
    p_event_id: eventId,
    p_status: status,
  });
  if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res as { ok?: boolean; reason?: string } | null;
  if (r && r.ok === false) return data({ ok: false, reason: r.reason ?? "refused" }, { status: 400 });
  return { ok: true as const };
}

export default function VendorEvents({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const events = loaderData.events as Array<{
    id: string; name_ar: string; name_en: string;
    starts_at: string | null; ends_at: string | null; status: string;
  }>;
  const mine = loaderData.mine as Record<string, string>;

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("vev.title")}</h1>
      <p className="mt-1 text-xs text-text-muted">{t("vev.hint")}</p>

      {events.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("vev.empty")} body={t("vev.emptyHint")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {events.map((e) => {
            const participation = mine[e.id] ?? "auto";
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-m border border-border bg-surface p-3">
                <span className="text-[13px] font-extrabold text-text">
                  {en ? e.name_en || e.name_ar : e.name_ar || e.name_en}
                </span>
                <Badge tone={participation === "refused" ? "danger" : participation === "accepted" ? "success" : "warning"}>
                  {t(`vev.state_${participation}`)}
                </Badge>
                <span className="num text-xs text-text-muted" dir="ltr">
                  {e.starts_at ? new Date(e.starts_at).toLocaleDateString(en ? "en-EG" : "ar-EG") : "—"}
                  {" → "}
                  {e.ends_at ? new Date(e.ends_at).toLocaleDateString(en ? "en-EG" : "ar-EG") : "—"}
                </span>
                <fetcher.Form method="post">
                  <input type="hidden" name="event_id" value={e.id} />
                  <input type="hidden" name="status" value={participation === "refused" ? "accepted" : "refused"} />
                  <Button type="submit" size="sm" variant="outline" disabled={busy}>
                    {participation === "refused" ? t("vev.join") : t("vev.refuse")}
                  </Button>
                </fetcher.Form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: stable skeleton while the loader streams. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
