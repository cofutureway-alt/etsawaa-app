import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "~/components/ui";
import type { PickerCategory } from "./types";

/**
 * Cascading category picker (V-11): root → sub → category → product type.
 * One select per level, down to whichever node has no children — any
 * childless node IS a valid leaf, so a 2- or 3-level branch completes early
 * and the Phase 09 catalog (level 4 = product type) needs no special case.
 */

const LEVEL_LABELS = [
  "productWizard.classification.level1",
  "productWizard.classification.level2",
  "productWizard.classification.level3",
  "productWizard.classification.level4",
] as const;

export interface CategoryPickerProps {
  categories: PickerCategory[];
  value: string;
  isAr: boolean;
  onChange: (leafId: string) => void;
}

export function CategoryPicker({
  categories,
  value,
  isAr,
  onChange,
}: CategoryPickerProps) {
  const { t } = useTranslation();
  /** selected id per level (root first); the last one may be the leaf */
  const [path, setPath] = useState<string[]>([]);

  const { byId, childrenOf } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const kids = new Map<string | null, PickerCategory[]>();
    for (const c of categories) {
      const list = kids.get(c.parent_id) ?? [];
      list.push(c);
      kids.set(c.parent_id, list);
    }
    return { byId, childrenOf: (id: string | null) => kids.get(id) ?? [] };
  }, [categories]);

  // keep the selects in sync with an existing value (ancestor walk)
  useEffect(() => {
    if (!value) return;
    const chain: string[] = [];
    for (let node = byId.get(value); node; node = node.parent_id ? byId.get(node.parent_id) : undefined) {
      chain.unshift(node.id);
    }
    if (chain.length > 0) setPath(chain);
  }, [value, byId]);

  // a select for each level whose parent is chosen and has children
  const levels: Array<{ parentId: string | null; options: PickerCategory[] }> = [{ parentId: null, options: childrenOf(null) }];
  for (const id of path) {
    const kids = childrenOf(id);
    if (kids.length === 0) break;
    levels.push({ parentId: id, options: kids });
  }

  const pick = (level: number, id: string) => {
    const next = id ? [...path.slice(0, level), id] : path.slice(0, level);
    setPath(next);
    // only a childless node completes the selection — the wizard then loads
    // that type's template, sizes and brands
    onChange(id && childrenOf(id).length === 0 ? id : "");
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-bold text-text">{t("productWizard.classification.category")}<span aria-hidden="true" className="ms-0.5 text-danger">*</span></p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {levels.map((lvl, i) => (
          <Select
            key={`${i}-${lvl.parentId ?? "root"}`}
            id={`cat_level_${i + 1}`}
            label={t(LEVEL_LABELS[Math.min(i, LEVEL_LABELS.length - 1)] ?? LEVEL_LABELS[0])}
            value={path[i] ?? ""}
            onChange={(e) => pick(i, e.target.value)}
            options={[
              { value: "", label: t("common.choose") },
              ...lvl.options.map((c) => ({ value: c.id, label: isAr ? c.name_ar : c.name_en })),
            ]}
          />
        ))}
      </div>
    </div>
  );
}
