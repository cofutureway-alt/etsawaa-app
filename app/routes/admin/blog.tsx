import { data, useFetcher } from "react-router";
import type { Route } from "./+types/blog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui/Overlay";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-27 — Blog admin: posts editor (title/slug/content ar-en, SEO, cover,
 * status) + categories. Drafts never public (RLS: read policy = published OR
 * admin); slug conflicts blocked by UNIQUE constraints.
 */

interface PostRow {
  id: string; title_ar: string; title_en: string; slug_ar: string; slug_en: string;
  status: string; published_at: string | null; category_id: string | null;
  excerpt_ar: string; excerpt_en: string; content_ar: string; content_en: string;
  seo_title_ar: string; seo_title_en: string; seo_desc_ar: string; seo_desc_en: string;
  cover_path: string | null;
}
interface CatRow { id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [posts, cats] = await Promise.all([
    client.from("blog_posts").select("*").order("created_at", { ascending: false }).limit(100),
    client.from("blog_categories").select("*").order("sort"),
  ]);
  if (posts.error) throw new Error(posts.error.message);
  return {
    lang,
    posts: JSON.parse(JSON.stringify(posts.data ?? [])) as PostRow[],
    cats: JSON.parse(JSON.stringify(cats.data ?? [])) as CatRow[],
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "cat_add") {
    const nameAr = String(form.get("name_ar") ?? "").trim();
    const nameEn = String(form.get("name_en") ?? "").trim();
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-+|-+$/g, "") || `cat-${Date.now().toString(36)}`;
    const { error } = await client.from("blog_categories").insert({
      name_ar: nameAr, name_en: nameEn, slug_ar: slug(nameAr), slug_en: slug(nameEn),
    });
    if (error) return data({ ok: false, reason: error.code === "23505" ? "dup_slug" : error.message }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "post_save") {
    const id = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "draft") === "published" ? "published" : "draft";
    const payload = {
      title_ar: String(form.get("title_ar") ?? "").trim(),
      title_en: String(form.get("title_en") ?? "").trim(),
      slug_ar: String(form.get("slug_ar") ?? "").trim(),
      slug_en: String(form.get("slug_en") ?? "").trim(),
      excerpt_ar: String(form.get("excerpt_ar") ?? ""),
      excerpt_en: String(form.get("excerpt_en") ?? ""),
      content_ar: String(form.get("content_ar") ?? ""),
      content_en: String(form.get("content_en") ?? ""),
      seo_title_ar: String(form.get("seo_title_ar") ?? ""),
      seo_title_en: String(form.get("seo_title_en") ?? ""),
      seo_desc_ar: String(form.get("seo_desc_ar") ?? ""),
      seo_desc_en: String(form.get("seo_desc_en") ?? ""),
      cover_path: String(form.get("cover_path") ?? "") || null,
      category_id: String(form.get("category_id") ?? "") || null,
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
      author: (await client.auth.getUser()).data.user?.id ?? null,
    };
    if (!payload.title_ar || !payload.slug_ar) return data({ ok: false, reason: "title_required" }, { status: 400 });
    if (status === "published" && !payload.title_en) {
      // missing English body falls back to Arabic (US-13 parity)
      payload.title_en = payload.title_ar;
    }
    const res = id
      ? await client.from("blog_posts").update(payload).eq("id", id)
      : await client.from("blog_posts").insert(payload);
    if (res.error) {
      return data({ ok: false, reason: res.error.code === "23505" ? "dup_slug" : res.error.message }, { status: 400 });
    }
    await client.rpc("fn_audit", { p_action: id ? "blog_post.updated" : "blog_post.created", p_entity: "blog_posts", p_entity_id: id || null, p_before: null, p_after: { status } });
    return { ok: true as const };
  }

  if (intent === "publish") {
    const id = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "draft");
    const { error } = await client.from("blog_posts").update({
      status, published_at: status === "published" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "blog_post.status", p_entity: "blog_posts", p_entity_id: id, p_before: null, p_after: { status } });
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminBlog({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const [edit, setEdit] = useState<PostRow | null>(null);
  const busy = fetcher.state !== "idle";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">{t("bl.title")}</h1>
        <Button size="sm" onClick={() => setEdit({
          id: "", title_ar: "", title_en: "", slug_ar: "", slug_en: "",
          status: "draft", published_at: null, category_id: null,
          excerpt_ar: "", excerpt_en: "", content_ar: "", content_en: "",
          seo_title_ar: "", seo_title_en: "", seo_desc_ar: "", seo_desc_en: "", cover_path: null,
        })}>{t("bl.new")}</Button>
      </div>

      {/* categories — quick add */}
      <section className="mt-3" aria-label={t("bl.cats")}>
        <h2 className="text-sm font-extrabold text-text">{t("bl.cats")}</h2>
        <fetcher.Form method="post" className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="intent" value="cat_add" />
          <input name="name_ar" required placeholder={t("pn.nameAr")} className="w-40 rounded-m border border-border bg-surface px-2 py-1.5 text-[13px]" />
          <input name="name_en" required dir="ltr" placeholder={t("pn.nameEn")} className="w-40 rounded-m border border-border bg-surface px-2 py-1.5 text-[13px]" />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("cp.create")}</Button>
        </fetcher.Form>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {(loaderData.cats as CatRow[]).map((c) => (
            <li key={c.id}><Badge tone="neutral">{c.name_ar} / {c.name_en}</Badge></li>
          ))}
        </ul>
      </section>

      {/* posts */}
      <section className="mt-5" aria-label={t("bl.posts")}>
        <h2 className="text-sm font-extrabold text-text">{t("bl.posts")}</h2>
        {loaderData.posts.length === 0 ? (
          <div className="mt-2"><EmptyState title={t("bl.empty")} body={t("bl.emptyHint")} /></div>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-border rounded-m border border-border bg-surface">
            {(loaderData.posts as PostRow[]).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[13px]">
                <span className="font-bold text-text">{p.title_ar || p.title_en}</span>
                <span className="num text-xs text-text-faint" dir="ltr">{p.slug_ar}</span>
                <Badge tone={p.status === "published" ? "success" : "neutral"}>{p.status === "published" ? t("rv.tab_published") : t("bl.draft")}</Badge>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>{t("adminVendors.edit")}</Button>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="publish" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value={p.status === "published" ? "draft" : "published"} />
                    <Button type="submit" size="sm" variant="outline">{p.status === "published" ? t("bl.unpublish") : t("rv.publish")}</Button>
                  </fetcher.Form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* editor dialog — drafts never public; slug conflicts blocked */}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={t("bl.editor")}>
        {edit ? (
          <fetcher.Form method="post" className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pe-1">
            <input type="hidden" name="intent" value="post_save" />
            <input type="hidden" name="id" value={edit.id} />
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.titleAr")}<input name="title_ar" defaultValue={edit.title_ar} required className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.titleEn")}<input name="title_en" defaultValue={edit.title_en} dir="ltr" className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.slugAr")}<input name="slug_ar" defaultValue={edit.slug_ar} required dir="ltr" className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.slugEn")}<input name="slug_en" defaultValue={edit.slug_en} dir="ltr" className={inp} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.cat")}
                <select name="category_id" defaultValue={edit.category_id ?? ""} className={inp}>
                  <option value="">—</option>
                  {(loaderData.cats as CatRow[]).map((c) => (
                    <option key={c.id} value={c.id}>{c.name_ar}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
                {t("bl.cover")}<input name="cover_path" defaultValue={edit.cover_path ?? ""} dir="ltr" placeholder="media/…" className={inp} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("bl.excerptAr")}<textarea name="excerpt_ar" defaultValue={edit.excerpt_ar} className={`${inp} min-h-14`} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("bl.contentAr")}<textarea name="content_ar" defaultValue={edit.content_ar} className={`${inp} min-h-28`} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("bl.contentEn")}<textarea name="content_en" defaultValue={edit.content_en} dir="ltr" className={`${inp} min-h-28`} />
            </label>
            <details>
              <summary className="cursor-pointer text-[13px] font-bold text-primary">{t("bl.seo")}</summary>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <input name="seo_title_ar" defaultValue={edit.seo_title_ar} placeholder={t("bl.seoTitleAr")} className={inp} />
                <input name="seo_title_en" defaultValue={edit.seo_title_en} dir="ltr" placeholder={t("bl.seoTitleEn")} className={inp} />
                <input name="seo_desc_ar" defaultValue={edit.seo_desc_ar} placeholder={t("bl.seoDescAr")} className={inp} />
                <input name="seo_desc_en" defaultValue={edit.seo_desc_en} dir="ltr" placeholder={t("bl.seoDescEn")} className={inp} />
              </div>
            </details>
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("wd.status")}
              <select name="status" defaultValue={edit.status} className={inp}>
                <option value="draft">{t("bl.draft")}</option>
                <option value="published">{t("rv.tab_published")}</option>
              </select>
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

const inp = "w-full rounded-m border border-border bg-surface p-2.5 text-[13px] text-text";


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
