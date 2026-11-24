import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer, { type Transporter } from "nodemailer";
import { getSmtpSender, type SmtpSender } from "~/lib/env.server";
import { escapeHtml } from "~/lib/sanitize";
import { htmlToText, senderFor, type EmailSender } from "./sender";
import { emailContentSchema, renderEmailContent, type EmailContent } from "./content";

/**
 * Transactional email wiring (F-18).
 * - Templates live in the `email_templates` DB table (subject + HTML, ar/en,
 *   {{variables}}) — editable from admin, previewable.
 * - Provider: our own mail server (Stalwart, mx.etsawaa.com) over SMTP 465.
 *   Account/order/event mail goes from notifications@, contact mail from
 *   support@ (see ./sender.ts). When that mailbox's SMTP credentials or the
 *   service-role key are missing the function returns `not_configured` —
 *   it never pretends an email was sent.
 * - Every attempt is recorded in `email_logs` (to, template, status, error).
 */

export interface EmailTemplateRow {
  key: string;
  subject_ar: string;
  subject_en: string;
  html_ar: string;
  html_en: string;
  content_ar?: unknown;
  content_en?: unknown;
  is_active?: boolean;
}

export interface SendEmailInput {
  to: string;
  templateKey: string;
  locale: "ar" | "en";
  variables: Record<string, string>;
  /** Which of our mailboxes sends it; default: support for contact_* templates, notifications otherwise. */
  sender?: EmailSender;
  /** Validated admin test draft, never a customer-facing input. */
  content?: EmailContent;
  /** Send even when the template's own switch is off (Admin → Messages decides instead). */
  force?: boolean;
}

export type SendEmailResult =
  | { status: "sent"; messageId: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; error: string }
  | { status: "not_configured"; error: string };

/**
 * Substitute {{variables}} in a template string. Every substituted VALUE is
 * HTML-escaped (the surrounding admin-authored template markup is not) so
 * order/customer data (names, phones, ...) cannot inject markup or script
 * into the rendered email. Unknown variables are left as-is. Pure —
 * unit-testable.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = variables[name];
    return value === undefined ? match : escapeHtml(value);
  });
}

/**
 * Plain-text variant for the subject line. A subject is not HTML — escaping
 * would show "&amp;" / "&#39;" literally in the inbox — so values go in raw,
 * with line breaks collapsed so a value cannot split the header.
 */
export function renderSubject(template: string, variables: Record<string, string>): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => variables[name] ?? match)
    .replace(/[\r\n]+/g, " ");
}

async function logEmail(
  adminClient: SupabaseClient | null,
  row: { to_email: string; template: string; status: string; error: string | null; provider: string; message_id: string | null },
): Promise<void> {
  if (!adminClient) {
    console.warn("[email] email_logs row could not be persisted (no service client)", row);
    return;
  }
  const { error } = await adminClient.from("email_logs").insert(row);
  if (error) console.error("[email] failed to log email", error.message);
}

// One pooled connection per mailbox, reused across sends.
const transports = new Map<string, Transporter>();

function transportFor(cfg: SmtpSender): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: cfg.port !== 465,
      auth: { user: cfg.user, pass: cfg.pass },
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    transports.set(key, t);
  }
  return t;
}

async function sendWithSmtp(cfg: SmtpSender, input: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const info = await transportFor(cfg).sendMail({
      from: cfg.from,
      to: input.to,
      ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
      subject: input.subject,
      html: input.html,
      text: htmlToText(input.html),
    });
    if (info.rejected?.length) return { ok: false, error: `rejected: ${info.rejected.join(", ")}` };
    return { ok: true, messageId: info.messageId ?? "unknown" };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "smtp error" };
  }
}

export async function sendEmail(
  adminClient: SupabaseClient | null,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!adminClient) {
    const error = "SUPABASE_SERVICE_ROLE_KEY missing: cannot read templates or write email_logs";
    await logEmail(null, {
      to_email: input.to, template: input.templateKey, status: "failed", error, provider: "smtp", message_id: null,
    });
    return { status: "not_configured", error };
  }

  const sender = senderFor(input.templateKey, input.sender);
  const provider = `smtp:${sender}`;
  const smtp = getSmtpSender(sender);
  if (!smtp) {
    const error = `SMTP credentials for ${sender}@ missing`;
    await logEmail(adminClient, {
      to_email: input.to, template: input.templateKey, status: "failed", error, provider, message_id: null,
    });
    return { status: "not_configured", error };
  }

  const { data: template, error: templateError } = await adminClient
    .from("email_templates")
    .select("key, subject_ar, subject_en, html_ar, html_en, content_ar, content_en, is_active")
    .eq("key", input.templateKey)
    .single();
  if (templateError || !template) {
    return { status: "failed", error: `template "${input.templateKey}" not found` };
  }
  const row = template as EmailTemplateRow;
  if (row.is_active === false && !input.templateKey.startsWith("auth:") && !input.content && !input.force) return { status: "skipped", error: "template_inactive" };
  let subject: string, html: string;
  try {
    const structured = input.content ?? (input.locale === "ar" ? row.content_ar : row.content_en);
    if (structured) {
      const rendered = renderEmailContent(emailContentSchema.parse(structured), input.locale, input.variables, process.env.SITE_URL);
      subject = rendered.subject;
      html = rendered.html;
    } else {
      subject = renderSubject(input.locale === "ar" ? row.subject_ar : row.subject_en, input.variables);
      html = renderTemplate(input.locale === "ar" ? row.html_ar : row.html_en, input.variables);
    }
  } catch {
    await logEmail(adminClient, { to_email: input.to, template: input.templateKey, status: "failed", error: "invalid_template_or_variables", provider, message_id: null });
    return { status: "failed", error: "invalid_template_or_variables" };
  }

  const result = await sendWithSmtp(smtp, { to: input.to, subject, html });

  if (!result.ok) {
    await logEmail(adminClient, {
      to_email: input.to, template: input.templateKey, status: "failed", error: result.error, provider, message_id: null,
    });
    return { status: "failed", error: result.error };
  }

  await logEmail(adminClient, {
    to_email: input.to, template: input.templateKey, status: "sent", error: null, provider, message_id: result.messageId,
  });
  return { status: "sent", messageId: result.messageId };
}
