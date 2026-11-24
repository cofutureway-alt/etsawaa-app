import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { GroupRow, ItemRow } from "~/features/orders/api";
import { Badge } from "~/components/ui/Badge";
import { PackageIcon, StoreIcon } from "~/components/ui/icons";
import { getOrderStatusTone, makeMoneyFormatter, type OrderActionData } from "./shared";

const GROUP_TARGETS = ["preparing", "handed_to_carrier", "out_for_delivery", "delivered", "cancelled"] as const;

/**
 * Admin order detail — vendor packages: one card per vendor group with its
 * line items, per-group financial subtotal and the per-group status update
 * form (hidden once the group is delivered/cancelled).
 */
export function VendorGroupCards({
  groups,
  items,
  en,
}: {
  groups: GroupRow[];
  items: ItemRow[];
  en: boolean | undefined;
}) {
  const { t } = useTranslation();
  const money = makeMoneyFormatter(en);
  const statusFetcher = useFetcher<OrderActionData>();

  const itemsByGroup = new Map<string, ItemRow[]>();
  for (const it of items) {
    const arr = itemsByGroup.get(it.group_id) ?? [];
    arr.push(it);
    itemsByGroup.set(it.group_id, arr);
  }

  return (
    <div className="space-y-4">
      {/* Vendor Packages / Groups */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-text flex items-center gap-2">
          <PackageIcon className="size-5 text-action" />
          <span>حزم المنتجات والمتاجر</span>
          <span className="rounded-full bg-surface-tint px-2 py-0.5 text-xs font-bold text-text-muted">
            {groups.length}
          </span>
        </h2>
      </div>

      {groups.map((g) => {
        const groupItems = itemsByGroup.get(g.id) ?? [];
        const storeName = en ? g.vendor.store_name_en : g.vendor.store_name_ar;

        return (
          <section
            key={g.id}
            className="overflow-hidden rounded-lg border border-border bg-surface shadow-1 transition-all"
          >
            {/* Group Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-surface-tint/30 px-4 sm:px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-surface border border-border text-action font-black text-xs shadow-1">
                  {storeName ? storeName.charAt(0).toUpperCase() : <StoreIcon className="size-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-text">{storeName}</h3>
                  <p className="text-2xs text-text-muted">
                    {groupItems.reduce((acc, it) => acc + it.qty, 0)} قطع
                  </p>
                </div>
              </div>

              <Badge tone={getOrderStatusTone(g.status)} dot>
                {t(`order.status_${g.status}`)}
              </Badge>
            </div>

            {/* Group Line Items */}
            <div className="divide-y divide-border/50 px-4 sm:px-6">
              {groupItems.map((it) => (
                <div
                  key={it.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-tint/40 text-text-muted font-bold text-xs">
                      <PackageIcon className="size-5 text-text-faint" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-text leading-snug">
                        {en ? it.product_name_en : it.product_name_ar}
                      </p>
                      <p className="text-xs text-text-muted font-mono mt-0.5">
                        × {it.qty}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 text-xs sm:text-right border-t border-border/30 pt-2 sm:border-0 sm:pt-0">
                    <div>
                      <span className="block font-bold text-text font-mono text-sm">
                        {money(it.line_total_piastres)}
                      </span>
                      <span className="block text-2xs text-text-muted font-mono">
                        {t("order.commissionShort")}: {money(it.commission_piastres)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Group Financial Subtotal */}
            <div className="border-t border-border/60 bg-surface-tint/10 px-4 sm:px-6 py-3">
              <dl className="flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <dt className="text-text-muted">{t("order.itemsSubtotal")}:</dt>
                  <dd className="font-bold font-mono text-text">{money(g.items_subtotal_piastres)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-text-muted">{t("order.commission")}:</dt>
                  <dd className="font-bold font-mono text-action">{money(g.commission_piastres)}</dd>
                </div>
              </dl>
            </div>

            {/* Group Status Action (if active) */}
            {g.status !== "delivered" && g.status !== "cancelled" ? (
              <div className="border-t border-border/60 bg-surface px-4 sm:px-6 py-3.5">
                <statusFetcher.Form method="post" preventScrollReset className="flex flex-wrap items-center gap-2.5">
                  <input type="hidden" name="intent" value="group_status" />
                  <input type="hidden" name="group_id" value={g.id} />

                  <div className="flex-1 min-w-[140px]">
                    <select
                      name="status"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text shadow-1 focus:border-action focus:outline-none focus:ring-1 focus:ring-action"
                      defaultValue={g.status === "pending" ? "preparing" : "handed_to_carrier"}
                    >
                      {GROUP_TARGETS.map((s) => (
                        <option key={s} value={s}>
                          {t(`order.status_${s}`)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-[2] min-w-[180px]">
                    <input
                      name="note"
                      placeholder={t("order.notePlaceholder")}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-1 placeholder:text-text-faint focus:border-action focus:outline-none focus:ring-1 focus:ring-action"
                    />
                  </div>

                  <button
                    type="submit"
                    className="cursor-pointer rounded-lg border border-action bg-surface px-3.5 py-2 text-xs font-bold text-action hover:bg-action hover:text-on-action transition-colors shadow-1 shrink-0"
                  >
                    {t("order.updateStatus")}
                  </button>
                </statusFetcher.Form>

                {statusFetcher.data && !statusFetcher.data.ok ? (
                  <p role="alert" className="mt-2 text-xs font-semibold text-danger">
                    {t("order.updateFailed")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
