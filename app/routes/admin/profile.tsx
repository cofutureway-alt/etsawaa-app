import { data, redirect } from "react-router";
import type { Route } from "./+types/profile";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * A-39 — /admin/profile: the admin/staff section of the SHARED profile page
 * (AGENT §30 — one implementation at /account/profile: name/phones/password/
 * avatar; staff edits only their own profile because the account page is
 * strictly self-scoped). This route lands admins/staff there (permissions
 * respected: requirePanelAccess("admin") runs first).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  throw redirect(`/${lang}/account/profile`);
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
