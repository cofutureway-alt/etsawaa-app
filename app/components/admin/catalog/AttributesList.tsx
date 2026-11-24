/**
 * Attribute list for the selected leaf: one row per attribute with its type /
 * behaviour badges, option chips (enum/color) and the link button. Extracted
 * from the route `app/routes/admin/catalog/attributes.tsx` — the route owns
 * all dialog state and passes open/delete callbacks in.
 */
import { useTranslation } from "react-i18next";
import { CheckIcon, PencilIcon, TrashIcon } from "~/components/ui/icons";
import type { DefRow, LinkRow, OptionRow } from "./attributes.shared";

const TYPE_LABELS: Record<DefRow["type"], string> = {
  text: "catalog.typeText", number: "catalog.typeNumber", bool: "catalog.typeBool",
  enum: "catalog.typeEnum", color: "catalog.typeColor",
};

export function AttributesList({
  defs, optionsFor, links, selectedId, onEditDef, onDeleteDef, onEditOption, onDeleteOption, onAddOption, onLink, onToggleScope, onResetScope, onToggleRequired, busy,
}: {
  /** Attributes visible for this leaf (owned + linked), already sorted. */
  defs: DefRow[];
  optionsFor: (defId: string) => OptionRow[];
  links: LinkRow[];
  selectedId: string;
  onEditDef: (def: DefRow) => void;
  onDeleteDef: (def: DefRow) => void;
  onEditOption: (attributeId: string, option: OptionRow) => void;
  onDeleteOption: (option: OptionRow) => void;
  onAddOption: (attributeId: string) => void;
  onLink: (def: DefRow) => void;
  /** offer / stop offering one option in THIS category (linked attributes only) */
  onToggleScope: (def: DefRow, option: OptionRow) => void;
  onResetScope: (def: DefRow) => void;
  /** required / optional in THIS category (linked attributes only) */
  onToggleRequired: (def: DefRow, required: boolean) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  // the link row of an attribute in this category (null for an owned attribute)
  const linkOf = (d: DefRow) => links.find((l) => l.attribute_id === d.id && l.category_id === selectedId) ?? null;
  return (
    <ul className="flex flex-col gap-2">
      {defs.map((d) => (
        <li key={d.id} className="rounded-md border border-border bg-surface px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-text">
              {d.label_ar || d.code}
              <span className="ms-2 font-mono text-2xs font-normal text-text-faint" dir="ltr">{d.code}</span>
              {d.unit ? <span className="font-normal text-text-muted"> ({d.unit})</span> : null}
            </span>
            <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t(TYPE_LABELS[d.type])}</span>
            {d.is_required ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.required")}</span> : (() => {
              const link = linkOf(d);
              if (!link) return null;
              return (
                <button type="button" role="switch" aria-checked={link.is_required} disabled={busy} title={t("catalog.requiredHint")}
                  onClick={() => onToggleRequired(d, !link.is_required)}
                  className={`cursor-pointer rounded-full border px-2 py-0.5 text-2xs font-bold disabled:opacity-50 ${link.is_required ? "border-danger/40 bg-danger/10 text-danger" : "border-dashed border-border text-text-faint hover:text-text"}`}>
                  {link.is_required ? t("catalog.requiredHere") : t("catalog.optionalHere")}
                </button>
              );
            })()}
            {d.is_filterable ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.filterable")}</span> : null}
            {d.is_variant_axis ? <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{t("catalog.axis")}</span> : null}
            {d.is_multi ? <span className="rounded-full bg-action/10 px-2 py-0.5 text-2xs font-bold text-action">{t("catalog.multi")}</span> : null}
            <button type="button" aria-label={t("common.edit")} onClick={() => onEditDef(d)} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-4" /></button>
            <button type="button" aria-label={t("common.delete")} onClick={() => onDeleteDef(d)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-4" /></button>
          </div>
          {(d.type === "enum" || d.type === "color") ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(() => {
                const link = linkOf(d);
                if (!link) return null;
                const total = optionsFor(d.id).length;
                const offered = link.allowed_option_ids ? optionsFor(d.id).filter((o) => link.allowed_option_ids?.includes(o.id)).length : total;
                return (
                  <p className="flex w-full flex-wrap items-center gap-2 text-2xs text-text-muted">
                    {t("catalog.scopeHint", { offered, total })}
                    {link.allowed_option_ids ? (
                      <button type="button" disabled={busy} onClick={() => onResetScope(d)} className="cursor-pointer font-bold text-action hover:underline disabled:opacity-50">
                        {t("catalog.scopeReset")}
                      </button>
                    ) : null}
                  </p>
                );
              })()}
              {optionsFor(d.id).map((o) => {
                const link = linkOf(d);
                const on = !link?.allowed_option_ids || link.allowed_option_ids.includes(o.id);
                return (
                <span key={o.id} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${on ? "border-border text-text" : "border-dashed border-border text-text-faint line-through"}`}>
                  {link ? (
                    <button type="button" disabled={busy} role="switch" aria-checked={on}
                      aria-label={on ? t("catalog.scopeHide", { name: o.label_ar }) : t("catalog.scopeShow", { name: o.label_ar })}
                      onClick={() => onToggleScope(d, o)}
                      className={`flex size-4 cursor-pointer items-center justify-center rounded border disabled:opacity-50 ${on ? "border-action bg-action text-on-action" : "border-border-strong"}`}>
                      {on ? <CheckIcon className="size-3" /> : null}
                    </button>
                  ) : null}
                  {o.color_hex ? <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: o.color_hex }} aria-hidden="true" /> : null}
                  {o.label_ar}
                  <button type="button" aria-label={t("common.edit")} onClick={() => onEditOption(d.id, o)} className="cursor-pointer text-text-muted hover:text-action"><PencilIcon className="size-3" /></button>
                  <button type="button" aria-label={t("common.delete")} onClick={() => onDeleteOption(o)} className="cursor-pointer text-text-muted hover:text-danger"><TrashIcon className="size-3" /></button>
                </span>
                );
              })}
              <button type="button" onClick={() => onAddOption(d.id)} className="cursor-pointer rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-bold text-text-muted hover:text-action">
                {t("catalog.addOption")}
              </button>
              <button type="button" onClick={() => onLink(d)} className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-xs font-bold text-action hover:bg-surface-tint">
                {t("catalog.linkTo", { count: links.filter((l) => l.attribute_id === d.id && l.category_id !== selectedId).length })}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => onLink(d)} className="mt-2 cursor-pointer rounded-full border border-border px-2.5 py-1 text-xs font-bold text-action hover:bg-surface-tint">
              {t("catalog.linkTo", { count: links.filter((l) => l.attribute_id === d.id && l.category_id !== selectedId).length })}
            </button>
          )}
        </li>
      ))}
      {defs.length === 0 ? <li className="rounded-lg border border-dashed border-border bg-surface py-10 text-center text-sm text-text-muted">{t("catalog.noAttributes")}</li> : null}
    </ul>
  );
}
