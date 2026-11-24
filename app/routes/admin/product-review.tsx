import { useEffect, useRef, useState, type ReactNode } from "react";
import { unitLabel, withUnit } from "~/lib/units";
import type { Route } from "./+types/product-review";
import { Link, data, useFetcher, useRevalidator, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isRichHtml, sanitizeProductHtml } from "~/lib/sanitize";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { canAny } from "~/lib/permissions";
import { formatPiastres } from "~/lib/money";
import { parseMediaSettings, publicMediaUrl } from "~/lib/media.shared";
import { Badge, Button, Dialog, useToast } from "~/components/ui";
import { AcceptBrandDialog, RejectBrandDialog, type PendingBrand } from "~/components/admin/BrandReviewDialogs";
import { AlertIcon, CheckIcon, ChevronRightIcon, EyeIcon, PencilIcon, StoreIcon, XIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { CommissionBox, type ProductCommission } from "~/components/admin/CommissionBox";
import { HomePlacementPanel, pickFields, pickStateFrom, type HomePickRow, type HomePickState } from "~/components/admin/HomePlacementPanel";
import { SkeletonPage } from "~/components/ui/Skeleton";

/**
 * Admin → Products → one product: everything the seller submitted on one
 * page — images, both-language names and descriptions, category / brand,
 * specifications, every child product (colour, images, sizes with SKU and
 * stock, price, discount and its window) and shipping — with the decision:
 * approve, approve with notes, reject (seller can fix and resubmit) or reject
 * permanently (product locked). Decisions go through fn_admin_decide_product.
 */

type Opt = { id: string; label_ar: string; label_en: string; color_hex: string | null };
type BrandRow = {
  id: string; name_ar: string; name_en: string; thumb_path: string | null;
  review_status: string; description_ar: string | null; description_en: string | null;
  country_ar: string | null; country_en: string | null; founded_year: number | null;
  brand_categories: Array<{ category_id: string }> | null;
};
const UUID = /^[0-9a-f-]{36}$/i;

type HistRow = { id: string; action: string; after: Record<string, unknown> | null; created_at: string; actor: string | null };

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const id = params.id ?? "";

  // round 1 — the guard and every read keyed by the product id, together.
  // Category and brand names ride along on the product row (FK embeds), so
  // they no longer wait for it.
  const [viewer, { data: p }, media, groupsRes, pav, history, lastEdit, picksRes, commissionRes] = await Promise.all([
    requirePanelAccess(client, lang, "admin", request),
    client.from("products")
      .select("id, vendor_id, leaf_category_id, brand_id, name_ar, name_en, desc_ar, desc_en, short_ar, short_en, status, rejection_reason, review_note, rejected_final, is_fragile, shipping_mode, weight_g, dims, submitted_at, reviewed_at, reviewed_by, created_at, updated_at, slug_ar, slug_en, source, vendors(id, owner_id, store_name_ar, store_name_en, slug, logo_path, status), categories!products_leaf_category_id_fkey(name_ar, name_en), brands!products_brand_id_fkey(id, name_ar, name_en, thumb_path, review_status, description_ar, description_en, country_ar, country_en, founded_year, brand_categories(category_id))")
      .eq("id", id).is("deleted_at", null).maybeSingle(),
    client.from("product_media").select("path, kind, position").eq("product_id", id).order("position"),
    client.from("variant_groups")
      .select("id, color_option_id, price_piastres, sale_price_piastres, sale_starts_at, sale_ends_at, sort, variant_group_media(path, position), variants(id, size_option_id, stock, sku, deleted_at)")
      .eq("product_id", id).is("deleted_at", null).order("sort"),
    client.from("product_attribute_values")
      .select("attribute_id, option_id, option_ids, value_text, value_text_en, value_number, value_bool, attribute_defs!inner(label_ar, label_en, unit, type, sort, is_variant_axis)")
      .eq("product_id", id).is("attribute_defs.deleted_at", null),
    client.from("audit_logs").select("id, action, after, created_at, actor").eq("entity", "products").eq("entity_id", id)
      .in("action", ["product.submit", "product.review", "product.admin_archive", "product.admin_edit", "product.admin_update", "product.reopened", "product.create", "product.archive", "product.archived"]).order("created_at", { ascending: false }).limit(30),
    // the latest plain edit (vendor or staff) — edits are many, the log shows the last one
    client.from("audit_logs").select("id, action, after, created_at, actor").eq("entity", "products").eq("entity_id", id)
      .eq("action", "product.update").order("created_at", { ascending: false }).limit(1),
    // home sections the reviewer placed this product in (no ad package)
    client.from("product_home_picks").select("section, starts_at, ends_at").eq("product_id", id),
    // the platform commission checkout will charge on it (admin/staff only)
    client.rpc("fn_admin_product_commission", { p_product: id }),
  ]);
  const historyRows = [...((history.data ?? []) as HistRow[]), ...((lastEdit.data ?? []) as HistRow[])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!p) throw new Response("Not found", { status: 404 });
  const { categories: categoryEmbed, brands: brandEmbed, ...productRow } = p as unknown as Record<string, unknown> & {
    categories: { name_ar: string; name_en: string } | null; brands: BrandRow | null;
  };
  const product = productRow as Record<string, unknown> & { id: string; leaf_category_id: string | null; brand_id: string | null };
  const category = { data: categoryEmbed ?? null };
  const brand = { data: brandEmbed ?? null };

  const groups = ((groupsRes.data ?? []) as Array<Record<string, unknown>>).map((g) => ({
    id: g.id as string,
    color_option_id: (g.color_option_id as string | null) ?? null,
    price: (g.price_piastres as number | null) ?? null,
    sale: (g.sale_price_piastres as number | null) ?? null,
    sale_starts_at: (g.sale_starts_at as string | null) ?? null,
    sale_ends_at: (g.sale_ends_at as string | null) ?? null,
    images: ((g.variant_group_media as Array<{ path: string; position: number }> | null) ?? []).sort((a, b) => a.position - b.position).map((m) => m.path),
    sizes: ((g.variants as Array<{ id: string; size_option_id: string | null; stock: number; sku: string | null; deleted_at: string | null }> | null) ?? [])
      .filter((v) => !v.deleted_at).map((v) => ({ id: v.id, size_option_id: v.size_option_id, stock: v.stock, sku: v.sku })),
  }));
  const pavRows = (pav.data ?? []) as unknown as Array<{ attribute_id: string; option_id: string | null; option_ids: string[] | null; value_text: string | null; value_text_en?: string | null; value_number: number | null; value_bool: boolean | null;
    attribute_defs: { label_ar: string; label_en: string; unit: string | null; type: string; sort: number; is_variant_axis: boolean } }>;

  const optionIds = [...new Set([
    ...groups.map((g) => g.color_option_id), ...groups.flatMap((g) => g.sizes.map((s) => s.size_option_id)), ...pavRows.flatMap((r) => (r.option_ids?.length ? r.option_ids : [r.option_id])),
  ].filter((x): x is string => Boolean(x)))];
  // round 2 — option labels and history actor names, in parallel (they used
  // to run one after the other)
  const prodRow = product as unknown as { reviewed_by?: string | null; vendors?: { owner_id?: string | null } | null } | null;
  const actorIds = [...new Set([...historyRows.map((h) => h.actor), prodRow?.reviewed_by ?? null, prodRow?.vendors?.owner_id ?? null].filter((x): x is string => Boolean(x)))];
  const [optsRes, actorsRes] = await Promise.all([
    optionIds.length ? client.from("attribute_options").select("id, label_ar, label_en, color_hex").in("id", optionIds) : Promise.resolve({ data: [] }),
    actorIds.length ? client.from("profiles").select("id, full_name, role").in("id", actorIds) : Promise.resolve({ data: [] }),
  ]);
  const opts = (optsRes.data ?? []) as Opt[];
  const actors = (actorsRes.data ?? []) as Array<{ id: string; full_name: string | null; role: string | null }>;
  const nameOf = new Map(actors.map((a) => [a.id, a.full_name]));
  const roleOf = new Map(actors.map((a) => [a.id, a.role]));
  const ownerId = prodRow?.vendors?.owner_id ?? null;

  // a brand proposed by the seller: the reviewer accepts (completing it) or
  // replaces it, so the page needs the brand form's data only in that case
  const brandRow = brand.data;
  const pendingBrand: PendingBrand | null = brandRow?.review_status === "pending" ? {
    id: brandRow.id, name_ar: brandRow.name_ar, name_en: brandRow.name_en, thumb_path: brandRow.thumb_path,
    description_ar: brandRow.description_ar ?? "", description_en: brandRow.description_en ?? "",
    country_ar: brandRow.country_ar ?? "", country_en: brandRow.country_en ?? "",
    founded_year: brandRow.founded_year,
    category_ids: (brandRow.brand_categories ?? []).map((c) => c.category_id),
  } : null;
  let brandOptions: Array<{ id: string; name_ar: string; name_en: string; thumb_path: string | null }> = [];
  let subCategories: Array<{ id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string }> = [];
  let mediaSettings = parseMediaSettings(null);
  if (pendingBrand) {
    const [brandsRes, catsRes, mediaRow] = await Promise.all([
      client.from("brands").select("id, name_ar, name_en, thumb_path")
        .eq("is_active", true).eq("review_status", "approved").is("deleted_at", null)
        .order("name_ar").limit(2000),
      client.from("categories").select("id, parent_id, depth, name_ar, name_en")
        .lte("depth", 2).eq("is_active", true).is("deleted_at", null).order("sort"),
      client.from("settings").select("value").eq("key", "media").maybeSingle(),
    ]);
    brandOptions = (brandsRes.data ?? []) as typeof brandOptions;
    subCategories = (catsRes.data ?? []) as typeof subCategories;
    mediaSettings = parseMediaSettings(mediaRow.data?.value);
  }

  return {
    lang,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    uid: viewer.user.id,
    mediaSettings,
    // staff with products.edit get the edit action on this page
    canEdit: canAny(viewer.profile.role, viewer.permissions ?? [], ["products.edit"]),
    canPlace: canAny(viewer.profile.role, viewer.permissions ?? [], ["products.review"]),
    homePicks: (picksRes.data ?? []) as HomePickRow[],
    commission: (commissionRes.data ?? null) as ProductCommission | null,
    product,
    // the vendor's account holder and the last reviewer, by name
    ownerName: nameOf.get(prodRow?.vendors?.owner_id ?? "") ?? "",
    reviewerName: nameOf.get(prodRow?.reviewed_by ?? "") ?? "",
    media: (media.data ?? []) as Array<{ path: string; kind: string }>,
    pendingBrand,
    brandOptions,
    subCategories,
    groups,
    options: opts,
    specs: pavRows.filter((r) => !r.attribute_defs.is_variant_axis).sort((a, b) => a.attribute_defs.sort - b.attribute_defs.sort),
    category: category.data as { name_ar: string; name_en: string } | null,
    brand: brand.data as { name_ar: string; name_en: string } | null,
    history: historyRows.map((h) => ({
      ...h,
      actor_name: h.actor ? nameOf.get(h.actor) ?? null : null,
      // who acted: the store owner, the platform team, or the system
      actor_kind: !h.actor ? "system" : h.actor === ownerId ? "vendor" : roleOf.get(h.actor) === "admin" || roleOf.get(h.actor) === "staff" ? "team" : "other",
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "decide");

  // accept the seller's brand (completing its data) or replace it
  if (intent === "accept_brand" || intent === "reject_brand") {
    const brandId = String(form.get("brand_id") ?? "");
    if (!UUID.test(brandId)) return data({ ok: false, reason: "input" }, { status: 400 });
    const yearRaw = String(form.get("founded_year") ?? "").trim();
    const { data: brandRes, error: brandErr } = intent === "accept_brand"
      ? await client.rpc("fn_admin_accept_brand", {
          p_brand: brandId,
          p_name_ar: String(form.get("name_ar") ?? ""),
          p_name_en: String(form.get("name_en") ?? ""),
          p_thumb_path: String(form.get("thumb_path") ?? ""),
          p_description_ar: String(form.get("description_ar") ?? ""),
          p_description_en: String(form.get("description_en") ?? ""),
          p_country_ar: String(form.get("country_ar") ?? ""),
          p_country_en: String(form.get("country_en") ?? ""),
          p_founded_year: /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null,
          p_category_ids: form.getAll("category_ids").map(String).filter((v) => UUID.test(v)),
        })
      : await client.rpc("fn_admin_reject_brand", {
          p_brand: brandId,
          p_replacement: String(form.get("replacement") ?? "") || null,
          p_note: String(form.get("note") ?? "").trim() || null,
        });
    if (brandErr) return data({ ok: false, reason: brandErr.message }, { status: 400 });
    const r = brandRes as { ok?: boolean; reason?: string } | null;
    return r?.ok ? { ok: true as const } : data({ ok: false, reason: r?.reason ?? "failed" }, { status: 400 });
  }

  const homePicks = async () => {
    let sections: string[] = [];
    try { sections = (JSON.parse(String(form.get("home_sections") ?? "[]")) as unknown[]).map(String); } catch { return { ok: false, reason: "input" }; }
    const at = (k: string) => { const v = String(form.get(k) ?? ""); return v && !Number.isNaN(Date.parse(v)) ? v : null; };
    const { data: picked, error: pickErr } = await client.rpc("fn_admin_set_home_picks", {
      p_product: params.id ?? "", p_sections: sections, p_starts: at("home_from"), p_ends: at("home_to"),
    });
    if (pickErr) return { ok: false, reason: pickErr.message };
    return (picked as { ok: boolean; reason?: string } | null) ?? { ok: false, reason: "failed" };
  };
  if (intent === "home_picks") {
    const r = await homePicks();
    return r.ok ? { ok: true as const, picks: true } : data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
  }

  const decision = String(form.get("decision") ?? "");
  const { data: res, error } = await client.rpc("fn_admin_decide_product", {
    p_product: params.id ?? "",
    p_decision: decision,
    p_note: String(form.get("note") ?? "").trim() || null,
    // the version the reviewer had on screen; a newer one is refused as stale
    p_expected_submitted_at: String(form.get("submitted_at") ?? "") || null,
  });
  if (error) return data({ ok: false, reason: error.message }, { status: 400 });
  const r = res as { ok: boolean; reason?: string };
  if (!r.ok) return data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
  // the home placement chosen on the review page goes live with the approval
  if ((decision === "approve" || decision === "approve_notes") && form.has("home_sections")) {
    const picked = await homePicks();
    if (!picked.ok) return data({ ok: false, reason: "picks_failed" }, { status: 400 });
  }
  return { ok: true as const };
}

type Decision = "approve" | "approve_notes" | "reject" | "reject_final";

export default function AdminProductReview({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, supabaseUrl, product: p, media, groups, options, specs, category, brand, history, pendingBrand, brandOptions, subCategories, mediaSettings, uid, canPlace, homePicks, commission } = loaderData;  const en = lang === "en";
  const L = (o: { name_ar?: string; name_en?: string; label_ar?: string; label_en?: string } | null | undefined) =>
    o ? String((en ? o.name_en ?? o.label_en : o.name_ar ?? o.label_ar) ?? "") : "";
  const opt = new Map(options.map((o) => [o.id, o]));
  const money = (v: number | null) => (v == null ? "—" : formatPiastres(v, en ? "en" : "ar"));
  const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const vendor = (p as Record<string, unknown>).vendors as { id: string; owner_id: string; store_name_ar: string; store_name_en: string; slug: string; logo_path: string | null; status: string } | null;
  const status = String(p.status);
  const locked = Boolean(p.rejected_final);
  const pending = status === "pending";

  const fetcher = useFetcher<typeof action>();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const busy = fetcher.state !== "idle";
  const [note, setNote] = useState("");
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  // the seller replaced the version under review while this page was open
  const [staleNotice, setStaleNotice] = useState(false);
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) {
      setConfirmFinal(false);
      setNote("");
      setStaleNotice(false);
      toast.showToast("success", t("productReview.done"));
      return;
    }
    const reason = (fetcher.data as { reason?: string }).reason;
    if (reason === "picks_failed") {
      // the decision went through; only the home placement did not save
      toast.showToast("error", t("productReview.home.failedAfterApprove"));
      revalidator.revalidate();
      return;
    }
    if (reason === "brand_pending") {
      // the RPC refuses to publish a product whose brand is still a proposal
      toast.showToast("error", t("productReview.brand.pendingApprove"));
      return;
    }
    if (reason === "stale" || reason === "not_pending") {
      // reload the loader so the reviewer sees the latest version, no raw text
      setStaleNotice(true);
      revalidator.revalidate();
      return;
    }
    toast.showToast("error", t("errors.generic"));
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // success flash after an admin edit (/admin/products/:id/edit redirects here)
  const edited = searchParams.get("edited") === "1";
  useEffect(() => {
    if (!edited) return;
    toast.showToast("success", t("adminProductEdit.saved"));
    const next = new URLSearchParams(searchParams);
    next.delete("edited");
    setSearchParams(next, { replace: true });
  }, [edited]); // eslint-disable-line react-hooks/exhaustive-deps

  // home page visibility chosen during review (saved with the approval)
  const [picks, setPicks] = useState<HomePickState>(() => pickStateFrom(homePicks));
  const savedPicks = JSON.stringify(pickStateFrom(homePicks));
  useEffect(() => { setPicks(pickStateFrom(homePicks)); }, [savedPicks]); // eslint-disable-line react-hooks/exhaustive-deps
  const picksBad = Boolean(picks.from && picks.to && picks.to < picks.from);
  const pickFetcher = useFetcher<typeof action>();
  const pickHandled = useRef<unknown>(null);
  useEffect(() => {
    if (pickFetcher.state !== "idle" || !pickFetcher.data || pickHandled.current === pickFetcher.data) return;
    pickHandled.current = pickFetcher.data;
    toast.showToast(pickFetcher.data.ok ? "success" : "error", t(pickFetcher.data.ok ? "productReview.home.saved" : "errors.generic"));
  }, [pickFetcher.state, pickFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const savePicks = () => pickFetcher.submit({ intent: "home_picks", ...pickFields(picks) }, { method: "post" });

  const decide = (decision: Decision) => {
    if (decision !== "approve" && note.trim().length < 3) { setNoteError(true); return; }
    if (decision === "reject_final" && !confirmFinal) { setConfirmFinal(true); return; }
    const approving = decision === "approve" || decision === "approve_notes";
    if (approving && canPlace && picksBad) { toast.showToast("error", t("productReview.home.badPeriod")); return; }
    fetcher.submit({ decision, note, submitted_at: String(p.submitted_at ?? ""), ...(approving && canPlace ? pickFields(picks) : {}) }, { method: "post" });
  };

  const [active, setActive] = useState(0);
  const gallery = media.filter((m) => m.kind === "image");
  const totalStock = groups.reduce((n, g) => n + g.sizes.reduce((m, s) => m + s.stock, 0), 0);
  // no variants added: one plain variant (no colour, no size) = the product's own price & stock
  const plainOffer = groups.length === 1 && !groups[0]!.color_option_id && groups[0]!.sizes.every((x) => !x.size_option_id) ? groups[0]! : null;
  const allPrices = groups.map((g) => (g.sale != null && g.price != null && g.sale < g.price ? g.sale : g.price)).filter((n): n is number => n != null);
  const priceRange = allPrices.length === 0 ? "—"
    : Math.min(...allPrices) === Math.max(...allPrices) ? money(Math.min(...allPrices))
    : `${money(Math.min(...allPrices))} – ${money(Math.max(...allPrices))}`;
  const dims = (p as Record<string, unknown>).dims as { l?: number; w?: number; h?: number } | null;

  return (
    <div className="flex flex-col gap-5">
      <Link to={`/${lang}/admin/products`} className="inline-flex items-center gap-1 self-start text-sm font-bold text-action hover:underline">
        <ChevronRightIcon className="size-4 rotate-180 mirr" />{t("productReview.back")}
      </Link>

      {/* summary: picture, names, store, category, live links, key numbers */}
      <header className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
          <div className="grid size-28 shrink-0 place-items-center self-start overflow-hidden rounded-lg border border-border bg-surface-tint sm:size-32">
            {gallery[0] ? (
              <img src={publicMediaUrl(supabaseUrl, gallery[0].path)} alt="" width={128} height={128} className="size-full object-cover" />
            ) : <span className="px-2 text-center text-xs text-text-faint">{t("productReview.noImages")}</span>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status === "approved" ? "success" : status === "rejected" ? "danger" : status === "pending" ? "warning" : "neutral"}>{t(`productReview.status.${status}`)}</Badge>
              {locked ? <Badge tone="danger">{t("productReview.finalBadge")}</Badge> : null}
            </div>
            <h1 className="text-xl font-black leading-snug text-text sm:text-2xl">{String(en ? p.name_en || p.name_ar : p.name_ar || p.name_en)}</h1>
            {(en ? p.name_ar : p.name_en) ? <p className="text-sm text-text-muted" dir={en ? "rtl" : "ltr"}>{String(en ? p.name_ar : p.name_en)}</p> : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {vendor ? (
                <Link to={`/${lang}/admin/users/${vendor.owner_id}?tab=verification`} className="inline-flex items-center gap-2 font-bold text-text hover:text-action">
                  <span className="grid size-7 place-items-center overflow-hidden rounded-full border border-border bg-surface-tint">
                    {vendor.logo_path ? <img src={publicMediaUrl(supabaseUrl, vendor.logo_path)} alt="" width={28} height={28} className="size-full object-cover" /> : <StoreIcon className="size-3.5 text-text-faint" />}
                  </span>
                  {en ? vendor.store_name_en || vendor.store_name_ar : vendor.store_name_ar || vendor.store_name_en}
                  {loaderData.ownerName ? <span className="text-xs font-normal text-text-muted">({t("adminProducts.ownerAccount")}: {loaderData.ownerName})</span> : null}
                </Link>
              ) : null}
              {(status === "approved" || status === "rejected") && loaderData.reviewerName ? (
                <span className="text-text-muted">{t(status === "approved" ? "productReview.approvedBy" : "productReview.rejectedBy")}: <b className="text-text">{loaderData.reviewerName}</b></span>
              ) : null}
              <span className="text-text-muted">{t("productReview.category")}: <b className="text-text">{L(category) || "—"}</b></span>
              <span className="text-text-muted">{t("productReview.brand")}: <b className="text-text">{L(brand) || "—"}</b></span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {loaderData.canEdit ? (
                <Link to={`/${lang}/admin/products/${String(p.id)}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-action px-3 py-1.5 text-xs font-bold text-action hover:bg-primary-soft">
                  <PencilIcon className="size-3.5" />{t("productReview.editProduct")}
                </Link>
              ) : null}
              {status === "approved" && (p.slug_ar || p.slug_en) ? (
                <a href={`/${lang}/product/${encodeURIComponent(String(en ? p.slug_en || p.slug_ar : p.slug_ar || p.slug_en))}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-bold text-text hover:bg-surface-tint">
                  <EyeIcon className="size-3.5" />{t("productReview.viewLive")}
                </a>
              ) : null}
              {vendor?.slug ? (
                <a href={`/${lang}/store/${encodeURIComponent(vendor.slug)}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-bold text-text hover:bg-surface-tint">
                  <StoreIcon className="size-3.5" />{t("productReview.viewStore")}
                </a>
              ) : null}
            </div>
          </div>
        </div>
        {/* key numbers */}
        <dl className="grid grid-cols-2 border-t border-border sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("productReview.stat.price")} value={priceRange} />
          <Stat label={t("productReview.stat.stock")} value={String(totalStock)} tone={totalStock === 0 ? "danger" : undefined} />
          <Stat label={t("productReview.stat.options")} value={String(groups.reduce((n, g) => n + g.sizes.length, 0))} />
          <Stat label={t("productReview.stat.images")} value={String(gallery.length)} tone={gallery.length === 0 ? "danger" : undefined} />
          <Stat label={t("productReview.submitted")} value={when(p.submitted_at)} small />
          <Stat label={t("productReview.stat.updated")} value={when(p.updated_at)} small />
        </dl>
        {status === "rejected" && p.rejection_reason ? <p className="border-t border-border bg-danger-soft px-5 py-2.5 text-sm text-text"><b className="text-danger">{t("productReview.rejectedFor")}:</b> {String(p.rejection_reason)}</p> : null}
        {status === "approved" && p.review_note ? <p className="border-t border-border bg-warning-soft px-5 py-2.5 text-sm text-text"><b>{t("productReview.notes")}:</b> {String(p.review_note)}</p> : null}
      </header>

      {/* a brand the seller proposed: decide it before the product can go live */}
      {pendingBrand ? (
        <section className="flex flex-col gap-3 rounded-lg border-2 border-warning bg-warning-soft p-4">
          <p className="text-sm font-bold text-text">
            {t("productReview.brand.pendingTitle", { ar: pendingBrand.name_ar, en: pendingBrand.name_en })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setAcceptOpen(true)}>{t("productReview.brand.accept")}</Button>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(true)}>{t("productReview.brand.reject")}</Button>
          </div>
        </section>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* images */}
          <Card title={t("productReview.images", { count: gallery.length })}>
            {gallery.length === 0 ? <Empty>{t("productReview.noImages")}</Empty> : (
              <div className="flex flex-col gap-3">
                <a href={publicMediaUrl(supabaseUrl, gallery[active]?.path ?? "")} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-surface-tint">
                  <img src={publicMediaUrl(supabaseUrl, gallery[active]?.path ?? "")} alt="" className="mx-auto aspect-square max-h-[420px] object-contain" />
                </a>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((m, i) => (
                    <button key={m.path} type="button" onClick={() => setActive(i)} aria-label={t("verify.imageN", { n: i + 1 })}
                      className={`size-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 ${i === active ? "border-action" : "border-border"}`}>
                      <img src={publicMediaUrl(supabaseUrl, m.path)} alt="" loading="lazy" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* description */}
          <Card title={t("productReview.description")}>
            <div className="grid gap-4 md:grid-cols-2">
              {(["ar", "en"] as const).map((l) => (
                <div key={l} dir={l === "ar" ? "rtl" : "ltr"} className="min-w-0">
                  <p className="mb-1 text-xs font-bold text-text-muted">{l === "ar" ? "العربية" : "English"}</p>
                  {p[`short_${l}`] ? <p className="mb-2 text-sm font-bold text-text">{String(p[`short_${l}`])}</p> : null}
                  {isRichHtml(String(p[`desc_${l}`] ?? "")) ? (
                    <div className="richText text-sm leading-relaxed text-text" dangerouslySetInnerHTML={{ __html: sanitizeProductHtml(String(p[`desc_${l}`])) }} />
                  ) : (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-text">{String(p[`desc_${l}`] || "—")}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* a product without variants is stored as ONE plain variant (no colour, no size):
              show it as the product's own price & stock, not as "variant #1" */}
          {plainOffer ? (
            <Card title={t("productReview.priceStock")}>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                <Row label={t("productReview.price")} value={money(plainOffer.price)} />
                {plainOffer.sale != null && plainOffer.price != null && plainOffer.sale < plainOffer.price ? (
                  <>
                    <Row label={t("productReview.salePrice")} value={money(plainOffer.sale)} />
                    <Row label={t("productReview.saleWindow")} value={`${when(plainOffer.sale_starts_at)} → ${plainOffer.sale_ends_at ? when(plainOffer.sale_ends_at) : t("productReview.noEnd")}`} />
                  </>
                ) : null}
                <Row label={t("productReview.stock")} value={String(plainOffer.sizes[0]?.stock ?? 0)} />
                <Row label="SKU" value={plainOffer.sizes[0]?.sku ?? "—"} />
              </dl>
            </Card>
          ) : (
          <Card title={t("productReview.children", { count: groups.length, stock: totalStock })}>
            {groups.length === 0 ? <Empty>{t("productReview.noChildren")}</Empty> : (
              <div className="flex flex-col gap-3">
                {groups.map((g, i) => {
                  const color = g.color_option_id ? opt.get(g.color_option_id) : undefined;
                  const onSale = g.sale != null && g.price != null && g.sale < g.price;
                  return (
                    <div key={g.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-text-muted">#{i + 1}</span>
                        {color?.color_hex ? <span className="size-4 rounded-full border border-border" style={{ background: color.color_hex }} /> : null}
                        <b className="text-sm text-text">{color ? L(color) : t("productReview.noColor")}</b>
                        <span className="ms-auto text-sm">
                          {onSale ? <><b className="text-danger">{money(g.sale)}</b> <s className="text-text-muted">{money(g.price)}</s></> : <b className="text-text">{money(g.price)}</b>}
                        </span>
                      </div>
                      {onSale ? (
                        <p className="mt-1 text-xs text-text-muted">{t("productReview.saleWindow")}: <span className="num">{when(g.sale_starts_at)}</span> → <span className="num">{g.sale_ends_at ? when(g.sale_ends_at) : t("productReview.noEnd")}</span></p>
                      ) : null}
                      {g.images.length ? (
                        <div className="mt-2 flex gap-1.5 overflow-x-auto">
                          {g.images.map((path) => (
                            <a key={path} href={publicMediaUrl(supabaseUrl, path)} target="_blank" rel="noreferrer" className="size-14 shrink-0 overflow-hidden rounded border border-border">
                              <img src={publicMediaUrl(supabaseUrl, path)} alt="" loading="lazy" className="size-full object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : <p className="mt-2 text-xs text-warning-strong">{t("productReview.childNoImages")}</p>}
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[320px] text-sm">
                          <thead><tr className="text-start text-xs text-text-muted">
                            <th className="py-1 text-start font-bold">{t("productReview.size")}</th>
                            <th className="py-1 text-start font-bold">SKU</th>
                            <th className="py-1 text-end font-bold">{t("productReview.stock")}</th>
                          </tr></thead>
                          <tbody className="divide-y divide-border">
                            {g.sizes.map((s) => (
                              <tr key={s.id}>
                                <td className="py-1.5 font-bold text-text">{s.size_option_id ? L(opt.get(s.size_option_id)) : t("productReview.oneSize")}</td>
                                <td className="num py-1.5 text-xs text-text-muted" dir="ltr">{s.sku ?? "—"}</td>
                                <td className={`num py-1.5 text-end font-bold ${s.stock === 0 ? "text-danger" : "text-text"}`}>{s.stock}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          )}

          {/* specs + shipping */}
          <Card title={t("productReview.specs")}>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              {specs.map((s) => {
                const chosen = (s.option_ids?.length ? s.option_ids : s.option_id ? [s.option_id] : []).map((id) => opt.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
                const value = chosen.length ? chosen.map((o) => L(o)).join(en ? ", " : "، ") : (s.value_text || s.value_text_en) ? [s.value_text, s.value_text_en].filter(Boolean).map((v) => withUnit(v as string, s.attribute_defs.unit, en ? "en" : "ar")).join(" / ") : (s.value_number != null ? `${s.value_number}${unitLabel(s.attribute_defs.unit, en ? "en" : "ar") ? ` ${unitLabel(s.attribute_defs.unit, en ? "en" : "ar")}` : ""}` : s.value_bool != null ? t(s.value_bool ? "common.yes" : "common.no") : "—");
                return <Row key={s.attribute_id} label={en ? s.attribute_defs.label_en : s.attribute_defs.label_ar} value={value} />;
              })}
              {/* the form no longer asks for weight: older products may still carry it */}
              {p.weight_g ? <Row label={t("productReview.weight")} value={`${String(p.weight_g)} g`} /> : null}
              {dims && (dims.l || dims.w || dims.h) ? <Row label={t("productReview.dims")} value={`${dims.l ?? "—"} × ${dims.w ?? "—"} × ${dims.h ?? "—"} cm`} /> : null}
              <Row label={t("productReview.shipping")} value={t(p.shipping_mode === "vendor" ? "store.product.shippedByVendor" : "store.product.shippedByPlatform")} />
              <Row label={t("productReview.fragile")} value={t(p.is_fragile ? "common.yes" : "common.no")} />
            </dl>
          </Card>
        </div>

        {/* decision */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <CommissionBox data={commission} groups={groups} lang={lang} />
          <section className="flex flex-col gap-3 rounded-lg border-2 border-action/40 bg-surface p-4 shadow-1">
            <h2 className="text-base font-extrabold text-text">{t("productReview.decision")}</h2>
            {staleNotice ? (
              <p role="alert" className="rounded-md border border-warning/60 bg-warning-soft px-3 py-2 text-xs font-bold text-warning-strong">
                {t("productReview.staleNotice")}
              </p>
            ) : null}
            {locked ? <p className="text-sm text-danger">{t("productReview.lockedHint")}</p> : (
              <>
                <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
                  {t("productReview.noteLabel")}
                  <textarea value={note} onChange={(e) => { setNote(e.target.value); setNoteError(false); }} rows={4}
                    aria-invalid={noteError || undefined}
                    className={`rounded-md border bg-surface px-3 py-2 text-sm font-normal ${noteError ? "border-danger" : "border-border"}`}
                    placeholder={t("productReview.notePlaceholder")} />
                  <span className={`text-xs font-normal ${noteError ? "text-danger" : "text-text-muted"}`}>{t("productReview.noteHint")}</span>
                </label>
                {pending ? (
                  <>
                    <Button loading={busy} onClick={() => decide("approve")}><CheckIcon className="size-4" />{t("productReview.approve")}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => decide("approve_notes")}>{t("productReview.approveNotes")}</Button>
                    <Button variant="outline" className="border-warning text-warning-strong" disabled={busy} onClick={() => decide("reject")}><XIcon className="size-4" />{t("productReview.returnForChanges")}</Button>
                  </>
                ) : status === "approved" ? (
                  <Button variant="outline" className="border-warning text-warning-strong" disabled={busy} onClick={() => decide("reject")}>
                    <AlertIcon className="size-4" />{t("productReview.returnForChanges")}
                  </Button>
                ) : <p className="text-xs text-text-muted">{t("productReview.notPending")}</p>}
                <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => decide("reject_final")}>
                  <AlertIcon className="size-4" />{t("productReview.rejectFinal")}
                </Button>
              </>
            )}
          </section>

          {canPlace && !locked && (pending || status === "approved") ? (
            <HomePlacementPanel value={picks} onChange={setPicks} disabled={busy}
              live={status === "approved" && homePicks.length > 0}
              onSave={status === "approved" ? savePicks : undefined} saving={pickFetcher.state !== "idle"} />
          ) : null}

          <section className="rounded-lg border border-border bg-surface shadow-1">
            <h2 className="border-b border-border px-4 py-3 text-sm font-extrabold text-text">{t("productReview.history")}</h2>
            {(() => {
              // the last person who reviewed (approved / rejected) and who last edited
              const lastReview = history.find((h) => h.action === "product.review");
              const lastEditRow = history.find((h) => ["product.update", "product.admin_edit", "product.admin_update"].includes(h.action));
              if (!lastReview && !lastEditRow) return null;
              return (
                <dl className="grid gap-2 border-b border-border bg-surface-tint/50 px-4 py-3 text-xs">
                  {lastReview ? (
                    <div className="flex flex-wrap gap-1"><dt className="text-text-muted">{t("productReview.lastReview")}:</dt>
                      <dd className="font-bold text-text">{lastReview.actor_name ?? "—"} · {t(`productReview.event.${String(lastReview.after?.decision ?? "approved")}`)} · <span className="num">{when(lastReview.created_at)}</span></dd></div>
                  ) : null}
                  {lastEditRow ? (
                    <div className="flex flex-wrap gap-1"><dt className="text-text-muted">{t("productReview.lastEdit")}:</dt>
                      <dd className="font-bold text-text">{lastEditRow.actor_name ?? "—"}{lastEditRow.actor_kind !== "other" ? ` (${t(`productReview.actor.${lastEditRow.actor_kind}`)})` : ""} · <span className="num">{when(lastEditRow.created_at)}</span></dd></div>
                  ) : null}
                </dl>
              );
            })()}
            {history.length === 0 ? <p className="px-4 py-3 text-xs text-text-muted">{t("adminVerify.noHistory")}</p> : (
              <ol className="divide-y divide-border">
                {history.map((h) => {
                  const decision = (h.after?.decision as string | undefined) ?? (h.action === "product.submit" ? "submit" : String(h.after?.status ?? ""));
                  // staff edits / automatic reopen have their own labels
                  const eventKey = h.action === "product.admin_edit" ? "admin_edit"
                    : h.action === "product.admin_update" ? "admin_update"
                    : h.action === "product.reopened" ? "reopened"
                    : h.action === "product.update" ? "edited"
                    : h.action === "product.create" ? "created"
                    : h.action === "product.archive" || h.action === "product.archived" ? "archived"
                    : decision;
                  return (
                    <li key={h.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm">
                      <b className="text-text">{t(`productReview.event.${eventKey}`, eventKey)}</b>
                      {h.after?.note || h.after?.reason ? <span className="text-xs text-text-muted">{String(h.after?.note ?? h.after?.reason)}</span> : null}
                      <span className="text-2xs text-text-faint">
                        <b className="text-text-muted">{h.actor_name ?? t("productReview.actor.system")}</b>
                        {h.actor_kind !== "other" ? ` (${t(`productReview.actor.${h.actor_kind}`)})` : ""} · <span className="num">{when(h.created_at)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>

      <Dialog open={confirmFinal} onClose={() => setConfirmFinal(false)} title={t("productReview.finalTitle")}>
        <div className="flex flex-col gap-3 p-1">
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{t("productReview.finalWarning")}</p>
          <p className="text-sm text-text"><b>{t("productReview.noteLabel")}:</b> {note}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmFinal(false)}>{t("common.cancel")}</Button>
            <Button className="bg-danger hover:bg-danger" loading={busy} onClick={() => decide("reject_final")}>{t("productReview.rejectFinal")}</Button>
          </div>
        </div>
      </Dialog>

      {pendingBrand ? (
        <>
          <AcceptBrandDialog
            open={acceptOpen}
            onClose={() => setAcceptOpen(false)}
            brand={pendingBrand}
            categories={subCategories}
            media={mediaSettings}
            uid={uid}
            supabaseUrl={supabaseUrl}
            onSuccess={() => {
              setAcceptOpen(false);
              toast.showToast("success", t("productReview.brand.accepted"));
              revalidator.revalidate();
            }}
          />
          <RejectBrandDialog
            open={rejectOpen}
            onClose={() => setRejectOpen(false)}
            brand={pendingBrand}
            brands={brandOptions}
            supabaseUrl={supabaseUrl}
            onSuccess={() => {
              setRejectOpen(false);
              toast.showToast("success", t("productReview.brand.rejected"));
              revalidator.revalidate();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-1">
      <h2 className="mb-3 text-sm font-extrabold text-text">{title}</h2>
      {children}
    </section>
  );
}
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-end font-bold text-text">{value}</dd>
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-text-muted">{children}</p>;
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

export function HydrateFallback() {
  return <SkeletonPage />;
}

function Stat({ label, value, tone, small = false }: { label: string; value: string; tone?: "danger"; small?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-e border-border px-4 py-3 lg:border-b-0 lg:last:border-e-0">
      <dt className="text-2xs font-bold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={`num font-extrabold ${small ? "text-xs" : "text-base"} ${tone === "danger" ? "text-danger" : "text-text"}`}>{value}</dd>
    </div>
  );
}
