/**
 * Collapsible storefront-template preview (US-10): renders every visible
 * attribute the way the product form will show it, using disabled inputs.
 * Extracted from the route `app/routes/admin/catalog/attributes.tsx`.
 */
import { unitLabel } from "~/lib/units";
import { useTranslation } from "react-i18next";
import type { DefRow, OptionRow } from "./attributes.shared";

export function TemplatePreview({ defs, optionsFor }: {
  defs: DefRow[];
  optionsFor: (defId: string) => OptionRow[];
}) {
  const { t } = useTranslation();
  return (
    <details className="rounded-lg border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-extrabold text-text">{t("catalog.preview")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {defs.map((d) => (
          <div key={d.id} className="flex flex-col gap-1">
            <label className="text-sm font-bold text-text">
              {d.label_ar || d.code}{unitLabel(d.unit, "ar") ? ` (${unitLabel(d.unit, "ar")})` : ""}
              {d.is_required ? <span className="text-danger" aria-hidden="true"> *</span> : null}
            </label>
            <TemplateField def={d} options={optionsFor(d.id)} />
          </div>
        ))}
        {defs.length === 0 ? <p className="text-sm text-text-muted sm:col-span-2">{t("catalog.noAttributes")}</p> : null}
      </div>
    </details>
  );
}

/** Disabled stand-in for one attribute, as the product form renders it. */
function TemplateField({ def, options }: { def: DefRow; options: OptionRow[] }) {
  const base = "rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-action focus:outline-none";
  if (def.type === "enum") {
    return <select className={base} disabled><option value="">{options.map((o) => o.label_ar).join(" · ") || "—"}</option></select>;
  }
  if (def.type === "color") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <span key={o.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-text">
            <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: o.color_hex ?? "#ffffff" }} aria-hidden="true" />
            {o.label_ar}
          </span>
        ))}
        {options.length === 0 ? <span className="text-xs text-text-faint">—</span> : null}
      </div>
    );
  }
  if (def.type === "bool") return <input type="checkbox" disabled className="size-4 accent-[var(--color-action)]" />;
  if (def.type === "number") return <input type="number" disabled className={base} />;
  return <input type="text" disabled className={base} />;
}
