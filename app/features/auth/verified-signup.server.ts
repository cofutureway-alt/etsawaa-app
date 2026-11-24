import { codesAvailable } from "~/lib/messaging/otp.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { rememberLocale } from "~/lib/locale-preference.server";
import { getSiteUrl } from "~/lib/env.server";
import { getI18n, type Locale } from "~/lib/i18n/config";
import { sendEmail } from "~/lib/email/server";
import { safeNext } from "~/lib/auth/next";

/** Code and email-button verification complete exactly the same signup flow. */
export async function finishVerifiedSignup(client: SupabaseClient, lang: Locale, requestUrl: string, next: string | null): Promise<string> {
  await rememberLocale(client, lang);
  let target = safeNext(next, `/${lang}/account`);
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (user?.user_metadata?.signup_intent === "vendor") {
    const admin = getSupabaseAdminClient();
    if (admin) await admin.from("profiles").update({ role: "vendor" }).eq("id", user.id).eq("role", "customer");
    if (!next) target = `/${lang}/vendor/onboarding`;
  }
  if (user?.email) {
    const name = String(user.user_metadata?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    void sendEmail(getSupabaseAdminClient(), {
      to: user.email, templateKey: "welcome", locale: lang,
      variables: { name, site_name: getI18n(lang).t("app.name"), site_url: getSiteUrl(requestUrl) },
    }).catch(() => console.error("[verify] welcome delivery failed"));
  }
  // one more short step: confirm the phone by a code (skippable), while codes can be sent
  const admin = getSupabaseAdminClient();
  if (user && admin && (await codesAvailable(admin, "verify"))) {
    const { data: profile } = await admin.from("profiles").select("phone, phone_verified_at").eq("id", user.id).maybeSingle();
    if (profile?.phone && !profile.phone_verified_at) return `/${lang}/auth/phone?next=${encodeURIComponent(target)}`;
  }
  return target;
}
