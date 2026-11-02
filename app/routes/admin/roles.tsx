import { data, useFetcher } from "react-router";
import type { Route } from "./+types/roles";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-26 — Roles & permissions matrix (US-14): edit staff permission lists
 * (permission strings from roles.permissions jsonb); last-admin protection is
 * enforced by fn_admin_set_role (profiles) and this page blocks demoting the
 * last admin in the users page action. Changes apply on the next request
 * (has_permission reads the row live) — "removing a permission hides routes
 * immediately after next request".
 */

const CATALOG: Array<{ domain: string; actions: string[] }> = [
  { domain: "users", actions: ["read", "manage"] },
  { domain: "products", actions: ["read", "manage"] },
  { domain: "orders", actions: ["read", "manage"] },
  { domain: "vendors", actions: ["read", "manage"] },
  { domain: "coupons", actions: ["read", "manage"] },
  { domain: "catalog", actions: ["read", "manage"] },
  { domain: "settings", actions: ["read", "write"] },
  { domain: "reports", actions: ["read"] },
  { domain: "media", actions: ["read", "manage"] },
];

interface RoleRow { slug: string; name_ar: string; name_en: string; permissions: string[]; is_system: boolean }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client.from("roles").select("*").order("slug");
  if (error) throw new Error(error.message);
  return { lang, roles: JSON.parse(JSON.stringify(rows ?? [])) as RoleRow[] };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const slug = String(form.get("slug") ?? "");
  if (slug === "admin" || slug === "vendor" || slug === "customer") {
    // system roles: admin keeps '*', others have no panel permissions
    return data({ ok: false, reason: "system_role" }, { status: 400 });
  }
  const permissions = form.getAll("perm").map(String);
  const res = await client.rpc("fn_admin_set_role_permissions", { p_slug: slug, p_permissions: permissions });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
}

export default function AdminRoles({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("ro.title")}</h1>
      <p className="mt-1 text-[13px] text-text-muted">{t("ro.hint")}</p>

      <div className="mt-3 flex flex-col gap-3">
        {(loaderData.roles as RoleRow[]).map((r) => (
          <div key={r.slug} className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-text">{en ? r.name_en : r.name_ar}</h2>
              <span dir="ltr"><Badge tone={r.slug === "admin" ? "danger" : r.slug === "staff" ? "info" : "neutral"}>{r.slug}</Badge></span>
              {r.is_system ? <Badge tone="neutral">{t("ro.system")}</Badge> : null}
            </div>
            {r.slug === "staff" ? (
              <fetcher.Form method="post" onSubmit={() => setSavedSlug(r.slug)} className="mt-2">
                <input type="hidden" name="slug" value={r.slug} />
                <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {CATALOG.flatMap((cat) =>
                    cat.actions.map((act) => {
                      const perm = `${cat.domain}.${act}`;
                      return (
                        <label key={perm} className="flex items-center gap-2 text-[13px] text-text">
                          <input type="checkbox" name="perm" value={perm}
                            defaultChecked={r.permissions.includes(perm)}
                            className="size-4 accent-[var(--color-action)]" />
                          <span dir="ltr" className="num text-xs">{perm}</span>
                        </label>
                      );
                    }),
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Button type="submit" size="sm" disabled={busy}>{t("ve.save")}</Button>
                  {savedSlug === r.slug && fetcher.state === "idle" && fetcher.data?.ok ? (
                    <span className="text-[13px] font-bold text-success-strong">{t("ve.saved")}</span>
                  ) : null}
                  {fetcher.data && !fetcher.data.ok ? (
                    <p role="alert" className="text-xs font-bold text-danger">{String(fetcher.data.reason)}</p>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-text-muted">{t("ro.staffNote")}</p>
              </fetcher.Form>
            ) : (
              <p className="mt-1.5 text-[13px] text-text-muted" dir="ltr">
                {r.slug === "admin" ? "* (full access)" : t("ro.noPanel")}
              </p>
            )}
          </div>
        ))}
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
  return <SkeletonTable />;
}
