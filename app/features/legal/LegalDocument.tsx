import { useTranslation } from "react-i18next";
import type { LegalDoc } from "./legal.shared";

/**
 * A legal document as the reader sees it: title, version + effective date,
 * a numbered table of contents and numbered sections/clauses (stable
 * anchors: #s-3, #s-3-2 — so a clause can be cited). `compact` drops the
 * table of contents for use inside an acceptance box.
 */
export function LegalDocument({ doc, lang, compact = false }: { doc: LegalDoc; lang: "ar" | "en"; compact?: boolean }) {
  const { t } = useTranslation();
  const en = lang === "en";
  const sections = doc.body.sections;
  return (
    <article className="flex flex-col gap-5 text-text" lang={lang}>
      {!compact ? (
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-black">{en ? doc.title_en : doc.title_ar}</h1>
          {en ? <p className="text-xs text-text-muted">{t("legal.arabicPrevails")}</p> : null}
        </header>
      ) : null}
      {!compact && sections.length > 3 ? (
        <nav aria-label={t("legal.contents")} className="rounded-lg border border-border bg-surface-tint/50 p-4">
          <p className="mb-2 text-xs font-extrabold text-text-muted">{t("legal.contents")}</p>
          <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={i}><a href={`#s-${i + 1}`} className="text-text hover:text-action hover:underline"><span className="num text-text-muted">{i + 1}. </span>{en ? s.title.en : s.title.ar}</a></li>
            ))}
          </ol>
        </nav>
      ) : null}
      {sections.map((s, i) => (
        <section key={i} id={`s-${i + 1}`} className="scroll-mt-24">
          {s.title.ar || s.title.en ? (
            <h2 className="mb-2 text-base font-extrabold"><span className="num text-action">{i + 1}. </span>{en ? s.title.en : s.title.ar}</h2>
          ) : null}
          <ol className="flex flex-col gap-2">
            {s.clauses.map((c, j) => (
              <li key={j} id={`s-${i + 1}-${j + 1}`} className="flex gap-2 text-sm leading-relaxed">
                <span className="num shrink-0 text-xs font-bold text-text-muted">{i + 1}.{j + 1}</span>
                <span className="whitespace-pre-line">{en ? c.en : c.ar}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}
