import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/store";
import { data, redirect, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Input,
  Select,
  useToast,
  CheckIcon,
} from "~/components/ui";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow, type VendorDocumentRow } from "~/features/vendor/api";
import { parseMediaSettings } from "~/lib/media.shared";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * /vendor/store — store settings (V-10): edit the store profile the vendor
 * filled during onboarding. RLS-protected owner columns; status/verification
 * stay server-managed.
 */

interface GovRow { id: number; name_ar: string; name_en: string }
interface AreaRow { id: number; governorate_id: number; name_ar: string; name_en: string }
interface CatRow { id: string; parent_id: string | null; name_ar: string; name_en: string }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw redirect(`/${lang}/auth/login?error=db`);
  }
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor) {
    throw redirect(`/${lang}/vendor/onboarding`);
  }
  const [govs, areas, cats, mediaRow] = await Promise.all([
    client.from("governorates").select("id, name_ar, name_en").eq("is_active", true).order("sort"),
    client.from("areas").select("id, governorate_id, name_ar, name_en").eq("is_active", true).order("sort"),
    client
      .from("categories")
      .select("id, parent_id, name_ar, name_en")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort"),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);
  return data({
    lang,
    uid: viewer.user.id,
    vendor,
    documents: [] as VendorDocumentRow[],
    governorates: (govs.data ?? []) as GovRow[],
    areas: (areas.data ?? []) as AreaRow[],
    categories: (cats.data ?? []) as CatRow[],
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  });
}

type ActionData = { ok: boolean; error?: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor) return data<ActionData>({ ok: false, error: "no_store" }, { status: 400 });

  const form = await request.formData();
  const categoryIds = form.getAll("categoryIds").map(String).filter(Boolean);
  const update = {
    store_name_ar: String(form.get("store_name_ar") ?? "").trim(),
    store_name_en: String(form.get("store_name_en") ?? "").trim(),
    short_desc_ar: String(form.get("short_desc_ar") ?? "").trim(),
    short_desc_en: String(form.get("short_desc_en") ?? "").trim(),
    welcome_msg_ar: String(form.get("welcome_msg_ar") ?? "").trim(),
    welcome_msg_en: String(form.get("welcome_msg_en") ?? "").trim(),
    logo_path: String(form.get("logo_path") ?? "") || null,
    banner_path: String(form.get("banner_path") ?? "") || null,
    category_ids: categoryIds,
    first_name: String(form.get("first_name") ?? "").trim(),
    last_name: String(form.get("last_name") ?? "").trim(),
    phone: String(form.get("phone") ?? "").trim() || null,
    governorate_id: form.get("governorate_id") ? Number(form.get("governorate_id")) : null,
    area_id: form.get("area_id") ? Number(form.get("area_id")) : null,
    address1: String(form.get("address1") ?? "").trim(),
    address2: String(form.get("address2") ?? "").trim(),
    postal_code: String(form.get("postal_code") ?? "").trim(),
    socials: {
      facebook: String(form.get("social_facebook") ?? "").trim(),
      instagram: String(form.get("social_instagram") ?? "").trim(),
      x: String(form.get("social_x") ?? "").trim(),
      tiktok: String(form.get("social_tiktok") ?? "").trim(),
      whatsapp: String(form.get("social_whatsapp") ?? "").trim(),
    },
  };
  if (!update.store_name_ar || !update.store_name_en) {
    return data<ActionData>({ ok: false, error: "name_required" }, { status: 400 });
  }
  // area must belong to the chosen governorate (V-04 DoD, enforced again here)
  if (update.area_id && update.governorate_id) {
    const { data: area } = await client
      .from("areas")
      .select("id")
      .eq("id", update.area_id)
      .eq("governorate_id", update.governorate_id)
      .maybeSingle();
    if (!area) return data<ActionData>({ ok: false, error: "area_mismatch" }, { status: 400 });
  }
  const { error } = await client.from("vendors").update(update).eq("id", vendor.id);
  if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
  return { ok: true };
}

export default function VendorStoreSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const isAr = lang === "ar";
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const vendor = loaderData.vendor;
  const [logoPicker, setLogoPicker] = useState(false);
  const [bannerPicker, setBannerPicker] = useState(false);
  const [logoPath, setLogoPath] = useState(vendor.logo_path ?? "");
  const [bannerPath, setBannerPath] = useState(vendor.banner_path ?? "");
  const [govId, setGovId] = useState(vendor.governorate_id ? String(vendor.governorate_id) : "");
  const [areaId, setAreaId] = useState(vendor.area_id ? String(vendor.area_id) : "");
  const lastToast = useRef<string | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const stamp = fetcher.data.ok ? "ok" : (fetcher.data.error ?? "err");
    if (lastToast.current === stamp) return;
    lastToast.current = stamp;
    if (fetcher.data.ok) toast.showToast("success", t("vendorStore.saved"));
    else if (fetcher.data.error === "area_mismatch") toast.showToast("error", t("vendorOnboarding.errors.area_required"));
    else toast.showToast("error", t("errors.generic"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const areas = loaderData.areas.filter((a) => a.governorate_id === Number(govId));
  const [selectedCats, setSelectedCats] = useState<string[]>(vendor.category_ids ?? []);

  const roots = loaderData.categories.filter((c) => c.parent_id === null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold text-text">{t("vendorStore.title")}</h1>

      <fetcher.Form method="post" className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="store_name_ar" name="store_name_ar" label={t("vendorOnboarding.step1.nameAr")} defaultValue={vendor.store_name_ar} required />
              <Input id="store_name_en" name="store_name_en" label={t("vendorOnboarding.step1.nameEn")} defaultValue={vendor.store_name_en} dir="ltr" required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="short_desc_ar" name="short_desc_ar" label={t("vendorOnboarding.step1.shortDescAr")} defaultValue={vendor.short_desc_ar} />
              <Input id="short_desc_en" name="short_desc_en" label={t("vendorOnboarding.step1.shortDescEn")} defaultValue={vendor.short_desc_en} dir="ltr" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="welcome_msg_ar" name="welcome_msg_ar" label={t("vendorOnboarding.step1.welcomeAr")} defaultValue={vendor.welcome_msg_ar} />
              <Input id="welcome_msg_en" name="welcome_msg_en" label={t("vendorOnboarding.step1.welcomeEn")} defaultValue={vendor.welcome_msg_en} dir="ltr" />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-bold text-text">{t("vendorOnboarding.step1.categories")}</p>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border bg-surface p-3 sm:grid-cols-2">
                {roots.map((root) => {
                  const subs = loaderData.categories.filter((c) => c.parent_id === root.id);
                  return (
                    <details key={root.id} className="rounded-md bg-surface-tint p-2">
                      <summary className="cursor-pointer list-none text-sm font-bold text-text">
                        {isAr ? root.name_ar : root.name_en}
                      </summary>
                      <div className="mt-1.5 flex flex-col gap-1 ps-4">
                        {[root, ...subs].map((cat) => (
                          <label key={cat.id} className="flex items-center gap-2 text-sm text-text">
                            <input
                              type="checkbox"
                              name="categoryIds"
                              value={cat.id}
                              className="size-4 accent-[var(--color-action)]"
                              checked={selectedCats.includes(cat.id)}
                              onChange={(e) =>
                                setSelectedCats((current) =>
                                  e.target.checked
                                    ? [...current, cat.id]
                                    : current.filter((id) => id !== cat.id),
                                )
                              }
                            />
                            {isAr ? cat.name_ar : cat.name_en}
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-text">{t("vendorOnboarding.step1.logo")}</span>
                <input type="hidden" name="logo_path" value={logoPath} />
                <div className="flex items-center gap-3">
                  <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint">
                    {logoPath ? (
                      <MediaImage path={logoPath} alt="" width={64} height={64} supabaseUrl={loaderData.supabaseUrl} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-2xs text-text-faint">—</span>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setLogoPicker(true)}>
                    {t("media.picker.choose")}
                  </Button>
                </div>
                <MediaPickerDialog
                  open={logoPicker}
                  onClose={() => setLogoPicker(false)}
                  title={t("vendorOnboarding.step1.logo")}
                  settings={loaderData.media}
                  uid={loaderData.uid}
                  supabaseUrl={loaderData.supabaseUrl}
                  mode="single"
                  kinds={["image"]}
                  onConfirm={(files) => {
                    if (files[0]) setLogoPath(files[0].path);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-text">{t("vendorOnboarding.step1.banner")}</span>
                <input type="hidden" name="banner_path" value={bannerPath} />
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint">
                    {bannerPath ? (
                      <MediaImage path={bannerPath} alt="" width={128} height={64} supabaseUrl={loaderData.supabaseUrl} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-2xs text-text-faint">—</span>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setBannerPicker(true)}>
                    {t("media.picker.choose")}
                  </Button>
                </div>
                <MediaPickerDialog
                  open={bannerPicker}
                  onClose={() => setBannerPicker(false)}
                  title={t("vendorOnboarding.step1.banner")}
                  settings={loaderData.media}
                  uid={loaderData.uid}
                  supabaseUrl={loaderData.supabaseUrl}
                  mode="single"
                  kinds={["image"]}
                  onConfirm={(files) => {
                    if (files[0]) setBannerPath(files[0].path);
                  }}
                />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="first_name" name="first_name" label={t("vendorOnboarding.step2.firstName")} defaultValue={vendor.first_name} />
              <Input id="last_name" name="last_name" label={t("vendorOnboarding.step2.lastName")} defaultValue={vendor.last_name} />
            </div>
            <Input id="phone" name="phone" label={t("vendorOnboarding.step2.phone")} defaultValue={vendor.phone ?? ""} dir="ltr" inputClassName="text-start" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="governorate_id"
                name="governorate_id"
                label={t("vendorOnboarding.step2.governorate")}
                value={govId}
                onChange={(e) => {
                  setGovId(e.target.value);
                  setAreaId(""); // US-03 edge: an area from the old governorate is invalid
                }}
                options={[
                  { value: "", label: t("common.choose") },
                  ...loaderData.governorates.map((g) => ({ value: String(g.id), label: isAr ? g.name_ar : g.name_en })),
                ]}
              />
              <Select
                id="area_id"
                name="area_id"
                label={t("vendorOnboarding.step2.area")}
                value={areaId}
                disabled={!govId}
                options={[
                  { value: "", label: t("common.choose") },
                  ...areas.map((a) => ({ value: String(a.id), label: isAr ? a.name_ar : a.name_en })),
                ]}
                onChange={(e) => setAreaId(e.target.value)}
              />
            </div>
            <Input id="address1" name="address1" label={t("vendorOnboarding.step2.address1")} defaultValue={vendor.address1} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="address2" name="address2" label={t("vendorOnboarding.step2.address2")} defaultValue={vendor.address2} />
              <Input id="postal_code" name="postal_code" label={t("vendorOnboarding.step2.postal")} defaultValue={vendor.postal_code} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["facebook", "instagram", "x", "tiktok", "whatsapp"] as const).map((platform) => (
                <Input
                  key={platform}
                  id={`social_${platform}`}
                  name={`social_${platform}`}
                  label={t(`vendorOnboarding.socials.${platform}`)}
                  defaultValue={vendor.socials?.[platform] ?? ""}
                  dir="ltr"
                />
              ))}
            </div>
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" size="lg" loading={fetcher.state !== "idle"}>
            <CheckIcon aria-hidden="true" className="size-4" />
            {t("vendorStore.save")}
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
