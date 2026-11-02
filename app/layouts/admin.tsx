import { Outlet, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/admin";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import type { RootLoaderData } from "~/features/settings/api";
import { listNotifications } from "~/features/notifications/api";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { NotificationBell } from "~/features/notifications/NotificationBell";
import { PanelShell } from "~/components/layout/PanelShell";
import type { SidebarGroup } from "~/components/layout/SidebarNav";
import { RoutePending } from "~/components/layout/RoutePending";
import {
  ChartIcon,
  GridIcon,
  ListIcon,
  SettingsIcon,
  StoreIcon,
  TagIcon,
  UploadIcon,
  UsersIcon,
} from "~/components/ui/icons";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  let unread = 0;
  try {
    const rows = await listNotifications(client, viewer.user.id);
    unread = rows.filter((row) => row.read_at === null).length;
  } catch {
    unread = 0;
  }
  return { lang, viewer, unread };
}

/** Admin panel shell — reference sidebar (grouped, dark) + topbar. */
export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, viewer, unread } = loaderData;
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const siteName =
    (root?.locale === "en" ? root?.site.site_name_en : root?.site.site_name_ar) ?? t("app.name");

  const groups: SidebarGroup[] = [
    {
      label: lang === "ar" ? "العمليات" : "Operations",
      items: [
        { to: `/${lang}/admin`, label: t("admin.dashboard"), end: true, icon: <ChartIcon /> },
        { to: `/${lang}/admin/orders`, label: t("adminNav.orders"), icon: <ListIcon /> },
        { to: `/${lang}/admin/refunds`, label: t("rf.title"), icon: <ListIcon /> },
        { to: `/${lang}/admin/vendors`, label: t("nav.vendors"), icon: <StoreIcon /> },
        { to: `/${lang}/admin/products`, label: t("adminProducts.title"), icon: <TagIcon /> },
        { to: `/${lang}/admin/shipping`, label: t("adminNav.shipping"), icon: <ListIcon /> },
        { to: `/${lang}/admin/withdrawals`, label: t("wd.title"), icon: <ListIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "التسويق" : "Marketing",
      items: [
        { to: `/${lang}/admin/coupons`, label: t("cp.title"), icon: <TagIcon /> },
        { to: `/${lang}/admin/ads`, label: t("ad.title"), icon: <TagIcon /> },
        { to: `/${lang}/admin/events`, label: t("ev.title"), icon: <TagIcon /> },
        { to: `/${lang}/admin/banners`, label: t("bn.title"), icon: <TagIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "الكتالوج" : "Catalog",
      items: [
        { to: `/${lang}/admin/data-import`, label: t("dim.title"), icon: <UploadIcon /> },
        { to: `/${lang}/admin/catalog/categories`, label: t("catalog.categories"), icon: <GridIcon /> },
        { to: `/${lang}/admin/catalog/brands`, label: t("catalog.brands"), icon: <TagIcon /> },
        { to: `/${lang}/admin/catalog/tags`, label: t("catalog.tags"), icon: <TagIcon /> },
        { to: `/${lang}/admin/catalog/attributes`, label: t("catalog.attributes"), icon: <ListIcon /> },
        { to: `/${lang}/admin/reviews`, label: t("rv.title"), icon: <ListIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "الثقة" : "Trust",
      items: [
        { to: `/${lang}/admin/penalties`, label: t("pn.title"), icon: <ListIcon /> },
        { to: `/${lang}/admin/levels`, label: t("lv.title"), icon: <ChartIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "التقارير" : "Reports",
      items: [
        { to: `/${lang}/admin/reports`, label: t("rpt.title"), icon: <ChartIcon /> },
        { to: `/${lang}/admin/logs`, label: t("admin.logs"), icon: <ListIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "المحتوى" : "Content",
      items: [
        { to: `/${lang}/admin/blog`, label: t("bl.title"), icon: <ListIcon /> },
        { to: `/${lang}/admin/pages`, label: t("sp.title"), icon: <ListIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "المنصة" : "Platform",
      items: [
        { to: `/${lang}/admin/users`, label: t("admin.users"), icon: <UsersIcon /> },
        { to: `/${lang}/admin/roles`, label: t("ro.title"), icon: <UsersIcon /> },
        { to: `/${lang}/admin/customers`, label: t("cu.title"), icon: <UsersIcon /> },
        { to: `/${lang}/admin/media`, label: t("media.title"), icon: <UploadIcon /> },
        { to: `/${lang}/admin/zones`, label: t("z.title"), icon: <GridIcon /> },
        { to: `/${lang}/admin/settings/sections`, label: t("st.title"), icon: <SettingsIcon /> },
        { to: `/${lang}/admin/document-settings`, label: t("ds.title"), icon: <SettingsIcon /> },
        { to: `/${lang}/admin/email-templates`, label: t("et.title"), icon: <SettingsIcon /> },
        { to: `/${lang}/admin/settings`, label: t("admin.settings"), icon: <SettingsIcon /> },
        { to: `/${lang}/admin/profile`, label: t("account.profile"), icon: <UsersIcon /> },
      ],
    },
  ];

  return (
    <PanelShell
      lang={lang}
      siteName={siteName}
      panelTitle={t("admin.title")}
      subtitle={`${viewer.profile.full_name} · ${t("account.role")}: ${viewer.profile.role}`}
      groups={groups}
      actions={
        <>
          <NotificationBell lang={lang} userId={viewer.user.id} initialCount={unread} />
          <LanguageSwitch current={root?.locale ?? "ar"} />
        </>
      }
    >
      <RoutePending>
        <Outlet />
      </RoutePending>
    </PanelShell>
  );
}
