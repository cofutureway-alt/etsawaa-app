import type { ReactNode } from "react";
import { useLocation, useNavigation } from "react-router";
import { SkeletonForm, SkeletonPage, SkeletonProductCard, SkeletonTable } from "~/components/ui/Skeleton";

/**
 * Renders a page-shaped skeleton while a client-side navigation is in flight.
 *
 * Why this exists: `HydrateFallback` is only consulted during the FIRST
 * hydration, when the router has no data for the initial match. React Router
 * hard-sets `renderFallback: false` on every completed navigation
 * (`completeNavigation` in the router source), and this app runs with
 * `ssr: true`, so the initial document always ships hydration data. The
 * result: 91 route files export `HydrateFallback` and a user never sees one.
 * The only pending UI today is a 2px bar.
 *
 * This wrapper sits once around `<Outlet/>` per layout and watches
 * `useNavigation()` instead — the same signal `Listing` already uses for its
 * product grid, generalised to every page.
 */
export function RoutePending({ children }: { children: ReactNode }) {
  const nav = useNavigation();
  const loc = useLocation();

  // Only a real route change counts: not a fetcher submit (buttons show their
  // own loading state), and not a same-path revalidation.
  const pending =
    nav.state === "loading" &&
    nav.location !== undefined &&
    nav.location.pathname !== loc.pathname;

  if (!pending) return <>{children}</>;
  return <PendingFor path={nav.location?.pathname ?? ""} />;
}

/** Pick the shape that matches the destination, so the swap is not a jump. */
function PendingFor({ path }: { path: string }) {
  if (path.includes("/oauth") || path.includes("/auth/")) return <SkeletonForm fields={4} />;
  if (/\/(admin|vendor)\b/.test(path)) {
    if (/\/(orders|customers|users|products|vendors|logs|reports|withdrawals|refunds)\b/.test(path)) {
      return <SkeletonTable rows={8} />;
    }
    if (/\/(settings|sections|profile|document-settings|media-settings)\b/.test(path)) {
      return <SkeletonForm fields={6} />;
    }
    return <SkeletonTable rows={6} />;
  }
  if (/\/product\//.test(path)) return <SkeletonProductCard />;
  if (/\/(products|category|search|brand|store|vendors|brands)\b/.test(path)) {
    return <SkeletonTable rows={6} />;
  }
  return <SkeletonPage />;
}
