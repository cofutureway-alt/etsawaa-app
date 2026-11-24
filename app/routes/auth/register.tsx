import { PhoneInput } from "~/components/phone/PhoneInput";
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
import { SkeletonPage } from "~/components/ui/Skeleton";
import { GoogleButton, OrDivider } from "~/components/auth/GoogleButton";
import { acceptanceEvidence, getLegalDoc } from "~/features/legal/legal.server";
import { getViewerContext } from "~/lib/auth/guards";


export async function loader({ params, request }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const intent = new URL(request.url).searchParams.get("intent") === "vendor" ? "vendor" : "customer";
  // the exact Terms version shown here is the one recorded on sign-up
  const { client } = createSupabaseServerClient(request);
  // Already signed in: a customer who wants to sell goes straight to the store
  // set-up (it turns the account into a seller on submit); nobody needs a second account.
  if (client) {
    const { ctx } = await getViewerContext(client);
    if (ctx) throw redirect(intent === "vendor" ? `/${lang}/vendor/onboarding` : `/${lang}/account`);
  }
  const terms = client ? await getLegalDoc(client, "terms") : null;
  return { lang, intent, termsVersion: terms?.version ?? null };
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
  // acceptance is mandatory and must be of the CURRENT version
  const currentTerms = await getLegalDoc(client, "terms");
  if (parsed.success && currentTerms && String(form.get("terms_version") ?? "") !== currentTerms.version) {
    return data<RegisterActionData>({ ok: false, formError: "terms_changed" });
  }
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
  // a number on a CONFIRMED account can't be reused (unconfirmed holders are released by the sign-up trigger)
  const taken = await client.rpc("fn_signup_phone_taken", { p_phone: input.phone });
  if (taken.data === true) {
    return data<RegisterActionData>({ ok: false, fieldErrors: { phone: "phone:taken" } });
  }
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  const { data: signed, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        full_name: `${input.firstName} ${input.lastName}`.trim(),
        phone_e164: input.phone,
        locale: lang,
        terms_accepted_at: new Date().toISOString(),
        // recorded in legal_acceptances by the sign-up trigger (version + evidence)
        ...(currentTerms ? { terms_version: currentTerms.version, terms_ip: acceptanceEvidence(request).ip, terms_ua: acceptanceEvidence(request).userAgent } : {}),
        ...(vendorIntent ? { signup_intent: "vendor" } : {}),
      },
      emailRedirectTo: `${siteUrl}/${lang}/auth/verify?email=${encodeURIComponent(input.email)}`,
    },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return data<RegisterActionData>({ ok: false, formError: vendorIntent ? "email_exists_vendor" : "email_exists" });
    }
    // Signing up again with an address that is still waiting for its code: the
    // auth server re-sends the code, but at most once a minute — inside that
    // minute a code was JUST sent, so go to the code screen instead of failing.
    if (/security purposes|only request this after/i.test(error.message)) {
      const again = `/${lang}/auth/verify?email=${encodeURIComponent(input.email)}&sent=${Date.now()}${
        vendorIntent ? `&next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}` : ""
      }`;
      if (isDocumentPost) throw redirect(again);
      return { ok: true as const, redirectTo: again };
    }
    // too many codes asked for from this server in a short time
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      return data<RegisterActionData>({ ok: false, formError: "rate_limited" });
    }
    console.error("[register] signUp failed", { status: error.status, code: (error as { code?: string }).code, message: error.message });
    return data<RegisterActionData>({ ok: false, formError: "generic" });
  }
  // With email confirmation on, signing up again with an address that is ALREADY
  // confirmed is not an error: the auth server answers with a stand-in user that
  // has no identities and sends no email. Say so instead of waiting for a code.
  if (signed.user && Array.isArray(signed.user.identities) && signed.user.identities.length === 0) {
    return data<RegisterActionData>({ ok: false, formError: vendorIntent ? "email_exists_vendor" : "email_exists" });
  }

  // The auth server now emails the 6-digit code (Supabase SMTP → Resend).
  // The welcome email waits until the code is verified (verify action).
  // `sent` lets the verify page keep its resend countdown across refreshes.
  const redirectTo = `/${lang}/auth/verify?email=${encodeURIComponent(input.email)}&sent=${Date.now()}${
    vendorIntent ? `&next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}` : ""
  }`;
  if (isDocumentPost) throw redirect(redirectTo);
  return { ok: true as const, redirectTo };
}

const FORM_ERRORS: Record<string, string> = {
  email_exists: "auth.register.emailExists",
  email_exists_vendor: "vendorOnboarding.register.emailExists",
  terms_changed: "legal.termsChanged",
  rate_limited: "auth.errors.rateLimited",
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

  const phoneError = (code: string | undefined) =>
    !code ? undefined
      : code === "phone:taken" ? t("auth.complete.phoneTaken")
      : code.startsWith("phone:") ? t("checkout.errPhone")
      : code;
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

        {/* one tap: name + photo come from Google, then the two phones */}
        <GoogleButton
          lang={lang}
          next={isVendor ? `/${lang}/vendor/onboarding` : null}
          label={t("auth.register.google")}
        />
        <OrDivider />

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
          <PhoneInput
            label={t("auth.register.phone")}
            autoComplete="tel"
            error={phoneError(errors.phone?.message ?? failed?.fieldErrors?.phone)}
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
              <input type="hidden" name="terms_version" value={loaderData.termsVersion ?? ""} />
              <span className="min-w-0 leading-relaxed">
                {t("auth.register.terms")}{" "}
                <Link to={`/${lang}/legal/terms`} target="_blank" className="font-bold text-action hover:underline">
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
