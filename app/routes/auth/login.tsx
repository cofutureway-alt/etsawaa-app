import { useEffect, useRef } from "react";
import type { Route } from "./+types/login";
import { Link, data, redirect, useActionData, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { loginSchema } from "~/features/auth/schemas";
import { Button, Card, CardBody, Input, AlertIcon } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { safeNext } from "~/lib/auth/next";
import { SkeletonPage } from "~/components/ui/Skeleton";


export async function loader({ params }: Route.LoaderArgs) {
  return { lang: requireLang(params) };
}

type LoginActionData =
  | { ok: true; redirectTo: string }
  | { ok: false; formError?: string; fieldErrors?: Partial<Record<"identifier" | "password", string>> };

/** JS mode result comes from the fetcher; no-JS from useActionData. */

/**
 * POST /auth/login (F-10): email OR phone. Phone is resolved to its email via
 * the `fn_resolve_email_from_phone` RPC, then a real Supabase password
 * sign-in runs. Unverified emails get a fresh OTP and are routed to /verify.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  // Document POST (no-JS) follows a redirect; fetcher POST navigates client-side.
  const isDocumentPost = request.headers.get("sec-fetch-mode") === "navigate";
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) {
    return data<LoginActionData>({ ok: false, formError: "db_not_connected" }, { status: 503 });
  }
  const form = await request.formData();
  const parsed = loginSchema.safeParse({
    identifier: String(form.get("identifier") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"identifier" | "password", string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "identifier" || key === "password") fieldErrors[key] = issue.message;
    }
    return data<LoginActionData>({ ok: false, fieldErrors });
  }

  const { identifier, password } = parsed.data;
  let email: string;
  if (identifier.kind === "email") {
    email = identifier.value;
  } else {
    const { data: resolved, error: rpcError } = await client.rpc("fn_resolve_email_from_phone", {
      p_phone_e164: identifier.value,
    });
    if (rpcError || !resolved) {
      return data<LoginActionData>({ ok: false, formError: "invalid" });
    }
    email = String(resolved);
  }

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message === "Email not confirmed") {
      // Send a fresh OTP and route to the verify screen (US-04 edge).
      await client.auth.resend({ type: "signup", email });
      throw redirect(`/${lang}/auth/verify?email=${encodeURIComponent(email)}&fresh=1`);
    }
    return data<LoginActionData>({ ok: false, formError: "invalid" });
  }

  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const redirectTo = safeNext(next, `/${lang}/account`);
  if (isDocumentPost) throw redirect(redirectTo, { headers });
  return data<LoginActionData>({ ok: true, redirectTo }, { headers });
}

const ERROR_MESSAGE_KEYS: Record<string, string> = {
  invalid: "auth.login.invalid",
  db_not_connected: "auth.errors.generic",
  blocked: "auth.login.blocked",
};

export default function LoginPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<LoginActionData>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const summaryRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const result = fetcher.data ?? actionData;
  const failed = result && !result.ok ? result : undefined;
  const formError = failed?.formError;
  const fieldErrors = failed?.fieldErrors ?? {};
  const urlError = searchParams.get("error");

  useEffect(() => {
    if (result?.ok) navigate(result.redirectTo, { replace: true });
  }, [result, navigate]);

  // Focusable error summary (ui-ux-pro-max: Forms / Accessibility, severity High)
  useEffect(() => {
    if (summaryRef.current) summaryRef.current.focus();
  }, [formError, urlError]);

  const summaryMessage = formError
    ? t(ERROR_MESSAGE_KEYS[formError] ?? "auth.errors.generic")
    : urlError
      ? t("auth.errors.generic")
      : null;

  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-4 p-6">
        <h1 className="text-lg font-extrabold text-text">{t("auth.login.title")}</h1>

        {summaryMessage ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-1.5 rounded-m border border-danger/40 bg-danger-soft p-3 text-[13px] text-danger outline-none"
          >
            <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="font-bold">{summaryMessage}</span>
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
          <Input
            label={t("auth.login.identifier")}
            hint={t("auth.login.identifierHint")}
            placeholder="you@example.com"
            autoComplete="username"
            error={errors.identifier?.message ?? fieldErrors.identifier}
            {...register("identifier")}
          />
          <Input
            label={t("auth.login.password")}
            type="password"
            showPasswordToggle
            autoComplete="current-password"
            error={errors.password?.message ?? fieldErrors.password}
            {...register("password")}
          />
          <div className="flex items-center justify-start text-[13px]">
            <Link to={`/${lang}/auth/forgot`} className="font-bold text-action hover:underline">
              {t("auth.login.forgot")}
            </Link>
          </div>
          <Button type="submit" size="lg" block loading={fetcher.state !== "idle"}>
            {t("auth.login.submit")}
          </Button>
        </fetcher.Form>

        <div className="relative text-center">
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
          <span className="relative z-10 bg-surface px-3 text-xs text-text-faint">{t("auth.login.google")}</span>
        </div>
        <form method="post" action={`/${lang}/auth/google`}>
          <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
          <Button type="submit" variant="outline" size="lg" block>
            {t("auth.login.google")}
          </Button>
        </form>

        <p className="text-center text-[13px] text-text-muted">
          {t("auth.login.noAccount")}{" "}
          <Link to={`/${lang}/auth/register`} className="font-bold text-action hover:underline">
            {t("auth.login.createOne")}
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
