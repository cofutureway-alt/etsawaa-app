import { useEffect, useState } from "react";
import type { Route } from "./+types/forgot";
import { data, redirect, useActionData, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import type { z } from "zod";
import { forgotSchema, resetPasswordSchema, otpCodeSchema } from "~/features/auth/schemas";
import { looksLikeEmail, normalizeEgyptianPhone } from "~/lib/phone";
import { resolveEmailFromPhone } from "~/features/auth/phone-email.server";
import { Button, Card, CardBody, Input, AlertIcon } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { PhoneInput } from "~/components/phone/PhoneInput";
import { CodeCells } from "~/components/phone/PhoneCodeBox";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { checkPhoneCode, codesAvailable, markPhoneVerified, sendPhoneCode } from "~/lib/messaging/otp.server";
import { clientKey, rateLimit } from "~/lib/rate-limit.server";


/** Typed code+password schema for the manual-OTP reset path. */
const resetCodeSchema = resetPasswordSchema.extend({ token: otpCodeSchema });

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) {
    return data({ lang, recovery: false, invite: false, recoveryError: "db_not_connected" as const }, { headers });
  }

  // Email-link path: Supabase appends token_hash&type=recovery to redirectTo.
  // verifyOtp mints the recovery session — the Set-Cookie in `headers` is what
  // lets reset_new actually update the password, so it must be returned.
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  // type=invite: an account created from the admin panel — same flow, the
  // person chooses their first password (features/admin/create-user.server.ts).
  const invite = url.searchParams.get("type") === "invite";
  if (tokenHash) {
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: invite ? "invite" : "recovery",
    });
    return data(
      { lang, recovery: !error, invite, recoveryError: error ? ("recovery_failed" as const) : undefined },
      { headers },
    );
  }
  return data({ lang, recovery: false, invite: false }, { headers });
}

type ForgotActionData =
  | { ok: true; identifier?: string; via?: "email" | "phone"; channel?: "sms" | "whatsapp" }
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
    if (intent === "reset_code" && form.get("via") === "phone") {
      // phone path: our own code, then the password is set with the service role
      const admin = getSupabaseAdminClient();
      const phone = normalizeEgyptianPhone(String(form.get("identifier") ?? ""));
      const token = String(form.get("token") ?? "");
      if (!admin || !phone.ok || !/^\d{6}$/.test(token)) return data<ForgotActionData>({ ok: false, formError: "bad_code" });
      const checked = await checkPhoneCode(admin, { phone: phone.e164, purpose: "reset", code: token });
      if (!checked.ok) return data<ForgotActionData>({ ok: false, formError: checked.reason === "expired" ? "code_expired" : checked.reason === "too_many_tries" ? "code_tries" : "bad_code" });
      if (!checked.userId) return data<ForgotActionData>({ ok: false, formError: "bad_code" });
      const { error: updateError } = await admin.auth.admin.updateUserById(checked.userId, { password: parsedBody.data.password });
      if (updateError) return data<ForgotActionData>({ ok: false, formError: "generic" });
      await markPhoneVerified(admin, checked.userId, phone.e164);
      const email = await resolveEmailFromPhone(phone.e164);
      if (email) await client.auth.signInWithPassword({ email, password: parsedBody.data.password });
      if (isDocumentPost) throw redirect(`/${lang}/account`, { headers });
      return data({ ok: true as const, done: true as const }, { headers });
    }
    if (intent === "reset_code") {
      // The browser only ever holds what the user typed; a phone is resolved
      // again here so the account's email never reaches the client.
      const email = await identifierToEmail(String(form.get("identifier") ?? ""));
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

  if (!looksLikeEmail(identifier) && !normalizeEgyptianPhone(identifier).ok) {
    return data<ForgotActionData>({ ok: false, formError: "identifier_invalid" });
  }
  // a phone number gets its code by WhatsApp / SMS when Rasvio is connected;
  // the answer is the same whether or not the number has an account
  const phone = normalizeEgyptianPhone(identifier);
  const admin = getSupabaseAdminClient();
  if (phone.ok && admin && (await codesAvailable(admin, "reset"))) {
    const ip = clientKey(request);
    if (!rateLimit(`reset-phone:${phone.e164}`, 3, 10 * 60_000) || (ip && !rateLimit(`reset-ip:${ip}`, 10, 10 * 60_000))) {
      return data<ForgotActionData>({ ok: false, formError: "too_many" });
    }
    const { data: owner } = await admin.from("profiles").select("id").eq("phone", phone.e164).maybeSingle();
    let channel: "sms" | "whatsapp" | undefined;
    if (owner) {
      const sentCode = await sendPhoneCode(admin, { phone: phone.e164, purpose: "reset", userId: owner.id as string, locale: lang === "en" ? "en" : "ar", ip });
      if (!sentCode.ok && sentCode.reason === "too_soon") return data<ForgotActionData>({ ok: false, formError: "too_soon" });
      if (!sentCode.ok && sentCode.reason === "too_many") return data<ForgotActionData>({ ok: false, formError: "too_many" });
      if (sentCode.ok) channel = sentCode.channel;
    }
    return data<ForgotActionData>({ ok: true, identifier: phone.e164, via: "phone", channel });
  }

  const email = await identifierToEmail(identifier);
  if (!email) {
    // US-05 edge: phone without a registered email → support path.
    return data<ForgotActionData>({ ok: false, formError: "phone_no_email" });
  }

  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/${lang}/auth/forgot`,
  });
  if (error) return data<ForgotActionData>({ ok: false, formError: "generic" });
  return data<ForgotActionData>({ ok: true, identifier, via: "email" });
}

/** Email as typed, or the account email behind an Egyptian phone (server-only). */
async function identifierToEmail(identifier: string): Promise<string | null> {
  const value = identifier.trim();
  if (!value) return null;
  if (looksLikeEmail(value)) return value;
  const phone = normalizeEgyptianPhone(value);
  return phone.ok ? resolveEmailFromPhone(phone.e164) : null;
}

const FORM_ERRORS: Record<string, string> = {
  db_not_connected: "auth.errors.generic",
  identifier_invalid: "auth.errors.identifierInvalid",
  too_soon: "phoneCode.err.too_soon",
  too_many: "phoneCode.err.too_many",
  code_expired: "phoneCode.err.expired",
  code_tries: "phoneCode.err.too_many_tries",
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
  const [code, setCode] = useState("");
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
    <div role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
      <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="font-bold">{t(FORM_ERRORS[errorData.formError] ?? "auth.errors.generic")}</span>
    </div>
  ) : null;

  // Path 1: arrived from the email link — session is in recovery, set a new password.
  if (recovery) {
    return (
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col gap-4 p-6">
          <h1 className="text-lg font-extrabold text-text">{t(loaderData.invite ? "auth.forgot.inviteTitle" : "auth.forgot.newTitle")}</h1>
          {loaderData.invite ? <p className="text-sm text-text-muted">{t("auth.forgot.inviteHint")}</p> : null}
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
    const identifier = result && result.ok && "identifier" in result ? (result.identifier ?? "") : "";
    const via = result && result.ok && "via" in result ? result.via : "email";
    const channel = result && result.ok && "channel" in result ? result.channel : undefined;
    return (
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col gap-4 p-6">
          <h1 className="text-lg font-extrabold text-text">{t("auth.forgot.newTitle")}</h1>
          <p className="text-sm text-text-muted">
            {via === "phone"
              ? t(channel === "sms" ? "auth.forgot.sentSms" : channel === "whatsapp" ? "auth.forgot.sentWhatsapp" : "auth.forgot.sentPhone")
              : t("auth.otp.sentToEmail")}
          </p>
          {ErrorBox}
          <fetcher.Form method="post" onSubmit={codeForm.handleSubmit((_values, event) => {
              if (event?.target instanceof HTMLFormElement) fetcher.submit(event.target, { method: "post" });
            })} noValidate className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="reset_code" />
            <input type="hidden" name="identifier" value={identifier} />
            <input type="hidden" name="via" value={via} />
            <input type="hidden" name="token" value={code} />
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-text">{t("auth.verify.code")}</legend>
              <CodeCells value={code} onChange={(v) => { setCode(v); codeForm.setValue("token", v, { shouldValidate: v.length === 6 }); }} invalid={Boolean(codeForm.formState.errors.token)} label={(i) => t("auth.verify.digit", { index: i })} />
            </fieldset>
            <Input label={t("auth.forgot.newPassword")} type="password" showPasswordToggle autoComplete="new-password" hint={t("auth.register.passwordHint")} error={codeForm.formState.errors.password?.message ?? errorData?.fieldErrors?.password} {...codeForm.register("password")} />
            <Input label={t("auth.forgot.confirmNewPassword")} type="password" showPasswordToggle autoComplete="new-password" error={codeForm.formState.errors.confirmPassword?.message ?? errorData?.fieldErrors?.confirmPassword} {...codeForm.register("confirmPassword")} />
            <Button type="submit" size="lg" block loading={fetcher.state !== "idle"}>
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
          <p className="text-sm text-text-muted">{t("auth.forgot.subtitle")}</p>
        </div>
        {ErrorBox}
        <fetcher.Form method="post" onSubmit={sendForm.handleSubmit((_values, event) => {
            if (event?.target instanceof HTMLFormElement) fetcher.submit(event.target, { method: "post" });
          })} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="send" />
          <PhoneInput
            mode="smart"
            label={t("auth.forgot.identifier")}
            autoComplete="username"
            error={sendForm.formState.errors.identifier ? t("auth.errors.identifierInvalid") : undefined}
            {...sendForm.register("identifier")}
          />
          <Button type="submit" size="lg" block loading={fetcher.state !== "idle"}>
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
