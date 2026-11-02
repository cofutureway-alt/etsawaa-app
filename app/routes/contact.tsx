import { useState } from "react";
import type { ActionFunctionArgs } from "react-router";
import type { Route } from "./+types/contact";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { Input } from "~/components/ui/Input";
import { CheckIcon } from "~/components/ui/icons";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * Contact page (S-12 / US-10): validates inline, keeps the message on
 * error, confirms sending. Messages land in `contact_messages` (admin
 * reads them in phase 07).
 */
export async function loader({ params }: Route.LoaderArgs) {
  return { lang: requireLang(params) };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/contact",
    title: lang === "ar" ? "تواصل معنا — اتسوء" : "Contact us — Etsawaa",
    description:
      lang === "ar"
        ? "فريق دعم اتسوء يجيب على استفسارات العملاء والبائعين — راسلنا وسنعاود التواصل."
        : "The Etsawaa support team answers customer and seller questions — write to us and we'll get back.",
  });
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(\+?2)?01[0125][0-9]{8}$/;

type ActionData = { ok: boolean; reason?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  requireLang(params); // locale guard: unknown :lang → 404
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false, reason: "db" } satisfies ActionData;

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();

  if (name.length < 3 || name.length > 80) return { ok: false, reason: "name" } satisfies ActionData;
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "email" } satisfies ActionData;
  if (phone && !PHONE_RE.test(phone.replace(/[\s-]/g, ""))) return { ok: false, reason: "phone" } satisfies ActionData;
  if (subject.length < 3 || subject.length > 120) return { ok: false, reason: "subject" } satisfies ActionData;
  if (message.length < 10 || message.length > 2000) return { ok: false, reason: "message" } satisfies ActionData;

  const { error } = await client.from("contact_messages").insert({ name, email, phone, subject, message });
  if (error) return { ok: false, reason: "db" } satisfies ActionData;
  return { ok: true } satisfies ActionData;
}

export default function ContactPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const fetcher = useFetcher<ActionData>();
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [touched, setTouched] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // inline validation runs after the first submit attempt (or server error)
  const serverReason = fetcher.state === "idle" && fetcher.data && !fetcher.data.ok ? fetcher.data.reason : null;
  const localError: string | null = (() => {
    if (!touched) return null;
    if (form.name.trim().length < 3) return "name";
    if (!EMAIL_RE.test(form.email.trim())) return "email";
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim().replace(/[\s-]/g, ""))) return "phone";
    if (form.subject.trim().length < 3) return "subject";
    if (form.message.trim().length < 10) return "message";
    return null;
  })();
  const fieldError = serverReason ?? localError;

  if (fetcher.data?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.contact") }]} />
        <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-l border border-border bg-surface p-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success-strong">
            <CheckIcon className="size-7" />
          </span>
          <h1 className="text-lg font-black text-text">{t("contact.sent.title")}</h1>
          <p className="text-[13px] text-text-muted">{t("contact.sent.body")}</p>
        </div>
      </div>
    );
  }

  const err = (key: string) => (fieldError === key ? t(`contact.error.${key}`) : null);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.contact") }]} />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <header>
          <h1 className="text-lg font-black text-text">{t("contact.title")}</h1>
          <p className="mt-1 text-[13px] text-text-muted">{t("contact.subtitle")}</p>
        </header>

        <fetcher.Form method="post" noValidate onSubmit={() => setTouched(true)} className="flex flex-col gap-3 rounded-l border border-border bg-surface p-5">
          <Input label={t("contact.name")} name="name" value={form.name} onChange={set("name")} required maxLength={80} error={err("name") ?? undefined} inputClassName="bg-surface" />
          <Input label={t("contact.email")} name="email" type="email" value={form.email} onChange={set("email")} required maxLength={120} error={err("email") ?? undefined} inputClassName="bg-surface" />
          <Input label={t("contact.phone")} name="phone" type="tel" value={form.phone} onChange={set("phone")} maxLength={20} hint={t("contact.phoneHint")} error={err("phone") ?? undefined} inputClassName="bg-surface" />
          <Input label={t("contact.subject")} name="subject" value={form.subject} onChange={set("subject")} required maxLength={120} error={err("subject") ?? undefined} inputClassName="bg-surface" />
          <label className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
            {t("contact.message")}
            <textarea
              name="message"
              value={form.message}
              onChange={set("message")}
              required
              rows={5}
              maxLength={2000}
              aria-invalid={fieldError === "message"}
              className="rounded-m border border-border bg-surface px-3 py-2.5 text-[13px] outline-none transition-colors duration-150 focus:border-action"
            />
            {err("message") ? <span className="text-[12px] font-bold text-danger">{err("message")}</span> : null}
          </label>
          {serverReason === "db" ? (
            <p className="rounded-m bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger" role="alert">{t("contact.error.db")}</p>
          ) : null}
          <button
            type="submit"
            disabled={fetcher.state !== "idle"}
            className="mt-1 flex min-h-11 cursor-pointer items-center justify-center rounded-m bg-action text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {fetcher.state !== "idle" ? t("common.loading") : t("contact.send")}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
