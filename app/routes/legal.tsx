import { Link, data } from "react-router";
import type { Route } from "./+types/legal";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { getI18n } from "~/lib/i18n/config";
import { publicMeta } from "~/lib/seo";
import { getLegalDoc, kindFromSlug } from "~/features/legal/legal.server";
import { LegalDocument } from "~/features/legal/LegalDocument";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";

/**
 * /:lang/legal/terms and /:lang/legal/seller-agreement — the current version
 * (or ?v=<version> for one a user accepted earlier), readable by anyone,
 * before and after registration.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const kind = kindFromSlug(params.kind);
  if (!kind) throw new Response("Not found", { status: 404 });
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const version = new URL(request.url).searchParams.get("v");
  const doc = await getLegalDoc(client, kind, version);
  if (!doc) throw new Response("Not found", { status: 404 });
  return { lang, doc };
}

export const meta: Route.MetaFunction = ({ data: d, params }) => {
  const lang = (d?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  const title = d ? (lang === "en" ? d.doc.title_en : d.doc.title_ar) : "";
  return publicMeta({
    lang,
    path: `/legal/${params.kind ?? ""}`,
    title: `${title} — ${t("app.name")}`,
    description: t("legal.metaDescription", { title }),
  });
};

export default function LegalPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, doc } = loaderData;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {!doc.is_current ? (
        <p role="status" className="mb-4 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
          {t("legal.oldVersion", { version: doc.version })}{" "}
          <Link to={`/${lang}/legal/${doc.kind === "terms" ? "terms" : "seller-agreement"}`} className="font-bold text-action hover:underline">{t("legal.seeCurrent")}</Link>
        </p>
      ) : null}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-1 sm:p-8">
        <LegalDocument doc={doc} lang={lang} />
      </div>
      <p className="mt-3 text-center">
        <button type="button" onClick={() => window.print()} className="text-sm font-bold text-action hover:underline">{t("legal.print")}</button>
      </p>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}
