import type { Route } from "./+types/media";
import { useTranslation } from "react-i18next";
import { MediaLibraryCore } from "~/features/media/components/media-ui";
import { parseMediaSettings } from "~/lib/media.shared";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Owner decision (phase 02): the media library is a vendor/admin tool.
 * Customers never see it — they upload directly (native device picker, e.g.
 * a future avatar change), not through this library.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  return {
    lang,
    uid: viewer.user.id,
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

/** /vendor/media — per-user library (vendor panel; admins use /admin/media). */
export default function AccountMedia({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold text-text">{t("media.title")}</h1>
      <MediaLibraryCore
        settings={loaderData.media}
        uid={loaderData.uid}
        supabaseUrl={loaderData.supabaseUrl}
      />
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
