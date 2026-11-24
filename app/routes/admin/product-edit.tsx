import type { Route } from "./+types/product-edit";
import { Link, data, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess, requirePermission } from "~/lib/auth/guards";
import { parseMediaSettings } from "~/lib/media.shared";
import { ProductWizard } from "~/features/products/components/product-wizard";
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
 * /admin/products/:id/edit — the seller wizard in admin mode. Anyone with
 * products.edit may change every field of any seller's product, whatever its
 * status (a pending product is edited in place, not withdrawn), with a
 * mandatory reason the seller sees in their notification.
 *
 * Only the reason is required on top of the seller flow: fn_save_product →
 * fn_save_children → fn_admin_log_product_edit.
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw redirect(`/${lang}/auth/login?error=db`);
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "products.edit");

  const productId = params.id ?? "";
  const bundle = await loadWizardProduct(client, productId);
  if (!bundle) throw new Response("Not found", { status: 404 });

  const [categories, tags, mediaRow, ownerRow] = await Promise.all([
    loadWizardCategories(client),
    loadWizardTags(client),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
    client.from("products").select("vendor_id").eq("id", productId).maybeSingle(),
  ]);
  const leaf = bundle.product.leaf_category_id;
  const { data: blocked } = leaf
    ? await client.rpc("fn_vendor_shipping_blocked", { p_category: leaf })
    : { data: true };

  return data({
    lang,
    uid: viewer.user.id,
    product: bundle.product,
    template: bundle.template,
    childrenData: bundle.childrenData,
    sizeOptions: bundle.sizeOptions,
    brands: bundle.brands,
    categories,
    tags,
    store: bundle.store,
    // the platform commission box (this page is admin/staff only)
    commissionVendorId: (ownerRow.data?.vendor_id as string | undefined) ?? null,
    shippingBlocked: blocked === true,
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<SaveActionData>({ intent: "admin_save", ok: false, error: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "products.edit");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const productId = String(form.get("productId") ?? params.id ?? "");

  // the category picker fetches the leaf template of the picked category
  if (intent === "template") {
    const leafId = String(form.get("leaf_category_id") ?? "") || null;
    const [template, sizeOptions, blocked, brands] = await Promise.all([
      loadTemplate(client, leafId),
      loadSizeOptions(client, leafId),
      leafId ? client.rpc("fn_vendor_shipping_blocked", { p_category: leafId }).then((r: { data: unknown }) => r.data === true) : Promise.resolve(true),
      loadBrands(client, leafId),
    ]);
    return { intent: "template" as const, ok: true as const, template, sizeOptions, shippingBlocked: blocked, brands };
  }

  if (intent !== "admin_save") return data<SaveActionData>({ intent: "admin_save", ok: false, error: "intent" }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return data<SaveActionData>({ intent, ok: false, error: "input" }, { status: 400 });
  }
  // the reason is shown to the seller: trimmed, 5–500 characters
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  if (reason.length < 5) return data<SaveActionData>({ intent, ok: false, error: "reason_required" }, { status: 400 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}")) as Record<string, unknown>;
  } catch {
    return data<SaveActionData>({ intent, ok: false, error: "payload" }, { status: 400 });
  }

  const { error: saveErr } = await client.rpc("fn_save_product", { p_product: payload, p_id: productId });
  if (saveErr) {
    console.error("[admin-product-edit:save]", saveErr.message);
    return data<SaveActionData>({ intent, ok: false, error: saveErr.message }, { status: 400 });
  }
  const saved = await saveChildrenRpc(client, productId, String(form.get("children") ?? "[]"));
  if (!saved.ok) return data<SaveActionData>({ intent, ok: false, error: saved.error }, { status: 400 });

  const { data: logged, error: logErr } = await client.rpc("fn_admin_log_product_edit", { p_product_id: productId, p_reason: reason });
  if (logErr) {
    console.error("[admin-product-edit:log]", logErr.message);
    return data<SaveActionData>({ intent, ok: false, error: logErr.message }, { status: 400 });
  }
  const r = logged as { ok: boolean; reason?: string };
  if (!r?.ok) return data<SaveActionData>({ intent, ok: false, error: r?.reason ?? "failed" }, { status: 400 });

  return data<SaveActionData>({ intent, ok: true, redirectTo: `/${lang}/admin/products/${productId}?edited=1` });
}

export default function AdminProductEdit({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, store } = loaderData;
  const storeName = lang === "en" ? store?.name_en || store?.name_ar : store?.name_ar || store?.name_en;
  return (
    <div className="flex flex-col gap-4">
      <Link to={`/${lang}/admin/products/${loaderData.product.id ?? ""}`} className="self-start text-sm font-bold text-action hover:underline">
        {t("adminProductEdit.back")}
      </Link>
      <ProductWizard
        key={loaderData.product.id ?? "admin-edit"}
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
        isAr={lang === "ar"}
        mode="admin"
        commissionVendorId={loaderData.commissionVendorId}
        storeName={storeName}
      />
    </div>
  );
}

/** the template fetcher keeps its result; the save navigates by itself */
export function shouldRevalidate({ formData, defaultShouldRevalidate }: { formData?: FormData; defaultShouldRevalidate: boolean }) {
  const intent = formData?.get("intent");
  return intent === "template" ? false : defaultShouldRevalidate;
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

export function HydrateFallback() {
  return <SkeletonForm />;
}
