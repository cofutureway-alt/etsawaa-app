import type { Route } from "./+types/sell";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { requireLang } from "~/lib/lang.server";
import { publicMeta } from "~/lib/seo";
import { Button, Card, CardBody, CardHeader, EmptyState } from "~/components/ui";
import { ChevronDownIcon } from "~/components/ui/icons";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * /sell — Seller Center (JOURNEYS §1a): the public entry to the vendor funnel.
 * Real DB data only: live categories for the site-map card, vendor terms text
 * from settings (read server-side), registration switch honored.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  let registrationEnabled = true;
  let roots: Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string }> = [];
  let children: Array<{ id: string; parent_id: string | null; name_ar: string; name_en: string; slug_ar: string; slug_en: string }> = [];
  let termsAr = "";
  let termsEn = "";

  if (client) {
    const [general, cats, terms] = await Promise.all([
      client.from("settings").select("value").eq("key", "site.general").maybeSingle(),
      client
        .from("categories")
        .select("id, parent_id, name_ar, name_en, slug_ar, slug_en")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("sort"),
      // vendor_terms is not public — read server-side for the terms card only
      (async () => {
        const admin = getSupabaseAdminClient();
        if (!admin) return null;
        return admin.from("settings").select("value").eq("key", "vendor_terms").maybeSingle();
      })(),
    ]);
    const generalValue = (general?.data as { value?: Record<string, unknown> } | null)?.value;
    if (generalValue && generalValue.vendor_registration_enabled === false) registrationEnabled = false;
    const rows = (cats.data ?? []) as Array<{ id: string; parent_id: string | null; name_ar: string; name_en: string; slug_ar: string; slug_en: string }>;
    roots = rows.filter((row) => row.parent_id === null);
    children = rows.filter((row) => row.parent_id !== null);
    const termsValue = (terms?.data as { value?: Record<string, unknown> } | null)?.value;
    termsAr = typeof termsValue?.text_ar === "string" ? termsValue.text_ar : "";
    termsEn = typeof termsValue?.text_en === "string" ? termsValue.text_en : "";
  }

  return { lang, registrationEnabled, roots, children, termsAr, termsEn };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/sell",
    title: lang === "ar" ? "بِع على اتسوء — مركز البائعين" : "Sell on Etsawaa — Seller Center",
    description:
      lang === "ar"
        ? "افتح متجرك على اتسوء: تسجيل مجاني، لوحة تحكم كاملة، وتوصيل لكل محافظات مصر."
        : "Open your store on Etsawaa: free registration, a full dashboard, and delivery to every Egyptian governorate.",
  });
};

export default function SellPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, registrationEnabled, roots, children, termsAr, termsEn } = loaderData;
  const isAr = lang === "ar";
  const name = (row: { name_ar: string; name_en: string }) => (isAr ? row.name_ar : row.name_en);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-8">
      <header className="flex flex-col items-start gap-3">
        <h1 className="text-xl font-black text-text">{t("sell.title")}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t("sell.pitch")}</p>
        <div className="flex flex-wrap gap-2.5">
          {registrationEnabled ? (
            <Link to={`/${lang}/auth/register?intent=vendor`}>
              <Button size="lg">{t("sell.createAccount")}</Button>
            </Link>
          ) : (
            <Button size="lg" disabled>
              {t("sell.createAccount")}
            </Button>
          )}
          <Link to={`/${lang}/auth/login?next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}`}>
            <Button size="lg" variant="outline">
              {t("sell.vendorSignIn")}
            </Button>
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader title={t("sell.siteMap")} />
        <CardBody>
          {roots.length === 0 ? (
            <EmptyState title={t("common.empty")} body={t("errors.dataUnavailable")} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {roots.map((root) => {
                const subs = children.filter((child) => child.parent_id === root.id);
                const slug = (row: { slug_ar: string; slug_en: string }) =>
                  encodeURIComponent(isAr ? row.slug_ar || row.slug_en : row.slug_en || row.slug_ar);
                return (
                  <details key={root.id} className="rounded-lg border border-border bg-surface p-3">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-extrabold text-text">
                      <ChevronDownIcon aria-hidden="true" className="size-4 text-text-faint" />
                      <Link to={`/${lang}/category/${slug(root)}`} className="hover:text-action">
                        {name(root)}
                      </Link>
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1.5 ps-5">
                      {subs.map((sub) => {
                        const subsSubs = children.filter((child) => child.parent_id === sub.id);
                        return (
                          <li key={sub.id}>
                            <Link to={`/${lang}/category/${slug(sub)}`} className="text-[13px] font-bold text-action hover:underline">
                              {name(sub)}
                            </Link>
                            {subsSubs.length > 0 ? (
                              <ul className="mt-1 flex flex-col gap-1 ps-4">
                                {subsSubs.map((subSub) => (
                                  <li key={subSub.id}>
                                    <Link to={`/${lang}/category/${slug(subSub)}`} className="text-[12px] text-text-muted hover:text-action">
                                      {name(subSub)}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("sell.termsCard")} />
        <CardBody>
          <details>
            <summary className="cursor-pointer text-[13px] font-bold text-action">{t("sell.termsOpen")}</summary>
            <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-text-muted">
              {isAr ? termsAr : termsEn}
            </p>
          </details>
        </CardBody>
      </Card>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
