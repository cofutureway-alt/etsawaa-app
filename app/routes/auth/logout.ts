import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";

/** POST /:lang/auth/logout — real Supabase signOut + cookie clearing. */
export async function action({ request, params }: ActionFunctionArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (client) {
    await client.auth.signOut();
  }
  return redirect(`/${lang}`, { headers });
}

export async function loader() {
  // Logout is POST-only (CSRF-safe).
  throw new Response("Method Not Allowed", { status: 405 });
}
