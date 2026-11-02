import { redirect } from "react-router";
import { isAuthSessionMissingError, AuthApiError } from "@supabase/auth-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { canAccessPanel, isRole, type Role } from "~/lib/permissions";

export interface ProfileRow {
  id: string;
  full_name: string;
  role: Role;
  status: "active" | "blocked";
  locale: "ar" | "en";
  phone: string | null;
  /** H-21: default alternate phone prefilled into address forms. */
  phone_alternate: string | null;
  avatar_url: string | null;
}

export interface Viewer {
  user: User;
  profile: ProfileRow;
}

/**
 * Resolve the current viewer: validated JWT + profile row (RLS-scoped).
 * Returns null for guests. A signed-in user whose profile row is missing
 * (bootstrap pending) is treated as unauthenticated for panel purposes.
 *
 * H-05 session contract: the ONLY errors that count as "signed out" are
 *   - AuthSessionMissingError (no session at all — a guest), and
 *   - AuthApiError with a definitive auth status 400/401/403 (BAD_JWT,
 *     invalid refresh token…).
 * Network failures / 5xx / aborted refreshes (AuthRetryableFetchError and
 * anything else) return the reason in `sessionStale` and the CALLER decides;
 * requirePanelAccess treats them as "cannot verify right now" → redirect to
 * login WITH returnTo instead of a hard sign-out, so a transient Supabase
 * blip never logs an active user out.
 */
export interface GetViewerResult {
  viewer: Viewer | null;
  /** true when getUser() failed for a NON-auth reason (network/5xx) — the
   * session cookies may still be perfectly valid. */
  sessionStale?: boolean;
}

export async function getViewer(client: SupabaseClient): Promise<GetViewerResult | null> {
  const { data: userData, error } = await client.auth.getUser();
  if (error) {
    if (isAuthSessionMissingError(error)) return { viewer: null };
    if (
      error instanceof AuthApiError &&
      (error.status === 400 || error.status === 401 || error.status === 403)
    ) {
      // definitively invalid token (expired & refresh refused, bad JWT…)
      return { viewer: null };
    }
    // transient: never treat as signed-out
    return { viewer: null, sessionStale: true };
  }
  if (!userData?.user) return { viewer: null };
  const { data: profile } = await client
    .from("profiles")
    .select("id, full_name, role, status, locale, phone, phone_alternate, avatar_url")
    .eq("id", userData.user.id)
    .single();
  if (!profile || !isRole(profile.role)) return { viewer: null };
  return { viewer: { user: userData.user, profile: profile as ProfileRow } };
}

const PANEL_PATHS = { admin: "admin", vendor: "vendor", account: "account" } as const;

/**
 * Guard a panel route (F-13): unauthenticated → redirect to login with a
 * `next` intent; authenticated without panel access → 403 Response rendered
 * by the root ErrorBoundary (US-09: staff without permission sees a 403 page).
 * Runs server-side, so protected UI never flashes.
 */
export async function requirePanelAccess(
  client: SupabaseClient,
  lang: string,
  panel: keyof typeof PANEL_PATHS,
  request: Request,
): Promise<Viewer> {
  const result = await getViewer(client);
  const viewer = result?.viewer ?? null;
  if (!viewer) {
    // Session STALE (network/5xx path): redirect preserves the cookies and the
    // next request retries verification — no destructive sign-out happened.
    const url = new URL(request.url);
    const next = url.pathname + url.search;
    throw redirect(`/${lang}/auth/login?next=${encodeURIComponent(next)}${result?.sessionStale ? "&stale=1" : ""}`);
  }
  if (viewer.profile.status === "blocked") {
    throw redirect(`/${lang}/auth/login?error=blocked`);
  }
  if (!canAccessPanel(viewer.profile.role, panel)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return viewer;
}
