import { data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/profile";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { Input } from "~/components/ui/Input";
import { Button } from "~/components/ui/Button";
import { AvatarField } from "~/features/account/AvatarField";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * Profile (O-28 / AGENT §30) — shared by every role. Name + phones + avatar
 * + password change live here; the email is changed through the OTP/confirm
 * flow only (never edited inline). Vendor profile shows the store name and
 * the avatar edits the STORE LOGO.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);

  const [{ data: profile }, { data: vendor }] = await Promise.all([
    client.from("profiles").select("full_name, phone, phone_alternate, avatar_url, email").eq("id", viewer.user.id).maybeSingle(),
    client.from("vendors").select("id, store_name_ar, store_name_en, logo_path").eq("owner_id", viewer.user.id).maybeSingle(),
  ]);
  return {
    lang,
    role: viewer.profile.role,
    profile: JSON.parse(JSON.stringify(profile ?? {})),
    vendor: JSON.parse(JSON.stringify(vendor ?? null)),
    email: viewer.user.email ?? profile?.email ?? "",
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

  if (intent === "avatar") {
    const path = String(form.get("path") ?? "");
    if (!path || !/^u\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/.test(path)) {
      return data({ ok: false, reason: "bad_path" }, { status: 400 });
    }
    const { data: vendor } = await client.from("vendors").select("id").eq("owner_id", viewer.user.id).maybeSingle();
    if (vendor) {
      // vendor avatar IS the store logo (O-28)
      const { error } = await client.from("vendors").update({ logo_path: path }).eq("id", vendor.id);
      return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
    }
    const { error } = await client.from("profiles").update({ avatar_url: path }).eq("id", viewer.user.id);
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }

  if (intent === "password") {
    const current = String(form.get("current_password") ?? "");
    const next = String(form.get("new_password") ?? "");
    if (next.length < 8) return data({ ok: false, reason: "weak" }, { status: 400 });
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
    const { error } = await client.auth.updateUser({ email });
    if (error) {
      const reason = error.message.includes("already") ? "email_taken" : "failed";
      return data({ ok: false, reason }, { status: 400 });
    }
    // OTP flow (AGENT §30): a 6-digit code goes to the NEW address — the user
    // confirms it on the verify screen; the emailed LINK confirms as well.
    throw redirect(`/${lang}/auth/verify?type=email_change&email=${encodeURIComponent(email)}`);
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const isVendor = loaderData.role === "vendor" && loaderData.vendor;

  return (
    <div className="grid max-w-3xl gap-6">
      {isVendor ? (
        <section className="rounded-m border border-border bg-surface-tint p-4 text-[13px]">
          <p className="font-bold text-text">{t("profile.storeName")}: {loaderData.role === "vendor" ? loaderData.vendor.store_name_ar : ""}</p>
          <p className="text-text-muted">{t("profile.storeNameNote")}</p>
        </section>
      ) : null}

      <section className="rounded-m border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("profile.details")}</h2>
        <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="details" />
          <Input
            id="pf-name" label={t("profile.fullName")} name="full_name" required
            defaultValue={loaderData.profile.full_name ?? ""} autoComplete="name"
          />
          <Input
            id="pf-phone" label={t("checkout.primaryPhone")} name="phone" required type="tel" dir="ltr"
            defaultValue={loaderData.profile.phone ?? ""} hint={t("checkout.phoneHint")}
          />
          <Input
            id="pf-phone2" label={t("checkout.alternatePhone")} name="phone_alternate" type="tel" dir="ltr"
            defaultValue={loaderData.profile.phone_alternate ?? ""} hint={t("checkout.alternateHint")}
          />
          <Button type="submit" loading={fetcher.state !== "idle"}>{t("profile.save")}</Button>
        </fetcher.Form>
        {fetcher.data && "ok" in fetcher.data && fetcher.data.ok ? (
          <p role="status" className="mt-2 text-[13px] text-primary">{t("profile.saved")}</p>
        ) : null}
        {fetcher.data && !fetcher.data.ok ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {fetcher.data.reason === "phones_equal" ? t("checkout.errPhonesEqual")
              : fetcher.data.reason === "phone_alternate" ? t("checkout.errPhone")
              : t("profile.failed")}
          </p>
        ) : null}
      </section>

      <section className="rounded-m border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{isVendor ? t("profile.storeLogo") : t("profile.avatar")}</h2>
        <div className="mt-3">
          <AvatarField
            initialPath={isVendor ? loaderData.vendor.logo_path : loaderData.profile.avatar_url}
            alt={loaderData.profile.full_name ?? ""}
          />
        </div>
      </section>

      <section className="rounded-m border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("profile.email")}</h2>
        <p className="mt-1.5 text-[13px] text-text-muted" dir="ltr">{loaderData.email}</p>
        <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="email" />
          <Input
            id="pf-email" label={t("profile.newEmail")} name="email" type="email" required
            hint={t("profile.emailOtpHint")} inputClassName="ltr:text-left"
          />
          <Button type="submit" variant="outline" loading={fetcher.state !== "idle"}>{t("profile.requestEmailChange")}</Button>
        </fetcher.Form>
        {fetcher.data && "ok" in fetcher.data && fetcher.data.ok ? (
          <p role="status" className="mt-2 text-[13px] text-primary">{t("profile.emailPending")}</p>
        ) : null}
        {fetcher.data && !fetcher.data.ok && fetcher.data.reason === "email_taken" ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">{t("profile.emailTaken")}</p>
        ) : null}
      </section>

      <section className="rounded-m border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("profile.password")}</h2>
        <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="intent" value="password" />
          <Input id="pf-pass1" label={t("profile.currentPassword")} name="current_password" type="password" required showPasswordToggle autoComplete="current-password" />
          <Input id="pf-pass2" label={t("profile.newPassword")} name="new_password" type="password" required showPasswordToggle minLength={8} hint={t("auth.passwordHint")} autoComplete="new-password" />
          <Button type="submit" variant="outline" loading={fetcher.state !== "idle"}>{t("profile.changePassword")}</Button>
        </fetcher.Form>
        {fetcher.data && "ok" in fetcher.data && fetcher.data.ok && fetcher.data.ok ? (
          <p role="status" className="mt-2 text-[13px] text-primary">{t("profile.passwordChanged")}</p>
        ) : null}
        {fetcher.data && !fetcher.data.ok ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {fetcher.data.reason === "wrong_current" ? t("profile.wrongCurrent")
              : fetcher.data.reason === "weak" ? t("profile.weakPassword")
              : t("profile.failed")}
          </p>
        ) : null}
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
