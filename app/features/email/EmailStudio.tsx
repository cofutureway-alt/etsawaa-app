import { useFetcher, useBlocker, useBeforeUnload } from "react-router";
import { useEffect, useRef, useState } from "react";
import { renderEmailContent, validateContent, type EmailContent, type EmailTranslation } from "~/lib/email/content";
import { EMAIL_DEFINITIONS, emailSampleVariables } from "~/lib/email/catalog";
import { STUDIO_COPY } from "~/lib/email/studio-copy";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";

export interface TemplateRow {
  key: string; name_ar: string; name_en: string; content_ar: EmailContent | null; content_en: EmailContent | null;
  variables: string[]; version: number; revision: number; is_active: boolean; audience: "customer" | "vendor" | "admin" | "all";
  draft_content: EmailTranslation | null; history: Array<{ version: number; published_at: string }>;
}
export type StudioResult = { ok: boolean; key?: string; reason?: string; message?: "saved" | "published" | "restored" | "sent" | "activeSaved"; revision?: number };
const FIELD = "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text focus:border-action focus:outline-none focus:ring-2 focus:ring-primary-soft";
const EMPTY: EmailContent = { subject: "", preheader: "", heading: "", body: "", details: [], buttonLabel: "", buttonUrl: "", note: "", code: "" };
function contentFor(row?: TemplateRow): EmailTranslation {
  return row?.draft_content ?? (row?.content_ar && row.content_en ? { ar: row.content_ar, en: row.content_en } : EMAIL_DEFINITIONS.get(row?.key ?? "")?.content) ?? { ar: EMPTY, en: EMPTY };
}

export function EmailStudio({ lang, templates, providerConfigured, initialKey }: { lang: "ar" | "en"; templates: TemplateRow[]; providerConfigured: boolean; initialKey?: string | null }) {
  const labels = STUDIO_COPY[lang];
  const [selected, setSelected] = useState((initialKey && templates.some((t) => t.key === initialKey) ? initialKey : null) ?? templates[0]?.key ?? "");
  const row = templates.find((t) => t.key === selected) ?? templates[0];
  const [draft, setDraft] = useState<EmailTranslation>(() => contentFor(row));
  const [baseline, setBaseline] = useState(() => JSON.stringify(contentFor(row)));
  const [locale, setLocale] = useState<"ar" | "en">(lang);
  const [search, setSearch] = useState("");
  const [audience, setAudience] = useState("all");
  const [mobile, setMobile] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [historyVersion, setHistoryVersion] = useState("");
  const focus = useRef<{ element: HTMLInputElement | HTMLTextAreaElement; field: string } | null>(null);
  const editorRevision = useRef(row?.revision);
  const operation = useFetcher<StudioResult>();
  const testing = useFetcher<StudioResult>();
  const toggling = useFetcher<StudioResult>();
  const dirty = JSON.stringify(draft) !== baseline;
  const busy = operation.state !== "idle";
  const blocked = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => { if (blocked.state === "blocked") { if (window.confirm(labels.discard)) blocked.proceed(); else blocked.reset(); } }, [blocked, labels.discard]);
  useBeforeUnload((event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  useEffect(() => {
    if (row && row.revision !== editorRevision.current && ((operation.data?.ok && operation.data.key === row.key && operation.data.revision === row.revision) || (!dirty && toggling.data?.ok && toggling.data.key === row.key))) {
      const fresh = contentFor(row); setDraft(fresh); setBaseline(JSON.stringify(fresh)); editorRevision.current = row.revision;
    }
  }, [row, operation.data, toggling.data, dirty]);
  if (!row) return <p>{labels.empty}</p>;
  const current = draft[locale];
  const name = (r: TemplateRow) => lang === "ar" ? r.name_ar : r.name_en;
  const visible = templates.filter((t) => (audience === "all" || (audience === "security" ? t.key.startsWith("auth:") : t.audience === audience && !t.key.startsWith("auth:"))) && `${t.name_ar} ${t.name_en} ${t.key}`.toLowerCase().includes(search.toLowerCase()));
  const verdict = validateContent(draft, row.variables);
  let preview = "", previewSubject = "";
  try { const rendered = renderEmailContent(current, locale, emailSampleVariables(locale, row.key)); preview = rendered.html; previewSubject = rendered.subject; } catch { /* Field validation remains visible. */ }
  function patch(field: string, value: string) {
    setDraft((d) => {
      const next = { ...d[locale] };
      if (field.startsWith("details:")) {
        const [, index, key] = field.split(":");
        next.details = next.details.map((v, i) => i === Number(index) ? { ...v, [key!]: value } : v);
      } else Object.assign(next, { [field]: value });
      return { ...d, [locale]: next };
    });
  }
  function insert(variable: string) {
    const target = focus.current;
    if (!target || !target.element.isConnected) { patch("body", `${current.body} {{${variable}}}`); return; }
    const { element, field } = target;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const token = `{{${variable}}}`;
    patch(field, element.value.slice(0, start) + token + element.value.slice(end));
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + token.length, start + token.length); });
  }
  function select(next: TemplateRow) {
    if (dirty && !window.confirm(labels.discard)) return;
    const fresh = contentFor(next); setSelected(next.key); setDraft(fresh); setBaseline(JSON.stringify(fresh)); editorRevision.current = next.revision;
    setHistoryVersion(""); focus.current = null;
  }
  function submit(intent: string, extra: Record<string, string> = {}) {
    operation.submit({ intent, key: row!.key, revision: String(editorRevision.current), content: JSON.stringify(draft), ...extra }, { method: "post", preventScrollReset: true });
  }
  const field = (key: Exclude<keyof EmailContent, "details">, title: string, multiline = false, hint?: string) => <label key={`${locale}-${key}`} className="flex min-w-0 flex-col gap-2"><span className="text-sm font-bold text-text">{title}</span>{multiline ? <textarea name={key} dir={locale === "ar" ? "rtl" : "ltr"} rows={key === "body" ? 7 : 3} value={current[key]} onFocus={(e) => { focus.current = { element: e.currentTarget, field: key }; }} onChange={(e) => patch(key, e.target.value)} className={`${FIELD} leading-7`} /> : <input name={key} dir={key === "buttonUrl" || key === "code" ? "ltr" : locale === "ar" ? "rtl" : "ltr"} value={current[key]} onFocus={(e) => { focus.current = { element: e.currentTarget, field: key }; }} onChange={(e) => patch(key, e.target.value)} className={FIELD} />}{hint ? <span className="text-xs leading-6 text-text-muted">{hint}</span> : null}</label>;
  const message = (result: StudioResult | undefined) => result ? <p role={result.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm leading-7 ${result.ok ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"}`}>{result.ok ? labels[result.message ?? "saved"] : labels[result.reason as keyof typeof labels] ?? labels.failed}</p> : null;
  return <div className="flex flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-extrabold text-text">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-text-muted">{labels.description}</p></div><Badge tone={providerConfigured ? "success" : "warning"}>{providerConfigured ? labels.ready : labels.unavailable}</Badge></header>
    <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-xl border border-border bg-surface lg:sticky lg:top-4">
        <div className="flex flex-col gap-3 border-b border-border p-3"><input aria-label={labels.search} type="search" placeholder={labels.search} value={search} onChange={(e) => setSearch(e.target.value)} className={FIELD} /><select aria-label={labels.all} value={audience} onChange={(e) => setAudience(e.target.value)} className={FIELD}>{["all", "security", "customer", "vendor", "admin"].map((a) => <option key={a} value={a}>{labels[a as "all"]}</option>)}</select></div>
        <div className="max-h-64 overflow-y-auto lg:max-h-[68vh]">{visible.length ? visible.map((t) => <button key={t.key} disabled={busy} onClick={() => select(t)} type="button" aria-current={t.key === row.key ? "true" : undefined} className={`flex w-full cursor-pointer flex-col gap-2 border-b border-border px-4 py-4 text-start last:border-b-0 ${t.key === row.key ? "bg-primary-soft" : "hover:bg-surface-alt"}`}><span className="text-sm font-bold leading-6 text-text">{name(t)}</span><span className="flex flex-wrap gap-2 text-xs text-text-muted"><span>{t.key.startsWith("auth:") ? labels.security : labels[t.audience === "all" ? "shared" : t.audience]}</span><span>· {t.is_active ? labels.live : labels.inactive}</span>{t.draft_content ? <span className="font-bold text-action">{labels.draft}</span> : null}</span></button>) : <p className="p-4 text-sm text-text-muted">{labels.empty}</p>}</div>
      </aside>
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-extrabold text-text">{name(row)}</h2><p className="mt-1 text-xs text-text-muted">{labels.version} {row.version} · {dirty ? labels.unsaved : labels.clean}</p></div>{row.key.startsWith("auth:") ? <Badge>{labels.required}</Badge> : <Button type="button" variant="outline" size="sm" disabled={toggling.state !== "idle" || busy || dirty} onClick={() => toggling.submit({ intent: "active", key: row.key, active: row.is_active ? "0" : "1" }, { method: "post", preventScrollReset: true })}>{row.is_active ? labels.disable : labels.enable}</Button>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><div role="tablist" aria-label={labels.title} className="flex gap-2">{(["ar", "en"] as const).map((l) => <button type="button" role="tab" aria-selected={locale === l} key={l} onClick={() => { setLocale(l); focus.current = null; }} className={`min-h-11 cursor-pointer rounded-lg px-5 text-sm font-bold ${locale === l ? "bg-ink text-white" : "bg-surface-alt text-text hover:bg-primary-soft"}`}>{labels[l]}</button>)}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" type="button" disabled={busy || !verdict.ok} onClick={() => submit("draft")}>{busy ? labels.saving : labels.save}</Button><Button size="sm" type="button" disabled={busy || !verdict.ok} onClick={() => submit("publish")}>{labels.publish}</Button></div></div>
        {message(operation.data)}{message(toggling.data)}{!verdict.ok ? <p role="alert" className="text-sm text-danger">{labels[verdict.reason as keyof typeof labels] ?? labels.failed}</p> : null}
        <div className="grid min-w-0 items-start gap-6 min-[1600px]:grid-cols-[minmax(300px,1fr)_minmax(360px,1.1fr)]">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
            {field("subject", labels.subject)}{field("preheader", labels.preheader)}{field("heading", labels.heading)}{field("body", labels.body, true, labels.bodyHint)}
            {row.key.startsWith("auth:") || current.code ? field("code", labels.code) : null}
            <div className="flex flex-col gap-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-text">{labels.details}</h3><Button type="button" size="sm" variant="ghost" disabled={current.details.length >= 12} onClick={() => setDraft((d) => ({ ...d, [locale]: { ...d[locale], details: [...d[locale].details, { label: "", value: "" }] } }))}>{labels.addDetail}</Button></div>{current.details.map((detail, i) => <div key={i} className="grid gap-2 rounded-lg bg-surface-alt p-3 sm:grid-cols-[1fr_1fr_auto]"><input aria-label={`${labels.label} ${i + 1}`} dir={locale === "ar" ? "rtl" : "ltr"} placeholder={labels.label} value={detail.label} onFocus={(e) => { focus.current = { element: e.currentTarget, field: `details:${i}:label` }; }} onChange={(e) => patch(`details:${i}:label`, e.target.value)} className={FIELD} /><input aria-label={`${labels.value} ${i + 1}`} dir={locale === "ar" ? "rtl" : "ltr"} placeholder={labels.value} value={detail.value} onFocus={(e) => { focus.current = { element: e.currentTarget, field: `details:${i}:value` }; }} onChange={(e) => patch(`details:${i}:value`, e.target.value)} className={FIELD} /><button type="button" aria-label={`${labels.remove} ${i + 1}`} className="min-h-11 cursor-pointer px-2 text-sm text-danger underline" onClick={() => setDraft((d) => ({ ...d, [locale]: { ...d[locale], details: d[locale].details.filter((_, index) => index !== i) } }))}>{labels.remove}</button></div>)}</div>
            {field("buttonLabel", labels.buttonLabel)}{field("buttonUrl", labels.buttonUrl)}{field("note", labels.note, true)}
            <section className="border-t border-border pt-5"><h3 className="text-sm font-bold text-text">{labels.variables}</h3><p className="my-2 text-xs leading-6 text-text-muted">{labels.variableHint}</p><div className="flex flex-wrap gap-2">{row.variables.map((v) => <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v)} title={`{{${v}}}`} className="min-h-9 cursor-pointer rounded-lg border border-border-strong px-3 py-1.5 text-xs text-text hover:border-action hover:bg-primary-soft">{labels[`var_${v}` as keyof typeof labels] ?? labels[v as keyof typeof labels] ?? v}</button>)}</div></section>
          </fieldset>
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-alt min-[1600px]:sticky min-[1600px]:top-4"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3"><h3 className="text-sm font-bold text-text">{labels.preview}</h3><div className="flex gap-1">{[false, true].map((m) => <button type="button" key={String(m)} aria-pressed={mobile === m} onClick={() => setMobile(m)} className={`min-h-9 cursor-pointer rounded-md px-3 text-xs font-bold ${mobile === m ? "bg-primary-soft text-action" : "text-text-muted"}`}>{m ? labels.mobile : labels.desktop}</button>)}</div></div><div className="border-b border-border bg-surface px-4 py-3"><p dir={locale === "ar" ? "rtl" : "ltr"} className="text-sm font-bold text-text">{previewSubject}</p></div><div className="overflow-x-auto p-2"><iframe title={`${labels.preview} — ${locale}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview} className="mx-auto block h-[760px] w-full border-0 bg-white" style={{ maxWidth: mobile ? 360 : 640 }} /></div><p className="px-4 pb-4 text-xs leading-6 text-text-muted">{labels.previewHint}</p></section>
        </div>
        <div className="flex flex-col gap-4 border-t border-border pt-5"><div><Button type="button" size="sm" variant="outline" onClick={() => setTestOpen((v) => !v)}>{labels.test}</Button></div>{testOpen ? <form onSubmit={(e) => { e.preventDefault(); testing.submit({ intent: "test", key: row.key, content: JSON.stringify(draft), locale, to: testTo }, { method: "post", preventScrollReset: true }); }} className="flex flex-col gap-3 rounded-xl border border-border p-4"><p className="text-sm leading-7 text-text-muted">{labels.testHint}</p><div className="flex flex-wrap items-end gap-3"><label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-bold"><span>{labels.testTo}</span><input dir="ltr" type="email" required value={testTo} onChange={(e) => setTestTo(e.target.value)} className={FIELD} /></label><Button type="submit" size="sm" disabled={testing.state !== "idle" || !verdict.ok || !providerConfigured}>{labels.send}</Button></div>{message(testing.data)}</form> : null}
          <div className="flex flex-wrap items-end gap-3"><label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-bold"><span>{labels.history}</span><select value={historyVersion} onChange={(e) => setHistoryVersion(e.target.value)} className={FIELD}><option value="">{labels.history}</option>{(row.history ?? []).filter((v) => v.version !== row.version).map((v) => <option key={v.version} value={v.version}>{labels.version} {v.version} · {new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(v.published_at))}</option>)}</select></label><Button type="button" size="sm" variant="outline" disabled={!historyVersion || busy} onClick={() => { if (window.confirm(labels.restoreConfirm)) submit("restore", { restore_version: historyVersion }); }}>{labels.restore}</Button></div>
        </div>
      </section>
    </div>
  </div>;
}
