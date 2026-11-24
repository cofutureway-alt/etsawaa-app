import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { PageHeader } from "~/components/layout/PageHeader";
import { Button, useToast } from "~/components/ui";
import { MailIcon, CheckIcon, PencilIcon, AlertIcon, StarIcon, TrashIcon, CopyIcon, ChevronDownIcon } from "~/components/ui/icons";
import { Dialog } from "~/components/ui/Overlay";
import { PhoneInput } from "~/components/phone/PhoneInput";
import { SmsGlyph, WhatsAppGlyph } from "~/components/phone/PhoneCodeBox";
import { GROUP_LABELS, eventsFor, effectiveRoute, MESSAGE_EVENT_MAP, type Audience, type MessageEvent, type RouteRow } from "~/lib/messaging/catalog";
import { maskNumber, renderText, smsSize } from "~/lib/messaging/text";
import { permKey } from "~/lib/permissions";
import { useTranslation } from "react-i18next";
import { MSG_COPY, type MsgCopy } from "./copy";

export interface SenderView { id: string; session_id: string; label: string; is_default: boolean; is_active: boolean; status: string | null; checked_at: string | null }
export interface MessagesData {
  lang: "ar" | "en";
  isAdmin: boolean;
  connected: boolean;
  routes: RouteRow[];
  texts: Array<{ event_key: string; channel: "sms" | "whatsapp"; body_ar: string; body_en: string }>;
  senders: SenderView[];
  templates: Record<string, boolean>;
  settings: { api_base: string; otp_channels: Array<"sms" | "whatsapp">; otp_wa_sender: string | null; sms_low_balance: number };
  secrets: Record<string, { last4: string | null; updated_at: string }> | null;
  deliveries: Array<{ id: string; created_at: string; event_key: string; audience: string | null; channel: "email" | "sms" | "whatsapp"; to_address: string; status: string; error: string | null; segments: number | null; wa_sender_id: string | null }>;
  siteUrl: string;
}
interface Balance { plan?: { name_en?: string; name_ar?: string; ends_at?: string } | null; whatsapp?: { unlimited?: boolean; remaining?: number | null }; sms?: { unlimited?: boolean; remaining?: number | null }; wa_numbers?: { allowed?: number; used?: number } }
interface Session { session_id: string; label: string | null; name: string | null; status: string }
export type MessagesResult =
  | { ok: true; intent: string; message?: string; balance?: Balance; sessions?: Session[] }
  | { ok: false; intent: string; reason: string };

type Tab = Audience | "connection" | "log";
const AUDIENCE_TABS: Audience[] = ["customer", "vendor", "staff", "admin", "account"];

/* ───────────────────────────── page ───────────────────────────── */

export function MessagesPage(props: MessagesData) {
  const c = MSG_COPY[props.lang];
  const [params, setParams] = useSearchParams();
  const tabs: Tab[] = [...AUDIENCE_TABS, ...(props.isAdmin ? (["connection"] as Tab[]) : []), "log"];
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && tabs.includes(requested) ? requested : "customer";
  const setTab = (next: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", next); if (next !== "log") { n.delete("channel"); n.delete("status"); } return n; }, { replace: true, preventScrollReset: true });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKey(e: React.KeyboardEvent) {
    const i = tabs.indexOf(tab);
    const rtl = props.lang === "ar";
    let n = i;
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) n = (i + 1) % tabs.length;
    else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    setTab(tabs[n]!);
    tabRefs.current[tabs[n]!]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={c.title}
        subtitle={c.subtitle}
        actions={<ConnectionPill c={c} connected={props.connected} onClick={props.isAdmin ? () => setTab("connection") : undefined} />}
      />

      {!props.connected && tab !== "connection" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-warning-strong">
            <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
            <span><b>{c.notConnected}.</b> {c.notConnectedLead}</span>
          </p>
          {props.isAdmin ? <Button size="sm" variant="dark" type="button" onClick={() => setTab("connection")}>{c.goConnect}</Button> : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface shadow-1">
        <div role="tablist" aria-label={c.title} onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-border px-2 [scrollbar-width:none]">
          {tabs.map((id) => (
            <button
              key={id}
              ref={(el) => { tabRefs.current[id] = el; }}
              type="button"
              role="tab"
              id={`msg-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`msg-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={`relative shrink-0 cursor-pointer whitespace-nowrap px-3.5 py-3 text-sm font-bold transition-colors duration-150 ${
                tab === id ? "text-action" : "text-text-muted hover:text-text"
              }`}
            >
              {c.tabs[id]}
              <span aria-hidden="true" className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors ${tab === id ? "bg-action" : "bg-transparent"}`} />
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`msg-panel-${tab}`} aria-labelledby={`msg-tab-${tab}`} className="min-w-0 p-3 sm:p-5">
          {tab === "connection" ? <ConnectionTab {...props} c={c} />
            : tab === "log" ? <LogTab {...props} c={c} />
            : <AudienceTab {...props} audience={tab} c={c} key={tab} />}
        </div>
      </div>
    </div>
  );
}

function ConnectionPill({ c, connected, onClick }: { c: MsgCopy; connected: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className={`relative flex size-2.5`}>
        {connected ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" /> : null}
        <span className={`relative inline-flex size-2.5 rounded-full ${connected ? "bg-success" : "bg-warning"}`} />
      </span>
      {connected ? c.connected : c.notConnected}
    </>
  );
  const cls = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${connected ? "border-success/30 bg-success-soft text-success-strong" : "border-warning/40 bg-warning-soft text-warning-strong"}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} cursor-pointer`}>{body}</button> : <span className={cls}>{body}</span>;
}

/* ───────────────────────────── audience tabs ───────────────────────────── */

function AudienceTab(props: MessagesData & { audience: Audience; c: MsgCopy }) {
  const { audience, c } = props;
  const events = eventsFor(audience);
  const groups = useMemo(() => {
    const m = new Map<string, MessageEvent[]>();
    for (const e of events) m.set(e.group, [...(m.get(e.group) ?? []), e]);
    return [...m.entries()];
  }, [events]);
  const saved = useMemo(() => new Map(props.routes.filter((r) => r.audience === audience).map((r) => [r.event_key, r])), [props.routes, audience]);
  const customTexts = useMemo(() => new Set(props.texts.map((t) => `${t.event_key}|${t.channel}`)), [props.texts]);
  const [editing, setEditing] = useState<MessageEvent | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-muted">{c.tabLead[audience as keyof MsgCopy["tabLead"]]}</p>
      {audience === "account" ? <CodeOrderCard {...props} /> : null}
      {groups.map(([group, list]) => (
        <section key={group} aria-labelledby={`grp-${group}`} className="flex flex-col gap-2">
          <h2 id={`grp-${group}`} className="text-xs font-extrabold uppercase tracking-wide text-text-faint">{GROUP_LABELS[group]?.[props.lang] ?? group}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {list.map((e) => (
              <EventRow
                key={e.key}
                event={e}
                audience={audience}
                route={effectiveRoute(e, audience, saved.get(e.key), e.emailTemplate ? props.templates[e.emailTemplate] : undefined)}
                senders={props.senders}
                lang={props.lang}
                c={c}
                hasTemplate={Boolean(e.emailTemplate && e.emailTemplate in props.templates)}
                customText={customTexts.has(`${e.key}|sms`) || customTexts.has(`${e.key}|whatsapp`)}
                onEditText={() => setEditing(e)}
              />
            ))}
          </ul>
        </section>
      ))}
      {editing ? <TextEditor event={editing} texts={props.texts} lang={props.lang} c={c} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function EventRow({ event, audience, route, senders, lang, c, hasTemplate, customText, onEditText }: {
  event: MessageEvent; audience: Audience; route: RouteRow; senders: SenderView[]; lang: "ar" | "en"; c: MsgCopy;
  hasTemplate: boolean; customText: boolean; onEditText: () => void;
}) {
  const fetcher = useFetcher<MessagesResult>();
  const { showToast } = useToast();
  const { t } = useTranslation();
  // optimistic: show what was just sent until the page reloads
  const pending = fetcher.formData;
  const cur: RouteRow = pending ? {
    ...route,
    enabled: pending.get("enabled") === "1", email: pending.get("email") === "1", sms: pending.get("sms") === "1",
    whatsapp: pending.get("whatsapp") === "1", wa_sender_id: (pending.get("wa_sender_id") as string) || null,
  } : route;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) showToast("error", c.saveFailed);
  }, [fetcher.state, fetcher.data, showToast, c.saveFailed]);

  function save(patch: Partial<RouteRow>) {
    const next = { ...cur, ...patch };
    fetcher.submit({
      intent: "route", event_key: event.key, audience,
      enabled: next.enabled ? "1" : "0", email: next.email ? "1" : "0", sms: next.sms ? "1" : "0",
      whatsapp: next.whatsapp ? "1" : "0", wa_sender_id: next.wa_sender_id ?? "",
    }, { method: "post", preventScrollReset: true });
  }
  const name = lang === "en" ? event.name_en : event.name_ar;
  const staff = audience === "staff";
  const toggleable = staff || audience === "account";
  const dim = toggleable && !cur.enabled;
  const usable = senders.filter((s) => s.is_active);

  return (
    <li className={`flex flex-col gap-3 bg-surface p-3 transition-colors sm:p-4 lg:flex-row lg:items-center lg:justify-between ${dim ? "bg-surface-alt/60" : "hover:bg-surface-tint/40"}`}>
      <div className="flex min-w-0 items-start gap-3">
        {toggleable ? (
          <Switch checked={cur.enabled} onChange={(v) => save({ enabled: v })} label={staff ? `${c.staffOn}: ${name}` : name} />
        ) : null}
        <div className="min-w-0">
          <p className={`text-sm font-bold ${dim ? "text-text-muted" : "text-text"}`}>{name}</p>
          {staff && event.staffPermission ? (
            <p className="mt-0.5 text-xs text-text-muted">{c.staffPerm}: <span className="font-bold text-text">{t(`perm.${permKey(event.staffPermission)}`)}</span></p>
          ) : null}
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-2 ${dim ? "pointer-events-none opacity-50" : ""}`} aria-disabled={dim || undefined}>
        {audience !== "account" ? (
          <ChannelChip on={cur.email} disabled={!hasTemplate} title={hasTemplate ? undefined : c.noEmail} onClick={() => save({ email: !cur.email })} icon={<MailIcon className="size-4" />} label={c.email} />
        ) : null}
        <ChannelChip on={cur.sms} onClick={() => save({ sms: !cur.sms })} icon={<SmsGlyph className="size-4" />} label={c.sms} />
        <ChannelChip on={cur.whatsapp} onClick={() => save({ whatsapp: !cur.whatsapp })} icon={<WhatsAppGlyph className={`size-4 ${cur.whatsapp ? "text-[#25D366]" : ""}`} />} label={c.whatsapp} />

        {cur.whatsapp ? (
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="sr-only sm:not-sr-only">{c.from}</span>
            <span className="relative">
              <select
                value={cur.wa_sender_id ?? ""}
                onChange={(e) => save({ wa_sender_id: e.target.value || null })}
                disabled={!usable.length}
                className="h-9 cursor-pointer appearance-none rounded-md border border-border bg-surface pe-8 ps-2.5 text-xs font-bold text-text outline-none focus:border-primary focus:shadow-focus disabled:cursor-not-allowed"
              >
                {usable.length ? <option value="">{c.defaultSender}</option> : <option value="">{c.noSenders}</option>}
                {usable.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
            </span>
          </label>
        ) : null}

        <span className="hidden h-6 w-px bg-border lg:block" aria-hidden="true" />
        <button type="button" onClick={onEditText} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-bold text-action transition-colors hover:bg-surface-tint">
          <PencilIcon className="size-3.5" aria-hidden="true" />
          {c.editText}
          {customText ? <span className="rounded-full bg-primary-soft px-1.5 text-2xs text-action">{c.custom}</span> : null}
        </button>
        {hasTemplate && audience !== "account" ? (
          <Link to={`/${lang}/admin/email-templates?key=${encodeURIComponent(event.emailTemplate!)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold text-text-muted transition-colors hover:bg-surface-tint hover:text-text">
            <MailIcon className="size-3.5" aria-hidden="true" />
            {c.editEmail}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function ChannelChip({ on, onClick, icon, label, disabled, title }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-50 motion-reduce:transition-none ${
        on ? "border-primary bg-primary-soft text-action shadow-[inset_0_0_0_1px_var(--color-primary)]" : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
      }`}
    >
      {icon}
      {label}
      <span aria-hidden="true" className={`flex size-4 items-center justify-center rounded-full transition-all ${on ? "bg-action text-on-action" : "border border-border-strong"}`}>
        {on ? <CheckIcon className="size-3" /> : null}
      </span>
    </button>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:shadow-focus motion-reduce:transition-none ${checked ? "bg-action" : "bg-border-strong"}`}
    >
      <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none ${checked ? "translate-x-[1.375rem] rtl:-translate-x-[1.375rem]" : "translate-x-0.5 rtl:-translate-x-0.5"}`} />
    </button>
  );
}

function CodeOrderCard(props: MessagesData & { c: MsgCopy }) {
  const { c, settings } = props;
  const fetcher = useFetcher<MessagesResult>();
  const { showToast } = useToast();
  const current = settings.otp_channels.join(",");
  const [order, setOrder] = useState(current);
  const [sender, setSender] = useState(settings.otp_wa_sender ?? "");
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) showToast(fetcher.data.ok ? "success" : "error", fetcher.data.ok ? c.saved : c.reasons[fetcher.data.reason] ?? c.saveFailed);
  }, [fetcher.state, fetcher.data, showToast, c]);
  const options = [
    { v: "whatsapp,sms", l: c.orderWaSms }, { v: "sms,whatsapp", l: c.orderSmsWa }, { v: "whatsapp", l: c.orderWa }, { v: "sms", l: c.orderSms },
  ];
  const dirty = order !== current || sender !== (settings.otp_wa_sender ?? "");
  return (
    <div className="rounded-lg border border-border bg-surface-tint/50 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-extrabold text-text">{c.codeOrder}</h2>
        <p className="text-xs text-text-muted">{c.codeOrderLead}</p>
      </div>
      {props.isAdmin ? (
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div role="radiogroup" aria-label={c.codeOrder} className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {options.map((o) => (
              <button key={o.v} type="button" role="radio" aria-checked={order === o.v} onClick={() => setOrder(o.v)}
                className={`cursor-pointer rounded-md border px-3 py-2.5 text-start text-xs font-bold transition-colors ${order === o.v ? "border-primary bg-surface text-action shadow-[inset_0_0_0_1px_var(--color-primary)]" : "border-border bg-surface text-text-muted hover:text-text"}`}>
                {o.l}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {c.codeSender}
            <select value={sender} onChange={(e) => setSender(e.target.value)} className="h-10 cursor-pointer rounded-md border border-border bg-surface px-2.5 text-sm outline-none focus:border-primary">
              <option value="">{c.defaultSender}</option>
              {props.senders.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <Button type="button" size="md" disabled={!dirty} loading={fetcher.state !== "idle"}
            onClick={() => fetcher.submit({ intent: "settings", otp_order: order, otp_wa_sender: sender, api_base: settings.api_base, sms_low_balance: String(settings.sms_low_balance) }, { method: "post", preventScrollReset: true })}>
            {c.save}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-sm font-bold text-text">{options.find((o) => o.v === current)?.l}</p>
      )}
    </div>
  );
}

/* ───────────────────────────── text editor ───────────────────────────── */

const SAMPLE: Record<string, string> = {
  title: "تم قبول منتجك", body: "أصبح منتجك ظاهرًا للعملاء.", link: "https://etsawaa.com/ar/vendor/products", name: "أحمد",
  code: "482913", customer_name: "أحمد", order_number: "ET-10428", order_total: "1,250 ج.م", payment_method: "الدفع عند الاستلام",
  order_url: "https://etsawaa.com/ar/order/ET-10428",
};
const SAMPLE_EN: Record<string, string> = { ...SAMPLE, title: "Your product is approved", body: "Your product is now visible to customers.", name: "Ahmed", customer_name: "Ahmed", order_total: "EGP 1,250", payment_method: "Cash on delivery", link: "https://etsawaa.com/en/vendor/products", order_url: "https://etsawaa.com/en/order/ET-10428" };

function TextEditor({ event, texts, lang, c, onClose }: { event: MessageEvent; texts: MessagesData["texts"]; lang: "ar" | "en"; c: MsgCopy; onClose: () => void }) {
  const fetcher = useFetcher<MessagesResult>();
  const { showToast } = useToast();
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const saved = (ch: "sms" | "whatsapp") => texts.find((t) => t.event_key === event.key && t.channel === ch);
  const initial = (ch: "sms" | "whatsapp") => ({ ar: saved(ch)?.body_ar ?? event.text.ar, en: saved(ch)?.body_en ?? event.text.en });
  const [draft, setDraft] = useState({ whatsapp: initial("whatsapp"), sms: initial("sms") });
  const [locale, setLocale] = useState<"ar" | "en">(lang);
  const area = useRef<HTMLTextAreaElement>(null);
  const value = draft[channel][locale];
  const size = smsSize(value);
  const preview = renderText(value, locale === "en" ? SAMPLE_EN : SAMPLE);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) { showToast("success", c.saved); if (fetcher.data.message === "saved") onClose(); }
    else showToast("error", c.textErr[fetcher.data.reason] ?? c.saveFailed);
  }, [fetcher.state, fetcher.data, showToast, c, onClose]);

  function set(v: string) { setDraft((d) => ({ ...d, [channel]: { ...d[channel], [locale]: v } })); }
  function insert(variable: string) {
    const el = area.current;
    const token = `{{${variable}}}`;
    if (!el) return set(value + token);
    const start = el.selectionStart ?? value.length, end = el.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  }
  const name = lang === "en" ? event.name_en : event.name_ar;

  return (
    <Dialog open onClose={onClose} title={`${c.textTitle}: ${name}`} size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label={c.channel} className="inline-flex rounded-lg bg-surface-alt p-1">
            {(["whatsapp", "sms"] as const).map((ch) => (
              <button key={ch} type="button" role="tab" aria-selected={channel === ch} onClick={() => setChannel(ch)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${channel === ch ? "bg-surface text-text shadow-1" : "text-text-muted hover:text-text"}`}>
                {ch === "whatsapp" ? <WhatsAppGlyph className="size-4 text-[#25D366]" /> : <SmsGlyph className="size-4" />}
                {ch === "whatsapp" ? c.whatsapp : c.sms}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label={c.arabic} className="inline-flex rounded-lg bg-surface-alt p-1">
            {(["ar", "en"] as const).map((l) => (
              <button key={l} type="button" role="tab" aria-selected={locale === l} onClick={() => setLocale(l)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${locale === l ? "bg-surface text-text shadow-1" : "text-text-muted hover:text-text"}`}>
                {l === "ar" ? c.arabic : c.english}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex flex-col gap-2">
            <textarea
              ref={area}
              value={value}
              onChange={(e) => set(e.target.value)}
              dir={locale === "ar" ? "rtl" : "ltr"}
              rows={7}
              maxLength={1600}
              aria-label={`${c.textTitle} (${locale === "ar" ? c.arabic : c.english})`}
              className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm leading-relaxed text-text outline-none focus:border-primary focus:shadow-focus"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
              <span className="num">{size.chars} {c.chars}</span>
              {channel === "sms" ? (
                <span className={`num rounded-full px-2 py-0.5 font-bold ${size.parts > 1 ? "bg-warning-soft text-warning-strong" : "bg-surface-alt text-text"}`} title={c.partsHint}>
                  {size.parts} {c.parts}
                </span>
              ) : null}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-bold text-text">{c.variables}</p>
              <p className="mb-2 text-2xs text-text-muted">{c.textLead}</p>
              <div className="flex flex-wrap gap-1.5" dir="ltr">
                {event.variables.map((v) => (
                  <button key={v} type="button" onClick={() => insert(v)} className="cursor-pointer rounded-md border border-border bg-surface-alt px-2 py-1 font-mono text-2xs text-text transition-colors hover:border-primary hover:text-action">
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold text-text">{c.preview}</p>
            <div className={`flex min-h-40 flex-col justify-end rounded-lg p-3 ${channel === "whatsapp" ? "bg-[#efeae2] dark:bg-[#0b141a]" : "bg-surface-alt"}`}>
              <div dir={locale === "ar" ? "rtl" : "ltr"} className={`max-w-[95%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[13px] leading-relaxed shadow-sm ${
                channel === "whatsapp" ? "self-end rounded-ee-none bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]" : "self-start rounded-es-none bg-surface text-text"
              } ${locale === "ar" ? "" : ""}`}>
                {preview || "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {saved(channel) ? (
            <Button type="button" variant="ghost" size="sm" disabled={fetcher.state !== "idle"}
              onClick={() => { fetcher.submit({ intent: "text", event_key: event.key, channel, reset: "1" }, { method: "post", preventScrollReset: true }); setDraft((d) => ({ ...d, [channel]: { ...event.text } })); }}>
              {c.resetText}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>{c.cancel}</Button>
            <Button type="button" size="sm" loading={fetcher.state !== "idle"}
              onClick={() => fetcher.submit({ intent: "text", event_key: event.key, channel, body_ar: draft[channel].ar, body_en: draft[channel].en }, { method: "post", preventScrollReset: true })}>
              {c.save}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ───────────────────────────── connection ───────────────────────────── */

function ConnectionTab(props: MessagesData & { c: MsgCopy }) {
  const { c } = props;
  const check = useFetcher<MessagesResult>();
  const result = check.data?.ok ? check.data : null;
  const checkError = check.data && !check.data.ok ? check.data.reason : null;
  const webhook = `${props.siteUrl}/api/webhooks/rasvio`;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title={c.account} lead={c.accountLead}
        action={<Button type="button" size="sm" variant="outline" disabled={!props.connected} title={props.connected ? undefined : c.saveKeyFirst} loading={check.state !== "idle"} onClick={() => check.submit({ intent: "check" }, { method: "post", preventScrollReset: true })}>{check.state !== "idle" ? c.checking : c.check}</Button>}>
        <div className="flex flex-col gap-4">
          <SecretField name="rasvio_api_key" label={c.apiKey} info={props.secrets?.rasvio_api_key} c={c} />
          <SecretField name="rasvio_webhook_secret" label={c.webhookSecret} info={props.secrets?.rasvio_webhook_secret} c={c} />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-text">{c.webhookUrl}</span>
            <CopyField value={webhook} c={c} />
            <p className="text-xs text-text-muted">{c.webhookLead}</p>
          </div>
          {!props.connected ? <p className="rounded-md bg-surface-tint px-3 py-2.5 text-xs text-text-muted">{c.saveKeyFirst}</p> : null}
          {checkError ? <ErrorNote text={c.reasons[checkError] ?? checkError} /> : null}
          {result?.balance ? <BalanceGrid balance={result.balance} lang={props.lang} c={c} /> : null}
          <Advanced {...props} />
        </div>
      </Panel>

      <SendersPanel {...props} sessions={result?.sessions ?? null} loadSessions={() => check.submit({ intent: "check" }, { method: "post", preventScrollReset: true })} loading={check.state !== "idle"} />
      <TestPanel {...props} />
      <LowBalancePanel {...props} />
    </div>
  );
}

function Panel({ title, lead, action, children }: { title: string; lead?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-text">{title}</h2>
          {lead ? <p className="mt-0.5 text-xs text-text-muted">{lead}</p> : null}
        </div>
        {action}
      </header>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-2.5 text-sm font-bold text-danger">
      <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" /> {text}
    </p>
  );
}

function useResultToast(fetcher: ReturnType<typeof useFetcher<MessagesResult>>, c: MsgCopy, okText?: string) {
  const { showToast } = useToast();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) showToast("success", okText ?? c.saved);
    else showToast("error", c.reasons[fetcher.data.reason] ?? c.saveFailed);
  }, [fetcher.state, fetcher.data, showToast, c, okText]);
}

function SecretField({ name, label, info, c }: { name: string; label: string; info?: { last4: string | null; updated_at: string }; c: MsgCopy }) {
  const fetcher = useFetcher<MessagesResult>();
  const [editing, setEditing] = useState(!info);
  const [value, setValue] = useState("");
  useResultToast(fetcher, c);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) { setEditing(false); setValue(""); } }, [fetcher.state, fetcher.data]);
  useEffect(() => { if (!info) setEditing(true); }, [info]);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold text-text">{label}</span>
      {!editing && info ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-success/30 bg-success-soft/60 px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-success-strong">
            <CheckIcon className="size-4" aria-hidden="true" />
            {c.savedEnding} <span className="num font-bold" dir="ltr">••••{info.last4}</span>
          </span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>{c.replace}</Button>
            <Button type="button" size="sm" variant="ghost" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "secret", name, value: "" }, { method: "post", preventScrollReset: true })}>{c.remove}</Button>
          </span>
        </div>
      ) : (
        <form className="flex flex-col gap-2 sm:flex-row" autoComplete="off" onSubmit={(e) => { e.preventDefault(); fetcher.submit({ intent: "secret", name, value }, { method: "post", preventScrollReset: true }); }}>
          {/* plain text drawn as dots: a password field would invite the browser to fill in the admin's own password */}
          <input type="text" name={`rv-${name}`} value={value} onChange={(e) => setValue(e.target.value.trim())} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} dir="ltr"
            data-1p-ignore="true" data-lpignore="true" data-form-type="other" placeholder={c.paste} aria-label={label}
            style={{ WebkitTextSecurity: value ? "disc" : "none" } as React.CSSProperties}
            className="num min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary focus:shadow-focus" />
          <div className="flex gap-2">
            <Button type="submit" size="md" className="flex-1 sm:flex-none" disabled={value.length < 12} loading={fetcher.state !== "idle"}>{c.save}</Button>
            {info ? <Button type="button" size="md" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>{c.cancel}</Button> : null}
          </div>
        </form>
      )}
    </div>
  );
}

function CopyField({ value, c }: { value: string; c: MsgCopy }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-border">
      <code className="min-w-0 flex-1 truncate bg-surface-alt px-3 py-2.5 text-xs text-text" dir="ltr" title={value}>{value}</code>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-s border-border bg-surface px-3 text-xs font-bold text-action hover:bg-surface-tint">
        {done ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {done ? c.copied : c.copy}
      </button>
    </div>
  );
}

function BalanceGrid({ balance, lang, c }: { balance: Balance; lang: "ar" | "en"; c: MsgCopy }) {
  const n = (v: number | null | undefined, unlimited?: boolean) => (unlimited || v == null ? c.unlimited : new Intl.NumberFormat(lang === "en" ? "en" : "ar-EG").format(v));
  const plan = (lang === "en" ? balance.plan?.name_en : balance.plan?.name_ar ?? balance.plan?.name_en) ?? "—";
  const ends = balance.plan?.ends_at ? new Intl.DateTimeFormat(lang === "en" ? "en" : "ar-EG", { dateStyle: "medium" }).format(new Date(balance.plan.ends_at)) : null;
  const items = [
    { k: c.plan, v: plan, s: ends ? `${c.ends} ${ends}` : "" },
    { k: c.waLeft, v: n(balance.whatsapp?.remaining, balance.whatsapp?.unlimited) },
    { k: c.smsLeft, v: n(balance.sms?.remaining, balance.sms?.unlimited) },
    { k: c.numbersUsed, v: `${balance.wa_numbers?.used ?? 0} / ${balance.wa_numbers?.allowed ?? 0}` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {items.map((i) => (
        <div key={i.k} className="rounded-md border border-border bg-surface-tint/60 p-3">
          <dt className="text-2xs font-bold text-text-muted">{i.k}</dt>
          <dd className="num mt-1 text-lg font-black text-text">{i.v}</dd>
          {i.s ? <dd className="text-2xs text-text-muted">{i.s}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function Advanced(props: MessagesData & { c: MsgCopy }) {
  const { c, settings } = props;
  const fetcher = useFetcher<MessagesResult>();
  const [base, setBase] = useState(settings.api_base);
  useResultToast(fetcher, c);
  return (
    <details className="group rounded-md border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-bold text-text-muted hover:text-text">
        {c.advanced}
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <form className="flex flex-col gap-2 border-t border-border p-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); fetcher.submit({ intent: "settings", api_base: base, otp_order: settings.otp_channels.join(","), otp_wa_sender: settings.otp_wa_sender ?? "", sms_low_balance: String(settings.sms_low_balance) }, { method: "post", preventScrollReset: true }); }}>
        <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-text">
          {c.apiBase}
          <input value={base} onChange={(e) => setBase(e.target.value)} dir="ltr" className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text outline-none focus:border-primary" />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={base === settings.api_base} loading={fetcher.state !== "idle"}>{c.save}</Button>
      </form>
    </details>
  );
}

function SenderStatus({ status, c }: { status: string | null; c: MsgCopy }) {
  const good = status === "ready" || status === "connected";
  const bad = status === "logged_out" || status === "disconnected";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-bold ${good ? "bg-success-soft text-success-strong" : bad ? "bg-danger-soft text-danger" : "bg-surface-alt text-text-muted"}`}>
      <span className={`size-1.5 rounded-full ${good ? "bg-success" : bad ? "bg-danger" : "bg-text-faint"}`} />
      {status ? c.status[status] ?? status : c.statusUnknown}
    </span>
  );
}

function SendersPanel(props: MessagesData & { c: MsgCopy; sessions: Session[] | null; loadSessions: () => void; loading: boolean }) {
  const { c, senders } = props;
  const add = useFetcher<MessagesResult>();
  const [session, setSession] = useState("");
  const [label, setLabel] = useState("");
  useResultToast(add, c);
  useEffect(() => { if (add.state === "idle" && add.data?.ok) { setSession(""); setLabel(""); } }, [add.state, add.data]);
  const known = new Set(senders.map((s) => s.session_id));
  const fresh = (props.sessions ?? []).filter((s) => !known.has(s.session_id));

  return (
    <Panel title={c.numbers} lead={c.numbersLead}
      action={props.connected ? <Button type="button" size="sm" variant="ghost" loading={props.loading} onClick={props.loadSessions}>{c.fetchSessions}</Button> : undefined}>
      <div className="flex flex-col gap-4">
        {senders.length ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {senders.map((s) => <SenderRow key={s.id} s={s} c={c} />)}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">{c.noNumbers}</p>
        )}

        {props.sessions ? (
          <div className="flex flex-col gap-2 rounded-md bg-surface-tint/60 p-3">
            <p className="text-xs font-bold text-text">{c.fromRasvio}</p>
            {props.sessions.length ? props.sessions.map((s) => (
              <div key={s.session_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text">{s.label || s.name || s.session_id}</p>
                  <p className="num truncate text-2xs text-text-muted" dir="ltr">{s.session_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <SenderStatus status={s.status} c={c} />
                  {known.has(s.session_id) ? <span className="text-2xs font-bold text-text-muted">{c.alreadyAdded}</span> : (
                    <Button type="button" size="sm" variant="outline" loading={add.state !== "idle"}
                      onClick={() => add.submit({ intent: "sender_add", session_id: s.session_id, label: s.label || s.name || "WhatsApp", status: s.status }, { method: "post", preventScrollReset: true })}>{c.add}</Button>
                  )}
                </div>
              </div>
            )) : <p className="text-xs text-text-muted">—</p>}
            {fresh.length === 0 && props.sessions.length ? null : null}
          </div>
        ) : null}

        <form className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => { e.preventDefault(); add.submit({ intent: "sender_add", session_id: session.trim(), label: label.trim() }, { method: "post", preventScrollReset: true }); }}>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {c.sessionId}
            <input value={session} onChange={(e) => setSession(e.target.value)} dir="ltr" placeholder="ses_8f2c41d09a7be356" spellCheck={false}
              className="num rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary focus:shadow-focus" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {c.label}
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={c.labelPh}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary focus:shadow-focus" />
          </label>
          <Button type="submit" size="md" disabled={!/^ses_[A-Za-z0-9]{4,64}$/.test(session.trim()) || !label.trim()} loading={add.state !== "idle"}>{c.add}</Button>
        </form>
      </div>
    </Panel>
  );
}

function SenderRow({ s, c }: { s: SenderView; c: MsgCopy }) {
  const fetcher = useFetcher<MessagesResult>();
  useResultToast(fetcher, c);
  const busy = fetcher.state !== "idle";
  return (
    <li className={`flex flex-wrap items-center justify-between gap-3 p-3 ${s.is_active ? "" : "opacity-60"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]"><WhatsAppGlyph className="size-5" /></span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-text">
            {s.label}
            {s.is_default ? <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-2xs text-action"><StarIcon className="size-3" />{c.isDefault}</span> : null}
          </p>
          <p className="num truncate text-2xs text-text-muted" dir="ltr">{s.session_id}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <SenderStatus status={s.status} c={c} />
        <Switch checked={s.is_active} label={`${c.active}: ${s.label}`} onChange={(v) => fetcher.submit({ intent: "sender_update", id: s.id, is_active: v ? "1" : "0" }, { method: "post", preventScrollReset: true })} />
        {!s.is_default ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => fetcher.submit({ intent: "sender_update", id: s.id, make_default: "1" }, { method: "post", preventScrollReset: true })}>{c.makeDefault}</Button>
        ) : null}
        <button type="button" aria-label={`${c.remove}: ${s.label}`} disabled={busy}
          onClick={() => { if (window.confirm(`${c.remove}: ${s.label}?`)) fetcher.submit({ intent: "sender_delete", id: s.id }, { method: "post", preventScrollReset: true }); }}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-danger-soft hover:text-danger">
          <TrashIcon className="size-4" />
        </button>
      </div>
    </li>
  );
}

function TestPanel(props: MessagesData & { c: MsgCopy }) {
  const { c } = props;
  const fetcher = useFetcher<MessagesResult>();
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [sender, setSender] = useState("");
  const [phone, setPhone] = useState("");
  useResultToast(fetcher, c, c.testSent);
  return (
    <Panel title={c.test} lead={c.testLead}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); fetcher.submit({ intent: "test", channel, sender_id: sender, phone }, { method: "post", preventScrollReset: true }); }}>
        <div role="radiogroup" aria-label={c.channel} className="grid grid-cols-2 gap-2">
          {(["whatsapp", "sms"] as const).map((ch) => (
            <button key={ch} type="button" role="radio" aria-checked={channel === ch} onClick={() => setChannel(ch)}
              className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-bold transition-colors ${channel === ch ? "border-primary bg-primary-soft text-action" : "border-border text-text-muted hover:text-text"}`}>
              {ch === "whatsapp" ? <WhatsAppGlyph className="size-4 text-[#25D366]" /> : <SmsGlyph className="size-4" />}
              {ch === "whatsapp" ? c.whatsapp : c.sms}
            </button>
          ))}
        </div>
        {channel === "whatsapp" ? (
          <label className="flex flex-col gap-1 text-sm font-bold text-text">
            {c.from}
            <select value={sender} onChange={(e) => setSender(e.target.value)} className="h-10 cursor-pointer rounded-md border border-border bg-surface px-2.5 text-sm outline-none focus:border-primary">
              <option value="">{c.defaultSender}</option>
              {props.senders.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        ) : null}
        <PhoneInput label={c.phone} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        {fetcher.data && !fetcher.data.ok ? <ErrorNote text={c.reasons[fetcher.data.reason] ?? fetcher.data.reason} /> : null}
        <Button type="submit" disabled={phone.replace(/\D/g, "").length < 10} loading={fetcher.state !== "idle"}>{c.send}</Button>
      </form>
    </Panel>
  );
}

function LowBalancePanel(props: MessagesData & { c: MsgCopy }) {
  const { c, settings } = props;
  const fetcher = useFetcher<MessagesResult>();
  const [value, setValue] = useState(String(settings.sms_low_balance));
  useResultToast(fetcher, c);
  return (
    <Panel title={c.lowBalance} lead={c.lowBalanceLead}>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); fetcher.submit({ intent: "settings", sms_low_balance: value, api_base: settings.api_base, otp_order: settings.otp_channels.join(","), otp_wa_sender: settings.otp_wa_sender ?? "" }, { method: "post", preventScrollReset: true }); }}>
        <input type="number" min={0} step={10} value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" aria-label={c.lowBalance}
          className="num w-36 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:shadow-focus" />
        <Button type="submit" size="md" variant="outline" disabled={value === String(settings.sms_low_balance)} loading={fetcher.state !== "idle"}>{c.save}</Button>
      </form>
    </Panel>
  );
}

/* ───────────────────────────── log ───────────────────────────── */

function LogTab(props: MessagesData & { c: MsgCopy }) {
  const { c, lang } = props;
  const [params, setParams] = useSearchParams();
  const senders = new Map(props.senders.map((s) => [s.id, s.label]));
  const filter = (key: string, value: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (value) n.set(key, value); else n.delete(key); return n; }, { preventScrollReset: true });
  const fmt = new Intl.DateTimeFormat(lang === "en" ? "en" : "ar-EG", { dateStyle: "short", timeStyle: "short" });
  const chip = (key: string, value: string | null, label: string) => {
    const on = (params.get(key) ?? null) === value;
    return <button key={`${key}-${value}`} type="button" aria-pressed={on} onClick={() => filter(key, value)} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-bold transition-colors ${on ? "border-primary bg-primary-soft text-action" : "border-border text-text-muted hover:text-text"}`}>{label}</button>;
  };
  const tone = (s: string) => (["delivered", "read"].includes(s) ? "bg-success-soft text-success-strong" : ["sent", "queued", "sending"].includes(s) ? "bg-info-soft text-info" : "bg-danger-soft text-danger");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">{c.logLead}</p>
        <div className="flex flex-wrap gap-1.5">
          {chip("channel", null, c.all)}{chip("channel", "whatsapp", c.whatsapp)}{chip("channel", "sms", c.sms)}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden="true" />
          {chip("status", null, c.all)}{chip("status", "ok", c.okOnly)}{chip("status", "failed", c.failedOnly)}
        </div>
      </div>
      {props.deliveries.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-alt text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-bold">{c.time}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{c.channel}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{c.event}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{c.to}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{c.state}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{c.error}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {props.deliveries.map((d) => {
                const ev = MESSAGE_EVENT_MAP.get(d.event_key);
                return (
                  <tr key={d.id} className="hover:bg-surface-tint/40">
                    <td className="num whitespace-nowrap px-3 py-2 text-xs text-text-muted">{fmt.format(new Date(d.created_at))}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-text">
                        {d.channel === "whatsapp" ? <WhatsAppGlyph className="size-4 text-[#25D366]" /> : <SmsGlyph className="size-4" />}
                        {d.channel === "whatsapp" ? (senders.get(d.wa_sender_id ?? "") ?? c.whatsapp) : `${c.sms}${d.segments && d.segments > 1 ? ` ×${d.segments}` : ""}`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-text">{ev ? (lang === "en" ? ev.name_en : ev.name_ar) : d.event_key}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-xs text-text" dir="ltr">{maskNumber(d.to_address)}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-2xs font-bold ${tone(d.status)}`}>{c.deliveryStatus[d.status] ?? d.status}</span></td>
                    <td className="px-3 py-2 text-xs text-text-muted">{d.error ? (c.reasons[d.error] ?? d.error) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">{c.emptyLog}</p>
      )}
    </div>
  );
}
