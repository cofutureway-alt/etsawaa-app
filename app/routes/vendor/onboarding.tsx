import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/onboarding";
import { Link, data, redirect, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Select,
  Stepper,
  useToast,
  CheckIcon,
  ShieldIcon,
} from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseBrowserClient } from "~/lib/supabase/browser";
import { parseMediaSettings } from "~/lib/media.shared";
import { buildObjectPath } from "~/lib/media.shared";
import { MediaPickerDialog, MediaImage } from "~/features/media/components/media-ui";
import {
  fetchVendorConfig,
  fetchVendorDocuments,
  fetchVendorRow,
  type VendorDocumentRow,
} from "~/features/vendor/api";
import type { VendorRow } from "~/features/vendor/config";
import { SkeletonForm } from "~/components/ui/Skeleton";

import {
  onboardingDetailsSchema,
  onboardingStoreSchema,
  onboardingTermsSchema,
} from "~/features/vendor/schemas";

/**
 * /vendor/onboarding — the forced 5-step wizard (V-02..V-09).
 * Own full-screen shell (no panel navigation — US-01), autosave + resume,
 * optional verification with a persistent warning, terms + typed signature,
 * review & submit into `fn_vendor_onboard`.
 */

interface GovRow { id: number; name_ar: string; name_en: string }
interface AreaRow { id: number; governorate_id: number; name_ar: string; name_en: string }
interface CatRow { id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw redirect(`/${lang}/auth/login?error=db`);
  }
  const viewer = await client.auth.getUser();
  const userId = viewer.data.user?.id;
  if (!userId) {
    throw redirect(`/${lang}/auth/login?next=${encodeURIComponent(`/${lang}/vendor/onboarding`)}`);
  }
  const { data: profile } = await client.from("profiles").select("status").eq("id", userId).single();
  if (profile?.status === "blocked") {
    throw redirect(`/${lang}/auth/login?error=blocked`);
  }

  const [vendor, config, mediaRow] = await Promise.all([
    fetchVendorRow(client, userId),
    fetchVendorConfig(client),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);

  // No skipping: active/suspended stores have nothing to onboard.
  if (vendor && (vendor.status === "active" || vendor.status === "suspended")) {
    throw redirect(`/${lang}/vendor`);
  }

  const [govs, areas, cats, docs] = await Promise.all([
    client.from("governorates").select("id, name_ar, name_en").eq("is_active", true).order("sort"),
    client.from("areas").select("id, governorate_id, name_ar, name_en").eq("is_active", true).order("sort"),
    client
      .from("categories")
      .select("id, parent_id, depth, name_ar, name_en")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort"),
    vendor ? fetchVendorDocuments(client, vendor.id) : Promise.resolve([]),
  ]);

  return data({
    lang,
    uid: userId,
    vendor,
    config,
    documents: docs,
    governorates: (govs.data ?? []) as GovRow[],
    areas: (areas.data ?? []) as AreaRow[],
    categories: (cats.data ?? []) as CatRow[],
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  });
}

type ActionData =
  | { ok: true; savedAt?: string; redirectTo?: string }
  | { ok: false; error?: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const viewer = await client.auth.getUser();
  const userId = viewer.data.user?.id;
  if (!userId) return data<ActionData>({ ok: false, error: "auth" }, { status: 401 });

  if (intent === "autosave") {
    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload") ?? "{}"));
    } catch {
      return data<ActionData>({ ok: false, error: "payload" }, { status: 400 });
    }
    const step = Number((payload as { step?: unknown }).step ?? 1);
    const { error } = await client.rpc("fn_vendor_autosave", {
      p_step: step,
      p_data: (payload as { data?: unknown }).data ?? {},
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true as const, savedAt: new Date().toISOString() };
  }

  if (intent === "submit") {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(form.get("payload") ?? "{}")) as Record<string, unknown>;
    } catch {
      return data<ActionData>({ ok: false, error: "payload" }, { status: 400 });
    }
    const { error } = await client.rpc("fn_vendor_onboard", { p_data: payload });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    if (request.headers.get("sec-fetch-mode") === "navigate") {
      throw redirect(`/${lang}/vendor/onboarding?done=1`);
    }
    return { ok: true as const, redirectTo: `/${lang}/vendor/onboarding?done=1` };
  }

  return data<ActionData>({ ok: false, error: "intent" }, { status: 400 });
}

/* ------------------------------------------------------------------ pieces */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ErrorSummary({ items }: { items: Array<{ field: string; label: string }> }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [items.length]);
  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="wizard-error-title"
      className="rounded-md border border-danger/40 bg-danger-soft p-3"
    >
      <p id="wizard-error-title" className="text-sm font-extrabold text-danger">
        {t("common.errorSummary", { count: items.length })}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.field}>
            <button
              type="button"
              className="cursor-pointer text-start text-sm font-bold text-danger underline underline-offset-2"
              onClick={() => {
                const el = document.getElementById(item.field);
                el?.scrollIntoView({ block: "center" });
                (el as HTMLElement | null)?.focus?.();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MediaField({
  label,
  value,
  kind,
  settings,
  uid,
  supabaseUrl,
  onChange,
}: {
  label: string;
  value: string;
  kind: "logo" | "banner";
  settings: ReturnType<typeof parseMediaSettings>;
  uid: string;
  supabaseUrl: string;
  onChange: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold text-text">{label}</span>
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint ${
            kind === "logo" ? "size-16" : "h-16 w-32"
          }`}
        >
          {value ? (
            <MediaImage
              path={value}
              alt={label}
              width={kind === "logo" ? 64 : 128}
              height={64}
              className="max-h-full max-w-full object-contain"
              supabaseUrl={supabaseUrl}
            />
          ) : (
            <span className="text-2xs text-text-faint">{t("vendorOnboarding.noImage")}</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            {t("media.picker.choose")}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
              {t("common.remove")}
            </Button>
          ) : null}
        </div>
      </div>
      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        settings={settings}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => {
          if (files[0]) onChange(files[0].path);
        }}
      />
    </div>
  );
}

const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function DocumentUploader({
  docType,
  label,
  existing,
  vendorId,
  uid,
  maxMb,
  onChanged,
}: {
  docType: string;
  label: string;
  existing: VendorDocumentRow | undefined;
  vendorId: string;
  uid: string;
  maxMb: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [pct, setPct] = useState<number | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function preview() {
    if (!existing) return;
    const c = getSupabaseBrowserClient();
    if (!c) return;
    const { data } = await c.storage.from("documents").createSignedUrl(existing.path, 300);
    setSignedUrl(data?.signedUrl ?? null);
  }

  async function upload(file: File) {
    if (!DOC_MIMES.includes(file.type)) {
      toast.showToast("error", t("vendorOnboarding.docs.badType"));
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      toast.showToast("error", t("vendorOnboarding.docs.tooLarge", { max: maxMb }));
      return;
    }
    const c = getSupabaseBrowserClient();
    if (!c) return;
    const path = buildObjectPath(uid, file.name);
    setPct(0);
    const { data: session } = await c.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      setPct(null);
      toast.showToast("error", t("errors.generic"));
      return;
    }
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/documents/${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => resolve();
      xhr.onerror = () => resolve();
      xhr.send(file);
    });
    const { error } = await c.from("vendor_documents").upsert(
      {
        vendor_id: vendorId,
        type: docType,
        bucket: "documents",
        path,
        original_name: file.name,
        mime: file.type,
        size_bytes: file.size,
      },
      { onConflict: "vendor_id,type" },
    );
    setPct(null);
    if (error) {
      toast.showToast("error", t("errors.generic"));
      return;
    }
    toast.showToast("success", t("vendorOnboarding.docs.uploaded"));
    onChanged();
  }

  const statusTone = existing?.status === "verified" ? "success" : existing?.status === "rejected" ? "danger" : "warning";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-extrabold text-text">{label}</span>
        {existing ? (
          <Badge tone={statusTone}>{t(`vendorOnboarding.docs.status.${existing.status}`)}</Badge>
        ) : null}
        {existing?.status === "rejected" && existing.review_note ? (
          <span className="text-xs font-bold text-danger">{existing.review_note}</span>
        ) : null}
      </div>
      {existing ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="num truncate">{existing.original_name}</span>
          <button type="button" onClick={preview} className="cursor-pointer font-bold text-action hover:underline">
            {t("vendorOnboarding.docs.preview")}
          </button>
          {signedUrl ? (
            <a href={signedUrl} target="_blank" rel="noreferrer" className="font-bold text-action hover:underline">
              {t("vendorOnboarding.docs.open")}
            </a>
          ) : null}
        </div>
      ) : null}
      {pct !== null ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-action transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <span className="num text-xs font-bold text-text-muted">{pct}%</span>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {existing ? t("vendorOnboarding.docs.replace") : t("vendorOnboarding.docs.upload")}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={DOC_MIMES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <p className="text-2xs text-text-faint">
        {t("vendorOnboarding.docs.limits", { max: maxMb })}
      </p>
    </div>
  );
}

function CategoryMultiSelect({
  categories,
  selected,
  onToggle,
}: {
  categories: CatRow[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const roots = categories.filter((c) => c.parent_id === null);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-bold text-text">{t("vendorOnboarding.step1.categories")}</legend>
      <div className="grid max-h-72 gap-1.5 overflow-y-auto rounded-md border border-border bg-surface p-3 sm:grid-cols-2">
        {roots.map((root) => {
          const subs = categories.filter((c) => c.parent_id === root.id);
          return (
            <details key={root.id} className="rounded-md bg-surface-tint p-2">
              <summary className="cursor-pointer list-none text-sm font-bold text-text">
                {t("vendorOnboarding.locale") === "ar" ? root.name_ar : root.name_en}
              </summary>
              <div className="mt-1.5 flex flex-col gap-1 ps-4">
                {[root, ...subs].map((cat) => (
                  <label key={cat.id} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-action)]"
                      checked={selected.includes(cat.id)}
                      onChange={() => onToggle(cat.id)}
                    />
                    <span>{t("vendorOnboarding.locale") === "ar" ? cat.name_ar : cat.name_en}</span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      {selected.length > 0 ? (
        <p className="text-xs text-text-faint">
          {t("vendorOnboarding.step1.selectedCount", { count: selected.length })}
        </p>
      ) : null}
    </fieldset>
  );
}

/* ------------------------------------------------------------------- route */

interface FormState {
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
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const autosave = useFetcher<ActionData>();
  const submit = useFetcher<ActionData>();

  const vendor = loaderData.vendor;
  const config = loaderData.config;
  const [step, setStep] = useState<number>(vendor?.onboarding_step ?? 1);
  const [form, setForm] = useState<FormState>(() => stateFromVendor(vendor));
  const [stepErrors, setStepErrors] = useState<Array<{ field: string; label: string }>>([]);
  const [dirty, setDirty] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(vendor?.slug));

  const submitted = searchParams.get("done") === "1";
  const vendorId = vendor?.id ?? "";
  const isAr = lang === "ar";

  const patch = (partial: Partial<FormState>) => {
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

  const areas = loaderData.areas.filter((a) => a.governorate_id === form.governorate_id);

  function setStepAndSave(next: number) {
    setStepErrors([]);
    setStep(next);
    setDirty(true);
  }

  function validateStep(current: number): Array<{ field: string; label: string }> {
    const errors: Array<{ field: string; label: string }> = [];
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
    const all = [...validateStep(1), ...validateStep(2), ...validateStep(4)];
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
      phone: form.phone,
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

  const graceLabel = useMemo(() => {
    if (config.grace_unit === "hours") return t("vendorOnboarding.grace.hours", { count: config.grace_value });
    if (config.grace_unit === "months") return t("vendorOnboarding.grace.months", { count: config.grace_value });
    return t("vendorOnboarding.grace.days", { count: config.grace_value });
  }, [config, t]);

  /* ------------------------------------------------ confirmation screen */
  if (submitted) {
    const direct = config.onboarding_mode === "direct";
    return (
      <WizardShell lang={lang}>
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
                {t("vendorOnboarding.done.grace", { until: new Date(vendor.grace_until).toLocaleDateString(isAr ? "ar-EG" : "en-GB") })}
              </p>
            ) : null}
            <Link to={`/${lang}/vendor`}>
              <Button size="lg">{t("vendorOnboarding.done.toDashboard")}</Button>
            </Link>
          </CardBody>
        </Card>
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
        <Stepper steps={STEP_KEYS.map((key) => t(key))} current={step - 1} label={t("vendorOnboarding.progressLabel")} />

        <div className="flex items-center justify-between text-xs text-text-faint" aria-live="polite">
          <span>
            {t("vendorOnboarding.stepOf", { current: step, total: 5 })}
          </span>
          <span>
            {autosave.state !== "idle" || dirty
              ? t("vendorOnboarding.saving")
              : savedAt
                ? t("vendorOnboarding.savedAt", { time: new Date(savedAt).toLocaleTimeString(isAr ? "ar-EG" : "en-GB") })
                : ""}
          </span>
        </div>

        <ErrorSummary items={stepErrors} />

        <Card>
          <CardBody className="flex flex-col gap-4 p-5">
            {step === 1 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    id="store_name_ar"
                    label={t("vendorOnboarding.step1.nameAr")}
                    value={form.store_name_ar}
                    onChange={(e) => patch({ store_name_ar: e.target.value })}
                    required
                  />
                  <Input
                    id="store_name_en"
                    label={t("vendorOnboarding.step1.nameEn")}
                    value={form.store_name_en}
                    onChange={(e) => patch({ store_name_en: e.target.value })}
                    dir="ltr"
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    id="short_desc_ar"
                    label={t("vendorOnboarding.step1.shortDescAr")}
                    value={form.short_desc_ar}
                    onChange={(e) => patch({ short_desc_ar: e.target.value })}
                  />
                  <Input
                    id="short_desc_en"
                    label={t("vendorOnboarding.step1.shortDescEn")}
                    value={form.short_desc_en}
                    onChange={(e) => patch({ short_desc_en: e.target.value })}
                    dir="ltr"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    id="welcome_msg_ar"
                    label={t("vendorOnboarding.step1.welcomeAr")}
                    value={form.welcome_msg_ar}
                    onChange={(e) => patch({ welcome_msg_ar: e.target.value })}
                  />
                  <Input
                    id="welcome_msg_en"
                    label={t("vendorOnboarding.step1.welcomeEn")}
                    value={form.welcome_msg_en}
                    onChange={(e) => patch({ welcome_msg_en: e.target.value })}
                    dir="ltr"
                  />
                </div>
                <Input
                  id="slug"
                  label={t("vendorOnboarding.step1.slug")}
                  hint={t("vendorOnboarding.step1.slugHint")}
                  value={form.slug}
                  dir="ltr"
                  onChange={(e) => {
                    setSlugTouched(true);
                    patch({ slug: e.target.value });
                  }}
                />
                <CategoryMultiSelect
                  categories={loaderData.categories}
                  selected={form.category_ids}
                  onToggle={(id) =>
                    patch({
                      category_ids: form.category_ids.includes(id)
                        ? form.category_ids.filter((c) => c !== id)
                        : [...form.category_ids, id],
                    })
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <MediaField
                    label={t("vendorOnboarding.step1.logo")}
                    kind="logo"
                    value={form.logo_path}
                    settings={loaderData.media}
                    uid={loaderData.uid}
                    supabaseUrl={loaderData.supabaseUrl}
                    onChange={(path) => patch({ logo_path: path })}
                  />
                  <MediaField
                    label={t("vendorOnboarding.step1.banner")}
                    kind="banner"
                    value={form.banner_path}
                    settings={loaderData.media}
                    uid={loaderData.uid}
                    supabaseUrl={loaderData.supabaseUrl}
                    onChange={(path) => patch({ banner_path: path })}
                  />
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    id="first_name"
                    label={t("vendorOnboarding.step2.firstName")}
                    value={form.first_name}
                    onChange={(e) => patch({ first_name: e.target.value })}
                  />
                  <Input
                    id="last_name"
                    label={t("vendorOnboarding.step2.lastName")}
                    value={form.last_name}
                    onChange={(e) => patch({ last_name: e.target.value })}
                  />
                </div>
                <Input
                  id="phone"
                  label={t("vendorOnboarding.step2.phone")}
                  value={form.phone}
                  dir="ltr"
                  inputClassName="text-start"
                  onChange={(e) => patch({ phone: e.target.value })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    id="governorate_id"
                    label={t("vendorOnboarding.step2.governorate")}
                    value={form.governorate_id ? String(form.governorate_id) : ""}
                    onChange={(e) => patch({ governorate_id: e.target.value ? Number(e.target.value) : null, area_id: null })}
                    options={[
                      { value: "", label: t("common.choose") },
                      ...loaderData.governorates.map((g) => ({ value: String(g.id), label: isAr ? g.name_ar : g.name_en })),
                    ]}
                  />
                  <Select
                    id="area_id"
                    label={t("vendorOnboarding.step2.area")}
                    value={form.area_id ? String(form.area_id) : ""}
                    disabled={!form.governorate_id}
                    onChange={(e) => patch({ area_id: e.target.value ? Number(e.target.value) : null })}
                    options={[
                      { value: "", label: t("common.choose") },
                      ...areas.map((a) => ({ value: String(a.id), label: isAr ? a.name_ar : a.name_en })),
                    ]}
                  />
                </div>
                <Input
                  id="address1"
                  label={t("vendorOnboarding.step2.address1")}
                  value={form.address1}
                  onChange={(e) => patch({ address1: e.target.value })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    id="address2"
                    label={t("vendorOnboarding.step2.address2")}
                    value={form.address2}
                    onChange={(e) => patch({ address2: e.target.value })}
                  />
                  <Input
                    id="postal_code"
                    label={t("vendorOnboarding.step2.postal")}
                    value={form.postal_code}
                    onChange={(e) => patch({ postal_code: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["facebook", "instagram", "x", "tiktok", "whatsapp"] as const).map((platform) => (
                    <Input
                      key={platform}
                      id={`social_${platform}`}
                      label={t(`vendorOnboarding.socials.${platform}`)}
                      value={form.socials[platform]}
                      dir="ltr"
                      onChange={(e) => patch({ socials: { ...form.socials, [platform]: e.target.value } })}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3.5">
                  <ShieldIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
                  <div className="text-sm leading-relaxed text-text">
                    <p className="font-extrabold">{t("vendorOnboarding.step3.optionalTitle")}</p>
                    <p className="mt-1 text-text-muted">
                      {t("vendorOnboarding.step3.optionalBody", { grace: graceLabel })}
                    </p>
                    <p className="mt-1 font-bold text-warning">
                      {t("vendorOnboarding.step3.persistentWarning")}
                    </p>
                  </div>
                </div>
                {vendorId ? (
                  <div className="flex flex-col gap-3">
                    {(["id_front", "id_back", "commercial_register", "tax_card", "residence"] as const)
                      .filter((type) => config.required_documents[type])
                      .map((type) => (
                        <DocumentUploader
                          key={type}
                          docType={type}
                          label={t(`vendorOnboarding.docs.types.${type}`)}
                          existing={loaderData.documents.find((d) => d.type === type)}
                          vendorId={vendorId}
                          uid={loaderData.uid}
                          maxMb={config.max_document_mb}
                          onChanged={() => {
                            setVendorReady(true);
                            navigate(".", { replace: true });
                          }}
                        />
                      ))}
                  </div>
                ) : (
                  <EmptyState title={t("vendorOnboarding.docs.needStore")} body={t("vendorOnboarding.docs.needStoreBody")} />
                )}
                <Button type="button" variant="outline" onClick={() => setStepAndSave(4)}>
                  {t("vendorOnboarding.step3.skip")}
                </Button>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <details open className="rounded-md border border-border bg-surface-tint p-4">
                  <summary className="cursor-pointer text-sm font-extrabold text-text">
                    {t("vendorOnboarding.step4.contractTitle")}
                  </summary>
                  <p className="mt-3 max-h-64 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-text-muted">
                    {isAr ? config.terms_ar : config.terms_en}
                  </p>
                </details>
                <label className="flex items-start gap-2 text-start text-sm text-text">
                  <input
                    id="terms_accepted"
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]"
                    checked={form.terms_accepted}
                    onChange={(e) => patch({ terms_accepted: e.target.checked })}
                  />
                  <span className="leading-relaxed">{t("vendorOnboarding.step4.accept")}</span>
                </label>
                <Input
                  id="terms_signature"
                  label={t("vendorOnboarding.step4.signature")}
                  hint={t("vendorOnboarding.step4.signatureHint")}
                  value={form.terms_signature}
                  onChange={(e) => patch({ terms_signature: e.target.value })}
                />
              </>
            ) : null}

            {step === 5 ? (
              <div className="flex flex-col gap-3 text-sm">
                <ReviewBlock
                  title={t("vendorOnboarding.steps.store")}
                  onEdit={() => setStepAndSave(1)}
                  rows={[
                    [t("vendorOnboarding.step1.nameAr"), form.store_name_ar],
                    [t("vendorOnboarding.step1.nameEn"), form.store_name_en],
                    [t("vendorOnboarding.step1.slug"), form.slug],
                    [t("vendorOnboarding.step1.categories"), String(form.category_ids.length)],
                  ]}
                />
                <ReviewBlock
                  title={t("vendorOnboarding.steps.details")}
                  onEdit={() => setStepAndSave(2)}
                  rows={[
                    [t("vendorOnboarding.step2.firstName"), `${form.first_name} ${form.last_name}`],
                    [t("vendorOnboarding.step2.phone"), form.phone],
                    [
                      t("vendorOnboarding.step2.address1"),
                      `${form.address1}${form.address2 ? ` — ${form.address2}` : ""}`,
                    ],
                  ]}
                />
                <ReviewBlock
                  title={t("vendorOnboarding.steps.verification")}
                  onEdit={() => setStepAndSave(3)}
                  rows={[
                    [
                      t("vendorOnboarding.step3.documents"),
                      String(loaderData.documents.length),
                    ],
                    [t("vendorOnboarding.step3.grace"), graceLabel],
                  ]}
                />
                <ReviewBlock
                  title={t("vendorOnboarding.steps.terms")}
                  onEdit={() => setStepAndSave(4)}
                  rows={[
                    [t("vendorOnboarding.step4.signature"), form.terms_signature],
                    [
                      t("vendorOnboarding.step4.version"),
                      config.terms_version,
                    ],
                  ]}
                />
                <p className="text-xs text-text-faint">{t("vendorOnboarding.step5.note")}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={step === 1}
            onClick={() => setStepAndSave(Math.max(step - 1, 1))}
          >
            {t("common.back")}
          </Button>
          {step < 5 ? (
            <Button type="button" onClick={goNext}>
              {t("common.next")}
            </Button>
          ) : (
            <Button type="button" size="lg" loading={submit.state !== "idle"} onClick={submitAll}>
              {t("vendorOnboarding.submit")}
            </Button>
          )}
        </div>
      </div>
    </WizardShell>
  );
}

function ReviewBlock({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-border bg-surface-tint p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-text">{title}</p>
        <button type="button" onClick={onEdit} className="cursor-pointer text-xs font-bold text-action hover:underline">
          {t("common.edit")}
        </button>
      </div>
      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-2xs font-bold text-text-faint">{label}</dt>
            <dd className="truncate text-sm text-text">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Full-screen shell with noindex (US-01: no other page reachable). */
function WizardShell({ lang, children }: { lang: string; children: React.ReactNode }) {
  void lang;
  return (
    <div className="min-h-dvh bg-surface-alt py-6">
      <meta name="robots" content="noindex, nofollow" />
      <div className="mx-auto w-full max-w-[860px] px-4">{children}</div>
    </div>
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
