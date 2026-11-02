import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { safeNext } from "~/lib/auth/next";

/**
 * POST /auth/google (F-12): starts the real Supabase Google OAuth flow.
 * Google credentials are configured in the Supabase dashboard; if the
 * provider is not enabled the API returns an error which we surface
 * verbatim via the login page (never a fake callback).
 *
 * `headers` MUST be forwarded: @supabase/ssr runs the PKCE flow, and
 * signInWithOAuth writes the `*-code-verifier` cookie through setAll. Drop
 * that Set-Cookie and exchangeCodeForSession in the callback throws
 * AuthPKCECodeVerifierMissingError.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) {
    return redirect(`/${lang}/auth/login?error=db`, { headers });
  }
  const form = await request.formData();
  const next = safeNext(String(form.get("next") ?? ""), "");
  const url = new URL(request.url);
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? `${url.protocol}//${url.host}`;
  const redirectTo = `${siteUrl}/${lang}/auth/callback/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true, // server-side flow: we redirect ourselves
    },
  });
  if (error || !data?.url) {
    return redirect(`/${lang}/auth/login?error=oauth_unavailable`, { headers });
  }
  throw redirect(data.url, { status: 302, headers });
}
