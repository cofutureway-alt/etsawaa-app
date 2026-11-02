import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/recent";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { effectivePrice, type ProductCard } from "~/features/storefront/api";
import { formatPiastres } from "~/lib/money";
import { MediaImg } from "~/components/catalog/MediaImg";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Recently viewed (O-29 / AGENT §30): the last 20 products, most recent
 * first, deduplicated; "clear history" wipes the account rows (guest history
 * merges into the DB on sign-in — the cart provider already does that).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  // one row per product (composite PK) — newest first, cap 20
  const { data: rows, error } = await client
    .from("recently_viewed")
    .select("product_id, viewed_at")
    .eq("user_id", viewer.user.id)
    .order("viewed_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const ids = ((rows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
  const { data: cards } = ids.length > 0
    ? await client.from("v_storefront_products").select("*").in("id", ids)
    : { data: [] };
  const byId = new Map(((cards ?? []) as unknown as ProductCard[]).map((c) => [c.id, c]));
  const items = ids.map((id) => ({ product_id: id, product: byId.get(id) ?? null }));
  return { lang, items: JSON.parse(JSON.stringify(items)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const { error } = await client.from("recently_viewed").delete().eq("user_id", viewer.user.id);
  return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
}

export default function AccountRecentPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();

  return (
    <div>
      {loaderData.items.length > 0 ? (
        <fetcher.Form method="post" preventScrollReset>
          <button
            type="submit"
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text transition-colors duration-150 hover:bg-surface-tint"
          >
            {t("recent.clear")}
          </button>
        </fetcher.Form>
      ) : null}

      {loaderData.items.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          {t("recent.empty")}{" "}
          <Link to={`/${loaderData.lang}/products`} className="font-bold text-action hover:underline">{t("wishlist.browse")}</Link>
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loaderData.items.map((it: { product_id: string; product: ProductCard | null }) => {
            const p = it.product;
            return (
              <li key={it.product_id} className="rounded-md border border-border bg-surface p-3">
                {p ? (
                  <>
                    <Link to={`/${loaderData.lang}/product/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`}>
                      <MediaImg path={p.main_image_path ?? ""} alt={en ? p.name_en : p.name_ar} className="aspect-square w-full rounded-md border border-border object-cover" />
                    </Link>
                    <Link to={`/${loaderData.lang}/product/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`} className="mt-2 block truncate text-sm font-bold text-text hover:text-action">
                      {en ? p.name_en : p.name_ar}
                    </Link>
                    <p className="text-sm font-extrabold text-text">{money(effectivePrice(p))}</p>
                  </>
                ) : (
                  <p className="text-sm text-text-muted">{t("recent.gone")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
