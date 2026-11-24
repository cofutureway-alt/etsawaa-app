import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/contact-thread";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess, requirePermission } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { recipientLocale } from "~/lib/locale-preference.server";
import { PageHeader } from "~/components/layout/PageHeader";
import { Button } from "~/components/ui/Button";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import type { ContactAttachment } from "~/features/contact/limits";

/**
 * One contact message as a thread: sender, source form, topic, order/store,
 * the message, attachments (short-lived signed links), every reply sent so
 * far, and the reply box — the reply goes to the sender by email (Resend,
 * template contact_reply) and is kept in the thread.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "contact.manage");
  const id = String(params.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Not Found", { status: 404 });
  const [{ data: msg }, { data: replies }] = await Promise.all([
    client.from("contact_messages").select("*").eq("id", id).maybeSingle(),
    client.from("contact_replies").select("id, body, created_at, email_status, author_id").eq("message_id", id).order("created_at"),
  ]);
  if (!msg) throw new Response("Not Found", { status: 404 });
  // first open marks it as being handled
  if (msg.status === "new") await client.from("contact_messages").update({ status: "open" }).eq("id", id);

  const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
  const admin = getSupabaseAdminClient();
  const attachments = (msg.attachments ?? []) as ContactAttachment[];
  const signed = admin && attachments.length
    ? (await admin.storage.from("contact").createSignedUrls(attachments.map((a) => a.path), 60 * 60)).data ?? []
    : [];
  const authorIds = [...new Set(((replies ?? []) as Array<{ author_id: string | null }>).map((r) => r.author_id).filter(Boolean))] as string[];
  const { data: authors } = authorIds.length ? await client.from("profiles").select("id, full_name").in("id", authorIds) : { data: [] };
  const nameOf = new Map(((authors ?? []) as Array<{ id: string; full_name: string }>).map((a) => [a.id, a.full_name]));
  return {
    lang,
    msg: { ...msg, status: msg.status === "new" ? "open" : msg.status } as { id: string; kind: string; name: string; email: string; phone: string; subject: string; message: string; topic: string; order_number: string; store_name: string; status: string; created_at: string },
    files: attachments.map((a, i) => ({ ...a, url: (signed[i] as { signedUrl?: string } | undefined)?.signedUrl ?? null })),
    replies: ((replies ?? []) as Array<{ id: string; body: string; created_at: string; email_status: string | null; author_id: string | null }>)
      .map((r) => ({ ...r, author: (r.author_id && nameOf.get(r.author_id)) || "—" })),
  };
}

type ActionData = { ok: boolean; reason?: string; intent?: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "contact.manage");
  const id = String(params.id ?? "");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "status") {
    const status = String(form.get("status") ?? "");
    if (!["open", "replied", "closed"].includes(status)) return data<ActionData>({ ok: false, reason: "bad_status" }, { status: 400 });
    const { error } = await client.from("contact_messages").update({ status }).eq("id", id);
    return error ? data<ActionData>({ ok: false, reason: error.message }, { status: 400 }) : { ok: true, intent };
  }

  if (intent === "reply") {
    const body = String(form.get("body") ?? "").trim();
    if (body.length < 2 || body.length > 5000) return data<ActionData>({ ok: false, reason: "body" }, { status: 400 });
    const { data: msg } = await client.from("contact_messages").select("id, name, email, subject, locale").eq("id", id).maybeSingle();
    if (!msg) return data<ActionData>({ ok: false, reason: "not_found" }, { status: 404 });
    const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
    const { sendEmail } = await import("~/lib/email/server");
    const admin = getSupabaseAdminClient();
    const fallback = msg.locale === "en" ? "en" : "ar";
    const locale = admin ? await recipientLocale(admin, msg.email, fallback) : fallback;
    const sent = await sendEmail(admin, {
      to: msg.email, templateKey: "contact_reply", locale,
      variables: { name: msg.name, body, subject: msg.subject, site_name: locale === "ar" ? "إتسوء" : "Etsawaa" },
    });
    const { error } = await client.from("contact_replies").insert({ message_id: id, author_id: viewer.user.id, body, email_status: sent.status });
    if (error) return data<ActionData>({ ok: false, reason: error.message }, { status: 400 });
    await client.from("contact_messages").update({ status: "replied", last_reply_at: new Date().toISOString() }).eq("id", id);
    return sent.status === "sent" ? { ok: true, intent } : data<ActionData>({ ok: false, intent, reason: `email_${sent.status}` }, { status: 502 });
  }
  return data<ActionData>({ ok: false, reason: "intent" }, { status: 400 });
}

const STATUS_TONE: Record<string, string> = { open: "bg-warning-soft text-warning-strong", replied: "bg-success-soft text-success-strong", closed: "bg-surface-tint text-text-muted", new: "bg-danger text-white" };

export default function ContactThread({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, msg, files, replies } = loaderData;
  const reply = useFetcher<ActionData>();
  const status = useFetcher<ActionData>();
  const [body, setBody] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (reply.state === "idle" && reply.data?.ok) setBody(""); }, [reply.state, reply.data]);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const kindTone = msg.kind === "vendor" ? "bg-[#6B3FA0]/10 text-[#56308a] border-[#6B3FA0]/30" : "bg-[#1e6fd9]/10 text-[#1557b0] border-[#1e6fd9]/30";

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/${lang}/admin/contact`} className="w-fit text-sm font-bold text-action hover:underline">← {t("inbox.back")}</Link>
      <PageHeader title={msg.subject} subtitle={when(msg.created_at)} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          {/* original message */}
          <article className="rounded-xl border border-border bg-surface p-4 shadow-1">
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-2xs font-black ${kindTone}`}>{t(`inbox.kind.${msg.kind}`)}</span>
              {msg.topic ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t(`contact.topic.${msg.topic}`, msg.topic)}</span> : null}
              <span className="ms-auto text-sm font-extrabold text-text">{msg.name}</span>
            </header>
            <p className="whitespace-pre-line text-sm leading-relaxed text-text" dir="auto">{msg.message}</p>
            {files.length ? (
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((f) => (
                  <li key={f.path} className="overflow-hidden rounded-lg border border-border bg-surface-tint">
                    {f.url && f.type.startsWith("image/") ? (
                      <a href={f.url} target="_blank" rel="noopener noreferrer"><img src={f.url} alt={f.name} loading="lazy" className="aspect-square w-full object-cover" /></a>
                    ) : f.url ? (
                      <video src={f.url} controls preload="metadata" className="aspect-square w-full bg-ink object-contain" />
                    ) : <span className="block p-3 text-xs text-text-muted">{f.name}</span>}
                    <p className="num truncate px-2 py-1 text-2xs text-text-muted" dir="auto">{f.name} · {(f.size / 1_000_000).toFixed(1)} MB</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>

          {/* replies */}
          {replies.length ? (
            <ol className="flex flex-col gap-2.5" aria-label={t("inbox.replies")}>
              {replies.map((r) => (
                <li key={r.id} className="ms-6 rounded-xl border border-action/25 bg-action/[0.04] p-3.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-2xs text-text-muted">
                    <b className="text-text">{r.author}</b>
                    <time className="num">{when(r.created_at)}</time>
                    <span className={`rounded px-1.5 py-0.5 font-bold ${r.email_status === "sent" ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"}`}>
                      {r.email_status === "sent" ? t("inbox.emailSent") : t("inbox.emailFailed")}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-sm text-text" dir="auto">{r.body}</p>
                </li>
              ))}
            </ol>
          ) : null}

          {/* reply box */}
          <reply.Form ref={formRef} method="post" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-1">
            <input type="hidden" name="intent" value="reply" />
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("inbox.replyTo", { email: msg.email })}
              <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} required dir="auto"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal" placeholder={t("inbox.replyPlaceholder")} />
            </label>
            {reply.data && !reply.data.ok ? <p role="alert" className="text-xs font-bold text-danger">{t("inbox.replyFailed")} ({reply.data.reason})</p> : null}
            {reply.data?.ok ? <p className="text-xs font-bold text-success-strong">{t("inbox.replySent")}</p> : null}
            <div className="flex justify-end"><Button type="submit" loading={reply.state !== "idle"} disabled={body.trim().length < 2}>{t("inbox.sendReply")}</Button></div>
          </reply.Form>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-1 lg:sticky lg:top-4 lg:self-start">
          <dl className="flex flex-col gap-2">
            <div><dt className="text-2xs font-bold text-text-muted">{t("contact.email")}</dt><dd><a href={`mailto:${msg.email}`} className="font-bold text-action" dir="ltr">{msg.email}</a></dd></div>
            {msg.phone ? <div><dt className="text-2xs font-bold text-text-muted">{t("contact.phone")}</dt><dd className="num font-bold" dir="ltr">{msg.phone}</dd></div> : null}
            {msg.order_number ? <div><dt className="text-2xs font-bold text-text-muted">{t("contact.orderNumber")}</dt><dd className="num font-bold" dir="ltr">{msg.order_number}</dd></div> : null}
            {msg.store_name ? <div><dt className="text-2xs font-bold text-text-muted">{t("contact.storeName")}</dt><dd className="font-bold">{msg.store_name}</dd></div> : null}
            <div><dt className="text-2xs font-bold text-text-muted">{t("inbox.statusLabel")}</dt><dd><span className={`rounded-full px-2 py-0.5 text-2xs font-black ${STATUS_TONE[msg.status] ?? ""}`}>{t(`inbox.status.${msg.status}`)}</span></dd></div>
          </dl>
          <status.Form method="post" className="flex flex-wrap gap-2 border-t border-border pt-3">
            <input type="hidden" name="intent" value="status" />
            {msg.status !== "closed" ? (
              <Button type="submit" name="status" value="closed" variant="outline" size="sm">{t("inbox.close")}</Button>
            ) : (
              <Button type="submit" name="status" value="open" variant="outline" size="sm">{t("inbox.reopen")}</Button>
            )}
          </status.Form>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() { return <RouteErrorBoundary backHref="../contact" />; }
export function HydrateFallback() { return <SkeletonPage />; }
