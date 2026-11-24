import { useEffect, useState } from "react";
import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/packaging";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres, piastresToEgp } from "~/lib/money";
import { publicMediaUrl } from "~/lib/media.shared";
import { Badge, Button, Dialog, EmptyState } from "~/components/ui";
import { PackageIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from "~/components/ui/icons";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * Admin → Packaging catalog: the materials sellers buy from the platform.
 * Price per piece or per roll (+ optional price per metre for rolls), image,
 * stock (pieces, or metres for rolls — a roll uses its length), limits,
 * active flag. Deleting an item that was ever ordered archives it instead.
 * Writes go through the admin's client (RLS: admin only) and are audited.
 */

interface ItemRow {
  id: string; sku: string; category: string; name_ar: string; name_en: string; description_ar: string; description_en: string;
  unit: "piece" | "roll"; roll_length_m: number | null; spec_ar: string; spec_en: string; price_piastres: number;
  meter_price_piastres: number | null; stock_base: number; min_qty: number; max_qty: number | null; image_path: string | null;
  is_active: boolean; sort: number; deleted_at: string | null;
}
const CATEGORIES = ["envelope", "bubble_wrap", "box", "tape", "other"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client.from("packaging_items").select("*").is("deleted_at", null).order("sort").order("sku");
  if (error) throw new Error(error.message);
  return { lang, items: (rows ?? []) as ItemRow[], supabaseUrl: process.env.SUPABASE_URL ?? "" };
}

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const int = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = str(form, "intent");

  if (intent === "delete") {
    const { data: res, error } = await client.rpc("fn_admin_delete_packaging_item", { p_item_id: str(form, "id") });
    if (error) return data({ ok: false, reason: error.message }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "toggle") {
    const id = str(form, "id");
    const active = form.get("active") === "true";
    const { error } = await client.from("packaging_items").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "packaging.item_active", p_entity: "packaging_items", p_entity_id: id, p_before: null, p_after: { is_active: active } });
    return { ok: true as const };
  }

  if (intent === "save") {
    const id = str(form, "id");
    const unit = str(form, "unit") === "roll" ? "roll" : "piece";
    const category = CATEGORIES.includes(str(form, "category") as (typeof CATEGORIES)[number]) ? str(form, "category") : "other";
    const price = egpToPiastres(form.get("price"));
    const meterPrice = unit === "roll" && str(form, "meter_price") ? egpToPiastres(form.get("meter_price")) : null;
    const rollLength = unit === "roll" ? int(form, "roll_length_m") : null;
    // stock is typed in pieces / rolls (+ loose metres) and stored in base units
    const stockUnits = int(form, "stock") ?? 0;
    const stockExtraM = unit === "roll" ? int(form, "stock_meters") ?? 0 : 0;
    const minQty = int(form, "min_qty") ?? 1;
    const maxQty = int(form, "max_qty");
    const row = {
      sku: str(form, "sku", 40).toUpperCase(),
      category, unit,
      name_ar: str(form, "name_ar", 160), name_en: str(form, "name_en", 160),
      description_ar: str(form, "description_ar", 1000), description_en: str(form, "description_en", 1000),
      spec_ar: str(form, "spec_ar", 160), spec_en: str(form, "spec_en", 160),
      price_piastres: price, meter_price_piastres: meterPrice,
      roll_length_m: rollLength,
      stock_base: unit === "roll" ? stockUnits * (rollLength ?? 0) + stockExtraM : stockUnits,
      min_qty: minQty, max_qty: maxQty,
      image_path: str(form, "image_path") || null,
      sort: int(form, "sort") ?? 0,
      is_active: form.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    };
    const bad = !/^[A-Z0-9-]{2,40}$/.test(row.sku) ? "bad_sku"
      : !row.name_ar || !row.name_en ? "name_required"
      : !price || price <= 0 ? "bad_price"
      : meterPrice !== null && meterPrice <= 0 ? "bad_price"
      : unit === "roll" && (!rollLength || Number.isNaN(rollLength) || rollLength <= 0) ? "bad_roll_length"
      : [stockUnits, stockExtraM, minQty, maxQty ?? 1, row.sort].some((n) => Number.isNaN(n)) || minQty < 1 ? "bad_number"
      : null;
    if (bad) return data({ ok: false, reason: bad }, { status: 400 });

    const res = id
      ? await client.from("packaging_items").update(row).eq("id", id).select("id").single()
      : await client.from("packaging_items").insert({ ...row, created_by: viewer.user.id }).select("id").single();
    if (res.error) {
      return data({ ok: false, reason: /duplicate|unique/i.test(res.error.message) ? "sku_taken" : res.error.message }, { status: 400 });
    }
    await client.rpc("fn_audit", {
      p_action: id ? "packaging.item_updated" : "packaging.item_created", p_entity: "packaging_items",
      p_entity_id: (res.data as { id: string }).id, p_before: null, p_after: row,
    });
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminPackaging({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, items, supabaseUrl } = loaderData;
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, lang);
  const [editing, setEditing] = useState<ItemRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ItemRow | null>(null);
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, { success: t("common.saved") });
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { setEditing(null); setDeleting(null); }
  }, [fetcher.state, fetcher.data]);
  const stockLabel = (i: ItemRow) => i.unit === "roll" && i.roll_length_m
    ? t("pkg.stockRolls", { rolls: Math.floor(i.stock_base / i.roll_length_m), m: i.stock_base })
    : t("pkg.stockPieces", { n: i.stock_base });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("pkg.adminTitle")} subtitle={t("pkg.adminHint")} count={items.length}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={`/${lang}/admin/packaging/orders`} className="rounded-md border border-border px-4 py-2 text-sm font-bold text-text hover:bg-surface-tint">{t("pkg.opsTitle")}</Link>
            <Button onClick={() => setEditing("new")}><PlusIcon className="size-4" /> {t("pkg.add")}</Button>
          </div>
        } />

      {items.length === 0 ? <EmptyState title={t("pkg.emptyCatalog")} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <li key={i.id} className={`flex gap-3 rounded-lg border bg-surface p-3 shadow-1 ${i.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
              <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint text-text-faint">
                {i.image_path ? <img src={publicMediaUrl(supabaseUrl, i.image_path)} alt="" className="size-full object-cover" loading="lazy" /> : <PackageIcon className="size-8" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold text-text">{en ? i.name_en : i.name_ar}</p>
                <p className="num truncate text-2xs text-text-muted" dir="ltr">{i.sku}{i.spec_en ? ` · ${en ? i.spec_en : i.spec_ar}` : ""}</p>
                <p className="mt-1 text-sm">
                  <b className="num text-action">{money(i.price_piastres)}</b>
                  <span className="text-xs text-text-muted"> / {t(`pkg.unit_${i.unit}`)}</span>
                  {i.meter_price_piastres ? <span className="num text-xs text-text-muted"> · {money(i.meter_price_piastres)} / {t("pkg.unit_meter")}</span> : null}
                </p>
                <p className={`text-xs font-bold ${i.stock_base === 0 ? "text-danger" : "text-text-muted"}`}>{stockLabel(i)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={i.is_active ? "success" : "neutral"}>{t(i.is_active ? "pkg.active" : "pkg.hidden")}</Badge>
                  <fetcher.Form method="post" className="contents">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="active" value={String(!i.is_active)} />
                    <button type="submit" className="text-xs font-bold text-action hover:underline">{t(i.is_active ? "pkg.hide" : "pkg.show")}</button>
                  </fetcher.Form>
                  <span className="ms-auto flex gap-1">
                    <button type="button" onClick={() => setEditing(i)} aria-label={t("common.edit")} className="rounded-md p-1.5 text-text-muted hover:bg-surface-tint hover:text-text"><PencilIcon className="size-4" /></button>
                    <button type="button" onClick={() => setDeleting(i)} aria-label={t("common.delete")} className="rounded-md p-1.5 text-text-muted hover:bg-danger-soft hover:text-danger"><TrashIcon className="size-4" /></button>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? <ItemDialog item={editing === "new" ? null : editing} supabaseUrl={supabaseUrl} fetcher={fetcher} onClose={() => setEditing(null)} /> : null}

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("pkg.deleteTitle")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">{t("pkg.deleteBody", { name: en ? deleting.name_en : deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={fetcher.state !== "idle"}>{t("common.delete")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

function ItemDialog({ item, supabaseUrl, fetcher, onClose }: {
  item: ItemRow | null; supabaseUrl: string; fetcher: ReturnType<typeof useFetcher<typeof action>>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<"piece" | "roll">(item?.unit ?? "piece");
  const [image, setImage] = useState(item?.image_path ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const INPUT = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text";
  const L = "flex flex-col gap-1 text-xs font-bold text-text-muted";
  const rollLen = item?.roll_length_m ?? 50;
  const upload = async (file: File) => {
    setUploading(true); setUploadError(false);
    const body = new FormData();
    body.set("op", "image"); body.set("bucket", "media"); body.set("file", file);
    const res = await fetch("/api/upload", { method: "POST", body }).catch(() => null);
    const json = res ? ((await res.json().catch(() => null)) as { ok?: boolean; path?: string } | null) : null;
    if (json?.path) setImage(json.path); else setUploadError(true);
    setUploading(false);
  };

  return (
    <Dialog open onClose={onClose} title={item ? t("pkg.editTitle") : t("pkg.add")} size="lg">
      <fetcher.Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="id" value={item?.id ?? ""} />
        <input type="hidden" name="image_path" value={image} />
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 sm:col-span-2">
            <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint">
              {image ? <img src={publicMediaUrl(supabaseUrl, image)} alt="" className="size-full object-cover" /> : <PackageIcon className="size-8 text-text-faint" />}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-bold text-text hover:bg-surface-tint">
              <UploadIcon className="size-4" /> {uploading ? "…" : t("pkg.uploadImage")}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            </label>
            {image ? <button type="button" onClick={() => setImage("")} className="text-xs font-bold text-danger hover:underline">{t("common.remove")}</button> : null}
            {uploadError ? <span className="text-xs font-bold text-danger">{t("pkg.uploadFailed")}</span> : null}
          </div>
          <label className={L}>{t("pkg.nameAr")}<input name="name_ar" required defaultValue={item?.name_ar} className={INPUT} /></label>
          <label className={L}>{t("pkg.nameEn")}<input name="name_en" required dir="ltr" defaultValue={item?.name_en} className={INPUT} /></label>
          <label className={L}>{t("pkg.sku")}<input name="sku" required dir="ltr" defaultValue={item?.sku} pattern="[A-Za-z0-9-]{2,40}" className={INPUT} /></label>
          <label className={L}>{t("pkg.category")}
            <select name="category" defaultValue={item?.category ?? "other"} className={INPUT}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`pkg.cat_${c}`)}</option>)}
            </select>
          </label>
          <label className={L}>{t("pkg.specAr")}<input name="spec_ar" defaultValue={item?.spec_ar} className={INPUT} /></label>
          <label className={L}>{t("pkg.specEn")}<input name="spec_en" dir="ltr" defaultValue={item?.spec_en} className={INPUT} /></label>
          <fieldset className="flex flex-wrap gap-3 sm:col-span-2">
            <legend className="mb-1 text-xs font-bold text-text-muted">{t("pkg.soldBy")}</legend>
            {(["piece", "roll"] as const).map((u) => (
              <label key={u} className="flex items-center gap-2 text-sm text-text">
                <input type="radio" name="unit" value={u} checked={unit === u} onChange={() => setUnit(u)} className="accent-[var(--color-action)]" />
                {t(`pkg.unit_${u}`)}
              </label>
            ))}
          </fieldset>
          <label className={L}>{t("pkg.priceEgp", { unit: t(`pkg.unit_${unit}`) })}<input name="price" required inputMode="decimal" dir="ltr" defaultValue={item ? piastresToEgp(item.price_piastres) : ""} className={INPUT} /></label>
          {unit === "roll" ? (
            <>
              <label className={L}>{t("pkg.meterPrice")}<input name="meter_price" inputMode="decimal" dir="ltr" defaultValue={item?.meter_price_piastres ? piastresToEgp(item.meter_price_piastres) : ""} className={INPUT} placeholder={t("pkg.optional")} /></label>
              <label className={L}>{t("pkg.rollLength")}<input name="roll_length_m" type="number" min={1} required dir="ltr" defaultValue={rollLen} className={INPUT} /></label>
              <label className={L}>{t("pkg.stockRollsInput")}<input name="stock" type="number" min={0} dir="ltr" defaultValue={item?.roll_length_m ? Math.floor(item.stock_base / item.roll_length_m) : 0} className={INPUT} /></label>
              <label className={L}>{t("pkg.stockLooseMeters")}<input name="stock_meters" type="number" min={0} dir="ltr" defaultValue={item?.roll_length_m ? item.stock_base % item.roll_length_m : 0} className={INPUT} /></label>
            </>
          ) : (
            <label className={L}>{t("pkg.stockPiecesInput")}<input name="stock" type="number" min={0} dir="ltr" defaultValue={item?.stock_base ?? 0} className={INPUT} /></label>
          )}
          <label className={L}>{t("pkg.minQty")}<input name="min_qty" type="number" min={1} dir="ltr" defaultValue={item?.min_qty ?? 1} className={INPUT} /></label>
          <label className={L}>{t("pkg.maxQty")}<input name="max_qty" type="number" min={1} dir="ltr" defaultValue={item?.max_qty ?? ""} className={INPUT} placeholder={t("pkg.optional")} /></label>
          <label className={L}>{t("pkg.sort")}<input name="sort" type="number" min={0} dir="ltr" defaultValue={item?.sort ?? 0} className={INPUT} /></label>
          <label className={`${L} sm:col-span-2`}>{t("pkg.descAr")}<textarea name="description_ar" rows={2} defaultValue={item?.description_ar} className={INPUT} /></label>
          <label className={`${L} sm:col-span-2`}>{t("pkg.descEn")}<textarea name="description_en" rows={2} dir="ltr" defaultValue={item?.description_en} className={INPUT} /></label>
          <label className="flex items-center gap-2 text-sm font-bold text-text sm:col-span-2">
            <input type="checkbox" name="is_active" defaultChecked={item?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />
            {t("pkg.visibleToSellers")}
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={fetcher.state !== "idle"} disabled={uploading}>{t("common.save")}</Button>
        </footer>
      </fetcher.Form>
    </Dialog>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}
