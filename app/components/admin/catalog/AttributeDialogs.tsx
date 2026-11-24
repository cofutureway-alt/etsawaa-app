/**
 * All modal wiring for the admin catalog-attributes page: def create/edit,
 * option add/edit, category linking and the two archive confirms, plus the
 * shared media picker. Extracted from the route
 * `app/routes/admin/catalog/attributes.tsx`, which still owns every piece of
 * dialog state — all dialogs submit through the route's single `fetcher` so
 * the route's toast effect keeps observing every submit.
 */
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog } from "~/components/ui/Overlay";
// Layering exception: the media picker is feature-owned UI; these dialogs
// reuse it in place rather than forking it into components.
import { MediaPickerDialog } from "~/features/media/components/media-ui";
import type { MediaSettings } from "~/lib/media.shared";
import { AttributeForm } from "./AttributeForm";
import type {
  AttributesFetcher, DefDialogState, DefRow, LeafCategory, LinkRow,
  OptionDialogState, OptionRow, PickerImageState, UsageRow,
} from "./attributes.shared";

export interface AttributeDialogsProps {
  fetcher: AttributesFetcher;
  busy: boolean;
  selected: LeafCategory;
  leaves: LeafCategory[];
  defs: DefRow[];
  optionsFor: (defId: string) => OptionRow[];
  links: LinkRow[];
  media: MediaSettings;
  uid: string;
  supabaseUrl: string;
  defDialog: DefDialogState;
  optionDialog: OptionDialogState;
  linkDialog: DefRow | null;
  pickerImage: PickerImageState;
  deletingDef: DefRow | null;
  deletingOption: OptionRow | null;
  usage: UsageRow[] | null;
  usageLoading: boolean;
  setDefDialog: Dispatch<SetStateAction<DefDialogState>>;
  setOptionDialog: Dispatch<SetStateAction<OptionDialogState>>;
  setLinkDialog: Dispatch<SetStateAction<DefRow | null>>;
  setPickerImage: Dispatch<SetStateAction<PickerImageState>>;
  setDeletingDef: Dispatch<SetStateAction<DefRow | null>>;
  setDeletingOption: Dispatch<SetStateAction<OptionRow | null>>;
}

export function AttributeDialogs({
  fetcher, busy, selected, leaves, defs, optionsFor, links, media, uid, supabaseUrl,
  defDialog, optionDialog, linkDialog, pickerImage, deletingDef, deletingOption, usage, usageLoading,
  setDefDialog, setOptionDialog, setLinkDialog, setPickerImage, setDeletingDef, setDeletingOption,
}: AttributeDialogsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* def create/edit dialog */}
      <Dialog open={defDialog !== null} onClose={() => setDefDialog(null)} title={defDialog?.mode === "edit" ? t("catalog.editAttribute") : t("catalog.addAttribute")}>
        {defDialog ? (
          <fetcher.Form method="post" className="flex flex-col">
            <input type="hidden" name="intent" value={defDialog.mode === "edit" ? "def_update" : "def_create"} />
            <input type="hidden" name="category_id" value={defDialog.mode === "edit" ? (defDialog.def.category_id ?? "") : selected.id} />
            {defDialog.mode === "edit" ? <input type="hidden" name="id" value={defDialog.def.id} /> : null}
            <AttributeForm
              key={defDialog.mode === "edit" ? defDialog.def.id : "new"}
              mode={defDialog.mode}
              def={defDialog.mode === "edit" ? defDialog.def : null}
              defs={defs}
              busy={busy}
              onCancel={() => setDefDialog(null)}
            />
          </fetcher.Form>
        ) : null}
      </Dialog>

      {/* option dialog */}
      <Dialog open={optionDialog !== null} onClose={() => setOptionDialog(null)} title={optionDialog?.option ? t("catalog.editOption") : t("catalog.addOption")}>
        {optionDialog ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value={optionDialog.option ? "option_update" : "option_create"} />
            <input type="hidden" name="attribute_id" value={optionDialog.attributeId} />
            {optionDialog.option ? <input type="hidden" name="id" value={optionDialog.option.id} /> : null}
            <Input label={t("catalog.code")} name="code" defaultValue={optionDialog.option?.code ?? ""} required pattern="[a-z0-9_]{2,40}" dir="ltr" inputClassName="bg-surface" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t("catalog.labelAr")} name="label_ar" defaultValue={optionDialog.option?.label_ar ?? ""} required maxLength={60} inputClassName="bg-surface" />
              <Input label={t("catalog.labelEn")} name="label_en" defaultValue={optionDialog.option?.label_en ?? ""} required maxLength={60} dir="ltr" inputClassName="bg-surface" />
            </div>
            <Input label={t("catalog.colorHex")} name="color_hex" defaultValue={optionDialog.option?.color_hex ?? ""} pattern="#?[0-9a-fA-F]{6}" dir="ltr" placeholder="#RRGGBB" inputClassName="bg-surface" />
            <input type="hidden" name="image_path" value={pickerImage?.path ?? optionDialog.option?.image_path ?? ""} />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPickerImage({ attributeId: optionDialog.attributeId, option: optionDialog.option, path: optionDialog.option?.image_path ?? null })}>
                {t("media.choose")}
              </Button>
              {pickerImage?.path || optionDialog.option?.image_path ? <span className="text-xs text-text-muted">{t("catalog.imageSet")}</span> : null}
            </div>
            <input type="hidden" name="sort" value={optionDialog.option?.sort ?? optionsFor(optionDialog.attributeId).length} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOptionDialog(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.save")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      {/* link dialog */}
      <Dialog open={linkDialog !== null} onClose={() => setLinkDialog(null)} title={t("catalog.linkTitle")}>
        {linkDialog ? (
          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pe-1">
            {leaves.filter((l) => l.id !== selected.id).map((leaf) => {
              const linked = links.some((l) => l.attribute_id === linkDialog.id && l.category_id === leaf.id);
              return (
                <fetcher.Form key={leaf.id} method="post" className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <input type="hidden" name="attribute_id" value={linkDialog.id} />
                  <input type="hidden" name="category_id" value={leaf.id} />
                  <span className="text-sm font-bold text-text">{leaf.name_ar} <span className="font-normal text-text-muted">/ {leaf.name_en}</span></span>
                  {linked ? (
                    <>
                      <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.linked")}</span>
                      <button type="submit" name="intent" value="unlink" className="cursor-pointer text-xs font-bold text-danger hover:underline">{t("catalog.unlink")}</button>
                    </>
                  ) : (
                    <button type="submit" name="intent" value="link" className="cursor-pointer text-xs font-bold text-action hover:underline">{t("catalog.link")}</button>
                  )}
                </fetcher.Form>
              );
            })}
            {leaves.length <= 1 ? <p className="py-6 text-center text-sm text-text-muted">{t("catalog.noLeaves")}</p> : null}
          </div>
        ) : null}
      </Dialog>

      {/* delete confirms */}
      <Dialog open={deletingDef !== null} onClose={() => setDeletingDef(null)} title={t("common.confirm")}>
        {deletingDef ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="def_delete" />
            <input type="hidden" name="id" value={deletingDef.id} />
            <p className="text-sm font-bold text-text">
              {deletingDef.label_ar || deletingDef.code}
              {deletingDef.label_en ? <span className="font-normal text-text-muted"> · {deletingDef.label_en}</span> : null}
            </p>

            {usageLoading ? (
              <p className="text-xs text-text-muted">{t("common.loading")}</p>
            ) : usage && usage.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning-soft p-2.5">
                <p className="text-sm font-extrabold text-text">{t("catalog.inUseTitle")}</p>
                <p className="mt-1 text-xs leading-snug text-text">{t("catalog.inUseBody")}</p>
                <p className="mt-2 text-xs font-bold text-text">{t("catalog.inUseList")}</p>
                <ul className="mt-1 list-inside list-disc text-xs text-text">
                  {usage.slice(0, 6).map((u, i) => <li key={`${u.ref_type}-${i}`}>{u.ref_label || u.ref_type}</li>)}
                  {usage.length > 6 ? <li className="text-text-muted">+{usage.length - 6}</li> : null}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-text">{t("catalog.deleteDefConfirm", { code: deletingDef.label_ar || deletingDef.code })}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingDef(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>
                {usage && usage.length > 0 ? t("catalog.archiveInstead") : t("common.confirm")}
              </Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
      <Dialog open={deletingOption !== null} onClose={() => setDeletingOption(null)} title={t("common.confirm")}>
        {deletingOption ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="option_delete" />
            <input type="hidden" name="id" value={deletingOption.id} />
            <p className="text-sm text-text">{t("catalog.deleteOptionConfirm", { label: deletingOption.label_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingOption(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <MediaPickerDialog
        open={pickerImage !== null}
        onClose={() => setPickerImage(null)}
        title={t("media.pickImage")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => setPickerImage((cur) => (cur ? { ...cur, path: files[0]?.path ?? cur.path } : cur))}
      />
    </>
  );
}
