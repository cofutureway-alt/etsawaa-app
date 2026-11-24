import { useMemo } from "react";
import type { Route } from "./+types/onboarding";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Stepper } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";
import {
  handleOnboardingAction,
  loadOnboardingData,
} from "~/features/vendor/onboarding/server";
import { useOnboarding } from "~/features/vendor/onboarding/useOnboarding";
import { ErrorSummary, WizardShell } from "~/features/vendor/onboarding/step-shell";
import { Step1Store } from "~/features/vendor/onboarding/steps/step1-store";
import { Step2Details } from "~/features/vendor/onboarding/steps/step2-details";
import { Step3Verification } from "~/features/vendor/onboarding/steps/step3-verification";
import { Step4Terms } from "~/features/vendor/onboarding/steps/step4-terms";
import { Step5Review } from "~/features/vendor/onboarding/steps/step5-review";
import { StepDone } from "~/features/vendor/onboarding/steps/step-done";

/**
 * /vendor/onboarding — the forced 5-step wizard (V-02..V-09).
 * Own full-screen shell (no panel navigation — US-01), autosave + resume,
 * optional verification with a persistent warning, terms + typed signature,
 * review & submit into `fn_vendor_onboard`.
 *
 * Structure: server bodies in ~/features/vendor/onboarding/server.ts, client
 * wizard state in useOnboarding.ts, shared chrome in step-shell.tsx and one
 * file per step in steps/. This module keeps only the route exports.
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadOnboardingData(request, params);
}

export async function action({ request, params }: Route.ActionArgs) {
  return handleOnboardingAction(request, params);
}

const STEP_KEYS = [
  "vendorOnboarding.steps.store",
  "vendorOnboarding.steps.details",
  "vendorOnboarding.steps.verification",
  "vendorOnboarding.steps.terms",
  "vendorOnboarding.steps.review",
] as const;

export default function OnboardingPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const vendor = loaderData.vendor;
  const config = loaderData.config;
  const isAr = lang === "ar";

  const wizard = useOnboarding({ vendor, config, hasNationalId: loaderData.documents.some((d) => d.type === "national_id") });

  const vendorId = vendor?.id ?? "";
  const areas = loaderData.areas.filter((a) => a.governorate_id === wizard.form.governorate_id);

  const graceLabel = useMemo(() => {
    if (config.grace_unit === "hours") return t("vendorOnboarding.grace.hours", { count: config.grace_value });
    if (config.grace_unit === "months") return t("vendorOnboarding.grace.months", { count: config.grace_value });
    return t("vendorOnboarding.grace.days", { count: config.grace_value });
  }, [config, t]);

  /* ------------------------------------------------ confirmation screen */
  if (wizard.submitted) {
    const direct = config.onboarding_mode === "direct";
    return (
      <WizardShell lang={lang}>
        <StepDone lang={lang} direct={direct} vendor={vendor} isAr={isAr} />
      </WizardShell>
    );
  }

  return (
    <WizardShell lang={lang}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-black text-text">{t("vendorOnboarding.title")}</h1>
          <p className="text-sm text-text-muted">{t("vendorOnboarding.subtitle")}</p>
        </div>
        <Stepper steps={STEP_KEYS.map((key) => t(key))} current={wizard.step - 1} label={t("vendorOnboarding.progressLabel")} />

        <div className="flex items-center justify-between text-xs text-text-faint" aria-live="polite">
          <span>
            {t("vendorOnboarding.stepOf", { current: wizard.step, total: 5 })}
          </span>
          <span>
            {wizard.saving
              ? t("vendorOnboarding.saving")
              : wizard.savedAt
                ? t("vendorOnboarding.savedAt", { time: new Date(wizard.savedAt).toLocaleTimeString(isAr ? "ar-EG-u-nu-latn" : "en-GB") })
                : ""}
          </span>
        </div>

        <ErrorSummary items={wizard.stepErrors} />

        <Card>
          <CardBody className="flex flex-col gap-4 p-5">
            {wizard.step === 1 ? (
              <Step1Store
                form={wizard.form}
                categories={loaderData.categories}
                media={loaderData.media}
                uid={loaderData.uid}
                supabaseUrl={loaderData.supabaseUrl}
                patch={wizard.patch}
                onSlugChange={wizard.onSlugChange}
              />
            ) : null}

            {wizard.step === 2 ? (
              <Step2Details
                form={wizard.form}
                governorates={loaderData.governorates}
                areas={areas}
                isAr={isAr}
                patch={wizard.patch}
              />
            ) : null}

            {wizard.step === 3 ? (
              <Step3Verification
                vendorId={vendorId}
                config={config}
                documents={loaderData.documents}
                graceLabel={graceLabel}
                onSkip={wizard.goNext}
                onDocumentUploaded={wizard.handleDocumentUploaded}
              />
            ) : null}

            {wizard.step === 4 ? (
              <Step4Terms
                form={wizard.form}
                config={config}
                isAr={isAr}
                patch={wizard.patch}
              />
            ) : null}

            {wizard.step === 5 ? (
              <Step5Review
                form={wizard.form}
                documentsCount={loaderData.documents.length}
                graceLabel={graceLabel}
                termsVersion={config.terms_version}
                onEdit={wizard.setStepAndSave}
              />
            ) : null}
          </CardBody>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={wizard.step === 1}
            onClick={() => wizard.setStepAndSave(Math.max(wizard.step - 1, 1))}
          >
            {t("common.back")}
          </Button>
          {wizard.step < 5 ? (
            <Button type="button" onClick={wizard.goNext}>
              {t("common.next")}
            </Button>
          ) : (
            <Button type="button" size="lg" loading={wizard.submitBusy} onClick={wizard.submitAll}>
              {t("vendorOnboarding.submit")}
            </Button>
          )}
        </div>
      </div>
    </WizardShell>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
