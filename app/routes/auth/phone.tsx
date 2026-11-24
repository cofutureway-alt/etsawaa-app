import { useCallback } from "react";
import { data, Link, redirect, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/phone";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { safeNext } from "~/lib/auth/next";
import { Card, CardBody } from "~/components/ui";
import { PhoneCodeBox } from "~/components/phone/PhoneCodeBox";
import { SkeletonPage } from "~/components/ui/Skeleton";

/**
 * /auth/phone — right after sign-up: confirm the account's phone with a
 * code by WhatsApp or SMS. "Later" is always there; the number is then
 * confirmed once at the first order instead.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const next = safeNext(new URL(request.url).searchParams.get("next"), `/${lang}/account`);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) throw redirect(next);
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) throw redirect(`/${lang}/auth/login`, { headers });
  const { data: profile } = await client.from("profiles").select("phone, phone_verified_at").eq("id", viewer.user.id).maybeSingle();
  if (!profile?.phone || profile.phone_verified_at) throw redirect(next, { headers });
  return data({ lang, next, phone: profile.phone as string }, { headers });
}

export function meta() {
  return [{ name: "robots", content: "noindex" }];
}

export default function PhoneStep({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { lang, next, phone } = loaderData;
  const done = useCallback(() => { setTimeout(() => navigate(next, { replace: true }), 900); }, [navigate, next]);
  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-action">{t("phoneCode.stepLabel")}</span>
          <h1 className="text-lg font-extrabold text-text">{t("phoneCode.title")}</h1>
          <p className="text-sm text-text-muted">{t("phoneCode.lead")}</p>
        </div>
        <PhoneCodeBox phone={phone} purpose="verify" lang={lang} onVerified={done} />
        <Link to={next} replace className="text-center text-sm font-bold text-text-muted hover:text-action">
          {t("phoneCode.later")}
        </Link>
      </CardBody>
    </Card>
  );
}

export function HydrateFallback() {
  return <SkeletonPage />;
}
