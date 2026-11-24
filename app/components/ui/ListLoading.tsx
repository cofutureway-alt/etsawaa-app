import { useLocation, useNavigation } from "react-router";
import { SkeletonTable } from "./Skeleton";

/**
 * True while the CURRENT page reloads for new search params (a filter tab,
 * status chip, search box, sort or page change). Navigations to another page
 * are left to the global route loader.
 */
export function useListLoading(): boolean {
  const navigation = useNavigation();
  const location = useLocation();
  return (
    navigation.state === "loading" &&
    navigation.location?.pathname === location.pathname &&
    navigation.location.search !== location.search
  );
}

/** Table-shaped skeleton shown in place of a list while its filter loads. */
export function ListSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-3" role="status" aria-live="polite">
      <SkeletonTable rows={rows} cols={cols} />
    </div>
  );
}
