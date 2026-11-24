import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "~/components/ui";
import { MediaPickerDialog, MediaImage } from "~/features/media/components/media-ui";
import type { MediaSettings } from "~/lib/media.shared";
import type { CatRow } from "../server";
import type { FormState, OnboardingPatch } from "../useOnboarding";

/**
 * step1-store.tsx — wizard step 1 "store": bilingual names, descriptions,
 * welcome messages, slug, category multi-select and logo/banner media pickers.
 * Owns the two step-local pieces (MediaField, CategoryMultiSelect) so they
 * stay next to their only consumer.
 */

export function Step1Store({
  form,
  categories,
  media,
  uid,
  supabaseUrl,
  patch,
  onSlugChange,
}: {
  form: FormState;
  categories: CatRow[];
  media: MediaSettings;
  uid: string;
  supabaseUrl: string;
  patch: OnboardingPatch;
  onSlugChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
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
        onChange={(e) => onSlugChange(e.target.value)}
      />
      <CategoryMultiSelect
        categories={categories}
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
          settings={media}
          uid={uid}
          supabaseUrl={supabaseUrl}
          onChange={(path) => patch({ logo_path: path })}
        />
        <MediaField
          label={t("vendorOnboarding.step1.banner")}
          kind="banner"
          value={form.banner_path}
          settings={media}
          uid={uid}
          supabaseUrl={supabaseUrl}
          onChange={(path) => patch({ banner_path: path })}
        />
      </div>
    </>
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
  settings: MediaSettings;
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
      <legend className="text-sm font-bold text-text">
        {t("vendorOnboarding.step1.categories")}
        <span aria-hidden="true" className="ms-0.5 text-danger">*</span>
      </legend>
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
