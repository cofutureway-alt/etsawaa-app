/**
 * Admin → Catalog → Attributes (leaf categories only).
 *
 * Route module: `loader`, `action` and the default page shell live here; the
 * UI bodies are extracted under `app/components/admin/catalog/`:
 *   - `attributes.shared.ts`  types + slugifyCode
 *   - `AttributeForm.tsx`     def create/edit form body
 *   - `AttributesList.tsx`    attribute rows + option chips
 *   - `TemplatePreview.tsx`   storefront template preview (US-10)
 *   - `LeafPicker.tsx`        no-leaf-selected landing view
 *   - `AttributeDialogs.tsx`  def/option/link/delete dialogs + media picker
 * Dialog state and the single shared fetcher stay in this component so the
 * toast effect keeps observing every submit.
 */
import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/attributes";
import { useFetcher, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { PlusIcon } from "~/components/ui/icons";
import { useToast } from "~/components/ui/Toast";
import { parseMediaSettings } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { PageHeader } from "~/components/layout/PageHeader";
import { LeafPicker } from "~/components/admin/catalog/LeafPicker";
import { TemplatePreview } from "~/components/admin/catalog/TemplatePreview";
import { AttributesList } from "~/components/admin/catalog/AttributesList";
import { AttributeDialogs } from "~/components/admin/catalog/AttributeDialogs";
import { slugifyCode } from "~/components/admin/catalog/attributes.shared";
import { fetchAll } from "~/lib/supabase/fetch-all";
import type {
  DefDialogState, DefRow, LeafCategory, LinkRow, OptionDialogState, OptionRow, PickerImageState, UsageRow,
} from "~/components/admin/catalog/attributes.shared";

/** Product types per page on the landing list. */
const LEAF_PAGE_SIZE = 30;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const catId = url.searchParams.get("cat");

  // Landing list: one page of product types with their attribute counts,
  // searched and counted in the database (the full catalog is ~1,400 types).
  if (!catId) {
    const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const { data: rows, error } = await client.rpc("fn_admin_leaf_page", {
      p_q: q || null, p_limit: LEAF_PAGE_SIZE, p_offset: (page - 1) * LEAF_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<LeafCategory & { attr_count: number; total: number }>;
    return {
      mode: "list" as const,
      lang, page, q, perPage: LEAF_PAGE_SIZE,
      total: Number(list[0]?.total ?? 0),
      leaves: list.map(({ total: _total, ...leaf }) => leaf),
    };
  }

  // One product type: only the attributes it uses, their options, and where
  // else those attributes are linked. The leaf list (names only) feeds the
  // "link to other types" dialog.
  const [cats, ownedDefs, ownLinks] = await Promise.all([
    fetchAll((from, to) =>
      client.from("categories").select("id,parent_id,name_ar,name_en,depth").is("deleted_at", null).order("name_ar").order("id").range(from, to)),
    client.from("attribute_defs").select("*").is("deleted_at", null).eq("category_id", catId),
    client.from("category_attributes").select("attribute_id").eq("category_id", catId),
  ]);
  if (ownedDefs.error) throw new Error(ownedDefs.error.message);
  if (ownLinks.error) throw new Error(ownLinks.error.message);
  const linkedIds = ((ownLinks.data ?? []) as Array<{ attribute_id: string }>).map((l) => l.attribute_id);
  const { data: linkedDefs, error: linkedError } = linkedIds.length
    ? await client.from("attribute_defs").select("*").is("deleted_at", null).in("id", linkedIds)
    : { data: [], error: null };
  if (linkedError) throw new Error(linkedError.message);
  const defs = [...(ownedDefs.data ?? []), ...(linkedDefs ?? [])] as DefRow[];
  const defIds = defs.map((d) => d.id);
  const [options, links] = defIds.length
    ? await Promise.all([
        fetchAll((from, to) =>
          client.from("attribute_options").select("*").is("deleted_at", null).in("attribute_id", defIds).order("sort").order("id").range(from, to)),
        fetchAll((from, to) =>
          client.from("category_attributes").select("category_id,attribute_id,sort,allowed_option_ids,is_required").in("attribute_id", defIds).order("category_id").order("attribute_id").range(from, to)),
      ])
    : [[], []];

  const allCats = cats as Array<LeafCategory & { depth: number; parent_id: string | null }>;
  // leaf = no other live category names it as parent
  const parents = new Set(allCats.map((r) => r.parent_id as string));
  const byId = new Map(allCats.map((c) => [c.id, c]));
  const leaves = allCats
    .filter((c) => !parents.has(c.id))
    .map(({ parent_id, ...leaf }) => {
      const parent = parent_id ? byId.get(parent_id) : undefined;
      return { ...leaf, parent_ar: parent?.name_ar, parent_en: parent?.name_en };
    });
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  return {
    mode: "editor" as const,
    lang,
    leaves,
    defs,
    options: options as OptionRow[],
    links: links as LinkRow[],
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
      is_multi: form.get("is_multi") === "on" && String(form.get("type")) === "enum",
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
      is_multi: form.get("is_multi") === "on" && String(form.get("type")) === "enum",
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
  if (intent === "scope_toggle" || intent === "scope_reset") {
    // per-category option list: which options of a linked attribute this
    // category offers (null = all of them)
    const attributeId = String(form.get("attribute_id"));
    const categoryId = String(form.get("category_id"));
    let next: string[] | null = null;
    if (intent === "scope_toggle") {
      const optionId = String(form.get("option_id"));
      const [{ data: link, error: linkErr }, { data: opts, error: optErr }] = await Promise.all([
        client.from("category_attributes").select("allowed_option_ids").eq("attribute_id", attributeId).eq("category_id", categoryId).maybeSingle(),
        client.from("attribute_options").select("id").eq("attribute_id", attributeId).is("deleted_at", null).order("sort").order("id"),
      ]);
      if (linkErr || optErr) return { ok: false as const, reason: (linkErr ?? optErr)?.message ?? "error" };
      if (!link) return { ok: false as const, reason: "no_rows" };
      const all = ((opts ?? []) as Array<{ id: string }>).map((o) => o.id);
      const current = new Set((link.allowed_option_ids as string[] | null) ?? all);
      if (current.has(optionId)) current.delete(optionId); else current.add(optionId);
      if (current.size === 0) return { ok: false as const, reason: "scope_empty" };
      next = all.every((id) => current.has(id)) ? null : all.filter((id) => current.has(id));
    }
    const { data: touched, error } = await client.from("category_attributes").update({ allowed_option_ids: next })
      .eq("attribute_id", attributeId).eq("category_id", categoryId).select("attribute_id");
    if (error) return { ok: false as const, reason: error.message };
    if (!touched || touched.length === 0) return { ok: false as const, reason: "no_rows" };
    return { ok: true as const };
  }
  if (intent === "required_toggle") {
    // required in THIS category only (the link), not the spec everywhere
    const { data: touched, error } = await client.from("category_attributes")
      .update({ is_required: form.get("required") === "true" })
      .eq("attribute_id", String(form.get("attribute_id"))).eq("category_id", String(form.get("category_id"))).select("attribute_id");
    if (error) return { ok: false as const, reason: error.message };
    if (!touched || touched.length === 0) return { ok: false as const, reason: "no_rows" };
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

type LoaderData = Route.ComponentProps["loaderData"];
type EditorData = Extract<LoaderData, { mode: "editor" }>;

export default function AdminAttributes({ loaderData }: Route.ComponentProps) {
  return loaderData.mode === "list"
    ? <LeafPicker leaves={loaderData.leaves} total={loaderData.total} page={loaderData.page} perPage={loaderData.perPage} query={loaderData.q} />
    : <AttributeEditor data={loaderData} />;
}

function AttributeEditor({ data: loaderData }: { data: EditorData }) {
  const { t } = useTranslation();
  const toast = useToast();
  const fetcher = useFetcher<typeof action>();
  const [search, setSearch] = useSearchParams();
  const { leaves, defs, options, links, media, uid, supabaseUrl } = loaderData;
  const catId = search.get("cat");
  const selected = useMemo(() => leaves.find((l) => l.id === catId) ?? null, [leaves, catId]);

  const [defDialog, setDefDialog] = useState<DefDialogState>(null);
  const [optionDialog, setOptionDialog] = useState<OptionDialogState>(null);
  const [linkDialog, setLinkDialog] = useState<DefRow | null>(null);
  const [pickerImage, setPickerImage] = useState<PickerImageState>(null);
  const [deletingDef, setDeletingDef] = useState<DefRow | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [deletingOption, setDeletingOption] = useState<OptionRow | null>(null);
  const busy = fetcher.state !== "idle";

  // Ask the DB what still uses this attribute before offering to archive it.
  useEffect(() => {
    if (!deletingDef) { setUsage(null); return; }
    let cancelled = false;
    setUsageLoading(true);
    void (async () => {
      // Through our route, which holds the session; the browser client has
      // none (httpOnly cookie). is_admin() still guards the RPC server-side.
      const res = await fetch(`/api/attribute-usage?id=${encodeURIComponent(deletingDef.id)}`, { credentials: "same-origin" })
        .then((r) => r.json() as Promise<{ ok: boolean; usage?: UsageRow[] }>)
        .catch(() => null);
      if (cancelled) return;
      setUsage(res?.ok ? (res.usage ?? []) : []);
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
            : reason === "scope_empty" ? t("catalog.scopeEmpty")
            : reason.includes("not_leaf") ? t("catalog.leafOnly")
            : t("catalog.saveFailed"),
        );
      }
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  // attributes visible for this leaf: owned + linked. A linked attribute
  // (e.g. a global dictionary spec) takes its position from the link — the
  // leaf's template order — not from the attribute's own sort.
  const visibleDefs = useMemo(() => {
    if (!selected) return [];
    const linkSort = new Map(links.filter((l) => l.category_id === selected.id).map((l) => [l.attribute_id, l.sort]));
    const sortOf = (d: DefRow) => (d.category_id === selected.id ? d.sort : linkSort.get(d.id) ?? d.sort);
    return defs
      .filter((d) => d.category_id === selected.id || linkSort.has(d.id))
      .sort((a, b) => sortOf(a) - sortOf(b) || a.code.localeCompare(b.code));
  }, [defs, links, selected]);

  const optionsFor = (defId: string) => options.filter((o) => o.attribute_id === defId).sort((a, b) => a.sort - b.sort);
  // what a seller actually sees in this category (the link's option scope)
  const offeredFor = (defId: string) => {
    const scope = links.find((l) => l.attribute_id === defId && l.category_id === selected?.id)?.allowed_option_ids;
    return scope ? optionsFor(defId).filter((o) => scope.includes(o.id)) : optionsFor(defId);
  };

  if (!selected) {
    // stale or non-leaf ?cat= — attributes attach to product types only
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6 shadow-1">
        <p className="text-sm text-text">{t("catalog.leafOnly")}</p>
        <button type="button" onClick={() => setSearch({})} className="cursor-pointer text-sm font-bold text-action hover:underline">
          {t("catalog.allLeaves")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={selected.name_ar}
        subtitle={selected.name_en}
        count={visibleDefs.length}
        actions={
          <Button type="button" onClick={() => setDefDialog({ mode: "create" })}>
            <PlusIcon className="size-4" aria-hidden="true" /> {t("catalog.addAttribute")}
          </Button>
        }
      />
      <button type="button" onClick={() => setSearch({})} className="-mt-2 cursor-pointer self-start text-sm font-bold text-action hover:underline">
        {t("catalog.allLeaves")}
      </button>

      {/* template preview (US-10) */}
      <TemplatePreview
        defs={visibleDefs.map((d) => ({ ...d, is_required: d.is_required || Boolean(links.find((l) => l.attribute_id === d.id && l.category_id === selected.id)?.is_required) }))}
        optionsFor={offeredFor}
      />

      <AttributesList
        defs={visibleDefs}
        optionsFor={optionsFor}
        links={links}
        selectedId={selected.id}
        onEditDef={(d) => setDefDialog({ mode: "edit", def: d })}
        onDeleteDef={setDeletingDef}
        onEditOption={(attributeId, option) => setOptionDialog({ attributeId, option })}
        onDeleteOption={setDeletingOption}
        onAddOption={(attributeId) => setOptionDialog({ attributeId, option: null })}
        onLink={setLinkDialog}
        busy={busy}
        onToggleScope={(d, o) => fetcher.submit({ intent: "scope_toggle", attribute_id: d.id, category_id: selected.id, option_id: o.id }, { method: "post" })}
        onResetScope={(d) => fetcher.submit({ intent: "scope_reset", attribute_id: d.id, category_id: selected.id }, { method: "post" })}
        onToggleRequired={(d, required) => fetcher.submit({ intent: "required_toggle", attribute_id: d.id, category_id: selected.id, required: String(required) }, { method: "post" })}
      />

      <AttributeDialogs
        fetcher={fetcher}
        busy={busy}
        selected={selected}
        leaves={leaves}
        defs={defs}
        optionsFor={optionsFor}
        links={links}
        media={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        defDialog={defDialog}
        optionDialog={optionDialog}
        linkDialog={linkDialog}
        pickerImage={pickerImage}
        deletingDef={deletingDef}
        deletingOption={deletingOption}
        usage={usage}
        usageLoading={usageLoading}
        setDefDialog={setDefDialog}
        setOptionDialog={setOptionDialog}
        setLinkDialog={setLinkDialog}
        setPickerImage={setPickerImage}
        setDeletingDef={setDeletingDef}
        setDeletingOption={setDeletingOption}
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
