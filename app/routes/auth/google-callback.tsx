import { useEffect } from "react";
import type { Route } from "./+types/google-callback";
import { redirect, useNavigate } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { rememberLocale } from "~/lib/locale-preference.server";
import { safeNext } from "~/lib/auth/next";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { syncGoogleProfile } from "~/features/auth/google-profile.server";
import { profileIsComplete } from "~/lib/profile-complete";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return redirect(`/${lang}/auth/login?error=db`, { headers });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  // "Link your Google account" round-trip from the profile page
  if (url.searchParams.get("link") === "1") {
    const back = `/${lang}/account/profile`;
    if (oauthError) {
      const reason = /already|exists|linked/i.test(oauthError) ? "taken" : "cancelled";
      return redirect(`${back}?google=${reason}`, { headers });
    }
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) return redirect(`${back}?google=failed`, { headers });
    }
    const { data: linked } = await client.auth.getUser();
    const me = linked?.user;
    if (!me) return redirect(`/${lang}/auth/login`, { headers });
    const google = me.identities?.find((i: { provider: string }) => i.provider === "google");
    if (!google) return redirect(`${back}?google=failed`, { headers });
    const googleEmail = String((google.identity_data as Record<string, unknown> | undefined)?.email ?? "").toLowerCase();
    if (!me.email || googleEmail !== me.email.toLowerCase()) {
      // only the Google account with the same email may be attached
      await client.auth.unlinkIdentity(google);
      return redirect(`${back}?google=mismatch`, { headers });
    }
    await syncGoogleProfile(client, me);
    return redirect(`${back}?google=linked`, { headers });
  }
  if (oauthError) {
    // User canceled the popup or provider refused — return calmly (US-03 edge).
    return redirect(`/${lang}/auth/login?error=oauth_cancelled`, { headers });
  }
  if (!code) return redirect(`/${lang}/auth/login?error=oauth_cancelled`, { headers });

  // exchangeCodeForSession mints the session cookies into `headers` — they must
  // ride on every redirect below or the user lands signed-out.
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return redirect(`/${lang}/auth/login?error=oauth_failed`, { headers });

  // F-12 rule: new Google users must add their phones + accept terms once.
  const { data: userData } = await client.auth.getUser();
  const user = userData?.user;
  if (!user) return redirect(`/${lang}/auth/login?error=oauth_failed`, { headers });
  // name + photo come from Google so the person never types them
  await syncGoogleProfile(client, user);
  await rememberLocale(client, lang);
  const { data: profile } = await client
    .from("profiles")
    .select("full_name, phone, phone_alternate")
    .eq("id", user.id)
    .single();
  const next = safeNext(url.searchParams.get("next"), "");
  if (!profileIsComplete(profile)) {
    return redirect(
      `/${lang}/auth/complete${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      { headers },
    );
  }
  return redirect(next || `/${lang}/account`, { headers });
}

/** The loader always redirects; this screen only shows during hydration edge cases. */
export default function GoogleCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
