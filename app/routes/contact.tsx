import { PhoneInput } from "~/components/phone/PhoneInput";
import { useRef, useState } from "react";
import type { ActionFunctionArgs } from "react-router";
import type { Route } from "./+types/contact";
import { useFetcher, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { recipientLocale } from "~/lib/locale-preference.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { getViewer } from "~/lib/auth/guards";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { Input } from "~/components/ui/Input";
import { CheckIcon, MailIcon, StoreIcon, UserIcon, XIcon } from "~/components/ui/icons";
import { SkeletonForm } from "~/components/ui/Skeleton";
import { SocialLinks } from "~/components/layout/SocialLinks";
import type { RootLoaderData } from "~/features/settings/api";
import {
  CONTACT_LIMITS, CUSTOMER_TOPICS, VENDOR_TOPICS, contactFileKind, CONTACT_IMAGE_TYPES, CONTACT_VIDEO_TYPES,
  type ContactAttachment,
} from "~/features/contact/limits";

/**
 * Contact page: one switch between the customer form and the seller form,
 * both with photo/video attachments (uploaded straight to private storage),
 * then the public contact channels and social links. A message lands in the
 * admin/staff inbox (contact_messages) and is emailed to the team through
 * Resend; the sender gets an acknowledgement on the same address.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const { viewer } = client ? ((await getViewer(client)) ?? { viewer: null }) : { viewer: null };
  return {
    lang,
    prefill: viewer ? { name: viewer.profile.full_name ?? "", email: viewer.user.email ?? "", phone: viewer.profile.phone ?? "" } : null,
    isVendor: viewer?.profile.role === "vendor",
  };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/contact",
    title: `${t("footer.contactUs")} — ${t("app.name")}`,
    description: t("contact.metaDescription"),
  });
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(\+?2)?01[0125][0-9]{8}$/;
const MESSAGE_MAX = 3000;

type ActionData = { ok: boolean; reason?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false, reason: "db" } satisfies ActionData;
  const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
  const { clientKey, rateLimit } = await import("~/lib/rate-limit.server");
  const admin = getSupabaseAdminClient();
  if (!admin) return { ok: false, reason: "db" } satisfies ActionData;
  if (!rateLimit(`contact:${clientKey(request) ?? "anon"}`, 6, 10 * 60_000)) return { ok: false, reason: "rate" } satisfies ActionData;

  const form = await request.formData();
  const kind = form.get("kind") === "vendor" ? "vendor" : "customer";
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const topic = String(form.get("topic") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  const orderNumber = String(form.get("order_number") ?? "").trim().slice(0, 40);
  const storeName = String(form.get("store_name") ?? "").trim().slice(0, 120);
  const topics: readonly string[] = kind === "vendor" ? VENDOR_TOPICS : CUSTOMER_TOPICS;

  if (name.length < 3 || name.length > 80) return { ok: false, reason: "name" } satisfies ActionData;
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "email" } satisfies ActionData;
  if (phone && !PHONE_RE.test(phone.replace(/[\s-]/g, ""))) return { ok: false, reason: "phone" } satisfies ActionData;
  if (!topics.includes(topic)) return { ok: false, reason: "topic" } satisfies ActionData;
  if (subject.length < 3 || subject.length > 120) return { ok: false, reason: "subject" } satisfies ActionData;
  if (message.length < 10 || message.length > MESSAGE_MAX) return { ok: false, reason: "message" } satisfies ActionData;
  if (kind === "vendor" && storeName.length < 2) return { ok: false, reason: "store" } satisfies ActionData;

  // attachments: only objects this flow created, with their REAL stored size
  let declared: ContactAttachment[] = [];
  try { declared = JSON.parse(String(form.get("attachments") ?? "[]")) as ContactAttachment[]; } catch { declared = []; }
  if (!Array.isArray(declared) || declared.length > CONTACT_LIMITS.maxFiles) return { ok: false, reason: "files" } satisfies ActionData;
  const attachments: ContactAttachment[] = [];
  let images = 0, videos = 0;
  for (const a of declared) {
    if (typeof a?.path !== "string" || !/^inbox\/\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(a.path)) return { ok: false, reason: "files" } satisfies ActionData;
    const { data: info } = await admin.storage.from("contact").info(a.path);
    const size = Number((info as { size?: number } | null)?.size ?? 0);
    const type = String((info as { contentType?: string } | null)?.contentType ?? a.type ?? "");
    const fileKind = contactFileKind(type) ?? contactFileKind(String(a.type ?? ""));
    if (!info || !fileKind) return { ok: false, reason: "files" } satisfies ActionData;
    if (fileKind === "image") { if (size > CONTACT_LIMITS.imageMax) return { ok: false, reason: "files" }; images += size; }
    else { if (size > CONTACT_LIMITS.videoMax) return { ok: false, reason: "files" }; videos += size; }
    attachments.push({ path: a.path, name: String(a.name ?? "").slice(0, 120), size, type });
  }
  if (images > CONTACT_LIMITS.imagesTotal || videos > CONTACT_LIMITS.videosTotal) return { ok: false, reason: "files" } satisfies ActionData;

  // the browser uploaded straight to storage, so scan here before anything is
  // kept: infected → every attachment of this submission is deleted and the
  // message refused; clean images are re-encoded to WebP (videos stay as is)
  if (attachments.length > 0) {
    const { scanForViruses, toWebp, UploadRejected } = await import("~/lib/media-pipeline.server");
    const bucket = admin.storage.from("contact");
    const dropAll = () => bucket.remove(attachments.map((a) => a.path)).catch(() => undefined);
    for (const a of attachments) {
      const { data: blob } = await bucket.download(a.path);
      if (!blob) { await dropAll(); return { ok: false, reason: "files" } satisfies ActionData; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      try {
        await scanForViruses(bytes);
        if (contactFileKind(a.type) === "image" && a.type !== "image/webp") {
          const out = await toWebp(bytes, a.type, "img");
          const webpPath = a.path.replace(/\.[a-z0-9]{2,5}$/, ".webp");
          const { error: upErr } = await bucket.upload(webpPath, out.bytes, { contentType: "image/webp", upsert: false });
          if (!upErr) {
            await bucket.remove([a.path]).catch(() => undefined);
            a.path = webpPath; a.type = "image/webp"; a.size = out.bytes.byteLength;
            a.name = a.name.replace(/\.[A-Za-z0-9]+$/, "") + ".webp";
          }
        }
      } catch (e) {
        await dropAll();
        if (e instanceof UploadRejected) return { ok: false, reason: e.reason === "infected" ? "infected" : e.reason === "scan_unavailable" ? "scan" : "files" } satisfies ActionData;
        throw e;
      }
    }
  }

  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  const { data: row, error } = await admin.from("contact_messages").insert({
    kind, name, email, phone, subject, message, topic, order_number: orderNumber, store_name: storeName,
    attachments, user_id: viewer?.user.id ?? null, locale: lang,
  }).select("id").single();
  if (error || !row) return { ok: false, reason: "db" } satisfies ActionData;

  // email: the team inbox + an acknowledgement to the sender (best effort, logged)
  const { sendEmail } = await import("~/lib/email/server");
  const { getSiteUrl } = await import("~/lib/env.server");
  const site = getSiteUrl(request.url);
  const { data: settingsRows } = await admin.from("settings").select("key, value").in("key", ["site.contact", "notifications", "site.general"]);
  const byKey = new Map((settingsRows ?? []).map((r) => [r.key as string, (r.value ?? {}) as Record<string, string>]));
  const teamTo = (byKey.get("notifications")?.admin_alert_email || byKey.get("site.contact")?.email || "").trim();
  const locale = lang === "en" ? "en" : "ar";
  const siteName = locale === "ar" ? "إتسوء" : "Etsawaa";
  const teamLocale = await recipientLocale(admin, teamTo, byKey.get("site.general")?.default_locale === "en" ? "en" : "ar");
  const results = await Promise.all([
    EMAIL_RE.test(teamTo) ? sendEmail(admin, {
      to: teamTo, templateKey: "contact_received", locale: teamLocale,
      variables: {
        kind: kind === "vendor" ? (teamLocale === "ar" ? "نموذج البائعين" : "Vendor form") : (teamLocale === "ar" ? "نموذج العملاء" : "Customer form"),
        subject, name, email, phone, message: `${message}${attachments.length ? `\n\n📎 ${attachments.length}` : ""}`,
        link: `${site}/${teamLocale}/admin/contact/${row.id}`,
      },
    }) : Promise.resolve({ status: "skipped" as const }),
    sendEmail(admin, { to: email, templateKey: "contact_ack", locale, variables: { name, subject, site_name: siteName } }),
  ]);
  await admin.from("contact_messages").update({ email_status: results.map((r) => r.status).join(",") }).eq("id", row.id);
  return { ok: true } satisfies ActionData;
}

type Kind = "customer" | "vendor";
interface Picked { file: File; kind: "image" | "video"; status: "pending" | "uploading" | "done" | "error"; path?: string }

export default function ContactPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const contact = root?.contact;
  const fetcher = useFetcher<ActionData>();
  const [kind, setKind] = useState<Kind>(loaderData.isVendor ? "vendor" : "customer");
  const [form, setForm] = useState({
    name: loaderData.prefill?.name ?? "", email: loaderData.prefill?.email ?? "", phone: loaderData.prefill?.phone ?? "",
    subject: "", message: "", order_number: "", store_name: "",
  });
  const [topic, setTopic] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const [files, setFiles] = useState<Picked[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const topics: readonly string[] = kind === "vendor" ? VENDOR_TOPICS : CUSTOMER_TOPICS;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const pickTopic = (next: string) => {
    setTopic(next);
    setForm((f) => ({ ...f, subject: f.subject && f.subject !== t(`contact.topic.${topic}`) ? f.subject : t(`contact.topic.${next}`) }));
  };
  const switchKind = (next: Kind) => { setKind(next); setTopic(""); setTouched(false); };

  const totals = files.reduce((acc, f) => ({ ...acc, [f.kind]: acc[f.kind] + f.file.size }), { image: 0, video: 0 });
  const mb = (n: number) => (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFileError(null);
    const next = [...files];
    let img = totals.image, vid = totals.video;
    for (const file of Array.from(list)) {
      const k = contactFileKind(file.type);
      if (!k) { setFileError(t("contact.files.badType")); continue; }
      if (next.length >= CONTACT_LIMITS.maxFiles) { setFileError(t("contact.files.tooMany", { count: CONTACT_LIMITS.maxFiles })); break; }
      if (k === "image" && file.size > CONTACT_LIMITS.imageMax) { setFileError(t("contact.files.imageTooBig", { name: file.name })); continue; }
      if (k === "video" && file.size > CONTACT_LIMITS.videoMax) { setFileError(t("contact.files.videoTooBig", { name: file.name })); continue; }
      if (k === "image" && img + file.size > CONTACT_LIMITS.imagesTotal) { setFileError(t("contact.files.imagesTotal")); continue; }
      if (k === "video" && vid + file.size > CONTACT_LIMITS.videosTotal) { setFileError(t("contact.files.videosTotal")); continue; }
      if (k === "image") img += file.size; else vid += file.size;
      next.push({ file, kind: k, status: "pending" });
    }
    setFiles(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const serverReason = fetcher.state === "idle" && fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  const localError: string | null = (() => {
    if (!touched) return null;
    if (form.name.trim().length < 3) return "name";
    if (!EMAIL_RE.test(form.email.trim())) return "email";
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim().replace(/[\s-]/g, ""))) return "phone";
    if (kind === "vendor" && form.store_name.trim().length < 2) return "store";
    if (!topic) return "topic";
    if (form.subject.trim().length < 3) return "subject";
    if (form.message.trim().length < 10) return "message";
    return null;
  })();
  const fieldError = serverReason ?? localError;
  const err = (key: string) => (fieldError === key ? t(`contact.error.${key}`) : null);

  /** upload every picked file through a signed slot, then post the form */
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (localError || (!topic) || form.name.trim().length < 3 || !EMAIL_RE.test(form.email.trim()) || form.message.trim().length < 10 || form.subject.trim().length < 3) return;
    const formEl = event.currentTarget;
    let attachments: ContactAttachment[] = [];
    if (files.length) {
      setUploading(true);
      try {
        const res = await fetch("/api/contact-upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: files.map((f) => ({ name: f.file.name, size: f.file.size, type: f.file.type })) }),
        });
        const body = (await res.json()) as { ok: boolean; reason?: string; slots?: Array<{ path: string; url: string }> };
        if (!body.ok || !body.slots) throw new Error(body.reason ?? "upload");
        const done = await Promise.all(files.map(async (f, i) => {
          setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, status: "uploading" } : x)));
          // raw body + its content type (storage keeps the real MIME, which the action re-checks)
          const up = await fetch(body.slots![i]!.url, {
            method: "PUT", body: f.file,
            headers: { "content-type": f.file.type, "x-upsert": "false", "cache-control": "max-age=3600" },
          });
          setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, status: up.ok ? "done" : "error" } : x)));
          if (!up.ok) throw new Error("upload");
          return { path: body.slots![i]!.path, name: f.file.name, size: f.file.size, type: f.file.type };
        }));
        attachments = done;
      } catch {
        setUploading(false);
        setFileError(t("contact.files.uploadFailed"));
        return;
      }
      setUploading(false);
    }
    const data = new FormData(formEl);
    data.set("attachments", JSON.stringify(attachments));
    fetcher.submit(data, { method: "post" });
  };

  const crumbs = [{ label: t("nav.home"), href: `/${lang}` }, { label: t("footer.contactUs") }];
  const channels = [
    contact?.email ? { key: "email", label: t("contactInfo.email"), value: contact.email, href: `mailto:${contact.email}` } : null,
    contact?.phone ? { key: "phone", label: t("contactInfo.phone"), value: contact.phone, href: `tel:${contact.phone.replace(/[^\d+]/g, "")}` } : null,
    contact?.whatsapp ? { key: "whatsapp", label: t("contactInfo.whatsapp"), value: contact.whatsapp, href: `https://wa.me/${contact.whatsapp.replace(/[^\d]/g, "")}` } : null,
    (lang === "ar" ? contact?.address_ar : contact?.address_en) ? { key: "address", label: t("contactInfo.address"), value: (lang === "ar" ? contact!.address_ar : contact!.address_en), href: null } : null,
    (lang === "ar" ? contact?.hours_ar : contact?.hours_en) ? { key: "hours", label: t("contactInfo.hours"), value: (lang === "ar" ? contact!.hours_ar : contact!.hours_en), href: null } : null,
  ].filter((c): c is { key: string; label: string; value: string; href: string | null } => Boolean(c));
  const busy = uploading || fetcher.state !== "idle";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={crumbs} />

      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-action to-[#7a0b1c] px-5 py-8 text-on-action shadow-2 sm:px-10 sm:py-10">
        <span aria-hidden="true" className="absolute -end-16 -top-16 size-56 rounded-full bg-white/10" />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
            <MailIcon className="size-3.5" />{t("contact.badge")}
          </span>
          <h1 className="mt-3 text-2xl font-black sm:text-4xl">{t("footer.contactUs")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/85 sm:text-base">{t("contact.subtitle")}</p>
          <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-white/90">
            <span className="size-2 animate-pulse rounded-full bg-[#5ee08a]" />{t("contact.responseTime")}
          </p>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-7" aria-label={t("contact.formTitle")}>
        {fetcher.data?.ok ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success-strong"><CheckIcon className="size-8" /></span>
            <h2 className="text-xl font-black text-text">{t("contact.sent.title")}</h2>
            <p className="max-w-sm text-sm text-text-muted">{t("contact.sent.body")}</p>
          </div>
        ) : (
          <form method="post" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="topic" value={topic} />

            {/* who is writing — two distinct forms */}
            <div role="radiogroup" aria-label={t("contact.who")} className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-surface-tint p-1.5">
              {([["customer", t("contact.asCustomer"), UserIcon], ["vendor", t("contact.asVendor"), StoreIcon]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => switchKind(k)}
                  className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-extrabold transition-all ${
                    kind === k ? (k === "vendor" ? "bg-ink text-white shadow-1" : "bg-action text-on-action shadow-1") : "text-text-muted hover:bg-surface hover:text-text"}`}>
                  <Icon className="size-4" />{label}
                </button>
              ))}
            </div>
            <p className="-mt-2 text-xs text-text-muted">{kind === "vendor" ? t("contact.vendorHint") : t("contact.customerHint")}</p>

            <fieldset>
              <legend className="mb-2 text-sm font-bold text-text">{t("contact.topicLabel")} <span className="text-danger">*</span></legend>
              <div className="flex flex-wrap gap-2">
                {topics.map((key) => (
                  <button key={key} type="button" onClick={() => pickTopic(key)} aria-pressed={topic === key}
                    className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-xs font-bold transition-colors ${
                      topic === key ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action hover:text-action"}`}>
                    {t(`contact.topic.${key}`)}
                  </button>
                ))}
              </div>
              {err("topic") ? <p className="mt-1.5 text-xs font-bold text-danger">{err("topic")}</p> : null}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t("contact.name")} name="name" value={form.name} onChange={set("name")} required maxLength={80} autoComplete="name" error={err("name") ?? undefined} inputClassName="bg-surface" />
              <Input label={t("contact.email")} name="email" type="email" value={form.email} onChange={set("email")} required maxLength={120} autoComplete="email" dir="ltr" error={err("email") ?? undefined} inputClassName="bg-surface" />
              <PhoneInput label={t("contact.phone")} name="phone" value={form.phone} onChange={set("phone")} maxLength={20} autoComplete="tel" hint={t("cu.optional")} error={err("phone") ?? undefined} inputClassName="bg-surface" />
              {kind === "vendor" ? (
                <Input label={t("contact.storeName")} name="store_name" value={form.store_name} onChange={set("store_name")} required maxLength={120} error={err("store") ?? undefined} inputClassName="bg-surface" />
              ) : (
                <Input label={t("contact.orderNumber")} name="order_number" value={form.order_number} onChange={set("order_number")} maxLength={40} dir="ltr" hint={t("contact.orderNumberHint")} inputClassName="bg-surface" />
              )}
            </div>
            <Input label={t("contact.subject")} name="subject" value={form.subject} onChange={set("subject")} required maxLength={120} error={err("subject") ?? undefined} inputClassName="bg-surface" />

            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("contact.message")}
              <textarea name="message" value={form.message} onChange={set("message")} required rows={6} maxLength={MESSAGE_MAX}
                placeholder={t("contact.messagePlaceholder")} aria-invalid={fieldError === "message"}
                className="resize-y rounded-md border border-border bg-surface px-3 py-2.5 text-sm font-normal outline-none transition-colors focus:border-action" />
              <span className="flex justify-between gap-2 text-xs font-normal">
                <span className="font-bold text-danger">{err("message")}</span>
                <span className="num text-text-faint" dir="ltr">{form.message.length}/{MESSAGE_MAX}</span>
              </span>
            </label>

            {/* attachments */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold text-text">{t("contact.files.label")}</span>
              <button type="button" onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border-strong bg-surface-tint/60 px-4 py-5 text-center transition-colors hover:border-action">
                <span className="text-sm font-extrabold text-action">{t("contact.files.pick")}</span>
                <span className="text-xs text-text-muted">{t("contact.files.limits")}</span>
              </button>
              <input ref={inputRef} type="file" multiple hidden accept={[...CONTACT_IMAGE_TYPES, ...CONTACT_VIDEO_TYPES].join(",")} onChange={(e) => addFiles(e.target.files)} />
              {files.length ? (
                <ul className="flex flex-col gap-1.5">
                  {files.map((f, i) => (
                    <li key={`${f.file.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 text-2xs font-black ${f.kind === "video" ? "bg-ink text-white" : "bg-surface-tint text-action"}`}>{t(`contact.files.${f.kind}`)}</span>
                      <span className="min-w-0 flex-1 truncate font-bold text-text" dir="auto">{f.file.name}</span>
                      <span className="num text-text-muted">{mb(f.file.size)} MB</span>
                      {f.status === "uploading" ? <span className="text-warning-strong">{t("contact.files.uploading")}</span> : f.status === "done" ? <CheckIcon className="size-4 text-success-strong" /> : f.status === "error" ? <span className="text-danger">!</span> : null}
                      {!busy ? (
                        <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={t("common.delete")}
                          className="flex size-7 cursor-pointer items-center justify-center rounded text-text-muted hover:bg-danger-soft hover:text-danger"><XIcon className="size-3.5" /></button>
                      ) : null}
                    </li>
                  ))}
                  <li className="num text-2xs text-text-faint">{t("contact.files.totals", { images: mb(totals.image), videos: mb(totals.video) })}</li>
                </ul>
              ) : null}
              {fileError ? <p role="alert" className="text-xs font-bold text-danger">{fileError}</p> : null}
            </div>

            {serverReason && ["db", "rate", "files"].includes(serverReason) ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-xs font-bold text-danger" role="alert">{t(`contact.error.${serverReason}`)}</p>
            ) : null}

            <button type="submit" disabled={busy}
              className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-action text-sm font-extrabold text-on-action shadow-1 transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60">
              <MailIcon className="size-4" />
              {uploading ? t("contact.files.uploading") : fetcher.state !== "idle" ? t("common.loading") : t("contact.send")}
            </button>
          </form>
        )}
      </section>

      {/* contact channels */}
      {channels.length || Object.keys(root?.social ?? {}).length ? (
        <section aria-labelledby="channels-title" className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <h2 id="channels-title" className="text-base font-extrabold text-text">{t("contactInfo.title")}</h2>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {channels.map((c) => (
              <li key={c.key} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-1">
                <p className="text-2xs font-bold text-text-muted">{c.label}</p>
                {c.href ? (
                  <a href={c.href} className="num text-sm font-extrabold text-action hover:underline" dir={c.key === "address" || c.key === "hours" ? undefined : "ltr"}>{c.value}</a>
                ) : <p className="text-sm font-extrabold text-text">{c.value}</p>}
              </li>
            ))}
          </ul>
          <SocialLinks links={root?.social ?? {}} tone="page" />
        </section>
      ) : null}
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
