import { data, useFetcher } from "react-router";
import type { Route } from "./+types/mega-menu";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer, requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { PlusIcon, TrashIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings } from "~/lib/media.shared";
import type { MediaFileRow } from "~/features/media/api";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { PageHeader } from "~/components/layout/PageHeader";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";

/**
 * Home hero mega menu art (owner request): for any top-level category, an
 * image drawn in the open panel's empty space — as a picture in the corner or
 * as a soft full background — with an optional link. One image per menu.
 */

interface Root { id: string; name_ar: string; name_en: string; icon: string | null }
interface Art { category_id: string; image_path: string; mode: "corner" | "background"; link_url: string; is_active: boolean }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [roots, arts, mediaRow] = await Promise.all([
    client.from("categories").select("id, name_ar, name_en, icon").eq("depth", 1).is("deleted_at", null).order("sort"),
    client.from("mega_menu_art").select("category_id, image_path, mode, link_url, is_active"),
    client.from("settings").select("value").eq("key", "media").single(),
  ]);
  if (roots.error) throw new Error(roots.error.message);
  return {
    lang,
    roots: (roots.data ?? []) as Root[],
    arts: (arts.data ?? []) as Art[],
    media: parseMediaSettings(mediaRow.data?.value),
    uid: (await getViewer(client))?.viewer?.user.id ?? "",
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("category_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return data({ ok: false, reason: "bad_category" }, { status: 400 });
  if (intent === "delete") {
    const { error } = await client.from("mega_menu_art").delete().eq("category_id", id);
    return error ? data({ ok: false, reason: error.message }, { status: 400 }) : { ok: true };
  }
  const image = String(form.get("image_path") ?? "").trim();
  const link = String(form.get("link_url") ?? "").trim();
  if (!image) return data({ ok: false, reason: "image_required" }, { status: 400 });
  if (link && !/^(\/|https:\/\/)/.test(link)) return data({ ok: false, reason: "bad_link" }, { status: 400 });
  const { error } = await client.from("mega_menu_art").upsert({
    category_id: id,
    image_path: image,
    mode: form.get("mode") === "background" ? "background" : "corner",
    link_url: link,
    is_active: form.get("is_active") === "on",
    updated_at: new Date().toISOString(),
  });
  return error ? data({ ok: false, reason: error.message }, { status: 400 }) : { ok: true };
}

export default function AdminMegaMenu({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, roots, arts } = loaderData;
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("mm.title")} subtitle={t("mm.hint")} />
      <div className="grid gap-3 lg:grid-cols-2">
        {roots.map((r) => {
          const art = arts.find((a) => a.category_id === r.id) ?? null;
          return (
            <ArtCard key={r.id} root={r} art={art} lang={lang} supabaseUrl={loaderData.supabaseUrl}
              image={images[r.id] ?? art?.image_path ?? ""} onPick={() => setPickFor(r.id)}
              onClear={() => setImages((m) => ({ ...m, [r.id]: "" }))} />
          );
        })}
      </div>
      <MediaPickerDialog
        open={pickFor !== null}
        onClose={() => setPickFor(null)}
        title={t("media.pickImage")}
        settings={loaderData.media}
        uid={loaderData.uid}
        supabaseUrl={loaderData.supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files: MediaFileRow[]) => {
          if (pickFor) setImages((m) => ({ ...m, [pickFor]: files[0]?.path ?? "" }));
          setPickFor(null);
        }}
      />
    </div>
  );
}

function ArtCard({ root, art, lang, image, supabaseUrl, onPick, onClear }: {
  root: Root; art: Art | null; lang: string; image: string; supabaseUrl: string; onPick: () => void; onClear: () => void;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [mode, setMode] = useState<Art["mode"]>(art?.mode ?? "corner");
  const name = lang === "en" ? root.name_en || root.name_ar : root.name_ar || root.name_en;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
      <header className="flex items-center gap-2">
        <CategoryIcon icon={root.icon} className="size-5 text-action" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-extrabold text-text">{name}</h2>
        {art ? (
          <span className={`rounded-full px-2 py-0.5 text-2xs font-black ${art.is_active ? "bg-success-soft text-success-strong" : "bg-surface-tint text-text-muted"}`}>
            {art.is_active ? t("mm.shown") : t("mm.hidden")}
          </span>
        ) : null}
      </header>
      <fetcher.Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="category_id" value={root.id} />
        <input type="hidden" name="image_path" value={image} />
        <input type="hidden" name="mode" value={mode} />
        {/* a scaled preview of the open mega menu panel */}
        <div className="relative h-36 overflow-hidden rounded-md border border-border bg-surface">
          {image && mode === "background" ? (
            <MediaImage path={image} alt="" width={640} height={300} supabaseUrl={supabaseUrl} className="absolute inset-0 size-full object-cover opacity-25" />
          ) : null}
          <div className="relative grid grid-cols-3 gap-2 p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <span className="h-2 w-3/4 rounded bg-text/30" />
                <span className="h-1.5 w-1/2 rounded bg-text/15" />
                <span className="h-1.5 w-2/3 rounded bg-text/15" />
              </div>
            ))}
          </div>
          {image && mode === "corner" ? (
            <MediaImage path={image} alt="" width={240} height={240} supabaseUrl={supabaseUrl} className="absolute bottom-2 end-2 h-20 w-auto !object-contain" />
          ) : null}
          {!image ? (
            <button type="button" onClick={onPick} className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 bg-surface/70 text-sm font-bold text-text-muted hover:text-action">
              <PlusIcon className="size-5" />{t("mm.pick")}
            </button>
          ) : null}
        </div>
        {image ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onPick}>{t("mm.change")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}><TrashIcon className="size-4" />{t("common.remove")}</Button>
          </div>
        ) : null}
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-xs font-bold text-text">{t("mm.mode")}</legend>
          {(["corner", "background"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`rounded-md border p-2 text-start text-xs transition-colors ${mode === m ? "border-action bg-surface-tint font-bold text-action" : "border-border text-text hover:border-border-strong"}`}>
              {t(`mm.mode_${m}`)}
              <span className="mt-0.5 block text-2xs font-normal text-text-muted">{t(`mm.modeHint_${m}`)}</span>
            </button>
          ))}
        </fieldset>
        <p className="text-2xs font-bold text-info">{t(mode === "background" ? "mm.sizeBg" : "mm.sizeCorner")}</p>
        <Input name="link_url" dir="ltr" label={t("mm.link")} hint={t("mm.linkHint")} defaultValue={art?.link_url ?? ""} placeholder={`/${lang}/category/…`} />
        <label className="flex items-center gap-2 text-sm font-bold text-text">
          <input type="checkbox" name="is_active" defaultChecked={art?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />
          {t("mm.active")}
        </label>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          {art ? (
            <Button type="submit" name="intent" value="delete" size="sm" variant="ghost" disabled={busy}>{t("mm.delete")}</Button>
          ) : null}
          <Button type="submit" name="intent" value="save" size="sm" loading={busy} disabled={busy || !image}>{t("common.save")}</Button>
        </div>
      </fetcher.Form>
    </section>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

export function HydrateFallback() {
  return <SkeletonTable />;
}
