import { data, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/size-types";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button, Dialog, EmptyState, Input } from "~/components/ui";
import { PlusIcon, TrashIcon, XIcon } from "~/components/ui/icons";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * Admin → Catalog → Size types. Sizes are grouped into types (clothing,
 * shoes, bedding…); a type is offered to sellers only in the categories it is
 * assigned to and everything under them (fn_size_options_for). Sizes are
 * options of the global "size" attribute.
 */

interface TypeRow { id: string; code: string; name_ar: string; name_en: string; sort: number }
interface SizeRow { id: string; code: string; label_ar: string; label_en: string; size_type_id: string | null; sort: number }
interface CatRow { id: string; name_ar: string; name_en: string; depth: number; parent_id: string | null }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: sizeAttr } = await client.from("attribute_defs").select("id").eq("code", "size").is("deleted_at", null).maybeSingle();
  const [types, sizes, links, cats] = await Promise.all([
    client.from("size_types").select("*").order("sort"),
    sizeAttr
      ? client.from("attribute_options").select("id, code, label_ar, label_en, size_type_id, sort").eq("attribute_id", sizeAttr.id).is("deleted_at", null).order("sort")
      : Promise.resolve({ data: [] }),
    client.from("size_type_categories").select("size_type_id, category_id"),
    client.from("categories").select("id, name_ar, name_en, depth, parent_id").lte("depth", 3).is("deleted_at", null).order("depth").order("name_ar"),
  ]);
  return {
    lang,
    sizeAttrId: (sizeAttr?.id as string | undefined) ?? null,
    types: (types.data ?? []) as TypeRow[],
    sizes: (sizes.data ?? []) as SizeRow[],
    links: (links.data ?? []) as Array<{ size_type_id: string; category_id: string }>,
    categories: (cats.data ?? []) as CatRow[],
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const fail = (reason: string) => data({ ok: false, reason }, { status: 400 });

  if (intent === "type_save") {
    const payload = { name_ar: str("name_ar"), name_en: str("name_en"), sort: Math.trunc(Number(form.get("sort") ?? 0)) || 0 };
    if (!payload.name_ar || !payload.name_en) return fail("name_required");
    const id = str("id");
    const { error } = id
      ? await client.from("size_types").update(payload).eq("id", id)
      : await client.from("size_types").insert({ ...payload, code: slug(payload.name_en) || `type_${Date.now().toString(36)}` });
    return error ? fail(error.message.includes("duplicate") ? "duplicate" : error.message) : { ok: true as const };
  }
  if (intent === "type_delete") {
    const { error } = await client.from("size_types").delete().eq("id", str("id"));
    return error ? fail(error.message) : { ok: true as const };
  }
  if (intent === "size_add") {
    const attributeId = str("attribute_id");
    const labelAr = str("label_ar"), labelEn = str("label_en");
    if (!labelAr || !labelEn) return fail("name_required");
    const { count } = await client.from("attribute_options").select("id", { count: "exact", head: true }).eq("attribute_id", attributeId);
    const { error } = await client.from("attribute_options").insert({
      attribute_id: attributeId, size_type_id: str("size_type_id"),
      label_ar: labelAr, label_en: labelEn, code: `size_${slug(labelEn) || Date.now().toString(36)}`, sort: (count ?? 0) + 1,
    });
    return error ? fail(error.message.includes("duplicate") ? "duplicate" : error.message) : { ok: true as const };
  }
  if (intent === "size_remove") {
    // soft delete: sizes already used by products keep working on old orders
    const { error } = await client.from("attribute_options").update({ deleted_at: new Date().toISOString() }).eq("id", str("id"));
    return error ? fail(error.message) : { ok: true as const };
  }
  if (intent === "cat_add" || intent === "cat_remove") {
    const row = { size_type_id: str("size_type_id"), category_id: str("category_id") };
    const { error } = intent === "cat_add"
      ? await client.from("size_type_categories").upsert(row, { onConflict: "size_type_id,category_id" })
      : await client.from("size_type_categories").delete().eq("size_type_id", row.size_type_id).eq("category_id", row.category_id);
    return error ? fail(error.message) : { ok: true as const };
  }
  return fail("bad_intent");
}

export default function AdminSizeTypes({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const { types, sizes, links, categories, sizeAttrId } = loaderData;
  const [editing, setEditing] = useState<TypeRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<TypeRow | null>(null);
  const current = editing && editing !== "new" ? editing : null;
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) { setEditing(null); setDeleting(null); } }, [fetcher.state, fetcher.data]);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const catName = (c: CatRow) => (en ? c.name_en : c.name_ar);
  const catPath = (c: CatRow) => {
    const parts = [catName(c)];
    let p = c.parent_id ? byId.get(c.parent_id) : undefined;
    while (p) { parts.unshift(catName(p)); p = p.parent_id ? byId.get(p.parent_id) : undefined; }
    return parts.join(" › ");
  };
  const post = (fields: Record<string, string>) => fetcher.submit(fields, { method: "post" });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("sizeTypes.title")} subtitle={t("sizeTypes.subtitle")} count={types.length}
        actions={<Button size="sm" onClick={() => setEditing("new")}><PlusIcon className="size-4" />{t("sizeTypes.new")}</Button>} />

      {types.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 shadow-1"><EmptyState title={t("sizeTypes.empty")} body={t("sizeTypes.emptyHint")} /></div>
      ) : (
        <ul className="flex flex-col gap-4">
          {types.map((type) => {
            const typeSizes = sizes.filter((s) => s.size_type_id === type.id);
            const assigned = links.filter((l) => l.size_type_id === type.id).map((l) => byId.get(l.category_id)).filter((c): c is CatRow => Boolean(c));
            return (
              <li key={type.id} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-1 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-extrabold text-text">{en ? type.name_en : type.name_ar}</h2>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(type)}>{t("sizeTypes.rename")}</Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(type)}><TrashIcon className="size-4" /></Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <section>
                    <h3 className="mb-2 text-xs font-bold text-text-muted">{t("sizeTypes.sizes", { count: typeSizes.length })}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {typeSizes.map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-tint/40 py-1 ps-2.5 pe-1 text-xs font-bold text-text">
                          {en ? s.label_en : s.label_ar}
                          <button type="button" aria-label={t("common.remove")} disabled={busy} onClick={() => post({ intent: "size_remove", id: s.id })}
                            className="flex size-5 cursor-pointer items-center justify-center rounded text-text-muted hover:bg-danger-soft hover:text-danger"><XIcon className="size-3" /></button>
                        </span>
                      ))}
                    </div>
                    {sizeAttrId ? (
                      <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => setTimeout(() => (e.target as HTMLFormElement).reset(), 0)}>
                        <input type="hidden" name="intent" value="size_add" />
                        <input type="hidden" name="attribute_id" value={sizeAttrId} />
                        <input type="hidden" name="size_type_id" value={type.id} />
                        <input name="label_ar" required placeholder={t("sizeTypes.sizeAr")} aria-label={t("sizeTypes.sizeAr")} className="w-28 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm" />
                        <input name="label_en" required placeholder={t("sizeTypes.sizeEn")} aria-label={t("sizeTypes.sizeEn")} dir="ltr" className="w-28 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm" />
                        <Button type="submit" size="sm" variant="outline" disabled={busy}><PlusIcon className="size-4" />{t("sizeTypes.addSize")}</Button>
                      </fetcher.Form>
                    ) : null}
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-bold text-text-muted">{t("sizeTypes.categories", { count: assigned.length })}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {assigned.length === 0 ? <p className="text-xs text-warning-strong">{t("sizeTypes.noCategories")}</p> : null}
                      {assigned.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-surface-tint py-1 ps-3 pe-1 text-xs font-bold text-text" title={catPath(c)}>
                          {catName(c)}
                          <button type="button" aria-label={t("common.remove")} disabled={busy} onClick={() => post({ intent: "cat_remove", size_type_id: type.id, category_id: c.id })}
                            className="flex size-5 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-danger-soft hover:text-danger"><XIcon className="size-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 max-w-md">
                      <SelectMenu
                        label={t("sizeTypes.assign")}
                        searchable
                        options={categories.filter((c) => !assigned.some((a) => a.id === c.id)).map((c) => ({ value: c.id, label: catPath(c) }))}
                        value={null}
                        placeholder={t("sizeTypes.assignPlaceholder")}
                        onChange={(id) => { if (id) post({ intent: "cat_add", size_type_id: type.id, category_id: id }); }}
                      />
                      <p className="mt-1 text-2xs text-text-muted">{t("sizeTypes.assignHint")}</p>
                    </div>
                  </section>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? t("sizeTypes.rename") : t("sizeTypes.new")}>
        <fetcher.Form method="post" key={current?.id ?? "new"} className="flex flex-col gap-3 p-1">
          <input type="hidden" name="intent" value="type_save" />
          <input type="hidden" name="id" value={current?.id ?? ""} />
          <Input id="st-ar" name="name_ar" required label={t("pn.nameAr")} defaultValue={current?.name_ar} />
          <Input id="st-en" name="name_en" required dir="ltr" label={t("pn.nameEn")} defaultValue={current?.name_en} />
          <Input id="st-sort" name="sort" type="number" dir="ltr" label={t("lv.order")} defaultValue={current?.sort ?? (types.length + 1) * 10} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy}>{t("ve.save")}</Button>
          </div>
        </fetcher.Form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("sizeTypes.delete")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value="type_delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">{t("sizeTypes.deleteConfirm", { name: en ? deleting.name_en : deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className="bg-danger hover:bg-danger">{t("sizeTypes.delete")}</Button>
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
