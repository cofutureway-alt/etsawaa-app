import { redirect } from "react-router";

/** Bare `/` redirects to the default locale (ar) — deep links keep their page. */
export async function loader() {
  throw redirect("/ar");
}
