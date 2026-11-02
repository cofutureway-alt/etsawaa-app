import { data, useFetcher } from "react-router";
import type { Route } from "./+types/document-settings";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-37 — Document settings: paper sizes, copies per document type,
 * header/footer ar/en, logo, terms note, show-commission toggle, cancelled
 * watermark text, barcode height. Everything is read by order-print.tsx at
 * print time → changes apply to the NEXT print without deploy.
 */

const INPUT = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text";
const BOOL = "size-4 accent-[var(--color-action)]";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: row } = await client.from("settings").select("value").eq("key", "documents").maybeSingle();
  return { lang, docs: (row?.value ?? {}) as Record<string, unknown> };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const num = (k: string, d: number) => Math.max(0, Math.trunc(Number(form.get(k) ?? d)) || d);
  const value = {
    copies_invoice_admin: num("copies_invoice_admin", 1),
    copies_invoice_vendor: num("copies_invoice_vendor", 1),
    copies_label_carrier: num("copies_label_carrier", 2),
    copies_label_vendor: num("copies_label_vendor", 1),
    paper_invoice: String(form.get("paper_invoice") ?? "a4"),
    paper_label: String(form.get("paper_label") ?? "a5_landscape"),
    header_ar: String(form.get("header_ar") ?? ""),
    header_en: String(form.get("header_en") ?? ""),
    footer_ar: String(form.get("footer_ar") ?? ""),
    footer_en: String(form.get("footer_en") ?? ""),
    terms_ar: String(form.get("terms_ar") ?? ""),
    terms_en: String(form.get("terms_en") ?? ""),
    logo_path: String(form.get("logo_path") ?? ""),
    show_commission: form.get("show_commission") === "on",
    watermark_cancelled: String(form.get("watermark_cancelled") ?? "ملغي"),
    barcode_height_mm: num("barcode_height_mm", 12),
  };
  const res = await client.rpc("fn_admin_set_setting", { p_key: "documents", p_value: value });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: "rpc" }, { status: 400 });
}

export default function AdminDocSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const d = loaderData.docs;
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const ok = fetcher.state === "idle" && fetcher.data?.ok === true;

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("ds.title")}</h1>
      <p className="mt-1 text-sm text-text-muted">{t("ds.hint")}</p>

      <Card className="mt-3">
        <CardHeader title={t("ds.paperCopies")} />
        <CardBody>
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.copiesAdminInvoice")}
                <input name="copies_invoice_admin" type="number" min={0} max={20} defaultValue={Number(d.copies_invoice_admin ?? 1)} dir="ltr" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.copiesVendorInvoice")}
                <input name="copies_invoice_vendor" type="number" min={0} max={20} defaultValue={Number(d.copies_invoice_vendor ?? 1)} dir="ltr" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.copiesCarrierLabel")}
                <input name="copies_label_carrier" type="number" min={0} max={20} defaultValue={Number(d.copies_label_carrier ?? 2)} dir="ltr" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.copiesVendorLabel")}
                <input name="copies_label_vendor" type="number" min={0} max={20} defaultValue={Number(d.copies_label_vendor ?? 1)} dir="ltr" className={INPUT} />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.paperInvoice")}
                <select name="paper_invoice" defaultValue={String(d.paper_invoice ?? "a4")} className={INPUT}>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.paperLabel")}
                <select name="paper_label" defaultValue={String(d.paper_label ?? "a5_landscape")} className={INPUT}>
                  <option value="a5_landscape">A5 landscape</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.barcodeHeight")}
                <input name="barcode_height_mm" type="number" min={6} max={30} defaultValue={Number(d.barcode_height_mm ?? 12)} dir="ltr" className={INPUT} />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.headerAr")}
                <input name="header_ar" defaultValue={String(d.header_ar ?? "")} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.headerEn")}
                <input name="header_en" defaultValue={String(d.header_en ?? "")} dir="ltr" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.footerAr")}
                <input name="footer_ar" defaultValue={String(d.footer_ar ?? "")} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.footerEn")}
                <input name="footer_en" defaultValue={String(d.footer_en ?? "")} dir="ltr" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.termsAr")}
                <textarea name="terms_ar" defaultValue={String(d.terms_ar ?? "")} className={`${INPUT} min-h-16`} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.termsEn")}
                <textarea name="terms_en" defaultValue={String(d.terms_en ?? "")} dir="ltr" className={`${INPUT} min-h-16`} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.logo")}
                <input name="logo_path" defaultValue={String(d.logo_path ?? "")} dir="ltr" placeholder="media/… path" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {t("ds.watermark")}
                <input name="watermark_cancelled" defaultValue={String(d.watermark_cancelled ?? "ملغي")} className={INPUT} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-text">
              <input type="checkbox" name="show_commission" defaultChecked={d.show_commission === true} className={BOOL} />
              {t("ds.showCommission")}
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>{t("ve.save")}</Button>
              {ok ? <span className="text-sm font-bold text-success-strong">{t("ve.saved")}</span> : null}
            </div>
          </fetcher.Form>
        </CardBody>
      </Card>
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
