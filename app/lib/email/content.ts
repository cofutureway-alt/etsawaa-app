import { z } from "zod";
import { extractVariables } from "./validate";

const line = z.string().max(2000);
export const emailContentSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  preheader: z.string().trim().max(300),
  heading: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(12000),
  details: z.array(z.object({ label: line, value: line }).strict()).max(12),
  buttonLabel: z.string().max(120),
  buttonUrl: z.string().max(2000),
  note: z.string().max(3000),
  code: z.string().max(120),
}).strict();
export type EmailContent = z.infer<typeof emailContentSchema>;
export type EmailTranslation = { ar: EmailContent; en: EmailContent };

export const htmlEscape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function fillText(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}
export function contentVariables(c: EmailContent): string[] {
  return extractVariables(JSON.stringify(c));
}

/** No HTML, arbitrary CSS, or executable URL can enter through content fields. */
export function validateContent(value: unknown, declared: readonly string[]): { ok: true; content: EmailTranslation } | { ok: false; reason: string } {
  const parsed = z.object({ ar: emailContentSchema, en: emailContentSchema }).strict().safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid_content" };
  for (const c of Object.values(parsed.data)) {
    if (contentVariables(c).some((v) => !declared.includes(v))) return { ok: false, reason: "unknown_variables" };
    if (Boolean(c.buttonLabel.trim()) !== Boolean(c.buttonUrl.trim())) return { ok: false, reason: "invalid_button" };
    // Placeholder URLs are resolved and checked again immediately before sending.
    if (c.buttonUrl && !/^\{\{\s*\w+\s*\}\}$/.test(c.buttonUrl) && !safeEmailUrl(c.buttonUrl)) return { ok: false, reason: "invalid_url" };
  }
  return { ok: true, content: parsed.data };
}

export function safeEmailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !/[\r\n]/.test(value);
  } catch { return false; }
}

export function localizeEmailUrl(value: string, locale: "ar" | "en", siteUrl: string): string {
  try {
    const url = new URL(value);
    const site = new URL(siteUrl);
    if (url.origin === site.origin) {
      if (/^\/(ar|en)(\/|$)/.test(url.pathname)) url.pathname = url.pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${locale}`);
      else if (url.pathname === "/") url.pathname = `/${locale}`;
    }
    return url.href;
  } catch { return value; }
}

/** One email-safe frame shared by preview, test delivery, Auth and normal SMTP. */
export function renderEmailContent(content: EmailContent, locale: "ar" | "en", variables: Record<string, string>, siteUrl = "https://etsawaa.com", templateMode = false): { subject: string; html: string } {
  const missing = contentVariables(content).filter((k) => variables[k] === undefined);
  if (missing.length) throw new Error(`missing_variables:${missing.join(",")}`);
  const ar = locale === "ar";
  const site = safeEmailUrl(siteUrl) ? new URL(siteUrl).origin : "https://etsawaa.com";
  const text = (s: string) => htmlEscape(fillText(s, variables));
  const lines = (s: string) => text(s).replace(/\n/g, "<br>");
  const href = content.buttonUrl ? localizeEmailUrl(fillText(content.buttonUrl, variables), locale, site) : "";
  if (href && !safeEmailUrl(href) && !(templateMode && /^\{\{\s*\w+\s*\}\}$/.test(href))) throw new Error("invalid_button_url");
  const font = ar ? "Cairo,Tahoma,Arial,sans-serif" : "Cairo,Arial,Helvetica,sans-serif";
  const align = ar ? "right" : "left";
  const details = content.details.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#fafafa;border:1px solid #e5e7eb;border-radius:12px">${content.details.map((d) => `<tr><td style="padding:12px 16px;font-size:13px;color:#596273;vertical-align:top;width:38%">${text(d.label)}</td><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#1f2937;overflow-wrap:anywhere">${text(d.value)}</td></tr>`).join("")}</table>` : "";
  const button = href ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td align="center" bgcolor="#be0404" style="border-radius:10px;mso-padding-alt:14px 28px"><a href="${htmlEscape(href)}" style="display:inline-block;padding:14px 28px;background:#be0404;border:1px solid #be0404;border-radius:10px;color:#ffffff;text-decoration:none;font-family:${font};font-size:15px;line-height:24px;font-weight:700;text-align:center">${text(content.buttonLabel)}</a></td></tr></table>` : "";
  const code = content.code ? `<p dir="ltr" style="margin:24px 0;padding:20px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff4f4;color:#510504;font-family:Consolas,Menlo,monospace;font-size:34px;line-height:44px;font-weight:700;letter-spacing:7px;text-align:center">${text(content.code)}</p>` : "";
  const body = content.body.split(/\n\s*\n/).map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.9;overflow-wrap:anywhere">${lines(p)}</p>`).join("");
  const footer = ar ? "تحتاج مساعدة؟ فريق إتسوء موجود لمساعدتك." : "Need a hand? The Etsawaa team is here to help.";
  const html = `<!doctype html><html lang="${locale}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${text(content.subject)}</title><style>@font-face{font-family:Cairo;font-style:normal;font-weight:200 1000;src:url('${site}/fonts/cairo-var-${ar ? "arabic" : "latin"}.woff2') format('woff2')}@media only screen and (max-width:600px){.email-outer{padding:16px 8px!important}.email-content{padding:26px 20px!important}.email-heading{font-size:24px!important}}</style></head><body style="margin:0;padding:0;background:#f5f5f6;color:#1f2937;font-family:${font};-webkit-text-size-adjust:100%"><div data-email-preheader style="display:none!important;visibility:hidden;mso-hide:all;max-height:0;overflow:hidden;font-size:1px;line-height:1px">${text(content.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f6"><tr><td class="email-outer" align="center" style="padding:36px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px"><tr><td align="center" style="padding:24px 24px 20px;border-bottom:1px solid #f1f1f1"><a href="${site}/${locale}" style="text-decoration:none"><img src="${site}/logo-transparent.png" width="154" alt="${ar ? "إتسوء" : "Etsawaa"}" style="display:block;width:154px;max-width:100%;height:auto;border:0"></a></td></tr><tr><td class="email-content" dir="${ar ? "rtl" : "ltr"}" style="padding:34px 36px;text-align:${align};font-family:${font}"><h1 class="email-heading" style="margin:0 0 20px;font-size:28px;line-height:1.5;font-weight:800;color:#510504;overflow-wrap:anywhere">${text(content.heading)}</h1>${body}${code}${details}${button}${content.note ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.9;color:#596273">${lines(content.note)}</p>` : ""}</td></tr><tr><td align="center" style="padding:22px 24px;border-top:1px solid #e5e7eb;background:#fafafa;font-family:${font};font-size:13px;line-height:1.9;color:#596273">${footer}<br><a href="${site}/${locale}/contact" style="color:#be0404;text-decoration:underline">${ar ? "تواصل معنا" : "Contact us"}</a><br><a href="${site}/${locale}" style="color:#596273;text-decoration:none">etsawaa.com</a></td></tr></table><p style="margin:18px 0 0;font-family:${font};font-size:12px;line-height:1.8;color:#596273">${ar ? "إتسوء · كل خطوة أقرب لاختيارك" : "Etsawaa · Find your next favourite"}</p></td></tr></table></body></html>`;
  return { subject: fillText(content.subject, variables).replace(/[\r\n]+/g, " "), html };
}

/** Preserve placeholder HTML for an older application image during rollback. */
export function compileEmailTemplate(content: EmailContent, locale: "ar" | "en", variables: readonly string[], siteUrl?: string): string {
  return renderEmailContent(content, locale, Object.fromEntries(variables.map((v) => [v, `{{${v}}}`])), siteUrl, true).html;
}
