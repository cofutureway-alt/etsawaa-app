import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { cookieLocale } from "~/lib/locale-preference.server";

/** Bare `/` redirects to the default locale (ar) — deep links keep their page. */
export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(`/${cookieLocale(request) ?? "ar"}`, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
