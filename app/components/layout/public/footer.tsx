/**
 * Public storefront footer. Sits at the bottom of the shell and stays pinned
 * via the flex column in the layout.
 *
 * Footer (JOURNEYS §0): about · policies (DB) · sell · contact + payments.
 *
 * Extracted from app/layouts/public.tsx — pure structural refactor, no
 * behavior change.
 */
import { Link, useRouteLoaderData } from "react-router";
import type { RootLoaderData } from "~/features/settings/api";
import { SocialLinks } from "~/components/layout/SocialLinks";
import { useTranslation } from "react-i18next";
import { GlobeIcon } from "~/components/ui/icons";
import { headerPageHref, type HeaderPage } from "./shared";

export function PublicFooter({
  siteName,
  lang,
  headerPages,
}: {
  siteName: string;
  lang: string;
  headerPages: HeaderPage[];
}) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const groups = [
    {
      title: t("footer.about"),
      links: [
        { to: `/${lang}/p/about`, label: t("footer.about") },
        { to: `/${lang}/legal/terms`, label: t("footer.terms") },
        { to: `/${lang}/p/privacy`, label: t("footer.privacy") },
        { to: `/${lang}/p/returns`, label: t("footer.returns") },
      ],
    },
    {
      title: t("nav.categories"),
      links: [
        { to: `/${lang}/products`, label: t("nav.allProducts") },
        { to: `/${lang}/vendors`, label: t("nav.vendors") },
        { to: `/${lang}/brands`, label: t("nav.brands") },
        { to: `/${lang}/blog`, label: t("nav.blog") },
      ],
    },
    {
      title: t("footer.help"),
      links: [
        { to: `/${lang}/contact`, label: t("footer.contactUs") },
        // one site-map file: the one in the page language
        { to: `/${lang}/site-map`, label: t("smap.title") },
      ],
    },
    {
      title: t("nav.sell"),
      links: [
        { to: `/${lang}/sell`, label: t("nav.sell") },
        { to: `/${lang}/auth/register`, label: t("nav.register") },
        { to: `/${lang}/auth/login`, label: t("nav.login") },
      ],
    },
  ];

  return (
    <footer className="mt-auto bg-footer text-footer-text">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-3">
          <img
            src="/logo-mark.webp"
            alt={siteName}
            width={548}
            height={245}
            loading="lazy"
            decoding="async"
            className="h-16 w-auto self-start sm:h-20"
          />
          <p className="max-w-xs text-sm leading-relaxed">{t("app.tagline")}</p>
          <SocialLinks links={root?.social ?? {}} />
          {/* one image: Visa · Mastercard · Fawry · Vodafone Cash (all online via Kashier) */}
          <div className="mt-1">
            <p className="mb-2 text-2xs font-extrabold uppercase tracking-wide text-white/70">{t("footer.paymentMethods")}</p>
            <img
              src="/payments/methods.webp"
              alt={t("footer.paymentAlt")}
              width={510}
              height={72}
              loading="lazy"
              decoding="async"
              className="h-9 w-auto max-w-full"
            />
          </div>
        </div>
        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title} className="min-w-0">
            <h3 className="mb-3 text-sm font-extrabold text-white">{group.title}</h3>
            <ul className="flex flex-col gap-2">
              {group.links.map((link) => (
                <li key={`${group.title}-${link.to}`}>
                  {"file" in link && link.file ? (
                    <a href={link.to} className="block text-sm transition-colors duration-150 hover:text-white">{link.label}</a>
                  ) : (
                    <Link
                      to={link.to}
                      className="block text-sm transition-colors duration-150 hover:text-white"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      {headerPages.length > 0 ? (
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs">
            {headerPages.map((page) => (
              <Link
                key={page.slug_en}
                to={headerPageHref(lang, page)}
                className="transition-colors duration-150 hover:text-white"
              >
                {lang === "ar" ? page.title_ar : page.title_en}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-2 px-4 py-3.5 text-xs">
          <span>
            © {new Date().getFullYear()} {siteName}. {t("footer.rights")}
          </span>
          <span className="flex items-center gap-1.5">
            <GlobeIcon aria-hidden="true" />
            {t("footer.languages")}
          </span>
        </div>
      </div>
    </footer>
  );
}
