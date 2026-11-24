import { redirect } from "react-router";
import { isAuthSessionMissingError, AuthApiError } from "@supabase/auth-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { canAccessPanel, canAny, isRole, type Role } from "~/lib/permissions";
import { adminRoutePerms, firstAdminPath } from "~/features/admin/nav";
import type { VendorRow } from "~/features/vendor/config";
import { isSharedClient } from "~/lib/supabase/request-scope";
import { markSettled, peekSettled, scoped } from "~/lib/supabase/request-scope";
import { verifyAccessToken, type AccessClaims } from "~/lib/auth/jwt.server";

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
  /** profile cover strip (profiles.banner_url) — rendered by the account card */
  banner_url?: string | null;
}

export interface Viewer {
  user: User;
  profile: ProfileRow;
  /** Effective permission list (admin → ["*"]); loaded for the admin panel only. */
  permissions?: string[];
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

type LegalStatus = { terms?: { accepted?: boolean }; seller_agreement?: { accepted?: boolean; required?: boolean } };

/** The signed-in person's store, as fn_viewer_context returns it. */
export type ViewerVendor = VendorRow & { suspension_reason: string | null; needs_changes: number };

/**
 * Everything the app needs about the signed-in person, from ONE database
 * call (fn_viewer_context): profile, legal status, effective permissions,
 * own store (+ products waiting for changes, suspension reason) and the
 * unread notification count. Resolved once per request and shared by the
 * root/layout/page loaders (request-scope.server) — so a panel navigation
 * costs 2 round-trips for identity (auth + context) instead of ~8.
 */
export interface ViewerContext {
  user: User;
  profile: ProfileRow;
  legal: LegalStatus | null;
  permissions: string[];
  vendor: ViewerVendor | null;
  unread: number;
}

interface ContextResult { ctx: ViewerContext | null; sessionStale?: boolean }

export function getViewerContext(client: SupabaseClient): Promise<ContextResult> {
  return scoped(client, "viewer-context", async (): Promise<ContextResult> => {
    // fast path: the session cookie's access token, verified locally (no
    // GoTrue round-trip). getSession() refreshes an expired token first.
    const { data: sess } = await client.auth.getSession();
    if (!sess.session) return { ctx: null };
    const claims = verifyAccessToken(sess.session.access_token);
    const { data: userData, error } = claims
      ? { data: { user: userFromClaims(claims) }, error: null }
      : await client.auth.getUser();
    if (error) {
      if (isAuthSessionMissingError(error)) return { ctx: null };
      if (
        error instanceof AuthApiError &&
        (error.status === 400 || error.status === 401 || error.status === 403)
      ) {
        // definitively invalid token (expired & refresh refused, bad JWT…)
        return { ctx: null };
      }
      // transient: never treat as signed-out
      return { ctx: null, sessionStale: true };
    }
    if (!userData?.user) return { ctx: null };
    const { data, error: ctxError } = await client.rpc("fn_viewer_context");
    if (ctxError) return { ctx: null, sessionStale: true };
    const raw = data as { profile?: ProfileRow; legal?: LegalStatus | null; permissions?: unknown; vendor?: ViewerVendor | null; unread?: number } | null;
    if (!raw?.profile || !isRole(raw.profile.role)) return { ctx: null };
    const ctx: ViewerContext = {
      user: userData.user,
      profile: raw.profile,
      legal: raw.legal ?? null,
      permissions: Array.isArray(raw.permissions) ? raw.permissions.filter((x): x is string => typeof x === "string") : [],
      vendor: raw.vendor ?? null,
      unread: Number(raw.unread ?? 0),
    };
    markSettled(client, "viewer-context", ctx);
    return { ctx };
  }, isSharedClient(client));
}

/** The fields of a Supabase User the app reads (id, email…), from verified claims. */
function userFromClaims(c: AccessClaims): User {
  return {
    id: c.sub,
    email: c.email,
    phone: c.phone,
    role: c.role,
    aud: Array.isArray(c.aud) ? c.aud[0] ?? "authenticated" : c.aud ?? "authenticated",
    app_metadata: (c.app_metadata ?? {}) as User["app_metadata"],
    user_metadata: c.user_metadata ?? {},
    created_at: "",
  } as User;
}

/** Already-resolved context of this request, without waiting (undefined when not loaded yet). */
export function peekViewerContext(client: SupabaseClient): ViewerContext | undefined {
  return isSharedClient(client) ? peekSettled<ViewerContext>(client, "viewer-context") : undefined;
}

export async function getViewer(client: SupabaseClient): Promise<GetViewerResult | null> {
  const { ctx, sessionStale } = await getViewerContext(client);
  if (!ctx) return sessionStale ? { viewer: null, sessionStale } : { viewer: null };
  // a fresh object per caller: requirePanelAccess attaches `permissions` to it
  return { viewer: { user: ctx.user, profile: ctx.profile } };
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
  const { ctx, sessionStale } = await getViewerContext(client);
  const viewer: Viewer | null = ctx ? { user: ctx.user, profile: ctx.profile } : null;
  const result = { sessionStale };
  if (!viewer || !ctx) {
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
  legalGate(ctx.legal, lang, request, panel === "vendor");
  if (panel === "admin") {
    viewer.permissions = ctx.permissions;
    guardAdminPath(viewer, lang, request);
  }
  return viewer;
}

/**
 * Route-level permission gate for /:lang/admin/* — every admin loader and
 * action goes through requirePanelAccess, so this one check covers them all
 * (table: features/admin/nav.ts). Staff without the dashboard permission are
 * sent to the first page they may open instead of a 403.
 */
function guardAdminPath(viewer: Viewer, lang: string, request: Request): void {
  const prefix = `/${lang}/admin`;
  const { pathname } = new URL(request.url);
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return;
  const sub = pathname.slice(prefix.length).replace(/\.data$/, "");
  const perms = adminRoutePerms(sub);
  const role = viewer.profile.role;
  const list = viewer.permissions ?? [];
  if (perms.length === 0 || canAny(role, list, perms)) return;
  if (sub.replace(/\//g, "") === "" && request.method === "GET") {
    throw redirect(`${prefix}/${firstAdminPath(role, list)}`);
  }
  throw new Response("Forbidden", { status: 403 });
}

/** Effective permissions of the signed-in user (fn_my_permissions). */
export async function loadMyPermissions(client: SupabaseClient): Promise<string[]> {
  const { ctx } = await getViewerContext(client);
  return ctx?.permissions ?? [];
}

/**
 * 403 unless the viewer holds any of `required` (admin always passes).
 * Use after requirePanelAccess(…, "admin", …), which loads the permissions.
 */
export function requirePermission(viewer: Viewer, required: string | readonly string[]): void {
  const list = typeof required === "string" ? [required] : required;
  if (list.length === 0) return;
  if (!canAny(viewer.profile.role, viewer.permissions ?? [], list)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

/**
 * Terms & Conditions are mandatory for every signed-in user and the seller
 * agreement for every seller past onboarding: until the CURRENT version is
 * accepted (new account via Google, older account, or a newly published
 * version), every panel page sends the user to the acceptance page and back.
 */
export async function requireLegalAccepted(client: SupabaseClient, lang: string, request: Request, seller = false): Promise<void> {
  const { ctx } = await getViewerContext(client);
  legalGate(ctx?.legal ?? null, lang, request, seller);
}

function legalGate(status: LegalStatus | null, lang: string, request: Request, seller: boolean): void {
  if (!status) return;
  const needTerms = status.terms?.accepted === false;
  const needSeller = seller && status.seller_agreement?.required === true && status.seller_agreement.accepted === false;
  if (!needTerms && !needSeller) return;
  const url = new URL(request.url);
  throw redirect(`/${lang}/legal/accept?next=${encodeURIComponent(url.pathname + url.search)}`);
}
