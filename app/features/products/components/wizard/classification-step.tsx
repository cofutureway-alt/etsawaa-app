import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "~/components/ui";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { VideoIcon } from "~/components/ui/icons";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import { publicMediaUrl, type MediaSettings } from "~/lib/media.shared";
import { BrandProposeDialog } from "./brand-propose-dialog";
import { CategoryPicker } from "./category-picker";
import type { PickerCategory, WizardBrand, WizardForm } from "./types";

/**
 * Wizard step 2 — classification & media: 3-level category pick, brand,
 * tag chips, gallery (first image becomes the main shot, capped at 12) and
 * the fragile flag. Picking a category also triggers the leaf-template
 * fetch so the attributes step is never a blank page (handled by the
 * orchestrator via `onCategoryChange`).
 */

export interface ClassificationStepProps {
  form: WizardForm;
  patch: (partial: Partial<WizardForm>) => void;
  categories: PickerCategory[];
  brands: WizardBrand[];
  tags: Array<{ id: string; name_ar: string; name_en: string }>;
  isAr: boolean;
  uid: string;
  supabaseUrl: string;
  media: MediaSettings;
  /** Gallery picker dialog visibility — owned by the orchestrator. */
  galleryOpen: boolean;
  onGalleryOpenChange: (open: boolean) => void;
  /** Category picked: resets attributes/axes and fetches the leaf template. */
  onCategoryChange: (leafId: string) => void;
  /** A proposed (or already-existing) brand joins the select and gets selected. */
  onBrandAdded: (brand: WizardBrand) => void;
  /** Sellers may propose missing brands; the admin editor does not. */
  canPropose?: boolean;
}

export function ClassificationStep({
  form,
  patch,
  categories,
  brands,
  tags,
  isAr,
  uid,
  supabaseUrl,
  media,
  galleryOpen,
  onGalleryOpenChange,
  onCategoryChange,
  onBrandAdded,
  canPropose = false,
}: ClassificationStepProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [mainPickerOpen, setMainPickerOpen] = useState(false);
  // the seller's "brand is missing" proposal dialog
  const [proposeOpen, setProposeOpen] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  // media[0] is the main image; only images qualify
  const mainImage = form.media[0]?.kind === "image" ? form.media[0] : null;
  const gallery = mainImage ? form.media.slice(1) : form.media;

  // `brands` is already the chosen category's list (server-filtered: linked to
  // the leaf or an ancestor), plus the product's saved brand when editing and
  // the seller's own pending proposals.
  const allowed = form.leaf_category_id ? brands : [];
  const brandOptions = allowed
    .map((b) => {
      const name = isAr ? b.name_ar || b.name_en : b.name_en || b.name_ar;
      return {
        value: b.id,
        label: b.pending ? `${name} · ${t("productWizard.brandPropose.pending")}` : name,
        // both names stay searchable: "توشيبا" and "toshiba" find the same brand
        keywords: `${b.name_ar} ${b.name_en}`,
        icon: b.thumb_path ? (
          <MediaImage path={b.thumb_path} alt="" width={24} height={24} supabaseUrl={supabaseUrl} className="size-6 !bg-transparent !object-contain" />
        ) : undefined,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, isAr ? "ar" : "en"));
  return (
    <>
      <CategoryPicker
        categories={categories}
        value={form.leaf_category_id}
        isAr={isAr}
        onChange={(leafId) => {
          onCategoryChange(leafId);
        }}
      />
      <SelectMenu
        id="p_brand"
        label={t("productWizard.classification.brand")}
        value={form.brand_id || null}
        onChange={(v) => patch({ brand_id: v ?? "" })}
        disabled={!form.leaf_category_id || brandOptions.length === 0}
        placeholder={!form.leaf_category_id ? t("productWizard.classification.brandPickCategory") : brandOptions.length === 0 ? t("productWizard.classification.brandNone") : t("common.none")}
        hint={form.leaf_category_id && brandOptions.length > 0 ? t("productWizard.classification.brandHint", { count: allowed.length }) : undefined}
        searchable
        options={[{ value: "", label: t("common.none") }, ...brandOptions]}
      />
      {canPropose ? (
        <button
          type="button"
          onClick={() => setProposeOpen(true)}
          disabled={!form.leaf_category_id}
          className="-mt-1 cursor-pointer self-start text-xs font-bold text-action hover:underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline"
        >
          {t("productWizard.brandPropose.cta")}
        </button>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold text-text">{t("productWizard.classification.tags")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const active = form.tag_ids.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  patch({
                    tag_ids: active ? form.tag_ids.filter((id) => id !== tag.id) : [...form.tag_ids, tag.id],
                  })
                }
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-bold transition-colors duration-150 ${
                  active ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:bg-surface-tint"
                }`}
              >
                {isAr ? tag.name_ar : tag.name_en}
              </button>
            );
          })}
        </div>
      </fieldset>
      {/* main image: media[0] is the product's main (card/LCP) image */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-text">{t("productWizard.classification.mainImage")}<span aria-hidden="true" className="ms-0.5 text-danger">*</span></p>
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => setMainPickerOpen(true)}
            className="relative flex size-32 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-md border-2 border-dashed border-border-strong bg-surface text-text-muted transition-colors duration-150 hover:border-action hover:text-action"
          >
            {mainImage ? (
              <MediaImage path={mainImage.path} alt="" width={128} height={128} supabaseUrl={supabaseUrl} className="size-full object-cover" />
            ) : (
              <>
                <span aria-hidden="true" className="text-2xl">+</span>
                <span className="text-xs font-bold">{t("productWizard.classification.chooseMain")}</span>
              </>
            )}
          </button>
          {mainImage ? (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setMainPickerOpen(true)} className="cursor-pointer text-start text-xs font-bold text-action hover:underline">
                {t("productWizard.classification.changeMain")}
              </button>
              <button type="button" onClick={() => patch({ media: form.media.slice(1) })} className="cursor-pointer text-start text-xs font-bold text-danger hover:underline">
                {t("common.remove")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* gallery: the remaining images */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-text">{t("productWizard.classification.gallery")}</p>
        {/* an even grid on every screen; actions stay visible on touch screens (no hover there) */}
        <div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 sm:grid-cols-6 lg:grid-cols-8">
          {gallery.map((item, i) => {
            // `gallery` starts after the main image (index 0) when there is one
            const index = i + (mainImage ? 1 : 0);
            return (
              <div key={`${item.path}-${index}`} className="group relative aspect-square overflow-hidden rounded-md border border-border bg-surface-tint">
                {item.kind === "image" ? (
                  <MediaImage path={item.path} alt="" width={160} height={160} supabaseUrl={supabaseUrl} className="size-full object-cover" />
                ) : (
                  <span className="relative block size-full bg-ink">
                    <video src={publicMediaUrl(supabaseUrl, item.path)} muted playsInline preload="metadata" aria-label={t("productWizard.classification.video")} className="size-full object-cover" />
                    <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                      <span className="grid size-7 place-items-center rounded-full bg-ink/70 text-white"><VideoIcon className="size-3.5" /></span>
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t("common.remove")}
                  onClick={() => patch({ media: form.media.filter((_, j) => j !== index) })}
                  className="absolute end-1 top-1 flex size-7 cursor-pointer items-center justify-center rounded-full bg-danger text-sm font-black text-white shadow-1"
                >
                  ×
                </button>
                {item.kind === "image" ? (
                  <button
                    type="button"
                    onClick={() => patch({ media: [item, ...form.media.filter((_, j) => j !== index)] })}
                    className="absolute inset-x-0 bottom-0 min-h-7 cursor-pointer bg-ink/70 py-1 text-center text-2xs font-bold text-white transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus:opacity-100"
                  >
                    {t("productWizard.classification.setMain")}
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => onGalleryOpenChange(true)}
            className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong bg-surface p-1 text-center text-text-muted transition-colors duration-150 hover:bg-surface-tint"
          >
            <span aria-hidden="true" className="text-xl">+</span>
            <span className="text-2xs font-bold">{t("media.picker.choose")}</span>
          </button>
        </div>
        <p className="text-2xs text-text-faint">{t("productWizard.classification.galleryHint")}</p>
        <p className="text-2xs text-text-faint">{t("productWizard.classification.videoHint")}</p>
        {mediaNotice ? (
          <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-xs font-bold text-warning-strong">{mediaNotice}</p>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" className="size-4 accent-[var(--color-action)]" checked={form.is_fragile} onChange={(e) => patch({ is_fragile: e.target.checked })} />
        {t("productWizard.classification.fragile")}
      </label>
      <MediaPickerDialog
        open={mainPickerOpen}
        onClose={() => setMainPickerOpen(false)}
        title={t("productWizard.classification.mainImage")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => {
          const picked = files[0];
          if (picked) {
            const rest = (mainImage ? form.media.slice(1) : form.media).filter((m) => m.path !== picked.path);
            patch({ media: [{ kind: "image" as const, path: picked.path }, ...rest].slice(0, 12) });
          }
          setMainPickerOpen(false);
        }}
      />
      <MediaPickerDialog
        open={galleryOpen}
        onClose={() => onGalleryOpenChange(false)}
        title={t("productWizard.classification.media")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="multi"
        kinds={["image", "video"]}
        onConfirm={(files) => {
          // skip files already on the product (picking the same file twice duplicated it)
          const have = new Set(form.media.map((m) => m.path));
          const next = [...form.media];
          let videos = next.filter((m) => m.kind === "video").length;
          let tooManyVideos = false;
          let tooManyItems = false;
          for (const file of files) {
            if (have.has(file.path)) continue;
            const kind = file.kind === "video" ? "video" : "image";
            // at most two videos per product; images stay under the 12-item cap
            if (kind === "video" && videos >= 2) { tooManyVideos = true; continue; }
            if (next.length >= 12) { tooManyItems = true; break; }
            if (kind === "video") videos += 1;
            have.add(file.path);
            next.push({ kind, path: file.path });
          }
          patch({ media: next });
          setMediaNotice(tooManyVideos ? t("productWizard.classification.videoLimit")
            : tooManyItems ? t("productWizard.classification.galleryLimit") : null);
        }}
      />
      <BrandProposeDialog
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        categoryId={form.leaf_category_id}
        onResolved={(brand, existing) => {
          setProposeOpen(false);
          onBrandAdded(brand);
          toast.showToast("success", existing ? t("productWizard.brandPropose.exists") : t("productWizard.brandPropose.added"));
        }}
      />
    </>
  );
}
