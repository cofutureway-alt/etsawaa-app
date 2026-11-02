import { data, useFetcher } from "react-router";
import type { Route } from "./+types/email-templates";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { getResendApiKey, getEmailFrom } from "~/lib/env.server";
import { sendEmail } from "~/lib/email/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import {
  SAMPLE_VARIABLES,
  extractVariables,
  renderPreview,
  validateTemplate,
} from "~/lib/email/validate";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-25 — Email templates (owner decision: implemented in phase 07).
 * Left: the full list from email_templates (key · human name · locales ·
 * variables · version). Right: editor for subject + HTML body in AR and EN,
 * a variable list with click-to-insert, a teaching preview rendered with
 * sample data, and a test-send that reports the REAL provider state.
 * Validation: unknown {{variables}}, unclosed/crossed tags, empty subject or
 * body are blocked (client-side for feedback, server-side for enforcement).
 */

interface TemplateRow {
  key: string;
  name_ar: string | null;
  name_en: string | null;
  subject_ar: string;
  subject_en: string;
  html_ar: string;
  html_en: string;
  variables: string[];
  version: number;
  updated_at: string | null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);

  const res = await client.rpc("fn_admin_email_templates");
  if (res.error) throw new Error(res.error.message);
  const payload = res.data as { ok: boolean; templates?: TemplateRow[]; reason?: string };
  if (!payload.ok) throw new Response("Forbidden", { status: 403 });

  // provider state is known only to the server process — surfaced honestly
  const providerConfigured = Boolean(getResendApiKey());
  return {
    lang,
    templates: (payload.templates ?? []) as TemplateRow[],
    providerConfigured,
    emailFrom: getEmailFrom(),
  };
}

type ActionResult =
  | { ok: true; intent: "save"; version: number }
  | { ok: true; intent: "test"; status: "sent" | "failed" | "not_configured"; detail: string }
  | { ok: false; reason: string; detail?: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionResult>({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const key = String(form.get("key") ?? "");

  if (intent === "save") {
    const draft = {
      subjectAr: String(form.get("subject_ar") ?? ""),
      subjectEn: String(form.get("subject_en") ?? ""),
      htmlAr: String(form.get("html_ar") ?? ""),
      htmlEn: String(form.get("html_en") ?? ""),
    };
    // declared variables come from the DB row — never from the client
    const list = await client.rpc("fn_admin_email_templates");
    const current = ((list.data as { templates?: TemplateRow[] })?.templates ?? []).find((t) => t.key === key);
    if (!current) return data<ActionResult>({ ok: false, reason: "not_found" }, { status: 404 });

    const verdict = validateTemplate(draft, current.variables);
    if (!verdict.ok) {
      return data<ActionResult>({ ok: false, reason: verdict.reason, detail: verdict.detail }, { status: 400 });
    }
    const res = await client.rpc("fn_admin_save_email_template", {
      p_key: key,
      p_subject_ar: draft.subjectAr,
      p_subject_en: draft.subjectEn,
      p_html_ar: draft.htmlAr,
      p_html_en: draft.htmlEn,
    });
    if (res.error) return data<ActionResult>({ ok: false, reason: "server_error", detail: res.error.message }, { status: 500 });
    const out = res.data as { ok: boolean; version?: number; reason?: string; detail?: string };
    if (!out.ok) return data<ActionResult>({ ok: false, reason: out.reason ?? "rpc", detail: out.detail }, { status: 400 });
    return { ok: true, intent: "save", version: out.version ?? 0 };
  }

  if (intent === "test") {
    const to = String(form.get("to") ?? "").trim();
    const locale = String(form.get("locale") ?? "ar") === "en" ? "en" : "ar";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
      return data<ActionResult>({ ok: false, reason: "bad_email" }, { status: 400 });
    }
    const admin = getSupabaseAdminClient();
    if (!admin) {
      // no service client → cannot read the template or write email_logs
      return { ok: true, intent: "test", status: "not_configured", detail: "SUPABASE_SERVICE_ROLE_KEY missing" };
    }
    // sendEmail writes the email_logs row itself (sent / failed) and returns
    // not_configured when the provider keys are absent — never a fake success.
    const result = await sendEmail(admin, {
      to,
      templateKey: key,
      locale,
      variables: SAMPLE_VARIABLES,
    });
    if (result.status === "not_configured") {
      await client.rpc("fn_admin_log_test_email", {
        p_template: key, p_to: to, p_status: "not_configured", p_error: result.error,
      });
      return { ok: true, intent: "test", status: "not_configured", detail: result.error };
    }
    if (result.status === "failed") {
      return { ok: true, intent: "test", status: "failed", detail: result.error };
    }
    return { ok: true, intent: "test", status: "sent", detail: result.messageId };
  }

  return data<ActionResult>({ ok: false, reason: "bad_intent" }, { status: 400 });
}

const INPUT = "w-full rounded-md border border-border bg-surface p-2.5 font-mono text-xs leading-relaxed text-text";
const LABEL = "text-sm font-bold text-text";

export default function AdminEmailTemplates({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState(loaderData.templates[0]?.key ?? "");
  const current = loaderData.templates.find((x) => x.key === selectedKey) ?? loaderData.templates[0];
  const [draft, setDraft] = useState({
    subjectAr: current?.subject_ar ?? "",
    subjectEn: current?.subject_en ?? "",
    htmlAr: current?.html_ar ?? "",
    htmlEn: current?.html_en ?? "",
  });
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const saveFetcher = useFetcher<ActionResult>();
  const testFetcher = useFetcher<ActionResult>();
  const busy = saveFetcher.state !== "idle";
  const testBusy = testFetcher.state !== "idle";

  function pick(entry: TemplateRow) {
    setSelectedKey(entry.key);
    setDraft({
      subjectAr: entry.subject_ar, subjectEn: entry.subject_en,
      htmlAr: entry.html_ar, htmlEn: entry.html_en,
    });
  }

  /** insert a placeholder into the last focused field, or the AR body by default */
  function insertVariable(name: string, target?: HTMLInputElement | HTMLTextAreaElement | null) {
    const token = `{{${name}}}`;
    if (target) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      const next = target.value.slice(0, start) + token + target.value.slice(end);
      const field = target.name as keyof typeof draft;
      setDraft((d) => ({ ...d, [field]: next }));
      return;
    }
    setDraft((d) => ({ ...d, htmlAr: d.htmlAr + token }));
  }

  const verdict = current ? validateTemplate(draft, current.variables) : { ok: true as const };
  const usedVars = current
    ? [...new Set([
        ...extractVariables(draft.subjectAr), ...extractVariables(draft.subjectEn),
        ...extractVariables(draft.htmlAr), ...extractVariables(draft.htmlEn),
      ])]
    : [];

  const result = saveFetcher.data;
  const testResult = testFetcher.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">{t("et.title")}</h1>
        {/* provider state — honest banner, never a fake success path */}
        <Badge tone={loaderData.providerConfigured ? "success" : "warning"}>
          {loaderData.providerConfigured
            ? t("et.providerReady", { from: loaderData.emailFrom })
            : t("et.providerMissing")}
        </Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        {/* template list */}
        <Card>
          <CardHeader title={t("et.list")} />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {loaderData.templates.map((entry) => (
                <li key={entry.key}>
                  <button type="button" onClick={() => pick(entry)}
                    aria-current={entry.key === selectedKey ? "true" : undefined}
                    className={`flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2.5 text-start transition-colors duration-150 ${
                      entry.key === selectedKey ? "bg-primary-soft" : "hover:bg-surface-tint"
                    }`}>
                    <span className="text-sm font-bold text-text">{entry.name_ar ?? entry.key}</span>
                    <span className="num text-2xs text-text-muted" dir="ltr">{entry.key} · v{entry.version}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {current ? (
          <div className="flex min-w-0 flex-col gap-4">
            {/* variables */}
            <Card>
              <CardHeader title={t("et.variables")} />
              <CardBody className="flex flex-col gap-2">
                <ul className="flex flex-wrap gap-1.5">
                  {current.variables.map((name) => (
                    <li key={name}>
                      <button type="button" onClick={() => insertVariable(name)}
                        className="cursor-pointer rounded-md border border-border px-2 py-1 font-mono text-2xs text-text hover:bg-surface-tint"
                        dir="ltr" title={t("et.insertHint")}>
                        {`{{${name}}}`}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-text-muted">
                  {t("et.usedVariables")}: <span dir="ltr" className="font-mono">{usedVars.join(", ") || "—"}</span>
                </p>
              </CardBody>
            </Card>

            {/* editor */}
            <Card>
              <CardHeader title={`${current.name_ar ?? current.key} — v${current.version}`} />
              <CardBody className="flex flex-col gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>{t("et.subjectAr")}</span>
                    <input name="subject_ar" dir="rtl" value={draft.subjectAr}
                      onChange={(e) => setDraft({ ...draft, subjectAr: e.target.value })}
                      className="w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>{t("et.subjectEn")}</span>
                    <input name="subject_en" dir="ltr" value={draft.subjectEn}
                      onChange={(e) => setDraft({ ...draft, subjectEn: e.target.value })}
                      className="w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>{t("et.bodyAr")}</span>
                    <textarea name="html_ar" dir="rtl" rows={12} value={draft.htmlAr}
                      onFocus={(e) => { e.currentTarget.dataset.focus = "1"; }}
                      onChange={(e) => setDraft({ ...draft, htmlAr: e.target.value })}
                      className={INPUT} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>{t("et.bodyEn")}</span>
                    <textarea name="html_en" dir="ltr" rows={12} value={draft.htmlEn}
                      onChange={(e) => setDraft({ ...draft, htmlEn: e.target.value })}
                      className={INPUT} />
                  </label>
                </div>

                {!verdict.ok ? (
                  <p role="alert" className="text-xs font-bold text-danger">
                    {t(`et.err_${verdict.reason}`)}{verdict.detail ? ` — ${verdict.detail}` : ""}
                  </p>
                ) : null}
                {result && !result.ok ? (
                  <p role="alert" className="text-xs font-bold text-danger">
                    {t(`et.err_${result.reason}`)}{result.detail ? ` — ${result.detail}` : ""}
                  </p>
                ) : null}
                {result && result.ok && result.intent === "save" ? (
                  <p role="status" className="text-xs font-bold text-success-strong">
                    {t("et.saved", { version: result.version })}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <saveFetcher.Form method="post" onSubmit={(e) => { if (!verdict.ok) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="save" />
                    <input type="hidden" name="key" value={current.key} />
                    <input type="hidden" name="subject_ar" value={draft.subjectAr} />
                    <input type="hidden" name="subject_en" value={draft.subjectEn} />
                    <input type="hidden" name="html_ar" value={draft.htmlAr} />
                    <input type="hidden" name="html_en" value={draft.htmlEn} />
                    <Button type="submit" size="sm" disabled={busy || !verdict.ok}>{t("et.save")}</Button>
                  </saveFetcher.Form>
                  <Button type="button" size="sm" variant="outline" onClick={() => setTestOpen((v) => !v)}>
                    {t("et.testSend")}
                  </Button>
                </div>

                {/* test send — real attempt, logged in email_logs */}
                {testOpen ? (
                  <testFetcher.Form method="post" className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                    <input type="hidden" name="intent" value="test" />
                    <input type="hidden" name="key" value={current.key} />
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-text">{t("et.testTo")}</span>
                      <input name="to" type="email" required dir="ltr" value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                        className="w-56 rounded-md border border-border bg-surface p-2 text-sm text-text" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-text">{t("et.locale")}</span>
                      <select name="locale" className="rounded-md border border-border bg-surface p-2 text-sm text-text">
                        <option value="ar">{t("et.ar")}</option>
                        <option value="en">{t("et.en")}</option>
                      </select>
                    </label>
                    <Button type="submit" size="sm" disabled={testBusy}>{t("et.sendNow")}</Button>
                    {!loaderData.providerConfigured ? (
                      <p className="w-full text-xs font-bold text-warning-strong">{t("et.providerMissingHint")}</p>
                    ) : null}
                    {testResult && testResult.ok && testResult.intent === "test" ? (
                      <p role="status" className={`w-full text-xs font-bold ${
                        testResult.status === "sent" ? "text-success-strong"
                          : testResult.status === "not_configured" ? "text-warning-strong" : "text-danger"
                      }`}>
                        {t(`et.test_${testResult.status}`)} — {testResult.detail}
                      </p>
                    ) : null}
                  </testFetcher.Form>
                ) : null}
              </CardBody>
            </Card>

            {/* preview with sample data — iframe keeps the email's own styles out */}
            <Card>
              <CardHeader title={t("et.preview")} />
              <CardBody className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-bold text-text-muted">{t("et.subjectAr")}: <span className="text-text">{renderPreview(draft.subjectAr, SAMPLE_VARIABLES)}</span></p>
                  <iframe title={t("et.previewAr")} srcDoc={renderPreview(draft.htmlAr, SAMPLE_VARIABLES)}
                    sandbox="" className="h-72 w-full rounded-md border border-border bg-surface" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-bold text-text-muted">{t("et.subjectEn")}: <span className="text-text" dir="ltr">{renderPreview(draft.subjectEn, SAMPLE_VARIABLES)}</span></p>
                  <iframe title={t("et.previewEn")} srcDoc={renderPreview(draft.htmlEn, SAMPLE_VARIABLES)}
                    sandbox="" className="h-72 w-full rounded-md border border-border bg-surface" />
                </div>
              </CardBody>
            </Card>
          </div>
        ) : (
          <p className="text-sm text-text-muted">{t("ve.none")}</p>
        )}
      </div>
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
