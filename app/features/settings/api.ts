import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LOCALE, type Locale } from "~/lib/i18n/config";
import { DEFAULT_DESIGN_TOKENS, parseDesignTokens, type DesignTokens } from "~/lib/tokens";

/**
 * `settings` is key/value jsonb (PLAN.md §4). Only two keys are public
 * (allowlist enforced by RLS): `site.general` and `settings.design`.
 */

export const SETTINGS_KEYS = {
  siteGeneral: "site.general",
  design: "settings.design",
} as const;

export interface SiteGeneral {
  site_name_ar: string;
  site_name_en: string;
  tagline_ar: string;
  tagline_en: string;
  default_locale: Locale;
  timezone: string;
}

export const DEFAULT_SITE_GENERAL: SiteGeneral = {
  site_name_ar: "اتسوء",
  site_name_en: "Etsawaa",
  tagline_ar: "سوقك المصري متعدد البائعين",
  tagline_en: "Egypt's multi-vendor marketplace",
  default_locale: DEFAULT_LOCALE,
  timezone: "Africa/Cairo",
};

export interface LoadedSettings {
  site: SiteGeneral;
  design: DesignTokens;
  connected: boolean;
}

/** Shape of the root loader data (locale + public settings). */
export interface RootLoaderData {
  locale: Locale;
  site: SiteGeneral;
  design: DesignTokens;
  dbConnected: boolean;
}

function parseSiteGeneral(raw: unknown): SiteGeneral {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    site_name_ar: typeof source.site_name_ar === "string" ? source.site_name_ar : DEFAULT_SITE_GENERAL.site_name_ar,
    site_name_en: typeof source.site_name_en === "string" ? source.site_name_en : DEFAULT_SITE_GENERAL.site_name_en,
    tagline_ar: typeof source.tagline_ar === "string" ? source.tagline_ar : DEFAULT_SITE_GENERAL.tagline_ar,
    tagline_en: typeof source.tagline_en === "string" ? source.tagline_en : DEFAULT_SITE_GENERAL.tagline_en,
    default_locale:
      source.default_locale === "en" ? "en" : DEFAULT_SITE_GENERAL.default_locale,
    timezone: typeof source.timezone === "string" ? source.timezone : DEFAULT_SITE_GENERAL.timezone,
  };
}

/** Load the two public setting keys. Never throws; degraded mode flags `connected:false`. */
export async function loadPublicSettings(
  client: SupabaseClient | null,
): Promise<LoadedSettings> {
  if (!client) {
    console.warn("[settings] Supabase client not created — SUPABASE_URL/SUPABASE_ANON_KEY are missing.");
    return { site: DEFAULT_SITE_GENERAL, design: DEFAULT_DESIGN_TOKENS, connected: false };
  }
  try {
    const { data, error } = await client
      .from("settings")
      .select("key, value")
      .in("key", [SETTINGS_KEYS.siteGeneral, SETTINGS_KEYS.design]);
    if (error) throw error;
    const map = new Map((data ?? []).map((row) => [row.key as string, row.value]));
    return {
      site: parseSiteGeneral(map.get(SETTINGS_KEYS.siteGeneral)),
      design: parseDesignTokens(map.get(SETTINGS_KEYS.design)),
      connected: true,
    };
  } catch (error) {
    // Env vars are present but the read failed (network, RLS, wrong keys) —
    // do not report this as "not configured"; the real cause matters.
    console.warn(
      `[settings] public settings read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { site: DEFAULT_SITE_GENERAL, design: DEFAULT_DESIGN_TOKENS, connected: false };
  }
}

export interface SaveSettingsInput {
  site?: SiteGeneral;
  design?: DesignTokens;
}

/**
 * Upsert settings as an admin (RLS allows admin/staff rows only).
 * The DB trigger `on_settings_changed` writes the audit entry with before/after.
 */
export async function saveSettings(
  client: SupabaseClient,
  input: SaveSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = [] as Array<{ key: string; value: unknown }>;
  if (input.site) rows.push({ key: SETTINGS_KEYS.siteGeneral, value: input.site });
  if (input.design) rows.push({ key: SETTINGS_KEYS.design, value: input.design });
  if (rows.length === 0) return { ok: true };
  const { error } = await client
    .from("settings")
    .upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
