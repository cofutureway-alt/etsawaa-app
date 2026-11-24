import fs from "node:fs";
import path from "node:path";
import { escapeHtml } from "~/lib/sanitize";

/**
 * The category site map as a downloadable PDF, one per language.
 *
 * Arabic needs real text shaping and right-to-left layout, which the pure-JS
 * PDF writers do not do; the PDF is therefore printed by headless Chrome
 * (playwright-core) from a self-contained HTML document with the Cairo font
 * embedded, so no network request happens during rendering. All four
 * category levels are listed and every one is a live link to its page.
 *
 * Results are cached in memory per language + category set, so Chrome runs
 * only when the categories change. When no Chrome is available on the host
 * (`CHROME_PATH` unset and none found), `renderSitemapPdf` returns null and
 * the route serves the same document as printable HTML instead.
 */

export interface SitemapCategory {
  id: string;
  parent_id: string | null;
  name_ar: string;
  name_en: string;
  slug_ar: string;
  slug_en: string;
  sort: number;
}

const cache = new Map<string, Buffer>();
const inFlight = new Map<string, Promise<Buffer | null>>();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function chromePath(): string | null {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function fontFace(): string {
  const dir = path.join(process.cwd(), "public", "fonts");
  const face = (file: string, range: string) => {
    try {
      const b64 = fs.readFileSync(path.join(dir, file)).toString("base64");
      return `@font-face{font-family:Cairo;src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:200 1000;${range}}`;
    } catch {
      return "";
    }
  };
  return face("cairo-var-arabic.woff2", "unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF;") + face("cairo-var-latin.woff2", "");
}

export function sitemapHtml(lang: "ar" | "en", categories: SitemapCategory[], siteUrl: string, opts: { print?: boolean } = {}): string {
  const isAr = lang === "ar";
  const name = (c: SitemapCategory) => (isAr ? c.name_ar || c.name_en : c.name_en || c.name_ar);
  const href = (c: SitemapCategory) =>
    `${siteUrl}/${lang}/category/${encodeURIComponent(isAr ? c.slug_ar || c.slug_en : c.slug_en || c.slug_ar)}`;
  const byParent = new Map<string | null, SitemapCategory[]>();
  for (const c of [...categories].sort((a, b) => a.sort - b.sort)) {
    const list = byParent.get(c.parent_id) ?? [];
    list.push(c);
    byParent.set(c.parent_id, list);
  }
  const roots = byParent.get(null) ?? [];
  const count = categories.length;
  const date = new Date().toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const T = isAr
    ? { title: "خريطة أقسام إتسوء", sub: "كل الأقسام والأقسام الفرعية المتاحة للبيع على إتسوء. اختر القسم المناسب لمنتجاتك عند إضافتها.", cats: "قسمًا", updated: "آخر تحديث", start: "ابدأ البيع", url: `${siteUrl}/ar/sell`, site: "إتسوء — تسوّق من بائعين مصريين موثوقين في مكان واحد" }
    : { title: "Etsawaa category site map", sub: "Every category and sub-category open for selling on Etsawaa. Pick the right one for your products when you add them.", cats: "categories", updated: "Updated", start: "Start selling", url: `${siteUrl}/en/sell`, site: "Etsawaa — Shop trusted Egyptian sellers, all in one place" };

  const block = (root: SitemapCategory) => {
    const subs = byParent.get(root.id) ?? [];
    const items = subs
      .map((sub) => {
        const leaves = byParent.get(sub.id) ?? [];
        // level 3 as a line each, level 4 inline after it
        const leafList = leaves.length
          ? `<ul class="leaves">${leaves
              .map((l) => {
                const tips = byParent.get(l.id) ?? [];
                const tipList = tips.length
                  ? `<span class="tips">${tips.map((x) => `<a href="${escapeHtml(href(x))}">${escapeHtml(name(x))}</a>`).join(" · ")}</span>`
                  : "";
                return `<li><a class="leaf" href="${escapeHtml(href(l))}">${escapeHtml(name(l))}</a>${tipList}</li>`;
              })
              .join("")}</ul>`
          : "";
        return `<li><a class="sub" href="${escapeHtml(href(sub))}">${escapeHtml(name(sub))}</a>${leafList}</li>`;
      })
      .join("");
    return `<section class="cat"><h2><a href="${escapeHtml(href(root))}">${escapeHtml(name(root))}</a><span>${subs.length || ""}</span></h2>${items ? `<ul class="subs">${items}</ul>` : ""}</section>`;
  };

  return `<!doctype html>
<html lang="${lang}" dir="${isAr ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(T.title)}</title>
<style>
${fontFace()}
@page { size: A4; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Cairo, "Segoe UI", Tahoma, sans-serif; color: #1c1c1c; font-size: 11pt; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
a { color: inherit; text-decoration: none; }
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #be0404; margin-bottom: 16px; }
header h1 { font-size: 22pt; font-weight: 900; line-height: 1.25; }
header p { color: #555; font-size: 10pt; max-width: 120mm; }
.meta { text-align: end; font-size: 9pt; color: #555; white-space: nowrap; }
.meta b { display: block; font-size: 20pt; color: #be0404; font-weight: 900; line-height: 1.1; }
.grid { column-count: 2; column-gap: 8mm; }
.cat { break-inside: avoid; border: 1px solid #e7e2df; border-radius: 10px; padding: 9px 12px 10px; margin-bottom: 7mm; background: #fff; }
.cat h2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5pt; font-weight: 900; color: #be0404; padding-bottom: 5px; margin-bottom: 6px; border-bottom: 1px solid #f1e9e6; }
.cat h2 span { font-size: 8.5pt; color: #8a8a8a; font-weight: 700; }
.subs { list-style: none; display: flex; flex-direction: column; gap: 3px; }
.sub { font-weight: 800; font-size: 10.5pt; }
.leaves { list-style: none; display: flex; flex-direction: column; gap: 1px; padding-inline-start: 10px; margin: 1px 0 4px; color: #444; font-size: 9.5pt; }
.leaf { font-weight: 700; }
.tips { display: block; padding-inline-start: 10px; color: #6b6b6b; font-size: 8.5pt; line-height: 1.5; }
footer { margin-top: 6mm; padding-top: 8px; border-top: 1px solid #e7e2df; display: flex; justify-content: space-between; font-size: 9pt; color: #555; }
footer a { color: #be0404; font-weight: 800; }
${opts.print ? "@media screen { body { max-width: 210mm; margin: 24px auto; padding: 0 16px; } .hint { display:block; background:#fff4f4; border:1px solid #f3c9c9; padding:10px 14px; border-radius:10px; margin-bottom:16px; font-size:10pt; } } @media print { .hint { display:none; } } .hint { display:none; }" : ""}
</style>
</head>
<body>
${opts.print ? `<p class="hint">${isAr ? "لحفظ الملف بصيغة PDF اختر «حفظ كـ PDF» من نافذة الطباعة." : "To keep a PDF, choose “Save as PDF” in the print dialog."}</p>` : ""}
<header>
  <div><h1>${escapeHtml(T.title)}</h1><p>${escapeHtml(T.sub)}</p></div>
  <div class="meta"><b>${count}</b>${escapeHtml(T.cats)}<br>${escapeHtml(T.updated)}: ${escapeHtml(date)}</div>
</header>
<main class="grid">${roots.map(block).join("")}</main>
<footer><span>${escapeHtml(T.site)}</span><a href="${escapeHtml(T.url)}">${escapeHtml(T.start)}: ${escapeHtml(T.url.replace(/^https?:\/\//, ""))}</a></footer>
${opts.print ? "<script>addEventListener('load',()=>setTimeout(()=>print(),300))</script>" : ""}
</body>
</html>`;
}

/** Cache key: language + the exact category set (ids, names, slugs, order). */
export function sitemapKey(lang: string, categories: SitemapCategory[]): string {
  let h = 0x811c9dc5;
  const s = lang + JSON.stringify(categories.map((c) => [c.id, c.parent_id, c.name_ar, c.name_en, c.slug_ar, c.slug_en, c.sort]));
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${lang}:${(h >>> 0).toString(36)}:${categories.length}`;
}

export async function renderSitemapPdf(lang: "ar" | "en", categories: SitemapCategory[], siteUrl: string): Promise<Buffer | null> {
  const key = sitemapKey(lang, categories);
  const hit = cache.get(key);
  if (hit) return hit;
  // concurrent first downloads share one Chrome run
  const pending = inFlight.get(key) ?? printPdf(key, lang, categories, siteUrl).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function printPdf(key: string, lang: "ar" | "en", categories: SitemapCategory[], siteUrl: string): Promise<Buffer | null> {
  const executablePath = chromePath();
  if (!executablePath) return null;

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage();
    await page.setContent(sitemapHtml(lang, categories, siteUrl), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#888;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    const buf = Buffer.from(pdf);
    // keep only the current version of each language
    for (const k of cache.keys()) if (k.startsWith(`${lang}:`)) cache.delete(k);
    cache.set(key, buf);
    return buf;
  } finally {
    await browser.close();
  }
}
