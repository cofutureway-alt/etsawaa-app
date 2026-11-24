import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "~/components/ui/Overlay";
import { MEASURES, type Garment, type SizeChart } from "~/features/products/size-chart";

/**
 * Size guide: the garment diagram with numbered measuring lines, how to
 * measure each one, and the size table (cm / kg). Used read-only on the
 * product page and as the live preview inside the wizard editor.
 */

const STROKE = "var(--color-text-muted)";
const MARK = "var(--color-action)";

function Marker({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={9} fill={MARK} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{n}</text>
    </g>
  );
}
function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={MARK} strokeWidth={2} strokeDasharray="5 3" markerStart="url(#sg-a)" markerEnd="url(#sg-a)" />;
}

/** Outline + numbered lines; numbers follow MEASURES order (weight / age has no line). */
export function GarmentDiagram({ garment, className = "" }: { garment: Garment; className?: string }) {
  const keys = MEASURES[garment];
  const num = (k: string) => keys.indexOf(k) + 1;
  return (
    <svg viewBox="0 0 220 220" className={className} role="img" aria-hidden="true" direction="ltr">
      <defs>
        <marker id="sg-a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={MARK} />
        </marker>
      </defs>
      {garment === "top" || garment === "outerwear" ? (
        <>
          <path d="M70 30 L95 22 Q110 34 125 22 L150 30 L195 62 L178 92 L155 78 L155 200 L65 200 L65 78 L42 92 L25 62 Z" fill="var(--color-surface-tint)" stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
          {garment === "outerwear" ? <line x1={110} y1={30} x2={110} y2={200} stroke={STROKE} strokeWidth={1.5} strokeDasharray="3 3" /> : null}
          <Arrow x1={67} y1={92} x2={153} y2={92} /><Marker n={num("chest")} x={110} y={104} />
          <Arrow x1={168} y1={26} x2={168} y2={200} /><Marker n={num("length")} x={182} y={150} />
          <Arrow x1={72} y1={40} x2={148} y2={40} /><Marker n={num("shoulder")} x={110} y={52} />
          <Arrow x1={153} y1={34} x2={188} y2={64} /><Marker n={num("sleeve")} x={190} y={40} />
        </>
      ) : garment === "bottom" ? (
        <>
          <path d="M60 20 L160 20 L170 205 L122 205 L110 85 L98 205 L50 205 Z" fill="var(--color-surface-tint)" stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
          <Arrow x1={60} y1={30} x2={160} y2={30} /><Marker n={num("waist")} x={110} y={44} />
          <Arrow x1={56} y1={62} x2={164} y2={62} /><Marker n={num("hip")} x={136} y={74} />
          <Arrow x1={40} y1={20} x2={40} y2={205} /><Marker n={num("length")} x={26} y={110} />
          <Arrow x1={116} y1={90} x2={124} y2={205} /><Marker n={num("inseam")} x={140} y={150} />
        </>
      ) : garment === "dress" ? (
        <>
          <path d="M85 18 L100 30 Q110 36 120 30 L135 18 L145 60 L136 88 L172 205 L48 205 L84 88 L75 60 Z" fill="var(--color-surface-tint)" stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
          <Arrow x1={78} y1={62} x2={142} y2={62} /><Marker n={num("bust")} x={110} y={74} />
          <Arrow x1={86} y1={90} x2={134} y2={90} /><Marker n={num("waist")} x={110} y={102} />
          <Arrow x1={74} y1={128} x2={146} y2={128} /><Marker n={num("hip")} x={110} y={140} />
          <Arrow x1={182} y1={18} x2={182} y2={205} /><Marker n={num("length")} x={196} y={110} />
        </>
      ) : garment === "shoes" ? (
        <>
          <path d="M70 200 Q48 190 52 150 Q56 110 62 70 Q70 20 108 18 Q146 20 150 70 Q156 120 152 160 Q148 200 120 205 Q95 208 70 200 Z" fill="var(--color-surface-tint)" stroke={STROKE} strokeWidth={2} />
          <line x1={30} y1={18} x2={190} y2={18} stroke={STROKE} strokeWidth={1} />
          <line x1={30} y1={206} x2={190} y2={206} stroke={STROKE} strokeWidth={1} />
          <Arrow x1={172} y1={18} x2={172} y2={206} /><Marker n={num("foot_length")} x={190} y={112} />
        </>
      ) : (
        <>
          <circle cx={110} cy={38} r={18} fill="var(--color-surface-tint)" stroke={STROKE} strokeWidth={2} />
          <path d="M80 62 L140 62 L160 110 L146 116 L136 92 L136 140 L132 205 L116 205 L110 150 L104 205 L88 205 L84 140 L84 92 L74 116 L60 110 Z" fill="var(--color-surface-tint)" stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
          <Arrow x1={186} y1={20} x2={186} y2={205} /><Marker n={num("height")} x={200} y={112} />
          <Arrow x1={84} y1={84} x2={136} y2={84} /><Marker n={num("chest")} x={110} y={96} />
          <Arrow x1={84} y1={128} x2={136} y2={128} /><Marker n={num("waist")} x={110} y={140} />
        </>
      )}
    </svg>
  );
}

export function SizeChartTable({ chart, lang }: { chart: SizeChart; lang: "ar" | "en" }) {
  const { t } = useTranslation();
  const keys = MEASURES[chart.garment];
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[420px] text-center text-sm">
        <thead className="bg-surface-tint text-xs font-extrabold text-text">
          <tr>
            <th scope="col" className="px-2.5 py-2">{t("sizeChart.size")}</th>
            {keys.map((k, i) => (
              <th key={k} scope="col" className="px-2.5 py-2">
                {["weight", "age"].includes(k) ? null : <span className="num me-1 inline-flex size-4 items-center justify-center rounded-full bg-action text-2xs text-on-action">{i + 1}</span>}
                {t(`sizeChart.m.${k}`)} <span className="font-normal text-text-faint">{t(`sizeChart.u.${k}`)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {chart.rows.map((r) => (
            <tr key={r.size} className="odd:bg-surface even:bg-surface-alt">
              <th scope="row" className="num px-2.5 py-2 font-black text-text">{r.size}</th>
              {keys.map((k) => <td key={k} className="num px-2.5 py-2 text-text" dir="ltr">{r.values[k] || "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {(lang === "ar" ? chart.note_ar : chart.note_en) ? (
        <p className="border-t border-border px-3 py-2 text-xs text-text-muted">{lang === "ar" ? chart.note_ar : chart.note_en}</p>
      ) : null}
    </div>
  );
}

/** How to measure: one line per numbered marker. */
export function MeasureHowTo({ garment }: { garment: Garment }) {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-col gap-1.5 text-xs text-text-muted">
      {MEASURES[garment].map((k, i) => ["weight", "age", "eu", "uk", "us"].includes(k) ? null : (
        <li key={k} className="flex gap-2">
          <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-action text-2xs font-black text-on-action">{i + 1}</span>
          <span><b className="text-text">{t(`sizeChart.m.${k}`)}:</b> {t(`sizeChart.how.${k}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Product page trigger + dialog. */
export function SizeGuideButton({ chart, lang }: { chart: SizeChart; lang: "ar" | "en" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-extrabold text-action transition-colors hover:border-action hover:bg-surface-tint">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 7h18v10H3zM7 7v4M11 7v6M15 7v4M19 7v6" /></svg>
        {t("sizeChart.open")}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("sizeChart.title")} size="lg">
        <div className="flex flex-col gap-4">
          <div className="grid items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <GarmentDiagram garment={chart.garment} className="mx-auto h-44 w-44" />
            <MeasureHowTo garment={chart.garment} />
          </div>
          <SizeChartTable chart={chart} lang={lang} />
          <p className="text-2xs text-text-faint">{t("sizeChart.disclaimer")}</p>
        </div>
      </Dialog>
    </>
  );
}
