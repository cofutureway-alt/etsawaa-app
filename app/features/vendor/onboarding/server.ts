import { data, redirect } from "react-router";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { parseMediaSettings } from "~/lib/media.shared";
import type { MediaSettings } from "~/lib/media.shared";
import type { Locale } from "~/lib/i18n/config";
import {
  fetchVendorConfig,
  fetchVendorDocuments,
  fetchVendorRow,
  type VendorDocumentRow,
} from "~/features/vendor/api";
import type { VendorConfig, VendorRow } from "~/features/vendor/config";
import { getViewer } from "~/lib/auth/guards";

/**
 * server.ts — server-side bodies for the /vendor/onboarding wizard route
 * (V-02..V-09). The route module keeps only the React Router exports
 * (loader/action/meta/…) and delegates here so the wire shapes, the status
 * gating and the `fn_vendor_autosave` / `fn_vendor_onboard` RPC glue live
 * next to the rest of the vendor feature instead of in the route file.
 */

/** DB row shapes read in the loader (governorates / areas / categories selects). */
export interface GovRow { id: number; name_ar: string; name_en: string }
export interface AreaRow { id: number; governorate_id: number; name_ar: string; name_en: string }
export interface CatRow { id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string }

/** Everything the wizard route's UI consumes from the loader. */
export interface OnboardingLoaderData {
  lang: Locale;
  uid: string;
  vendor: VendorRow | null;
  config: VendorConfig;
  documents: VendorDocumentRow[];
  governorates: GovRow[];
  areas: AreaRow[];
  categories: CatRow[];
  media: MediaSettings;
  supabaseUrl: string;
}

/** Shape of both fetcher responses the wizard client reads (autosave + submit). */
export type ActionData =
  | { ok: true; savedAt?: string; redirectTo?: string }
  | { ok: false; error?: string };

/** Body of the route loader: auth/status gating + all wizard reference data. */
export async function loadOnboardingData(request: Request, params: { lang?: string }) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw redirect(`/${lang}/auth/login?error=db`);
  }
  // the request's shared session (verified locally, no extra auth round-trip)
  const userId = (await getViewer(client))?.viewer?.user.id;
  if (!userId) {
    throw redirect(`/${lang}/auth/login?next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}`);
  }
  const { data: profile } = await client.from("profiles").select("status, role").eq("id", userId).single();
  if (profile?.status === "blocked") {
    throw redirect(`/${lang}/auth/login?error=blocked`);
  }

  const [vendor, config, mediaRow] = await Promise.all([
    fetchVendorRow(client, userId),
    fetchVendorConfig(client),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);
  // an admin without a store manages stores from the admin panel (UI-11)
  if (!vendor && profile?.role === "admin") {
    throw redirect(`/${lang}/admin/vendors`);
  }

  // No skipping: active/suspended stores have nothing to onboard.
  if (vendor && (vendor.status === "active" || vendor.status === "suspended")) {
    throw redirect(`/${lang}/vendor`);
  }

  const [govs, areas, cats, docs] = await Promise.all([
    client.from("governorates").select("id, name_ar, name_en").eq("is_active", true).order("sort"),
    client.from("areas").select("id, governorate_id, name_ar, name_en").eq("is_active", true).order("sort"),
    client
      .from("categories")
      .select("id, parent_id, depth, name_ar, name_en")
      .eq("is_active", true)
      .is("deleted_at", null)
      .lte("depth", 2) // the store-category picker shows roots + their subs only
      .order("sort"),
    vendor ? fetchVendorDocuments(client, vendor.id) : Promise.resolve([]),
  ]);

  const payload: OnboardingLoaderData = {
    lang,
    uid: userId,
    vendor,
    config,
    documents: docs,
    governorates: (govs.data ?? []) as GovRow[],
    areas: (areas.data ?? []) as AreaRow[],
    categories: (cats.data ?? []) as CatRow[],
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
  return data(payload);
}

/** Body of the route action: the two fetcher intents (autosave / submit). */
export async function handleOnboardingAction(request: Request, params: { lang?: string }) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // the request's shared session (verified locally, no extra auth round-trip)
  const userId = (await getViewer(client))?.viewer?.user.id;
  if (!userId) return data<ActionData>({ ok: false, error: "auth" }, { status: 401 });

  if (intent === "autosave") {
    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload") ?? "{}"));
    } catch {
      return data<ActionData>({ ok: false, error: "payload" }, { status: 400 });
    }
    const step = Number((payload as { step?: unknown }).step ?? 1);
    const { error } = await client.rpc("fn_vendor_autosave", {
      p_step: step,
      p_data: (payload as { data?: unknown }).data ?? {},
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true as const, savedAt: new Date().toISOString() };
  }

  if (intent === "submit") {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(form.get("payload") ?? "{}")) as Record<string, unknown>;
    } catch {
      return data<ActionData>({ ok: false, error: "payload" }, { status: 400 });
    }
    const { error } = await client.rpc("fn_vendor_onboard", { p_data: payload });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    if (request.headers.get("sec-fetch-mode") === "navigate") {
      throw redirect(`/${lang}/vendor/onboarding?done=1`);
    }
    return { ok: true as const, redirectTo: `/${lang}/vendor/onboarding?done=1` };
  }

  return data<ActionData>({ ok: false, error: "intent" }, { status: 400 });
}
