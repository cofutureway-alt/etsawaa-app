import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Dialog } from "~/components/ui";
import { Input } from "~/components/ui/Input";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { UploadIcon } from "~/components/ui/icons";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import { publicMediaUrl, type MediaSettings } from "~/lib/media.shared";

/**
 * The two brand decisions on the product review page:
 *  - accept: complete the seller's proposal (names, logo, description,
 *    country, founding year, sub-categories) and publish it;
 *  - reject: swap every product carrying the proposal to another brand (or
 *    none) and tell the seller why.
 */

export interface PendingBrand {
  id: string;
  name_ar: string;
  name_en: string;
  thumb_path: string | null;
  description_ar: string;
  description_en: string;
  country_ar: string;
  country_en: string;
  founded_year: number | null;
  category_ids: string[];
}
export interface BrandLite { id: string; name_ar: string; name_en: string; thumb_path: string | null }
export interface DepthTwoCategory { id: string; parent_id: string | null; name_ar: string; name_en: string }

interface ActionData { ok?: boolean; reason?: string }

const LABEL = "flex flex-col gap-1.5 text-sm font-bold text-text";
const AREA = "rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal leading-relaxed text-text focus:border-action focus:outline-none";

export function AcceptBrandDialog({
  open, onClose, brand, categories, media, uid, supabaseUrl, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  brand: PendingBrand;
  categories: DepthTwoCategory[];
  media: MediaSettings;
  uid: string;
  supabaseUrl: string;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<ActionData>();
  const busy = fetcher.state !== "idle";
  const [nameAr, setNameAr] = useState(brand.name_ar);
  const [nameEn, setNameEn] = useState(brand.name_en);
  const [descAr, setDescAr] = useState(brand.description_ar);
  const [descEn, setDescEn] = useState(brand.description_en);
  const [countryAr, setCountryAr] = useState(brand.country_ar);
  const [countryEn, setCountryEn] = useState(brand.country_en);
  const [year, setYear] = useState(brand.founded_year ? String(brand.founded_year) : "");
  const [thumb, setThumb] = useState<string | null>(brand.thumb_path);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState(brand.category_ids.filter((id) => categories.some((c) => c.id === id)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) { onSuccess(); return; }
    const reason = fetcher.data.reason ?? "";
    setError(reason === "duplicate" ? t("productReview.brand.duplicate")
      : reason === "not_pending" ? t("productReview.brand.notPending")
      : reason === "bad_name" ? t("productWizard.brandPropose.badName")
      : t("productReview.brand.failed"));
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // depth-2 categories grouped under their main category
  const groups = new Map<string, DepthTwoCategory[]>();
  for (const c of categories) {
    if (!c.parent_id) continue;
    const list = groups.get(c.parent_id) ?? [];
    list.push(c);
    groups.set(c.parent_id, list);
  }
  const options = [...groups.entries()].flatMap(([parent, list], i) => {
    const parentCat = categories.find((c) => c.id === parent);
    const group = parentCat ? (en ? parentCat.name_en : parentCat.name_ar) : String(i + 1);
    return list.map((c) => ({ value: c.id, label: en ? c.name_en : c.name_ar, keywords: `${c.name_ar} ${c.name_en}`, group }));
  });

  const submit = () => {
    const ar = nameAr.trim();
    const ne = nameEn.trim();
    if (ar.length < 2 || ar.length > 60 || ne.length < 2 || ne.length > 60) {
      setError(t("productWizard.brandPropose.badName"));
      return;
    }
    setError(null);
    const data = new FormData();
    data.set("intent", "accept_brand");
    data.set("brand_id", brand.id);
    data.set("name_ar", ar);
    data.set("name_en", ne);
    data.set("thumb_path", thumb ?? "");
    data.set("description_ar", descAr);
    data.set("description_en", descEn);
    data.set("country_ar", countryAr);
    data.set("country_en", countryEn);
    data.set("founded_year", year);
    for (const id of selected) data.append("category_ids", id);
    fetcher.submit(data, { method: "post" });
  };

  // the picker is a sibling, not a child: the form dialog hides while it is
  // open, and a child would unmount with it (the picker never appeared)
  return (
    <>
    <Dialog open={open && !picker} onClose={onClose} title={t("productReview.brand.acceptTitle")} size="lg">
      <div className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto pe-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t("catalog.nameAr")} value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={60} minLength={2} />
          <Input label={t("catalog.nameEn")} value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={60} minLength={2} dir="ltr" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-text">{t("catalog.logo")}</p>
          <div className="flex items-center gap-3">
            <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white p-1">
              {thumb
                ? <img src={publicMediaUrl(supabaseUrl, thumb)} alt="" width={80} height={80} className="size-full object-contain" />
                : <span className="text-2xs text-text-faint">{t("ab.noLogo")}</span>}
            </span>
            <div className="flex flex-col gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => setPicker(true)}>
                <UploadIcon className="size-4" />{thumb ? t("ab.changeLogo") : t("media.choose")}
              </Button>
              {thumb ? <Button type="button" size="sm" variant="ghost" onClick={() => setThumb(null)}>{t("ab.removeLogo")}</Button> : null}
            </div>
          </div>
        </div>
        <label className={LABEL}>{t("catalog.brandDescAr")}
          <textarea value={descAr} onChange={(e) => setDescAr(e.target.value)} rows={3} maxLength={2000} className={AREA} />
        </label>
        <label className={LABEL}>{t("catalog.brandDescEn")}
          <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={3} maxLength={2000} dir="ltr" className={AREA} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={t("ab.countryAr")} value={countryAr} onChange={(e) => setCountryAr(e.target.value)} maxLength={60} />
          <Input label={t("ab.countryEn")} value={countryEn} onChange={(e) => setCountryEn(e.target.value)} maxLength={60} dir="ltr" />
          <Input label={t("ab.founded")} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" dir="ltr" placeholder="1990" />
        </div>
        <SelectMenu multiple id="accept-brand-cats" label={t("ab.col.categories")} options={options} value={selected} onChange={setSelected} searchable
          placeholder={t("ab.pickCategories")} hint={t("ab.categoriesHint")} />
        {error ? <p role="alert" className="text-xs font-bold text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" loading={busy} onClick={submit}>{t("productReview.brand.confirmAccept")}</Button>
        </div>
      </div>
    </Dialog>
    <MediaPickerDialog open={open && picker} onClose={() => setPicker(false)} title={t("media.pickImage")} settings={media} uid={uid}
      supabaseUrl={supabaseUrl} mode="single" kinds={["image"]} onConfirm={(files) => { setThumb(files[0]?.path ?? null); setPicker(false); }} />
    </>
  );
}

export function RejectBrandDialog({
  open, onClose, brand, brands, supabaseUrl, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  brand: PendingBrand;
  brands: BrandLite[];
  supabaseUrl: string;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<ActionData>();
  const busy = fetcher.state !== "idle";
  const [replacement, setReplacement] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) { onSuccess(); return; }
    setError(t("productReview.brand.failed"));
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = [
    { value: "", label: t("productReview.brand.noBrand") },
    ...brands.map((b) => ({
      value: b.id,
      label: en ? b.name_en || b.name_ar : b.name_ar || b.name_en,
      keywords: `${b.name_ar} ${b.name_en}`,
      icon: b.thumb_path
        ? <MediaImage path={b.thumb_path} alt="" width={24} height={24} supabaseUrl={supabaseUrl} className="size-6 !bg-transparent !object-contain" />
        : undefined,
    })),
  ];

  const submit = () => {
    setError(null);
    fetcher.submit({
      intent: "reject_brand",
      brand_id: brand.id,
      replacement: replacement ?? "",
      note,
    }, { method: "post" });
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("productReview.brand.rejectTitle")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">{t("productReview.brand.rejectHint", { ar: brand.name_ar, en: brand.name_en })}</p>
        <SelectMenu id="reject-brand" label={t("productReview.brand.replacement")} options={options} value={replacement} onChange={setReplacement} searchable
          placeholder={t("productReview.brand.noBrand")} />
        <label className={LABEL}>{t("productReview.brand.note")}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className={AREA} placeholder={t("productReview.brand.notePlaceholder")} />
        </label>
        {error ? <p role="alert" className="text-xs font-bold text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" className="bg-danger hover:bg-danger" loading={busy} onClick={submit}>{t("productReview.brand.confirmReject")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
