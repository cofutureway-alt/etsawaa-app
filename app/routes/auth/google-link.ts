import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";

/**
 * POST /auth/google/link — "Link your Google account" from the profile.
 * Starts Supabase linkIdentity (manual linking enabled on the auth server).
 * login_hint pre-selects the Google account with the SAME email; the
 * callback (link=1) refuses and unlinks any Google account whose email
 * differs from the Etsawaa account's email.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const lang = requireLang(params);
  const back = `/${lang}/account/profile`;
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return redirect(`${back}?google=failed`, { headers });
  const { data: userData } = await client.auth.getUser();
  const user = userData?.user;
  if (!user) return redirect(`/${lang}/auth/login?next=${encodeURIComponent(back)}`, { headers });
  if (user.identities?.some((i: { provider: string }) => i.provider === "google")) return redirect(`${back}?google=linked`, { headers });

  const url = new URL(request.url);
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? `${url.protocol}//${url.host}`;
  const { data, error } = await client.auth.linkIdentity({
    provider: "google",
    options: {
      redirectTo: `${siteUrl}/${lang}/auth/callback/google?link=1`,
      skipBrowserRedirect: true,
      queryParams: user.email ? { login_hint: user.email, prompt: "select_account" } : { prompt: "select_account" },
    },
  });
  if (error || !data?.url) return redirect(`${back}?google=unavailable`, { headers });
  throw redirect(data.url, { status: 302, headers });
}
