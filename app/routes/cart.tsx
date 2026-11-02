import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/cart";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { publicMeta } from "~/lib/seo";
import { formatPiastres } from "~/lib/money";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { useCart, ensureGuestDetails } from "~/features/cart/store";
import { applyCoupon, type CartLine } from "~/features/cart/api";
import { Button } from "~/components/ui/Button";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { useToast } from "~/components/ui/Toast";
import { MinusIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { MediaImg } from "~/components/catalog/MediaImg";
import { Skeleton, SkeletonPage } from "~/components/ui/Skeleton";


export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const { viewer } = client ? ((await getViewer(client)) ?? { viewer: null }) : { viewer: null };
  return { lang, signedIn: Boolean(viewer) };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/cart",
    title: lang === "ar" ? "سلة التسوق — اتسوء" : "Shopping cart — Etsawaa",
    description: lang === "ar" ? "راجع سلتك قبل إتمام الطلب." : "Review your cart before checkout.",
    noindex: true,
  });
};

interface CouponState {
  code: string;
  discount_piastres: number;
  free_shipping: boolean;
}

export default function CartPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const cart = useCart();
  const toast = useToast();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [coupon, setCoupon] = useState<CouponState | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  // guest lines need live display data; signed-in lines arrive complete
  useEffect(() => {
    if (!cart.ready) return;
    if (cart.lines.every((l) => l.name_ar)) {
      setLines(cart.lines);
      setHydrated(true);
      return;
    }
    let alive = true;
    void ensureGuestDetails(cart.lines).then((detailed) => {
      if (!alive) return;
      setLines(detailed);
      setHydrated(true);
    });
    return () => { alive = false; };
  }, [cart.ready, cart.lines]);

  const subtotal = lines.reduce((sum, l) => sum + (l.price_piastres ?? 0) * l.qty, 0);
  const discount = coupon?.discount_piastres ?? 0;
  const total = Math.max(0, subtotal - discount);
  const grouped = useMemo(() => {
    const map = new Map<string, CartLine[]>();
    for (const line of lines) {
      const key = line.vendor_id ?? "";
      map.set(key, [...(map.get(key) ?? []), line]);
    }
    return [...map.entries()];
  }, [lines]);

  const changeQty = async (line: CartLine, qty: number) => {
    setWorking(line.variant_id);
    await cart.setQty(line.variant_id, qty);
    setWorking(null);
  };

  const removeLine = async (line: CartLine) => {
    setWorking(line.variant_id);
    await cart.remove(line.variant_id);
    setWorking(null);
  };

  const applyCouponCode = async () => {
    const code = couponInput.trim();
    if (!code || lines.length === 0) return;
    setCheckingCoupon(true);
    setCouponError(null);
    const res = await applyCoupon(code, lines);
    setCheckingCoupon(false);
    if (res.ok && res.discount_piastres != null) {
      setCoupon({ code, discount_piastres: res.discount_piastres, free_shipping: res.free_shipping === true });
      toast.showToast("success", t("cart.coupon.saved", { amount: formatPiastres(res.discount_piastres, lang === "en" ? "en" : "ar") }));
    } else {
      setCoupon(null);
      setCouponError(t(`cart.coupon.error.${res.reason ?? "invalid"}`));
    }
  };

  if (!hydrated) {
    /* H-24: skeleton matches the FINAL page shell 1:1 (breadcrumbs + title +
       2-column grid) so hydrating never shifts the layout (CLS 0). min-h keeps
       the sticky footer pinned — the empty/loaded cart both render at least
       this tall, so no shift when lines arrive. */
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-24" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="rounded-l border border-border bg-surface">
                <div className="border-b border-border px-4 py-3">
                  <Skeleton className="h-3.5 w-32" />
                </div>
                <div className="flex gap-3 p-4">
                  <Skeleton className="size-20 shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                    <Skeleton className="mt-3 h-4 w-24" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <aside className="flex h-fit flex-col gap-3 rounded-l border border-border bg-surface p-4 lg:sticky lg:top-32">
            <Skeleton className="h-4 w-28" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      /* H-24: reserve the same height the line-groups skeleton reserves so
         switching skeleton→empty never moves the footer (CLS 0) */
      <div className="flex min-h-[60vh] flex-col gap-4">
        <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.cart") }]} />
        <EmptyState
          title={t("cart.empty.title")}
          body={t("cart.empty.body")}
          action={
            <Link
              to={`/${lang}/products`}
              className="inline-block rounded-m bg-action px-4 py-2 text-[13px] font-bold text-on-action transition-colors duration-150 hover:bg-action-hover"
            >
              {t("cart.empty.browse")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.cart") }]} />
      <h1 className="text-lg font-black text-text">{t("cart.title")}</h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* lines grouped per vendor (JOURNEYS §5.2) */}
        <div className="flex min-w-0 flex-col gap-4">
          {grouped.map(([vendorId, vendorLines]) => {
            const storeName = lang === "ar"
              ? vendorLines[0]?.store_name_ar || vendorLines[0]?.store_name_en
              : vendorLines[0]?.store_name_en || vendorLines[0]?.store_name_ar;
            return (
              <section key={vendorId || "unknown"} className="rounded-l border border-border bg-surface" aria-label={storeName ?? t("cart.group")}>
                <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                  <h2 className="truncate text-[13px] font-extrabold text-text">{storeName ?? t("cart.group")}</h2>
                  <Link
                    to={`/${lang}/vendors`}
                    className="shrink-0 text-[12px] font-bold text-action hover:underline"
                  >
                    {t("store.vendor.more")}
                  </Link>
                </header>
                <ul>
                  {vendorLines.map((line) => {
                    const name = lang === "ar" ? line.name_ar || line.name_en : line.name_en || line.name_ar;
                    return (
                      <li key={line.variant_id} className="flex gap-3 border-b border-border p-4 last:border-none">
                        <div className="size-20 shrink-0 overflow-hidden rounded-m border border-border">
                          {line.image_path ? (
                            <MediaImg path={line.image_path} alt={name ?? ""} width={80} height={80} className="size-20" />
                          ) : (
                            <div className="flex size-20 items-center justify-center bg-surface-tint text-[10px] text-text-faint">
                              {t("store.noImage")}
                            </div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              to={`/${lang}/product/${encodeURIComponent((lang === "en" ? line.slug_en || line.slug_ar : line.slug_ar || line.slug_en) ?? "")}`}
                              className="line-clamp-2 text-[13.5px] font-bold text-text transition-colors duration-150 hover:text-action"
                            >
                              {name}
                            </Link>
                            <button
                              type="button"
                              aria-label={t("cart.remove")}
                              disabled={working === line.variant_id}
                              onClick={() => void removeLine(line)}
                              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-m text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          </div>
                          {line.sku ? <span className="num text-[11px] text-text-faint">SKU: {line.sku}</span> : null}
                          <span className="num text-[13px] font-extrabold text-text">
                            {line.price_piastres != null ? formatPiastres(line.price_piastres, lang === "en" ? "en" : "ar") : ""}
                          </span>
                          {line.capped ? (
                            <span className="text-[11px] font-bold text-warning-strong">
                              {t("cart.cappedNotice")} ({t("cart.stockIs", { count: line.stock ?? 0 })})
                            </span>
                          ) : null}
                          <div className="mt-1 flex items-center gap-3">
                            <div className="flex items-center rounded-m border border-border">
                              <button
                                type="button"
                                aria-label={t("cart.decrease")}
                                disabled={working === line.variant_id}
                                onClick={() => void changeQty(line, line.qty - 1)}
                                className="flex size-9 cursor-pointer items-center justify-center text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <MinusIcon className="size-3.5" />
                              </button>
                              <span className="num w-9 text-center text-[13px] font-extrabold">{line.qty}</span>
                              <button
                                type="button"
                                aria-label={t("cart.increase")}
                                disabled={working === line.variant_id || (line.stock != null && line.qty >= line.stock)}
                                onClick={() => void changeQty(line, line.qty + 1)}
                                className="flex size-9 cursor-pointer items-center justify-center text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
                                title={line.stock != null && line.qty >= line.stock ? t("cart.stockMax") : undefined}
                              >
                                <PlusIcon className="size-3.5" />
                              </button>
                            </div>
                            <span className="num text-[12px] font-bold text-text-muted">
                              {t("cart.lineTotal", { amount: formatPiastres((line.price_piastres ?? 0) * line.qty, lang === "en" ? "en" : "ar") })}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {/* summary */}
        <aside className="flex h-fit flex-col gap-3 rounded-l border border-border bg-surface p-4 lg:sticky lg:top-32" aria-label={t("cart.summary")}>
          <h2 className="text-[13px] font-extrabold text-text">{t("cart.summary")}</h2>

          <div className="flex items-center justify-between text-[13px]">
            <span className="text-text-muted">{t("cart.subtotal")}</span>
            <span className="num font-extrabold text-text">{formatPiastres(subtotal, lang === "en" ? "en" : "ar")}</span>
          </div>
          {coupon ? (
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-1.5 text-success-strong">
                {t("cart.coupon.line", { code: coupon.code })}
                <button
                  type="button"
                  onClick={() => setCoupon(null)}
                  aria-label={t("cart.coupon.remove")}
                  className="cursor-pointer text-[11px] font-bold text-danger hover:underline"
                >
                  {t("cart.coupon.remove")}
                </button>
              </span>
              <span className="num font-extrabold text-success-strong">-{formatPiastres(discount, lang === "en" ? "en" : "ar")}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <span className="font-extrabold text-text">{t("cart.total")}</span>
            <span className="num text-base font-black text-text">{formatPiastres(total, lang === "en" ? "en" : "ar")}</span>
          </div>
          <p className="text-[11px] text-text-faint">{t("cart.shippingNote")}</p>

          {/* coupon baseline (S-09) */}
          {coupon ? null : (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-text-muted" htmlFor="coupon-code">{t("cart.coupon.label")}</label>
              <div className="flex gap-2">
                <input
                  id="coupon-code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyCouponCode(); } }}
                  maxLength={40}
                  placeholder={t("cart.coupon.placeholder")}
                  className="min-w-0 flex-1 rounded-m border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-action"
                />
                <Button type="button" size="sm" disabled={checkingCoupon || !couponInput.trim()} onClick={() => void applyCouponCode()}>
                  {checkingCoupon ? t("common.loading") : t("cart.coupon.apply")}
                </Button>
              </div>
              {couponError ? <p className="text-[12px] font-bold text-danger" role="alert">{couponError}</p> : null}
            </div>
          )}

          {/* checkout gate (JOURNEYS §1.6): account creation is forced */}
          {loaderData.signedIn ? (
            <button
              type="button"
              disabled
              title={t("cart.checkoutNextPhase")}
              className="flex min-h-11 cursor-not-allowed items-center justify-center rounded-m bg-action text-sm font-extrabold text-on-action opacity-60"
            >
              {t("cart.checkout")}
            </button>
          ) : (
            <Link
              to={`/${lang}/auth/register?next=${encodeURIComponent(`/${lang}/cart`)}`}
              className="flex min-h-11 items-center justify-center rounded-m bg-action text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
            >
              {t("cart.registerToCheckout")}
            </Link>
          )}
          <p className="text-[11px] leading-relaxed text-text-faint">{t("cart.gateNote")}</p>
        </aside>
      </div>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
