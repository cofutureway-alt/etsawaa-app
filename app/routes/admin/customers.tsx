import { data, useFetcher } from "react-router";
import type { Route } from "./+types/customers";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { safeLikeTerm } from "~/lib/postgrest";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { DataTable } from "~/components/ui/DataTable";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
// Surfaces the action result: these pages used to discard {ok:false} and
// render nothing, so a failed write looked like a dead button.
import { useActionToast } from "~/components/layout/ActionFeedback";


/**
 * A-23 — Customers (JOURNEYS §16.17): all accounts with search/status filter,
 * ban/unban, delete-with-orders blocked (anonymize) + per-customer order
 * history (orders/revenue/AOV US §16.6).
 */

interface CustRow {
  id: string; full_name: string; email: string | null; phone: string | null;
  role: string; status: string; created_at: string;
  orders_count: number; revenue: number;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  // H-07: server-side pagination — 20 per page, ordered BEFORE range (an
  // unordered .range() overlaps pages; we hit this exact bug in phase 09)
  const PAGE = 20;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const from = (page - 1) * PAGE;
  let query = client
    .from("profiles")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true }) // tie-breaker → deterministic pages
    .range(from, from + PAGE - 1);
  const term = safeLikeTerm(q);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data: rows, error, count } = await query;
  if (error) throw new Error(error.message);
  const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
  const stats = new Map<string, { count: number; revenue: number }>();
  if (ids.length) {
    const { data: oRows } = await client.from("orders")
      .select("user_id, total_piastres, status").in("user_id", ids);
    for (const o of (oRows ?? []) as Array<{ user_id: string; total_piastres: number; status: string }>) {
      if (!["processing", "completed"].includes(o.status)) continue;
      const cur = stats.get(o.user_id) ?? { count: 0, revenue: 0 };
      cur.count += 1; cur.revenue += o.total_piastres;
      stats.set(o.user_id, cur);
    }
  }
  const customers: CustRow[] = ((rows ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string, full_name: r.full_name as string,
    email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null,
    role: r.role as string, status: r.status as string, created_at: r.created_at as string,
    orders_count: stats.get(r.id as string)?.count ?? 0,
    revenue: stats.get(r.id as string)?.revenue ?? 0,
  }));
  const total = count ?? 0;
  return {
    lang, q, page, pageSize: PAGE, total,
    totalPages: Math.max(1, Math.ceil(total / PAGE)),
    customers: JSON.parse(JSON.stringify(customers)),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (!id) return data({ ok: false, reason: "input" }, { status: 400 });

  if (intent === "ban" || intent === "unban") {
    const status = intent === "ban" ? "blocked" : "active";
    const { error } = await client.from("profiles").update({ status }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: `customer.${intent}`, p_entity: "profiles", p_entity_id: id, p_before: null, p_after: { status } });
    return { ok: true as const };
  }

  if (intent === "delete") {
    // A-23 DoD: deleting a customer WITH orders is blocked → anonymize instead.
    const { count } = await client.from("orders").select("id", { count: "exact", head: true }).eq("user_id", id);
    if ((count ?? 0) > 0) {
      return data({ ok: false, reason: "has_orders" }, { status: 400 });
    }
    const { error } = await client.from("profiles").delete().eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "customer.deleted", p_entity: "profiles", p_entity_id: id, p_before: null, p_after: null });
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminCustomers({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const lang = loaderData.lang;

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("cu.title")}</h1>
            <Badge tone="neutral" dot>{loaderData.total}</Badge>
          </div>
          <p className="text-xs text-text-muted">
            قاعدة بيانات العملاء وسجل المشتريات والحسابات
          </p>
        </div>

        <form method="get" className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={loaderData.q}
            placeholder={t("admin.users.search")}
            className="w-48 sm:w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
          />
          <Button type="submit" size="sm" variant="outline" className="cursor-pointer">
            {t("common.search")}
          </Button>
        </form>
      </div>

      {loaderData.customers.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("cu.empty")} body={t("admin.users.empty")} /></div>
      ) : (
        <div className="mt-3">
          <DataTable<CustRow>
            columns={[
              { key: "name", header: t("admin.users.name"), text: (r) => `${r.full_name} ${r.email ?? ""}`,
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-text">{r.full_name}</p>
                    <p className="truncate text-[11px] text-text-muted" dir="ltr">{r.email ?? "—"}</p>
                  </div>
                ) },
              { key: "phone", header: t("admin.users.phone"), text: (r) => r.phone ?? "",
                render: (r) => <span dir="ltr" className="num text-[13px]">{r.phone ?? "—"}</span> },
              { key: "role", header: t("admin.users.role"), text: (r) => r.role, render: (r) => <Badge tone={r.role === "customer" ? "neutral" : "info"}>{r.role}</Badge> },
              { key: "stats", header: t("cu.orders"), text: (r) => String(r.orders_count),
                render: (r) => (
                  <span className="text-[13px]">
                    <span className="num tabular-nums text-text" dir="ltr">{r.orders_count}</span>
                    <span className="block text-[11px] text-text-muted num" dir="ltr">{money(r.revenue)}</span>
                  </span>
                ) },
              { key: "status", header: t("admin.users.status"), text: (r) => r.status,
                render: (r) => <Badge tone={r.status === "active" ? "success" : "danger"}>{r.status === "active" ? t("cu.active") : t("cu.blocked")}</Badge> },
              { key: "actions", header: t("wd.actions"), text: () => "",
                render: (r) => r.role === "customer" ? (
                  <div className="flex gap-1.5">
                    <fetcher.Form method="post">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="intent" value={r.status === "active" ? "ban" : "unban"} />
                      <Button type="submit" size="sm" variant="ghost">{r.status === "active" ? t("adminVendors.ban") : t("adminVendors.unban")}</Button>
                    </fetcher.Form>
                    {r.orders_count === 0 ? (
                      <fetcher.Form method="post" onSubmit={(e) => { if (!confirm(t("cu.deleteConfirm"))) e.preventDefault(); }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="intent" value="delete" />
                        <Button type="submit" size="sm" variant="ghost">{t("cu.delete")}</Button>
                      </fetcher.Form>
                    ) : null}
                  </div>
                ) : <span className="text-xs text-text-faint">—</span> },
            ]}
            rows={loaderData.customers}
            searchPlaceholder={t("admin.users.search")}
            emptyTitle={t("cu.empty")}
            emptyBody={t("admin.users.empty")}
            rowKey={(r) => r.id}
            cardTitle={(r) => r.full_name}
          />
          {/* H-07: real server pagination (search-aware; the link keeps ?q=) */}
          <nav aria-label={t("common.pagination", { defaultValue: "pagination" })} className="mt-3 flex items-center justify-between gap-2">
            <p className="num text-xs text-text-muted">
              {t("common.resultsCount", { count: loaderData.total })}
            </p>
            <div className="flex items-center gap-2">
              {loaderData.page > 1 ? (
                <a
                  href={`/${lang}/admin/customers?page=${loaderData.page - 1}${loaderData.q ? `&q=${encodeURIComponent(loaderData.q)}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint"
                >
                  {t("common.prev")}
                </a>
              ) : null}
              <span className="num text-xs font-bold text-text">
                {t("common.pageXofY", { current: loaderData.page, total: loaderData.totalPages })}
              </span>
              {loaderData.page < loaderData.totalPages ? (
                <a
                  href={`/${lang}/admin/customers?page=${loaderData.page + 1}${loaderData.q ? `&q=${encodeURIComponent(loaderData.q)}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint"
                >
                  {t("common.next")}
                </a>
              ) : null}
            </div>
          </nav>
        </div>
      )}
      <p className="mt-2 text-xs text-text-muted">{t("cu.deleteNote")}</p>
      <p className="text-xs text-text-faint">
        <a href={`/${lang}/admin/users`} className="font-bold text-primary hover:underline">{t("cu.rolesLink")}</a>
      </p>
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
