import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCart } from "~/features/cart/store";

/**
 * "Move to cart" for the wishlist page (O-21): adds one unit of the default
 * variant — the product page remains the place to pick specific variants.
 */
export function AddToCartButton({ productId, label }: { productId: string; label: string }) {
  const { t } = useTranslation();
  const cart = useCart();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "fail">("idle");

  const add = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/wishlist-default-variant?product_id=${encodeURIComponent(productId)}`);
      if (!res.ok) return setState("fail");
      const { variant_id } = (await res.json()) as { variant_id: string | null };
      if (!variant_id) return setState("fail");
      const r = await cart.add(variant_id, productId, 1);
      setState(r.ok ? "ok" : "fail");
    } catch {
      setState("fail");
    }
  };

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void add()}
        disabled={state === "loading"}
        className="cursor-pointer rounded-md border border-action px-3 py-1.5 text-sm font-bold text-action transition-colors duration-150 hover:bg-surface-tint disabled:opacity-60"
      >
        {label}
      </button>
      {state === "ok" ? <span role="status" className="text-xs text-primary">{t("cart.added")}</span> : null}
      {state === "fail" ? <span role="status" className="text-xs text-danger">{t("cart.addFailed")}</span> : null}
    </span>
  );
}
