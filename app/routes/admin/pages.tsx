import { data, useFetcher } from "react-router";
import type { Route } from "./+types/pages";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui/Overlay";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-33 — Static pages manager: slug ar/en, content ar/en, header visibility,
 * ordering, active toggle. Published page reachable at /p/:slug; unpublished
 * returns 404 (existing static-page route respects is_active).
 */

const inp = "w-full rounded-md border border-border bg-surface p-2.5 text-[13px] text-text";

interface PageRow {
  id: string; slug_ar: string; slug_en: string; title_ar: string; title_en: string;
  content_ar: string; content_en: string; show_in_header: boolean; is_active: boolean;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client.from("static_pages").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return { lang, pages: JSON.parse(JSON.stringify(rows ?? [])) as PageRow[] };
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
    const payload: Record<string, unknown> = {
      title_ar: String(form.get("title_ar") ?? "").trim(),
      title_en: String(form.get("title_en") ?? "").trim(),
      content_ar: String(form.get("content_ar") ?? ""),
      content_en: String(form.get("content_en") ?? ""),
      show_in_header: form.get("show_in_header") === "on",
      is_active: form.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    };
    const slugAr = String(form.get("slug_ar") ?? "").trim();
    const slugEn = String(form.get("slug_en") ?? "").trim();
    if (slugAr) payload.slug_ar = slugAr;
    if (slugEn) payload.slug_en = slugEn;
    if (id) {
      const { error } = await client.from("static_pages").update(payload).eq("id", id);
      if (error) return data({ ok: false, reason: error.code === "23505" ? "dup_slug" : error.message }, { status: 400 });
    } else {
      if (!slugAr || !slugEn || !payload.title_ar) return data({ ok: false, reason: "input" }, { status: 400 });
      const { error } = await client.from("static_pages").insert({ ...payload, slug_ar: slugAr, slug_en: slugEn });
      if (error) return data({ ok: false, reason: error.code === "23505" ? "dup_slug" : error.message }, { status: 400 });
    }
    await client.rpc("fn_audit", { p_action: id ? "page.updated" : "page.created", p_entity: "static_pages", p_entity_id: id || slugAr, p_before: null, p_after: payload });
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminPages({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const [edit, setEdit] = useState<PageRow | null>(null);
  const busy = fetcher.state !== "idle";
  const lang = loaderData.lang;
  const en = i18n.language?.startsWith("en");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">{t("sp.title")}</h1>
        <Button size="sm" onClick={() => setEdit({
          id: "", slug_ar: "", slug_en: "", title_ar: "", title_en: "",
          content_ar: "", content_en: "", show_in_header: false, is_active: true,
        })}>{t("sp.new")}</Button>
      </div>

      <ul className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
        {(loaderData.pages as PageRow[]).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[13px]">
            <span className="font-bold text-text">{en ? p.title_en : p.title_ar}</span>
            <a href={`/${lang}/p/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`} className="num text-xs text-primary hover:underline" dir="ltr">
              /p/{en ? p.slug_en : p.slug_ar}
            </a>
            {p.show_in_header ? <Badge tone="info">{t("sp.inHeader")}</Badge> : null}
            <Badge tone={p.is_active ? "success" : "neutral"}>{p.is_active ? t("cu.active") : t("cu.blocked")}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>{t("adminVendors.edit")}</Button>
          </li>
        ))}
      </ul>

      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={t("sp.editor")}>
        {edit ? (
          <fetcher.Form method="post" className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pe-1">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="id" value={edit.id} />
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("z.nameAr")}<input name="title_ar" defaultValue={edit.title_ar} required className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("z.nameEn")}<input name="title_en" defaultValue={edit.title_en} dir="ltr" className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.slugAr")}<input name="slug_ar" defaultValue={edit.slug_ar} required={edit.id === ""} dir="ltr" className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.slugEn")}<input name="slug_en" defaultValue={edit.slug_en} required={edit.id === ""} dir="ltr" className={inp} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("sp.contentAr")}<textarea name="content_ar" defaultValue={edit.content_ar} className={`${inp} min-h-28`} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("sp.contentEn")}<textarea name="content_en" defaultValue={edit.content_en} dir="ltr" className={`${inp} min-h-28`} />
            </label>
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="show_in_header" defaultChecked={edit.show_in_header} className="size-4 accent-[var(--color-action)]" />
              {t("sp.inHeader")}
            </label>
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="is_active" defaultChecked={edit.is_active} className="size-4 accent-[var(--color-action)]" />
              {t("pn.active")}
            </label>
            {fetcher.data && !fetcher.data.ok ? (
              <p role="alert" className="text-xs font-bold text-danger">
                {fetcher.data.reason === "dup_slug" ? t("bl.dupSlug") : String(fetcher.data.reason)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={busy}>{t("ve.save")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
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
