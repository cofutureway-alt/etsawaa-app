import { Trans, useTranslation } from "react-i18next";
import { Input } from "~/components/ui";
import type { VendorConfig } from "~/features/vendor/config";
import type { FormState, OnboardingPatch } from "../useOnboarding";

/**
 * step4-terms.tsx — wizard step 4 "terms": the localized contract text,
 * the acceptance checkbox and the typed signature (validated by
 * `onboardingTermsSchema` in the controller and again by `fn_vendor_onboard`).
 */

export function Step4Terms({
  form,
  config,
  isAr,
  patch,
}: {
  form: FormState;
  config: VendorConfig;
  isAr: boolean;
  patch: OnboardingPatch;
}) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "ar";
  void config; void isAr;
  // owner request: the contract text is not shown inline — one consent line
  // links to it (new tab); the typed signature below signs it
  return (
    <>
      <label className="flex items-start gap-2 rounded-md border border-border bg-surface-tint p-4 text-start text-sm text-text">
        <input
          id="terms_accepted"
          type="checkbox"
          required
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]"
          checked={form.terms_accepted}
          onChange={(e) => patch({ terms_accepted: e.target.checked })}
        />
        <span className="leading-relaxed">
          <Trans i18nKey="vendorOnboarding.step4.consent" components={{
            policies: <a href={`/${lang}/legal/terms`} target="_blank" rel="noopener noreferrer" className="font-bold text-action underline" />,
            contract: <a href={`/${lang}/legal/seller-agreement`} target="_blank" rel="noopener noreferrer" className="font-bold text-action underline" />,
          }} />
        </span>
      </label>
      <Input
        id="terms_signature"
        required
        label={t("vendorOnboarding.step4.signature")}
        hint={t("vendorOnboarding.step4.signatureHint")}
        value={form.terms_signature}
        onChange={(e) => patch({ terms_signature: e.target.value })}
      />
    </>
  );
}
