import { useState } from "react";
import { data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/legal-accept";
import { Trans, useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { safeNext } from "~/lib/auth/next";
import { acceptanceEvidence, getLegalDoc, getLegalStatus } from "~/features/legal/legal.server";
import { LegalDocument } from "~/features/legal/LegalDocument";
import { Button, Input } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * /:lang/legal/accept?next=… — the mandatory acceptance step. A signed-in
 * user who has not accepted the CURRENT Terms (Google sign-up, an older
 * account, a newly published version) — or a seller the current seller
 * agreement — lands here from any panel page and returns to `next` after
 * accepting. Each acceptance is recorded by fn_accept_legal with version,
 * time, IP and user agent (+ typed signature for the seller agreement).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"), `/${lang}/account`);
  if (!viewer) throw redirect(`/${lang}/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const status = await getLegalStatus(client);
  const needTerms = status?.terms.accepted === false;
  const needSeller = status?.seller_agreement.required === true && status.seller_agreement.accepted === false;
  if (!needTerms && !needSeller) throw redirect(next);
  const [terms, seller] = await Promise.all([
    needTerms ? getLegalDoc(client, "terms") : Promise.resolve(null),
    needSeller ? getLegalDoc(client, "seller_agreement") : Promise.resolve(null),
  ]);
  return { lang, next, terms, seller, name: viewer.profile.full_name };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const form = await request.formData();
  const { ip, userAgent } = acceptanceEvidence(request);
  for (const kind of ["terms", "seller_agreement"] as const) {
    const version = form.get(`${kind}_version`);
    if (!version) continue;
    if (form.get(`${kind}_accept`) !== "on") return data({ ok: false, reason: "must_accept" }, { status: 400 });
    const { data: res, error } = await client.rpc("fn_accept_legal", {
      p_kind: kind, p_version: String(version), p_context: "gate",
      p_signature: kind === "seller_agreement" ? String(form.get("signature") ?? "") : null,
      p_ip: ip, p_user_agent: userAgent,
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    if (!r.ok) return data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
  }
  throw redirect(safeNext(String(form.get("next") ?? ""), `/${lang}/account`));
}

export default function LegalAccept({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, terms, seller, next } = loaderData;
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const [termsOk, setTermsOk] = useState(false);
  const [sellerOk, setSellerOk] = useState(false);
  const [signature, setSignature] = useState("");
  const ready = (!terms || termsOk) && (!seller || (sellerOk && signature.trim().length >= 3));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-black text-text">{t("legal.acceptTitle")}</h1>
        <p className="mt-1 text-sm text-text-muted">{t("legal.acceptHint")}</p>
      </header>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        {terms ? (
          <section className="rounded-lg border border-border bg-surface shadow-1">
            <div className="max-h-[50vh] overflow-y-auto p-5"><LegalDocument doc={terms} lang={lang} /></div>
            <label className="flex items-start gap-2 border-t border-border p-4 text-sm font-bold text-text">
              <input type="hidden" name="terms_version" value={terms.version} />
              <input type="checkbox" name="terms_accept" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-action)]" />
              {t("legal.acceptTerms", { version: terms.version })}
            </label>
          </section>
        ) : null}
        {seller ? (
          <section className="rounded-lg border border-border bg-surface shadow-1">
            <div className="flex flex-col gap-3 p-4">
              <input type="hidden" name="seller_agreement_version" value={seller.version} />
              <label className="flex items-start gap-2 text-sm font-bold text-text">
                <input type="checkbox" name="seller_agreement_accept" checked={sellerOk} onChange={(e) => setSellerOk(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-action)]" />
                <span className="leading-relaxed">
                  <Trans i18nKey="vendorOnboarding.step4.consent" components={{
                    policies: <a href={`/${lang}/legal/terms`} target="_blank" rel="noopener noreferrer" className="text-action underline" />,
                    contract: <a href={`/${lang}/legal/seller-agreement`} target="_blank" rel="noopener noreferrer" className="text-action underline" />,
                  }} />
                </span>
              </label>
              <Input name="signature" label={t("vendorOnboarding.step4.signature")} hint={t("vendorOnboarding.step4.signatureHint")} value={signature} onChange={(e) => setSignature(e.target.value)} />
            </div>
          </section>
        ) : null}
        <Button type="submit" disabled={!ready} loading={fetcher.state !== "idle"}>{t("legal.acceptButton")}</Button>
      </fetcher.Form>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}
