import type { Route } from "./+types/product-wizard";
import { data, redirect, useFetcher, useNavigate } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "~/components/ui/Overlay";
import { Button } from "~/components/ui/Button";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow } from "~/features/vendor/api";
import { parseMediaSettings } from "~/lib/media.shared";
import {
  ProductWizard,
  type TemplateOption,
} from "~/features/products/components/product-wizard";
import type { SaveActionData } from "~/features/products/components/product-wizard";
import {
  loadBrands,
  loadSizeOptions,
  loadTemplate,
  loadWizardCategories,
  loadWizardProduct,
  loadWizardTags,
  saveChildrenRpc,
} from "~/features/products/wizard-loader.server";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * /vendor/products/new + /vendor/products/:id/edit — the 5-step wizard.
 * Server action maps every intent onto the definer RPCs (atomic multi-row
 * writes); loaders feed the template that generates the form. Product loading
 * is shared with the admin editor (`features/products/wizard-loader.server`).
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw redirect(`/${lang}/auth/login?error=db`);
  }
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor) {
    throw redirect(`/${lang}/vendor/onboarding`);
  }
  const productId = params.id ?? null;
  if (!productId && vendor.status === "pending") {
    throw redirect(`/${lang}/vendor/products?underReview=1`);
  }

  const bundle = productId ? await loadWizardProduct(client, productId, vendor.id) : null;
  if (productId && !bundle) throw redirect(`/${lang}/vendor/products`);

  const [categories, tags, mediaRow] = await Promise.all([
    // only the branches the seller chose at registration (vendors.category_ids)
    loadWizardCategories(client, vendor.category_ids ?? []),
    loadWizardTags(client),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);

  // "Add product" with an unfinished draft on file → offer to resume it or start over
  let resumeDraft: { id: string; name: string; updated_at: string } | null = null;
  if (!productId && !new URL(request.url).searchParams.has("fresh")) {
    const { data: draft } = await client.from("products").select("id, name_ar, name_en, updated_at")
      .eq("vendor_id", vendor.id).eq("status", "draft").is("deleted_at", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (draft) resumeDraft = { id: draft.id, name: (lang === "ar" ? draft.name_ar || draft.name_en : draft.name_en || draft.name_ar) || "", updated_at: draft.updated_at };
  }
  const leafForRule = bundle?.product.leaf_category_id ?? null;
  const { data: blocked } = leafForRule
    ? await client.rpc("fn_vendor_shipping_blocked", { p_category: leafForRule })
    : { data: true };

  return data({
    lang,
    uid: viewer.user.id,
    resumeDraft,
    shippingBlocked: blocked === true,
    product: bundle?.product ?? null,
    template: bundle?.template ?? [],
    childrenData: bundle?.childrenData ?? [],
    sizeOptions: bundle?.sizeOptions ?? [],
    categories,
    // only the brands of the product's category; picking a category fetches its own (intent "template")
    brands: bundle?.brands ?? [],
    tags,
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    // the platform commission is for the platform team only: admin/staff viewers
    commissionVendorId: viewer.profile.role === "admin" || viewer.profile.role === "staff" ? vendor.id : null,
  });
}

async function productUpdatedAt(client: SupabaseClient, productId: string | null): Promise<string | undefined> {
  if (!productId) return undefined;
  const { data: row } = await client.from("products").select("updated_at").eq("id", productId).maybeSingle();
  return (row?.updated_at as string | undefined) ?? undefined;
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<SaveActionData>({ intent: "save", ok: false, error: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const productId = (String(form.get("productId") ?? "") || null) as string | null;

  if (intent === "save") {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(form.get("payload") ?? "{}")) as Record<string, unknown>;
    } catch {
      return data<SaveActionData>({ intent, ok: false, error: "payload" }, { status: 400 });
    }
    // two-tab conflict (US-10): last save wins, but the vendor is warned
    let stale = false;
    if (productId) {
      const { data: current } = await client
        .from("products")
        .select("updated_at")
        .eq("id", productId)
        .maybeSingle();
      const base = String(form.get("baseUpdatedAt") ?? "");
      if (current?.updated_at && base && current.updated_at !== base) stale = true;
    }
    const { data: saved, error } = await client.rpc("fn_save_product", {
      p_product: payload,
      p_id: productId,
    });
    if (error) {
      console.error("[product-wizard:save]", error.message);
      return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    }
    const result = saved as { id: string; updated_at: string; status: string };
    return data<SaveActionData>({
      intent,
      ok: true,
      stale,
      updatedAt: result.updated_at,
      productId: result.id,
      // pending/approved products come back as draft after the first save
      status: result.status,
      redirectTo: productId ? undefined : `/${lang}/vendor/products/${result.id}/edit`,
    });
  }

  // The template is loader-only today, and the loader reads it solely when a
  // productId exists — so a vendor creating a product picked a category and the
  // attributes step stayed empty until an autosave reloaded the page.
  if (intent === "template") {
    const leafId = String(form.get("leaf_category_id") ?? "") || null;
    const vendor = await fetchVendorRow(client, viewer.user.id);
    const [template, sizeOptions, blocked, brands] = await Promise.all([
      loadTemplate(client, leafId),
      loadSizeOptions(client, leafId),
      leafId ? client.rpc("fn_vendor_shipping_blocked", { p_category: leafId }).then((r: { data: unknown }) => r.data === true) : Promise.resolve(true),
      loadBrands(client, leafId, null, vendor?.id),
    ]);
    return { intent, ok: true as const, template, sizeOptions, shippingBlocked: blocked, brands };
  }

  // a brand the catalogue does not have: the seller proposes it, a reviewer
  // completes its data before it goes live with the product
  if (intent === "propose_brand") {
    const { data: res, error } = await client.rpc("fn_vendor_propose_brand", {
      p_name_ar: String(form.get("name_ar") ?? ""),
      p_name_en: String(form.get("name_en") ?? ""),
      p_category: String(form.get("category_id") ?? ""),
    });
    if (error) return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    const r = res as { ok?: boolean; reason?: string; existing?: boolean; id?: string; name_ar?: string; name_en?: string; thumb_path?: string | null } | null;
    if (!r?.ok) return data<SaveActionData>({ intent, ok: false, error: r?.reason ?? "failed" }, { status: 400 });
    return data<SaveActionData>({
      intent, ok: true, existing: Boolean(r.existing),
      brand: { id: String(r.id), name_ar: String(r.name_ar ?? ""), name_en: String(r.name_en ?? ""), thumb_path: r.thumb_path ?? null, pending: !r.existing },
    });
  }

  // edit a submitted / published product: it goes back to draft (and off the
  // store) until it is submitted and approved again; the loader then reloads editable
  if (intent === "reopen") {
    if (!productId) return data<SaveActionData>({ intent, ok: false, error: "input" }, { status: 400 });
    const { data: res, error } = await client.rpc("fn_vendor_reopen_product", { p_product_id: productId });
    const r = res as { ok?: boolean; reason?: string } | null;
    if (error || !r?.ok) return data<SaveActionData>({ intent, ok: false, error: error?.message ?? r?.reason ?? "failed" }, { status: 400 });
    return data<SaveActionData>({ intent, ok: true });
  }

  // a seller's own colour (device colour picker + name); the same hex is reused
  if (intent === "add_color") {
    const { data: color, error } = await client.rpc("fn_vendor_add_color", {
      p_hex: String(form.get("hex") ?? ""), p_label_ar: String(form.get("name") ?? ""), p_label_en: String(form.get("name_en") ?? "").trim() || null,
    });
    if (error) {
      const code = /too_many_colors/.test(error.message) ? "too_many_colors" : /name_required|bad_hex/.test(error.message) ? "bad_input" : "failed";
      return data<SaveActionData>({ intent, ok: false, error: code }, { status: 400 });
    }
    return data<SaveActionData>({ intent, ok: true, color: color as TemplateOption });
  }

  // "start over" on the resume prompt: the unfinished draft is archived
  if (intent === "discard_draft") {
    const draftId = String(form.get("draftId") ?? "");
    const { error } = await client.rpc("fn_archive_product", { p_product_id: draftId });
    if (error) return data<SaveActionData>({ intent: "save", ok: false, error: error.message }, { status: 400 });
    return data<SaveActionData>({ intent: "save", ok: true });
  }

  if (intent === "save_children") {
    const saved = await saveChildrenRpc(client, productId, String(form.get("children") ?? "[]"));
    if (!saved.ok) return data<SaveActionData>({ intent, ok: false, error: saved.error }, { status: 400 });
    // fn_save_children bumps products.updated_at — hand it back so the next
    // autosave doesn't mistake this session's own write for another tab's
    const updatedAt = await productUpdatedAt(client, productId);
    return data<SaveActionData>({ intent, ok: true, children: saved.children, updatedAt });
  }

  if (intent === "submit") {
    if (!productId) return data<SaveActionData>({ intent, ok: false, error: "not_saved" }, { status: 400 });
    // flush the latest product fields first (the debounced autosave may not
    // have fired yet), then children (the gate checks their prices/SKUs), then review
    const rawPayload = String(form.get("payload") ?? "");
    if (rawPayload) {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(rawPayload) as Record<string, unknown>; } catch {
        return data<SaveActionData>({ intent, ok: false, error: "payload" }, { status: 400 });
      }
      const { error: saveErr } = await client.rpc("fn_save_product", { p_product: payload, p_id: productId });
      if (saveErr) return data<SaveActionData>({ intent, ok: false, error: saveErr.message }, { status: 400 });
    }
    const saved = await saveChildrenRpc(client, productId, String(form.get("children") ?? "[]"));
    if (!saved.ok) return data<SaveActionData>({ intent, ok: false, error: saved.error }, { status: 400 });
    const { error } = await client.rpc("fn_submit_product", { p_product_id: productId });
    if (error) return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    return data<SaveActionData>({ intent, ok: true, redirectTo: `/${lang}/vendor/products` });
  }

  return data<SaveActionData>({ intent: "save", ok: false, error: "intent" }, { status: 400 });
}

export default function ProductWizardRoute({ loaderData }: Route.ComponentProps) {
  return (
    <>
    {loaderData.resumeDraft ? <ResumeDraftPrompt draft={loaderData.resumeDraft} lang={loaderData.lang} /> : null}
    <ProductWizard
      key={loaderData.product?.id ?? (loaderData.resumeDraft ? "pending-choice" : "new")}
      shippingBlocked={loaderData.shippingBlocked}
      uid={loaderData.uid}
      supabaseUrl={loaderData.supabaseUrl}
      media={loaderData.media}
      product={loaderData.product}
      template={loaderData.template}
      categories={loaderData.categories}
      brands={loaderData.brands}
      tags={loaderData.tags}
      childrenData={loaderData.childrenData}
      sizeOptions={loaderData.sizeOptions}
      isAr={loaderData.lang === "ar"}
      commissionVendorId={loaderData.commissionVendorId}
    />
    </>
  );
}

/** Resume the unfinished draft, or archive it and start a fresh product. */
function ResumeDraftPrompt({ draft, lang }: { draft: { id: string; name: string; updated_at: string }; lang: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetcher = useFetcher<SaveActionData>();
  const [open, setOpen] = useState(true);
  const fresh = () => {
    fetcher.submit({ intent: "discard_draft", draftId: draft.id }, { method: "post" });
    setOpen(false);
    navigate(`/${lang}/vendor/products/new?fresh=1`, { replace: true });
  };
  return (
    <Dialog open={open} onClose={() => navigate(`/${lang}/vendor/products/new?fresh=1`, { replace: true })} title={t("productWizard.resume.title")}>
      <div className="flex flex-col gap-4">
        {/* the date is formatted by the server's and the browser's ICU, which differ for Arabic */}
        <p className="text-sm text-text-muted" suppressHydrationWarning>
          {t("productWizard.resume.body", {
            name: draft.name || t("vendor.products.untitled"),
            when: new Date(draft.updated_at).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }),
          })}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" className="text-danger" onClick={fresh} loading={fetcher.state !== "idle"}>{t("productWizard.resume.fresh")}</Button>
          <Button type="button" onClick={() => navigate(`/${lang}/vendor/products/${draft.id}/edit`, { replace: true })}>{t("productWizard.resume.continue")}</Button>
        </div>
      </div>
    </Dialog>
  );
}


/**
 * The wizard's own background requests (autosave, variants save, category
 * template) must not re-run the loader: on /products/new the first autosave
 * creates the draft, and a reload then "found" that very draft and asked the
 * seller whether to resume it or start over. The wizard keeps its own state
 * from the action results.
 */
const NO_RELOAD_INTENTS = new Set(["save", "save_children", "template", "add_color", "propose_brand"]);
export function shouldRevalidate({ formData, defaultShouldRevalidate }: { formData?: FormData; defaultShouldRevalidate: boolean }) {
  const intent = formData?.get("intent");
  if (typeof intent === "string" && NO_RELOAD_INTENTS.has(intent)) return false;
  return defaultShouldRevalidate;
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
