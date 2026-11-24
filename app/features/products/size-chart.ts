/**
 * Standard apparel size charts (products.size_chart jsonb). A chart is a
 * garment type + one row per size with body / garment measurements in cm and
 * an indicative weight range. The wizard pre-fills it from the standard table
 * for the garment and the sizes the seller picked; the seller can edit any
 * cell. Pure — shared by the wizard editor and the storefront size guide.
 */

export const GARMENTS = ["top", "outerwear", "bottom", "dress", "shoes", "kids"] as const;
export type Garment = (typeof GARMENTS)[number];

/** measurement keys per garment, in display order (number = diagram marker) */
export const MEASURES: Record<Garment, readonly string[]> = {
  top: ["weight", "chest", "length", "shoulder", "sleeve"],
  outerwear: ["weight", "chest", "length", "shoulder", "sleeve"],
  bottom: ["weight", "waist", "hip", "length", "inseam"],
  dress: ["weight", "bust", "waist", "hip", "length"],
  shoes: ["foot_length", "eu", "uk", "us"],
  kids: ["age", "height", "chest", "waist"],
};

export interface SizeChartRow { size: string; values: Record<string, string> }
export interface SizeChart {
  garment: Garment;
  rows: SizeChartRow[];
  note_ar?: string;
  note_en?: string;
}

const ADULT = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
const STD: Record<Exclude<Garment, "shoes" | "kids">, Record<string, number[]>> = {
  //            weight lo-hi, then the garment's measures (ranges as lo-hi pairs or single cm)
  top: {
    XS: [45, 52, 86, 91, 66, 41, 60], S: [53, 60, 91, 96, 68, 43, 61], M: [61, 70, 96, 101, 70, 45, 62],
    L: [71, 80, 101, 106, 72, 47, 63], XL: [81, 90, 106, 111, 74, 49, 64], XXL: [91, 100, 111, 116, 76, 51, 65],
    XXXL: [101, 110, 116, 121, 78, 53, 66], "4XL": [111, 120, 121, 126, 80, 55, 67], "5XL": [121, 130, 126, 131, 82, 57, 67],
  },
  outerwear: {
    XS: [45, 52, 90, 95, 68, 42, 61], S: [53, 60, 95, 100, 70, 44, 62], M: [61, 70, 100, 105, 72, 46, 63],
    L: [71, 80, 105, 110, 74, 48, 64], XL: [81, 90, 110, 115, 76, 50, 65], XXL: [91, 100, 115, 120, 78, 52, 66],
    XXXL: [101, 110, 120, 125, 80, 54, 67], "4XL": [111, 120, 125, 130, 82, 56, 68], "5XL": [121, 130, 130, 135, 84, 58, 68],
  },
  bottom: {
    XS: [45, 52, 66, 71, 86, 91, 98, 76], S: [53, 60, 71, 76, 91, 96, 100, 77], M: [61, 70, 76, 81, 96, 101, 102, 78],
    L: [71, 80, 81, 86, 101, 106, 104, 79], XL: [81, 90, 86, 91, 106, 111, 106, 80], XXL: [91, 100, 91, 96, 111, 116, 107, 81],
    XXXL: [101, 110, 96, 101, 116, 121, 108, 81], "4XL": [111, 120, 101, 106, 121, 126, 109, 82], "5XL": [121, 130, 106, 111, 126, 131, 110, 82],
  },
  dress: {
    XS: [42, 48, 80, 84, 62, 66, 86, 90, 95], S: [49, 55, 84, 88, 66, 70, 90, 94, 96], M: [56, 63, 88, 92, 70, 74, 94, 98, 97],
    L: [64, 72, 92, 98, 74, 80, 98, 104, 98], XL: [73, 82, 98, 104, 80, 86, 104, 110, 99], XXL: [83, 92, 104, 110, 86, 92, 110, 116, 100],
    XXXL: [93, 102, 110, 116, 92, 98, 116, 122, 101], "4XL": [103, 112, 116, 122, 98, 104, 122, 128, 102], "5XL": [113, 122, 122, 128, 104, 110, 128, 134, 103],
  },
};
// EU → foot length cm, UK, US
const SHOES: Record<string, [number, number, number]> = {
  "35": [22.5, 2.5, 3.5], "36": [23, 3.5, 4.5], "37": [23.5, 4, 5], "38": [24, 5, 6], "39": [25, 6, 7], "40": [25.5, 6.5, 7.5],
  "41": [26, 7, 8], "42": [27, 8, 9], "43": [27.5, 9, 10], "44": [28, 9.5, 10.5], "45": [29, 10.5, 11.5], "46": [29.5, 11, 12], "47": [30.5, 12, 13],
};
// kid size → age, height cm, chest, waist
const KIDS: Record<string, [string, number, number, number]> = {
  "0-3M": ["0-3m", 56, 40, 40], "3-6M": ["3-6m", 62, 42, 42], "6-12M": ["6-12m", 74, 46, 45], "12-18M": ["12-18m", 80, 48, 47],
  "2Y": ["2", 92, 52, 50], "3Y": ["3", 98, 54, 51], "4Y": ["4", 104, 56, 52], "5Y": ["5", 110, 58, 53], "6Y": ["6", 116, 60, 54],
  "7Y": ["7", 122, 62, 55], "8Y": ["8", 128, 64, 57], "9Y": ["9", 134, 66, 58], "10Y": ["10", 140, 69, 60], "12Y": ["12", 152, 74, 63], "14Y": ["14", 164, 80, 66],
};
// waist sizes in inches (jeans "32") → the adult letter they sit closest to
const WAIST_IN = (label: string) => { const n = Number(label); return n >= 24 && n <= 50 ? n : null; };

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "").replace(/^X{3}L$/, "XXXL").replace(/^2XL$/, "XXL").replace(/^3XL$/, "XXXL");

/** Garment type from the category slugs (leaf first, then its ancestors). */
export function garmentFor(slugs: string[]): Garment | null {
  const all = slugs.join(" ").toLowerCase();
  if (/shoe|sneaker|boot|sandal|slipper|heel|loafer|flip-flop|clog/.test(all)) return "shoes";
  // only the fashion / sportswear branches carry a garment chart — baby care,
  // bedding and storage must never borrow the children's table
  if (!/fashion|shoes|sportswear/.test(all)) return null;
  const leaf = (slugs[0] ?? "").toLowerCase();
  const pick = (s: string): Garment | null =>
    /dress|abaya|jumpsuit|gown|kaftan|galabeya|jalabiya/.test(s) ? "dress"
      : /pant|jean|trouser|short|skirt|legging|jogger|chino/.test(s) ? "bottom"
        : /jacket|coat|hoodie|sweat|blazer|parka|cardigan|puffer/.test(s) ? "outerwear"
          : /shirt|t-shirt|top|blouse|polo|vest|tank|tee|pajama|sleep|uniform|suit/.test(s) ? "top" : null;
  if (/kid|baby|boy|girl|infant|toddler/.test(all) && !/women|men/.test(leaf)) return "kids";
  return pick(leaf) ?? pick(all) ?? "top";
}

function range(lo: number, hi: number): string { return lo === hi ? String(lo) : `${lo}-${hi}`; }

/** One standard row for a size label (empty values when the label is unknown). */
export function standardRow(garment: Garment, label: string): SizeChartRow {
  const keys = MEASURES[garment];
  const values: Record<string, string> = Object.fromEntries(keys.map((k) => [k, ""]));
  const u = norm(label);
  if (garment === "shoes") {
    const hit = SHOES[label.replace(/[^\d]/g, "")];
    if (hit) Object.assign(values, { foot_length: String(hit[0]), eu: label.replace(/[^\d.]/g, ""), uk: String(hit[1]), us: String(hit[2]) });
    return { size: label, values };
  }
  if (garment === "kids") {
    const hit = KIDS[u] ?? KIDS[`${u}Y`];
    if (hit) Object.assign(values, { age: hit[0], height: String(hit[1]), chest: String(hit[2]), waist: String(hit[3]) });
    return { size: label, values };
  }
  let std = STD[garment][u];
  if (!std) {
    const inch = WAIST_IN(label);
    if (inch != null) {
      const cm = Math.round(inch * 2.54);
      const letter = ADULT.find((l) => { const r = STD.bottom[l]!; return cm >= r[2]! && cm < r[3]! + 1; }) ?? (cm < 66 ? "XS" : "5XL");
      std = STD[garment][letter];
    }
  }
  if (!std) return { size: label, values };
  const [wlo, whi, ...m] = std as [number, number, ...number[]];
  values.weight = range(wlo, whi);
  if (garment === "dress") Object.assign(values, { bust: range(m[0]!, m[1]!), waist: range(m[2]!, m[3]!), hip: range(m[4]!, m[5]!), length: String(m[6]) });
  else if (garment === "bottom") Object.assign(values, { waist: range(m[0]!, m[1]!), hip: range(m[2]!, m[3]!), length: String(m[4]), inseam: String(m[5]) });
  else Object.assign(values, { chest: range(m[0]!, m[1]!), length: String(m[2]), shoulder: String(m[3]), sleeve: String(m[4]) });
  return { size: label, values };
}

/** A full default chart for the garment and the seller's size labels. */
export function defaultChart(garment: Garment, sizes: string[]): SizeChart {
  const labels = sizes.length ? sizes : garment === "shoes" ? Object.keys(SHOES).slice(1, 12) : garment === "kids" ? Object.keys(KIDS).slice(4, 12) : ADULT.slice(0, 7);
  return { garment, rows: labels.map((s) => standardRow(garment, s)) };
}

/** Accepts only a well-formed chart (DB jsonb is untrusted input for the UI). */
export function parseChart(raw: unknown): SizeChart | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<SizeChart>;
  if (!c.garment || !(GARMENTS as readonly string[]).includes(c.garment) || !Array.isArray(c.rows)) return null;
  const keys = MEASURES[c.garment];
  const rows = c.rows
    .filter((r): r is SizeChartRow => Boolean(r) && typeof r.size === "string" && r.size.trim() !== "")
    .slice(0, 30)
    .map((r) => ({ size: r.size.slice(0, 20), values: Object.fromEntries(keys.map((k) => [k, String(r.values?.[k] ?? "").slice(0, 20)])) }));
  if (rows.length === 0) return null;
  return { garment: c.garment, rows, note_ar: String(c.note_ar ?? "").slice(0, 300), note_en: String(c.note_en ?? "").slice(0, 300) };
}
