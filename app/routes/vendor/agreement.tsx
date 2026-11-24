import { Link, data } from "react-router";
import type { Route } from "./+types/agreement";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { getLegalDoc } from "~/features/legal/legal.server";
import { LegalDocument } from "~/features/legal/LegalDocument";
import { Badge, Button, Card, CardBody, CardHeader } from "~/components/ui";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";

/**
 * Vendor → My agreement: the contract filled with this store's data (second
 * party), the typed signature and the date it was accepted, ready to print or
 * save as PDF. The vendor agreed once including future amendments, so the
 * current version is the one shown. Printing keeps only #contract-print.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const [rowsRes, vendorRes, doc] = await Promise.all([
    client.from("legal_acceptances")
      .select("id, kind, version, context, signature, accepted_at")
      .eq("user_id", viewer.user.id)
      .order("accepted_at", { ascending: false }),
    client.from("vendors")
      .select("id, store_name_ar, store_name_en, first_name, last_name, phone, address1, address2, terms_signature, terms_accepted_at, governorates(name_ar, name_en), areas(name_ar, name_en)")
      .eq("owner_id", viewer.user.id).maybeSingle(),
    getLegalDoc(client, "seller_agreement"),
  ]);
  const acceptances = (rowsRes.data ?? []) as Array<{ id: string; kind: string; version: string; context: string; signature: string | null; accepted_at: string }>;
  // the first signature on record (the vendor agreed once, future amendments included)
  const sellerRows = acceptances.filter((a) => a.kind === "seller_agreement");
  const signed = sellerRows[sellerRows.length - 1] ?? null;
  const v = vendorRes.data as null | {
    id: string; store_name_ar: string; store_name_en: string; first_name: string | null; last_name: string | null;
    phone: string | null; address1: string | null; address2: string | null; terms_signature: string | null; terms_accepted_at: string | null;
    governorates: { name_ar: string; name_en: string } | null; areas: { name_ar: string; name_en: string } | null;
  };
  return {
    lang, doc, signed, acceptances,
    email: viewer.user.email ?? "",
    vendor: v ? JSON.parse(JSON.stringify(v)) as NonNullable<typeof v> : null,
  };
}

export default function VendorAgreement({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, doc, signed, acceptances, vendor, email } = loaderData;
  const en = lang === "en";
  const when = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const day = (v: string) => new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" });
  const pick = (o: { name_ar: string; name_en: string } | null) => (o ? (en ? o.name_en || o.name_ar : o.name_ar || o.name_en) : "");
  const signature = signed?.signature || vendor?.terms_signature || "";
  const signedAt = signed?.accepted_at || vendor?.terms_accepted_at || null;
  const owner = vendor ? `${vendor.first_name ?? ""} ${vendor.last_name ?? ""}`.trim() : "";
  const address = vendor ? [vendor.address1, vendor.address2, pick(vendor.areas), pick(vendor.governorates)].filter(Boolean).join("، ") : "";
  const party: Array<[string, string]> = vendor ? [
    [t("agr.store"), en ? vendor.store_name_en || vendor.store_name_ar : vendor.store_name_ar || vendor.store_name_en],
    [t("agr.owner"), owner || "—"],
    [t("agr.phone"), vendor.phone || "—"],
    [t("agr.email"), email || "—"],
    [t("agr.address"), address || "—"],
    [t("agr.contractNo"), vendor.id.slice(0, 8).toUpperCase()],
  ] : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("legal.myAgreement")} subtitle={t("legal.myAgreementHint")}
        actions={<Button onClick={() => window.print()}>{t("agr.print")}</Button>} />
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div id="contract-print" className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-5 shadow-1 sm:p-8 lg:col-span-8" dir={en ? "ltr" : "rtl"}>
          <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
            <img src="/logo-mark.webp" alt="" width={548} height={245} className="h-14 w-auto" />
            <div className="text-end text-xs text-text-muted">
              {vendor ? <p>{t("agr.contractNo")}: <b className="num text-text">{vendor.id.slice(0, 8).toUpperCase()}</b></p> : null}
              {signedAt ? <p>{t("agr.signedOn")}: <b className="text-text">{day(signedAt)}</b></p> : null}
            </div>
          </header>

          {vendor ? (
            <section className="rounded-md border border-border p-4">
              <h2 className="mb-3 text-sm font-extrabold text-text">{t("agr.secondParty")}</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {party.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="shrink-0 text-text-muted">{k}:</dt>
                    <dd className="font-bold text-text">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {doc ? <LegalDocument doc={doc} lang={lang} compact /> : <p className="text-sm text-text-muted">—</p>}

          <section className="grid gap-6 border-t border-border pt-5 text-sm sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="font-extrabold text-text">{t("agr.firstPartySign")}</p>
              <p className="text-text-muted">{t("agr.firstPartyName")}</p>
              <p className="mt-6 border-t border-dashed border-border-strong pt-1 text-xs text-text-muted">{t("agr.stampHint")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-extrabold text-text">{t("agr.secondPartySign")}</p>
              {signature ? (
                <p className="font-serif text-2xl italic text-text">{signature}</p>
              ) : <p className="text-text-muted">{t("legal.notSigned")}</p>}
              <p className="border-t border-dashed border-border-strong pt-1 text-xs text-text-muted">
                {owner || "—"}{signedAt ? ` · ${when(signedAt)}` : ""}
              </p>
              <p className="text-2xs text-text-faint">{t("agr.eSignNote")}</p>
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:col-span-4">
          <Card>
            <CardHeader title={t("legal.signedTitle")} />
            <CardBody className="flex flex-col gap-1.5 text-sm">
              {signed ? (
                <>
                  <p><Badge tone="success">{t("agr.signed")}</Badge></p>
                  <p className="text-text-muted">{when(signed.accepted_at)}</p>
                  {signed.signature ? <p className="text-text">{t("legal.signature")}: <b>{signed.signature}</b></p> : null}
                  <p className="text-xs text-text-muted">{t("agr.futureNote")}</p>
                </>
              ) : <p className="text-text-muted">{t("legal.notSigned")}</p>}
              <Button className="mt-2" variant="outline" onClick={() => window.print()}>{t("agr.print")}</Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("legal.records")} />
            <CardBody>
              <ul className="flex flex-col gap-2 text-xs">
                {acceptances.map((a) => (
                  <li key={a.id} className="flex flex-col">
                    <span className="font-bold text-text">{t(`legal.kind_${a.kind}`)}</span>
                    <span className="text-text-muted">{when(a.accepted_at)} · {t(`legal.ctx_${a.context}`)}</span>
                  </li>
                ))}
              </ul>
              <Link to={`/${lang}/legal/terms`} className="mt-3 inline-block text-sm font-bold text-action hover:underline">{t("legal.readTerms")}</Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}
