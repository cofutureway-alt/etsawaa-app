import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailFrom, getResendApiKey } from "~/lib/env.server";

/**
 * Transactional email wiring (F-18).
 * - Templates live in the `email_templates` DB table (subject + HTML, ar/en,
 *   {{variables}}) — editable from admin, previewable.
 * - Provider: Resend over its HTTPS API (AGENT.md §2). When RESEND_API_KEY or
 *   the service-role key is missing the function returns `not_configured` —
 *   it never pretends an email was sent.
 * - Every attempt is recorded in `email_logs` (to, template, status, error).
 */

export interface EmailTemplateRow {
  key: string;
  subject_ar: string;
  subject_en: string;
  html_ar: string;
  html_en: string;
}

export interface SendEmailInput {
  to: string;
  templateKey: string;
  locale: "ar" | "en";
  variables: Record<string, string>;
}

export type SendEmailResult =
  | { status: "sent"; messageId: string }
  | { status: "failed"; error: string }
  | { status: "not_configured"; error: string };

/** Substitute {{variables}} in a template string. Pure — unit-testable. */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = variables[name];
    return value === undefined ? match : value;
  });
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

async function sendWithResend(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) {
      return { ok: false, error: body?.message ?? `Resend HTTP ${response.status}` };
    }
    return { ok: true, messageId: body?.id ?? "unknown" };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "network error" };
  }
}

export async function sendEmail(
  adminClient: SupabaseClient | null,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!adminClient) {
    const error = "SUPABASE_SERVICE_ROLE_KEY missing: cannot read templates or write email_logs";
    await logEmail(null, {
      to_email: input.to, template: input.templateKey, status: "failed", error, provider: "resend", message_id: null,
    });
    return { status: "not_configured", error };
  }

  const { data: template, error: templateError } = await adminClient
    .from("email_templates")
    .select("key, subject_ar, subject_en, html_ar, html_en")
    .eq("key", input.templateKey)
    .single();
  if (templateError || !template) {
    return { status: "failed", error: `template "${input.templateKey}" not found` };
  }
  const row = template as EmailTemplateRow;
  const subject = renderTemplate(input.locale === "ar" ? row.subject_ar : row.subject_en, input.variables);
  const html = renderTemplate(input.locale === "ar" ? row.html_ar : row.html_en, input.variables);

  const result = await sendWithResend({
    from: getEmailFrom(),
    to: input.to,
    subject,
    html,
  });

  if (!result.ok) {
    await logEmail(adminClient, {
      to_email: input.to, template: input.templateKey, status: "failed", error: result.error, provider: "resend", message_id: null,
    });
    return { status: "failed", error: result.error };
  }

  await logEmail(adminClient, {
    to_email: input.to, template: input.templateKey, status: "sent", error: null, provider: "resend", message_id: result.messageId,
  });
  return { status: "sent", messageId: result.messageId };
}
