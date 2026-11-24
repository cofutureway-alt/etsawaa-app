import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CheckIcon } from "~/components/ui";
import type { VendorRow } from "~/features/vendor/config";

/**
 * step-done.tsx — the confirmation screen shown at `?done=1` after a
 * successful `fn_vendor_onboard` submit: success card, pending-vs-direct
 * copy and the grace-period warning for unverified vendors.
 */

export function StepDone({
  lang,
  direct,
  vendor,
  isAr,
}: {
  lang: string;
  direct: boolean;
  vendor: VendorRow | null;
  isAr: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardBody className="flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckIcon width={28} height={28} />
        </span>
        <h1 className="text-lg font-black text-text">{t("vendorOnboarding.done.title")}</h1>
        <p className="text-sm leading-relaxed text-text-muted">
          {direct ? t("vendorOnboarding.done.direct") : t("vendorOnboarding.done.pending")}
        </p>
        {vendor?.grace_until && vendor.verification_status === "unverified" ? (
          <p className="rounded-md bg-warning-soft p-3 text-xs font-bold text-warning">
            {t("vendorOnboarding.done.grace", { until: new Date(vendor.grace_until).toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB") })}
          </p>
        ) : null}
        <Link to={`/${lang}/vendor`}>
          <Button size="lg">{t("vendorOnboarding.done.toDashboard")}</Button>
        </Link>
      </CardBody>
    </Card>
  );
}
