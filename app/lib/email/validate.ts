/**
 * Email template validation (A-25). Pure functions — unit-tested.
 * Rules (owner review): unknown {{variables}} are rejected, unclosed tags are
 * rejected, an empty subject or body never saves.
 */

/** All {{name}} placeholders in a string, deduplicated, in first-seen order. */
export function extractVariables(source: string): string[] {
  const seen: string[] = [];
  for (const match of source.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    const name = match[1] ?? "";
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr", "!doctype",
]);

/**
 * Returns the list of structural problems: unclosed, mismatched, or stray
 * closing tags. Ignores comments, doctype, void elements and self-closing
 * tags. Deliberately simple — it guards templates, not arbitrary HTML.
 */
export function tagErrors(html: string): string[] {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const errors: string[] = [];
  const stack: string[] = [];
  for (const match of cleaned.matchAll(/<\s*(\/?)\s*([a-zA-Z!][\w-]*)([^>]*)>/g)) {
    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLowerCase();
    if (!name) continue;
    const rest = match[3] ?? "";
    if (name.startsWith("!")) continue;
    if (!closing) {
      if (VOID_TAGS.has(name) || /\/\s*$/.test(rest)) continue;
      stack.push(name);
      continue;
    }
    const top = stack.pop();
    if (top !== name) {
      errors.push(top ? `expected </${top}> but found </${name}>` : `stray closing tag </${name}>`);
      return errors; // one structural error is enough to block the save
    }
  }
  if (stack.length > 0) errors.push(`unclosed tag <${stack[stack.length - 1]}>`);
  return errors;
}

export interface TemplateDraft {
  subjectAr: string;
  subjectEn: string;
  htmlAr: string;
  htmlEn: string;
}

export type TemplateValidation =
  | { ok: true }
  | { ok: false; reason: "empty_subject" | "empty_body" | "unknown_variables" | "bad_tags"; detail: string };

/**
 * Full validation of a draft against the template's declared variables.
 * `declared` is `email_templates.variables` (the allowed placeholder names).
 */
export function validateTemplate(draft: TemplateDraft, declared: readonly string[]): TemplateValidation {
  const subjects = [draft.subjectAr, draft.subjectEn];
  const bodies = [draft.htmlAr, draft.htmlEn];
  if (subjects.some((s) => s.trim() === "")) {
    return { ok: false, reason: "empty_subject", detail: "both subject lines are required" };
  }
  if (bodies.some((b) => b.trim() === "")) {
    return { ok: false, reason: "empty_body", detail: "both bodies are required" };
  }
  const used = [
    ...extractVariables(draft.subjectAr),
    ...extractVariables(draft.subjectEn),
    ...extractVariables(draft.htmlAr),
    ...extractVariables(draft.htmlEn),
  ];
  const unknown = [...new Set(used.filter((name) => !declared.includes(name)))];
  if (unknown.length > 0) {
    return { ok: false, reason: "unknown_variables", detail: unknown.join(", ") };
  }
  for (const [index, body] of bodies.entries()) {
    const errors = tagErrors(body);
    if (errors.length > 0) {
      return { ok: false, reason: "bad_tags", detail: `${index === 0 ? "ar" : "en"}: ${errors[0]}` };
    }
  }
  return { ok: true };
}

/** Render a template string with sample data for the admin preview. */
export function renderPreview(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

/** Deterministic sample values for the preview (never sent to a customer). */
export const SAMPLE_VARIABLES: Record<string, string> = {
  name: "أحمد",
  customer_name: "أحمد محمود",
  site_name: "اتسوء",
  site_url: "https://etsawaa.example",
  order_number: "ETS-26-1042",
  order_total: "1,250.00 ج.م",
  payment_method: "الدفع عند الاستلام",
  track_url: "https://etsawaa.example/ar/order/ETS-26-1042/track",
  order_url: "https://etsawaa.example/ar/order/ETS-26-1042",
  retry_url: "https://etsawaa.example/ar/order/ETS-26-1042",
  reason: "نفاد المخزون",
  review_days: "7",
  return_days: "14",
};
