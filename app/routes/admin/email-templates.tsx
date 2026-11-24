import { data } from "react-router";
import type { Route } from "./+types/email-templates";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess, requirePermission } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { sameOriginRequest } from "~/lib/locale-preference.server";
import { getSmtpSender } from "~/lib/env.server";
import { sendEmail } from "~/lib/email/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { compileEmailTemplate, validateContent, contentVariables } from "~/lib/email/content";
import { emailSampleVariables } from "~/lib/email/catalog";
import { rateLimit } from "~/lib/rate-limit.server";
import { EmailStudio, type TemplateRow, type StudioResult } from "~/features/email/EmailStudio";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "settings.email_templates");
  const { data: result, error } = await client.rpc("fn_admin_email_templates");
  if (error) throw new Error("Unable to load email templates");
  if (!result?.ok) throw new Response("Forbidden", { status: 403 });
  headers.set("Cache-Control", "private, no-store");
  return data({ lang, templates: (result.templates ?? []) as TemplateRow[], providerConfigured: Boolean(getSmtpSender("notifications")), initialKey: new URL(request.url).searchParams.get("key") }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  if (!sameOriginRequest(request)) return data<StudioResult>({ ok: false, reason: "forbidden" }, { status: 403 });
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data<StudioResult>({ ok: false, reason: "failed" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "settings.email_templates");
  const form = await request.formData();
  const key = String(form.get("key") ?? "");
  const intent = String(form.get("intent") ?? "");
  const list = await client.rpc("fn_admin_email_templates");
  const current = ((list.data?.templates ?? []) as TemplateRow[]).find((t) => t.key === key);
  if (!current) return data<StudioResult>({ ok: false, reason: "not_found" }, { status: 404, headers });
  if (intent === "active") {
    const result = await client.rpc("fn_admin_set_email_template_active", { p_key: key, p_active: form.get("active") === "1" });
    return data<StudioResult>(result.error || !result.data?.ok ? { ok: false, reason: result.data?.reason ?? "failed" } : { ok: true, key, message: "activeSaved" }, { headers });
  }
  if (!["draft", "publish", "restore", "test"].includes(intent)) return data<StudioResult>({ ok: false, reason: "failed" }, { status: 400, headers });
  let candidate: unknown;
  if (intent === "restore") {
    const admin = getSupabaseAdminClient();
    if (!admin) return data<StudioResult>({ ok: false, reason: "not_configured" }, { status: 503, headers });
    const { data: previous } = await admin.from("email_template_versions").select("snapshot").eq("template_key", key).eq("version", Number(form.get("restore_version"))).maybeSingle();
    candidate = previous ? { ar: previous.snapshot.content_ar, en: previous.snapshot.content_en } : null;
  } else {
    const raw = String(form.get("content") ?? "");
    if (raw.length > 64000) return data<StudioResult>({ ok: false, reason: "invalid_content" }, { status: 400, headers });
    try { candidate = JSON.parse(raw); } catch { candidate = null; }
  }
  const verdict = validateContent(candidate, current.variables);
  if (!verdict.ok) return data<StudioResult>({ ok: false, reason: verdict.reason }, { status: 400, headers });
  if (key.startsWith("auth:") && Object.values(verdict.content).some((c) => !contentVariables(c).includes(key === "auth:invite" ? "confirmation_url" : "code"))) return data<StudioResult>({ ok: false, reason: "invalid_content" }, { status: 400, headers });
  if (intent === "test") {
    const to = String(form.get("to") ?? "").trim();
    const locale = form.get("locale") === "en" ? "en" : "ar";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return data<StudioResult>({ ok: false, reason: "bad_email" }, { status: 400, headers });
    if (!rateLimit(`email-test:${viewer.user.id}`, 5, 60_000)) return data<StudioResult>({ ok: false, reason: "rate_limited" }, { status: 429, headers });
    const result = await sendEmail(getSupabaseAdminClient(), { to, templateKey: key, locale, variables: emailSampleVariables(locale, key), content: verdict.content[locale] });
    return data<StudioResult>(result.status === "sent" ? { ok: true, message: "sent" } : { ok: false, reason: result.status === "not_configured" ? "not_configured" : "failed" }, { headers });
  }
  const revision = Number(form.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 1) return data<StudioResult>({ ok: false, reason: "conflict" }, { status: 409, headers });
  const result = await client.rpc("fn_admin_edit_email_template", {
    p_key: key, p_revision: revision, p_intent: intent, p_content: verdict.content,
    p_restore_version: intent === "restore" ? Number(form.get("restore_version")) : null,
    p_html_ar: compileEmailTemplate(verdict.content.ar, "ar", current.variables, process.env.SITE_URL),
    p_html_en: compileEmailTemplate(verdict.content.en, "en", current.variables, process.env.SITE_URL),
  });
  return data<StudioResult>(result.error || !result.data?.ok ? { ok: false, reason: result.data?.reason ?? "failed" } : { ok: true, key, revision: result.data.revision, message: intent === "draft" ? "saved" : intent === "restore" ? "restored" : "published" }, { status: result.data?.reason === "conflict" ? 409 : 200, headers });
}
export default function AdminEmailTemplates({ loaderData }: Route.ComponentProps) { return <EmailStudio {...loaderData} />; }
export function ErrorBoundary() { return <RouteErrorBoundary />; }
export function HydrateFallback() { return <SkeletonTable />; }
