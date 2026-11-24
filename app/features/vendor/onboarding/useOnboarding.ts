import { normalizeEgyptianPhone } from "~/lib/phone";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useToast } from "~/components/ui";
import type { ActionData } from "./server";
import {
  onboardingDetailsSchema,
  onboardingStoreSchema,
  onboardingTermsSchema,
} from "~/features/vendor/schemas";
import type { VendorConfig, VendorRow } from "~/features/vendor/config";

/**
 * useOnboarding.ts — client-side wizard controller for the 5-step onboarding
 * flow (V-02..V-09). Owns the form state, the debounced autosave fetcher, the
 * per-step Zod validation (double validation with `fn_vendor_onboard`), the
 * unsaved-changes guard and step navigation, so the route file stays a thin
 * orchestrator and every step component can receive explicit props.
 */

export interface FormState {
  store_name_ar: string;
  store_name_en: string;
  short_desc_ar: string;
  short_desc_en: string;
  welcome_msg_ar: string;
  welcome_msg_en: string;
  slug: string;
  logo_path: string;
  banner_path: string;
  category_ids: string[];
  first_name: string;
  last_name: string;
  phone: string;
  governorate_id: number | null;
  area_id: number | null;
  address1: string;
  address2: string;
  postal_code: string;
  socials: { facebook: string; instagram: string; x: string; tiktok: string; whatsapp: string };
  terms_accepted: boolean;
  terms_signature: string;
}

/** A step component sets form values through this (also marks the wizard dirty). */
export type OnboardingPatch = (partial: Partial<FormState>) => void;

export interface StepError { field: string; label: string }

/** Everything the wizard page + step components need from the controller. */
export interface OnboardingWizard {
  submitted: boolean;
  step: number;
  form: FormState;
  stepErrors: StepError[];
  savedAt: string | null;
  /** "Saving…" indicator: a fetch is in flight OR edits are not yet flushed. */
  saving: boolean;
  /** Submit fetcher busy — drives the submit button loading state. */
  submitBusy: boolean;
  patch: OnboardingPatch;
  /** Slug field change — marks the slug as user-touched (stops auto-suggest). */
  onSlugChange: (value: string) => void;
  setStepAndSave: (next: number) => void;
  goNext: () => void;
  submitAll: () => void;
  /** A document finished uploading — refresh the loader documents list. */
  handleDocumentUploaded: () => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stateFromVendor(vendor: VendorRow | null): FormState {
  return {
    store_name_ar: vendor?.store_name_ar ?? "",
    store_name_en: vendor?.store_name_en ?? "",
    short_desc_ar: vendor?.short_desc_ar ?? "",
    short_desc_en: vendor?.short_desc_en ?? "",
    welcome_msg_ar: vendor?.welcome_msg_ar ?? "",
    welcome_msg_en: vendor?.welcome_msg_en ?? "",
    slug: vendor?.slug ?? "",
    logo_path: vendor?.logo_path ?? "",
    banner_path: vendor?.banner_path ?? "",
    category_ids: vendor?.category_ids ?? [],
    first_name: vendor?.first_name ?? "",
    last_name: vendor?.last_name ?? "",
    phone: vendor?.phone ?? "",
    governorate_id: vendor?.governorate_id ?? null,
    area_id: vendor?.area_id ?? null,
    address1: vendor?.address1 ?? "",
    address2: vendor?.address2 ?? "",
    postal_code: vendor?.postal_code ?? "",
    socials: {
      facebook: vendor?.socials?.facebook ?? "",
      instagram: vendor?.socials?.instagram ?? "",
      x: vendor?.socials?.x ?? "",
      tiktok: vendor?.socials?.tiktok ?? "",
      whatsapp: vendor?.socials?.whatsapp ?? "",
    },
    terms_accepted: false,
    terms_signature: "",
  };
}

export function useOnboarding(args: { vendor: VendorRow | null; config: VendorConfig; hasNationalId?: boolean }): OnboardingWizard {
  const { vendor, config } = args;
  // owner request: the national ID image is mandatory — the step cannot be skipped
  const hasNationalId = args.hasNationalId ?? false;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const autosave = useFetcher<ActionData>();
  const submit = useFetcher<ActionData>();

  const [step, setStep] = useState<number>(vendor?.onboarding_step ?? 1);
  const [form, setForm] = useState<FormState>(() => stateFromVendor(vendor));
  const [stepErrors, setStepErrors] = useState<StepError[]>([]);
  const [dirty, setDirty] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(vendor?.slug));

  const submitted = searchParams.get("done") === "1";
  const vendorId = vendor?.id ?? "";

  const patch: OnboardingPatch = (partial) => {
    setForm((current) => ({ ...current, ...partial }));
    setDirty(true);
  };

  /* autosave (debounced) — resume exact values on refresh/re-login (V-02) */
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty || submitted) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      const payload = JSON.stringify({ step, data: form });
      autosave.submit({ intent: "autosave", payload }, { method: "post" });
      setDirty(false);
    }, 1200);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, step, dirty, submitted]);

  useEffect(() => {
    if (autosave.state === "idle" && autosave.data?.ok && autosave.data.savedAt) {
      setSavedAt(autosave.data.savedAt);
    }
    if (autosave.state === "idle" && autosave.data && !autosave.data.ok) {
      toast.showToast("error", t("errors.generic"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave.state]);

  /* unsaved-changes guard (G4): the browser prompt while a save is pending */
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || autosave.state !== "idle") event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, autosave.state]);

  /* keep step 1 in sync when the vendor row appears after the first autosave */
  const [vendorReady, setVendorReady] = useState(Boolean(vendorId));
  const revalidatorRef = useRef(false);
  useEffect(() => {
    if (!dirty && !vendorReady && autosave.state === "idle" && autosave.data?.ok && !revalidatorRef.current) {
      revalidatorRef.current = true;
      navigate(".", { replace: true });
    }
  }, [autosave.state, autosave.data, dirty, vendorReady, navigate]);

  function setStepAndSave(next: number) {
    if (next > 3 && !hasNationalId) {
      setStepErrors(validateStep(3));
      setStep(3);
      return;
    }
    setStepErrors([]);
    setStep(next);
    setDirty(true);
  }

  function validateStep(current: number): StepError[] {
    const errors: StepError[] = [];
    const push = (field: string, key: string) => errors.push({ field, label: t(`vendorOnboarding.errors.${key}`) });
    if (current === 1) {
      const parsed = onboardingStoreSchema.safeParse({
        ...form,
        slug: form.slug,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "");
          push(field, field === "category_ids" ? "category_required" : `${field}:${issue.message}`);
        }
      }
    }
    if (current === 2) {
      const parsed = onboardingDetailsSchema.safeParse(form);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "");
          push(field, field === "governorate_id" || field === "area_id" ? "area_required" : `${field}:${issue.message}`);
        }
      }
    }
    if (current === 3 && !hasNationalId) {
      push("national_id", "national_id_required");
    }
    if (current === 4) {
      const parsed = onboardingTermsSchema.safeParse(form);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "");
          push(field, `${field}:${issue.message}`);
        }
      }
    }
    return errors;
  }

  function goNext() {
    const errors = validateStep(step);
    if (errors.length > 0) {
      setStepErrors(errors);
      return;
    }
    setStepErrors([]);
    setDirty(true);
    setStep((s) => Math.min(s + 1, 5));
  }

  function submitAll() {
    const all = [...validateStep(1), ...validateStep(2), ...validateStep(3), ...validateStep(4)];
    if (all.length > 0) {
      setStepErrors(all);
      return;
    }
    setStepErrors([]);
    const payload = JSON.stringify({
      store_name_ar: form.store_name_ar,
      store_name_en: form.store_name_en,
      short_desc_ar: form.short_desc_ar,
      short_desc_en: form.short_desc_en,
      welcome_msg_ar: form.welcome_msg_ar,
      welcome_msg_en: form.welcome_msg_en,
      slug: form.slug,
      logo_path: form.logo_path,
      banner_path: form.banner_path,
      category_ids: form.category_ids,
      first_name: form.first_name,
      last_name: form.last_name,
      // the field groups digits as they are typed; store the plain number
      phone: ((n) => (n.ok ? n.e164 : form.phone.replace(/\s+/g, "")))(normalizeEgyptianPhone(form.phone)),
      governorate_id: form.governorate_id,
      area_id: form.area_id,
      address1: form.address1,
      address2: form.address2,
      postal_code: form.postal_code,
      socials: form.socials,
      terms_version: config.terms_version,
      terms_signature: form.terms_signature,
    });
    submit.submit({ intent: "submit", payload }, { method: "post" });
  }

  useEffect(() => {
    if (submit.state === "idle" && submit.data?.ok && submit.data.redirectTo) {
      navigate(submit.data.redirectTo, { replace: true });
    }
    if (submit.state === "idle" && submit.data && !submit.data.ok) {
      toast.showToast(
        "error",
        submit.data.error?.includes("terms") ? t("vendorOnboarding.errors.terms:required")
          : submit.data.error?.includes("area") ? t("vendorOnboarding.errors.area_required")
          : submit.data.error?.includes("national_id") ? t("vendorOnboarding.errors.national_id_required")
          : t("errors.generic"),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit.state]);

  /* slug auto-suggestion from the English name (editable afterwards) */
  useEffect(() => {
    if (!slugTouched && form.store_name_en.trim().length > 1) {
      setForm((current) => ({ ...current, slug: slugify(form.store_name_en) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.store_name_en, slugTouched]);

  function onSlugChange(value: string) {
    setSlugTouched(true);
    patch({ slug: value });
  }

  function handleDocumentUploaded() {
    setVendorReady(true);
    navigate(".", { replace: true });
  }

  return {
    submitted,
    step,
    form,
    stepErrors,
    savedAt,
    saving: autosave.state !== "idle" || dirty,
    submitBusy: submit.state !== "idle",
    patch,
    onSlugChange,
    setStepAndSave,
    goNext,
    submitAll,
    handleDocumentUploaded,
  };
}
