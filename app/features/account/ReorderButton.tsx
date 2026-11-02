import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCart } from "~/features/cart/store";

/**
 * Reorder (US-12): re-adds every still-purchasable line to the cart; the
 * unavailable ones are listed in a notice — never silently dropped and never
 * suggested as a dark pattern. Deleted products are skipped with a summary.
 */
export function ReorderButton({ orderNumber, lang: _lang }: { orderNumber: string; lang: string }) {
  const { t, i18n } = useTranslation();
  const cart = useCart();
  const [state, setState] = useState<"idle" | "loading" | "done" | "partial">("idle");
  const [skipped, setSkipped] = useState<string[]>([]);

  const reorder = async () => {
    setState("loading");
    setSkipped([]);
    try {
      const res = await fetch(`/api/reorder?number=${encodeURIComponent(orderNumber)}`);
      if (!res.ok) {
        setState("idle");
        return;
      }
      const payload = (await res.json()) as {
        lines: Array<{ variant_id: string; product_id: string; qty: number; available: boolean; name: string }>;
      };
      const skippedNames: string[] = [];
      for (const line of payload.lines) {
        if (!line.available) {
          skippedNames.push(line.name);
          continue;
        }
        await cart.add(line.variant_id, line.product_id, line.qty);
      }
      setSkipped(skippedNames);
      setState(skippedNames.length > 0 ? "partial" : "done");
    } catch {
      setState("idle");
    }
  };

  const en = i18n.language?.startsWith("en");
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void reorder()}
        disabled={state === "loading"}
        className="cursor-pointer rounded-m border border-action px-3 py-1.5 text-[13px] font-bold text-action transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "loading" ? t("orders.reordering") : t("orders.reorder")}
      </button>
      {state === "done" ? (
        <span role="status" className="mt-1 text-xs text-primary">{t("orders.reordered")}</span>
      ) : null}
      {state === "partial" ? (
        <span role="status" className="mt-1 max-w-xs text-xs text-text-muted">
          {t("orders.reorderedPartial", { names: skipped.join(en ? ", " : "، ") })}
        </span>
      ) : null}
    </span>
  );
}
