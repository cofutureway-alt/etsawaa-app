import { useEffect } from "react";
import type { Route } from "./+types/google-callback";
import { redirect, useNavigate } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { SkeletonPage } from "~/components/ui/Skeleton";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return redirect(`/${lang}/auth/login?error=db`);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError) {
    // User canceled the popup or provider refused — return calmly (US-03 edge).
    return redirect(`/${lang}/auth/login?error=oauth_cancelled`);
  }
  if (!code) return redirect(`/${lang}/auth/login?error=oauth_cancelled`);

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return redirect(`/${lang}/auth/login?error=oauth_failed`);

  // F-12 rule: new Google users must add a phone + accept terms once.
  const { data: userData } = await client.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return redirect(`/${lang}/auth/login?error=oauth_failed`);
  const { data: profile } = await client
    .from("profiles")
    .select("phone")
    .eq("id", userId)
    .single();
  const next = url.searchParams.get("next");
  if (!profile?.phone) {
    return redirect(`/${lang}/auth/complete${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  return redirect(next && next.startsWith("/") ? next : `/${lang}/account`);
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
