/**
 * Which of our own mailboxes sends an email, plus the plain-text part.
 * Pure: covered by tests/email-sender.test.ts.
 *
 * - notifications@etsawaa.com: account, order and event emails (default).
 * - support@etsawaa.com: contact-form mail and admin replies to customers.
 * - no-reply@etsawaa.com is used by Supabase Auth (codes), not by this app.
 */
export type EmailSender = "notifications" | "support";

export function senderFor(templateKey: string, explicit?: EmailSender): EmailSender {
  if (explicit) return explicit;
  return templateKey.startsWith("contact_") ? "support" : "notifications";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Readable plain-text alternative of an HTML email (links keep their URL). */
export function htmlToText(html: string): string {
  return html
    .replace(/<div\b[^>]*data-email-preheader[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_m, e: string) => ENTITIES[e] ?? _m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
