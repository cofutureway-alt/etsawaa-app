import { useEffect, useState } from "react";
import type { Route } from "./+types/brands";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog } from "~/components/ui/Overlay";
import { useToast } from "~/components/ui/Toast";
import { ChevronRightIcon, PencilIcon, TrashIcon } from "~/components/ui/icons";
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";


interface BrandRow {
  id: string;
  name_ar: string;
  name_en: string;
  slug_ar: string;
  slug_en: string;
  thumb_path: string | null;
  sort: number;
  is_active: boolean;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client
    .from("brands")
    .select("id,name_ar,name_en,slug_ar,slug_en,thumb_path,sort,is_active")
    .is("deleted_at", null)
    .order("sort");
  if (error) throw new Response(error.message, { status: 500 });
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  return {
    lang,
    brands: (rows ?? []) as BrandRow[],
    media: parseMediaSettings(mediaRow?.value),
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false as const, reason: "db" };
  // Writes are is_admin()-gated in RLS, but the loader-only guard meant a
  // non-admin POST surfaced a raw DB error instead of a 403.
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = form.get("id") ? String(form.get("id")) : null;

  if (intent === "create" || intent === "update") {
    const patch = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      slug_ar: String(form.get("slug_ar") ?? "").trim(),
      slug_en: String(form.get("slug_en") ?? "").trim(),
      thumb_path: String(form.get("thumb_path") ?? "").trim() || null,
      is_active: form.get("is_active") !== "false",
    };
    if (!patch.name_ar || !patch.name_en || !patch.slug_ar || !patch.slug_en) return { ok: false as const, reason: "invalid" };
    if (intent === "create") {
      const { error } = await client.from("brands").insert(patch);
      if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    } else if (id) {
      const { error } = await client.from("brands").update(patch).eq("id", id);
      if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    }
    return { ok: true as const };
  }
  if (intent === "reorder" && id) {
    const { error } = await client.from("brands").update({ sort: Number(form.get("sort") ?? 0) }).eq("id", id);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  }
  if (intent === "delete" && id) {
    const { error } = await client.from("brands").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id);
    if (error) return { ok: false as const, reason: "error" };
    return { ok: true as const };
  }
  return { ok: false as const, reason: "invalid" };
}

export default function AdminBrands({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fetcher = useFetcher<typeof action>();
  const { brands, media, uid, supabaseUrl } = loaderData;
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BrandRow | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        toast.showToast("success", t("catalog.saved"));
        setEditing(null);
        setCreating(false);
        setDeleting(null);
      } else {
        toast.showToast("error", fetcher.data.reason === "duplicate" ? t("catalog.slugTaken") : t("catalog.saveFailed"));
      }
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  const moveStep = (row: BrandRow, dir: -1 | 1) => {
    const idx = brands.findIndex((b) => b.id === row.id);
    const j = idx + dir;
    if (j < 0 || j >= brands.length) return;
    const ordered = [...brands];
    const tmp = ordered[idx];
    ordered[idx] = ordered[j]!;
    ordered[j] = tmp!;
    ordered.forEach((b, i) => {
      if (b.sort !== i) {
        const fd = new FormData();
        fd.set("intent", "reorder");
        fd.set("id", b.id);
        fd.set("sort", String(i));
        fetcher.submit(fd, { method: "post" });
      }
    });
  };

  const dialogOpen = creating || editing !== null;
  const current = editing;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-extrabold text-text">{t("catalog.brands")}</h1>
        <Button type="button" onClick={() => { setCreating(true); setEditing(null); setThumb(null); }}>{t("catalog.addBrand")}</Button>
      </div>

      <ul className="flex flex-col gap-2">
        {brands.map((b, i) => (
          <li key={b.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
            {b.thumb_path ? (
              <img src={`${supabaseUrl}/storage/v1/object/public/media/${b.thumb_path}`} alt="" width={40} height={40} loading="lazy" className="size-10 rounded-md bg-surface-tint object-cover" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-md bg-surface-tint text-[11px] font-bold text-text-faint">{b.name_en.slice(0, 2)}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text">
              {b.name_ar} <span className="font-normal text-text-faint">/ {b.name_en}</span>
            </span>
            <button type="button" aria-label={t("catalog.moveUp")} onClick={() => moveStep(b, -1)} className="cursor-pointer text-text-muted hover:text-action"><ChevronRightIcon className="size-4 rotate-90" /></button>
            <button type="button" aria-label={t("catalog.moveDown")} onClick={() => moveStep(b, 1)} className="cursor-pointer text-text-muted hover:text-action"><ChevronRightIcon className="size-4 -rotate-90" /></button>
            <button type="button" aria-label={t("common.edit")} onClick={() => { setEditing(b); setThumb(b.thumb_path); }} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-4" /></button>
            <button type="button" aria-label={t("common.delete")} onClick={() => setDeleting(b)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-4" /></button>
            <span className="hidden">{i}</span>
          </li>
        ))}
        {brands.length === 0 ? <li className="rounded-lg border border-dashed border-border bg-surface py-10 text-center text-[13px] text-text-muted">{t("catalog.noBrands")}</li> : null}
      </ul>

      <Dialog open={dialogOpen} onClose={() => { setCreating(false); setEditing(null); }} title={current ? t("catalog.editBrand") : t("catalog.addBrand")}>
        <fetcher.Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value={current ? "update" : "create"} />
          {current ? <input type="hidden" name="id" value={current.id} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("catalog.nameAr")} name="name_ar" defaultValue={current?.name_ar} required maxLength={80} inputClassName="bg-surface" />
            <Input label={t("catalog.nameEn")} name="name_en" defaultValue={current?.name_en} required maxLength={80} dir="ltr" inputClassName="bg-surface" />
            <Input label={t("catalog.slugAr")} name="slug_ar" defaultValue={current?.slug_ar} required dir="ltr" pattern="[a-z0-9-]+" inputClassName="bg-surface" />
            <Input label={t("catalog.slugEn")} name="slug_en" defaultValue={current?.slug_en} required dir="ltr" pattern="[a-z0-9-]+" inputClassName="bg-surface" />
          </div>
          <div className="flex items-center gap-3">
            {thumb ? (
              <img src={`${supabaseUrl}/storage/v1/object/public/media/${thumb}`} alt="" width={48} height={48} className="size-12 rounded-md bg-surface-tint object-cover" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-text-faint">{t("catalog.logo")}</span>
            )}
            <input type="hidden" name="thumb_path" value={thumb ?? ""} />
            <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>{t("media.choose")}</Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy}>{t("common.save")}</Button>
          </div>
        </fetcher.Form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("common.confirm")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-[13px] text-text">{t("catalog.deleteConfirm", { name: deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <MediaPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("media.pickImage")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => setThumb(files[0]?.path ?? null)}
      />
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

/**
 * Without a route boundary a loader throw (or a guard redirect) escaped the
 * panel layout and rendered the standalone root error document, losing the
 * sidebar. Every other admin route already had one.
 */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
