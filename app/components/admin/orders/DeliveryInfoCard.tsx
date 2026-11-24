import { useTranslation } from "react-i18next";
import type { OrderRow } from "~/features/orders/api";
import { MailIcon, PinIcon, UserIcon } from "~/components/ui/icons";

/** Admin order detail — delivery & customer contact info card. */
export function DeliveryInfoCard({
  order,
  geo,
  en,
}: {
  order: OrderRow;
  geo: {
    governorate: { name_ar: string; name_en: string } | null;
    area: { name_ar: string; name_en: string } | null;
  };
  en: boolean | undefined;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6 shadow-1 space-y-3.5 text-xs">
      {/* Delivery & Customer Info */}
      <h2 className="text-sm font-extrabold text-text flex items-center gap-2 border-b border-border/60 pb-3">
        <UserIcon className="size-4 text-action" />
        {t("order.deliveryDetails")}
      </h2>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <UserIcon className="size-4 text-text-muted shrink-0" />
          <span className="font-bold text-text">{order.ship_name}</span>
        </div>

        <div className="flex items-center gap-2 font-mono text-text" dir="ltr">
          <span className="text-text-muted text-2xs">TEL:</span>
          <span>{order.phone_primary}</span>
          {order.phone_alternate ? (
            <span className="text-text-muted">/ {order.phone_alternate}</span>
          ) : null}
        </div>

        <div className="flex items-start gap-2 text-text-muted">
          <PinIcon className="size-4 text-action shrink-0 mt-0.5" />
          <div>
            <p className="text-text font-medium">
              {order.address1}
              {order.address2 ? `، ${order.address2}` : ""}
            </p>
            <p className="text-text-muted text-2xs mt-0.5">
              {en ? geo.governorate?.name_en : geo.governorate?.name_ar} ·{" "}
              {en ? geo.area?.name_en : geo.area?.name_ar}
            </p>
          </div>
        </div>

        {order.email ? (
          <div className="flex items-center gap-2 text-text-faint" dir="ltr">
            <MailIcon className="size-3.5 shrink-0" />
            <span className="font-mono">{order.email}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
