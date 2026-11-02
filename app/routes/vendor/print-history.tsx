import { data, Link } from "react-router";
import type { Route } from "./+types/print-history";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * VO-20 print history — every render of a vendor document writes an
 * order_documents row (fn_log_document). RLS limits the rows to the vendor's
 * own groups, so no extra filter is needed beyond vendor_id.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: ownVendor } = await client.rpc("own_vendor_id");
  const vendorId = (ownVendor as string | null) ?? null;
  if (!vendorId) return { lang, rows: [] };

  const { data: rows, error } = await client
    .from("order_documents")
    .select("id, doc_type, copies, created_at, order_id, orders(number)")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return { lang, rows: JSON.parse(JSON.stringify(rows ?? [])) };
}

export default function VendorPrintHistory({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const rows = loaderData.rows as Array<{
    id: string; doc_type: string; copies: number; created_at: string;
    order_id: string; orders: { number: string } | null;
  }>;

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("vph.title")}</h1>
      <p className="mt-1 text-xs text-text-muted">{t("vph.hint")}</p>

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("vph.empty")} body={t("vph.emptyHint")} />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-tint text-text-muted">
              <tr>
                <th scope="col" className="p-2.5 text-start font-bold">{t("vph.order")}</th>
                <th scope="col" className="p-2.5 text-start font-bold">{t("vph.doc")}</th>
                <th scope="col" className="p-2.5 text-start font-bold">{t("vph.copies")}</th>
                <th scope="col" className="p-2.5 text-start font-bold">{t("vph.date")}</th>
                <th scope="col" className="p-2.5 text-start font-bold">{t("vph.reprint")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const number = r.orders?.number ?? "";
                // label_vendor / invoice_vendor are the only docs a vendor owns.
                const printable = r.doc_type === "invoice_vendor" || r.doc_type === "label_vendor";
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2.5 font-mono" dir="ltr">
                      {number ? (
                        <Link to={`/${loaderData.lang}/vendor/orders`} className="font-bold text-action hover:underline">
                          {number}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="p-2.5"><Badge tone="neutral">{t(`vph.doc_${r.doc_type}`)}</Badge></td>
                    <td className="num p-2.5" dir="ltr">{r.copies}</td>
                    <td className="num p-2.5 text-text-muted">
                      {new Date(r.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}
                    </td>
                    <td className="p-2.5">
                      {printable && number ? (
                        <a
                          href={`/order/${encodeURIComponent(number)}/print/${r.doc_type}?lang=${loaderData.lang}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-action hover:underline"
                        >
                          {t("vph.reprintAction")}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
