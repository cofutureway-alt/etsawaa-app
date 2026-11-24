import type { Route } from "./+types/sell";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewerContext } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { publicMeta } from "~/lib/seo";
import { BlogCard, type BlogCardPost } from "~/components/blog/BlogCard";
import {
  CashIcon, ChartIcon, ChevronDownIcon, CreditCardIcon, FileIcon, PackageIcon,
  ShieldIcon, StoreIcon, TagIcon, TruckIcon, CheckIcon,
} from "~/components/ui/icons";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * /sell — "Sell on Etsawaa": the public entry to the seller funnel.
 *
 *  hero        pitch + register / sign-in (registration switch honoured)
 *  why         what a seller gets — only features the platform really has
 *  steps       register → store setup → verification → products → orders
 *  articles    published blog posts the admin marked "feature on Sell page"
 *  site map    live category tree + the same tree as PDF (ar / en) from
 *              /:lang/sell/sitemap.pdf
 *  agreement   links to the versioned seller agreement and terms
 *
 * Real DB data only: counts come from live tables, nothing is invented.
 */

interface Cat { id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string; slug_ar: string; slug_en: string }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  let registrationEnabled = true;
  let cats: Cat[] = [];
  let categoryCount = 0;
  let governorateCount = 0;
  let posts: BlogCardPost[] = [];
  // who is looking: guests get "create seller account", a signed-in customer
  // "register your store" (store set-up), a seller their dashboard
  let viewerKind: "guest" | "customer" | "seller" = "guest";

  if (client) {
    const { ctx } = await getViewerContext(client);
    if (ctx) viewerKind = ctx.vendor || ctx.profile.role === "vendor" ? "seller" : "customer";
    const [general, catRows, catCount, govCount, featured] = await Promise.all([
      client.from("settings").select("value").eq("key", "site.general").maybeSingle(),
      client
        .from("categories")
        .select("id, parent_id, depth, name_ar, name_en, slug_ar, slug_en")
        .eq("is_active", true)
        .is("deleted_at", null)
        .lte("depth", 3) // the page shows three levels; the PDF carries all four
        .order("sort"),
      client.from("categories").select("id", { count: "exact", head: true }).eq("is_active", true).is("deleted_at", null),
      client.from("governorates").select("id", { count: "exact", head: true }).eq("is_active", true),
      client
        .from("blog_posts")
        .select("slug_ar, slug_en, title_ar, title_en, excerpt_ar, excerpt_en, cover_path, published_at")
        .eq("status", "published")
        .eq("feature_on_sell", true)
        .order("published_at", { ascending: false })
        .limit(6),
    ]);
    const generalValue = (general?.data as { value?: Record<string, unknown> } | null)?.value;
    if (generalValue && generalValue.vendor_registration_enabled === false) registrationEnabled = false;
    cats = (catRows.data ?? []) as Cat[];
    categoryCount = catCount.count ?? 0;
    governorateCount = govCount.count ?? 0;
    posts = JSON.parse(JSON.stringify(featured.data ?? [])) as BlogCardPost[];
  }

  return { lang, registrationEnabled, cats, categoryCount, governorateCount, posts, viewerKind };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/sell",
    title: `${t("nav.sell")} — ${t("app.name")}`,
    description: t("sell.metaDescription"),
  });
};

export default function SellPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, registrationEnabled, cats, categoryCount, governorateCount, posts, viewerKind } = loaderData;
  const isAr = lang === "ar";
  const signedIn = viewerKind !== "guest";
  const registerHref = viewerKind === "seller" ? `/${lang}/vendor/onboarding`
    : viewerKind === "customer" ? `/${lang}/vendor/onboarding`
    : `/${lang}/auth/register?intent=vendor`;
  const ctaLabel = viewerKind === "seller" ? t("sell.goDashboard") : viewerKind === "customer" ? t("sell.registerStore") : t("sell.createAccount");
  const signInHref = `/${lang}/auth/login?next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}`;
  const roots = cats.filter((c) => c.parent_id === null);
  const fmt = (n: number) => n.toLocaleString(isAr ? "ar-EG-u-nu-latn" : "en-US");

  const benefits: Array<{ icon: ReactNode; key: string }> = [
    { icon: <StoreIcon />, key: "free" },
    { icon: <ShieldIcon />, key: "grace" },
    { icon: <TruckIcon />, key: "delivery" },
    { icon: <CreditCardIcon />, key: "payments" },
    { icon: <CashIcon />, key: "wallet" },
    { icon: <PackageIcon />, key: "packaging" },
    { icon: <ChartIcon />, key: "dashboard" },
    { icon: <TagIcon />, key: "promote" },
  ];
  const steps = ["register", "store", "verify", "products", "orders"] as const;

  const RegisterCta = ({ tone }: { tone: "solid" | "light" }) =>
    registrationEnabled ? (
      <Link to={registerHref}
        className={`inline-flex min-h-12 items-center justify-center rounded-lg px-6 text-base font-extrabold transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px ${
          tone === "solid" ? "bg-action text-on-action shadow-1" : "bg-surface text-action shadow-1"
        }`}>
        {ctaLabel}
      </Link>
    ) : (
      <span className="inline-flex min-h-12 items-center rounded-lg bg-surface-tint px-6 text-sm font-bold text-text-muted">
        {t("sell.registrationClosed")}
      </span>
    );

  return (
    <div className="flex w-full flex-col">
      {/* ── hero ───────────────────────────────────────────── */}
      <section className="border-b border-border bg-surface-tint">
        <div className="mx-auto grid w-full max-w-page items-center gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12">
          <div className="flex flex-col items-start gap-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-action/20 bg-surface px-3 py-1 text-xs font-extrabold text-action">
              <StoreIcon aria-hidden="true" className="size-4" />{t("sell.eyebrow")}
            </span>
            <h1 className="text-3xl font-black leading-tight text-text sm:text-4xl lg:text-[2.75rem]">{t("sell.heroTitle")}</h1>
            <p className="max-w-xl text-base leading-relaxed text-text-muted sm:text-lg">{t("sell.pitch")}</p>
            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
              <RegisterCta tone="solid" />
              {signedIn ? null : (
                <Link to={signInHref}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-surface px-6 text-base font-bold text-text transition-colors hover:border-action/40 hover:text-action">
                  {t("sell.vendorSignIn")}
                </Link>
              )}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-muted">
              {(["noFee", "grace", "arEn"] as const).map((k) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <CheckIcon aria-hidden="true" className="size-4 text-success" />{t(`sell.tick.${k}`)}
                </li>
              ))}
            </ul>
          </div>

          {/* live facts — counted from the database */}
          <div className="grid grid-cols-2 gap-3">
            <Fact value={fmt(governorateCount)} label={t("sell.fact.governorates")} />
            <Fact value={fmt(categoryCount)} label={t("sell.fact.categories")} />
            <Fact value={t("sell.fact.paymentsValue")} label={t("sell.fact.payments")} />
            <Fact value={t("sell.fact.languagesValue")} label={t("sell.fact.languages")} />
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-page flex-col gap-14 px-4 py-12 sm:gap-16 sm:py-16">
        {/* ── why sell ─────────────────────────────────────── */}
        <section aria-labelledby="why-title">
          <SectionHead id="why-title" title={t("sell.why.title")} lead={t("sell.why.lead")} />
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b) => (
              <li key={b.key} className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-5 shadow-1">
                <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-surface-tint text-action [&>svg]:size-5">{b.icon}</span>
                <h3 className="text-base font-extrabold text-text">{t(`sell.why.${b.key}.title`)}</h3>
                <p className="text-sm leading-relaxed text-text-muted">{t(`sell.why.${b.key}.body`)}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── how it works ─────────────────────────────────── */}
        <section aria-labelledby="steps-title">
          <SectionHead id="steps-title" title={t("sell.steps.title")} lead={t("sell.steps.lead")} />
          <ol className="mt-6 grid gap-3 md:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s} className="relative flex gap-3 rounded-xl border border-border bg-surface p-4 md:flex-col md:gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-action text-sm font-black text-on-action">{fmt(i + 1)}</span>
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-extrabold text-text">{t(`sell.steps.${s}.title`)}</span>
                  <span className="text-[13px] leading-relaxed text-text-muted">{t(`sell.steps.${s}.body`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── featured articles (admin: "feature on Sell page") ── */}
        {posts.length > 0 ? (
          <section aria-labelledby="posts-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHead id="posts-title" title={t("sell.posts.title")} lead={t("sell.posts.lead")} />
              <Link to={`/${lang}/blog`} className="text-sm font-extrabold text-action hover:underline">{t("sell.posts.all")}</Link>
            </div>
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((p) => (
                <li key={p.slug_en} className="flex"><BlogCard post={p} lang={lang} headingLevel={3} /></li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── category site map + PDFs ─────────────────────── */}
        <section aria-labelledby="map-title" className="rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <SectionHead id="map-title" title={t("sell.siteMap")} lead={t("sell.map.lead", { count: categoryCount })} />
            <div className="flex flex-col gap-2 sm:flex-row">
              {/* the full site map is a page now (it used to be a Word download) */}
              <Link to={`/${lang}/site-map`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-action/30 bg-surface-tint px-4 text-sm font-extrabold text-action transition-colors hover:border-action hover:bg-surface">
                <FileIcon aria-hidden="true" className="size-4" />
                {t("smap.open")}
              </Link>
            </div>
          </div>

          {roots.length === 0 ? (
            <p className="mt-6 text-sm text-text-muted">{t("errors.dataUnavailable")}</p>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {roots.map((root) => (
                <RootCard key={root.id} root={root} cats={cats} lang={lang} />
              ))}
            </div>
          )}
        </section>

        {/* ── agreement + final call ───────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-lg font-extrabold text-text">{t("sell.agreement.title")}</h2>
            <p className="text-sm leading-relaxed text-text-muted">{t("sell.agreement.body")}</p>
            <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-1">
              <Link to={`/${lang}/legal/seller-agreement`} className="text-sm font-extrabold text-action hover:underline">{t("sell.agreement.read")}</Link>
              <Link to={`/${lang}/legal/terms`} className="text-sm font-extrabold text-action hover:underline">{t("sell.agreement.terms")}</Link>
            </div>
          </div>
          <div className="flex flex-col items-start justify-center gap-4 rounded-2xl bg-action p-6 text-on-action sm:p-8">
            <h2 className="text-2xl font-black leading-tight">{t("sell.final.title")}</h2>
            <p className="max-w-lg text-sm leading-relaxed opacity-90">{t("sell.final.body")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <RegisterCta tone="light" />
              {signedIn ? null : <Link to={signInHref} className="text-sm font-bold underline-offset-4 hover:underline">{t("sell.vendorSignIn")}</Link>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-1.5">
      <h2 id={id} className="text-2xl font-black text-text sm:text-[1.75rem]">{title}</h2>
      {lead ? <p className="text-sm leading-relaxed text-text-muted sm:text-base">{lead}</p> : null}
    </div>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-1 sm:p-5">
      <span className="num text-2xl font-black text-action sm:text-3xl">{value}</span>
      <span className="text-xs font-bold text-text-muted sm:text-sm">{label}</span>
    </div>
  );
}

/** One top-level category: its sub-categories as links, each opening to level 3. */
function RootCard({ root, cats, lang }: { root: Cat; cats: Cat[]; lang: "ar" | "en" }) {
  const { t } = useTranslation();
  const isAr = lang === "ar";
  const name = (c: Cat) => (isAr ? c.name_ar || c.name_en : c.name_en || c.name_ar);
  const href = (c: Cat) => `/${lang}/category/${encodeURIComponent(isAr ? c.slug_ar || c.slug_en : c.slug_en || c.slug_ar)}`;
  const subs = cats.filter((c) => c.parent_id === root.id);
  return (
    <details className="group/root rounded-xl border border-border bg-surface-alt open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-base font-extrabold text-text">{name(root)}</span>
          <span className="text-xs text-text-muted">{t("sell.map.subCount", { count: subs.length })}</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-5 shrink-0 text-text-faint transition-transform group-open/root:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 border-t border-border p-4 pt-3">
        <Link to={href(root)} className="text-xs font-extrabold text-action hover:underline">{t("sell.map.browse", { name: name(root) })}</Link>
        <ul className="flex flex-col gap-1.5">
          {subs.map((sub) => {
            const leaves = cats.filter((c) => c.parent_id === sub.id);
            return (
              <li key={sub.id}>
                <Link to={href(sub)} className="text-sm font-bold text-text hover:text-action">{name(sub)}</Link>
                {leaves.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {leaves.map((leaf) => (
                      <li key={leaf.id}>
                        <Link to={href(leaf)} className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted transition-colors hover:border-action/40 hover:text-action">
                          {name(leaf)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
