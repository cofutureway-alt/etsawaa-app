import { data, useFetcher } from "react-router";
import type { Route } from "./+types/banners";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { PlusIcon, CheckIcon, TrashIcon, GridIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-32 — Banners manager: hero/footer placements, image path (MediaPicker
 * pattern), link, dates, order, active toggle. Expired banner disappears
 * automatically (the storefront query filters by dates).
 */

interface BannerRow {
  id: string; title_ar: string; title_en: string; image_path: string;
  link_url: string; position: number; is_active: boolean;
  starts_at: string | null; ends_at: string | null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client.from("banners").select("*").order("position");
  if (error) throw new Error(error.message);
  return { lang, banners: JSON.parse(JSON.stringify(rows ?? [])) as BannerRow[] };
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
    const dateOrNull = (k: string) => (str(k) ? new Date(str(k)).toISOString() : null);
    const payload = {
      title_ar: str("title_ar"), title_en: str("title_en"),
      image_path: str("image_path"),
      link_url: str("link_url"),
      position: Math.max(0, Math.trunc(Number(form.get("position") ?? 0))),
      is_active: form.get("is_active") === "on",
      starts_at: dateOrNull("starts_at"),
      ends_at: dateOrNull("ends_at"),
    };
    if (!payload.image_path) return data({ ok: false, reason: "image_required" }, { status: 400 });
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

export default function AdminBanners({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("bn.title")}</h1>
            <Badge tone="featured" dot>{loaderData.banners.length} بانرات</Badge>
          </div>
          <p className="text-xs text-text-muted">{t("bn.hint")}</p>
        </div>
      </div>

      {loaderData.banners.length === 0 ? (
        <div className="rounded-xl border border-border/80 bg-surface p-6 shadow-sm">
          <EmptyState title={t("bn.empty")} body={t("bn.emptyHint")} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(loaderData.banners as BannerRow[]).map((b) => {
            const isExpired = b.ends_at && b.ends_at < new Date().toISOString();

            return (
              <div
                key={b.id}
                className="rounded-xl border border-border/80 bg-surface p-4 sm:p-5 shadow-sm space-y-4"
              >
                {/* Banner Card Top Row */}
                <div className="flex items-center justify-between border-b border-border/50 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-surface border border-border text-action font-black text-xs shadow-sm">
                      <GridIcon className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-text">
                        {b.title_ar || b.title_en || "بانر بدون عنوان"}
                      </h3>
                      {b.link_url ? (
                        <p className="text-[11px] font-mono text-text-muted truncate max-w-[200px]" dir="ltr">
                          {b.link_url}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <Badge
                    tone={isExpired ? "danger" : b.is_active ? "success" : "neutral"}
                    dot
                  >
                    {isExpired
                      ? t("bn.expired")
                      : b.is_active
                      ? t("cu.active")
                      : t("cu.blocked")}
                  </Badge>
                </div>

                {/* Banner Edit Form */}
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="id" value={b.id} />

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                    <label className="flex flex-col gap-1 font-bold text-text">
                      {t("bn.altAr")}
                      <input
                        name="title_ar"
                        defaultValue={b.title_ar}
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1 font-bold text-text">
                      {t("bn.altEn")}
                      <input
                        name="title_en"
                        defaultValue={b.title_en}
                        dir="ltr"
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1 font-bold text-text sm:col-span-2">
                      {t("bn.image")}
                      <input
                        name="image_path"
                        defaultValue={b.image_path}
                        dir="ltr"
                        required
                        placeholder="media/…"
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1 font-bold text-text sm:col-span-2">
                      {t("bn.link")}
                      <input
                        name="link_url"
                        defaultValue={b.link_url}
                        dir="ltr"
                        placeholder="https://..."
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1 font-bold text-text">
                      {t("bn.from")}
                      <input
                        name="starts_at"
                        type="date"
                        defaultValue={b.starts_at?.slice(0, 10) ?? ""}
                        dir="ltr"
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1 font-bold text-text">
                      {t("bn.to")}
                      <input
                        name="ends_at"
                        type="date"
                        defaultValue={b.ends_at?.slice(0, 10) ?? ""}
                        dir="ltr"
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1 font-bold text-text">
                      {t("bn.order")} (الترتيب)
                      <input
                        name="position"
                        type="number"
                        defaultValue={b.position}
                        dir="ltr"
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                      />
                    </label>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 text-xs font-bold text-text cursor-pointer">
                        <input
                          type="checkbox"
                          name="is_active"
                          defaultChecked={b.is_active}
                          className="size-4 rounded border-border accent-action cursor-pointer"
                        />
                        {t("pn.active")}
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
                    <button
                      type="submit"
                      name="intent"
                      value="delete"
                      disabled={busy}
                      className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft transition-colors"
                    >
                      <TrashIcon className="size-3.5" />
                      {t("bn.delete")}
                    </button>

                    <Button type="submit" size="sm" disabled={busy} className="cursor-pointer">
                      <CheckIcon className="size-3.5" />
                      {t("ve.save")}
                    </Button>
                  </div>
                </fetcher.Form>
              </div>
            );
          })}
        </div>
      )}

      {/* New Banner Card */}
      <details className="rounded-xl border border-border/80 bg-surface shadow-sm overflow-hidden">
        <summary className="cursor-pointer px-4 sm:px-6 py-3.5 text-xs font-bold text-action hover:bg-surface-tint/50 flex items-center gap-1.5">
          <PlusIcon className="size-4" />
          <span>{t("bn.new")}</span>
        </summary>
        <div className="p-4 sm:p-6 border-t border-border/50 bg-surface-tint/10">
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="id" value="" />
            <input type="hidden" name="position" value="99" />
            <input type="hidden" name="is_active" value="on" />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <label className="flex flex-col gap-1 font-bold text-text">
                {t("bn.altAr")}
                <input
                  name="title_ar"
                  required
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 font-bold text-text">
                {t("bn.altEn")}
                <input
                  name="title_en"
                  dir="ltr"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 font-bold text-text sm:col-span-2">
                {t("bn.image")}
                <input
                  name="image_path"
                  required
                  dir="ltr"
                  placeholder="media/banners/example.webp"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 font-bold text-text sm:col-span-2">
                {t("bn.link")}
                <input
                  name="link_url"
                  dir="ltr"
                  placeholder="/ar/catalog/electronics"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 font-bold text-text">
                {t("bn.from")}
                <input
                  name="starts_at"
                  type="date"
                  dir="ltr"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 font-bold text-text">
                {t("bn.to")}
                <input
                  name="ends_at"
                  type="date"
                  dir="ltr"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={busy} className="cursor-pointer">
                {t("cp.create")}
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </details>
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
