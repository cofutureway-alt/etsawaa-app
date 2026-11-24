import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Dialog } from "~/components/ui";
import { Input } from "~/components/ui/Input";
import type { SaveActionData, WizardBrand } from "./types";

/**
 * Seller-side brand proposal: the catalogue has no brand for this product, so
 * the seller sends the two names and a reviewer completes the brand (logo,
 * description, categories) together with the product review.
 */
export function BrandProposeDialog({
  open,
  onClose,
  categoryId,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  categoryId: string;
  onResolved: (brand: WizardBrand, existing: boolean) => void;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<SaveActionData>();
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    if (data.ok && data.brand) {
      onResolved(data.brand, Boolean(data.existing));
      setNameAr("");
      setNameEn("");
      setError(null);
      return;
    }
    const reason = String(data.error ?? "");
    setError(
      reason === "bad_name" ? t("productWizard.brandPropose.badName")
        : reason === "too_many" ? t("productWizard.brandPropose.tooMany")
        : reason === "bad_category" ? t("productWizard.brandPropose.badCategory")
        : t("productWizard.brandPropose.err"),
    );
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const ar = nameAr.trim();
    const en = nameEn.trim();
    if (ar.length < 2 || ar.length > 60 || en.length < 2 || en.length > 60) {
      setError(t("productWizard.brandPropose.badName"));
      return;
    }
    setError(null);
    fetcher.submit({ intent: "propose_brand", name_ar: ar, name_en: en, category_id: categoryId }, { method: "post" });
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("productWizard.brandPropose.title")}>
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-tint px-3 py-2 text-xs text-text-muted">{t("productWizard.brandPropose.note")}</p>
        <Input label={t("productWizard.brandPropose.nameAr")} value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={60} minLength={2} />
        <Input label={t("productWizard.brandPropose.nameEn")} value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={60} minLength={2} dir="ltr" />
        {error ? <p role="alert" className="text-xs font-bold text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" loading={busy} disabled={!categoryId} onClick={submit}>{t("productWizard.brandPropose.submit")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
