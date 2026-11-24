import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/verify";
import { Link, data, redirect, useActionData, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { otpCodeSchema } from "~/features/auth/schemas";
import { rememberLocale } from "~/lib/locale-preference.server";
import { getSiteUrl } from "~/lib/env.server";
import { resendSecondsLeft } from "~/features/auth/otp";
import { Button, Card, CardBody, AlertIcon } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { safeNext } from "~/lib/auth/next";
import { clientKey, rateLimit } from "~/lib/rate-limit.server";
import { finishVerifiedSignup } from "~/features/auth/verified-signup.server";
import { SkeletonPage } from "~/components/ui/Skeleton";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  // Email-link path: Supabase appends token_hash&type=signup to redirectTo.
  // Verify server-side and sign the user straight in (JOURNEYS §2).
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const linkType = url.searchParams.get("type");
  if (tokenHash && (linkType === "signup" || linkType === "email_change" || linkType === "magiclink")) {
    const { client, headers } = createSupabaseServerClient(request);
    if (client) {
      // verifyOtp mints the session cookies; they must ride the redirect.
      const { error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: linkType,
      });
      if (!error) {
        const target = linkType === "signup"
          ? await finishVerifiedSignup(client, lang, request.url, url.searchParams.get("next"))
          : linkType === "email_change" ? `/${lang}/account/profile?email=changed` : safeNext(url.searchParams.get("next"), `/${lang}/account`);
        if (linkType !== "signup") await rememberLocale(client, lang);
        throw redirect(
          target,
          { headers },
        );
      }
    }
  }
  // email-change OTP mode: the profile flow sends a 6-digit code to the NEW
  // address and lands here for code entry (AGENT §30 — OTP, not inline edit)
  const emailChangeMode = url.searchParams.get("type") === "email_change";
  const emailChangeEmail = url.searchParams.get("email") ?? "";
  return { lang, emailChangeMode, emailChangeEmail };
}

type VerifyActionData =
  | { ok: true; redirectTo: string }
  | { ok: false; reason: "wrong_code" | "expired" | "too_many" | "db_not_connected"; attempts?: number };

/**
 * POST /auth/verify (F-09): real `verifyOtp(type: "signup")`. On success the
 * user IS signed in (session cookies set server-side) and returns to their
 * intent. A welcome email is sent through the real provider (F-18).
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data<VerifyActionData>({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const form = await request.formData();

  // Resend branch: real Supabase resend; the server enforces the 60s throttle.
  if (String(form.get("intent") ?? "") === "resend") {
    const email = String(form.get("email") ?? "");
    if (!email) return data<ResendActionData>({ ok: false, reason: "failed" });
    // App-level cap — the UI countdown is client-side only, so without this a
    // scripted caller could resend at full speed (app/lib/rate-limit.server.ts).
    // Keyed by the target address (what gets mail-bombed) and, when a trusted
    // proxy supplies it, by client IP.
    const ip = clientKey(request);
    if (
      !rateLimit(`otp-resend:email:${email.trim().toLowerCase()}`, 3, 5 * 60_000) ||
      (ip && !rateLimit(`otp-resend:ip:${ip}`, 20, 5 * 60_000))
    ) {
      return data<ResendActionData>({ ok: false, reason: "rate_limited" });
    }
    const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${getSiteUrl(request.url)}/${lang}/auth/verify` } });
    if (error && /rate|too many|wait/i.test(error.message)) {
      return data<ResendActionData>({ ok: false, reason: "rate_limited" });
    }
    return data<ResendActionData>(error ? { ok: false, reason: "failed" } : { ok: true });
  }

  const email = String(form.get("email") ?? "");
  const token = String(form.get("token") ?? "");
  const parsed = otpCodeSchema.safeParse(token);
  if (!parsed.success || !email) {
    return data<VerifyActionData>({ ok: false, reason: "wrong_code" });
  }
  // OTP type: signup codes and email-change codes share this endpoint
  const otpTypeRaw = String(form.get("otp_type") ?? "signup");
  const otpType = otpTypeRaw === "email_change" ? "email_change" : "signup";
  const { error } = await client.auth.verifyOtp({ email, token: parsed.data, type: otpType });
  if (error) {
    if (/confirmed/i.test(error.message)) return data<VerifyActionData>({ ok: false, reason: "expired" });
    if (/rate|too many/i.test(error.message)) return data<VerifyActionData>({ ok: false, reason: "too_many" });
    return data<VerifyActionData>({ ok: false, reason: "wrong_code", attempts: 5 });
  }

  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  if (otpType === "email_change") {
    await rememberLocale(client, lang);
    // the OLD address is now replaced — back to the profile with the receipt
    const redirectToChange = `/${lang}/account/profile?email=changed`;
    if (request.headers.get("sec-fetch-mode") === "navigate") {
      throw redirect(redirectToChange, { headers });
    }
    return data<VerifyActionData>({ ok: true, redirectTo: redirectToChange }, { headers });
  }

  const redirectTo = await finishVerifiedSignup(client, lang, request.url, next);
  if (request.headers.get("sec-fetch-mode") === "navigate") {
    throw redirect(redirectTo, { headers });
  }
  return data<VerifyActionData>({ ok: true, redirectTo }, { headers });
}

export default function VerifyPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const [searchParams] = useSearchParams();
  const email = loaderData.emailChangeMode ? loaderData.emailChangeEmail : (searchParams.get("email") ?? "");
  const otpType = loaderData.emailChangeMode ? "email_change" : "signup";
  const fetcher = useFetcher<VerifyActionData>();
  const resendFetcher = useFetcher<ResendActionData>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();

  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  // Resend countdown survives a refresh: it starts when the code was really
  // sent (`sent` from register, or the last resend, kept in localStorage per
  // address) instead of at every page load.
  const cooldownKey = `etsawaa:otp-sent:${loaderData.emailChangeMode ? "email_change" : "signup"}:${email.toLowerCase()}`;
  const [cooldownStart, setCooldownStart] = useState(() => {
    const sent = Number(searchParams.get("sent"));
    return Number.isFinite(sent) && sent > 0 && sent <= Date.now() ? sent : Date.now();
  });
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(cooldownKey));
      if (Number.isFinite(stored) && stored > cooldownStart && stored <= Date.now()) setCooldownStart(stored);
      else window.localStorage.setItem(cooldownKey, String(cooldownStart));
    } catch {
      // storage blocked (private mode): the countdown still runs for this view
    }
    // run once per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldownKey]);
  const [secondsLeft, setSecondsLeft] = useState(() => resendSecondsLeft(cooldownStart, Date.now()));
  const cellsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const timer = window.setInterval(() => setSecondsLeft(resendSecondsLeft(cooldownStart, Date.now())), 500);
    return () => window.clearInterval(timer);
  }, [cooldownStart]);

  // Re-arm the 60s throttle after a successful resend. Previously the start
  // time was fixed at mount, so once it hit 0 the button stayed enabled forever
  // and only Supabase's rate limiter stood in the way.
  useEffect(() => {
    if (resendFetcher.state === "idle" && resendFetcher.data && "ok" in resendFetcher.data && resendFetcher.data.ok) {
      const now = Date.now();
      setCooldownStart(now);
      try { window.localStorage.setItem(cooldownKey, String(now)); } catch { /* storage blocked */ }
    }
  }, [resendFetcher.state, resendFetcher.data, cooldownKey]);

  const token = useMemo(() => digits.join(""), [digits]);
  const canSubmit = token.length === 6;

  const result = (fetcher.data ?? actionData) as VerifyActionData | ResendActionData | undefined;
  const failure = result && !result.ok ? result : null;

  useEffect(() => {
    if (result && result.ok && "redirectTo" in result) navigate(result.redirectTo, { replace: true });
  }, [result, navigate]);

  function setDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((current) => current.map((d, i) => (i === index ? "" : d)));
      return;
    }
    const chars = clean.split("");
    setDigits((current) => {
      const next = [...current];
      for (const char of chars) {
        if (index > 5) break;
        next[index] = char;
        index += 1;
      }
      return next;
    });
    const nextIndex = Math.min(index + chars.length, 5);
    cellsRef.current[nextIndex]?.focus();
  }

  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-lg font-extrabold text-text">
            {otpType === "email_change" ? t("auth.verify.emailChangeTitle") : t("auth.verify.title")}
          </h1>
          <p className="text-sm text-text-muted">
            {otpType === "email_change" ? t("auth.verify.emailChangeSubtitle") : t("auth.verify.subtitle")}
            {" "}
            <span className="num font-bold text-text">{email}</span>
          </p>
        </div>

        {failure ? (
          <div role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
            <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="font-bold">
              {failure.reason === "too_many"
                ? t("auth.verify.tooMany")
                : failure.reason === "expired"
                  ? t("auth.verify.expired")
                  : failure.reason === "db_not_connected"
                    ? t("auth.errors.generic")
                    : t("auth.verify.wrongCode", {
                        attempts: ("attempts" in failure ? failure.attempts : undefined) ?? 5,
                      })}
            </span>
          </div>
        ) : null}

        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="otp_type" value={otpType} />
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-text">{t("auth.verify.code")}</legend>
            <div className="flex justify-center gap-2" dir="ltr">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => {
                    cellsRef.current[index] = element;
                  }}
                  value={digit}
                  onChange={(event) => setDigit(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !digits[index] && index > 0) {
                      cellsRef.current[index - 1]?.focus();
                    }
                  }}
                  onFocus={(event) => event.target.select()}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-label={t("auth.verify.digit", { index: index + 1 })}
                  className={`num size-12 rounded-md border-2 text-center text-lg font-extrabold text-text outline-none transition-colors duration-150 focus:shadow-focus ${
                    digit ? "border-primary bg-surface-tint" : "border-border bg-surface"
                  }`}
                />
              ))}
            </div>
          </fieldset>
          <Button type="submit" size="lg" block loading={fetcher.state !== "idle"} disabled={!canSubmit}>
            {t("auth.verify.submit")}
          </Button>
        </fetcher.Form>

        <div className="flex flex-col items-center gap-2 text-sm">
          {secondsLeft > 0 ? (
            <span className="text-text-muted">{t("auth.verify.resendIn", { seconds: secondsLeft })}</span>
          ) : (
            <resendFetcher.Form method="post">
              <input type="hidden" name="intent" value="resend" />
              <input type="hidden" name="email" value={email} />
              <Button type="submit" variant="ghost" size="sm" loading={resendFetcher.state !== "idle"}>
                {t("auth.verify.resend")}
              </Button>
            </resendFetcher.Form>
          )}
          {resendFetcher.data && !resendFetcher.data.ok ? (
            <span role="alert" className="font-bold text-danger">
              {resendFetcher.data.reason === "rate_limited" ? t("auth.verify.resendIn", { seconds: 60 }) : t("auth.errors.generic")}
            </span>
          ) : null}
          <Link to={`/${lang}/auth/register`} className="text-text-muted hover:text-action">
            {t("auth.verify.changeEmail")}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

type ResendActionData = { ok: true } | { ok: false; reason: "rate_limited" | "failed" };

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
