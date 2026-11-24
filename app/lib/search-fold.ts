/**
 * Search folding shared by every search box. Mirrors SQL public.ar_norm
 * exactly (see supabase/migrations/20261110000038_search_fold_brands.sql):
 * a visitor typing `احمد` finds `أحمد`, and `toshiba` finds `توشيبا`.
 */
const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

export function foldSearch(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(DIGITS, (d) => {
      const code = d.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ء/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Folded, whitespace-split query tokens; empties removed. */
export function foldTokens(query: string): string[] {
  const folded = foldSearch(query);
  return folded ? folded.split(" ") : [];
}

/** Every query token is a substring of the folded haystack; empty query → true. */
export function matchesFolded(haystack: string, query: string): boolean {
  const tokens = foldTokens(query);
  if (tokens.length === 0) return true;
  const folded = foldSearch(haystack);
  return tokens.every((token) => folded.includes(token));
}
