import { redirect, type LoaderFunctionArgs } from "react-router";

/**
 * GET /:lang/sitemap-file — old link to the Word site map; the site map is a
 * page now (/:lang/site-map), so old links land there.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const lang = params.lang === "en" ? "en" : "ar";
  return redirect(`/${lang}/site-map`, { status: 301 });
}
