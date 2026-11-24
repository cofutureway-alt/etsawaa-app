import { Outlet, useRouteLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/admin";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewerContext, requirePanelAccess } from "~/lib/auth/guards";
import type { RootLoaderData } from "~/features/settings/api";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { NotificationBell } from "~/features/notifications/NotificationBell";
import { PanelShell } from "~/components/layout/PanelShell";
import type { PanelLink } from "~/components/layout/PanelShell";
import type { SidebarGroup } from "~/components/layout/SidebarNav";
import { RoutePending } from "~/components/layout/RoutePending";
import {
  AlertIcon, ChartIcon, CreditCardIcon, FileIcon, GlobeIcon, GridIcon, ListIcon, MailIcon, MegaphoneIcon, PackageIcon,
  RotateIcon, ScaleIcon, SettingsIcon, ShieldIcon, StarIcon, StoreIcon, TagIcon, TruckIcon, UploadIcon, UserIcon, UsersIcon, CameraIcon } from "~/components/ui/icons";
import { visibleAdminNav, type AdminNavIcon } from "~/features/admin/nav";
import { MobileBottomNav } from "~/components/layout/MobileBottomNav";
import { can } from "~/lib/permissions";

const NAV_ICONS: Record<AdminNavIcon, typeof ChartIcon> = {
  chart: ChartIcon, list: ListIcon, rotate: RotateIcon, truck: TruckIcon, package: PackageIcon, store: StoreIcon,
  wallet: CreditCardIcon, alert: AlertIcon, tag: TagIcon, star: StarIcon, users: UsersIcon, shield: ShieldIcon,
  megaphone: MegaphoneIcon, grid: GridIcon, scale: ScaleIcon, file: FileIcon, upload: UploadIcon,
  settings: SettingsIcon, user: UserIcon, mail: MailIcon, map: GlobeIcon, camera: CameraIcon,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  // guard + sidebar counters in ONE parallel round (the RPC checks permissions
  // itself; its result is simply dropped if the guard redirects)
  const [viewer, { data: navCounts }, { ctx }] = await Promise.all([
    requirePanelAccess(client, lang, "admin", request),
    client.rpc("fn_admin_nav_counts"),
    getViewerContext(client),
  ]);
  // real unread count (the old count only looked at the latest 20 rows)
  const unread = ctx?.unread ?? 0;
  // dashboards this person can open (own store = seller panel; account always)
  const panels: PanelLink[] = [
    { to: `/${lang}/admin`, labelKey: "admin.title", current: true },
    ...(ctx?.vendor ? [{ to: `/${lang}/vendor`, labelKey: "vendor.title" }] : []),
    { to: `/${lang}/account`, labelKey: "account.title" },
  ];
  return { lang, viewer, unread, panels, permissions: viewer.permissions ?? [], navCounts: (navCounts ?? {}) as Record<string, number> };
}

/** Re-run on every in-panel navigation so the permission gate (requirePanelAccess) sees each page. */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return currentUrl.pathname !== nextUrl.pathname || defaultShouldRevalidate;
}

/** Admin panel shell — reference sidebar (grouped, dark) + topbar. */
export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, viewer, unread, panels, permissions, navCounts } = loaderData;
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const siteName =
    (root?.locale === "en" ? root?.site.site_name_en : root?.site.site_name_ar) ?? t("app.name");

  const role = viewer.profile.role;
  const groups: SidebarGroup[] = visibleAdminNav(role, permissions).map((g) => ({
    label: t(g.label),
    items: g.items.map((it) => {
      const Icon = NAV_ICONS[it.icon];
      const badge = Number(navCounts[it.path] ?? 0);
      return {
        to: it.path ? `/${lang}/admin/${it.path}` : `/${lang}/admin`,
        label: t(it.label), end: it.end, icon: <Icon />, badge,
      };
    }),
  }));

  return (
    <PanelShell
      lang={lang}
      siteName={siteName}
      panelTitle={t("admin.title")}
      subtitle={`${viewer.profile.full_name} · ${t(`roles.${viewer.profile.role}`)}`}
      groups={groups}
      panels={panels}
      bottomNav={
        <MobileBottomNav lang={lang} context="admin" signedIn
          show={{ orders: can(role, permissions, "orders.view"), products: can(role, permissions, "products.view") }} />
      }
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
