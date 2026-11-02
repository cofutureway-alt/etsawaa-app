import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

/**
 * GET /api/media?path=… — same-origin image proxy for the storefront.
 *
 * Why: the LCP image (hero banner, product photos) lives on the storage
 * origin — a separate cloud host whose DNS+TLS lands on the visitor's
 * critical path. Proxying same-origin with an in-process cache (warmed
 * during SSR) puts the bytes one localhost hop away.
 *
 * Only PUBLIC media objects are reachable: paths are validated against the
 * public-bucket shape and fetched from the public object URL server-side.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  // public bucket paths look like u/{uuid}/{uuid}.{ext} — anything else is rejected
  if (!path || !/^u\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/.test(path)) {
    return data({ ok: false, reason: "bad_path" }, { status: 400 });
  }
  const { loadMedia } = await import("~/lib/media-cache.server");
  const resolved = await loadMedia(path);
  if (!resolved) {
    return data({ ok: false, reason: "not_found" }, { status: 404 });
  }
  return new Response(resolved.bytes, {
    headers: {
      "Content-Type": resolved.type,
      // object paths are UUIDs — content at a path never changes
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
