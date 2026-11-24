import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui";
import { GarmentDiagram, MeasureHowTo } from "~/components/catalog/SizeGuide";
import { GARMENTS, MEASURES, defaultChart, standardRow, type Garment, type SizeChart } from "~/features/products/size-chart";

/**
 * Size chart card (apparel / shoes): starts from the standard table for the
 * garment and the sizes picked for the child products; every cell stays
 * editable. Shown to shoppers as the product page "Size guide".
 */
export function SizeChartEditor({ chart, onChange, suggested, sizes, isAr, editable }: {
  chart: SizeChart | null;
  onChange: (next: SizeChart | null) => void;
  /** garment guessed from the category (null = not apparel) */
  suggested: Garment | null;
  /** size labels used by the child products, in order */
  sizes: string[];
  isAr: boolean;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const garment = chart?.garment ?? suggested ?? "top";
  const keys = MEASURES[garment];

  if (!chart) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong bg-surface-tint/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-text">{t("sizeChart.editorTitle")}</h3>
            <p className="text-xs text-text-muted">{t("sizeChart.editorOff")}</p>
          </div>
          {editable ? <Button type="button" variant="outline" onClick={() => onChange(defaultChart(garment, sizes))}>{t("sizeChart.attach")}</Button> : null}
        </div>
      </section>
    );
  }

  const setCell = (row: number, key: string, value: string) =>
    onChange({ ...chart, rows: chart.rows.map((r, i) => (i === row ? { ...r, values: { ...r.values, [key]: value } } : r)) });
  const setSize = (row: number, value: string) =>
    onChange({ ...chart, rows: chart.rows.map((r, i) => (i === row ? { ...r, size: value } : r)) });

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-text">{t("sizeChart.editorTitle")}</h3>
          <p className="text-xs text-text-muted">{t("sizeChart.editorHint")}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs font-bold text-text">
              {t("sizeChart.garment")}
              <select value={garment} onChange={(e) => onChange(defaultChart(e.target.value as Garment, chart.rows.map((r) => r.size)))}
                className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
                {GARMENTS.map((g) => <option key={g} value={g}>{t(`sizeChart.g.${g}`)}</option>)}
              </select>
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(defaultChart(garment, sizes.length ? sizes : chart.rows.map((r) => r.size)))}>
              {t("sizeChart.reset")}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => onChange(null)}>{t("sizeChart.remove")}</Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-tint p-3">
          <GarmentDiagram garment={garment} className="h-40 w-40" />
          <MeasureHowTo garment={garment} />
        </div>
        <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-tint text-xs font-extrabold text-text">
              <tr>
                <th scope="col" className="px-2 py-2 text-start">{t("sizeChart.size")}</th>
                {keys.map((k, i) => (
                  <th key={k} scope="col" className="px-2 py-2 text-start">
                    {["weight", "age"].includes(k) ? null : <span className="num me-1 inline-flex size-4 items-center justify-center rounded-full bg-action text-2xs text-on-action">{i + 1}</span>}
                    {t(`sizeChart.m.${k}`)} <span className="font-normal text-text-faint">{t(`sizeChart.u.${k}`)}</span>
                  </th>
                ))}
                {editable ? <th scope="col" className="w-8"><span className="sr-only">{t("common.delete")}</span></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {chart.rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-1.5 py-1">
                    <input value={r.size} disabled={!editable} onChange={(e) => setSize(i, e.target.value)} aria-label={t("sizeChart.size")}
                      className="num h-9 w-16 rounded border border-border bg-surface px-2 text-sm font-black" dir="ltr" />
                  </td>
                  {keys.map((k) => (
                    <td key={k} className="px-1.5 py-1">
                      <input value={r.values[k] ?? ""} disabled={!editable} onChange={(e) => setCell(i, k, e.target.value)} inputMode="decimal"
                        aria-label={`${r.size} ${t(`sizeChart.m.${k}`)}`} placeholder="—"
                        className="num h-9 w-[4.5rem] rounded border border-border bg-surface px-2 text-sm" dir="ltr" />
                    </td>
                  ))}
                  {editable ? (
                    <td className="px-1">
                      <button type="button" onClick={() => onChange({ ...chart, rows: chart.rows.filter((_, j) => j !== i) })}
                        aria-label={t("common.delete")} className="flex size-8 cursor-pointer items-center justify-center rounded text-danger hover:bg-danger-soft">×</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editable ? (
        <div className="flex flex-wrap items-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...chart, rows: [...chart.rows, standardRow(garment, "")] })}>
            + {t("sizeChart.addRow")}
          </Button>
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs font-bold text-text">
            {isAr ? t("sizeChart.noteAr") : t("sizeChart.noteEn")}
            <input value={(isAr ? chart.note_ar : chart.note_en) ?? ""} maxLength={300}
              onChange={(e) => onChange({ ...chart, ...(isAr ? { note_ar: e.target.value } : { note_en: e.target.value }) })}
              placeholder={t("sizeChart.notePlaceholder")} className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm font-normal" />
          </label>
        </div>
      ) : null}
    </section>
  );
}
