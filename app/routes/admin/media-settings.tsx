import type { Route } from "./+types/media-settings";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { useToast } from "~/components/ui/Toast";
import { MEDIA_SETTINGS_SCHEMA, parseMediaSettings } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  await requirePanelAccess(client, lang, "admin", request);
  const { data: row } = await client.from("settings").select("value").eq("key", "media").single();
  return { media: parseMediaSettings(row?.value), siteUrl: process.env.SITE_URL ?? "" };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false as const, reason: "db" };
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();

  if (String(form.get("intent")) === "test_upload") {
    // validate configuration by pushing a tiny probe object through the bucket config
    const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/admin-update-bucket`;
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        Authorization: request.headers.get("Authorization") ?? `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY ?? "",
      },
      body: JSON.stringify({ action: "probe" }),
    });
    return { ok: res.ok as boolean, reason: res.ok ? "probe_ok" : `probe_${res.status}` };
  }

  const candidate = parseMediaSettings({
    allow_images: form.get("allow_images") === "on",
    allow_video: form.get("allow_video") === "on",
    allow_pdf: form.get("allow_pdf") === "on",
    allowed_mimes: form.getAll("mimes").map(String),
    max_image_mb: Number(form.get("max_image_mb")),
    max_video_mb: Number(form.get("max_video_mb")),
    max_pdf_mb: Number(form.get("max_pdf_mb")),
    max_dimensions_px: Number(form.get("max_dimensions_px")),
  });
  const checked = MEDIA_SETTINGS_SCHEMA.safeParse(candidate);
  if (!checked.success) return { ok: false as const, reason: "invalid" };

  const { error } = await client.from("settings").upsert({ key: "media", value: checked.data }, { onConflict: "key" });
  if (error) return { ok: false as const, reason: error.message };

  // apply the limits to the buckets through the service-role edge function
  const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/admin-update-bucket`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization") ?? `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_ANON_KEY ?? "",
    },
    body: JSON.stringify({ action: "apply", media: checked.data }),
  });
  if (!res.ok) return { ok: false as const, reason: `bucket_${res.status}` };
  return { ok: true as const };
}

export default function AdminMediaSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fetcher = useFetcher<typeof action>();
  const [m, setM] = useState(loaderData.media);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) toast.showToast("success", fetcher.data.reason === "probe_ok" ? t("mediaSettings.probeOk") : t("mediaSettings.saved"));
      else toast.showToast("error", t("mediaSettings.saveFailed"));
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  const mimeList = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "video/mp4", "application/pdf"];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold text-text">{t("mediaSettings.title")}</h1>
      <p className="text-[13px] text-text-muted">{t("mediaSettings.hint")}</p>

      <fetcher.Form method="post" className="flex max-w-2xl flex-col gap-4 rounded-l border border-border bg-surface p-4">
        <input type="hidden" name="intent" value="save" />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-extrabold text-text">{t("mediaSettings.kinds")}</legend>
          {([
            ["allow_images", "mediaSettings.images"],
            ["allow_video", "mediaSettings.video"],
            ["allow_pdf", "mediaSettings.pdf"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input
                type="checkbox"
                name={key}
                checked={m[key]}
                onChange={(e) => setM((cur) => ({ ...cur, [key]: e.target.checked }))}
                className="size-4 accent-[var(--color-action)]"
              />
              {t(label)}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-extrabold text-text">{t("mediaSettings.mimes")}</legend>
          {mimeList.map((mime) => (
            <label key={mime} className="flex items-center gap-2 text-[13px] text-text">
              <input
                type="checkbox"
                name="mimes"
                value={mime}
                checked={m.allowed_mimes.includes(mime)}
                onChange={(e) =>
                  setM((cur) => ({
                    ...cur,
                    allowed_mimes: e.target.checked
                      ? [...cur.allowed_mimes, mime]
                      : cur.allowed_mimes.filter((x) => x !== mime),
                  }))
                }
                className="size-4 accent-[var(--color-action)]"
              />
              <span className="num">{mime}</span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t("mediaSettings.maxImage")} name="max_image_mb" type="number" step="0.5" min="0.5" max="50" value={String(m.max_image_mb)} onChange={(e) => setM((cur) => ({ ...cur, max_image_mb: Number(e.target.value) }))} inputClassName="bg-surface" />
          <Input label={t("mediaSettings.maxVideo")} name="max_video_mb" type="number" step="1" min="1" max="50" value={String(m.max_video_mb)} onChange={(e) => setM((cur) => ({ ...cur, max_video_mb: Number(e.target.value) }))} inputClassName="bg-surface" />
          <Input label={t("mediaSettings.maxPdf")} name="max_pdf_mb" type="number" step="1" min="1" max="50" value={String(m.max_pdf_mb)} onChange={(e) => setM((cur) => ({ ...cur, max_pdf_mb: Number(e.target.value) }))} inputClassName="bg-surface" />
          <Input label={t("mediaSettings.maxDims")} name="max_dimensions_px" type="number" step="100" min="100" max="8000" value={String(m.max_dimensions_px)} onChange={(e) => setM((cur) => ({ ...cur, max_dimensions_px: Number(e.target.value) }))} inputClassName="bg-surface" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button type="submit" loading={busy && fetcher.formData?.get("intent") !== "test_upload"}>{t("common.save")}</Button>
          <Button type="submit" name="intent" value="test_upload" variant="outline" loading={busy && fetcher.formData?.get("intent") === "test_upload"}>
            {t("mediaSettings.testUpload")}
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
  return <SkeletonTable />;
}
