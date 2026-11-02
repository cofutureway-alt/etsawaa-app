import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/attributes";
import { useFetcher, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog } from "~/components/ui/Overlay";
import { useToast } from "~/components/ui/Toast";
import { ChevronRightIcon, PencilIcon, TrashIcon, PlusIcon } from "~/components/ui/icons";
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonTable } from "~/components/ui/Skeleton";


interface LeafCategory { id: string; name_ar: string; name_en: string; depth: number }
interface DefRow {
  id: string; category_id: string; code: string;
  type: "text" | "number" | "bool" | "enum" | "color";
  unit: string; is_required: boolean; is_filterable: boolean; is_variant_axis: boolean;
  sort: number;
}
interface OptionRow {
  id: string; attribute_id: string; code: string;
  label_ar: string; label_en: string; color_hex: string | null; image_path: string | null; sort: number;
}
interface LinkRow { category_id: string; attribute_id: string; sort: number }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const [{ data: cats }, { data: defs }, { data: options }, { data: links }] = await Promise.all([
    client.from("categories").select("id,name_ar,name_en,depth").is("deleted_at", null).order("name_ar"),
    client.from("attribute_defs").select("*").is("deleted_at", null).order("sort"),
    client.from("attribute_options").select("*").is("deleted_at", null).order("sort"),
    client.from("category_attributes").select("category_id,attribute_id,sort"),
  ]);
  const allCats = (cats ?? []) as Array<LeafCategory & { depth: number }>;
  // leaf = no other live category names it as parent
  const { data: allWithParent } = await client.from("categories").select("id,parent_id").is("deleted_at", null);
  const parents = new Set((allWithParent ?? []).map((r: { parent_id: string | null }) => r.parent_id as string));
  const leaves = allCats.filter((c) => !parents.has(c.id));
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  return {
    lang,
    leaves,
    defs: (defs ?? []) as DefRow[],
    options: (options ?? []) as OptionRow[],
    links: (links ?? []) as LinkRow[],
    media: parseMediaSettings(mediaRow?.value),
    uid: viewer.user.id,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false as const, reason: "db" };
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "def_create") {
    const row = {
      category_id: String(form.get("category_id")),
      code: String(form.get("code") ?? "").trim(),
      type: String(form.get("type")),
      unit: String(form.get("unit") ?? "").trim(),
      is_required: form.get("is_required") === "on",
      is_filterable: form.get("is_filterable") === "on",
      is_variant_axis: form.get("is_variant_axis") === "on",
      sort: Number(form.get("sort") ?? 0),
    };
    if (!row.code || !["text", "number", "bool", "enum", "color"].includes(row.type)) return { ok: false as const, reason: "invalid" };
    const { error } = await client.from("attribute_defs").insert(row);
    if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    return { ok: true as const };
  }
  if (intent === "def_update") {
    const id = String(form.get("id"));
    const patch: Record<string, unknown> = {
      unit: String(form.get("unit") ?? "").trim(),
      is_required: form.get("is_required") === "on",
      is_filterable: form.get("is_filterable") === "on",
      is_variant_axis: form.get("is_variant_axis") === "on",
      sort: Number(form.get("sort") ?? 0),
    };
    const type = String(form.get("type"));
    if (["text", "number", "bool", "enum", "color"].includes(type)) patch.type = type;
    const { error } = await client.from("attribute_defs").update(patch).eq("id", id);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  }
  if (intent === "def_delete") {
    const { error } = await client
      .from("attribute_defs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", String(form.get("id")));
    if (error) return { ok: false as const, reason: "error" };
    return { ok: true as const };
  }
  if (intent === "option_create" || intent === "option_update") {
    const hex = String(form.get("color_hex") ?? "").trim();
    const row = {
      attribute_id: String(form.get("attribute_id")),
      code: String(form.get("code") ?? "").trim(),
      label_ar: String(form.get("label_ar") ?? "").trim(),
      label_en: String(form.get("label_en") ?? "").trim(),
      color_hex: /^[0-9a-fA-F]{6}$/.test(hex.replace("#", "")) ? `#${hex.replace("#", "")}` : null,
      image_path: String(form.get("image_path") ?? "").trim() || null,
      sort: Number(form.get("sort") ?? 0),
    };
    if (!row.code || !row.label_ar || !row.label_en) return { ok: false as const, reason: "invalid" };
    if (intent === "option_create") {
      const { error } = await client.from("attribute_options").insert(row);
      if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    } else {
      const { error } = await client.from("attribute_options").update(row).eq("id", String(form.get("id")));
      if (error) return { ok: false as const, reason: error.message };
    }
    return { ok: true as const };
  }
  if (intent === "option_delete") {
    const { error } = await client
      .from("attribute_options")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", String(form.get("id")));
    if (error) return { ok: false as const, reason: "error" };
    return { ok: true as const };
  }
  if (intent === "link") {
    const attributeId = String(form.get("attribute_id"));
    const categoryId = String(form.get("category_id"));
    const { error } = await client.from("category_attributes").upsert({ category_id: categoryId, attribute_id: attributeId, sort: 0 });
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  }
  if (intent === "unlink") {
    const { error } = await client
      .from("category_attributes")
      .delete()
      .eq("attribute_id", String(form.get("attribute_id")))
      .eq("category_id", String(form.get("category_id")));
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  }
  return { ok: false as const, reason: "invalid" };
}

const TYPE_LABELS: Record<DefRow["type"], string> = {
  text: "catalog.typeText", number: "catalog.typeNumber", bool: "catalog.typeBool",
  enum: "catalog.typeEnum", color: "catalog.typeColor",
};

export default function AdminAttributes({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fetcher = useFetcher<typeof action>();
  const [search, setSearch] = useSearchParams();
  const { leaves, defs, options, links, media, uid, supabaseUrl } = loaderData;
  const catId = search.get("cat");
  const selected = useMemo(() => leaves.find((l) => l.id === catId) ?? null, [leaves, catId]);

  const [defDialog, setDefDialog] = useState<{ mode: "create" } | { mode: "edit"; def: DefRow } | null>(null);
  const [optionDialog, setOptionDialog] = useState<{ attributeId: string; option: OptionRow | null } | null>(null);
  const [linkDialog, setLinkDialog] = useState<DefRow | null>(null);
  const [pickerImage, setPickerImage] = useState<{ attributeId: string; option: OptionRow | null; path: string | null } | null>(null);
  const [deletingDef, setDeletingDef] = useState<DefRow | null>(null);
  const [deletingOption, setDeletingOption] = useState<OptionRow | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        toast.showToast("success", t("catalog.saved"));
        setDefDialog(null);
        setOptionDialog(null);
        setDeletingDef(null);
        setDeletingOption(null);
      } else {
        toast.showToast("error", fetcher.data.reason === "duplicate" ? t("catalog.codeTaken") : fetcher.data.reason.includes("not_leaf") ? t("catalog.leafOnly") : t("catalog.saveFailed"));
      }
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  // attributes visible for this leaf: owned + linked
  const visibleDefs = useMemo(() => {
    if (!selected) return [];
    return defs
      .filter((d) => d.category_id === selected.id || links.some((l) => l.attribute_id === d.id && l.category_id === selected.id))
      .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
  }, [defs, links, selected]);

  const optionsFor = (defId: string) => options.filter((o) => o.attribute_id === defId).sort((a, b) => a.sort - b.sort);

  if (!selected) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-extrabold text-text">{t("catalog.attributes")}</h1>
        <p className="text-[13px] text-text-muted">{t("catalog.pickLeaf")}</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {leaves.map((leaf) => (
            <li key={leaf.id}>
              <button
                type="button"
                onClick={() => setSearch({ cat: leaf.id })}
                className="flex w-full cursor-pointer items-center justify-between rounded-m border border-border bg-surface px-3 py-2.5 text-start transition-colors duration-150 hover:bg-surface-tint"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold text-text">{leaf.name_ar}</span>
                  <span className="block truncate text-[12px] text-text-muted">{leaf.name_en}</span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-text-muted mirr" />
              </button>
            </li>
          ))}
        </ul>
        {leaves.length === 0 ? <p className="rounded-l border border-dashed border-border bg-surface py-10 text-center text-[13px] text-text-muted">{t("catalog.noLeaves")}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => setSearch({})} className="cursor-pointer text-[13px] font-bold text-action hover:underline">{t("catalog.allLeaves")}</button>
          <h1 className="text-lg font-extrabold text-text">{selected.name_ar} <span className="text-sm font-normal text-text-muted">/ {selected.name_en}</span></h1>
        </div>
        <Button type="button" onClick={() => setDefDialog({ mode: "create" })}>
          <PlusIcon className="size-4" aria-hidden="true" /> {t("catalog.addAttribute")}
        </Button>
      </div>

      {/* template preview (US-10) */}
      <details className="rounded-l border border-border bg-surface p-3">
        <summary className="cursor-pointer text-[13px] font-extrabold text-text">{t("catalog.preview")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {visibleDefs.map((d) => (
            <div key={d.id} className="flex flex-col gap-1">
              <label className="text-[13px] font-bold text-text">
                {t(TYPE_LABELS[d.type]) === d.code ? d.code : `${d.code}${d.unit ? ` (${d.unit})` : ""}`}
                {d.is_required ? <span className="text-danger" aria-hidden="true"> *</span> : null}
              </label>
              <TemplateField def={d} options={optionsFor(d.id)} />
            </div>
          ))}
          {visibleDefs.length === 0 ? <p className="text-[13px] text-text-muted sm:col-span-2">{t("catalog.noAttributes")}</p> : null}
        </div>
      </details>

      <ul className="flex flex-col gap-2">
        {visibleDefs.map((d) => (
          <li key={d.id} className="rounded-m border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-text">
                {d.code} {d.unit ? <span className="font-normal text-text-muted">({d.unit})</span> : null}
              </span>
              <span className="rounded-full bg-surface-tint px-2 py-0.5 text-[11px] font-bold text-text-muted">{t(TYPE_LABELS[d.type])}</span>
              {d.is_required ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-[11px] font-bold text-text-muted">{t("catalog.required")}</span> : null}
              {d.is_filterable ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-[11px] font-bold text-text-muted">{t("catalog.filterable")}</span> : null}
              {d.is_variant_axis ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-[11px] font-bold text-text-muted">{t("catalog.axis")}</span> : null}
              <button type="button" aria-label={t("common.edit")} onClick={() => setDefDialog({ mode: "edit", def: d })} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-4" /></button>
              <button type="button" aria-label={t("common.delete")} onClick={() => setDeletingDef(d)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-4" /></button>
            </div>
            {(d.type === "enum" || d.type === "color") ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {optionsFor(d.id).map((o) => (
                  <span key={o.id} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] font-bold text-text">
                    {o.color_hex ? <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: o.color_hex }} aria-hidden="true" /> : null}
                    {o.label_ar}
                    <button type="button" aria-label={t("common.edit")} onClick={() => setOptionDialog({ attributeId: d.id, option: o })} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-3" /></button>
                    <button type="button" aria-label={t("common.delete")} onClick={() => setDeletingOption(o)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-3" /></button>
                  </span>
                ))}
                <button type="button" onClick={() => setOptionDialog({ attributeId: d.id, option: null })} className="cursor-pointer rounded-full border border-dashed border-border px-2.5 py-1 text-[12px] font-bold text-text-muted hover:text-action">
                  {t("catalog.addOption")}
                </button>
                <button type="button" onClick={() => setLinkDialog(d)} className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-[12px] font-bold text-action hover:bg-surface-tint">
                  {t("catalog.linkTo", { count: links.filter((l) => l.attribute_id === d.id && l.category_id !== selected.id).length })}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setLinkDialog(d)} className="mt-2 cursor-pointer rounded-full border border-border px-2.5 py-1 text-[12px] font-bold text-action hover:bg-surface-tint">
                {t("catalog.linkTo", { count: links.filter((l) => l.attribute_id === d.id && l.category_id !== selected.id).length })}
              </button>
            )}
          </li>
        ))}
        {visibleDefs.length === 0 ? <li className="rounded-l border border-dashed border-border bg-surface py-10 text-center text-[13px] text-text-muted">{t("catalog.noAttributes")}</li> : null}
      </ul>

      {/* def create/edit dialog */}
      <Dialog open={defDialog !== null} onClose={() => setDefDialog(null)} title={defDialog?.mode === "edit" ? t("catalog.editAttribute") : t("catalog.addAttribute")}>
        {defDialog ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value={defDialog.mode === "edit" ? "def_update" : "def_create"} />
            <input type="hidden" name="category_id" value={defDialog.mode === "edit" ? defDialog.def.category_id : selected.id} />
            {defDialog.mode === "edit" ? <input type="hidden" name="id" value={defDialog.def.id} /> : null}
            <Input label={t("catalog.code")} name="code" defaultValue={defDialog.mode === "edit" ? defDialog.def.code : ""} required pattern="[a-z0-9_]{2,40}" dir="ltr" disabled={defDialog.mode === "edit"} hint={t("catalog.codeHint")} inputClassName="bg-surface disabled:opacity-50" />
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("catalog.type")}
              <select name="type" defaultValue={defDialog.mode === "edit" ? defDialog.def.type : "enum"} className="rounded-m border border-border bg-surface px-2.5 py-2 text-[13px] text-text focus:border-action focus:outline-none">
                <option value="enum">{t("catalog.typeEnum")}</option>
                <option value="color">{t("catalog.typeColor")}</option>
                <option value="bool">{t("catalog.typeBool")}</option>
                <option value="text">{t("catalog.typeText")}</option>
                <option value="number">{t("catalog.typeNumber")}</option>
              </select>
            </label>
            <Input label={t("catalog.unit")} name="unit" defaultValue={defDialog.mode === "edit" ? defDialog.def.unit : ""} maxLength={20} inputClassName="bg-surface" />
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="is_required" defaultChecked={defDialog.mode === "edit" ? defDialog.def.is_required : false} className="size-4 accent-[var(--color-action)]" />
              {t("catalog.required")}
            </label>
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="is_filterable" defaultChecked={defDialog.mode === "edit" ? defDialog.def.is_filterable : false} className="size-4 accent-[var(--color-action)]" />
              {t("catalog.filterable")}
            </label>
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="is_variant_axis" defaultChecked={defDialog.mode === "edit" ? defDialog.def.is_variant_axis : false} className="size-4 accent-[var(--color-action)]" />
              {t("catalog.axis")}
            </label>
            <input type="hidden" name="sort" value={defDialog.mode === "edit" ? defDialog.def.sort : defs.length} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDefDialog(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.save")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      {/* option dialog */}
      <Dialog open={optionDialog !== null} onClose={() => setOptionDialog(null)} title={optionDialog?.option ? t("catalog.editOption") : t("catalog.addOption")}>
        {optionDialog ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value={optionDialog.option ? "option_update" : "option_create"} />
            <input type="hidden" name="attribute_id" value={optionDialog.attributeId} />
            {optionDialog.option ? <input type="hidden" name="id" value={optionDialog.option.id} /> : null}
            <Input label={t("catalog.code")} name="code" defaultValue={optionDialog.option?.code ?? ""} required pattern="[a-z0-9_]{2,40}" dir="ltr" inputClassName="bg-surface" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t("catalog.labelAr")} name="label_ar" defaultValue={optionDialog.option?.label_ar ?? ""} required maxLength={60} inputClassName="bg-surface" />
              <Input label={t("catalog.labelEn")} name="label_en" defaultValue={optionDialog.option?.label_en ?? ""} required maxLength={60} dir="ltr" inputClassName="bg-surface" />
            </div>
            <Input label={t("catalog.colorHex")} name="color_hex" defaultValue={optionDialog.option?.color_hex ?? ""} pattern="#?[0-9a-fA-F]{6}" dir="ltr" placeholder="#RRGGBB" inputClassName="bg-surface" />
            <input type="hidden" name="image_path" value={pickerImage?.path ?? optionDialog.option?.image_path ?? ""} />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPickerImage({ attributeId: optionDialog.attributeId, option: optionDialog.option, path: optionDialog.option?.image_path ?? null })}>
                {t("media.choose")}
              </Button>
              {pickerImage?.path || optionDialog.option?.image_path ? <span className="text-[12px] text-text-muted">{t("catalog.imageSet")}</span> : null}
            </div>
            <input type="hidden" name="sort" value={optionDialog.option?.sort ?? optionsFor(optionDialog.attributeId).length} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOptionDialog(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.save")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      {/* link dialog */}
      <Dialog open={linkDialog !== null} onClose={() => setLinkDialog(null)} title={t("catalog.linkTitle")}>
        {linkDialog ? (
          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pe-1">
            {leaves.filter((l) => l.id !== selected.id).map((leaf) => {
              const linked = links.some((l) => l.attribute_id === linkDialog.id && l.category_id === leaf.id);
              return (
                <fetcher.Form key={leaf.id} method="post" className="flex items-center justify-between gap-2 rounded-m border border-border px-3 py-2">
                  <input type="hidden" name="attribute_id" value={linkDialog.id} />
                  <span className="text-[13px] font-bold text-text">{leaf.name_ar} <span className="font-normal text-text-muted">/ {leaf.name_en}</span></span>
                  {linked ? (
                    <>
                      <span className="rounded-full bg-surface-tint px-2 py-0.5 text-[11px] font-bold text-text-muted">{t("catalog.linked")}</span>
                      <input type="hidden" name="category_id" value={leaf.id} />
                      <button type="submit" name="intent" value="unlink" className="cursor-pointer text-[12px] font-bold text-danger hover:underline">{t("catalog.unlink")}</button>
                    </>
                  ) : (
                    <button type="submit" name="intent" value="link" className="cursor-pointer text-[12px] font-bold text-action hover:underline">{t("catalog.link")}</button>
                  )}
                </fetcher.Form>
              );
            })}
            {leaves.length <= 1 ? <p className="py-6 text-center text-[13px] text-text-muted">{t("catalog.noLeaves")}</p> : null}
          </div>
        ) : null}
      </Dialog>

      {/* delete confirms */}
      <Dialog open={deletingDef !== null} onClose={() => setDeletingDef(null)} title={t("common.confirm")}>
        {deletingDef ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="def_delete" />
            <input type="hidden" name="id" value={deletingDef.id} />
            <p className="text-[13px] text-text">{t("catalog.deleteDefConfirm", { code: deletingDef.code })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingDef(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
      <Dialog open={deletingOption !== null} onClose={() => setDeletingOption(null)} title={t("common.confirm")}>
        {deletingOption ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="option_delete" />
            <input type="hidden" name="id" value={deletingOption.id} />
            <p className="text-[13px] text-text">{t("catalog.deleteOptionConfirm", { label: deletingOption.label_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingOption(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <MediaPickerDialog
        open={pickerImage !== null}
        onClose={() => setPickerImage(null)}
        title={t("media.pickImage")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => setPickerImage((cur) => (cur ? { ...cur, path: files[0]?.path ?? cur.path } : cur))}
      />
    </div>
  );
}

function TemplateField({ def, options }: { def: DefRow; options: OptionRow[] }) {
  const base = "rounded-m border border-border bg-surface px-2.5 py-2 text-[13px] text-text focus:border-action focus:outline-none";
  if (def.type === "enum") {
    return <select className={base} disabled><option value="">{options.map((o) => o.label_ar).join(" · ") || "—"}</option></select>;
  }
  if (def.type === "color") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <span key={o.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[12px] text-text">
            <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: o.color_hex ?? "#ffffff" }} aria-hidden="true" />
            {o.label_ar}
          </span>
        ))}
        {options.length === 0 ? <span className="text-[12px] text-text-faint">—</span> : null}
      </div>
    );
  }
  if (def.type === "bool") return <input type="checkbox" disabled className="size-4 accent-[var(--color-action)]" />;
  if (def.type === "number") return <input type="number" disabled className={base} />;
  return <input type="text" disabled className={base} />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
