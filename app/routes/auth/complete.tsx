import type { Route } from "./+types/complete";
import { data, useActionData, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { useEffect } from "react";
import type { z } from "zod";
import { completeGoogleSchema } from "~/features/auth/schemas";
import { Button, Card, CardBody, Input } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { SkeletonPage } from "~/components/ui/Skeleton";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) throw Response.redirect(new URL(`/${lang}/auth/login`, request.url).toString(), 302);
  // Already complete → straight to the account.
  if (viewer.profile.phone) {
    throw Response.redirect(new URL(`/${lang}/account`, request.url).toString(), 302);
  }
  return { lang, email: viewer.user.email ?? "" };
}

/** Success redirects server-side; the action only ever returns failures. */
type CompleteActionData =
  | { ok: true; redirectTo: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/**
 * POST /auth/complete (F-12): Google-only onboarding — a real profile update
 * (RLS own-row) writing the normalized E.164 phone. A duplicate phone is
 * rejected by the UNIQUE index and mapped to a clear message.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<CompleteActionData>({ ok: false, formError: "db_not_connected" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data<CompleteActionData>({ ok: false, formError: "generic" }, { status: 401 });

  const form = await request.formData();
  const parsed = completeGoogleSchema.safeParse({
    phone: String(form.get("phone") ?? ""),
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

  const { error } = await client
    .from("profiles")
    .update({ phone: parsed.data.phone })
    .eq("id", viewer.user.id);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return data<CompleteActionData>({ ok: false, formError: "phone_taken" });
    }
    return data<CompleteActionData>({ ok: false, formError: "generic" });
  }
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const redirectTo = next && next.startsWith("/") ? next : `/${lang}/account`;
  return { ok: true as const, redirectTo };
}

export default function CompletePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<CompleteActionData>();
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors } } = useForm<
    z.input<typeof completeGoogleSchema>, unknown, z.output<typeof completeGoogleSchema>
  >({
    resolver: zodResolver(completeGoogleSchema),
    defaultValues: { phone: "", terms: false },
    mode: "onBlur",
  });

  const result = fetcher.data ?? actionData;
  const errorData = result && !result.ok ? result : undefined;

  useEffect(() => {
    if (result?.ok) navigate(result.redirectTo, { replace: true });
  }, [result, navigate]);

  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-lg font-extrabold text-text">{t("auth.complete.title")}</h1>
          <p className="text-[13px] text-text-muted">
            {t("auth.complete.subtitle")} <span className="num">{loaderData.email}</span>
          </p>
        </div>
        {errorData?.formError ? (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3 text-[13px] font-bold text-danger">
            {errorData.formError === "phone_taken" ? t("auth.complete.phoneTaken") : t("auth.errors.generic")}
          </div>
        ) : null}
        <fetcher.Form method="post" onSubmit={handleSubmit((_values, event) => {
            if (event?.target instanceof HTMLFormElement) {
              fetcher.submit(event.target, { method: "post" });
            }
          })} noValidate className="flex flex-col gap-4">
          <Input
            label={t("auth.complete.phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            hint={t("auth.register.phoneHint")}
            error={errors.phone?.message ?? errorData?.fieldErrors?.phone}
            {...register("phone")}
          />
          <label className="flex items-start gap-2 text-[13px] text-text">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-action)]" {...register("terms")} />
            <span>{t("auth.complete.terms")}</span>
          </label>
          {errors.terms ? (
            <p role="alert" className="text-xs font-bold text-danger">
              {t("common.required")}
            </p>
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
