/**
 * Legal documents — the parts shared by server and browser code: types, URL
 * slugs, and the plain-text editor format used by the admin publish form.
 */
export type LegalKind = "terms" | "seller_agreement";
export interface LegalSection { title: { ar: string; en: string }; clauses: Array<{ ar: string; en: string }> }
export interface LegalDoc {
  id: string;
  kind: LegalKind;
  version: string;
  title_ar: string;
  title_en: string;
  body: { sections: LegalSection[] };
  content_hash: string;
  effective_at: string;
  is_current: boolean;
  notes: string | null;
}
export interface LegalStatus {
  terms: { version: string | null; accepted: boolean; accepted_at: string | null };
  seller_agreement: { version: string | null; accepted: boolean; required: boolean; accepted_at: string | null };
}

/** `slug` in URLs: terms | seller-agreement */
export const kindFromSlug = (slug: string | undefined): LegalKind | null =>
  slug === "terms" ? "terms" : slug === "seller-agreement" ? "seller_agreement" : null;

/**
 * Parse the admin's plain-text format into the structured body:
 *   "# Section title" opens a section; every other non-empty line is a clause
 *   (a leading "•", "-" or "*" is dropped). Arabic and English are typed in
 *   two boxes that must have the same sections and the same clause count.
 */
export function parseLegalText(ar: string, en: string): { ok: true; body: { sections: LegalSection[] } } | { ok: false; reason: string } {
  const parse = (text: string) => {
    const out: Array<{ title: string; clauses: string[] }> = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) { out.push({ title: line.replace(/^#+\s*/, ""), clauses: [] }); continue; }
      if (out.length === 0) out.push({ title: "", clauses: [] });
      out[out.length - 1]!.clauses.push(line.replace(/^[•\-*]\s*/, ""));
    }
    return out;
  };
  const a = parse(ar);
  const e = parse(en);
  if (a.length === 0) return { ok: false, reason: "empty_body" };
  if (a.length !== e.length) return { ok: false, reason: "sections_mismatch" };
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.clauses.length !== e[i]!.clauses.length) return { ok: false, reason: "clauses_mismatch" };
  }
  return {
    ok: true,
    body: {
      sections: a.map((s, i) => ({
        title: { ar: s.title, en: e[i]!.title },
        clauses: s.clauses.map((c, j) => ({ ar: c, en: e[i]!.clauses[j]! })),
      })),
    },
  };
}

/** The inverse of parseLegalText, to prefill the editor with the current version. */
export function legalToText(body: { sections: LegalSection[] }, lang: "ar" | "en"): string {
  return body.sections.map((s) => [`# ${s.title[lang]}`, ...s.clauses.map((c) => `• ${c[lang]}`)].join("\n")).join("\n\n");
}
