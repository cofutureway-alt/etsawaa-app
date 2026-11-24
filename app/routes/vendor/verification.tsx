import type { Route } from "./+types/verification";
import { Link, data, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorConfig, fetchVendorDocuments, fetchVendorRow } from "~/features/vendor/api";
import { DocumentsPanel } from "~/features/vendor/components/DocumentsPanel";
import { Button } from "~/components/ui";
import { AlertIcon, CheckIcon, ShieldIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * Seller → Verification: the store's verification state, the admin's notes,
 * every document image with its review result, replacement of rejected
 * images, re-submission for review and the history of status changes. Also
 * the place a suspended seller reads why (read-only).
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor) throw Response.redirect(new URL(`/${lang}/vendor/onboarding`, request.url).toString(), 302);
  const [documents, config, extra, history] = await Promise.all([
    fetchVendorDocuments(client, vendor.id),
    fetchVendorConfig(client),
    client.from("vendors").select("verification_note, suspension_reason, suspended_at, rejection_reason").eq("id", vendor.id).single(),
    client.from("vendor_status_history").select("id, field, from_value, to_value, reason, created_at").eq("vendor_id", vendor.id).order("created_at", { ascending: false }).limit(30),
  ]);
  return {
    lang, documents, config,
    status: vendor.status, verification: vendor.verification_status,
    note: (extra.data?.verification_note as string | null) ?? null,
    suspension: (extra.data?.suspension_reason as string | null) ?? null,
    history: (history.data ?? []) as Array<{ id: string; field: string; from_value: string | null; to_value: string; reason: string | null; created_at: string }>,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const { data: res, error } = await client.rpc("fn_vendor_resubmit_verification");
  if (error) return data({ ok: false, reason: error.message.includes("store_suspended") ? "store_suspended" : error.message }, { status: 400 });
  const r = res as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
}

export default function VendorVerification({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { lang, documents, config, status, verification, note, suspension, history } = loaderData;
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, { success: t("verify.resubmitted") });
  const revalidator = useRevalidator();
  const suspended = status === "suspended";
  const rejectedCount = documents.filter((d) => d.status === "rejected").length;
  const canResubmit = !suspended && ["unverified", "needs_changes", "rejected", "grace_expired"].includes(verification);

  const hero = suspended
    ? { tone: "border-danger bg-danger-soft", icon: <AlertIcon className="size-6 text-danger" />, title: t("verify.state.suspended"), body: suspension }
    : verification === "verified"
      ? { tone: "border-success/40 bg-success-soft", icon: <CheckIcon className="size-6 text-success-strong" />, title: t("verify.state.verified"), body: null }
      : verification === "needs_changes"
        ? { tone: "border-warning bg-warning-soft", icon: <AlertIcon className="size-6 text-warning-strong" />, title: t("verify.state.needs_changes"), body: note }
        : verification === "submitted"
          ? { tone: "border-border bg-surface", icon: <ShieldIcon className="size-6 text-action" />, title: t("verify.state.submitted"), body: null }
          : { tone: "border-border bg-surface", icon: <ShieldIcon className="size-6 text-text-muted" />, title: t(`verify.state.${verification}`), body: note };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-black text-text">{t("verify.title")}</h1>

      <section className={`flex items-start gap-3 rounded-xl border-2 p-4 ${hero.tone}`} role={suspended || verification === "needs_changes" ? "alert" : undefined}>
        {hero.icon}
        <div className="min-w-0">
          <p className="text-base font-extrabold text-text">{hero.title}</p>
          {hero.body ? <p className="mt-1 whitespace-pre-line text-sm text-text">{hero.body}</p> : null}
          {suspended ? <p className="mt-2 text-xs font-bold text-danger">{t("verify.suspendedHelp")}</p> : null}
          {!suspended && rejectedCount > 0 ? <p className="mt-2 text-xs font-bold text-danger">{t("verify.rejectedCount", { count: rejectedCount })}</p> : null}
          {!suspended && verification === "needs_changes" ? (
            <Link to={`/${lang}/vendor/profile`} className="mt-2 inline-block text-xs font-bold text-action hover:underline">{t("verify.editInfo")}</Link>
          ) : null}
        </div>
      </section>

      <DocumentsPanel config={config} documents={documents} readOnly={suspended} onChanged={() => void revalidator.revalidate()} />

      {canResubmit ? (
        <fetcher.Form method="post" className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4">
          <p className="text-sm text-text">{t("verify.resubmitHint")}</p>
          <Button type="submit" loading={fetcher.state !== "idle"} disabled={rejectedCount > 0}>{t("verify.resubmit")}</Button>
          {rejectedCount > 0 ? <p className="text-xs text-danger">{t("verify.replaceFirst")}</p> : null}
        </fetcher.Form>
      ) : null}

      {history.length ? (
        <section className="rounded-xl border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-sm font-extrabold text-text">{t("verify.history")}</h2>
          <ol className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm">
                <span className="font-bold text-text">
                  {t(h.field === "status" ? "verify.histStatus" : "verify.histVerification")}: {t(`verify.value.${h.to_value}`, h.to_value)}
                </span>
                {h.reason ? <span className="text-xs text-text-muted">{h.reason}</span> : null}
                <span className="num text-2xs text-text-faint">{new Date(h.created_at).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn")}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
