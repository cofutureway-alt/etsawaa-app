import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/categories";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Input } from "~/components/ui/Input";
import { Dialog } from "~/components/ui/Overlay";
import { useToast } from "~/components/ui/Toast";
import { ChevronRightIcon, PencilIcon, TrashIcon, PlusIcon, GridIcon } from "~/components/ui/icons";
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import { parseMediaSettings } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";


export interface CategoryRow {
  id: string;
  parent_id: string | null;
  depth: number;
  path: string;
  slug_ar: string;
  slug_en: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  thumb_path: string | null;
  sort: number;
  is_active: boolean;
  show_in_header: boolean;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client
    .from("categories")
    .select("id,parent_id,depth,path,slug_ar,slug_en,name_ar,name_en,description_ar,description_en,thumb_path,sort,is_active,show_in_header")
    .is("deleted_at", null)
    .order("sort");
  if (error) throw new Response(error.message, { status: 500 });
  const { data: mediaRow } = await client.from("settings").select("value").eq("key", "media").single();
  // H-08: commission overrides (per category, children inherit the nearest ancestor)
  const { data: commissions } = await client.from("category_commissions").select("category_id, percent");
  const commissionMap = Object.fromEntries(((commissions ?? []) as Array<{ category_id: string; percent: number }>).map((c) => [c.category_id, c.percent]));
  return {
    lang,
    categories: (rows ?? []) as CategoryRow[],
    commissions: commissionMap as Record<string, number>,
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
  const id = form.get("id") ? String(form.get("id")) : null;

  const asOptional = (key: string) => {
    const v = form.get(key);
    const s = v === null ? "" : String(v).trim();
    return s.length > 0 ? s : null;
  };

  if (intent === "create" || intent === "update") {
    const patch = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      slug_ar: String(form.get("slug_ar") ?? "").trim(),
      slug_en: String(form.get("slug_en") ?? "").trim(),
      description_ar: String(form.get("description_ar") ?? "").trim(),
      description_en: String(form.get("description_en") ?? "").trim(),
      thumb_path: asOptional("thumb_path"),
      is_active: form.get("is_active") === "on" || form.get("is_active") === "true",
      show_in_header: form.get("show_in_header") === "on" || form.get("show_in_header") === "true",
      parent_id: asOptional("parent_id"),
    };
    if (!patch.name_ar || !patch.name_en || !patch.slug_ar || !patch.slug_en) {
      return { ok: false as const, reason: "invalid" };
    }
    if (intent === "create") {
      const { error } = await client.from("categories").insert(patch);
      if (error) return { ok: false as const, reason: error.message };
    } else {
      if (!id) return { ok: false as const, reason: "invalid" };
      const { error } = await client.from("categories").update(patch).eq("id", id);
      if (error) return { ok: false as const, reason: error.message };
    }
    return { ok: true as const };
  }

  if (intent === "move" && id) {
    const parentId = asOptional("parent");
    const { error } = await client.from("categories").update({ parent_id: parentId }).eq("id", id);
    if (error) return { ok: false as const, reason: error.message.includes("cycle") ? "cycle" : error.message.includes("depth") ? "depth" : error.message };
    return { ok: true as const };
  }

  if (intent === "reorder" && id) {
    const { error } = await client.from("categories").update({ sort: Number(form.get("sort") ?? 0) }).eq("id", id);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  }

  if (intent === "toggle" && id) {
    const { error } = await client
      .from("categories")
      .update({ is_active: form.get("active") === "true" })
      .eq("id", id);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  }

  if (intent === "delete" && id) {
    // soft delete; blocked by RESTRICT when children reference the row
    const { error } = await client.from("categories").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id);
    if (error) return { ok: false as const, reason: "has_children" };
    return { ok: true as const };
  }

  /* H-08 — commission overrides via the audited RPCs (never direct table
     writes from the UI; the RPC logs before/after into audit_logs) */
  if (intent === "set_commission" && id) {
    const pct = Number(String(form.get("percent") ?? ""));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false as const, reason: "percent_range" };
    }
    const { error } = await client.rpc("fn_admin_set_commission", { p_category: id, p_percent: pct });
    if (error) return { ok: false as const, reason: error.message.includes("percent_out_of_range") ? "percent_range" : error.message.includes("category_not_found") ? "invalid" : "db" };
    return { ok: true as const };
  }
  if (intent === "clear_commission" && id) {
    const { error } = await client.rpc("fn_admin_clear_commission", { p_category: id });
    if (error) return { ok: false as const, reason: "db" };
    return { ok: true as const };
  }
  return { ok: false as const, reason: "invalid" };
}

interface TreeView {
  row: CategoryRow;
  children: TreeView[];
}

function buildTree(rows: CategoryRow[]): TreeView[] {
  const byId = new Map<string, TreeView>();
  for (const r of rows) byId.set(r.id, { row: r, children: [] });
  const roots: TreeView[] = [];
  for (const node of byId.values()) {
    if (node.row.parent_id && byId.has(node.row.parent_id)) byId.get(node.row.parent_id)!.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeView[]) => {
    nodes.sort((a, b) => a.row.sort - b.row.sort || a.row.name_ar.localeCompare(b.row.name_ar));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function DraggableCategory({ row, children }: { row: CategoryRow; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `cat:${row.id}` });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? "opacity-40" : ""}>
      {children}
    </div>
  );
}

function DroppableCategory({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={isOver ? "ring-2 ring-action rounded-md" : ""}>
      {children}
    </div>
  );
}

export default function AdminCategories({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fetcher = useFetcher<typeof action>();
  const { categories, commissions, media, uid, supabaseUrl } = loaderData;
  const tree = useMemo(() => buildTree(categories), [categories]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ row: CategoryRow | null; parent: CategoryRow | null } | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [pickerFor, setPickerFor] = useState<"form" | null>(null);
  const [formThumb, setFormThumb] = useState<string | null>(null);
  const [commissionFor, setCommissionFor] = useState<CategoryRow | null>(null);
  const [commissionVal, setCommissionVal] = useState("");
  const busy = fetcher.state !== "idle";

  /* H-08: the EFFECTIVE percent for a category — the node's own override
     when present, otherwise inherited from the nearest ancestor override,
     otherwise NULL (orders fall back to the vendor's level rate) */
  const effectiveCommission = (row: CategoryRow): number | null => {
    const own = commissions[row.id];
    if (own !== undefined) return own;
    // walk the slash-joined path downwards — the LAST hit is the nearest ancestor
    const ids = row.path.split("/").filter(Boolean);
    for (let i = ids.length - 1; i >= 0; i--) {
      const p = commissions[ids[i]!];
      if (p !== undefined) return p;
    }
    return null;
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        toast.showToast("success", t("catalog.saved"));
        setEditing(null);
        setDeleting(null);
      } else {
        toast.showToast("error", fetcher.data.reason === "has_children" ? t("catalog.categoryHasChildren") : fetcher.data.reason === "cycle" ? t("catalog.dragCycle") : fetcher.data.reason === "depth" ? t("catalog.dragDepth") : t(fetcher.data.reason === "db" ? "errors.dataUnavailable" : "catalog.saveFailed"));
      }
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    if (!activeId.startsWith("cat:") || !event.over) return;
    const moved = categories.find((c) => c.id === activeId.slice(4));
    const overId = String(event.over.id).replace("cat:", "");
    if (!moved || moved.id === overId || moved.parent_id === overId) return;
    // drop on another category = nest under it (sibling order stays with the move buttons)
    const fd = new FormData();
    fd.set("intent", "move");
    fd.set("id", moved.id);
    fd.set("parent", overId);
    fetcher.submit(fd, { method: "post" });
  };

  const moveStep = (row: CategoryRow, dir: -1 | 1) => {
    const siblings = categories.filter((c) => c.parent_id === row.parent_id && c.id !== row.id).sort((a, b) => a.sort - b.sort);
    const ordered = [...siblings];
    const idx = siblings.findIndex((c) => c.id === row.id);
    ordered.splice(idx, 0, row);
    const swapped = [...ordered];
    const j = idx + dir;
    if (j < 0 || j >= swapped.length) return;
    const tmp = swapped[idx]!;
    swapped[idx] = swapped[j]!;
    swapped[j] = tmp;
    swapped.forEach((c, i) => {
      if (c.sort !== i) {
        const fd = new FormData();
        fd.set("intent", "reorder");
        fd.set("id", c.id);
        fd.set("sort", String(i));
        fetcher.submit(fd, { method: "post" });
      }
    });
  };

  const renderTree = (nodes: TreeView[], level: number) => (
    <ul className={level === 0 ? "space-y-1.5" : "ms-3 sm:ms-5 border-s-2 border-border/60 ps-2.5 sm:ps-3.5 space-y-1.5 mt-1.5"}>
      {nodes.map((node) => (
        <li key={node.row.id} className="py-0.5">
          <DroppableCategory id={`cat:${node.row.id}`}>
            <DraggableCategory row={node.row}>
              <div className="flex items-center gap-1.5">
                {node.children.length > 0 ? (
                  <button
                    type="button"
                    aria-expanded={expanded.has(node.row.id)}
                    onClick={() =>
                      setExpanded((cur) => {
                        const n = new Set(cur);
                        if (n.has(node.row.id)) n.delete(node.row.id);
                        else n.add(node.row.id);
                        return n;
                      })
                    }
                    className="flex size-6 cursor-pointer items-center justify-center rounded hover:bg-surface-tint text-text-muted transition-colors shrink-0"
                  >
                    <ChevronRightIcon
                      className={`size-3.5 transition-transform ${
                        expanded.has(node.row.id) ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                ) : (
                  <span className="size-6 shrink-0" />
                )}

                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-surface px-3.5 py-2.5 shadow-sm hover:border-action/40 transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {node.row.thumb_path ? (
                      <img
                        src={`${supabaseUrl}/storage/v1/object/public/media/${node.row.thumb_path}`}
                        alt=""
                        width={36}
                        height={36}
                        loading="lazy"
                        className="size-9 rounded-lg bg-surface-tint object-cover border border-border/60 shrink-0"
                      />
                    ) : (
                      <div className="flex size-9 items-center justify-center rounded-lg bg-surface-tint border border-border/60 text-action shrink-0">
                        <GridIcon className="size-4" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <p className="truncate text-xs sm:text-sm font-bold text-text">
                        {node.row.name_ar}
                        <span className="font-normal text-text-faint text-xs ms-1.5 font-mono">
                          / {node.row.name_en}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      // H-08: commission badge — overridden (explicit row) vs inherited vs level-default
                      const own = commissions[node.row.id] != null;
                      const eff = effectiveCommission(node.row);
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setCommissionFor(node.row);
                            setCommissionVal(
                              commissions[node.row.id] != null ? String(commissions[node.row.id]) : ""
                            );
                          }}
                          title={t("commission.editHint")}
                          className={`num shrink-0 cursor-pointer rounded-md border px-2.5 py-1 text-[11px] font-extrabold transition-colors duration-150 ${
                            own
                              ? "border-action/40 bg-action/10 text-action hover:bg-action/20"
                              : eff != null
                              ? "border-border bg-surface-tint text-text-muted hover:bg-surface-tint/70"
                              : "border-dashed border-border text-text-faint hover:text-text-muted"
                          }`}
                        >
                          {eff != null
                            ? `${t("commission.short")} ${eff}%${own ? "" : ` · ${t("commission.inherited")}`}`
                            : t("commission.levelDefault")}
                        </button>
                      );
                    })()}

                    {node.row.show_in_header ? (
                      <Badge tone="info" dot>
                        {t("catalog.inHeader")}
                      </Badge>
                    ) : null}

                    {!node.row.is_active ? (
                      <Badge tone="danger" dot>
                        {t("catalog.inactive")}
                      </Badge>
                    ) : null}

                    <div className="flex items-center gap-1 border-s border-border/40 ps-2 ms-1">
                      <button
                        type="button"
                        aria-label={t("catalog.moveUp")}
                        onClick={() => moveStep(node.row, -1)}
                        className="cursor-pointer p-1 rounded hover:bg-surface-tint text-text-muted hover:text-action transition-colors"
                      >
                        <ChevronRightIcon className="size-3.5 rotate-90" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("catalog.moveDown")}
                        onClick={() => moveStep(node.row, 1)}
                        className="cursor-pointer p-1 rounded hover:bg-surface-tint text-text-muted hover:text-action transition-colors"
                      >
                        <ChevronRightIcon className="size-3.5 -rotate-90" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("common.edit")}
                        onClick={() => {
                          setEditing({ row: node.row, parent: null });
                          setFormThumb(node.row.thumb_path);
                        }}
                        className="cursor-pointer p-1 rounded hover:bg-surface-tint text-text-muted hover:text-action transition-colors"
                      >
                        <PencilIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("common.delete")}
                        onClick={() => setDeleting(node.row)}
                        className="cursor-pointer p-1 rounded hover:bg-danger-soft text-text-muted hover:text-danger transition-colors"
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </DraggableCategory>
          </DroppableCategory>
          {expanded.has(node.row.id) ? renderTree(node.children, level + 1) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("catalog.categories")}</h1>
            <Badge tone="featured" dot>{categories.length} تصنيفات</Badge>
          </div>
          <p className="text-xs text-text-muted">{t("catalog.categoriesHint")}</p>
        </div>

        <Button
          type="button"
          onClick={() => {
            setEditing({ row: null, parent: null });
            setFormThumb(null);
          }}
          className="cursor-pointer shrink-0"
        >
          <PlusIcon className="size-4" />
          {t("catalog.addCategory")}
        </Button>
      </div>

      {/* Interactive Drag & Drop Categories Tree */}
      <div className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {tree.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface py-12 text-center text-xs text-text-muted">
              {t("catalog.noCategories")}
            </div>
          ) : (
            renderTree(tree, 0)
          )}
        </DndContext>
      </div>

      {/* create/edit dialog */}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.row ? t("catalog.editCategory") : t("catalog.addCategory")}>
        {editing ? (
          <fetcher.Form method="post" className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pe-1">
            <input type="hidden" name="intent" value={editing.row ? "update" : "create"} />
            {editing.row ? <input type="hidden" name="id" value={editing.row.id} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t("catalog.nameAr")} name="name_ar" defaultValue={editing.row?.name_ar} required maxLength={80} inputClassName="bg-surface" />
              <Input label={t("catalog.nameEn")} name="name_en" defaultValue={editing.row?.name_en} required maxLength={80} dir="ltr" inputClassName="bg-surface" />
              <Input
                label={t("catalog.slugAr")}
                name="slug_ar"
                defaultValue={editing.row?.slug_ar}
                required
                maxLength={80}
                dir="ltr"
                pattern="[a-z0-9-]+"
                hint={t("catalog.slugHint")}
                inputClassName="bg-surface"
              />
              <Input
                label={t("catalog.slugEn")}
                name="slug_en"
                defaultValue={editing.row?.slug_en}
                required
                maxLength={80}
                dir="ltr"
                pattern="[a-z0-9-]+"
                inputClassName="bg-surface"
              />
            </div>
            <Input label={t("catalog.descAr")} name="description_ar" defaultValue={editing.row?.description_ar} maxLength={300} inputClassName="bg-surface" />
            <Input label={t("catalog.descEn")} name="description_en" defaultValue={editing.row?.description_en} maxLength={300} dir="ltr" inputClassName="bg-surface" />
            <label className="flex flex-col gap-1 text-[13px] font-bold text-text">
              {t("catalog.parent")}
              <select name="parent_id" defaultValue={editing.row?.parent_id ?? ""} className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-text focus:border-action focus:outline-none">
                <option value="">{t("catalog.rootLevel")}</option>
                {categories
                  .filter((c) => c.depth < 3)
                  .filter((c) => !editing.row || (c.id !== editing.row.id && !editing.row.path.includes(c.id)))
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name_ar} — {c.name_en}</option>
                  ))}
              </select>
            </label>
            <div className="flex items-center gap-3">
              {formThumb ? (
                <img src={`${supabaseUrl}/storage/v1/object/public/media/${formThumb}`} alt="" width={48} height={48} className="size-12 rounded-md bg-surface-tint object-cover" />
              ) : (
                <span className="flex size-12 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-text-faint">{t("catalog.thumb")}</span>
              )}
              <input type="hidden" name="thumb_path" value={formThumb ?? ""} />
              <Button type="button" size="sm" variant="outline" onClick={() => setPickerFor("form")}>{t("media.choose")}</Button>
              {formThumb ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setFormThumb(null)}>{t("common.delete")}</Button>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="is_active" defaultChecked={editing.row?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />
              {t("catalog.active")}
            </label>
            <label className="flex items-center gap-2 text-[13px] font-bold text-text">
              <input type="checkbox" name="show_in_header" defaultChecked={editing.row?.show_in_header ?? false} className="size-4 accent-[var(--color-action)]" />
              {t("catalog.showInHeader")}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.save")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("common.confirm")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-[13px] text-text">{t("catalog.deleteConfirm", { name: deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <MediaPickerDialog
        open={pickerFor === "form"}
        onClose={() => setPickerFor(null)}
        title={t("media.pickImage")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => setFormThumb(files[0]?.path ?? null)}
      />

      {/* H-08 — CommissionEditor: per-category override, audited via RPC.
          Clearing removes the row so children inherit the next ancestor. */}
      <Dialog open={commissionFor !== null} onClose={() => setCommissionFor(null)} title={t("commission.title", { name: commissionFor?.name_ar ?? "" })}>
        {commissionFor ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-muted">{t("commission.help")}</p>
            <div>
              <label htmlFor="cm-percent" className="text-[13px] font-bold text-text">{t("commission.percentLabel")}</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="cm-percent"
                  type="number" min={0} max={100} step={0.5} dir="ltr"
                  value={commissionVal}
                  onChange={(e) => setCommissionVal(e.target.value)}
                  placeholder={(() => { const cur = effectiveCommission(commissionFor); return cur != null ? String(cur) : t("commission.levelDefault"); })()}
                  className="num w-28 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:shadow-focus"
                />
                <span className="text-[13px] font-bold text-text-muted">%</span>
              </div>
              <p className="mt-1 text-xs text-text-faint">
                {commissions[commissionFor.id] != null
                  ? t("commission.noteOverridden", { effective: effectiveCommission(commissionFor) ?? 0 })
                  : effectiveCommission(commissionFor) != null
                    ? t("commission.noteInherited", { effective: effectiveCommission(commissionFor) ?? 0 })
                    : t("commission.noteDefault")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              {commissions[commissionFor.id] != null ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="clear_commission" />
                  <input type="hidden" name="id" value={commissionFor.id} />
                  <Button type="submit" size="sm" variant="ghost" loading={busy} onClick={() => setCommissionFor(null)}>{t("commission.clear")}</Button>
                </fetcher.Form>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setCommissionFor(null)}>{t("common.cancel")}</Button>
                <Button
                  type="button"
                  loading={busy}
                  disabled={commissionVal.trim() === ""}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("intent", "set_commission");
                    fd.set("id", commissionFor.id);
                    fd.set("percent", commissionVal);
                    fetcher.submit(fd, { method: "post" });
                    setCommissionFor(null);
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
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
