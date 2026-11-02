import type { Route } from "./+types/register";
import { Link, data, redirect, useActionData, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { useEffect } from "react";
import type { z } from "zod";
import { registerSchema, passwordStrengthScore } from "~/features/auth/schemas";
import { Button, Card, CardBody, Input, AlertIcon } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { sendEmail } from "~/lib/email/server";
import { SkeletonPage } from "~/components/ui/Skeleton";


export async function loader({ params, request }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const intent = new URL(request.url).searchParams.get("intent") === "vendor" ? "vendor" : "customer";
  return { lang, intent };
}

/** Success redirects server-side; the action only ever returns failures. */
type RegisterActionData =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Partial<Record<keyof z.output<typeof registerSchema>, string>>;
    };

/**
 * POST /auth/register (F-09): real Supabase signUp with metadata
 * (full_name/phone/locale consumed by the handle_new_user trigger), then the
 * auth server emails the 6-digit signup OTP. A welcome email is attempted
 * through the app's provider (F-18) — failures are logged, never faked.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const isDocumentPost = request.headers.get("sec-fetch-mode") === "navigate";
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    return data<RegisterActionData>({ ok: false, formError: "db_not_connected" }, { status: 503 });
  }
  const form = await request.formData();
  // Vendor funnel (phase 03): /sell → register?intent=vendor — the metadata
  // rides into the auth user and drives the verify-step role promotion.
  const vendorIntent = new URL(request.url).searchParams.get("intent") === "vendor";
  const parsed = registerSchema.safeParse({
    firstName: String(form.get("firstName") ?? ""),
    lastName: String(form.get("lastName") ?? ""),
    email: String(form.get("email") ?? ""),
    phone: String(form.get("phone") ?? ""),
    password: String(form.get("password") ?? ""),
    confirmPassword: String(form.get("confirmPassword") ?? ""),
    terms: form.get("terms") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof z.output<typeof registerSchema>, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        (fieldErrors as Record<string, string>)[key] = issue.message;
      }
    }
    return data<RegisterActionData>({ ok: false, fieldErrors });
  }

  const input = parsed.data;
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  const { error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        full_name: `${input.firstName} ${input.lastName}`.trim(),
        phone_e164: input.phone,
        locale: lang,
        terms_accepted_at: new Date().toISOString(),
        ...(vendorIntent ? { signup_intent: "vendor" } : {}),
      },
      emailRedirectTo: `${siteUrl}/${lang}/auth/verify?email=${encodeURIComponent(input.email)}`,
    },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return data<RegisterActionData>({ ok: false, formError: vendorIntent ? "email_exists_vendor" : "email_exists" });
    }
    return data<RegisterActionData>({ ok: false, formError: "generic" });
  }

  // Welcome email via the real provider (no-op success if unconfigured).
  const admin = getSupabaseAdminClient();
  void sendEmail(admin, {
    to: input.email,
    templateKey: "welcome",
    locale: lang === "en" ? "en" : "ar",
    variables: {
      name: input.firstName,
      site_name: lang === "ar" ? "اتسوء" : "Etsawaa",
      site_url: siteUrl,
    },
  }).catch((cause) => console.error("[register] welcome email failed", cause));

  const redirectTo = `/${lang}/auth/verify?email=${encodeURIComponent(input.email)}${
    vendorIntent ? `&next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}` : ""
  }`;
  if (isDocumentPost) throw redirect(redirectTo);
  return { ok: true as const, redirectTo };
}

const FORM_ERRORS: Record<string, string> = {
  email_exists: "auth.register.emailExists",
  email_exists_vendor: "vendorOnboarding.register.emailExists",
  db_not_connected: "auth.errors.generic",
  generic: "auth.errors.generic",
};

const STRENGTH_KEYS = [
  "auth.register.strength.0",
  "auth.register.strength.1",
  "auth.register.strength.2",
  "auth.register.strength.3",
  "auth.register.strength.4",
] as const;

const STRENGTH_COLORS = ["bg-border-strong", "bg-danger", "bg-warning", "bg-success", "bg-success-strong"] as const;

export default function RegisterPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const isVendor = loaderData.intent === "vendor";
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<RegisterActionData>();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<z.input<typeof registerSchema>, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", password: "", confirmPassword: "", terms: false },
    mode: "onBlur", // inline validation on blur (ui-ux-pro-max: Inline Validation)
  });

  const result = fetcher.data ?? actionData;
  const failed = result && !result.ok ? result : undefined;

  useEffect(() => {
    if (result?.ok) navigate(result.redirectTo, { replace: true });
  }, [result, navigate]);

  const password = watch("password") ?? "";
  const strength = passwordStrengthScore(password);

  return (
    <Card className="w-full max-w-lg">
      <CardBody className="flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-lg font-extrabold text-text">
            {isVendor ? t("vendorOnboarding.register.title") : t("auth.register.title")}
          </h1>
          <p className="text-sm text-text-muted">
            {isVendor ? t("vendorOnboarding.register.subtitle") : t("auth.register.subtitle")}
          </p>
        </div>

        {failed?.formError ? (
          <div role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
            <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="font-bold">{t(FORM_ERRORS[failed.formError] ?? "auth.errors.generic")}</span>
          </div>
        ) : null}

        <fetcher.Form
          method="post"
          onSubmit={handleSubmit((_values, event) => {
            if (event?.target instanceof HTMLFormElement) {
              fetcher.submit(event.target, { method: "post" });
            }
          })}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t("auth.register.firstName")} autoComplete="given-name" error={errors.firstName?.message ?? failed?.fieldErrors?.firstName} {...register("firstName")} />
            <Input label={t("auth.register.lastName")} autoComplete="family-name" error={errors.lastName?.message ?? failed?.fieldErrors?.lastName} {...register("lastName")} />
          </div>
          <Input label={t("auth.register.email")} type="email" inputMode="email" autoComplete="email" error={errors.email?.message ?? failed?.fieldErrors?.email} {...register("email")} />
          <Input
            label={t("auth.register.phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            hint={t("auth.register.phoneHint")}
            dir="ltr"
            inputClassName="text-start"
            error={errors.phone?.message ?? failed?.fieldErrors?.phone}
            {...register("phone")}
          />
          <div className="flex flex-col gap-1.5">
            <Input
              label={t("auth.register.password")}
              type="password"
              showPasswordToggle
              autoComplete="new-password"
              hint={t("auth.register.passwordHint")}
              error={errors.password?.message ?? failed?.fieldErrors?.password}
              {...register("password")}
            />
            {password ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((index) => (
                    <span key={index} className={`h-1 flex-1 rounded-full ${index < strength ? STRENGTH_COLORS[strength] : "bg-border"}`} />
                  ))}
                </div>
                <span className="text-xs text-text-muted">{t(STRENGTH_KEYS[strength])}</span>
              </div>
            ) : null}
          </div>
          <Input
            label={t("auth.register.confirmPassword")}
            type="password"
            showPasswordToggle
            autoComplete="new-password"
            error={errors.confirmPassword?.message ?? failed?.fieldErrors?.confirmPassword}
            {...register("confirmPassword")}
          />
          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-2 text-start text-sm text-text">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" {...register("terms")} />
              <span className="min-w-0 leading-relaxed">
                {t("auth.register.terms")}{" "}
                <Link to={`/${lang}/p/terms`} className="font-bold text-action hover:underline">
                  {t("auth.register.termsLink")}
                </Link>{" "}
                {t("auth.register.and")}{" "}
                <Link to={`/${lang}/p/privacy`} className="font-bold text-action hover:underline">
                  {t("auth.register.privacyLink")}
                </Link>
              </span>
            </label>
            {errors.terms || failed?.fieldErrors?.terms ? (
              <p role="alert" className="text-xs font-bold text-danger">
                {t("auth.register.terms")} — {t("common.required")}
              </p>
            ) : null}
          </div>
          <Button type="submit" size="lg" block loading={fetcher.state !== "idle"}>
            {t("auth.register.submit")}
          </Button>
        </fetcher.Form>

        <p className="text-center text-sm text-text-muted">
          {t("auth.register.haveAccount")}{" "}
          <Link to={`/${lang}/auth/login`} className="font-bold text-action hover:underline">
            {t("auth.register.signIn")}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
