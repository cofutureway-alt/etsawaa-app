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
import { getSupabaseBrowserClient } from "~/lib/supabase/browser";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";


interface LeafCategory { id: string; name_ar: string; name_en: string; depth: number }

/** Derive the machine code from the English label; the admin can still edit it. */
export function slugifyCode(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
interface DefRow {
  id: string; category_id: string; code: string;
  label_ar: string; label_en: string;
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
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false as const, reason: "db" };
  // Writes are is_admin()-gated in RLS, but the loader-only guard meant a
  // non-admin POST surfaced a raw DB error instead of a 403.
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "def_create") {
    const labelAr = String(form.get("label_ar") ?? "").trim();
    const labelEn = String(form.get("label_en") ?? "").trim();
    // The columns existed since phase 02 and the storefront view already reads
    // them via COALESCE(label_ar, code) — this action simply never wrote them,
    // so every attribute surfaced to the vendor/store as a raw English code.
    const row = {
      category_id: String(form.get("category_id")),
      code: String(form.get("code") ?? "").trim() || slugifyCode(labelEn),
      label_ar: labelAr,
      label_en: labelEn,
      type: String(form.get("type")),
      unit: String(form.get("unit") ?? "").trim(),
      is_required: form.get("is_required") === "on",
      is_filterable: form.get("is_filterable") === "on",
      is_variant_axis: form.get("is_variant_axis") === "on",
      sort: Number(form.get("sort") ?? 0),
    };
    if (!row.code || !labelAr || !labelEn) return { ok: false as const, reason: "labels_required" };
    if (!["text", "number", "bool", "enum", "color"].includes(row.type)) return { ok: false as const, reason: "invalid" };
    const { error } = await client.from("attribute_defs").insert(row);
    if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    return { ok: true as const };
  }
  if (intent === "def_update") {
    const id = String(form.get("id"));
    const patch: Record<string, unknown> = {
      label_ar: String(form.get("label_ar") ?? "").trim(),
      label_en: String(form.get("label_en") ?? "").trim(),
      unit: String(form.get("unit") ?? "").trim(),
      is_required: form.get("is_required") === "on",
      is_filterable: form.get("is_filterable") === "on",
      is_variant_axis: form.get("is_variant_axis") === "on",
      sort: Number(form.get("sort") ?? 0),
    };
    if (!patch.label_ar || !patch.label_en) return { ok: false as const, reason: "labels_required" };
    const type = String(form.get("type"));
    if (["text", "number", "bool", "enum", "color"].includes(type)) patch.type = type;
    // Changing the code would orphan product_attribute_values rows (they key on
    // the attribute id, but vendors and filter URLs use the code) — keep it
    // unless the form explicitly supplies one.
    const newCode = String(form.get("code") ?? "").trim();
    if (newCode) patch.code = newCode;
    const { data: touched, error } = await client.from("attribute_defs").update(patch).eq("id", id).select("id");
    if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    // 0 rows = RLS filtered it (e.g. staff, not admin) or the id is stale.
    if (!touched || touched.length === 0) return { ok: false as const, reason: "no_rows" };
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
      const { data: touchedOpt, error } = await client.from("attribute_options").update(row).eq("id", String(form.get("id"))).select("id");
      if (error) return { ok: false as const, reason: error.message };
      if (!touchedOpt || touchedOpt.length === 0) return { ok: false as const, reason: "no_rows" };
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

/** The five attribute types as pickable cards (a <select> hid what they mean). */
const TYPE_CARDS: Array<{ value: DefRow["type"]; titleKey: string; hintKey: string }> = [
  { value: "enum", titleKey: "catalog.typeEnum", hintKey: "catalog.typeEnumHint" },
  { value: "color", titleKey: "catalog.typeColor", hintKey: "catalog.typeColorHint" },
  { value: "bool", titleKey: "catalog.typeBool", hintKey: "catalog.typeBoolHint" },
  { value: "text", titleKey: "catalog.typeText", hintKey: "catalog.typeTextHint" },
  { value: "number", titleKey: "catalog.typeNumber", hintKey: "catalog.typeNumberHint" },
];

/**
 * Create/edit form for one attribute. Split into four visual blocks so the
 * admin knows what each field does: naming, type, behaviour, live preview.
 * The code is derived from the English label and kept in an "advanced" fold —
 * it is a machine key (product_attribute_values, filter URLs), not user copy.
 */
function AttributeForm({
  mode, def, defs, busy, onCancel,
}: {
  mode: "create" | "edit";
  def: DefRow | null;
  defs: DefRow[];
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [labelAr, setLabelAr] = useState(def?.label_ar ?? "");
  const [labelEn, setLabelEn] = useState(def?.label_en ?? "");
  const [type, setType] = useState<DefRow["type"]>(def?.type ?? "enum");
  const [code, setCode] = useState(def?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(mode === "edit");

  // Axis attributes must be enum/color/bool (DB constraint attribute_defs_axis_type),
  // so free text/number hides the axis checkbox instead of failing on save.
  const axisAllowed = type !== "text" && type !== "number";
  const derivedCode = codeTouched ? code : slugifyCode(labelEn);
  const canSave = labelAr.trim().length > 0 && labelEn.trim().length > 0 && derivedCode.length >= 2;

  return (
    <>
      {/* 1 — naming */}
      <section className="flex flex-col gap-2">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockNaming")}</p>
        <label className="flex flex-col gap-1 text-sm font-bold text-text">
          {t("catalog.labelAr")}
          <input
            name="label_ar"
            value={labelAr}
            onChange={(e) => setLabelAr(e.target.value)}
            placeholder={t("catalog.labelArPlaceholder")}
            required
            maxLength={60}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-action focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text">
          {t("catalog.labelEn")}
          <input
            name="label_en"
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            placeholder={t("catalog.labelEnPlaceholder")}
            required
            maxLength={60}
            dir="ltr"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-action focus:outline-none"
          />
        </label>
        <details className="rounded-md border border-border/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-bold text-text-muted">{t("catalog.advanced")}</summary>
          <label className="mt-2 flex flex-col gap-1 text-xs font-bold text-text">
            {t("catalog.code")}
            <input
              name="code"
              value={derivedCode}
              onChange={(e) => { setCodeTouched(true); setCode(e.target.value); }}
              pattern="[a-z0-9_]{2,40}"
              dir="ltr"
              readOnly={mode === "edit"}
              className={`rounded-md border border-border px-3 py-2 font-mono text-xs ${mode === "edit" ? "bg-surface-alt text-text-muted" : "bg-surface text-text"}`}
            />
            <span className="font-normal text-text-muted">{t("catalog.codeHint")}</span>
          </label>
        </details>
      </section>

      {/* 2 — type as cards */}
      <section className="mt-4 flex flex-col gap-2">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockType")}</p>
        <div role="radiogroup" aria-label={t("catalog.type")} className="grid grid-cols-2 gap-2">
          {TYPE_CARDS.map((card) => (
            <label
              key={card.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-start transition-colors ${
                type === card.value
                  ? "border-action bg-surface-tint"
                  : "border-border bg-surface hover:bg-surface-alt"
              }`}
            >
              <input
                type="radio"
                name="type"
                value={card.value}
                checked={type === card.value}
                onChange={() => setType(card.value)}
                className="sr-only"
              />
              <span className="text-sm font-extrabold text-text">{t(card.titleKey)}</span>
              <span className="text-2xs leading-snug text-text-muted">{t(card.hintKey)}</span>
            </label>
          ))}
        </div>
        {type === "number" ? (
          <Input label={t("catalog.unit")} name="unit" defaultValue={def?.unit ?? ""} maxLength={20} placeholder={t("catalog.unitPlaceholder")} inputClassName="bg-surface" />
        ) : null}
      </section>

      {/* 3 — behaviour */}
      <section className="mt-4 flex flex-col gap-2">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockBehaviour")}</p>
        <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
          <input type="checkbox" name="is_required" defaultChecked={def?.is_required ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
          <span>
            {t("catalog.required")}
            <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.requiredHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
          <input type="checkbox" name="is_filterable" defaultChecked={def?.is_filterable ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
          <span>
            {t("catalog.filterable")}
            <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.filterableHint")}</span>
          </span>
        </label>
        {axisAllowed ? (
          <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
            <input type="checkbox" name="is_variant_axis" defaultChecked={def?.is_variant_axis ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
            <span>
              {t("catalog.axis")}
              <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.axisHint")}</span>
            </span>
          </label>
        ) : (
          <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-2xs leading-snug text-text-muted">
            {t("catalog.axisNotAllowed")}
          </p>
        )}
      </section>

      {/* 4 — live preview */}
      <section className="mt-4 rounded-md border border-border bg-surface-alt p-3">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockPreview")}</p>
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-sm font-bold text-text">
            {labelAr || t("catalog.labelAr")}
            <span className="text-danger" aria-hidden="true"> *</span>
          </span>
          <span className="text-2xs text-text-muted">
            {type === "enum" || type === "color" ? t("catalog.previewPick") : type === "bool" ? t("catalog.typeBool") : type === "number" ? `0 ${def?.unit || ""}`.trim() : "…"}
          </span>
        </div>
      </section>

      <input type="hidden" name="sort" value={def?.sort ?? defs.length} />
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" loading={busy} disabled={!canSave}>{t("common.save")}</Button>
      </div>
    </>
  );
}

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
  const [usage, setUsage] = useState<Array<{ ref_type: string; ref_label: string }> | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [deletingOption, setDeletingOption] = useState<OptionRow | null>(null);
  const busy = fetcher.state !== "idle";

  // Ask the DB what still uses this attribute before offering to archive it.
  useEffect(() => {
    if (!deletingDef) { setUsage(null); return; }
    let cancelled = false;
    setUsageLoading(true);
    void (async () => {
      // RLS + is_admin() guard the RPC server-side either way.
      const db = getSupabaseBrowserClient();
      if (!db) { setUsage([]); setUsageLoading(false); return; }
      const { data } = await db.rpc("fn_attribute_usage", { p_attribute_id: deletingDef.id });
      if (cancelled) return;
      setUsage((data as Array<{ ref_type: string; ref_label: string }> | null) ?? []);
      setUsageLoading(false);
    })();
    return () => { cancelled = true; };
  }, [deletingDef]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        toast.showToast("success", t("catalog.saved"));
        setDefDialog(null);
        setOptionDialog(null);
        setDeletingDef(null);
        setDeletingOption(null);
      } else {
        const reason = fetcher.data.reason;
        toast.showToast(
          "error",
          reason === "duplicate" ? t("catalog.codeTaken")
            : reason === "labels_required" ? t("catalog.labelsRequired")
            : reason === "no_rows" ? t("catalog.noRows")
            : reason.includes("not_leaf") ? t("catalog.leafOnly")
            : t("catalog.saveFailed"),
        );
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
        <p className="text-sm text-text-muted">{t("catalog.pickLeaf")}</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {leaves.map((leaf) => {
            // showing the count tells the admin which leaves are still empty
            const count = defs.filter(
              (d) => d.category_id === leaf.id || links.some((l) => l.attribute_id === d.id && l.category_id === leaf.id),
            ).length;
            return (
              <li key={leaf.id}>
                <button
                  type="button"
                  onClick={() => setSearch({ cat: leaf.id })}
                  className="flex w-full cursor-pointer items-center justify-between rounded-md border border-border bg-surface px-3 py-2.5 text-start transition-colors duration-150 hover:bg-surface-tint"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-text">{leaf.name_ar}</span>
                    <span className="block truncate text-xs text-text-muted">{leaf.name_en}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-2xs font-bold ${count > 0 ? "bg-surface-tint text-action" : "bg-surface-alt text-text-faint"}`}>
                      {count > 0 ? t("catalog.attrCount", { count }) : t("catalog.attrNone")}
                    </span>
                    <ChevronRightIcon className="size-4 text-text-muted mirr" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {leaves.length === 0 ? <p className="rounded-lg border border-dashed border-border bg-surface py-10 text-center text-sm text-text-muted">{t("catalog.noLeaves")}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => setSearch({})} className="cursor-pointer text-sm font-bold text-action hover:underline">{t("catalog.allLeaves")}</button>
          <h1 className="text-lg font-extrabold text-text">{selected.name_ar} <span className="text-sm font-normal text-text-muted">/ {selected.name_en}</span></h1>
        </div>
        <Button type="button" onClick={() => setDefDialog({ mode: "create" })}>
          <PlusIcon className="size-4" aria-hidden="true" /> {t("catalog.addAttribute")}
        </Button>
      </div>

      {/* template preview (US-10) */}
      <details className="rounded-lg border border-border bg-surface p-3">
        <summary className="cursor-pointer text-sm font-extrabold text-text">{t("catalog.preview")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {visibleDefs.map((d) => (
            <div key={d.id} className="flex flex-col gap-1">
              <label className="text-sm font-bold text-text">
                {d.label_ar || d.code}{d.unit ? ` (${d.unit})` : ""}
                {d.is_required ? <span className="text-danger" aria-hidden="true"> *</span> : null}
              </label>
              <TemplateField def={d} options={optionsFor(d.id)} />
            </div>
          ))}
          {visibleDefs.length === 0 ? <p className="text-sm text-text-muted sm:col-span-2">{t("catalog.noAttributes")}</p> : null}
        </div>
      </details>

      <ul className="flex flex-col gap-2">
        {visibleDefs.map((d) => (
          <li key={d.id} className="rounded-md border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-text">
                {d.label_ar || d.code}
                <span className="ms-2 font-mono text-2xs font-normal text-text-faint" dir="ltr">{d.code}</span>
                {d.unit ? <span className="font-normal text-text-muted"> ({d.unit})</span> : null}
              </span>
              <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t(TYPE_LABELS[d.type])}</span>
              {d.is_required ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.required")}</span> : null}
              {d.is_filterable ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.filterable")}</span> : null}
              {d.is_variant_axis ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.axis")}</span> : null}
              <button type="button" aria-label={t("common.edit")} onClick={() => setDefDialog({ mode: "edit", def: d })} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-4" /></button>
              <button type="button" aria-label={t("common.delete")} onClick={() => setDeletingDef(d)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-4" /></button>
            </div>
            {(d.type === "enum" || d.type === "color") ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {optionsFor(d.id).map((o) => (
                  <span key={o.id} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-bold text-text">
                    {o.color_hex ? <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: o.color_hex }} aria-hidden="true" /> : null}
                    {o.label_ar}
                    <button type="button" aria-label={t("common.edit")} onClick={() => setOptionDialog({ attributeId: d.id, option: o })} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-3" /></button>
                    <button type="button" aria-label={t("common.delete")} onClick={() => setDeletingOption(o)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-3" /></button>
                  </span>
                ))}
                <button type="button" onClick={() => setOptionDialog({ attributeId: d.id, option: null })} className="cursor-pointer rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-bold text-text-muted hover:text-action">
                  {t("catalog.addOption")}
                </button>
                <button type="button" onClick={() => setLinkDialog(d)} className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-xs font-bold text-action hover:bg-surface-tint">
                  {t("catalog.linkTo", { count: links.filter((l) => l.attribute_id === d.id && l.category_id !== selected.id).length })}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setLinkDialog(d)} className="mt-2 cursor-pointer rounded-full border border-border px-2.5 py-1 text-xs font-bold text-action hover:bg-surface-tint">
                {t("catalog.linkTo", { count: links.filter((l) => l.attribute_id === d.id && l.category_id !== selected.id).length })}
              </button>
            )}
          </li>
        ))}
        {visibleDefs.length === 0 ? <li className="rounded-lg border border-dashed border-border bg-surface py-10 text-center text-sm text-text-muted">{t("catalog.noAttributes")}</li> : null}
      </ul>

      {/* def create/edit dialog */}
      <Dialog open={defDialog !== null} onClose={() => setDefDialog(null)} title={defDialog?.mode === "edit" ? t("catalog.editAttribute") : t("catalog.addAttribute")}>
        {defDialog ? (
          <fetcher.Form method="post" className="flex flex-col">
            <input type="hidden" name="intent" value={defDialog.mode === "edit" ? "def_update" : "def_create"} />
            <input type="hidden" name="category_id" value={defDialog.mode === "edit" ? defDialog.def.category_id : selected.id} />
            {defDialog.mode === "edit" ? <input type="hidden" name="id" value={defDialog.def.id} /> : null}
            <AttributeForm
              key={defDialog.mode === "edit" ? defDialog.def.id : "new"}
              mode={defDialog.mode}
              def={defDialog.mode === "edit" ? defDialog.def : null}
              defs={defs}
              busy={busy}
              onCancel={() => setDefDialog(null)}
            />
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
              {pickerImage?.path || optionDialog.option?.image_path ? <span className="text-xs text-text-muted">{t("catalog.imageSet")}</span> : null}
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
                <fetcher.Form key={leaf.id} method="post" className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <input type="hidden" name="attribute_id" value={linkDialog.id} />
                  <input type="hidden" name="category_id" value={leaf.id} />
                  <span className="text-sm font-bold text-text">{leaf.name_ar} <span className="font-normal text-text-muted">/ {leaf.name_en}</span></span>
                  {linked ? (
                    <>
                      <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.linked")}</span>
                      <button type="submit" name="intent" value="unlink" className="cursor-pointer text-xs font-bold text-danger hover:underline">{t("catalog.unlink")}</button>
                    </>
                  ) : (
                    <button type="submit" name="intent" value="link" className="cursor-pointer text-xs font-bold text-action hover:underline">{t("catalog.link")}</button>
                  )}
                </fetcher.Form>
              );
            })}
            {leaves.length <= 1 ? <p className="py-6 text-center text-sm text-text-muted">{t("catalog.noLeaves")}</p> : null}
          </div>
        ) : null}
      </Dialog>

      {/* delete confirms */}
      <Dialog open={deletingDef !== null} onClose={() => setDeletingDef(null)} title={t("common.confirm")}>
        {deletingDef ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="def_delete" />
            <input type="hidden" name="id" value={deletingDef.id} />
            <p className="text-sm font-bold text-text">
              {deletingDef.label_ar || deletingDef.code}
              {deletingDef.label_en ? <span className="font-normal text-text-muted"> · {deletingDef.label_en}</span> : null}
            </p>

            {usageLoading ? (
              <p className="text-xs text-text-muted">{t("common.loading")}</p>
            ) : usage && usage.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning-soft p-2.5">
                <p className="text-sm font-extrabold text-text">{t("catalog.inUseTitle")}</p>
                <p className="mt-1 text-xs leading-snug text-text">{t("catalog.inUseBody")}</p>
                <p className="mt-2 text-xs font-bold text-text">{t("catalog.inUseList")}</p>
                <ul className="mt-1 list-inside list-disc text-xs text-text">
                  {usage.slice(0, 6).map((u, i) => <li key={`${u.ref_type}-${i}`}>{u.ref_label || u.ref_type}</li>)}
                  {usage.length > 6 ? <li className="text-text-muted">+{usage.length - 6}</li> : null}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-text">{t("catalog.deleteDefConfirm", { code: deletingDef.label_ar || deletingDef.code })}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingDef(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>
                {usage && usage.length > 0 ? t("catalog.archiveInstead") : t("common.confirm")}
              </Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
      <Dialog open={deletingOption !== null} onClose={() => setDeletingOption(null)} title={t("common.confirm")}>
        {deletingOption ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="option_delete" />
            <input type="hidden" name="id" value={deletingOption.id} />
            <p className="text-sm text-text">{t("catalog.deleteOptionConfirm", { label: deletingOption.label_ar })}</p>
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
  const base = "rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-action focus:outline-none";
  if (def.type === "enum") {
    return <select className={base} disabled><option value="">{options.map((o) => o.label_ar).join(" · ") || "—"}</option></select>;
  }
  if (def.type === "color") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <span key={o.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-text">
            <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: o.color_hex ?? "#ffffff" }} aria-hidden="true" />
            {o.label_ar}
          </span>
        ))}
        {options.length === 0 ? <span className="text-xs text-text-faint">—</span> : null}
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

/**
 * Without a route boundary a loader throw (or a guard redirect) escaped the
 * panel layout and rendered the standalone root error document, losing the
 * sidebar. Every other admin route already had one.
 */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
