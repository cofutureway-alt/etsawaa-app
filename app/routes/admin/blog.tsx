import { data, useFetcher } from "react-router";
import type { Route } from "./+types/blog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer, requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings, publicMediaUrl } from "~/lib/media.shared";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { RichTextEditor } from "~/components/editor/RichTextEditor";


/**
 * A-27 — Blog admin: posts editor (title/slug/content ar-en, SEO, cover,
 * status) + categories. Drafts never public (RLS: read policy = published OR
 * admin); slug conflicts blocked by UNIQUE constraints.
 *
 * Content is written in TinyMCE (images, video embeds, backlinks with rel
 * options, call-to-action buttons) and sanitized again on every public read.
 * `feature_on_sell` puts a published post on the "Sell on Etsawaa" page.
 */

interface PostRow {
  id: string; title_ar: string; title_en: string; slug_ar: string; slug_en: string;
  status: string; published_at: string | null; category_id: string | null;
  excerpt_ar: string; excerpt_en: string; content_ar: string; content_en: string;
  seo_title_ar: string; seo_title_en: string; seo_desc_ar: string; seo_desc_en: string;
  cover_path: string | null; feature_on_sell: boolean;
}
interface CatRow { id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string }

const EMPTY_POST: PostRow = {
  id: "", title_ar: "", title_en: "", slug_ar: "", slug_en: "",
  status: "draft", published_at: null, category_id: null,
  excerpt_ar: "", excerpt_en: "", content_ar: "", content_en: "",
  seo_title_ar: "", seo_title_en: "", seo_desc_ar: "", seo_desc_en: "", cover_path: null,
  feature_on_sell: false,
};

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
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  return {
    lang,
    posts: JSON.parse(JSON.stringify(posts.data ?? [])) as PostRow[],
    cats: JSON.parse(JSON.stringify(cats.data ?? [])) as CatRow[],
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

  if (intent === "cat_add") {
    const nameAr = String(form.get("name_ar") ?? "").trim();
    const nameEn = String(form.get("name_en") ?? "").trim();
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-+|-+$/g, "") || `cat-${Date.now().toString(36)}`;
    const { error } = await client.from("blog_categories").insert({
      name_ar: nameAr, name_en: nameEn, slug_ar: slug(nameAr), slug_en: slug(nameEn),
    });
    if (error) return data({ ok: false, reason: error.code === "23505" ? "dup_slug" : error.message }, { status: 400 });
    return { ok: true as const, intent };
  }

  if (intent === "post_save") {
    const id = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "draft") === "published" ? "published" : "draft";
    // keep the original publish date when an already-published post is edited
    let publishedAt: string | null = null;
    if (status === "published") {
      const prev = id ? await client.from("blog_posts").select("status, published_at").eq("id", id).maybeSingle() : null;
      publishedAt = prev?.data?.status === "published" && prev.data.published_at ? prev.data.published_at : new Date().toISOString();
    }
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
      feature_on_sell: form.get("feature_on_sell") === "on",
      status,
      published_at: publishedAt,
      author: (await getViewer(client))?.viewer?.user.id ?? null,
    };
    if (!payload.title_ar || !payload.slug_ar) return data({ ok: false, reason: "title_required" }, { status: 400 });
    if (!payload.slug_en) payload.slug_en = payload.slug_ar;
    if (status === "published" && !payload.title_en) {
      // missing English body falls back to Arabic (US-13 parity)
      payload.title_en = payload.title_ar;
    }
    const res = id
      ? await client.from("blog_posts").update(payload).eq("id", id).select("id").single()
      : await client.from("blog_posts").insert(payload).select("id").single();
    if (res.error) {
      return data({ ok: false, reason: res.error.code === "23505" ? "dup_slug" : res.error.message }, { status: 400 });
    }
    await client.rpc("fn_audit", {
      p_action: id ? "blog_post.updated" : "blog_post.created", p_entity: "blog_posts", p_entity_id: res.data.id,
      p_before: null, p_after: { status, feature_on_sell: payload.feature_on_sell },
    });
    return { ok: true as const, intent };
  }

  if (intent === "publish") {
    const id = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "draft");
    const { error } = await client.from("blog_posts").update({
      status, published_at: status === "published" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "blog_post.status", p_entity: "blog_posts", p_entity_id: id, p_before: null, p_after: { status } });
    return { ok: true as const, intent };
  }

  if (intent === "feature") {
    const id = String(form.get("id") ?? "");
    const on = String(form.get("on") ?? "") === "1";
    const { error } = await client.from("blog_posts").update({ feature_on_sell: on }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "blog_post.feature_on_sell", p_entity: "blog_posts", p_entity_id: id, p_before: null, p_after: { feature_on_sell: on } });
    return { ok: true as const, intent };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminBlog({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const saver = useFetcher<typeof action>();
  const [edit, setEdit] = useState<PostRow | null>(null);
  const busy = fetcher.state !== "idle";

  // close the editor once the save went through
  useEffect(() => {
    if (saver.state === "idle" && saver.data?.ok) setEdit(null);
  }, [saver.state, saver.data]);

  if (edit) {
    return (
      <PostEditor
        key={edit.id || "new"}
        post={edit}
        cats={loaderData.cats}
        fetcher={saver}
        onClose={() => setEdit(null)}
        media={{ settings: loaderData.media, uid: loaderData.uid, supabaseUrl: loaderData.supabaseUrl }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t("bl.title")}
        count={loaderData.posts.length}
        actions={<Button size="sm" onClick={() => setEdit(EMPTY_POST)}>{t("bl.new")}</Button>}
      />

      {/* categories — quick add */}
      <section className="mt-3" aria-label={t("bl.cats")}>
        <h2 className="text-sm font-extrabold text-text">{t("bl.cats")}</h2>
        <fetcher.Form method="post" className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="intent" value="cat_add" />
          <input name="name_ar" required placeholder={t("pn.nameAr")} className="w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          <input name="name_en" required dir="ltr" placeholder={t("pn.nameEn")} className="w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("cp.create")}</Button>
        </fetcher.Form>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {loaderData.cats.map((c) => (
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
          <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {loaderData.posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
                {p.cover_path ? (
                  <img src={publicMediaUrl(loaderData.supabaseUrl, p.cover_path)} alt="" width={64} height={34}
                    className="h-[34px] w-16 shrink-0 rounded object-cover" />
                ) : (
                  <span aria-hidden="true" className="h-[34px] w-16 shrink-0 rounded bg-surface-tint" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-text">{p.title_ar || p.title_en}</span>
                  <span className="num block truncate text-xs text-text-faint" dir="ltr">{p.slug_ar}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={p.status === "published" ? "success" : "neutral"}>{p.status === "published" ? t("rv.tab_published") : t("bl.draft")}</Badge>
                  {p.feature_on_sell ? <Badge tone="info">{t("bl.onSell")}</Badge> : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>{t("adminVendors.edit")}</Button>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="feature" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="on" value={p.feature_on_sell ? "0" : "1"} />
                    <Button type="submit" size="sm" variant="ghost" disabled={busy}>
                      {p.feature_on_sell ? t("bl.unfeature") : t("bl.feature")}
                    </Button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="publish" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value={p.status === "published" ? "draft" : "published"} />
                    <Button type="submit" size="sm" variant="outline" disabled={busy}>{p.status === "published" ? t("bl.unpublish") : t("rv.publish")}</Button>
                  </fetcher.Form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Full-width editor (not a dialog: TinyMCE opens its own link / media /
 * button dialogs, which a modal focus trap would fight). Arabic and English
 * content sit in tabs; both stay mounted so switching never loses edits.
 */
function PostEditor({ post, cats, fetcher, onClose, media }: {
  post: PostRow;
  cats: CatRow[];
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  onClose: () => void;
  media: { settings: ReturnType<typeof parseMediaSettings>; uid: string; supabaseUrl: string };
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"ar" | "en">("ar");
  const [coverPath, setCoverPath] = useState(post.cover_path ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok ? String(fetcher.data.reason) : null;

  return (
    <>
    <fetcher.Form method="post" className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="post_save" />
      <input type="hidden" name="id" value={post.id} />

      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-alt/95 px-1 py-2.5 backdrop-blur">
        <div className="min-w-0">
          <button type="button" onClick={onClose} className="text-xs font-bold text-action hover:underline">{t("bl.backToPosts")}</button>
          <h1 className="truncate text-lg font-extrabold text-text">{post.id ? (post.title_ar || post.title_en) : t("bl.new")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select name="status" defaultValue={post.status} aria-label={t("wd.status")} className={`${inp} w-auto`}>
            <option value="draft">{t("bl.draft")}</option>
            <option value="published">{t("rv.tab_published")}</option>
          </select>
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? t("common.loading") : t("ve.save")}</Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-bold text-danger">
          {error === "dup_slug" ? t("bl.dupSlug") : error === "title_required" ? t("bl.titleRequired") : error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* main column: language tabs */}
        <div className="flex min-w-0 flex-col gap-3">
          <div role="tablist" aria-label={t("bl.language")} className="flex gap-1 border-b border-border">
            {(["ar", "en"] as const).map((l) => (
              <button key={l} type="button" role="tab" aria-selected={tab === l} onClick={() => setTab(l)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-extrabold ${tab === l ? "border-action text-action" : "border-transparent text-text-muted hover:text-text"}`}>
                {l === "ar" ? t("bl.tabAr") : t("bl.tabEn")}
              </button>
            ))}
          </div>
          {(["ar", "en"] as const).map((l) => (
            <div key={l} role="tabpanel" hidden={tab !== l} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {l === "ar" ? t("bl.titleAr") : t("bl.titleEn")}
                <input name={`title_${l}`} defaultValue={post[`title_${l}`]} required={l === "ar"} dir={l === "ar" ? "rtl" : "ltr"}
                  className={`${inp} text-base font-bold`} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold text-text">
                {l === "ar" ? t("bl.excerptAr") : t("bl.excerptEn")}
                <textarea name={`excerpt_${l}`} defaultValue={post[`excerpt_${l}`]} dir={l === "ar" ? "rtl" : "ltr"} maxLength={400}
                  className={`${inp} min-h-16`} />
              </label>
              <RichTextEditor
                id={`content_${l}_${post.id || "new"}`}
                name={`content_${l}`}
                label={l === "ar" ? t("bl.contentAr") : t("bl.contentEn")}
                hint={t("bl.editorHint")}
                variant="article"
                dir={l === "ar" ? "rtl" : "ltr"}
                defaultValue={post[`content_${l}`]}
              />
              <details className="rounded-md border border-border bg-surface p-3">
                <summary className="cursor-pointer text-sm font-bold text-action">{t("bl.seo")}</summary>
                <div className="mt-2 grid gap-2">
                  <input name={`seo_title_${l}`} defaultValue={post[`seo_title_${l}`]} dir={l === "ar" ? "rtl" : "ltr"}
                    placeholder={l === "ar" ? t("bl.seoTitleAr") : t("bl.seoTitleEn")} className={inp} />
                  <textarea name={`seo_desc_${l}`} defaultValue={post[`seo_desc_${l}`]} dir={l === "ar" ? "rtl" : "ltr"}
                    placeholder={l === "ar" ? t("bl.seoDescAr") : t("bl.seoDescEn")} className={`${inp} min-h-16`} />
                </div>
              </details>
            </div>
          ))}
        </div>

        {/* side column: settings */}
        <aside className="flex flex-col gap-3">
          <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
            <h2 className="text-sm font-extrabold text-text">{t("bl.settings")}</h2>
            <label className="flex flex-col gap-1 text-sm font-bold text-text">
              {t("bl.slugAr")}<input name="slug_ar" defaultValue={post.slug_ar} required dir="auto" className={inp} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-text">
              {t("bl.slugEn")}<input name="slug_en" defaultValue={post.slug_en} dir="ltr" className={inp} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-text">
              {t("bl.cat")}
              <select name="category_id" defaultValue={post.category_id ?? ""} className={inp}>
                <option value="">—</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name_ar} / {c.name_en}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
            <h2 className="text-sm font-extrabold text-text">{t("bl.cover")}</h2>
            {coverPath ? (
              <img src={publicMediaUrl(media.supabaseUrl, coverPath)} alt="" width={600} height={315}
                className="aspect-[600/315] w-full rounded object-cover" />
            ) : (
              <div className="flex aspect-[600/315] w-full items-center justify-center rounded bg-surface-tint text-xs text-text-muted">{t("bl.noCover")}</div>
            )}
            <input type="hidden" name="cover_path" value={coverPath} />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>{t("media.choose")}</Button>
              {coverPath ? <Button type="button" size="sm" variant="ghost" onClick={() => setCoverPath("")}>{t("bl.removeCover")}</Button> : null}
            </div>
          </section>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface p-3">
            <input type="checkbox" name="feature_on_sell" defaultChecked={post.feature_on_sell} className="mt-1 size-4 accent-action" />
            <span>
              <span className="block text-sm font-extrabold text-text">{t("bl.featureOnSell")}</span>
              <span className="block text-xs text-text-muted">{t("bl.featureOnSellHint")}</span>
            </span>
          </label>
        </aside>
      </div>
    </fetcher.Form>
    {/* outside the form: React events bubble through portals */}
    <MediaPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("media.pickImage")}
        settings={media.settings}
        uid={media.uid}
        supabaseUrl={media.supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => { setCoverPath(files[0]?.path ?? ""); setPickerOpen(false); }}
      />
    </>
  );
}

const inp = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text";


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
