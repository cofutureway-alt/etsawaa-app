/**
 * Catch-all for URLs no route matches (e.g. /product/x without /ar or /en).
 * Matching it makes the root loader run, and the root loader redirects
 * unprefixed links to their /ar or /en page; anything else is a real 404
 * rendered by the root error boundary.
 */
export async function loader() {
  throw new Response("Not Found", { status: 404 });
}

/** never rendered: the loader always throws (redirect or 404) */
export default function NotFound() {
  return null;
}
