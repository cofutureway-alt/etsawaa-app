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
  social: "site.social",
  contact: "site.contact",
} as const;

/** Company social links (admin settings → footer + contact page). */
export const SOCIAL_KEYS = ["facebook", "instagram", "tiktok", "x", "youtube", "linkedin", "whatsapp"] as const;
export type SocialLinks = Partial<Record<(typeof SOCIAL_KEYS)[number], string>>;
/** Public contact channels (admin settings → contact page). */
export interface ContactChannels {
  email: string; phone: string; whatsapp: string;
  address_ar: string; address_en: string; hours_ar: string; hours_en: string;
}
export const EMPTY_CONTACT: ContactChannels = { email: "", phone: "", whatsapp: "", address_ar: "", address_en: "", hours_ar: "", hours_en: "" };

function parseSocial(raw: unknown): SocialLinks {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SocialLinks = {};
  for (const k of SOCIAL_KEYS) {
    const v = typeof src[k] === "string" ? (src[k] as string).trim() : "";
    // only real web links (or a WhatsApp number) — never javascript: etc.
    if (k === "whatsapp" ? /^\+?\d{8,15}$/.test(v.replace(/[\s-]/g, "")) || /^https:\/\//.test(v) : /^https?:\/\//.test(v)) out[k] = v;
  }
  return out;
}
function parseContact(raw: unknown): ContactChannels {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...EMPTY_CONTACT };
  for (const k of Object.keys(EMPTY_CONTACT) as Array<keyof ContactChannels>) out[k] = typeof src[k] === "string" ? (src[k] as string).trim().slice(0, 300) : "";
  return out;
}

export interface SiteGeneral {
  site_name_ar: string;
  site_name_en: string;
  tagline_ar: string;
  tagline_en: string;
  default_locale: Locale;
  timezone: string;
  /** external link shown in the dashboard switcher (e.g. a vendor portal); "" hides it */
  portal_url: string;
  portal_label_ar: string;
  portal_label_en: string;
}

export const DEFAULT_SITE_GENERAL: SiteGeneral = {
  site_name_ar: "إتسوء",
  site_name_en: "Etsawaa",
  tagline_ar: "تسوّق من بائعين مصريين موثوقين في مكان واحد",
  tagline_en: "Shop trusted Egyptian vendors, all in one place",
  default_locale: DEFAULT_LOCALE,
  timezone: "Africa/Cairo",
  portal_url: "",
  portal_label_ar: "بوابة الموظفين",
  portal_label_en: "Staff portal",
};

export interface LoadedSettings {
  site: SiteGeneral;
  design: DesignTokens;
  social: SocialLinks;
  contact: ContactChannels;
  connected: boolean;
}

/** Shape of the root loader data (locale + public settings). */
export interface RootLoaderData {
  locale: Locale;
  site: SiteGeneral;
  design: DesignTokens;
  social: SocialLinks;
  contact: ContactChannels;
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
    portal_url: typeof source.portal_url === "string" && /^https:\/\/[^\s]+$/.test(source.portal_url.trim()) ? source.portal_url.trim() : "",
    portal_label_ar: typeof source.portal_label_ar === "string" && source.portal_label_ar.trim() ? source.portal_label_ar.trim().slice(0, 40) : DEFAULT_SITE_GENERAL.portal_label_ar,
    portal_label_en: typeof source.portal_label_en === "string" && source.portal_label_en.trim() ? source.portal_label_en.trim().slice(0, 40) : DEFAULT_SITE_GENERAL.portal_label_en,
  };
}

/**
 * The root loader reads these two public keys on EVERY request — the hottest
 * path in the app — but the values change rarely. A tiny process-wide TTL
 * cache (single entry, closed over) absorbs that traffic; it is safe in both
 * server and (accidental) client contexts because it only uses Date.now() and
 * a module closure. The read is client-agnostic — every caller queries the
 * same two public keys under RLS, admin or anon — so one entry, not one per
 * client, is correct. Degraded reads (connected:false after a DB failure) are
 * cached too, deliberately: during an outage the root loader would otherwise
 * hammer the failing DB once per request. saveSettings drops the entry after
 * a write so admin edits surface immediately (F-02); the exported
 * clearPublicSettingsCache exists for tests and future invalidation hooks.
 */
const PUBLIC_SETTINGS_TTL_MS = 60_000;

interface CachedSettings {
  value: LoadedSettings;
  expiresAt: number;
}

let cachedSettings: CachedSettings | null = null;
/** single-flight: a burst of cold-cache root-loader requests shares one read */
let settingsInflight: Promise<LoadedSettings> | null = null;

async function readPublicSettings(client: SupabaseClient): Promise<LoadedSettings> {
  try {
    const { data, error } = await client
      .from("settings")
      .select("key, value")
      .in("key", [SETTINGS_KEYS.siteGeneral, SETTINGS_KEYS.design, SETTINGS_KEYS.social, SETTINGS_KEYS.contact]);
    if (error) throw error;
    const map = new Map((data ?? []).map((row) => [row.key as string, row.value]));
    return {
      site: parseSiteGeneral(map.get(SETTINGS_KEYS.siteGeneral)),
      design: parseDesignTokens(map.get(SETTINGS_KEYS.design)),
      social: parseSocial(map.get(SETTINGS_KEYS.social)),
      contact: parseContact(map.get(SETTINGS_KEYS.contact)),
      connected: true,
    };
  } catch (error) {
    // Env vars are present but the read failed (network, RLS, wrong keys) —
    // do not report this as "not configured"; the real cause matters.
    console.warn(
      `[settings] public settings read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { site: DEFAULT_SITE_GENERAL, design: DEFAULT_DESIGN_TOKENS, social: {}, contact: EMPTY_CONTACT, connected: false };
  }
}

/**
 * Load the two public setting keys. Never throws; degraded mode flags
 * `connected:false`. Cached for PUBLIC_SETTINGS_TTL_MS — treat the returned
 * object as immutable (the same instance is shared across requests).
 */
export async function loadPublicSettings(
  client: SupabaseClient | null,
): Promise<LoadedSettings> {
  if (!client) {
    console.warn("[settings] Supabase client not created — SUPABASE_URL/SUPABASE_ANON_KEY are missing.");
    return { site: DEFAULT_SITE_GENERAL, design: DEFAULT_DESIGN_TOKENS, social: {}, contact: EMPTY_CONTACT, connected: false };
  }
  const cached = cachedSettings;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!settingsInflight) {
    settingsInflight = readPublicSettings(client).finally(() => {
      settingsInflight = null;
    });
  }
  const value = await settingsInflight;
  cachedSettings = { value, expiresAt: Date.now() + PUBLIC_SETTINGS_TTL_MS };
  return value;
}

/** Test / future-invalidation hook (also called by saveSettings after a write). */
export function clearPublicSettingsCache(): void {
  cachedSettings = null;
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
  // the upsert changed what loadPublicSettings returns — drop the cached copy
  // so the next root request re-reads immediately (F-02: no-deploy restyling)
  clearPublicSettingsCache();
  return { ok: true };
}
