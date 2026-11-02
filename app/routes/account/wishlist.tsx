import { useState } from "react";
import { Link, data } from "react-router";
import type { Route } from "./+types/wishlist";
import { useTranslation } from "react-i18next";

import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { effectivePrice, type ProductCard } from "~/features/storefront/api";
import { formatPiastres } from "~/lib/money";
import { MediaImg } from "~/components/catalog/MediaImg";
import { AddToCartButton } from "~/features/account/AddToCartButton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Account wishlist (O-21 / AGENT §30): one row per (user, product) with
 * unavailable states, remove and move-to-cart. RLS scopes everything.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const { data: rows, error } = await client
    .from("wishlist_items")
    .select("product_id, created_at")
    .eq("user_id", viewer.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const ids = ((rows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
  // live cards through the storefront view (draft/hidden products return nothing)
  const { data: cards } = ids.length > 0
    ? await client.from("v_storefront_products").select("*").in("id", ids)
    : { data: [] };
  const byId = new Map(((cards ?? []) as unknown as ProductCard[]).map((c) => [c.id, c]));
  const items = ids.map((id) => ({ product_id: id, product: byId.get(id) ?? null }));
  return { lang, items: JSON.parse(JSON.stringify(items)) };
}

export default function AccountWishlistPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");

  if (loaderData.items.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        {t("wishlist.empty")}{" "}
        <Link to={`/${loaderData.lang}/products`} className="font-bold text-action hover:underline">{t("wishlist.browse")}</Link>
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {loaderData.items.map((it: { product_id: string; product: ProductCard | null }) => {
        const p = it.product;
        const unavailable = p === null || !p.is_listable;
        return (
          <li key={it.product_id} className="flex gap-3 rounded-m border border-border bg-surface p-3">
            {p ? (
              <Link to={`/${loaderData.lang}/product/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`} className="shrink-0">
                <MediaImg path={p.main_image_path ?? ""} alt={en ? p.name_en : p.name_ar} className="size-20 rounded-m border border-border object-cover" />
              </Link>
            ) : (
              <div className="flex size-20 shrink-0 items-center justify-center rounded-m border border-border bg-surface-tint text-xs text-text-faint">
                {t("wishlist.gone")}
              </div>
            )}
            <div className="min-w-0 flex-1">
              {p ? (
                <>
                  <Link to={`/${loaderData.lang}/product/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`} className="block truncate text-[13px] font-bold text-text hover:text-action">
                    {en ? p.name_en : p.name_ar}
                  </Link>
                  <p className="text-[13px] font-extrabold text-text">{money(effectivePrice(p))}</p>
                  {unavailable ? (
                    <p className="mt-1 text-xs text-danger">{t("wishlist.unavailable")}</p>
                  ) : (
                    <div className="mt-2">
                      <AddToCartButton productId={p.id} label={t("wishlist.moveToCart")} />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-text-muted">{t("wishlist.goneBody")}</p>
              )}
              <RemoveWishButton productId={it.product_id} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RemoveWishButton({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const [removed, setRemoved] = useState(false);
  const remove = async () => {
    await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, intent: "remove" }),
    });
    setRemoved(true);
  };
  if (removed) return <span className="mt-1.5 block text-xs text-text-faint">{t("wishlist.removed")}</span>;
  return (
    <button type="button" onClick={() => void remove()} className="mt-1.5 cursor-pointer text-xs font-bold text-danger hover:underline">
      {t("wishlist.remove")}
    </button>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
