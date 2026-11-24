import { BANNER_SIZES } from "~/components/catalog/FitBanner";
import { data, useFetcher } from "react-router";
import type { Route } from "./+types/banners";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer, requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { PlusIcon, CheckIcon, TrashIcon, PencilIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings } from "~/lib/media.shared";
import type { MediaFileRow } from "~/features/media/api";
import { SkeletonTable } from "~/components/ui/Skeleton";
// Surfaces the action result: these pages used to discard {ok:false} and
// render nothing, so a failed write looked like a dead button.
import { useActionToast } from "~/components/layout/ActionFeedback";
import { PageHeader } from "~/components/layout/PageHeader";


/**
 * A-32 — Banners manager: hero/footer placements, image path (MediaPicker
 * pattern), link, dates, order, active toggle. Expired banner disappears
 * automatically (the storefront query filters by dates).
 */

interface BannerRow {
  id: string; title_ar: string; title_en: string; image_path: string;
  link_url: string; position: number; is_active: boolean;
  starts_at: string | null; ends_at: string | null;
  placement: string;
}

/** Home page order: each placement shows the banner right after that section. */
const PLACEMENTS = ["hero", "after_brands", "after_categories", "after_best", "after_best_selling", "after_top_rated", "after_vendors", "after_recent", "bottom", "product_page"] as const;
const SECTION_ORDER = ["hero", "brands", "categories", "best", "best_selling", "top_rated", "vendors", "recent", "bottom"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client.from("banners").select("*").order("position");
  if (error) throw new Error(error.message);
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  return {
    lang,
    banners: JSON.parse(JSON.stringify(rows ?? [])) as BannerRow[],
    media: parseMediaSettings(mediaRow?.value),
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
  const id = String(form.get("id") ?? "");

  if (intent === "save") {
    const str = (k: string) => String(form.get(k) ?? "").trim();
    // date inputs are Cairo calendar days: a banner runs from the first
    // second of its start day to the last second of its end day
    const day = (k: string, end: boolean) => (str(k) ? cairoBoundary(str(k), end) : null);
    const payload = {
      title_ar: str("title_ar"), title_en: str("title_en"),
      image_path: str("image_path"),
      link_url: str("link_url"),
      position: Math.max(0, Math.trunc(Number(form.get("position") ?? 0))),
      placement: (PLACEMENTS as readonly string[]).includes(str("placement")) ? str("placement") : "hero",
      is_active: form.get("is_active") === "on",
      starts_at: day("starts_at", false),
      ends_at: day("ends_at", true),
    };
    if (!payload.image_path) return data({ ok: false, reason: "image_required" }, { status: 400 });
    if (payload.starts_at && payload.ends_at && payload.ends_at < payload.starts_at) {
      return data({ ok: false, reason: "bad_dates" }, { status: 400 });
    }
    if (id) {
      const { error } = await client.from("banners").update(payload).eq("id", id);
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    }
    else {
      const { error } = await client.from("banners").insert(payload);
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    }
    await client.rpc("fn_audit", { p_action: id ? "banner.updated" : "banner.created", p_entity: "banners", p_entity_id: id || null, p_before: null, p_after: payload });
    return { ok: true as const };
  }

  if (intent === "delete") {
    const { error } = await client.from("banners").delete().eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "banner.deleted", p_entity: "banners", p_entity_id: id, p_before: null, p_after: null });
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

/**
 * Where on the home page: a mini map of the sections in order — the admin
 * clicks the gap between two sections (or the hero carousel) and sees the
 * banner drawn there before saving.
 */
function PlacementPicker({ value, setValue }: { value: string; setValue: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
      <legend className="mb-1 text-sm font-bold text-text">{t("bn.placement")}</legend>
      <input type="hidden" name="placement" value={value} />
      <ol className="flex flex-col gap-1 rounded-lg border border-border bg-surface-tint/50 p-2">
        {SECTION_ORDER.map((sec) => {
          const spot = sec === "hero" ? "hero" : sec === "bottom" ? "bottom" : `after_${sec}`;
          const on = value === spot;
          return (
            <li key={sec} className="flex flex-col gap-1">
              {sec !== "bottom" ? (
                <div className={`rounded-md px-3 py-1.5 text-xs font-bold ${sec === "hero" && on ? "border-2 border-action bg-action/10 text-action" : "border border-border bg-surface text-text-muted"}`}>
                  {t(`bn.sec.${sec}`)}
                  {sec === "hero" ? (
                    <button type="button" onClick={() => setValue("hero")} aria-pressed={on}
                      className="ms-2 cursor-pointer rounded bg-surface-tint px-1.5 py-0.5 text-2xs font-black text-action hover:bg-action hover:text-on-action">
                      {on ? `✓ ${t("bn.inCarousel")}` : t("bn.putInCarousel")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {sec !== "hero" ? (
                <button type="button" onClick={() => setValue(spot)} aria-pressed={on}
                  className={`flex min-h-8 cursor-pointer items-center justify-center rounded-md border-2 border-dashed text-2xs font-black transition-colors ${on ? "border-action bg-action text-on-action" : "border-border text-text-faint hover:border-action hover:text-action"}`}>
                  {on ? `▼ ${t("bn.hereNow")}` : `+ ${t(`bn.place.${spot}`)}`}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {/* outside the home page: the ad carousel on every product page */}
      <p className="mt-2 text-2xs font-bold text-text-muted">{t("bn.otherPages")}</p>
      <button type="button" onClick={() => setValue("product_page")} aria-pressed={value === "product_page"}
        className={`flex min-h-10 cursor-pointer flex-col items-center justify-center rounded-md border-2 px-3 py-1.5 text-xs font-black transition-colors ${value === "product_page" ? "border-action bg-action text-on-action" : "border-dashed border-border text-text-muted hover:border-action hover:text-action"}`}>
        <span>{value === "product_page" ? `✓ ${t("bn.place.product_page")}` : `+ ${t("bn.place.product_page")}`}</span>
        <span className="text-2xs font-semibold opacity-80">{t("bn.productPageHint")}</span>
      </button>
    </fieldset>
  );
}

/** "2026-11-30" (a Cairo calendar day) → that day's first or last second in Cairo, as ISO. */
function cairoBoundary(day: string, end: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const noon = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" })
    .formatToParts(noon).find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(offset);
  const tz = m ? `${m[1]}${m[2]!.padStart(2, "0")}:${m[3] ?? "00"}` : "+02:00";
  return new Date(`${day}T${end ? "23:59:59" : "00:00:00"}${tz}`).toISOString();
}

/** ISO → the Cairo calendar day for a date input. */
function cairoDay(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));
}

export default function AdminBanners({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const banners = loaderData.banners as BannerRow[];
  // null = closed, "new" = create, a row = edit
  const [editing, setEditing] = useState<BannerRow | "new" | null>(null);
  const [image, setImage] = useState("");
  const [placement, setPlacement] = useState("hero");
  // every banner of a placement renders in one box: tell the admin its exact size
  const size = BANNER_SIZES[placement === "hero" ? "hero" : placement === "product_page" ? "product" : "section"];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BannerRow | null>(null);
  const current = editing && editing !== "new" ? editing : null;
  const now = new Date().toISOString();

  const open = (row: BannerRow | "new") => {
    setImage(row === "new" ? "" : row.image_path);
    setPlacement(row === "new" ? "hero" : row.placement ?? "hero");
    setEditing(row);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setEditing(null);
      setConfirmDelete(null);
    }
  }, [fetcher.state, fetcher.data]);

  const statusOf = (b: BannerRow): { tone: "success" | "neutral" | "danger" | "info"; label: string } => {
    if (!b.is_active) return { tone: "neutral", label: t("bn.inactive") };
    if (b.ends_at && b.ends_at < now) return { tone: "danger", label: t("bn.expired") };
    if (b.starts_at && b.starts_at > now) return { tone: "info", label: t("bn.scheduled") };
    return { tone: "success", label: t("bn.live") };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("bn.title")}
        subtitle={t("bn.hint")}
        count={banners.length}
        actions={
          <Button size="sm" onClick={() => open("new")}>
            <PlusIcon className="size-4" />
            {t("bn.new")}
          </Button>
        }
      />

      {banners.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 shadow-1">
          <EmptyState title={t("bn.empty")} body={t("bn.emptyHint")} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {banners.map((b) => {
            const status = statusOf(b);
            return (
              <article key={b.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-1">
                <div className="relative aspect-[16/9] bg-surface-tint">
                  <MediaImage path={b.image_path} alt={(en ? b.title_en : b.title_ar) || ""} width={640} height={360}
                    supabaseUrl={loaderData.supabaseUrl} className="size-full object-cover" />
                  <span className="absolute start-2 top-2">
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </span>
                  <span className="num absolute end-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-bold text-text">
                    {t(`bn.place.${b.placement ?? "hero"}`)} · #{b.position}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h3 className="truncate text-sm font-black text-text">
                    {(en ? b.title_en || b.title_ar : b.title_ar || b.title_en) || t("bn.untitled")}
                  </h3>
                  {b.link_url ? <p className="truncate text-xs text-text-muted" dir="ltr">{b.link_url}</p> : null}
                  <p className="text-xs text-text-muted">
                    {b.starts_at || b.ends_at
                      ? `${cairoDay(b.starts_at) || "…"} → ${cairoDay(b.ends_at) || "…"}`
                      : t("bn.always")}
                  </p>
                  <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                    {b.placement !== "product_page" ? (
                      <a href={`/${loaderData.lang}?bannerPreview=${b.id}#banner-${b.id}`} target="_blank" rel="noopener noreferrer"
                        className="me-auto inline-flex min-h-8 items-center rounded-md px-2 text-xs font-bold text-action hover:bg-surface-tint">{t("bn.previewLive")} ↗</a>
                    ) : <span className="me-auto" />}
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(b)} className="text-danger">
                      <TrashIcon className="size-3.5" />
                      {t("bn.delete")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => open(b)}>
                      <PencilIcon className="size-3.5" />
                      {t("bn.edit")}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* create / edit */}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? t("bn.edit") : t("bn.new")} size="lg">
        <fetcher.Form method="post" key={current?.id ?? "new"} className="flex flex-col gap-4 p-1">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="id" value={current?.id ?? ""} />
          <input type="hidden" name="image_path" value={image} />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-text">{t("bn.image")} <span className="text-danger">*</span></span>
            <button type="button" onClick={() => setPickerOpen(true)}
              style={{ aspectRatio: `${size.w} / ${size.h}` }}
              className="group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-border bg-surface-tint/40 text-sm font-bold text-text-muted transition-colors hover:border-action hover:text-action">
              {image ? (
                <MediaImage path={image} alt="" width={640} height={360} supabaseUrl={loaderData.supabaseUrl} className="size-full !object-contain" />
              ) : (
                <span className="flex flex-col items-center gap-1.5"><PlusIcon className="size-6" />{t("bn.pickImage")}</span>
              )}
            </button>
            <p className="rounded-md bg-info-soft px-3 py-2 text-xs font-bold text-info">
              {t("bn.bestSize", { w: size.w, h: size.h })}
            </p>
            <p className="text-xs text-text-muted">{t("bn.fitHint")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input id="bn-title-ar" name="title_ar" label={t("bn.altAr")} defaultValue={current?.title_ar} />
            <Input id="bn-title-en" name="title_en" dir="ltr" label={t("bn.altEn")} defaultValue={current?.title_en} />
            <Input id="bn-link" name="link_url" dir="ltr" label={t("bn.link")} placeholder={`/${loaderData.lang}/category/…`}
              defaultValue={current?.link_url} className="sm:col-span-2" />
            <Input id="bn-from" name="starts_at" type="date" dir="ltr" label={t("bn.from")} defaultValue={cairoDay(current?.starts_at ?? null)} />
            <Input id="bn-to" name="ends_at" type="date" dir="ltr" label={t("bn.to")} defaultValue={cairoDay(current?.ends_at ?? null)} />
            <Input id="bn-pos" name="position" type="number" min={0} dir="ltr" label={t("bn.order")}
              defaultValue={current?.position ?? banners.length + 1} />
            <PlacementPicker value={placement} setValue={setPlacement} />
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-bold text-text">
              <input type="checkbox" name="is_active" defaultChecked={current?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />
              {t("pn.active")}
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy} disabled={!image}>
              <CheckIcon className="size-4" />
              {current ? t("ve.save") : t("cp.create")}
            </Button>
          </div>
        </fetcher.Form>
      </Dialog>

      {/* delete confirmation */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title={t("bn.delete")}>
        {confirmDelete ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={confirmDelete.id} />
            <p className="text-sm text-text">{t("bn.deleteConfirm")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className="bg-danger hover:bg-danger">{t("bn.delete")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <MediaPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("media.pickImage")}
        settings={loaderData.media}
        uid={loaderData.uid}
        supabaseUrl={loaderData.supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files: MediaFileRow[]) => { setImage(files[0]?.path ?? ""); setPickerOpen(false); }}
      />
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
