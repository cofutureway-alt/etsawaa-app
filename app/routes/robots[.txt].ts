/**
 * robots.txt (G6): panels and auth are noindex; sitemap listed.
 * Sitemap itself is built in phase 08 (launch) — the pointer is already correct.
 */
export function loader() {
  const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /ar/admin",
    "Disallow: /en/admin",
    "Disallow: /ar/vendor",
    "Disallow: /en/vendor",
    "Disallow: /ar/account",
    "Disallow: /en/account",
    "Disallow: /ar/auth",
    "Disallow: /en/auth",
    "Disallow: /ar/ui",
    "Disallow: /en/ui",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
