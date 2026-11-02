import { useEffect, useState } from "react";
import type { Route } from "./+types/settings";
import { data, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import {
  DEFAULT_SITE_GENERAL,
  loadPublicSettings,
  saveSettings,
  SETTINGS_KEYS,
  type SiteGeneral,
} from "~/features/settings/api";
import {
  DEFAULT_DESIGN_TOKENS,
  EDITABLE_COLOR_TOKENS,
  SURFACE_WHITE,
  contrastRatio,
  isHexColor,
  parseDesignTokens,
  type DesignTokens,
  type EditableColorToken,
} from "~/lib/tokens";
import { Button, Card, CardBody, CardHeader, Input } from "~/components/ui";
import { useToast } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, site: DEFAULT_SITE_GENERAL, design: DEFAULT_DESIGN_TOKENS, connected: false as const };
  await requirePanelAccess(client, lang, "admin", request);
  const settings = await loadPublicSettings(client);
  return { lang, site: settings.site, design: settings.design, connected: true as const };
}

type SettingsActionData =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * POST — saves `site.general` + `settings.design` through the admin's own
 * client (RLS allows admin rows only). The DB trigger `on_settings_changed`
 * records before/after in audit_logs; the root loader then renders the new
 * tokens on the next request — no deploy (F-02 DoD).
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<SettingsActionData>({ ok: false, reason: "db_not_connected" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);

  const form = await request.formData();
  const site: SiteGeneral = {
    site_name_ar: String(form.get("site_name_ar") ?? "").trim() || DEFAULT_SITE_GENERAL.site_name_ar,
    site_name_en: String(form.get("site_name_en") ?? "").trim() || DEFAULT_SITE_GENERAL.site_name_en,
    tagline_ar: String(form.get("tagline_ar") ?? "").trim() || DEFAULT_SITE_GENERAL.tagline_ar,
    tagline_en: String(form.get("tagline_en") ?? "").trim() || DEFAULT_SITE_GENERAL.tagline_en,
    default_locale: String(form.get("default_locale") ?? "ar") === "en" ? "en" : "ar",
    timezone: DEFAULT_SITE_GENERAL.timezone,
  };
  const designRaw: Record<string, string> = {};
  for (const token of EDITABLE_COLOR_TOKENS) {
    const value = String(form.get(`design_${token}`) ?? "").trim().toUpperCase();
    if (isHexColor(value)) designRaw[token] = value;
  }
  const result = await saveSettings(client, {
    site,
    design: parseDesignTokens(designRaw),
  });
  if (!result.ok) return data<SettingsActionData>({ ok: false, reason: result.error });
  // No DB trigger records settings writes, so audit explicitly — this page used
  // to bypass fn_admin_set_setting and leave no trace (AGENT §12).
  await client.rpc("fn_audit", {
    p_action: "settings.update",
    p_entity: "settings",
    p_entity_id: "site.general+design",
    p_before: null,
    p_after: { site, design: designRaw },
  });
  return data<SettingsActionData>({ ok: true });
}

const TOKEN_LABELS: Record<EditableColorToken, string> = {
  primary: "admin.settings.colorPrimary",
  action: "admin.settings.colorAction",
  actionHover: "admin.settings.colorActionHover",
  ink: "admin.settings.colorInk",
};

export default function AdminSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { site, design, connected } = loaderData;
  const toast = useToast();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<SettingsActionData>();

  const [siteState, setSiteState] = useState<SiteGeneral>(site);
  const [designState, setDesignState] = useState<DesignTokens>(design);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      toast.showToast("success", t("admin.settings.saved"));
      void revalidator.revalidate();
    } else if (fetcher.data && !fetcher.data.ok) {
      toast.showToast("error", t("auth.errors.generic"));
    }
  }, [fetcher.data, toast, t, revalidator]);

  // Live AA contrast check per token against white (US-08 edge).
  const contrastIssues = EDITABLE_COLOR_TOKENS.map((token) => {
    const value = designState[token];
    if (!isHexColor(value)) return { token, ratio: null as number | null };
    return { token, ratio: contrastRatio(value, SURFACE_WHITE) };
  }).filter((item) => item.ratio !== null && item.ratio < 4.5);

  return (
    <fetcher.Form method="post" className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t("admin.settings.siteIdentity")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("admin.settings.siteNameAr")}
            value={siteState.site_name_ar}
            onChange={(event) => setSiteState((s) => ({ ...s, site_name_ar: event.target.value }))}
            name="site_name_ar"
          />
          <Input
            label={t("admin.settings.siteNameEn")}
            value={siteState.site_name_en}
            onChange={(event) => setSiteState((s) => ({ ...s, site_name_en: event.target.value }))}
            name="site_name_en"
            dir="ltr"
          />
          <Input
            label={t("admin.settings.taglineAr")}
            value={siteState.tagline_ar}
            onChange={(event) => setSiteState((s) => ({ ...s, tagline_ar: event.target.value }))}
            name="tagline_ar"
          />
          <Input
            label={t("admin.settings.taglineEn")}
            value={siteState.tagline_en}
            onChange={(event) => setSiteState((s) => ({ ...s, tagline_en: event.target.value }))}
            name="tagline_en"
            dir="ltr"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("admin.settings.designTokens")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {EDITABLE_COLOR_TOKENS.map((token) => {
            const value = designState[token];
            const invalid = value !== "" && !isHexColor(value);
            return (
              <div key={token} className="flex items-end gap-3">
                <Input
                  label={t(TOKEN_LABELS[token])}
                  name={`design_${token}`}
                  value={value}
                  onChange={(event) => setDesignState((d) => ({ ...d, [token]: event.target.value }))}
                  dir="ltr"
                  className="num flex-1"
                  error={invalid ? t("admin.settings.invalidHex") : undefined}
                />
                <span
                  aria-hidden="true"
                  className="mb-1 size-9 shrink-0 rounded-md border border-border"
                  style={{ backgroundColor: isHexColor(value) ? value : "#FFFFFF" }}
                />
              </div>
            );
          })}
          {contrastIssues.map((issue) =>
            issue.ratio !== null ? (
              <p key={issue.token} role="alert" className="text-xs font-bold text-warning-strong sm:col-span-2">
                {t("admin.settings.contrastWarning", { ratio: issue.ratio.toFixed(2) })} — {issue.token}
              </p>
            ) : null,
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSiteState(DEFAULT_SITE_GENERAL);
            setDesignState(DEFAULT_DESIGN_TOKENS);
          }}
        >
          {t("common.reset")}
        </Button>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="num hidden sm:inline">{SETTINGS_KEYS.siteGeneral} · {SETTINGS_KEYS.design}</span>
          <Button type="submit" loading={busy} disabled={!connected || contrastIssues.length > 0}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </fetcher.Form>
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
