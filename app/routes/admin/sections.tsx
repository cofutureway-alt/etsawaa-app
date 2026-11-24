import { Link, data } from "react-router";
import type { Route } from "./+types/sections";
import { clearPublicSettingsCache } from "~/features/settings/api";
import { useFetcher } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { egpToPiastres, piastresToEgp } from "~/lib/money";
import { getKashierEnv, getSiteUrl, getSmtpSender, getSupabaseEnv } from "~/lib/env.server";
import { sendEmail } from "~/lib/email/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { webhookUrl } from "~/features/checkout/kashier.server";
import { KASHIER_METHODS, parseKashierSettings } from "~/features/checkout/kashier.shared";


/**
 * Platform settings — only settings something actually reads:
 * sellers, verification, withdrawals, payments (COD + Kashier), pickup
 * billing, packaging. Each card saves independently through
 * fn_admin_set_setting (audited) and MERGES into the stored value, so keys a
 * card does not show are kept.
 *
 * Integrations whose secrets live in server env files (mail server, Google
 * sign-in, sign-up codes, Kashier keys) are shown read-only as live status,
 * with a "send test email" check — they are configured on the server, not here.
 *
 * Removed 2026-11-06 (saved but read by nothing): general (URL pattern,
 * single seller, customer details, welcome text), login provider toggles,
 * financial commission defaults (commission is per category), policies text
 * (Legal pages), SEO, email provider/SMTP, notification channels.
 */

type SectionKey = "vendors" | "verification" | "wallet" | "payments" | "pickup" | "packaging" | "site.social" | "site.contact" | "shipping_rules";

const SECTIONS: SectionKey[] = ["vendors", "verification", "wallet", "payments", "pickup", "packaging", "site.social", "site.contact", "shipping_rules"];

const NUMERIC_FIELDS: Partial<Record<SectionKey, string[]>> = {
  wallet: ["min_withdrawal_piastres", "hold_days"],
  payments: ["cod_max_total_piastres"],
  verification: ["grace_value", "max_document_mb"],
  packaging: ["split_percent", "max_open_balances", "return_window_days", "deferred_max_orders"],
};

interface AuthServerState { reachable: boolean; google: boolean; emailCodes: boolean }

/** GoTrue's public settings: which providers are on, whether sign-up needs the emailed code. */
async function authServerState(): Promise<AuthServerState> {
  const env = getSupabaseEnv();
  if (!env) return { reachable: false, google: false, emailCodes: false };
  try {
    const res = await fetch(`${env.url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: env.anonKey }, signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { reachable: false, google: false, emailCodes: false };
    const j = (await res.json()) as { external?: Record<string, boolean>; mailer_autoconfirm?: boolean };
    return { reachable: true, google: Boolean(j.external?.google), emailCodes: j.mailer_autoconfirm === false };
  } catch {
    return { reachable: false, google: false, emailCodes: false };
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const [{ data: rows }, auth, { data: cats }] = await Promise.all([
    client.from("settings").select("key, value"),
    authServerState(),
    // shipping rules pick from the browse tree (levels 1-3)
    client.from("categories").select("id, name_ar, name_en, depth, path").is("deleted_at", null).lte("depth", 3).order("path").limit(1000),
  ]);
  const byKey: Record<string, Record<string, unknown>> = {};
  for (const r of (rows ?? []) as Array<{ key: string; value: unknown }>) {
    if (typeof r.value === "object" && r.value !== null) byKey[r.key] = r.value as Record<string, unknown>;
  }
  // Kashier keys live only in the server env: the page sees which exist, never the values
  const env = getKashierEnv();
  const site = getSiteUrl(request.url);
  const kashier = {
    merchantId: env?.merchantId ?? null,
    live: Boolean(env?.live),
    test: Boolean(env?.test),
    webhookUrl: new URL("/api/webhooks/kashier", site).toString(),
    webhookReachable: webhookUrl(site) !== null,
  };
  const integrations = {
    resend: Boolean(getSmtpSender("notifications")),
    emailFrom: getSmtpSender("notifications")?.from ?? "notifications@etsawaa.com",
    auth,
    adminEmail: viewer.user.email ?? "",
  };
  const catRows = (cats ?? []) as Array<{ id: string; name_ar: string; name_en: string; depth: number; path: string }>;
  const nameOf = new Map(catRows.map((c) => [c.id, lang === "en" ? c.name_en : c.name_ar]));
  const categories = catRows.map((c) => ({ id: c.id, label: c.path.split("/").map((id) => nameOf.get(id) ?? "").filter(Boolean).join(" › ") }))
    .sort((a, b) => a.label.localeCompare(b.label, lang));
  return { lang, settings: byKey, kashier, integrations, categories };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();

  if (form.get("intent") === "test_email") {
    const to = viewer.user.email;
    if (!to) return data({ ok: false, reason: "no_email" }, { status: 400 });
    const res = await sendEmail(getSupabaseAdminClient(), {
      to, templateKey: "welcome", locale: lang === "en" ? "en" : "ar",
      variables: { name: viewer.profile.full_name || to, first_name: (viewer.profile.full_name || "").split(" ")[0] || to, site_name: lang === "en" ? "Etsawaa" : "إتسوء", site_url: getSiteUrl(request.url) },
    });
    return res.status === "sent"
      ? { ok: true as const, intent: "test_email" as const, to }
      : data({ ok: false, reason: res.error }, { status: 502 });
  }

  const section = String(form.get("section") ?? "") as SectionKey;
  if (!SECTIONS.includes(section)) return data({ ok: false, reason: "bad_section" }, { status: 400 });

  // collect every `f_*` field into the section payload
  const value: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("f_")) continue;
    const field = k.slice(2);
    if (form.getAll(k).length > 1) { value[field] = form.getAll(k).map(String); continue; }
    // money settings are typed in pounds and stored as piastres
    if (field.endsWith("_piastres")) { value[field] = egpToPiastres(v) ?? 0; continue; }
    if ((NUMERIC_FIELDS[section] ?? []).includes(field)) { value[field] = Number(v) || 0; continue; }
    value[field] = v === "on" ? true : v === "true" ? true : v === "false" ? false : String(v);
  }
  // unchecked boxes are absent from the form: store them as an explicit false
  for (const b of form.getAll("bool").map(String)) if (!(b in value)) value[b] = false;

  if (section === "payments") {
    value.kashier_methods = form.getAll("f_kashier_methods").map(String).filter((m) => (KASHIER_METHODS as readonly string[]).includes(m));
    if (!["off", "admins", "everyone"].includes(String(value.kashier_test_mode))) value.kashier_test_mode = "off";
    delete value.kashier_key; delete value.kashier_merchant;
  }
  if (section === "site.social") {
    for (const [k, v] of Object.entries(value)) {
      const link = String(v ?? "").trim();
      if (link && !(k === "whatsapp" ? /^(\+?\d{8,15}|https:\/\/.+)$/.test(link.replace(/[\s-]/g, "")) : /^https?:\/\/\S+$/.test(link))) {
        return data({ ok: false, reason: `bad_link:${k}` }, { status: 400 });
      }
      value[k] = link;
    }
  }
  if (section === "shipping_rules") {
    value.vendor_allowed_category_ids = form.getAll("f_vendor_allowed_category_ids").map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  }
  if (section === "pickup" && value.billing_mode !== "per_shipment" && value.billing_mode !== "per_product") {
    return data({ ok: false, reason: "bad_billing_mode" }, { status: 400 });
  }

  // seller registration is read from site.general (the /sell page + fn_vendor_config)
  if (section === "vendors" && "vendor_registration_enabled" in value) {
    const reg = value.vendor_registration_enabled === true;
    delete value.vendor_registration_enabled;
    const { data: g } = await client.from("settings").select("value").eq("key", "site.general").maybeSingle();
    const res = await client.rpc("fn_admin_set_setting", {
      p_key: "site.general", p_value: { ...((g?.value ?? {}) as Record<string, unknown>), vendor_registration_enabled: reg },
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  }

  // merge: keep keys this card does not edit
  const { data: prev } = await client.from("settings").select("value").eq("key", section).maybeSingle();
  const merged = { ...((prev?.value ?? {}) as Record<string, unknown>), ...value };
  const res = await client.rpc("fn_admin_set_setting", { p_key: section, p_value: merged });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean; reason?: string };
  // footer / contact page read these through the cached public settings
  if (section === "site.social" || section === "site.contact") clearPublicSettingsCache();
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
}

const BOOL = "size-4 shrink-0 accent-[var(--color-action)]";
const INPUT = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text focus:border-action focus:outline-none";
const LABEL = "flex flex-col gap-1 text-sm font-bold text-text";
const CHECK = "flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm text-text has-[:checked]:border-action/50 has-[:checked]:bg-action/5";

function SectionCard({ title, hint, section, children }: {
  title: string; hint?: string; section: string; children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const ok = fetcher.state === "idle" && fetcher.data?.ok === true;
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {hint ? <p className="-mt-1 mb-3 text-xs leading-relaxed text-text-muted">{hint}</p> : null}
        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="section" value={section} />
          {children}
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <Button type="submit" size="sm" loading={busy}>{t("st.save")}</Button>
            {ok ? <span className="text-sm font-bold text-success-strong">{t("ve.saved")}</span> : null}
            {fetcher.data && fetcher.data.ok === false ? (
              <span role="alert" className="text-xs font-bold text-danger">{String(fetcher.data.reason)}</span>
            ) : null}
          </div>
        </fetcher.Form>
      </CardBody>
    </Card>
  );
}

function Check({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className={CHECK}>
      <input type="hidden" name="bool" value={name} />
      <input type="checkbox" name={`f_${name}`} defaultChecked={defaultChecked} className={`${BOOL} mt-0.5`} />
      <span><b className="block">{label}</b>{hint ? <span className="text-xs text-text-muted">{hint}</span> : null}</span>
    </label>
  );
}

export default function AdminSettingsSections({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, settings: s, integrations } = loaderData;
  const get = (k: string, f: string, d = "") => String(s[k]?.[f] ?? d);
  const on = (k: string, f: string, d: boolean) => (s[k]?.[f] === undefined ? d : s[k]?.[f] === true || s[k]?.[f] === "true");

  return (
    <div>
      <PageHeader title={t("st.title")} subtitle={t("st.hint")} />

      <div className="mt-4 flex flex-col gap-4">
        <IntegrationsCard data={integrations} kashier={loaderData.kashier} lang={lang} />

        <div className="grid gap-4 xl:grid-cols-2">
          {/* SELLERS */}
          <SectionCard section="vendors" title={t("st.sec_vendors")}>
            <Check name="vendor_registration_enabled" label={t("st.vendorRegistration")} hint={t("st.vendorRegistrationHint")}
              defaultChecked={on("site.general", "vendor_registration_enabled", true)} />
            <Check name="allow_clone" label={t("st.allowClone")} defaultChecked={on("vendors", "allow_clone", true)} />
            <label className={LABEL}>
              {t("st.productReview")}
              <select name="f_product_review_required" defaultValue={get("vendors", "product_review_required", "true")} className={INPUT}>
                <option value="true">{t("st.reviewRequired")}</option>
                <option value="false">{t("st.reviewDirect")}</option>
              </select>
            </label>
          </SectionCard>

          {/* VERIFICATION */}
          <SectionCard section="verification" title={t("st.sec_verification")} hint={t("st.verificationHint")}>
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                {t("st.graceValue")}
                <input name="f_grace_value" type="number" min={0} defaultValue={get("verification", "grace_value", "7")} dir="ltr" className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("st.graceUnit")}
                <select name="f_grace_unit" defaultValue={get("verification", "grace_unit", "days")} className={INPUT}>
                  <option value="hours">{t("st.hours")}</option>
                  <option value="days">{t("st.days")}</option>
                  <option value="months">{t("st.months")}</option>
                </select>
              </label>
            </div>
            <label className={LABEL}>
              {t("st.maxDocMb")}
              <input name="f_max_document_mb" type="number" min={1} max={20} defaultValue={get("verification", "max_document_mb", "5")} dir="ltr" className={INPUT} />
            </label>
          </SectionCard>

          {/* WITHDRAWALS — fn_request_withdrawal / fn_release_earnings read key `wallet` */}
          <SectionCard section="wallet" title={t("st.sec_withdrawals")}>
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                {t("st.minWithdrawal")}
                <input name="f_min_withdrawal_piastres" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={piastresToEgp(Number(get("wallet", "min_withdrawal_piastres", "5000")))} dir="ltr" className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("st.holdDays")}
                <input name="f_hold_days" type="number" min={0} defaultValue={get("wallet", "hold_days", "14")} dir="ltr" className={INPUT} />
              </label>
            </div>
          </SectionCard>

          {/* PICKUP BILLING — read by fn_charge_pickup at every pickup */}
          <SectionCard section="pickup" title={t("st.sec_pickup")} hint={t("st.pickupHint")}>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold text-text">{t("st.pickupMode")}</legend>
              {(["per_shipment", "per_product"] as const).map((mode) => (
                <label key={mode} className={CHECK}>
                  <input type="radio" name="f_billing_mode" value={mode} defaultChecked={get("pickup", "billing_mode", "per_product") === mode} className="mt-0.5 accent-[var(--color-action)]" />
                  <span><b className="block">{t(`st.pickup_${mode}`)}</b><span className="text-xs text-text-muted">{t(`st.pickup_${mode}_hint`)}</span></span>
                </label>
              ))}
            </fieldset>
            <Check name="charge_vendor_fault_returns" label={t("st.pickupReturns")} defaultChecked={on("pickup", "charge_vendor_fault_returns", true)} />
          </SectionCard>

          {/* PAYMENTS */}
          <SectionCard section="payments" title={t("st.sec_payments")}>
            <Check name="cod_enabled" label={t("st.codEnabled")} hint={t("st.codEnabledHint")} defaultChecked={on("payments", "cod_enabled", true)} />
            <label className={LABEL}>
              {t("st.codCap")}
              <input name="f_cod_max_total_piastres" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={piastresToEgp(Number(get("payments", "cod_max_total_piastres", "500000")))} dir="ltr" className={INPUT} />
            </label>
            <p className="text-xs text-text-muted">{t("st.codVendorNote")}</p>
            <KashierSettingsBlock settings={s.payments} kashier={loaderData.kashier} />
          </SectionCard>

          {/* SOCIAL LINKS — footer + contact page */}
          <SectionCard section="site.social" title={t("st.sec_social")} hint={t("st.socialHint")}>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["facebook", "instagram", "tiktok", "x", "youtube", "linkedin", "whatsapp"] as const).map((k) => (
                <label key={k} className={LABEL}>
                  {t(`social.${k}`)}
                  <input name={`f_${k}`} defaultValue={get("site.social", k)} dir="ltr" className={INPUT}
                    placeholder={k === "whatsapp" ? "+2010xxxxxxxx" : `https://${k === "x" ? "x" : k}.com/etsawaa`} />
                </label>
              ))}
            </div>
          </SectionCard>

          {/* CONTACT CHANNELS — contact page */}
          <SectionCard section="site.contact" title={t("st.sec_contact")} hint={t("st.contactHint")}>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={LABEL}>{t("contactInfo.email")}<input name="f_email" type="email" defaultValue={get("site.contact", "email")} dir="ltr" className={INPUT} /></label>
              <label className={LABEL}>{t("contactInfo.phone")}<input name="f_phone" defaultValue={get("site.contact", "phone")} dir="ltr" className={INPUT} /></label>
              <label className={LABEL}>{t("contactInfo.whatsapp")}<input name="f_whatsapp" defaultValue={get("site.contact", "whatsapp")} dir="ltr" className={INPUT} /></label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={LABEL}>{t("contactInfo.addressAr")}<input name="f_address_ar" defaultValue={get("site.contact", "address_ar")} className={INPUT} /></label>
              <label className={LABEL}>{t("contactInfo.addressEn")}<input name="f_address_en" defaultValue={get("site.contact", "address_en")} dir="ltr" className={INPUT} /></label>
              <label className={LABEL}>{t("contactInfo.hoursAr")}<input name="f_hours_ar" defaultValue={get("site.contact", "hours_ar")} className={INPUT} /></label>
              <label className={LABEL}>{t("contactInfo.hoursEn")}<input name="f_hours_en" defaultValue={get("site.contact", "hours_en")} dir="ltr" className={INPUT} /></label>
            </div>
          </SectionCard>

          {/* SHIPPING RULES — the only categories where sellers may ship themselves */}
          <SectionCard section="shipping_rules" title={t("st.sec_shippingRules")} hint={t("st.shippingRulesHint")}>
            <label className={LABEL}>
              {t("st.vendorShippingAllowed")}
              <select name="f_vendor_allowed_category_ids" multiple size={10} className={INPUT}
                defaultValue={((s.shipping_rules?.vendor_allowed_category_ids as string[] | undefined) ?? [])}>
                {loaderData.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="text-xs font-normal text-text-muted">{t("st.multiSelectHint")}</span>
            </label>
          </SectionCard>

          {/* PACKAGING — split plan + returns window */}
          <SectionCard section="packaging" title={t("st.sec_packaging")}>
            <Check name="split_enabled" label={t("st.pkgSplit")} defaultChecked={on("packaging", "split_enabled", true)} />
            <Check name="cod_enabled" label={t("st.pkgCod")} defaultChecked={on("packaging", "cod_enabled", true)} />
            <Check name="deferred_enabled" label={t("st.pkgDeferred")} hint={t("st.pkgDeferredHint")} defaultChecked={on("packaging", "deferred_enabled", true)} />
            <label className={LABEL}>
              {t("st.pkgDeferredMax")}
              <input name="f_deferred_max_orders" type="number" min={1} defaultValue={get("packaging", "deferred_max_orders", "10")} dir="ltr" className={INPUT} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className={LABEL}>
                {t("st.pkgPercent")}
                <input name="f_split_percent" type="number" min={1} max={99} defaultValue={get("packaging", "split_percent", "50")} dir="ltr" className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("st.pkgMaxOpen")}
                <input name="f_max_open_balances" type="number" min={0} defaultValue={get("packaging", "max_open_balances", "1")} dir="ltr" className={INPUT} />
              </label>
              <label className={LABEL}>
                {t("st.pkgReturnDays")}
                <input name="f_return_window_days" type="number" min={0} defaultValue={get("packaging", "return_window_days", "14")} dir="ltr" className={INPUT} />
              </label>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* where the other settings live */}
      <nav aria-label={t("st.moreSettings")} className="mt-5 rounded-lg border border-border bg-surface p-4 shadow-1">
        <p className="mb-2 text-xs font-extrabold text-text-muted">{t("st.moreSettings")}</p>
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          {([
            ["settings", "st.linkIdentity"], ["zones", "st.linkZones"], ["catalog/categories", "st.linkCommission"],
            ["legal", "st.linkLegal"], ["email-templates", "st.linkEmails"], ["document-settings", "st.linkDocs"], ["media-settings", "st.linkMedia"],
          ] as const).map(([path, key]) => (
            <Link key={path} to={`/${lang}/admin/${path}`} className="rounded-md border border-border px-3 py-2 text-text hover:border-action hover:text-action">{t(key)}</Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** Live status of the services configured in server env files (read-only) + a test email. */
function IntegrationsCard({ data: d, kashier, lang }: {
  data: { resend: boolean; emailFrom: string; auth: AuthServerState; adminEmail: string };
  kashier: { merchantId: string | null; live: boolean; test: boolean };
  lang: string;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const res = fetcher.state === "idle" ? (fetcher.data as { ok?: boolean; to?: string; reason?: string } | undefined) : undefined;
  const rows: Array<{ name: string; ok: boolean; detail: string; extra?: React.ReactNode }> = [
    {
      name: t("st.int.resend"), ok: d.resend,
      detail: d.resend ? t("st.int.resendOn", { from: d.emailFrom }) : t("st.int.resendOff"),
      extra: d.resend && d.adminEmail ? (
        <fetcher.Form method="post" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="test_email" />
          <Button type="submit" size="sm" variant="outline" loading={fetcher.state !== "idle"}>{t("st.int.testEmail")}</Button>
          {res?.ok ? <span className="text-xs font-bold text-success-strong">{t("st.int.testSent", { to: res.to })}</span> : null}
          {res && res.ok === false ? <span className="text-xs font-bold text-danger">{t("st.int.testFailed")}: {res.reason}</span> : null}
        </fetcher.Form>
      ) : null,
    },
    {
      name: t("st.int.codes"), ok: d.auth.reachable && d.auth.emailCodes,
      detail: !d.auth.reachable ? t("st.int.authDown") : d.auth.emailCodes ? t("st.int.codesOn") : t("st.int.codesOff"),
      extra: <Link to={`/${lang}/admin/email-templates`} className="text-xs font-bold text-action hover:underline">{t("st.linkEmails")}</Link>,
    },
    {
      name: t("st.int.google"), ok: d.auth.reachable && d.auth.google,
      detail: !d.auth.reachable ? t("st.int.authDown") : d.auth.google ? t("st.int.googleOn") : t("st.int.googleOff"),
    },
    {
      name: "Kashier", ok: kashier.live || kashier.test,
      detail: kashier.live ? t("st.int.kashierLive", { mid: kashier.merchantId ?? "—" }) : kashier.test ? t("st.int.kashierTestOnly") : t("st.int.kashierOff"),
    },
  ];
  return (
    <Card>
      <CardHeader title={t("st.int.title")} />
      <CardBody>
        <p className="-mt-1 mb-3 text-xs leading-relaxed text-text-muted">{t("st.int.hint")}</p>
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.name} className="flex gap-3 rounded-md border border-border p-3">
              <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${r.ok ? "bg-success" : "bg-danger"}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm text-text">{r.name}</b>
                  <span className={`rounded-full px-2 py-0.5 text-2xs font-extrabold ${r.ok ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"}`}>
                    {r.ok ? t("st.int.connected") : t("st.int.notConnected")}
                  </span>
                </div>
                <p className="break-words text-xs text-text-muted">{r.detail}</p>
                {r.extra}
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/**
 * Kashier: on/off, live/test switch, methods, key status and the webhook URL.
 * Keys are never shown or editable here — they live in the server env.
 */
function KashierSettingsBlock({ settings, kashier }: {
  settings: Record<string, unknown> | undefined;
  kashier: { merchantId: string | null; live: boolean; test: boolean; webhookUrl: string; webhookReachable: boolean };
}) {
  const { t } = useTranslation();
  const cfg = parseKashierSettings(settings);
  const [scope, setScope] = useState(cfg.testScope);
  const [copied, setCopied] = useState(false);
  const status = (ok: boolean) => (
    <span className={`rounded-full px-2 py-0.5 text-2xs font-extrabold ${ok ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"}`}>
      {ok ? t("st.kashierReady") : t("st.kashierMissing")}
    </span>
  );
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-text">Kashier</h3>
        <label className="flex items-center gap-2 text-sm font-bold text-text">
          <input type="hidden" name="bool" value="kashier_enabled" />
          <input type="checkbox" name="f_kashier_enabled" defaultChecked={cfg.enabled} className={BOOL} />
          {t("st.kashierEnabled")}
        </label>
      </div>

      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-text-muted">{t("st.kashierMid")}</dt>
        <dd className="num font-bold text-text" dir="ltr">{kashier.merchantId ?? "—"}</dd>
        <dt className="text-text-muted">{t("st.kashierLiveKeys")}</dt><dd>{status(kashier.live)}</dd>
        <dt className="text-text-muted">{t("st.kashierTestKeys")}</dt><dd>{status(kashier.test)}</dd>
      </dl>
      <p className="text-2xs text-text-muted">{t("st.kashierKeysNote")}</p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-bold text-text">{t("st.kashierTestMode")}</legend>
        {(["off", "admins", "everyone"] as const).map((v) => (
          <label key={v} className="flex items-start gap-2 rounded-md border border-border p-2.5 text-sm text-text has-[:checked]:border-action has-[:checked]:bg-action/5">
            <input type="radio" name="f_kashier_test_mode" value={v} checked={scope === v} onChange={() => setScope(v)}
              disabled={v !== "off" && !kashier.test} className="mt-0.5 accent-[var(--color-action)]" />
            <span><b className="block">{t(`st.kashierTest_${v}`)}</b><span className="text-xs text-text-muted">{t(`st.kashierTest_${v}_hint`)}</span></span>
          </label>
        ))}
        {scope !== "off" ? (
          <p role="note" className="rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2 text-xs font-bold text-warning-strong">
            {t(scope === "everyone" ? "st.kashierTestWarnAll" : "st.kashierTestWarnAdmins")}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-bold text-text">{t("st.kashierMethods")}</legend>
        <div className="flex flex-wrap gap-3">
          {KASHIER_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="f_kashier_methods" value={m} defaultChecked={cfg.methods.includes(m)} className={BOOL} />
              {t(`st.kashierMethod_${m}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-text-muted">{t("st.kashierMethodsHint")}</p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-text">{t("st.kashierWebhook")}</span>
        <div className="flex gap-2">
          <input readOnly value={kashier.webhookUrl} dir="ltr" onFocus={(e) => e.currentTarget.select()} className={`${INPUT} num min-w-0 flex-1`} />
          <Button type="button" size="sm" variant="outline" onClick={() => {
            void navigator.clipboard?.writeText(kashier.webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
          }}>{copied ? t("st.copied") : t("st.copy")}</Button>
        </div>
        <p className="text-xs text-text-muted">{t("st.kashierWebhookHint")}</p>
        {!kashier.webhookReachable ? <p className="text-xs font-bold text-warning-strong">{t("st.kashierWebhookLocal")}</p> : null}
      </div>
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
