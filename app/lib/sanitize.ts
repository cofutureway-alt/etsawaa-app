/**
 * HTML sanitization for admin-editable stored content.
 *
 * WHY sanitize at render time: blog bodies (`blog_posts.content_ar/_en`) and
 * email templates are raw HTML stored in the DB and editable by admin/staff.
 * Stored content is NOT trusted just because it came from the admin side — an
 * account with edit rights (or a compromised admin session / XSS in the admin
 * editor) must not be able to persist a script that then executes for every
 * visitor. Sanitizing at render time, on the final HTML string right before
 * it reaches `dangerouslySetInnerHTML` (or an email body), means no code path
 * can render untrusted HTML without passing through here, and older rows
 * written before any writer-side validation are cleaned up too.
 *
 * URI safety (http/https/mailto allowed; `javascript:`, `data:` URIs on
 * links, etc. rejected) is left at DOMPurify's defaults.
 */

import DOMPurify from "isomorphic-dompurify";
import { EMBED_HOSTS } from "./embed-hosts";

/**
 * Restrictive allowlist for article HTML. These lists REPLACE DOMPurify's
 * defaults. `id` and `class` are allowed on purpose: `withHeadingIds()`
 * injects `sec-N` ids for the table of contents and article styling relies
 * on classes (`ets-btn` buttons from the editor) — DOMPurify still strips
 * event handlers (`on*` attributes), `javascript:` URIs and DOM-clobbering
 * ids/names by default.
 *
 * Rich media from the editor: `<iframe>` survives only for the video hosts in
 * EMBED_HOSTS (anything else is dropped), `<video>/<audio>/<source>` keep
 * plain http(s) sources, and `style` is cut down to STYLE_PROPS so the
 * editor's alignment and colours work without letting content restyle or
 * overlay the page.
 */
const BLOG_ALLOWED_TAGS = [
  // headings + block structure
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "blockquote", "div", "span",
  "figure", "figcaption",
  // media + links
  "a", "img", "iframe", "video", "audio", "source",
  // lists
  "ul", "ol", "li",
  // inline formatting
  "strong", "em", "b", "i", "u", "s", "small", "mark", "sub", "sup",
  // code
  "code", "pre",
  // tables
  "table", "thead", "tbody", "tr", "th", "td",
] as const;

const BLOG_ALLOWED_ATTR = [
  "href", "src", "alt", "title", "width", "height", "loading",
  "target", "rel", "colspan", "rowspan",
  "id", "class", "style", "dir",
  // media
  "controls", "poster", "preload", "playsinline", "muted", "loop", "type",
  "allow", "allowfullscreen", "frameborder", "referrerpolicy",
] as const;

/** Product descriptions are written by sellers: text formatting, lists, tables and links only. */
const PRODUCT_ALLOWED_TAGS = [
  "h2", "h3", "h4", "p", "br", "hr", "blockquote", "span",
  "a", "ul", "ol", "li",
  "strong", "em", "b", "i", "u", "s", "small", "mark", "sub", "sup",
  "table", "thead", "tbody", "tr", "th", "td",
] as const;
const PRODUCT_ALLOWED_ATTR = ["href", "title", "target", "rel", "colspan", "rowspan", "style", "dir"] as const;

export { EMBED_HOSTS };

const STYLE_PROPS = new Set([
  "text-align", "color", "background-color", "font-weight", "font-style", "text-decoration",
  "width", "height", "max-width", "aspect-ratio", "float", "margin-left", "margin-right",
  "display", "border-collapse",
]);

function embedAllowed(src: string): boolean {
  try {
    const url = new URL(src, "https://x.invalid");
    return url.protocol === "https:" && (EMBED_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/** Keep only allow-listed declarations without url()/expression(). */
function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      const i = decl.indexOf(":");
      if (i < 1) return false;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).toLowerCase();
      return STYLE_PROPS.has(prop) && !/url\(|expression|javascript:/.test(value);
    })
    .join("; ");
}

function sanitizeRich(html: string, tags: readonly string[], attrs: readonly string[], ugcLinks: boolean): string {
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "iframe" && !embedAllowed((node as Element).getAttribute?.("src") ?? "")) {
      node.parentNode?.removeChild(node);
    }
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (!el.getAttribute) return;
    const style = el.getAttribute("style");
    if (style != null) {
      const cleaned = cleanStyle(style);
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
    }
    if (el.tagName === "A" && el.getAttribute("href")) {
      const rel = new Set((el.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean));
      if (el.getAttribute("target") === "_blank") rel.add("noopener");
      // seller-written links never pass ranking to outside sites
      if (ugcLinks) { rel.add("nofollow"); rel.add("ugc"); }
      if (rel.size) el.setAttribute("rel", [...rel].join(" "));
    }
    if (el.tagName === "IFRAME") {
      el.setAttribute("loading", "lazy");
      el.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    }
  });
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...tags],
      ALLOWED_ATTR: [...attrs],
      ADD_URI_SAFE_ATTR: ["poster"],
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeElement");
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

/** Sanitize stored article HTML down to the allowlist. Idempotent. */
export function sanitizeBlogHtml(html: string): string {
  return sanitizeRich(html, BLOG_ALLOWED_TAGS, BLOG_ALLOWED_ATTR, false);
}

/** Sanitize a seller-written product description (no media, links marked nofollow ugc). */
export function sanitizeProductHtml(html: string): string {
  return sanitizeRich(normalizeSpaces(html), PRODUCT_ALLOWED_TAGS, PRODUCT_ALLOWED_ATTR, true);
}

/**
 * Text pasted from Word / WhatsApp often separates words with NO-BREAK spaces
 * (U+00A0 / &nbsp;), which the browser never wraps — a whole description then
 * runs off the page as one line. Seller descriptions read them as ordinary
 * spaces, and paragraphs holding nothing but such spaces are dropped.
 */
export function normalizeSpaces(html: string): string {
  return html
    .replace(/ |&nbsp;|&#160;/gi, " ")
    .replace(/<p[^>]*>\s*<\/p>/gi, "")
    .trim();
}

/** True when a stored description is HTML from the editor (older ones are plain text). */
export function isRichHtml(value: string): boolean {
  return /<(p|br|h[1-6]|ul|ol|li|strong|em|b|i|u|a|table|blockquote|span|div)\b[^>]*>/i.test(value);
}

/** Plain text of an HTML snippet — for meta descriptions and card snippets. */
export function htmlToText(value: string): string {
  if (!isRichHtml(value)) return value;
  return value
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape the five HTML-significant characters (`& < > " '`) so a plain-text
 * value can be interpolated into an HTML template without injecting markup.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}
