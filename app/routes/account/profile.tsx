import { PhoneInput } from "~/components/phone/PhoneInput";
import { data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/profile";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { passwordSchema } from "~/features/auth/schemas";
import { Input } from "~/components/ui/Input";
import { Button } from "~/components/ui/Button";
import { MediaImg } from "~/components/catalog/MediaImg";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";
import { GoogleMark } from "~/components/auth/GoogleButton";


/**
 * Profile (O-28 / AGENT §30) — shared by every role. Name + phones + password
 * change live here; the email is changed through the OTP/confirm flow only
 * (never edited inline).
 * The profile picture and cover are edited on the identity card in the account
 * layout (every tab), not here. A store owner also sees the store logo, which
 * changes in Store settings (an active store's logo goes to admin review) — the
 * picture used to be routed there, so an owner's picture never saved and
 * vanished on reload.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);

  const [{ data: profile }, { data: vendor }, { data: legal }] = await Promise.all([
    client.from("profiles").select("full_name, phone, phone_alternate, email").eq("id", viewer.user.id).maybeSingle(),
    client.from("vendors").select("id, status, store_name_ar, store_name_en, logo_path").eq("owner_id", viewer.user.id).maybeSingle(),
    // the documents this user accepted (version + time) — readable any time
    client.from("legal_acceptances").select("id, kind, version, accepted_at").eq("user_id", viewer.user.id).order("accepted_at", { ascending: false }),
  ]);
  // a logo change waiting for admin review (active stores)
  const { data: pendingLogo } = vendor
    ? await client.from("vendor_change_requests").select("changes").eq("vendor_id", vendor.id).eq("status", "pending").maybeSingle()
    : { data: null };
  return {
    pendingLogo: ((pendingLogo?.changes as Record<string, unknown> | undefined)?.logo_path as string | undefined) ?? null,
    legal: (legal ?? []) as Array<{ id: string; kind: string; version: string; accepted_at: string }>,
    lang,
    role: viewer.profile.role,
    profile: JSON.parse(JSON.stringify(profile ?? {})),
    vendor: JSON.parse(JSON.stringify(vendor ?? null)),
    email: viewer.user.email ?? profile?.email ?? "",
    google: googleState(viewer.user),
    googleResult: new URL(request.url).searchParams.get("google"),
  };
}

/** Linked Google identity (email) and whether it can be removed — Supabase
 * refuses to unlink the last sign-in method, so Google-only accounts keep it. */
function googleState(user: { identities?: Array<{ provider: string; identity_data?: Record<string, unknown> }> }) {
  const ids = user.identities ?? [];
  const g = ids.find((i: { provider: string }) => i.provider === "google");
  return {
    linked: Boolean(g),
    email: g ? String(g.identity_data?.email ?? "") : null,
    canUnlink: Boolean(g) && ids.length > 1,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "details") {
    const primary = normalizeEgyptianPhone(String(form.get("phone") ?? ""));
    if (!primary.ok) return data({ ok: false, reason: "phone" }, { status: 400 });
    const alternateRaw = String(form.get("phone_alternate") ?? "").trim();
    let alternate: string | null = null;
    if (alternateRaw) {
      const a = normalizeEgyptianPhone(alternateRaw);
      if (!a.ok) return data({ ok: false, reason: "phone_alternate" }, { status: 400 });
      if (a.e164 === primary.e164) return data({ ok: false, reason: "phones_equal" }, { status: 400 });
      alternate = a.e164;
    }
    const fullName = String(form.get("full_name") ?? "").trim();
    if (!fullName) return data({ ok: false, reason: "name" }, { status: 400 });
    const { error } = await client
      .from("profiles")
      .update({ full_name: fullName, phone: primary.e164, phone_alternate: alternate })
      .eq("id", viewer.user.id);
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }

  if (intent === "google_unlink") {
    const { data: me } = await client.auth.getUserIdentities();
    const ids = me?.identities ?? [];
    const g = ids.find((i: { provider: string }) => i.provider === "google");
    if (!g || ids.length < 2) return data({ ok: false, reason: "google_unlink" }, { status: 400 });
    const { error } = await client.auth.unlinkIdentity(g);
    if (error) return data({ ok: false, reason: "google_unlink" }, { status: 400 });
    throw redirect(`/${lang}/account/profile?google=unlinked`);
  }

  if (intent === "password") {
    const current = String(form.get("current_password") ?? "");
    const next = String(form.get("new_password") ?? "");
    // Same rules as registration/forgot (8–72, letter + digit) — this path
    // previously accepted any 8 characters, bypassing passwordSchema.
    if (!passwordSchema.safeParse(next).success) {
      return data({ ok: false, reason: "weak" }, { status: 400 });
    }
    // verify the current password by signing in with it
    const { error: signInError } = await client.auth.signInWithPassword({
      email: viewer.user.email ?? "",
      password: current,
    });
    if (signInError) return data({ ok: false, reason: "wrong_current" }, { status: 400 });
    const { error } = await client.auth.updateUser({ password: next });
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }

  if (intent === "email") {
    const email = String(form.get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return data({ ok: false, reason: "bad_email" }, { status: 400 });
    // Supabase sends a confirmation link to the NEW address; the old one stays
    // valid until confirmed (O-14: old verification is invalidated on confirm)
    const { error } = await client.auth.updateUser({ email }, { emailRedirectTo: `${process.env.SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin}/${lang}/auth/verify?type=email_change` });
    if (error) {
      const reason = error.message.includes("already") ? "email_taken" : "failed";
      return data({ ok: false, reason }, { status: 400 });
    }
    // OTP flow (AGENT §30): a 6-digit code goes to the NEW address — the user
    // confirms it on the verify screen; the emailed LINK confirms as well.
    throw redirect(`/${lang}/auth/verify?type=email_change&email=${encodeURIComponent(email)}&sent=${Date.now()}`);
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  // anyone who owns a store (a seller, or an admin with a store)
  const isVendor = Boolean(loaderData.vendor);

  return (
    <div className="grid max-w-3xl gap-6">
      {isVendor ? (
        <section className="rounded-md border border-border bg-surface-tint p-4 text-sm">
          <p className="font-bold text-text">{t("profile.storeName")}: {loaderData.vendor?.store_name_ar ?? ""}</p>
          <p className="text-text-muted">{t("profile.storeNameNote")}</p>
        </section>
      ) : null}

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("profile.details")}</h2>
        <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="details" />
          <Input
            id="pf-name" label={t("profile.fullName")} name="full_name" required
            defaultValue={loaderData.profile.full_name ?? ""} autoComplete="name"
          />
          <PhoneInput
            id="pf-phone" label={t("checkout.primaryPhone")} name="phone" required
            defaultValue={loaderData.profile.phone ?? ""}
          />
          <PhoneInput
            id="pf-phone2" label={t("checkout.alternatePhone")} name="phone_alternate"
            defaultValue={loaderData.profile.phone_alternate ?? ""} hint={t("checkout.alternateHint")}
          />
          <Button type="submit" loading={fetcher.state !== "idle"}>{t("profile.save")}</Button>
        </fetcher.Form>
        {fetcher.data && "ok" in fetcher.data && fetcher.data.ok ? (
          <p role="status" className="mt-2 text-sm text-primary">{t("profile.saved")}</p>
        ) : null}
        {fetcher.data && !fetcher.data.ok ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {fetcher.data.reason === "phones_equal" ? t("checkout.errPhonesEqual")
              : fetcher.data.reason === "phone_alternate" ? t("checkout.errPhone")
              : t("profile.failed")}
          </p>
        ) : null}
      </section>

      <GoogleLinkSection lang={loaderData.lang} email={loaderData.email} google={loaderData.google} result={loaderData.googleResult} />

      {isVendor ? (
        <section className="rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-extrabold text-text">{t("profile.storeLogo")}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {loaderData.vendor.logo_path ? (
              <MediaImg path={loaderData.vendor.logo_path} alt="" className="size-16 rounded-md border border-border object-cover" />
            ) : <span className="flex size-16 items-center justify-center rounded-md border border-border bg-surface-tint text-xs text-text-muted">—</span>}
            <div className="flex flex-col gap-1 text-sm">
              {loaderData.pendingLogo ? (
                <span className="flex items-center gap-2 text-xs font-bold text-warning-strong">
                  <MediaImg path={loaderData.pendingLogo} alt="" className="size-8 rounded border border-border object-cover" />
                  {t("profile.logoPending")}
                </span>
              ) : null}
              <a href={`/${loaderData.lang}/vendor/store`} className="font-bold text-action hover:underline">{t("profile.changeLogo")}</a>
              <span className="text-xs text-text-muted">{t("profile.logoHint")}</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("profile.email")}</h2>
        <p className="mt-1.5 text-sm text-text-muted" dir="ltr">{loaderData.email}</p>
        <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="email" />
          <Input
            id="pf-email" label={t("profile.newEmail")} name="email" type="email" required
            hint={t("profile.emailOtpHint")} inputClassName="ltr:text-left"
          />
          <Button type="submit" variant="outline" loading={fetcher.state !== "idle"}>{t("profile.requestEmailChange")}</Button>
        </fetcher.Form>
        {fetcher.data && "ok" in fetcher.data && fetcher.data.ok ? (
          <p role="status" className="mt-2 text-sm text-primary">{t("profile.emailPending")}</p>
        ) : null}
        {fetcher.data && !fetcher.data.ok && fetcher.data.reason === "email_taken" ? (
          <p role="alert" className="mt-2 text-sm text-danger">{t("profile.emailTaken")}</p>
        ) : null}
      </section>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("profile.password")}</h2>
        <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="password" />
          <Input id="pf-pass1" label={t("profile.currentPassword")} name="current_password" type="password" required showPasswordToggle autoComplete="current-password" />
          <Input id="pf-pass2" label={t("profile.newPassword")} name="new_password" type="password" required showPasswordToggle minLength={8} hint={t("auth.passwordHint")} autoComplete="new-password" />
          <Button type="submit" variant="outline" loading={fetcher.state !== "idle"}>{t("profile.changePassword")}</Button>
        </fetcher.Form>
        {fetcher.data && "ok" in fetcher.data && fetcher.data.ok && fetcher.data.ok ? (
          <p role="status" className="mt-2 text-sm text-primary">{t("profile.passwordChanged")}</p>
        ) : null}
        {fetcher.data && !fetcher.data.ok ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {fetcher.data.reason === "wrong_current" ? t("profile.wrongCurrent")
              : fetcher.data.reason === "weak" ? t("profile.weakPassword")
              : t("profile.failed")}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-1" aria-labelledby="pf-legal">
        <h2 id="pf-legal" className="text-sm font-extrabold text-text">{t("legal.myDocuments")}</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {loaderData.legal.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
              <a href={`/${loaderData.lang}/legal/${a.kind === "terms" ? "terms" : "seller-agreement"}?v=${encodeURIComponent(a.version)}`} className="font-bold text-action hover:underline">
                {t(`legal.kind_${a.kind}`)} · v{a.version}
              </a>
              <span className="num text-xs text-text-muted">{t("legal.acceptedOn", { date: new Date(a.accepted_at).toLocaleDateString(loaderData.lang === "en" ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }) })}</span>
            </li>
          ))}
          <li><a href={`/${loaderData.lang}/legal/terms`} className="text-xs font-bold text-text-muted hover:text-action">{t("legal.readTerms")}</a></li>
        </ul>
      </section>
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}

const GOOGLE_RESULT: Record<string, { key: string; ok: boolean }> = {
  linked: { key: "profile.google.linkedOk", ok: true },
  unlinked: { key: "profile.google.unlinkedOk", ok: true },
  mismatch: { key: "profile.google.mismatch", ok: false },
  taken: { key: "profile.google.taken", ok: false },
  cancelled: { key: "profile.google.cancelled", ok: false },
  unavailable: { key: "profile.google.unavailable", ok: false },
  failed: { key: "profile.google.failed", ok: false },
};

/** Connected Google account: link (same email only) / unlink. */
function GoogleLinkSection({ lang, email, google, result }: {
  lang: string;
  email: string;
  google: { linked: boolean; email: string | null; canUnlink: boolean };
  result: string | null;
}) {
  const { t } = useTranslation();
  const unlink = useFetcher<{ ok: boolean; reason?: string }>();
  const msg = result ? GOOGLE_RESULT[result] : undefined;
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-extrabold text-text">{t("profile.google.title")}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface">
          <GoogleMark />
        </span>
        <div className="min-w-0 flex-1 basis-52">
          {google.linked ? (
            <>
              <p className="text-sm font-bold text-text">{t("profile.google.linked")}</p>
              <p className="num truncate text-xs text-text-muted" dir="ltr">{google.email}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-text">{t("profile.google.notLinked")}</p>
              <p className="text-xs text-text-muted">
                {t("profile.google.sameEmail")} <span className="num" dir="ltr">{email}</span>
              </p>
            </>
          )}
        </div>
        {google.linked ? (
          google.canUnlink ? (
            <unlink.Form method="post" className="w-full sm:w-auto">
              <input type="hidden" name="intent" value="google_unlink" />
              <Button type="submit" variant="outline" block loading={unlink.state !== "idle"}>{t("profile.google.unlink")}</Button>
            </unlink.Form>
          ) : null
        ) : (
          <form method="post" action={`/${lang}/auth/google/link`} className="w-full sm:w-auto">
            <Button type="submit" variant="outline" block>{t("profile.google.link")}</Button>
          </form>
        )}
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm font-bold ${msg.ok ? "text-success-strong" : "text-danger"}`}>
          {t(msg.key, { email })}
        </p>
      ) : null}
      {unlink.data && !unlink.data.ok ? (
        <p role="alert" className="mt-3 text-sm font-bold text-danger">{t("profile.google.failed")}</p>
      ) : null}
    </section>
  );
}
