import bwipjs from "bwip-js/node";

/**
 * Packaging documents — server-rendered printable HTML:
 *  invoice      A4  — items, unit (piece / roll / metre), totals, plan,
 *                     every payment (deposit, balance, COD, refunds)
 *  label        A5  — platform → seller, Code128 of the order number
 *  return_label A5  — seller → platform for a packaging return (PKR-…)
 * Access is checked by the route (admin, or the seller who owns the order).
 */

export type PackagingDoc = "invoice" | "label" | "return_label";

export interface PackagingOrderDoc {
  number: string;
  status: string;
  payment_plan: string;
  payment_method: string;
  payment_status: string;
  subtotal_piastres: number;
  shipping_fee_piastres: number;
  total_piastres: number;
  deposit_piastres: number;
  paid_piastres: number;
  refunded_piastres: number;
  ship_name: string;
  ship_phone: string | null;
  ship_address: string;
  carrier: string | null;
  tracking_number: string | null;
  created_at: string;
  store_name: string;
  items: Array<{ sku: string; name_ar: string; name_en: string; unit: string; qty: number; unit_price_piastres: number; line_total_piastres: number }>;
  payments: Array<{ kind: string; method: string; amount_piastres: number; status: string; created_at: string; provider_ref: string }>;
  open_balance_piastres: number;
}

export interface PackagingReturnDoc {
  number: string;
  reason: string;
  items: Array<{ name_ar: string; name_en: string; unit: string; qty: number }>;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: #d4d4d4; }
  body { color: #171717; font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; text-align: start; font-size: 12px; border-bottom: 1px solid #e5e5e5; }
  th { font-weight: 800; background: #f5f5f5; }
  .num { font-variant-numeric: tabular-nums; }
  .sheet { position: relative; background: #fff; margin: 0 auto; box-shadow: 0 2px 14px rgba(0,0,0,.25); display: flex; flex-direction: column; gap: 10px; }
  .a4 { width: 210mm; min-height: 297mm; padding: 14mm; }
  .a5 { width: 210mm; height: 148mm; padding: 9mm 11mm; }
  h1 { font-size: 22px; font-weight: 900; }
  .muted { color: #525252; font-size: 12px; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .box { border: 1.5px solid #171717; border-radius: 8px; padding: 10px 12px; flex: 1; }
  .box h3 { font-size: 11px; color: #525252; font-weight: 800; margin-bottom: 4px; }
  .big { font-size: 18px; font-weight: 900; }
  .totals td { border: 0; padding: 3px 8px; }
  .totals .grand td { font-size: 15px; font-weight: 900; border-top: 2px solid #171717; }
  .tag { display: inline-block; border: 1px solid #171717; border-radius: 99px; padding: 1px 10px; font-size: 11px; font-weight: 800; }
  .barcode svg { height: 22mm; width: 100%; }
  .printbar { position: fixed; inset-inline-end: 14px; top: 14px; z-index: 9; background: #171717; color: #fff; border: 0; border-radius: 8px; padding: 9px 18px; font: 700 13px Cairo, sans-serif; cursor: pointer; }
  @media print { html, body { background: #fff; } .sheet { box-shadow: none; } .printbar { display: none; } }
`;
const PAGE = { a4: "@page { size: A4 portrait; margin: 0; }", a5: "@page { size: A5 landscape; margin: 0; }" };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const money = (p: number, lang: "ar" | "en") =>
  new Intl.NumberFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-EG", { style: "currency", currency: "EGP", minimumFractionDigits: 2 }).format(p / 100);
const day = (iso: string, lang: "ar" | "en") =>
  new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

const L = {
  ar: {
    invoice: "فاتورة مواد التغليف", label: "ملصق شحن — مواد تغليف", ret: "ملصق إرجاع — مواد تغليف", from: "من", to: "إلى",
    platform: "إتسوء — قسم التغليف", platformRet: "إتسوء — مرتجعات التغليف", item: "الصنف", unit: "الوحدة", qty: "الكمية",
    price: "سعر الوحدة", total: "الإجمالي", subtotal: "المنتجات", shipping: "الشحن", grand: "الإجمالي المستحق",
    paid: "المدفوع", refunded: "المسترد", open: "المتبقي (يُحصَّل مع أول طلب يتم تسليمه)", plan_full: "دفع كامل", plan_split: "50% مقدمًا",
    method_card: "بطاقة", method_cod: "الدفع عند الاستلام", payments: "المدفوعات", date: "التاريخ", store: "المتجر",
    piece: "قطعة", roll: "رول", meter: "متر", cod: "تحصيل عند الاستلام", reason: "سبب الإرجاع", print: "طباعة",
    k_full: "دفع كامل", k_deposit: "دفعة مقدمة", k_balance: "تحصيل الباقي من المحفظة", k_cod: "تحصيل نقدي", k_refund: "استرداد", k_overpayment: "دفعة زائدة",
  },
  en: {
    invoice: "Packaging materials invoice", label: "Shipping label — packaging", ret: "Return label — packaging", from: "From", to: "To",
    platform: "Etsawaa — Packaging", platformRet: "Etsawaa — Packaging returns", item: "Item", unit: "Unit", qty: "Qty",
    price: "Unit price", total: "Total", subtotal: "Products", shipping: "Shipping", grand: "Total due",
    paid: "Paid", refunded: "Refunded", open: "Outstanding (collected with the first delivered order)", plan_full: "Full payment", plan_split: "50% upfront",
    method_card: "Card", method_cod: "Cash on delivery", payments: "Payments", date: "Date", store: "Store",
    piece: "piece", roll: "roll", meter: "metre", cod: "Collect on delivery", reason: "Return reason", print: "Print",
    k_full: "Full payment", k_deposit: "Deposit", k_balance: "Balance collected from wallet", k_cod: "Cash collected", k_refund: "Refund", k_overpayment: "Overpayment",
  },
};

function shell(lang: "ar" | "en", title: string, page: "a4" | "a5", body: string, siteUrl: string): string {
  const font = `<style>@font-face{font-family:'Cairo';font-weight:200 1000;src:url('${siteUrl}/fonts/cairo-var-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+FB50-FDFF,U+FE70-FEFC}@font-face{font-family:'Cairo';font-weight:200 1000;src:url('${siteUrl}/fonts/cairo-var-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+2000-206F}</style>`;
  return `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(title)}</title>${font}<style>${CSS}${PAGE[page]}</style></head><body>
<button class="printbar" type="button" onclick="window.print()">${L[lang].print}</button>${body}</body></html>`;
}

async function barcode(text: string): Promise<string> {
  try {
    return await bwipjs.toSVG({ bcid: "code128", text, height: 14, includetext: true, textxalign: "center" });
  } catch {
    return `<div class="big num">${esc(text)}</div>`;
  }
}

export function renderPackagingInvoice(o: PackagingOrderDoc, lang: "ar" | "en", siteUrl: string): string {
  const t = L[lang];
  const rows = o.items.map((i) => `<tr><td>${esc(lang === "ar" ? i.name_ar : i.name_en)}<div class="muted num" dir="ltr">${esc(i.sku)}</div></td>
    <td>${t[i.unit as "piece" | "roll" | "meter"] ?? esc(i.unit)}</td><td class="num">${i.qty}</td>
    <td class="num">${money(i.unit_price_piastres, lang)}</td><td class="num">${money(i.line_total_piastres, lang)}</td></tr>`).join("");
  const pays = o.payments.filter((p) => p.status === "succeeded").map((p) => `<tr><td>${t[`k_${p.kind}` as keyof typeof t] ?? esc(p.kind)}</td>
    <td class="num">${day(p.created_at, lang)}</td><td class="num" dir="ltr">${esc(p.provider_ref)}</td>
    <td class="num">${p.kind === "refund" ? "−" : ""}${money(p.amount_piastres, lang)}</td></tr>`).join("");
  const body = `<section class="sheet a4">
    <div class="row"><div><h1>${t.invoice}</h1><p class="muted num" dir="ltr">${esc(o.number)}</p></div>
      <div style="text-align:end"><p class="big">${t.platform}</p><p class="muted">${t.date}: ${day(o.created_at, lang)}</p></div></div>
    <div class="row"><div class="box"><h3>${t.to}</h3><p><b>${esc(o.store_name)}</b></p><p>${esc(o.ship_name)}</p>
      <p class="num" dir="ltr">${esc(o.ship_phone ?? "")}</p><p>${esc(o.ship_address)}</p></div>
      <div class="box"><h3>${t.payments}</h3><p><span class="tag">${o.payment_plan === "split" ? t.plan_split : t.plan_full}</span>
      <span class="tag">${o.payment_method === "cod" ? t.method_cod : t.method_card}</span></p></div></div>
    <table><thead><tr><th>${t.item}</th><th>${t.unit}</th><th>${t.qty}</th><th>${t.price}</th><th>${t.total}</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="totals" style="max-width:90mm;margin-inline-start:auto">
      <tr><td>${t.subtotal}</td><td class="num">${money(o.subtotal_piastres, lang)}</td></tr>
      <tr><td>${t.shipping}</td><td class="num">${money(o.shipping_fee_piastres, lang)}</td></tr>
      <tr class="grand"><td>${t.grand}</td><td class="num">${money(o.total_piastres, lang)}</td></tr>
      <tr><td>${t.paid}</td><td class="num">${money(o.paid_piastres, lang)}</td></tr>
      ${o.refunded_piastres > 0 ? `<tr><td>${t.refunded}</td><td class="num">−${money(o.refunded_piastres, lang)}</td></tr>` : ""}
      ${o.open_balance_piastres > 0 ? `<tr><td>${t.open}</td><td class="num">${money(o.open_balance_piastres, lang)}</td></tr>` : ""}
    </table>
    ${pays ? `<h3 style="font-size:13px;font-weight:900">${t.payments}</h3><table><tbody>${pays}</tbody></table>` : ""}
  </section>`;
  return shell(lang, `${t.invoice} ${o.number}`, "a4", body, siteUrl);
}

export async function renderPackagingLabel(o: PackagingOrderDoc, lang: "ar" | "en", siteUrl: string): Promise<string> {
  const t = L[lang];
  const pieces = o.items.reduce((s, i) => s + i.qty, 0);
  const cod = o.payment_method === "cod" && o.payment_status === "cod_pending" ? o.total_piastres : 0;
  const body = `<section class="sheet a5">
    <div class="row"><h1>${t.label}</h1><span class="tag num" dir="ltr">${esc(o.number)}</span></div>
    <div class="barcode">${await barcode(o.number)}</div>
    <div class="row"><div class="box"><h3>${t.from}</h3><p class="big">${t.platform}</p></div>
      <div class="box" style="flex:2"><h3>${t.to}</h3><p class="big">${esc(o.store_name)}</p><p>${esc(o.ship_name)}</p>
      <p class="num" dir="ltr">${esc(o.ship_phone ?? "")}</p><p>${esc(o.ship_address)}</p></div></div>
    <div class="row"><div class="box"><h3>${t.qty}</h3><p class="big num">${pieces}</p></div>
      <div class="box"><h3>${t.cod}</h3><p class="big num">${cod > 0 ? money(cod, lang) : "—"}</p></div>
      ${o.tracking_number ? `<div class="box"><h3>${esc(o.carrier ?? "")}</h3><p class="big num" dir="ltr">${esc(o.tracking_number)}</p></div>` : ""}</div>
  </section>`;
  return shell(lang, `${t.label} ${o.number}`, "a5", body, siteUrl);
}

export async function renderPackagingReturnLabel(o: PackagingOrderDoc, r: PackagingReturnDoc, lang: "ar" | "en", siteUrl: string): Promise<string> {
  const t = L[lang];
  const lines = r.items.map((i) => `<li>${i.qty} × ${esc(lang === "ar" ? i.name_ar : i.name_en)} (${t[i.unit as "piece" | "roll" | "meter"] ?? esc(i.unit)})</li>`).join("");
  const body = `<section class="sheet a5">
    <div class="row"><h1>${t.ret}</h1><span class="tag num" dir="ltr">${esc(r.number)} · ${esc(o.number)}</span></div>
    <div class="barcode">${await barcode(r.number)}</div>
    <div class="row"><div class="box" style="flex:2"><h3>${t.from}</h3><p class="big">${esc(o.store_name)}</p><p>${esc(o.ship_name)}</p>
      <p class="num" dir="ltr">${esc(o.ship_phone ?? "")}</p><p>${esc(o.ship_address)}</p></div>
      <div class="box"><h3>${t.to}</h3><p class="big">${t.platformRet}</p></div></div>
    <div class="box"><h3>${t.reason}</h3><p>${esc(r.reason || "—")}</p><ul style="margin-inline-start:18px;margin-top:4px">${lines}</ul></div>
  </section>`;
  return shell(lang, `${t.ret} ${r.number}`, "a5", body, siteUrl);
}
