import { useEffect, useState } from "react";
import type { Route } from "./+types/brand-edit";
import { Link, data, redirect, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { ChevronRightIcon, EyeIcon, UploadIcon, XIcon } from "~/components/ui/icons";
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings, publicMediaUrl } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonForm } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { PageHeader } from "~/components/layout/PageHeader";

/**
 * Brand details — add (/catalog/brands/new) or view & edit (/catalog/brands/:id):
 * names, slugs, descriptions, country of origin, founding year, the
 * categories the brand sells in (drives storefront filters and the seller
 * wizard's brand list), logo, visibility and order. Live preview of the
 * storefront card on the side.
 */

interface Brand {
  id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string; thumb_path: string | null;
  description_ar: string; description_en: string; country_ar: string; country_en: string; founded_year: number | null;
  sort: number; is_active: boolean; created_at: string;
}

const UUID = /^[0-9a-f-]{36}$/i;
const slugEn = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const slugAr = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const isNew = params.id === "new";
  if (!isNew && !UUID.test(params.id ?? "")) throw new Response("Not Found", { status: 404 });

  const [brandRes, links, cats, mediaRow, prods] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : client.from("brands")
      .select("id, name_ar, name_en, slug_ar, slug_en, thumb_path, description_ar, description_en, country_ar, country_en, founded_year, sort, is_active, created_at")
      .eq("id", params.id!).is("deleted_at", null).maybeSingle(),
    isNew ? Promise.resolve({ data: [] }) : client.from("brand_categories").select("category_id").eq("brand_id", params.id!),
    client.from("categories").select("id, parent_id, depth, name_ar, name_en").lte("depth", 2).is("deleted_at", null).order("depth").order("sort"),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
    isNew ? Promise.resolve({ count: 0 }) : client.from("products").select("id", { count: "exact", head: true }).eq("brand_id", params.id!).is("deleted_at", null),
  ]);
  if (!isNew && !brandRes.data) throw new Response("Not Found", { status: 404 });
  return {
    lang, isNew,
    brand: (brandRes.data ?? null) as Brand | null,
    categoryIds: ((links.data ?? []) as Array<{ category_id: string }>).map((l) => l.category_id),
    cats: (cats.data ?? []) as Array<{ id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string }>,
    products: prods.count ?? 0,
    media: parseMediaSettings(mediaRow.data?.value),
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const str = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
  const name_ar = str("name_ar", 80), name_en = str("name_en", 80);
  const year = str("founded_year", 4);
  const patch = {
    name_ar, name_en,
    slug_ar: slugAr(str("slug_ar", 100) || name_ar || name_en),
    slug_en: slugEn(str("slug_en", 100) || name_en),
    description_ar: str("description_ar", 2000), description_en: str("description_en", 2000),
    country_ar: str("country_ar", 60), country_en: str("country_en", 60),
    founded_year: year ? Number(year) : null,
    thumb_path: str("thumb_path", 300) || null,
    sort: Math.max(0, Math.trunc(Number(str("sort", 6))) || 0),
    is_active: form.get("is_active") === "on",
  };
  const errors: Record<string, string> = {};
  if (!name_ar) errors.name_ar = "required";
  if (!name_en) errors.name_en = "required";
  if (!patch.slug_en) errors.slug_en = "required";
  if (patch.founded_year !== null && (!Number.isInteger(patch.founded_year) || patch.founded_year < 1500 || patch.founded_year > new Date().getFullYear())) errors.founded_year = "year";
  const categoryIds = form.getAll("category_ids").map(String).filter((v) => UUID.test(v)).slice(0, 12);
  if (categoryIds.length === 0) errors.category_ids = "required";
  if (Object.keys(errors).length) return data({ ok: false as const, reason: "invalid", errors }, { status: 400 });

  let id = params.id === "new" ? null : String(params.id);
  if (id) {
    const { error } = await client.from("brands").update(patch).eq("id", id);
    if (error) return data({ ok: false as const, reason: /duplicate|unique/i.test(error.message) ? "slug_taken" : error.message, errors: {} }, { status: 400 });
  } else {
    const { data: row, error } = await client.from("brands").insert(patch).select("id").single();
    if (error) return data({ ok: false as const, reason: /duplicate|unique/i.test(error.message) ? "slug_taken" : error.message, errors: {} }, { status: 400 });
    id = row.id as string;
  }
  // category links: add the chosen ones first, then drop the rest — a failure
  // part-way never leaves the brand with no categories
  const { error: insErr } = await client.from("brand_categories")
    .upsert(categoryIds.map((category_id) => ({ brand_id: id, category_id })), { onConflict: "brand_id,category_id", ignoreDuplicates: true });
  if (insErr) return data({ ok: false as const, reason: insErr.message, errors: {} }, { status: 500 });
  const { error: delErr } = await client.from("brand_categories").delete().eq("brand_id", id)
    .not("category_id", "in", `(${categoryIds.join(",")})`);
  if (delErr) return data({ ok: false as const, reason: delErr.message, errors: {} }, { status: 500 });

  if (params.id === "new") throw redirect(`/${lang}/admin/catalog/brands/${id}?created=1`);
  return { ok: true as const };
}

export default function BrandEdit({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { lang, isNew, brand, categoryIds, cats, products, media, uid, supabaseUrl } = loaderData;
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, { success: t("catalog.saved") });
  const busy = fetcher.state !== "idle";
  const errors = (fetcher.data && !fetcher.data.ok ? (fetcher.data as { errors?: Record<string, string> }).errors : undefined) ?? {};
  const slugTaken = fetcher.data && !fetcher.data.ok && (fetcher.data as { reason?: string }).reason === "slug_taken";

  const [nameAr, setNameAr] = useState(brand?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(brand?.name_en ?? "");
  const [descAr, setDescAr] = useState(brand?.description_ar ?? "");
  const [descEn, setDescEn] = useState(brand?.description_en ?? "");
  const [countryAr, setCountryAr] = useState(brand?.country_ar ?? "");
  const [countryEn, setCountryEn] = useState(brand?.country_en ?? "");
  const [year, setYear] = useState(brand?.founded_year ? String(brand.founded_year) : "");
  const [selected, setSelected] = useState<string[]>(categoryIds);
  const [thumb, setThumb] = useState<string | null>(brand?.thumb_path ?? null);
  const [active, setActive] = useState(brand?.is_active ?? true);
  const [picker, setPicker] = useState(false);
  const [created, setCreated] = useState(false);
  useEffect(() => { setCreated(new URLSearchParams(window.location.search).has("created")); }, []);

  const mains = cats.filter((c) => c.depth === 1);
  const options = mains.flatMap((m) => {
    const group = en ? m.name_en : m.name_ar;
    return [
      { value: m.id, label: t("ab.wholeCategory", { name: group }), group },
      ...cats.filter((c) => c.parent_id === m.id).map((c) => ({ value: c.id, label: en ? c.name_en : c.name_ar, group })),
    ];
  });
  const nameOf = new Map(cats.map((c) => [c.id, en ? c.name_en : c.name_ar]));
  const name = (en ? nameEn || nameAr : nameAr || nameEn) || t("catalog.addBrand");
  const country = en ? countryEn || countryAr : countryAr || countryEn;
  const LABEL = "flex flex-col gap-1.5 text-sm font-bold text-text";
  const AREA = "rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal leading-relaxed text-text focus:border-action focus:outline-none";
  const err = (k: string) => (errors[k] ? <span role="alert" className="text-xs font-bold text-danger">{t(`ab.err.${errors[k]}`)}</span> : null);
  const storeSlug = brand ? (en ? brand.slug_en || brand.slug_ar : brand.slug_ar || brand.slug_en) : "";

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("a11y.breadcrumbs")} className="flex items-center gap-1.5 text-xs font-bold text-text-muted">
        <Link to={`/${lang}/admin/catalog/brands`} className="hover:text-action">{t("catalog.brands")}</Link>
        <ChevronRightIcon aria-hidden="true" className="size-3.5 rtl:rotate-180" />
        <span className="text-text">{isNew ? t("catalog.addBrand") : name}</span>
      </nav>
      <PageHeader
        title={isNew ? t("catalog.addBrand") : name}
        subtitle={isNew ? t("ab.newHint") : t("ab.detailsHint", { count: products })}
        actions={!isNew && brand?.is_active && storeSlug ? (
          <a href={`/${lang}/brand/${encodeURIComponent(storeSlug)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-bold text-text hover:border-action hover:text-action">
            <EyeIcon className="size-4" />{t("ab.viewOnSite")}
          </a>
        ) : undefined}
      />
      {created ? <p role="status" className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm font-bold text-success-strong">{t("ab.created")}</p> : null}

      <fetcher.Form method="post" className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {/* identity */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1 sm:p-5">
            <h2 className="text-sm font-extrabold text-text">{t("ab.sec.identity")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><Input label={t("catalog.nameAr")} name="name_ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={80} />{err("name_ar")}</div>
              <div className="flex flex-col gap-1"><Input label={t("catalog.nameEn")} name="name_en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={80} dir="ltr" />{err("name_en")}</div>
              <Input label={t("catalog.slugAr")} name="slug_ar" defaultValue={brand?.slug_ar} placeholder={slugAr(nameAr)} hint={t("ab.slugAuto")} />
              <div className="flex flex-col gap-1">
                <Input label={t("catalog.slugEn")} name="slug_en" defaultValue={brand?.slug_en} placeholder={slugEn(nameEn)} dir="ltr" hint={t("ab.slugAuto")} />
                {slugTaken ? <span role="alert" className="text-xs font-bold text-danger">{t("catalog.slugTaken")}</span> : err("slug_en")}
              </div>
            </div>
          </section>

          {/* about */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1 sm:p-5">
            <h2 className="text-sm font-extrabold text-text">{t("ab.sec.about")}</h2>
            <label className={LABEL}>{t("catalog.brandDescAr")}
              <textarea name="description_ar" value={descAr} onChange={(e) => setDescAr(e.target.value)} maxLength={2000} rows={4} className={AREA} />
            </label>
            <label className={LABEL}>{t("catalog.brandDescEn")}
              <textarea name="description_en" value={descEn} onChange={(e) => setDescEn(e.target.value)} maxLength={2000} rows={4} dir="ltr" className={AREA} />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label={t("ab.countryAr")} name="country_ar" value={countryAr} onChange={(e) => setCountryAr(e.target.value)} maxLength={60} />
              <Input label={t("ab.countryEn")} name="country_en" value={countryEn} onChange={(e) => setCountryEn(e.target.value)} maxLength={60} dir="ltr" />
              <div className="flex flex-col gap-1">
                <Input label={t("ab.founded")} name="founded_year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" dir="ltr" placeholder="1990" />
                {err("founded_year")}
              </div>
            </div>
          </section>

          {/* categories */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1 sm:p-5">
            <div>
              <h2 className="text-sm font-extrabold text-text">{t("ab.sec.categories")}</h2>
              <p className="mt-0.5 text-xs text-text-muted">{t("ab.categoriesHint")}</p>
            </div>
            <SelectMenu multiple id="brand-cats" label={t("ab.col.categories")} options={options} value={selected} onChange={setSelected} searchable
              placeholder={t("ab.pickCategories")} error={errors.category_ids ? t("ab.err.categories") : null} />
            {selected.map((id) => <input key={id} type="hidden" name="category_ids" value={id} />)}
            {selected.length ? (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-surface-tint py-1 pe-1.5 ps-3 text-xs font-bold text-text">
                    {nameOf.get(id) ?? id}
                    <button type="button" aria-label={t("ab.removeCategory", { name: nameOf.get(id) })} onClick={() => setSelected(selected.filter((x) => x !== id))}
                      className="grid size-5 place-items-center rounded-full text-text-muted hover:bg-danger-soft hover:text-danger"><XIcon className="size-3" /></button>
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        {/* side: logo, visibility, preview, save */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
            <h2 className="text-sm font-extrabold text-text">{t("catalog.logo")}</h2>
            <div className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-white p-3">
              {thumb ? <img src={publicMediaUrl(supabaseUrl, thumb)} alt="" width={260} height={173} className="absolute inset-0 size-full p-3 object-contain" />
                : <span className="text-xs text-text-faint">{t("ab.noLogo")}</span>}
            </div>
            <input type="hidden" name="thumb_path" value={thumb ?? ""} />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => setPicker(true)}><UploadIcon className="size-4" />{thumb ? t("ab.changeLogo") : t("media.choose")}</Button>
              {thumb ? <Button type="button" size="sm" variant="ghost" onClick={() => setThumb(null)}>{t("ab.removeLogo")}</Button> : null}
            </div>
            <p className="text-2xs text-text-muted">{t("ab.logoHint")}</p>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
            <label className="flex items-start gap-2.5 text-sm text-text">
              <input type="checkbox" name="is_active" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-action)]" />
              <span><b className="block">{t("ab.visible")}</b><span className="text-xs text-text-muted">{t("ab.visibleHint")}</span></span>
            </label>
            <Input label={t("ab.sort")} name="sort" type="number" min={0} defaultValue={String(brand?.sort ?? 0)} dir="ltr" hint={t("ab.sortHint")} />
          </section>

          {/* storefront preview */}
          <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-tint/40 p-4">
            <p className="text-2xs font-extrabold uppercase tracking-wide text-text-faint">{t("ab.preview")}</p>
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-1">
              <span className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-lg bg-white p-2">
                {thumb ? <img src={publicMediaUrl(supabaseUrl, thumb)} alt="" width={200} height={133} className="absolute inset-0 size-full p-2 object-contain" /> : <span className="text-lg font-black text-action">{name}</span>}
              </span>
              <span className="px-1 text-sm font-extrabold text-text">{name}</span>
              <span className="num px-1 pb-0.5 text-2xs text-text-muted">{[country, year].filter(Boolean).join(" · ") || " "}</span>
            </div>
            <p className="line-clamp-3 text-xs text-text-muted">{en ? descEn || descAr : descAr || descEn}</p>
          </section>

          <Button type="submit" loading={busy} block>{isNew ? t("ab.create") : t("common.save")}</Button>
        </aside>
      </fetcher.Form>

      <MediaPickerDialog open={picker} onClose={() => setPicker(false)} title={t("media.pickImage")} settings={media} uid={uid}
        supabaseUrl={supabaseUrl} mode="single" kinds={["image"]} onConfirm={(files) => setThumb(files[0]?.path ?? null)} />
    </div>
  );
}

export function HydrateFallback() {
  return <SkeletonForm />;
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
