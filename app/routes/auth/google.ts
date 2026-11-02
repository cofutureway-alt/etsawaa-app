import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";

/**
 * POST /auth/google (F-12): starts the real Supabase Google OAuth flow.
 * Google credentials are configured in the Supabase dashboard; if the
 * provider is not enabled the API returns an error which we surface
 * verbatim via the login page (never a fake callback).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    return redirect(`/${lang}/auth/login?error=db`);
  }
  const form = await request.formData();
  const next = String(form.get("next") ?? "");
  const url = new URL(request.url);
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? `${url.protocol}//${url.host}`;
  const redirectTo = `${siteUrl}/${lang}/auth/callback/google${next && next.startsWith("/") ? `?next=${encodeURIComponent(next)}` : ""}`;

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true, // server-side flow: we redirect ourselves
    },
  });
  if (error || !data?.url) {
    return redirect(`/${lang}/auth/login?error=oauth_unavailable`);
  }
  throw redirect(data.url, 302);
}
