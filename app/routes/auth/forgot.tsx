import { useEffect } from "react";
import type { Route } from "./+types/forgot";
import { data, redirect, useActionData, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import type { z } from "zod";
import { forgotSchema, resetPasswordSchema, otpCodeSchema } from "~/features/auth/schemas";
import { looksLikeEmail, normalizeEgyptianPhone } from "~/lib/phone";
import { Button, Card, CardBody, Input, AlertIcon } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** Typed code+password schema for the manual-OTP reset path. */
const resetCodeSchema = resetPasswordSchema.extend({ token: otpCodeSchema });

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, recovery: false, recoveryError: "db_not_connected" as const };

  // Email-link path: Supabase appends token_hash&type=recovery to redirectTo.
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash) {
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    return { lang, recovery: !error, recoveryError: error ? ("recovery_failed" as const) : undefined };
  }
  return { lang, recovery: false };
}

type ForgotActionData =
  | { ok: true; email?: string }
  | { ok: false; formError: string; fieldErrors?: Record<string, string> };

/**
 * Auth actions for the forgot-password flow (F-11):
 *  - default (send): email/phone → RPC resolve → resetPasswordForEmail
 *  - reset_code: typed 6-digit code + new password → verifyOtp(recovery) → updateUser
 *  - reset_new: session already in recovery (link path) → updateUser
 * Old password is invalid after reset; OTP expiry enforced by Supabase.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const isDocumentPost = request.headers.get("sec-fetch-mode") === "navigate";
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data<ForgotActionData>({ ok: false, formError: "db_not_connected" }, { status: 503 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "send");
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;

  if (intent === "reset_code" || intent === "reset_new") {
    const parsedBody = resetPasswordSchema.safeParse({
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    });
    if (!parsedBody.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsedBody.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return data<ForgotActionData>({ ok: false, formError: "generic", fieldErrors });
    }
    if (intent === "reset_code") {
      const email = String(form.get("email") ?? "");
      const token = String(form.get("token") ?? "");
      if (!email || !/^\d{6}$/.test(token)) {
        return data<ForgotActionData>({ ok: false, formError: "bad_code" });
      }
      const { error } = await client.auth.verifyOtp({ email, token, type: "recovery" });
      if (error) return data<ForgotActionData>({ ok: false, formError: "bad_code" });
    }
    const { error } = await client.auth.updateUser({ password: parsedBody.data.password });
    if (error) return data<ForgotActionData>({ ok: false, formError: "generic" });
    if (isDocumentPost) throw redirect(`/${lang}/account`, { headers });
    return { ok: true as const, done: true as const };
  }

  const parsed = forgotSchema.safeParse({ identifier: String(form.get("identifier") ?? "") });
  if (!parsed.success) {
    return data<ForgotActionData>({ ok: false, formError: "identifier_invalid" });
  }
  const identifier = parsed.data.identifier;

  let email = identifier;
  if (!looksLikeEmail(identifier)) {
    const phone = normalizeEgyptianPhone(identifier);
    if (!phone.ok) return data<ForgotActionData>({ ok: false, formError: "identifier_invalid" });
    const { data: resolved } = await client.rpc("fn_resolve_email_from_phone", { p_phone_e164: phone.e164 });
    if (!resolved) {
      // US-05 edge: phone without a registered email → support path.
      return data<ForgotActionData>({ ok: false, formError: "phone_no_email" });
    }
    email = String(resolved);
  }

  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/${lang}/auth/forgot`,
  });
  if (error) return data<ForgotActionData>({ ok: false, formError: "generic" });
  return data<ForgotActionData>({ ok: true, email });
}

const FORM_ERRORS: Record<string, string> = {
  db_not_connected: "auth.errors.generic",
  identifier_invalid: "auth.login.identifierHint",
  phone_no_email: "auth.forgot.phoneNoEmail",
  bad_code: "auth.verify.wrongCode",
  recovery_failed: "auth.verify.expired",
  generic: "auth.errors.generic",
};

export default function ForgotPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<ForgotActionData>();
  const navigate = useNavigate();

  const result = fetcher.data ?? actionData;
  const errorData = result && !result.ok ? result : null;

  useEffect(() => {
    if (result?.ok && "done" in result) navigate(`/${lang}/account`, { replace: true });
  }, [result, lang, navigate]);

  const sent = result?.ok === true;
  const recovery = loaderData.recovery;

  const sendForm = useForm<z.input<typeof forgotSchema>, unknown, z.output<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { identifier: "" },
  });
  const codeForm = useForm<z.input<typeof resetCodeSchema>, unknown, z.output<typeof resetCodeSchema>>({
    resolver: zodResolver(resetCodeSchema),
    defaultValues: { token: "", password: "", confirmPassword: "" },
  });
  const newPasswordForm = useForm<z.input<typeof resetPasswordSchema>, unknown, z.output<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const ErrorBox = errorData ? (
    <div role="alert" className="flex items-start gap-1.5 rounded-m border border-danger/40 bg-danger-soft p-3 text-[13px] text-danger">
      <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="font-bold">{t(FORM_ERRORS[errorData.formError] ?? "auth.errors.generic")}</span>
    </div>
  ) : null;

  // Path 1: arrived from the email link — session is in recovery, set a new password.
  if (recovery) {
    return (
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col gap-4 p-6">
          <h1 className="text-lg font-extrabold text-text">{t("auth.forgot.newTitle")}</h1>
          {ErrorBox}
          <fetcher.Form method="post" onSubmit={newPasswordForm.handleSubmit((_values, event) => {
              if (event?.target instanceof HTMLFormElement) fetcher.submit(event.target, { method: "post" });
            })} noValidate className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="reset_new" />
            <Input label={t("auth.forgot.newPassword")} type="password" showPasswordToggle autoComplete="new-password" hint={t("auth.register.passwordHint")} error={newPasswordForm.formState.errors.password?.message ?? errorData?.fieldErrors?.password} {...newPasswordForm.register("password")} />
            <Input label={t("auth.forgot.confirmNewPassword")} type="password" showPasswordToggle autoComplete="new-password" error={newPasswordForm.formState.errors.confirmPassword?.message ?? errorData?.fieldErrors?.confirmPassword} {...newPasswordForm.register("confirmPassword")} />
            <Button type="submit" size="lg" block>
              {t("auth.forgot.resetSubmit")}
            </Button>
          </fetcher.Form>
        </CardBody>
      </Card>
    );
  }

  // Path 2: code sent — user types the 6-digit code + new password.
  if (sent) {
    const email = result && result.ok && "email" in result ? (result.email ?? "") : "";
    return (
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col gap-4 p-6">
          <h1 className="text-lg font-extrabold text-text">{t("auth.forgot.newTitle")}</h1>
          <p className="text-[13px] text-text-muted">{t("auth.otp.sentToEmail")}</p>
          {ErrorBox}
          <fetcher.Form method="post" onSubmit={codeForm.handleSubmit((_values, event) => {
              if (event?.target instanceof HTMLFormElement) fetcher.submit(event.target, { method: "post" });
            })} noValidate className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="reset_code" />
            <input type="hidden" name="email" value={email} />
            <Input label={t("auth.verify.code")} inputMode="numeric" maxLength={6} className="num" error={codeForm.formState.errors.token?.message ?? errorData?.fieldErrors?.token} {...codeForm.register("token")} />
            <Input label={t("auth.forgot.newPassword")} type="password" showPasswordToggle autoComplete="new-password" hint={t("auth.register.passwordHint")} error={codeForm.formState.errors.password?.message ?? errorData?.fieldErrors?.password} {...codeForm.register("password")} />
            <Input label={t("auth.forgot.confirmNewPassword")} type="password" showPasswordToggle autoComplete="new-password" error={codeForm.formState.errors.confirmPassword?.message ?? errorData?.fieldErrors?.confirmPassword} {...codeForm.register("confirmPassword")} />
            <Button type="submit" size="lg" block>
              {t("auth.forgot.resetSubmit")}
            </Button>
          </fetcher.Form>
        </CardBody>
      </Card>
    );
  }

  // Path 0: request a code.
  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-lg font-extrabold text-text">{t("auth.forgot.title")}</h1>
          <p className="text-[13px] text-text-muted">{t("auth.forgot.subtitle")}</p>
        </div>
        {ErrorBox}
        <fetcher.Form method="post" onSubmit={sendForm.handleSubmit((_values, event) => {
            if (event?.target instanceof HTMLFormElement) fetcher.submit(event.target, { method: "post" });
          })} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="send" />
          <Input
            label={t("auth.forgot.identifier")}
            hint={t("auth.login.identifierHint")}
            autoComplete="username"
            error={sendForm.formState.errors.identifier?.message}
            {...sendForm.register("identifier")}
          />
          <Button type="submit" size="lg" block>
            {t("auth.forgot.submit")}
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
