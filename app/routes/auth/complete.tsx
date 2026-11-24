import { PhoneInput } from "~/components/phone/PhoneInput";
import type { Route } from "./+types/complete";
import { data, redirect, useActionData, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { useEffect, useMemo } from "react";
import type { z } from "zod";
import { completeProfileSchema } from "~/features/auth/schemas";
import { Button, Card, CardBody, Input } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { safeNext } from "~/lib/auth/next";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { MediaImg } from "~/components/catalog/MediaImg";
import { profileIsComplete } from "~/lib/profile-complete";
import { acceptanceEvidence, getLegalStatus } from "~/features/legal/legal.server";

/**
 * Complete your profile (F-12). Reached after a Google sign-in (name + photo
 * already copied from Google) and from the site-wide reminder banner. Asks
 * only for what is missing: name (pre-filled), two different phones, and the
 * Terms box when the current Terms are not accepted yet.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw redirect(`/${lang}/auth/login?error=db`);
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) throw redirect(`/${lang}/auth/login`);
  const next = safeNext(new URL(request.url).searchParams.get("next"), "");
  if (profileIsComplete(viewer.profile)) throw redirect(next || `/${lang}/account`);
  const legal = await getLegalStatus(client);
  return {
    lang,
    email: viewer.user.email ?? "",
    fullName: viewer.profile.full_name ?? "",
    avatar: viewer.profile.avatar_url ?? null,
    phone: viewer.profile.phone ?? "",
    phoneAlternate: viewer.profile.phone_alternate ?? "",
    needsTerms: !legal?.terms.accepted && Boolean(legal?.terms.version),
    termsVersion: legal?.terms.version ?? null,
  };
}

type CompleteActionData =
  | { ok: true; redirectTo: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<CompleteActionData>({ ok: false, formError: "db_not_connected" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data<CompleteActionData>({ ok: false, formError: "generic" }, { status: 401 });

  const legal = await getLegalStatus(client);
  const needsTerms = !legal?.terms.accepted && Boolean(legal?.terms.version);
  const form = await request.formData();
  const parsed = completeProfileSchema(needsTerms).safeParse({
    fullName: String(form.get("fullName") ?? ""),
    phone: String(form.get("phone") ?? ""),
    phoneAlternate: String(form.get("phoneAlternate") ?? ""),
    terms: form.get("terms") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return data<CompleteActionData>({ ok: false, fieldErrors });
  }

  if (needsTerms && legal?.terms.version) {
    const { ip, userAgent } = acceptanceEvidence(request);
    const { data: acc } = await client.rpc("fn_accept_legal", {
      p_kind: "terms", p_version: legal.terms.version, p_context: "signup", p_signature: null, p_ip: ip, p_user_agent: userAgent,
    });
    if (!(acc as { ok?: boolean } | null)?.ok) return data<CompleteActionData>({ ok: false, formError: "generic" });
  }
  const { error } = await client
    .from("profiles")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone, phone_alternate: parsed.data.phoneAlternate })
    .eq("id", viewer.user.id);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return data<CompleteActionData>({ ok: false, fieldErrors: { phone: "phone:taken" } });
    }
    return data<CompleteActionData>({ ok: false, formError: "generic" });
  }
  const next = safeNext(new URL(request.url).searchParams.get("next"), "");
  return { ok: true as const, redirectTo: next || `/${lang}/account` };
}

/** zod codes → readable text */
function useErrorText() {
  const { t } = useTranslation();
  return (code: string | undefined) => {
    if (!code) return undefined;
    if (code === "phone:equal") return t("checkout.errPhonesEqual");
    if (code === "phone:taken") return t("auth.complete.phoneTaken");
    if (code.startsWith("phone:")) return t("checkout.errPhone");
    if (code === "terms:required") return t("common.required");
    return t("auth.complete.nameError");
  };
}

/** Egyptian national display for the pre-filled phones (+2010… → 010…). */
const local = (e164: string) => (e164.startsWith("+20") ? `0${e164.slice(3)}` : e164);

export default function CompletePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const errText = useErrorText();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<CompleteActionData>();
  const navigate = useNavigate();
  const schema = useMemo(() => completeProfileSchema(loaderData.needsTerms), [loaderData.needsTerms]);

  const { register, handleSubmit, formState: { errors } } = useForm<
    z.input<typeof schema>, unknown, z.output<typeof schema>
  >({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: loaderData.fullName,
      phone: local(loaderData.phone),
      phoneAlternate: local(loaderData.phoneAlternate),
      terms: false,
    },
    mode: "onBlur",
  });

  const result = fetcher.data ?? actionData;
  const failed = result && !result.ok ? result : undefined;
  const fe = failed?.fieldErrors;

  useEffect(() => {
    if (result?.ok) navigate(result.redirectTo, { replace: true });
  }, [result, navigate]);

  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-5 p-6">
        <div className="flex items-center gap-3">
          {loaderData.avatar ? (
            <MediaImg path={loaderData.avatar} alt="" width={56} height={56} eager className="size-14 shrink-0 rounded-full border border-border object-cover" />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-text">{t("auth.complete.title")}</h1>
            <p className="text-sm text-text-muted">
              {t("auth.complete.subtitle")} <span className="num break-all">{loaderData.email}</span>
            </p>
          </div>
        </div>
        {failed?.formError ? (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm font-bold text-danger">
            {t("auth.errors.generic")}
          </div>
        ) : null}
        <fetcher.Form
          method="post"
          onSubmit={handleSubmit((_values, event) => {
            if (event?.target instanceof HTMLFormElement) fetcher.submit(event.target, { method: "post" });
          })}
          noValidate
          className="flex flex-col gap-4"
        >
          <Input
            label={t("profile.fullName")}
            autoComplete="name"
            required
            error={errText(errors.fullName?.message ?? fe?.fullName)}
            {...register("fullName")}
          />
          <PhoneInput
            label={t("auth.complete.phone")}
            autoComplete="tel"
            required
            error={errText(errors.phone?.message ?? fe?.phone)}
            {...register("phone")}
          />
          <PhoneInput
            label={t("auth.complete.phoneAlternate")}
            required
            hint={t("checkout.alternateHint")}
            error={errText(errors.phoneAlternate?.message ?? fe?.phoneAlternate)}
            {...register("phoneAlternate")}
          />
          {loaderData.needsTerms ? (
            <>
              <label className="flex items-start gap-2 text-sm text-text">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-action)]" {...register("terms")} />
                <span>
                  {t("auth.complete.terms")}{" "}
                  <a href={`/${loaderData.lang}/legal/terms`} target="_blank" rel="noreferrer" className="font-bold text-action hover:underline">
                    {t("auth.register.termsLink")}
                  </a>
                </span>
              </label>
              {errors.terms || fe?.terms ? (
                <p role="alert" className="-mt-2 text-xs font-bold text-danger">{t("common.required")}</p>
              ) : null}
            </>
          ) : null}
          <Button type="submit" size="lg" block loading={fetcher.state !== "idle"}>
            {t("auth.complete.submit")}
          </Button>
        </fetcher.Form>
      </CardBody>
    </Card>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
