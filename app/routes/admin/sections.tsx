import { data } from "react-router";
import type { Route } from "./+types/sections";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-24 — Settings hub (JOURNEYS §16.16): 15 sections, each an independent
 * form → fn_admin_set_setting (audited upsert with before/after). Media
 * (§14) lives in /admin/media-settings (phase 02). Shipping (§8 governorates,
 * areas, import) lives in /admin/zones (A-35/36). Design tokens live in the
 * existing /admin/settings page plus /admin/document-settings (A-37).
 */

type SectionKey =
  | "general" | "login" | "vendors" | "verification" | "financial" | "wallet"
  | "payments" | "policies" | "seo" | "notifications" | "emails";

const SECTIONS: Array<{ key: SectionKey; i18n: string }> = [
  { key: "general", i18n: "st.sec_general" },
  { key: "login", i18n: "st.sec_login" },
  { key: "vendors", i18n: "st.sec_vendors" },
  { key: "verification", i18n: "st.sec_verification" },
  { key: "financial", i18n: "st.sec_financial" },
  { key: "wallet", i18n: "st.sec_withdrawals" },
  { key: "payments", i18n: "st.sec_payments" },
  { key: "policies", i18n: "st.sec_policies" },
  { key: "seo", i18n: "st.sec_seo" },
  { key: "emails", i18n: "st.sec_emails" },
  { key: "notifications", i18n: "st.sec_notifications" },
];

const NUMERIC_FIELDS: Partial<Record<SectionKey, string[]>> = {
  wallet: ["min_withdrawal_piastres", "hold_days"],
  payments: ["cod_max_total_piastres"],
  verification: ["grace_value", "max_document_mb"],
  financial: ["default_commission_percent"],
  emails: ["smtp_port"],
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows } = await client.from("settings").select("key, value");
  const byKey: Record<string, Record<string, unknown>> = {};
  for (const r of (rows ?? []) as Array<{ key: string; value: unknown }>) {
    if (typeof r.value === "object" && r.value !== null) byKey[r.key] = r.value as Record<string, unknown>;
  }
  return { lang, settings: byKey, sections: SECTIONS.map((s) => s.key) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const section = String(form.get("section") ?? "");
  if (!SECTIONS.some((s) => s.key === section)) return data({ ok: false, reason: "bad_section" }, { status: 400 });

  // collect every `f_*` field into the section payload (independent save)
  const value: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("f_")) continue;
    const field = k.slice(2);
    if (form.getAll(k).length > 1) { value[field] = form.getAll(k).map(String); continue; }
    if ((NUMERIC_FIELDS[section as SectionKey] ?? []).includes(field)) { value[field] = Number(v) || 0; continue; }
    value[field] = v === "on" ? true : String(v);
  }
  const res = await client.rpc("fn_admin_set_setting", { p_key: section, p_value: value });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
}

const BOOL = "size-4 accent-[var(--color-action)]";
const INPUT = "w-full rounded-m border border-border bg-surface p-2.5 text-[13px] text-text";

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
        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="section" value={section} />
          {children}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={busy}>{busy ? "…" : title}</Button>
            {ok ? <span className="text-[13px] font-bold text-success-strong">{t("ve.saved")}</span> : null}
          </div>
          {fetcher.data && fetcher.data.ok === false ? (
            <p role="alert" className="text-xs font-bold text-danger">{String(fetcher.data.reason)}</p>
          ) : null}
        </fetcher.Form>
        {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

export default function AdminSettingsSections({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const s = loaderData.settings;
  const get = (k: string, f: string, d = "") => String(s[k]?.[f] ?? d);
  const isOn = (k: string, f: string) => s[k]?.[f] === true || s[k]?.[f] === "true";

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("st.title")}</h1>
      <p className="mt-1 text-[13px] text-text-muted">{t("st.hint")}</p>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {/* 2) GENERAL */}
        <SectionCard section="general" title={t("st.sec_general")}>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.storePattern")}
            <input name="f_store_url_pattern" defaultValue={get("general", "store_url_pattern", "Store")} dir="ltr" className={INPUT} />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_single_seller" defaultChecked={isOn("general", "single_seller")} className={BOOL} />
            {t("st.singleSeller")}
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_show_customer_details" defaultChecked={isOn("general", "show_customer_details")} className={BOOL} />
            {t("st.showCustomer")}
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_vendor_registration_enabled" defaultChecked={isOn("site.general", "vendor_registration_enabled")} className={BOOL} />
            {t("st.vendorRegistration")}
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.welcomeAr")}
            <textarea name="f_welcome_ar" defaultValue={get("general", "welcome_ar")} className={`${INPUT} min-h-16`} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.welcomeEn")}
            <textarea name="f_welcome_en" defaultValue={get("general", "welcome_en")} className={`${INPUT} min-h-16`} dir="ltr" />
          </label>
        </SectionCard>

        {/* 3) LOGIN */}
        <SectionCard section="login" title={t("st.sec_login")}>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_google" defaultChecked={isOn("login", "google") ?? true} className={BOOL} />
            Google
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_facebook" defaultChecked={false} className={BOOL} />
            Facebook
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_apple" defaultChecked={false} className={BOOL} />
            Apple
          </label>
          <p className="text-xs text-text-muted">{t("st.loginNote")}</p>
        </SectionCard>

        {/* 4) VENDORS */}
        <SectionCard section="vendors" title={t("st.sec_vendors")}>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_allow_status_change" defaultChecked={isOn("vendors", "allow_status_change")} className={BOOL} />
            {t("st.allowStatusChange")}
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_allow_clone" defaultChecked={isOn("vendors", "allow_clone")} className={BOOL} />
            {t("st.allowClone")}
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.productReview")}
            <select name="f_product_review_required" defaultValue={get("vendors", "product_review_required", "true")} className={INPUT}>
              <option value="true">{t("st.reviewRequired")}</option>
              <option value="false">{t("st.reviewDirect")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_allow_own_tags" defaultChecked={isOn("vendors", "allow_own_tags")} className={BOOL} />
            {t("st.allowOwnTags")}
          </label>
        </SectionCard>

        {/* 5) VERIFICATION */}
        <SectionCard section="verification" title={t("st.sec_verification")}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("st.graceValue")}
              <input name="f_grace_value" type="number" min={0} defaultValue={get("verification", "grace_value", "7")} dir="ltr" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("st.graceUnit")}
              <select name="f_grace_unit" defaultValue={get("verification", "grace_unit", "days")} className={INPUT}>
                <option value="hours">{t("st.hours")}</option>
                <option value="days">{t("st.days")}</option>
                <option value="months">{t("st.months")}</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.afterGrace")}
            <select name="f_after_grace" defaultValue={get("verification", "after_grace", "block_selling")} className={INPUT}>
              <option value="block_selling">{t("st.blockSelling")}</option>
              <option value="unavailable">{t("st.markUnavailable")}</option>
            </select>
          </label>
        </SectionCard>

        {/* 6) FINANCIAL — commission policy (per-leaf values live on categories) */}
        <SectionCard section="financial" title={t("st.sec_financial")}>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.defaultCommission")}
            <input name="f_default_commission_percent" type="number" min={0} max={100} step="0.01" dir="ltr"
              defaultValue={get("financial", "default_commission_percent", "5")} className={INPUT} />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_category_inheritance" defaultChecked={isOn("financial", "category_inheritance") ?? true} className={BOOL} />
            {t("st.categoryInheritance")}
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_commission_on_discounted_price" defaultChecked={isOn("financial", "commission_on_discounted_price") ?? true} className={BOOL} />
            {t("st.commissionDiscounted")}
          </label>
          <p className="text-xs text-text-muted">{t("st.financialNote")}</p>
        </SectionCard>

        {/* 7) WITHDRAWALS */}
        {/* fn_request_withdrawal reads settings key `wallet`; this card used to
            write `withdrawals`, so the minimum never took effect. */}
        <SectionCard section="wallet" title={t("st.sec_withdrawals")}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("st.minWithdrawal")}
              <input name="f_min_withdrawal_piastres" type="number" min={0} defaultValue={get("wallet", "min_withdrawal_piastres", "5000")} dir="ltr" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("st.holdDays")}
              <input name="f_hold_days" type="number" min={0} defaultValue={get("wallet", "hold_days", "14")} dir="ltr" className={INPUT} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.eligibleStatus")}
            <select name="f_eligible_status" defaultValue={get("withdrawals", "eligible_status", "completed")} className={INPUT}>
              <option value="delivered">{t("order.status_delivered")}</option>
              <option value="completed">{t("order.status_completed")}</option>
            </select>
          </label>
        </SectionCard>

        {/* 9) PAYMENTS */}
        <SectionCard section="payments" title={t("st.sec_payments")}>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_cod_enabled" defaultChecked={isOn("payments", "cod_enabled") ?? true} className={BOOL} />
            {t("st.codEnabled")}
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.codCap")}
            <input name="f_cod_max_total_piastres" type="number" min={0} defaultValue={get("payments", "cod_max_total_piastres", "500000")} dir="ltr" className={INPUT} />
          </label>
          <p className="text-xs text-text-muted">{t("st.codVendorNote")}</p>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            Kashier keys ({t("st.sandbox")})
            <input name="f_kashier_merchant" defaultValue={get("payments", "kashier_merchant")} dir="ltr" placeholder="MID-…" className={INPUT} />
            <input name="f_kashier_key" type="password" defaultValue={get("payments", "kashier_key") || ""} dir="ltr" placeholder="••••" className={INPUT} />
          </label>
        </SectionCard>

        {/* 10) POLICIES */}
        <SectionCard section="policies" title={t("st.sec_policies")}>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.termsVendor")}
            <textarea name="f_terms_vendor" defaultValue={get("policies", "terms_vendor")} className={`${INPUT} min-h-20`} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.termsCustomer")}
            <textarea name="f_terms_customer" defaultValue={get("policies", "terms_customer")} className={`${INPUT} min-h-20`} />
          </label>
        </SectionCard>

        {/* 12) SEO */}
        <SectionCard section="seo" title={t("st.sec_seo")}>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.metaTitleAr")}
            <input name="f_meta_title_ar" defaultValue={get("seo", "meta_title_ar")} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.metaTitleEn")}
            <input name="f_meta_title_en" defaultValue={get("seo", "meta_title_en")} dir="ltr" className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.robots")}
            <textarea name="f_robots_extra" defaultValue={get("seo", "robots_extra")} dir="ltr" className={`${INPUT} min-h-16`} />
          </label>
        </SectionCard>

        {/* 11) EMAILS (provider + senders; templates edited from email templates) */}
        <SectionCard section="emails" title={t("st.sec_emails")}>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.provider")}
            <select name="f_provider" defaultValue={get("emails", "provider", "resend")} className={INPUT}>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              SMTP host
              <input name="f_smtp_host" defaultValue={get("emails", "smtp_host")} dir="ltr" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              SMTP port
              <input name="f_smtp_port" type="number" defaultValue={get("emails", "smtp_port", "587")} dir="ltr" className={INPUT} />
            </label>
          </div>
          <p className="text-xs text-text-muted">{t("st.emailNote")}</p>
        </SectionCard>

        {/* 15) NOTIFICATIONS */}
        <SectionCard section="notifications" title={t("st.sec_notifications")}>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_inapp_enabled" defaultChecked={isOn("notifications", "inapp_enabled") ?? true} className={BOOL} />
            {t("st.inapp")}
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-text">
            <input type="checkbox" name="f_email_enabled" defaultChecked={isOn("notifications", "email_enabled")} className={BOOL} />
            {t("st.emailChannel")}
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
            {t("st.quietHours")}
            <input name="f_quiet_hours" defaultValue={get("notifications", "quiet_hours", "")} dir="ltr" placeholder="23:00-07:00" className={INPUT} />
          </label>
        </SectionCard>
      </div>

      {/* links to the specialised setting pages */}
      <div className="mt-4 flex flex-wrap gap-2 text-[13px] font-bold">
        <a href={`/${lang}/admin/zones`} className="rounded-m border border-border px-3 py-2 text-text hover:bg-surface-tint">{t("st.linkZones")}</a>
        <a href={`/${lang}/admin/document-settings`} className="rounded-m border border-border px-3 py-2 text-text hover:bg-surface-tint">{t("st.linkDocs")}</a>
        <a href={`/${lang}/admin/email-templates`} className="rounded-m border border-border px-3 py-2 text-text hover:bg-surface-tint">{t("st.linkEmails")}</a>
        <a href={`/${lang}/admin/media-settings`} className="rounded-m border border-border px-3 py-2 text-text hover:bg-surface-tint">{t("st.linkMedia")}</a>
        <a href={`/${lang}/admin/settings`} className="rounded-m border border-border px-3 py-2 text-text hover:bg-surface-tint">{t("st.linkIdentity")}</a>
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
