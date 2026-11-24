import { data, type ActionFunctionArgs } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { isLocale } from "~/lib/i18n/config";
import { sameOriginRequest, rememberLocale, LOCALE_COOKIE } from "~/lib/locale-preference.server";

export async function action({ request }: ActionFunctionArgs) {
  if (!sameOriginRequest(request)) return data({ ok: false }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!isLocale(body?.locale)) return data({ ok: false }, { status: 400 });
  const { client, headers } = createSupabaseServerClient(request);
  let saved = false;
  if (client) {
    const { data: session } = await client.auth.getSession();
    if (session.session) {
      saved = await rememberLocale(client, body.locale);
      if (!saved) return data({ ok: false }, { status: 503, headers });
    }
  }
  headers.append("Set-Cookie", `${LOCALE_COOKIE}=${body.locale}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
  headers.set("Cache-Control", "private, no-store");
  return data({ ok: true, accountSaved: saved }, { headers });
}
export const loader = () => data({ ok: false }, { status: 405 });
