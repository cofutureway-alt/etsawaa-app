import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { Button, Input } from "~/components/ui";
import { ChevronDownIcon, CopyIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import type { MediaSettings } from "~/lib/media.shared";
import { addVariant, childProblems, emptyChild, isBaseOffer, newKey, nextConfigRow, nextVariant, SIZES_MODE, sizeAxisKind, type ChildDraft, type ChildSize, type SizeOption, type VariantMode } from "./children";
import { ColorPicker, swatchStyle } from "./color-picker";
import type { SaveActionData, TemplateOption } from "./types";

/**
 * Wizard step — child products. Each child is an accordion panel: colour →
 * sizes → stock per size → price → discount + window → images; the SKU of
 * every size row is generated on save. Once the product has variants, each
 * one needs the options its category uses (colour and/or sizes), a colour is
 * used by one variant only, and a new variant starts with the previous one's
 * prices.
 */
export function ChildrenStep({
  childList, setChildList, colors, sizes, hasColor, hasSize, isAr,
  media, uid, supabaseUrl, canSave, saving, onSave, editable, adminMode = false,
  ramOptions = [], mode = SIZES_MODE,
}: {
  /** admin edit: one sticky save action instead of per-step save/submit */
  adminMode?: boolean;
  /** RAM options (phones / computers) */
  ramOptions?: TemplateOption[];
  /** config: each row is storage + RAM with its own price (phones / computers) */
  mode?: VariantMode;
  childList: ChildDraft[];
  setChildList: (next: ChildDraft[]) => void;
  colors: TemplateOption[];
  sizes: SizeOption[];
  hasColor: boolean;
  hasSize: boolean;
  isAr: boolean;
  media: MediaSettings;
  uid: string;
  supabaseUrl: string;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState<string | null>(childList[0]?.key ?? null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // "Add variant" was clicked → show the variants list even while it holds one plain variant
  const [variantMode, setVariantMode] = useState(() => !isBaseOffer(childList));
  const showBase = isBaseOffer(childList) && (!variantMode || childList.length === 0);
  const base = childList[0];
  // edit the base offer; the first keystroke creates it (one plain variant)
  const patchBase = (patch: Partial<ChildDraft>) =>
    setChildList([{ ...(base ?? emptyChild(false)), ...patch }]);
  // a custom colour created from the base block needs the base child first
  const ensureBase = (): ChildDraft => {
    if (base) return base;
    const fresh = emptyChild(hasSize);
    setChildList([fresh]);
    return fresh;
  };
  const baseRow: ChildSize = base?.sizes[0] ?? { size_option_id: "", stock: "0", sku: null };
  const baseRows = base?.sizes ?? [];
  const manyBaseSizes = baseRows.length > 1;
  const startVariants = () => {
    let next = addVariant(childList, hasSize);
    // configuration rows carry their own price: start them at the price typed so far
    if (mode.config) next = next.map((c) => ({ ...c, sizes: c.sizes.map((x) => ({ ...x, price: x.price || c.price, sale_price: x.sale_price || c.sale_price })) }));
    setChildList(next);
    setVariantMode(true);
    setOpenKey(next[next.length - 1]!.key);
  };
  const removeChild = (key: string) => {
    const next = childList.filter((o) => o.key !== key);
    setChildList(next);
    if (isBaseOffer(next)) setVariantMode(false);
  };

  // custom colours the seller adds here join the palette right away
  const [extraColors, setExtraColors] = useState<TemplateOption[]>([]);
  const allColors = useMemo(
    () => [...colors, ...extraColors.filter((e) => !colors.some((c) => c.id === e.id))],
    [colors, extraColors],
  );
  const colorFetcher = useFetcher<SaveActionData>();
  const colorFor = useRef<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const createColor = (childKey: string, hex: string, name: string, nameEn = "") => {
    colorFor.current = childKey;
    setColorError(null);
    colorFetcher.submit({ intent: "add_color", hex, name, name_en: nameEn }, { method: "post" });
  };

  // the size axis reads as sizes, pack sizes or storage depending on the product type
  const kind = sizeAxisKind(sizes);
  const sk = (key: string) => (kind === "size" ? key : `${key}_${kind}`);
  const problemText = (p: string) => t(p === "children.err.sizes" ? sk(p) : p);

  const colorName = (id: string) => {
    const c = allColors.find((o) => o.id === id);
    return c ? (isAr ? c.label_ar || c.label_en : c.label_en || c.label_ar) : "";
  };
  const sizeName = (id: string) => {
    const s = sizes.find((o) => o.option_id === id);
    return s ? (isAr ? s.label_ar || s.label_en : s.label_en || s.label_ar) : "";
  };
  const sizeOptionOf = (s: SizeOption, disabled = false) => ({
    value: s.option_id,
    label: isAr ? s.label_ar || s.label_en : s.label_en || s.label_ar,
    group: isAr ? s.type_name_ar : s.type_name_en,
    disabled,
  });
  const update = (key: string, patch: Partial<ChildDraft>) =>
    setChildList(childList.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  // new variant: the previous one's prices; duplicate: also its images (never its colour — one colour, one variant)
  const add = (base?: ChildDraft) => {
    const next: ChildDraft = base
      ? { ...base, key: newKey(), id: null, color_option_id: "",
          // a copied phone keeps its configurations (storage, RAM, prices) with no stock yet
          sizes: mode.config ? base.sizes.map((x) => ({ ...x, stock: "0", sku: null })) : [{ size_option_id: "", stock: "0", sku: null }],
          images: [...base.images] }
      : nextVariant(childList, hasSize);
    if (!base && mode.config) {
      const prev = childList[childList.length - 1];
      next.sizes = [nextConfigRow(prev?.sizes ?? [], prev?.price ?? "", prev?.sale_price ?? "")];
    }
    setChildList([...childList, next]);
    setOpenKey(next.key);
  };

  useEffect(() => {
    if (colorFetcher.state !== "idle" || !colorFetcher.data || colorFetcher.data.intent !== "add_color") return;
    const res = colorFetcher.data;
    if (res.ok && res.color) {
      const made = res.color;
      setExtraColors((cur) => (cur.some((c) => c.id === made.id) ? cur : [...cur, made]));
      const key = colorFor.current;
      // the new colour goes to the variant it was made for (unless another variant already uses it)
      if (key && !childList.some((o) => o.key !== key && o.color_option_id === made.id)) update(key, { color_option_id: made.id });
      colorFor.current = null;
    } else if (!res.ok) {
      setColorError(t(res.error === "too_many_colors" ? "children.customColorLimit" : "children.customColorFailed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorFetcher.state, colorFetcher.data]);

  // variants exist only to offer options: a category without colour or size sells one offer
  const canAddVariant = hasColor || hasSize || !showBase;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-text">{t("children.title")}</h2>
          <p className="mt-0.5 max-w-xl text-xs text-text-muted">{hasColor || hasSize ? t("children.hint") : t("children.hintPlain")}</p>
        </div>
        {editable && !adminMode ? (
          <Button type="button" variant="outline" size="sm" onClick={onSave} loading={saving} disabled={!canSave}>
            {t("children.save")}
          </Button>
        ) : null}
      </div>
      {!canSave && editable && !adminMode ? <p className="rounded-md bg-warning-soft px-3 py-2 text-xs font-bold text-warning-strong">{t("children.saveFirst")}</p> : null}

      {showBase ? (
        /* no variants: the base offer is one group + one row, so it can carry
           an optional colour / size (or storage + RAM on phones) too */
        <fieldset disabled={!editable} className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <legend className="sr-only">{t("children.baseTitle")}</legend>
          <div>
            <p className="text-sm font-extrabold text-text">{t("children.baseTitle")}</p>
            <p className="mt-0.5 text-xs text-text-muted">{hasColor || hasSize ? t("children.baseHintOptions") : t("children.baseHint")}</p>
          </div>

          {mode.config ? (
            <>
              {hasColor ? (
                <ColorPicker
                  label={`1. ${t("children.color")}`}
                  required={false}
                  colors={allColors}
                  value={base?.color_option_id ?? ""}
                  taken={new Set<string>()}
                  isAr={isAr}
                  onChange={(id) => patchBase({ color_option_id: id })}
                  onCreate={(hex, name, nameEn) => { const b = ensureBase(); createColor(b.key, hex, name, nameEn); }}
                  creating={colorFetcher.state !== "idle"}
                  createError={colorError}
                />
              ) : null}
              <ConfigRows
                rows={base?.sizes.length ? base.sizes : [{ size_option_id: "", stock: "0", sku: null }]}
                sizes={sizes}
                ramOptions={ramOptions}
                hasRam={mode.hasRam}
                isAr={isAr}
                allowAdd={false}
                onChange={(rows) => patchBase({ sizes: rows })}
              />
              {base?.sizes.some((x) => x.sale_price?.trim()) ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="base-from" label={t("children.saleFrom")} type="datetime-local" dir="ltr"
                    value={base?.sale_starts_at ?? ""} onChange={(e) => patchBase({ sale_starts_at: e.target.value })} hint={t("children.saleFromHint")} />
                  <Input id="base-to" label={t("children.saleTo")} type="datetime-local" dir="ltr"
                    value={base?.sale_ends_at ?? ""} onChange={(e) => patchBase({ sale_ends_at: e.target.value })} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              {hasColor || hasSize ? (
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  {hasColor ? (
                    <ColorPicker
                      label={`1. ${t("children.color")}`}
                      required={false}
                      colors={allColors}
                      value={base?.color_option_id ?? ""}
                      taken={new Set<string>()}
                      isAr={isAr}
                      onChange={(id) => patchBase({ color_option_id: id })}
                      onCreate={(hex, name, nameEn) => { const b = ensureBase(); createColor(b.key, hex, name, nameEn); }}
                      creating={colorFetcher.state !== "idle"}
                      createError={colorError}
                    />
                  ) : null}
                  {hasSize ? (
                    <SelectMenu multiple
                      label={`${hasColor ? 2 : 1}. ${t(sk("children.sizes"))}`}
                      options={sizes.map((s) => sizeOptionOf(s))}
                      value={baseRows.map((s) => s.size_option_id).filter(Boolean)}
                      placeholder={t(sk("children.noSizes"))}
                      hint={sizes.length === 0 ? t("children.noSizeTypes") : undefined}
                      onChange={(ids) => {
                        const picked = ids.filter(Boolean);
                        // keep the stock typed for a size that stays picked; a new one starts at 0
                        patchBase({
                          sizes: picked.length
                            ? picked.map((id) => baseRows.find((s) => s.size_option_id === id) ?? { size_option_id: id, stock: "0", sku: null })
                            : [baseRows.find((s) => !s.size_option_id) ?? { size_option_id: "", stock: baseRows.length === 1 ? baseRows[0]!.stock : "0", sku: null }],
                        });
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {manyBaseSizes ? (
                /* several sizes = one stock per size (the single stock input below is hidden) */
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-sm font-bold text-text">{t(sk("children.stockTitle"))}<span className="ms-0.5 text-danger">*</span></p>
                    <p className="text-xs text-text-muted">{t("children.baseSizesHint")}</p>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border bg-surface">
                    <div className="grid grid-cols-[1fr_7rem] gap-2 bg-surface-tint/50 px-3 py-2 text-2xs font-bold text-text-muted sm:grid-cols-[1fr_8rem_1fr]">
                      <span>{t(sk("children.size"))}</span>
                      <span>{t("children.stock")}</span>
                      <span className="hidden sm:block">{t("children.sku")}</span>
                    </div>
                    {baseRows.map((s, si) => (
                      <div key={s.size_option_id || si} className="grid grid-cols-[1fr_7rem] items-center gap-2 border-t border-border px-3 py-2 sm:grid-cols-[1fr_8rem_1fr]">
                        <span className="text-sm font-bold text-text">{s.size_option_id ? sizeName(s.size_option_id) : t("children.allUnits")}</span>
                        <input type="number" min={0} step={1} inputMode="numeric" dir="ltr" value={s.stock} aria-label={t("children.stock")}
                          onChange={(e) => patchBase({ sizes: baseRows.map((x, xi) => (xi === si ? { ...x, stock: e.target.value } : x)) })}
                          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm focus:border-action focus:outline-none" />
                        <SkuInput className="col-span-2 sm:col-span-1" value={s.sku}
                          onChange={(sku) => patchBase({ sizes: baseRows.map((x, xi) => (xi === si ? { ...x, sku, skuEdited: true } : x)) })} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Input id="base-price" label={t("children.price")} required type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr"
                  value={base?.price ?? ""} onChange={(e) => patchBase({ price: e.target.value })} />
                {manyBaseSizes ? null : (
                  <Input id="base-stock" label={t("children.stock")} required type="number" min={0} step={1} inputMode="numeric" dir="ltr"
                    value={baseRow.stock}
                    onChange={(e) => patchBase({ sizes: [{ ...baseRow, stock: e.target.value }] })} />
                )}
                {manyBaseSizes ? null : (
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm font-bold text-text">
                    {t("children.sku")}
                    <SkuInput className="h-11" value={baseRow.sku} onChange={(sku) => patchBase({ sizes: [{ ...baseRow, sku, skuEdited: true }] })} />
                  </label>
                )}
                <Input id="base-sale" label={t("children.salePrice")} type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr"
                  value={base?.sale_price ?? ""} onChange={(e) => patchBase({ sale_price: e.target.value })} />
                <div className="hidden lg:block" />
                <Input id="base-from" label={t("children.saleFrom")} type="datetime-local" dir="ltr" disabled={!base?.sale_price.trim()}
                  value={base?.sale_starts_at ?? ""} onChange={(e) => patchBase({ sale_starts_at: e.target.value })} hint={t("children.saleFromHint")} />
                <Input id="base-to" label={t("children.saleTo")} type="datetime-local" dir="ltr" disabled={!base?.sale_price.trim()}
                  value={base?.sale_ends_at ?? ""} onChange={(e) => patchBase({ sale_ends_at: e.target.value })} />
              </div>
            </>
          )}

          {base ? (() => {
            const problems = childProblems(base, childList, hasColor, hasSize, mode);
            return problems.length ? (
              <ul className="flex flex-col gap-1 rounded-md bg-warning-soft px-3 py-2 text-xs font-bold text-warning-strong">
                {problems.map((pr) => <li key={pr}>• {problemText(pr)}</li>)}
              </ul>
            ) : null;
          })() : null}
        </fieldset>
      ) : null}

      {!showBase ? (
      <ul className="flex flex-col gap-3">
        {childList.map((c, index) => {
          const open = openKey === c.key;
          const problems = childProblems(c, childList, hasColor, hasSize, mode);
          const stockTotal = c.sizes.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
          const color = allColors.find((o) => o.id === c.color_option_id);
          const usedColors = new Set(childList.filter((o) => o.key !== c.key && o.color_option_id).map((o) => o.color_option_id));
          // sizes another child of the same colour already uses are not offered again
          const taken = new Set(childList.filter((o) => o.key !== c.key && o.color_option_id === c.color_option_id)
            .flatMap((o) => o.sizes.map((s) => s.size_option_id)));
          const sizeOptions = sizes.map((s) => sizeOptionOf(s, taken.has(s.option_id)));
          return (
            <li key={c.key} className={`overflow-hidden rounded-xl border bg-surface ${problems.length && !open ? "border-warning" : "border-border"}`}>
              {/* summary row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button type="button" onClick={() => setOpenKey(open ? null : c.key)} aria-expanded={open}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-start">
                  <span aria-hidden="true" className="size-8 shrink-0 rounded-full border border-black/10"
                    style={color ? swatchStyle(color) : { background: "var(--color-surface-tint)" }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-text">
                      {t("children.childN", { n: index + 1 })}{c.color_option_id ? ` · ${colorName(c.color_option_id)}` : ""}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {hasSize ? `${c.sizes.filter((s) => s.size_option_id).map((s) => sizeName(s.size_option_id)).join("، ") || t(sk("children.noSizes"))} · ` : ""}
                      {(() => {
                        // phones: the lowest configuration price ("from")
                        const shown = mode.config
                          ? c.sizes.map((x) => Number(x.price)).filter((n) => n > 0).sort((a, b) => a - b)[0]
                          : c.price;
                        return shown ? `${shown} ${t("children.egp")}` : t("children.noPrice");
                      })()} · {t("children.stockN", { count: stockTotal })}
                    </span>
                  </span>
                  {problems.length ? (
                    <span className="hidden shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-bold text-warning-strong sm:inline">{t("children.incomplete")}</span>
                  ) : (
                    <span className="hidden shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-2xs font-bold text-success-strong sm:inline">{t("children.ready")}</span>
                  )}
                  <ChevronDownIcon className={`size-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {editable ? (
                  <>
                    <button type="button" onClick={() => add(c)} aria-label={t("children.duplicate")} title={t("children.duplicate")}
                      className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-tint hover:text-action">
                      <CopyIcon className="size-4" />
                    </button>
                    <button type="button" onClick={() => removeChild(c.key)}
                      aria-label={t("children.remove")} title={t("children.remove")}
                      className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger">
                      <TrashIcon className="size-4" />
                    </button>
                  </>
                ) : null}
              </div>

              {open ? (
                <fieldset disabled={!editable} className="flex flex-col gap-5 border-t border-border bg-surface-tint/20 p-4 sm:p-5">
                  {/* 1–2: colour + sizes */}
                  {hasColor || hasSize ? (
                    <div className="grid items-start gap-4 sm:grid-cols-2">
                      {hasColor ? (
                        <ColorPicker
                          label={`1. ${t("children.color")}`}
                          colors={allColors}
                          value={c.color_option_id}
                          taken={usedColors}
                          isAr={isAr}
                          onChange={(id) => update(c.key, { color_option_id: id })}
                          onCreate={(hex, name, nameEn) => createColor(c.key, hex, name, nameEn)}
                          creating={colorFetcher.state !== "idle"}
                          createError={colorFor.current === c.key ? colorError : null}
                        />
                      ) : null}
                      {hasSize && !mode.config ? (
                        <SelectMenu multiple required label={`${hasColor ? 2 : 1}. ${t(sk("children.sizes"))}`} options={sizeOptions}
                          value={c.sizes.map((s) => s.size_option_id).filter(Boolean)} placeholder={t(sk("children.noSizes"))}
                          hint={sizes.length === 0 ? t("children.noSizeTypes") : undefined}
                          onChange={(ids) => {
                            const picked = ids.filter(Boolean);
                            // no size picked → one plain stock row (keeps its stock)
                            update(c.key, {
                              sizes: picked.length
                                ? picked.map((id) => c.sizes.find((s) => s.size_option_id === id) ?? { size_option_id: id, stock: "0", sku: null })
                                : [c.sizes.find((s) => !s.size_option_id) ?? { size_option_id: "", stock: c.sizes.length === 1 ? c.sizes[0]!.stock : "0", sku: null }],
                            });
                          }} />
                      ) : null}
                    </div>
                  ) : null}

                  {mode.config ? (
                    <ConfigRows
                      rows={c.sizes}
                      sizes={sizes}
                      ramOptions={ramOptions}
                      hasRam={mode.hasRam}
                      isAr={isAr}
                      onChange={(rows) => update(c.key, { sizes: rows })}
                    />
                  ) : null}
                  {mode.config && c.sizes.some((x) => x.sale_price?.trim()) ? (
                    /* the sale window applies to every row that has a sale price */
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input id={`ch-from-${c.key}`} label={t("children.saleFrom")} type="datetime-local" dir="ltr"
                        value={c.sale_starts_at} onChange={(e) => update(c.key, { sale_starts_at: e.target.value })} hint={t("children.saleFromHint")} />
                      <Input id={`ch-to-${c.key}`} label={t("children.saleTo")} type="datetime-local" dir="ltr"
                        value={c.sale_ends_at} onChange={(e) => update(c.key, { sale_ends_at: e.target.value })} />
                    </div>
                  ) : null}
                  {!mode.config ? (
                  <>
                  {/* 3: stock per size (+ SKU) */}
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-bold text-text">{t(sk("children.stockTitle"))}<span className="ms-0.5 text-danger">*</span></p>
                    {c.sizes.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-text-muted">{t(sk("children.pickSizesFirst"))}</p>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-border bg-surface">
                        <div className="grid grid-cols-[1fr_7rem] gap-2 bg-surface-tint/50 px-3 py-2 text-2xs font-bold text-text-muted sm:grid-cols-[1fr_8rem_1fr]">
                          <span>{c.sizes.some((s) => s.size_option_id) ? t(sk("children.size")) : t("children.item")}</span>
                          <span>{t("children.stock")}</span>
                          <span className="hidden sm:block">{t("children.sku")}</span>
                        </div>
                        {c.sizes.map((s, si) => (
                          <div key={s.size_option_id || "plain"} className="grid grid-cols-[1fr_7rem] items-center gap-2 border-t border-border px-3 py-2 sm:grid-cols-[1fr_8rem_1fr]">
                            <span className="text-sm font-bold text-text">{s.size_option_id ? sizeName(s.size_option_id) : t("children.allUnits")}</span>
                            <input type="number" min={0} step={1} inputMode="numeric" dir="ltr" value={s.stock} aria-label={t("children.stock")}
                              onChange={(e) => update(c.key, { sizes: c.sizes.map((x, xi) => (xi === si ? { ...x, stock: e.target.value } : x)) })}
                              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm focus:border-action focus:outline-none" />
                            <SkuInput className="col-span-2 sm:col-span-1" value={s.sku}
                              onChange={(sku) => update(c.key, { sizes: c.sizes.map((x, xi) => (xi === si ? { ...x, sku, skuEdited: true } : x)) })} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 4–6: price, discount, window */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Input id={`ch-price-${c.key}`} label={t("children.price")} required type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr"
                      value={c.price} onChange={(e) => update(c.key, { price: e.target.value })} />
                    <Input id={`ch-sale-${c.key}`} label={t("children.salePrice")} type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr"
                      value={c.sale_price} onChange={(e) => update(c.key, { sale_price: e.target.value })} />
                    <Input id={`ch-from-${c.key}`} label={t("children.saleFrom")} type="datetime-local" dir="ltr" disabled={!c.sale_price.trim()}
                      value={c.sale_starts_at} onChange={(e) => update(c.key, { sale_starts_at: e.target.value })} hint={t("children.saleFromHint")} />
                    <Input id={`ch-to-${c.key}`} label={t("children.saleTo")} type="datetime-local" dir="ltr" disabled={!c.sale_price.trim()}
                      value={c.sale_ends_at} onChange={(e) => update(c.key, { sale_ends_at: e.target.value })} />
                  </div>
                  </>
                  ) : null}

                  {/* 8: images of this child */}
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-bold text-text">{t("children.images")}</p>
                    <div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 sm:grid-cols-6 lg:grid-cols-8">
                      {c.images.map((path, ii) => (
                        <div key={`${path}-${ii}`} className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-tint">
                          <MediaImage path={path} alt="" width={160} height={160} supabaseUrl={supabaseUrl} className="size-full object-cover" />
                          {editable ? (
                            <button type="button" aria-label={t("common.remove")} onClick={() => update(c.key, { images: c.images.filter((_, j) => j !== ii) })}
                              className="absolute end-1 top-1 flex size-7 cursor-pointer items-center justify-center rounded-full bg-danger text-sm font-black text-white shadow-1">×</button>
                          ) : null}
                        </div>
                      ))}
                      {editable ? (
                        <button type="button" onClick={() => setPickerFor(c.key)}
                          className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong bg-surface p-1 text-center text-text-muted hover:border-action hover:text-action">
                          <PlusIcon className="size-5" /><span className="text-2xs font-bold">{t("media.picker.choose")}</span>
                        </button>
                      ) : null}
                    </div>
                    <p className="text-2xs text-text-faint">{t("children.imagesHint")}</p>
                  </div>

                  {problems.length ? (
                    <ul className="flex flex-col gap-1 rounded-md bg-warning-soft px-3 py-2 text-xs font-bold text-warning-strong">
                      {problems.map((p) => <li key={p}>• {problemText(p)}</li>)}
                    </ul>
                  ) : null}
                </fieldset>
              ) : null}
            </li>
          );
        })}
      </ul>
      ) : null}

      {editable && canAddVariant ? (
        <button type="button" onClick={() => (showBase ? startVariants() : add())}
          className="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed border-border py-2 text-sm font-extrabold text-action hover:border-action">
          <span className="flex items-center gap-2"><PlusIcon className="size-4" />{t("children.add")}</span>
          {showBase ? <span className="text-2xs font-bold text-text-muted">{t("children.addHint")}</span> : null}
        </button>
      ) : null}

      <MediaPickerDialog
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title={t("children.images")}
        settings={media}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="multi"
        kinds={["image"]}
        onConfirm={(files) => {
          const target = childList.find((c) => c.key === pickerFor);
          if (target) update(target.key, { images: [...target.images, ...files.map((f) => f.path)].slice(0, 12) });
          setPickerFor(null);
        }}
      />
    </div>
  );
}

/**
 * Phones / computers: one row per configuration — storage, RAM, its own price
 * and sale price, stock. On phones every row is a small card (two columns).
 */
function ConfigRows({ rows, sizes, ramOptions, hasRam, isAr, onChange, allowAdd = true }: {
  rows: ChildSize[];
  sizes: SizeOption[];
  ramOptions: TemplateOption[];
  hasRam: boolean;
  isAr: boolean;
  allowAdd?: boolean;
  onChange: (rows: ChildSize[]) => void;
}) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<ChildSize>) => onChange(rows.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));
  const storageOpts = sizes.map((o) => ({ value: o.option_id, label: isAr ? o.label_ar || o.label_en : o.label_en || o.label_ar }));
  const ramOpts = ramOptions.map((o) => ({ value: o.id, label: isAr ? o.label_ar || o.label_en : o.label_en || o.label_ar }));
  const field = "w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-action focus:outline-none";
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-bold text-text">{t("children.configTitle")}<span className="ms-0.5 text-danger">*</span></p>
        <p className="text-xs text-text-muted">{t(hasRam ? "children.configHint" : "children.configHintNoRam")}</p>
      </div>
      {rows.map((row, i) => (
        <div key={i} className={`grid grid-cols-2 items-end gap-2.5 rounded-lg border border-border bg-surface p-3 ${hasRam ? "lg:grid-cols-[1fr_1fr_1fr_1fr_6rem_auto]" : "lg:grid-cols-[1.4fr_1fr_1fr_6rem_auto]"}`}>
          <SelectMenu label={t("children.size_storage")} required options={storageOpts} value={row.size_option_id || null}
            placeholder={t("children.pick")} onChange={(v) => set(i, { size_option_id: v ?? "" })} />
          {hasRam ? (
            <SelectMenu label={t("children.ram")} required options={ramOpts} value={row.ram_option_id || null}
              placeholder={t("children.pick")} onChange={(v) => set(i, { ram_option_id: v ?? "" })} />
          ) : null}
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            <span>{t("children.price")}<span className="ms-0.5 text-danger">*</span></span>
            <input type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr" className={field}
              value={row.price ?? ""} onChange={(e) => set(i, { price: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("children.salePrice")}
            <input type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr" className={field}
              value={row.sale_price ?? ""} onChange={(e) => set(i, { sale_price: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            <span>{t("children.stock")}<span className="ms-0.5 text-danger">*</span></span>
            <input type="number" min={0} step={1} inputMode="numeric" dir="ltr" className={field}
              value={row.stock} onChange={(e) => set(i, { stock: e.target.value })} />
          </label>
          <div className="flex items-center justify-between gap-2 lg:justify-end">
            <SkuInput className="max-w-48" value={row.sku} onChange={(sku) => set(i, { sku, skuEdited: true })} />
            {rows.length > 1 ? (
              <button type="button" onClick={() => onChange(rows.filter((_, xi) => xi !== i))}
                aria-label={t("children.removeRow")} title={t("children.removeRow")}
                className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger">
                <TrashIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {allowAdd ? (
        <button type="button" onClick={() => onChange([...rows, nextConfigRow(rows)])}
          className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-sm font-extrabold text-action hover:border-action">
          <PlusIcon className="size-4" />{t("children.addConfig")}
        </button>
      ) : null}
    </div>
  );
}

/** SKU of one stock row: generated on save, the seller may type their own (empty = generated again). */
function SkuInput({ value, onChange, className = "" }: { value: string | null; onChange: (sku: string) => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <input type="text" dir="ltr" maxLength={40} autoCapitalize="characters" spellCheck={false} value={value ?? ""}
      placeholder={t("children.skuAuto")} aria-label={t("children.sku")}
      onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9._-]/g, ""))}
      className={`num w-full min-w-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm placeholder:text-text-faint focus:border-action focus:outline-none ${className}`} />
  );
}
