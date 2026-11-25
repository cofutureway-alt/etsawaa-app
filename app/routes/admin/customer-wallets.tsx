import { data } from "react-router";
import type { Route } from "./+types/customer-wallets";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { EmptyState } from "~/components/ui/EmptyState";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";

/**
 * Admin → Customer wallets (Phase A): the totals the platform owes customers
 * and a searchable list. Each customer page (…/customer-wallets/:id) has the
 * balances, gift lots and ledger plus the adjust / gift / cancel-gift dialogs.
 * Permission gate: refunds.view/manage — the same keys that gate /admin/refunds.
 */

export interface WalletCustomer {
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  refund_piastres: number;
  gift_piastres: number;
  updated_at: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const search = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const { data: res, error } = await client.rpc("fn_admin_customer_wallets", {
    p_search: search || null,
    p_page: page,
  });
  if (error) throw new Error(error.message);
  const r = (res ?? {}) as {
    ok?: boolean;
    rows?: WalletCustomer[];
    total?: number;
    refund_total_piastres?: number;
    gift_total_piastres?: number;
  };
  if (r.ok === false) throw new Response("Forbidden", { status: 403 });
  return {
    lang,
    search,
    page,
    rows: (r.rows ?? []) as WalletCustomer[],
    total: Number(r.total ?? 0),
    refundTotal: Number(r.refund_total_piastres ?? 0),
    giftTotal: Number(r.gift_total_piastres ?? 0),
  };
}

export default function AdminCustomerWallets({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const lang = loaderData.lang;
  const owes = loaderData.refundTotal + loaderData.giftTotal;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-black text-text">{t("cw.title")}</h1>
        <p className="mt-1 text-xs text-text-muted">{t("cw.subtitle")}</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border border-t-[3px] border-t-action bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("cw.totalOwed")}</dt>
          <dd className="num mt-1 text-xl font-black text-action" dir="ltr">{money(owes)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("cw.refundBalance")}</dt>
          <dd className="num mt-1 text-xl font-black text-text" dir="ltr">{money(loaderData.refundTotal)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("cw.giftBalance")}</dt>
          <dd className="num mt-1 text-xl font-black text-text" dir="ltr">{money(loaderData.giftTotal)}</dd>
        </div>
      </dl>

      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        <label htmlFor="cw-search" className="sr-only">{t("cw.searchLabel")}</label>
        <input
          id="cw-search"
          name="q"
          defaultValue={loaderData.search}
          placeholder={t("cw.searchPlaceholder")}
          className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
        />
        <Button type="submit" size="sm">{t("common.search")}</Button>
        {loaderData.search ? (
          <a href={`/${lang}/admin/customer-wallets`} className="text-sm font-bold text-action hover:underline">{t("common.reset")}</a>
        ) : null}
      </form>

      {loaderData.rows.length === 0 ? (
        <EmptyState title={t("cw.empty")} body={t("cw.emptyHint")} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface shadow-1 md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs text-text-muted">
                  <th className="p-3 text-start">{t("cw.customer")}</th>
                  <th className="p-3 text-start">{t("cw.contact")}</th>
                  <th className="p-3 text-end">{t("cw.refundBalance")}</th>
                  <th className="p-3 text-end">{t("cw.giftBalance")}</th>
                  <th className="p-3 text-start">{t("cw.open")}</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.rows.map((c) => (
                  <tr key={c.user_id} className="border-b border-border/60 last:border-0">
                    <td className="p-3 font-bold text-text">{c.full_name}</td>
                    <td className="p-3 text-xs text-text-muted" dir="ltr">{c.phone || c.email || "—"}</td>
                    <td className="num p-3 text-end" dir="ltr">{money(c.refund_piastres)}</td>
                    <td className="num p-3 text-end" dir="ltr">{money(c.gift_piastres)}</td>
                    <td className="p-3">
                      <a href={`/${lang}/admin/customer-wallets/${encodeURIComponent(c.user_id)}`} className="font-bold text-action hover:underline">{t("cw.open")}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {loaderData.rows.map((c) => (
              <li key={c.user_id} className="rounded-md border border-border bg-surface p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <a href={`/${lang}/admin/customer-wallets/${encodeURIComponent(c.user_id)}`} className="font-bold text-action hover:underline">{c.full_name}</a>
                  <span className="num text-xs text-text-muted" dir="ltr">{c.phone || c.email || "—"}</span>
                </div>
                <p className="num mt-1 text-xs text-text-muted" dir="ltr">
                  {money(c.refund_piastres)} · {money(c.gift_piastres)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
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
