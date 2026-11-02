import bwipjs from "bwip-js/node";
import type { OrderRow, GroupRow, ItemRow } from "./api";

/**
 * Order documents (AGENT §28 / JOURNEYS §9a) — server-rendered HTML with
 * @page CSS: admin invoice A4, carrier label A5 landscape (Code128 of the
 * shipment number via bwip-js inline SVG), vendor label A5 (same number as
 * TEXT ONLY — no barcode, customer NAME only, own amounts, shipping "—").
 * Amounts shown: products / discount / shipping / COD — nothing else.
 * Cancelled orders print with a "ملغي" watermark.
 * Every print logs an order_documents row through fn_log_document (route side).
 */

export type DocType = "invoice_admin" | "label_carrier" | "label_vendor" | "invoice_vendor";

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: #d4d4d4; }
  body { color: #171717; font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; text-align: start; font-size: 12px; border-bottom: 1px solid #e5e5e5; }
  th { font-weight: 800; background: #f5f5f5; }
  .num { font-variant-numeric: tabular-nums; }
  /* the sheet = the real paper rectangle; centered on screen, exact on print */
  .sheet {
    position: relative; background: #fff; margin: 0 auto; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .sheet-a4 { width: 210mm; min-height: 297mm; padding: 12mm 14mm; }
  .sheet-a4 > * { max-width: 168mm; margin-inline: auto; width: 100%; }
  .sheet-a5 { width: 210mm; height: 148mm; padding: 8mm 10mm; }
  body > .sheet { box-shadow: 0 2px 14px rgba(0,0,0,0.25); }
  .sheet + .sheet { margin-top: 8mm; }
  @media print {
    html, body { background: #fff; }
    body > .sheet { box-shadow: none; margin: 0 auto; }
    .sheet-a4 { min-height: 296mm; }
    .sheet-a5 { height: 147mm; }
    .sheet { page-break-after: always; }
    .sheet:last-of-type { page-break-after: auto; }
  }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .brand { font-weight: 900; font-size: 20px; }
  .brand small { display: block; font-weight: 600; font-size: 11px; color: #525252; }
  .muted { color: #525252; }
  .totals td { border-bottom: none; padding: 3px 8px; }
  .grand { font-weight: 900; font-size: 15px; border-top: 2px solid #171717 !important; }
  .watermark {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    pointer-events: none; z-index: 50;
  }
  .watermark span {
    transform: rotate(-24deg); font-size: 96px; font-weight: 900; color: rgba(0,0,0,0.08);
    border: 8px solid rgba(0,0,0,0.08); border-radius: 24px; padding: 0 48px;
  }
  .copy-note { margin-top: 8px; font-size: 10px; color: #737373; }
  .doc-footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #d4d4d4; font-size: 10px; color: #525252; text-align: center; }
  .doc-logo { display: block; max-height: 12mm; width: auto; margin-bottom: 3px; }
  /* the Code128 barcode block lives INSIDE the sheet, width-contained */
  .barcode { width: 70mm; max-width: 100%; }
  .barcode svg { display: block; width: 100%; height: auto; }
  /* carrier label: middle band is two columns — customer block (START,
     flex-grows through the empty middle) beside an inline totals table —
     both vertically centered in the band so the A5 middle is used;
     barcode stays a compact strip at the bottom-START of the sheet */
  .carrier-data { flex: 1; min-height: 0; display: flex; gap: 10mm; align-items: center; }
  .carrier-who { flex: 1; min-width: 0; }
  .carrier-totals { width: 62mm; flex-shrink: 0; }
  .carrier-bar {
    /* flex row صريح — الباركود والـQR جنباً إلى جنب، والأرقام المقروءة
       تحت الباركود لا يغطيها الـQR */
    display: flex; align-items: flex-end; gap: 8mm; justify-content: space-between;
    margin-top: auto; width: 150mm; max-width: 96%;
    border-top: 1px solid #e5e5e5; padding-top: 3mm;
  }
`;

const PAGE_CSS = {
  a4: `@page { size: A4 portrait; margin: 0; }`,
  a5: `@page { size: A5 landscape; margin: 0; }`,
} as const;

// H-02: print documents embed the SELF-HOSTED variable Cairo. The QA tool
// feeds rendered HTML to Puppeteer via page.setContent (about:blank origin),
// where RELATIVE /fonts/… URLs cannot resolve — so the @font-face URLs must
// be ABSOLUTE, built from SITE_URL at render time. In-app <base> equals the
// site origin, so the same absolute URLs are correct there too.
const SITE = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FONT_LINK = `<style>@font-face{font-family:'Cairo';font-style:normal;font-weight:200 1000;font-display:swap;src:url('${SITE}/fonts/cairo-var-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+FB50-FDFF,U+FE70-FEFC}@font-face{font-family:'Cairo';font-style:normal;font-weight:200 1000;font-display:swap;src:url('${SITE}/fonts/cairo-var-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+2000-206F}</style>`;

/* on-screen print button — never part of the printed page */
const PRINT_BAR = (lang: "ar" | "en"): string => `
  <style>.printbar{position:fixed;inset-inline-end:14px;top:14px;z-index:99;background:#171717;color:#fff;border:0;border-radius:8px;padding:9px 18px;font:700 13px Cairo,sans-serif;cursor:pointer}@media print{.printbar{display:none}}</style>
  <button class="printbar" type="button" onclick="window.print()">${lang === "ar" ? "طباعة" : "Print"}</button>`;

/** Documented document-date format: dd/MM/yyyy with LATIN digits (B5) —
 * identical on the invoice, the carrier label and the vendor labels. */
function docDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function money(piastres: number, lang: "ar" | "en"): string {
  const v = (piastres / 100).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return lang === "ar" ? `${v} ج.م` : `EGP ${v}`;
}
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function head(lang: "ar" | "en", settings?: DocSettings): string {
  const custom = lang === "ar" ? settings?.header_ar : settings?.header_en;
  const logo = settings?.logo_path
    ? `<img class="doc-logo" src="/api/media?path=${encodeURIComponent(settings.logo_path)}" alt="" />`
    : "";
  if (custom) return `<div class="brand">${logo}${esc(custom)}</div>`;
  return lang === "ar"
    ? `<div class="brand">${logo}اتسوء<small>etsawaa.com — سوقك المصري متعدد البائعين</small></div>`
    : `<div class="brand">${logo}Etsawaa<small>etsawaa.com — Egypt's multi-vendor marketplace</small></div>`;
}

function footer(lang: "ar" | "en", settings?: DocSettings): string {
  const text = lang === "ar" ? settings?.footer_ar : settings?.footer_en;
  return text ? `<div class="doc-footer">${esc(text)}</div>` : "";
}

function watermarkIf(order: OrderRow, lang: "ar" | "en", settings?: DocSettings): string {
  if (order.status !== "cancelled") return "";
  const custom = settings?.watermark_cancelled;
  return `<div class="watermark" aria-hidden="true"><span>${esc(custom || (lang === "ar" ? "ملغي" : "CANCELLED"))}</span></div>`;
}

async function code128Svg(text: string, heightMm = 14): Promise<string> {
  const svg = await bwipjs.toSVG({
    bcid: "code128",
    text,
    scale: 3,          // 100% print scale target: ~2.5px/module at 96dpi
    height: heightMm,  // mm
    includetext: true,
    textxalign: "center",
    textsize: 10,
    textyoffset: 2,
  });
  // strip the xml prolog — inline SVG in the document
  return svg.replace(/<\?xml[^?]*\?>\s*/, "");
}

/** L-20 — QR of the maps pin URL (carrier label only; scannable by phone). */
async function mapsQrSvg(order: OrderRow): Promise<string> {
  if (order.shipping_lat == null || order.shipping_lng == null) return "";
  const url = `https://maps.google.com/?q=${order.shipping_lat.toFixed(6)},${order.shipping_lng.toFixed(6)}`;
  const svg = await bwipjs.toSVG({
    bcid: "qrcode",
    text: url,
    scale: 4,
    includetext: false,
  });
  return svg.replace(/<\?xml[^?]*\?>\s*/, "");
}

function paymentStatus(order: OrderRow, lang: "ar" | "en"): string {
  if (order.payment_method === "cod") {
    return order.payment_status === "cod_collected"
      ? (lang === "ar" ? "الدفع عند الاستلام — محصّل" : "COD — collected")
      : (lang === "ar" ? "الدفع عند الاستلام — غير محصّل" : "COD — pending");
  }
  return order.payment_status === "paid"
    ? (lang === "ar" ? "مدفوع (بطاقة/محفظة)" : "Paid (card/wallet)")
    : (lang === "ar" ? "غير مدفوع" : "Unpaid");
}

export interface DocInput {
  order: OrderRow;
  groups: GroupRow[];
  items: ItemRow[];
  governorate: { name_ar: string; name_en: string } | null;
  area: { name_ar: string; name_en: string } | null;
  lang: "ar" | "en";
  piecesOverride?: number | null; // carrier label: editable pieces at print
  /** Resolved leaf-category display names for the label. */
  categoryNames?: string[];
  /** settings['documents'] — header/footer/logo/watermark/barcode height. */
  docSettings?: DocSettings;
}

export interface DocSettings {
  copies_invoice_admin?: number;
  copies_invoice_vendor?: number;
  copies_label_carrier?: number;
  copies_label_vendor?: number;
  paper_invoice?: string;
  paper_label?: string;
  terms_ar?: string;
  terms_en?: string;
  header_ar?: string;
  header_en?: string;
  footer_ar?: string;
  footer_en?: string;
  logo_path?: string;
  watermark_cancelled?: string;
  barcode_height_mm?: number;
  show_commission?: boolean;
}

/* ---------------------------------------------------------------------------
   ADMIN INVOICE — A4, full order: all groups, items, totals, commission,
   payment method — those lines only (AGENT §28).
--------------------------------------------------------------------------- */
export function renderAdminInvoice(input: DocInput): string {
  const { order, groups, items, governorate, area, lang, docSettings } = input;
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const L = {
    invoice: ar ? "فاتورة معتمدة" : "Order Invoice",
    no: ar ? "رقم الطلب / الشحنة" : "Order / shipment no.",
    date: ar ? "التاريخ" : "Date",
    seller: ar ? "البائع" : "Vendor",
    item: ar ? "الصنف" : "Item",
    qty: ar ? "الكمية" : "Qty",
    unit: ar ? "سعر الوحدة" : "Unit price",
    total: ar ? "الإجمالي" : "Total",
    commission: ar ? "العمولة" : "Commission",
    subtotal: ar ? "إجمالي المنتجات" : "Products total",
    discount: ar ? "الخصم" : "Discount",
    shipping: ar ? "الشحن" : "Shipping",
    grand: ar ? "الإجمالي النهائي" : "Grand total",
    pay: ar ? "طريقة الدفع" : "Payment method",
    customer: ar ? "العميل" : "Customer",
    address: ar ? "عنوان التسليم" : "Delivery address",
    payCod: ar ? "الدفع عند الاستلام" : "Cash on delivery",
    payCard: ar ? "بطاقة/محفظة إلكترونية (كاشير)" : "Card / e-wallet (Kashier)",
    paid: order.payment_status === "paid" || order.payment_status === "cod_collected",
    payPaid: ar ? " — مدفوع" : " — paid",
    payUnpaid: ar ? " — غير مدفوع" : " — unpaid",
    copyNote: ar ? "نسخة الإدارة — مستند داخلي يحتوي العمولة" : "Admin copy — internal document, contains commission",
  };

  const groupSections = groups.map((g) => {
    const own = items.filter((i) => i.group_id === g.id);
    const rows = own.map((i) => `
      <tr>
        <td>${esc(ar ? i.product_name_ar : i.product_name_en)}${i.option_key ? ` <span class="muted">(${esc(i.option_key)})</span>` : ""}</td>
        <td class="num">${i.qty}</td>
        <td class="num">${money(i.unit_price_piastres, lang)}</td>
        <td class="num">${money(i.line_total_piastres, lang)}</td>
        <td class="num">${money(i.coupon_discount_piastres, lang)}</td>
        <td class="num">${money(i.commission_piastres, lang)}</td>
      </tr>`).join("");
    return `
      <p style="margin:14px 0 4px;font-weight:800;">${L.seller}: ${esc(ar ? g.vendor.store_name_ar : g.vendor.store_name_en)}</p>
      <table>
        <thead><tr><th>${L.item}</th><th>${L.qty}</th><th>${L.unit}</th><th>${L.total}</th><th>${L.discount}</th><th>${L.commission}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join("");

  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${L.no} ${esc(order.number)}</title>${FONT_LINK}<style>${BASE_CSS}${PAGE_CSS.a4}</style></head><body>
  ${PRINT_BAR(lang)}
  <div class="sheet sheet-a4">${watermarkIf(order, lang, docSettings)}
    <div class="doc-head">
      ${head(lang, docSettings)}
      <div style="text-align:${ar ? "left" : "right"};font-size:12px;">
        <p><strong>${L.no}:</strong> <span class="num">${esc(order.number)}</span></p>
        <p><strong>${L.date}:</strong> <span class="num" dir="ltr">${docDate(order.created_at)}</span></p>
        <p><strong>${L.pay}:</strong> ${order.payment_method === "cod" ? L.payCod : L.payCard}${L.paid ? L.payPaid : L.payUnpaid}</p>
      </div>
    </div>
    <p style="margin:12px 0 2px;font-size:18px;font-weight:900;">${L.invoice}</p>
    <p style="font-size:12px;"><strong>${L.customer}:</strong> ${esc(order.ship_name)} — <span dir="ltr">${esc(order.phone_primary)}</span></p>
    <p style="font-size:12px;"><strong>${L.address}:</strong> ${esc(order.address1)}${order.address2 ? "، " + esc(order.address2) : ""} — ${esc((ar ? governorate?.name_ar : governorate?.name_en) ?? "")} · ${esc((ar ? area?.name_ar : area?.name_en) ?? "")}</p>
    ${groupSections}
    <table class="totals" style="margin-top:14px;width:60%;margin-inline-start:auto;">
      <tbody>
        <tr><td>${L.subtotal}</td><td class="num">${money(order.subtotal_piastres, lang)}</td></tr>
        ${order.discount_piastres > 0 ? `<tr><td>${L.discount}${order.coupon_code ? ` (${esc(order.coupon_code)})` : ""}</td><td class="num">−${money(order.discount_piastres, lang)}</td></tr>` : ""}
        <tr><td>${L.shipping}</td><td class="num">${money(order.shipping_fee_piastres, lang)}</td></tr>
        <tr><td class="grand">${L.grand}</td><td class="num grand">${money(order.total_piastres, lang)}</td></tr>
      </tbody>
    </table>
    <p class="copy-note">${L.copyNote}</p>${footer(lang, docSettings)}
  </div></body></html>`;
}

/* ---------------------------------------------------------------------------
   CARRIER LABEL — A5 landscape, ONE per order. Full customer data + Code128
   of the shipment number + pieces count (auto = total qty, editable at print).
--------------------------------------------------------------------------- */
export async function renderCarrierLabel(input: DocInput): Promise<string> {
  const { order, governorate, area, lang, piecesOverride, docSettings } = input;
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const pieces = piecesOverride ?? input.items.reduce((s, i) => s + i.qty, 0);
  const L = {
    shipment: ar ? "رقم الشحنة" : "Shipment no.",
    date: ar ? "التاريخ" : "Date",
    pay: ar ? "حالة الدفع" : "Payment status",
    pieces: ar ? "عدد الشحنات" : "Shipments",
    to: ar ? "المرسل إليه" : "Deliver to",
    phone: ar ? "الهاتف" : "Phone",
    addr: ar ? "العنوان" : "Address",
    category: ar ? "الفئة" : "Category",
    fragile: ar ? "هش — يُنقل بعناية" : "FRAGILE — handle with care",
    products: ar ? "إجمالي المنتجات" : "Products total",
    shipping: ar ? "الشحن" : "Shipping",
    cod: ar ? "المطلوب تحصيله (COD)" : "COD amount",
    only: ar ? "فقط لا غير" : "only",
    missingData: ar ? "لا يمكن طباعة بطاقة الشحن: بيانات المستلم أو العنوان ناقصة" : "Cannot print the carrier label: recipient phone or address is missing",
    codOnly: ar ? "COD" : "COD",
  };

  // missing phone/address blocks the label with a clear message (US-14 edge)
  if (!order.phone_primary || !order.phone_alternate || !order.address1) {
    return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${L.shipment}</title>${FONT_LINK}<style>${BASE_CSS}</style></head>
    <body style="display:flex;align-items:center;justify-content:center;min-height:100vh;">
      ${PRINT_BAR(lang)}
      <p style="font-size:16px;font-weight:800;color:#b91c1c;">${L.missingData}</p>
    </body></html>`;
  }

  const categoryNames = input.categoryNames ?? [];
  const barcode = await code128Svg(order.number, docSettings?.barcode_height_mm);
  // L-20 — QR of the maps pin placed beside the Code128 (empty when the
  // customer did not drop a pin; vendor labels never carry either)
  const qr = await mapsQrSvg(order);

  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${L.shipment} ${esc(order.number)}</title>${FONT_LINK}<style>${BASE_CSS}${PAGE_CSS.a5}</style></head><body>
  ${PRINT_BAR(lang)}
  <div class="sheet sheet-a5">
    <div class="doc-head">
      ${head(lang, docSettings)}
      <div style="text-align:${ar ? "left" : "right"};font-size:12px;">
        <p><strong>${L.shipment}:</strong> <span class="num" style="font-weight:900;font-size:15px;" dir="ltr">${esc(order.number)}</span></p>
        <p><strong>${L.date}:</strong> <span class="num" dir="ltr">${docDate(order.created_at)}</span></p>
        <p><strong>${L.pay}:</strong> ${paymentStatus(order, lang)}</p>
        <p><strong>${L.pieces}:</strong> <span class="num" style="font-weight:900;">${pieces}</span></p>
      </div>
    </div>
    <div class="carrier-data">
      <div class="carrier-who">
        <p style="font-weight:900;font-size:14px;">${L.to}: ${esc(order.ship_name)}</p>
        <p style="font-size:12px;">${L.phone}: <span dir="ltr" class="num">${esc(order.phone_primary)}</span> · <span dir="ltr" class="num">${esc(order.phone_alternate)}</span></p>
        <p style="font-size:12px;margin-top:4px;">${L.addr}: ${esc(order.address1)}${order.address2 ? "، " + esc(order.address2) : ""} — ${esc((ar ? governorate?.name_ar : governorate?.name_en) ?? "")} · ${esc((ar ? area?.name_ar : area?.name_en) ?? "")}${order.postal_code ? ` (${esc(order.postal_code)})` : ""}</p>
        <p style="font-size:12px;margin-top:4px;">${L.category}: ${esc(categoryNames.join(ar ? "، " : ", ")) || "—"}${input.items.some((i) => i.is_fragile) ? ` — <span style="display:inline-block;border:2px solid #171717;padding:2px 9px;font-weight:900;">${L.fragile}</span>` : ""}</p>
      </div>
      <table class="totals carrier-totals">
        <tbody>
          <tr><td>${L.products}</td><td class="num">${money(order.subtotal_piastres, lang)}</td></tr>
          <tr><td>${L.shipping}</td><td class="num">${money(order.shipping_fee_piastres, lang)}</td></tr>
          ${order.payment_method === "cod" ? `<tr><td class="grand">${L.cod}</td><td class="num grand">${money(order.total_piastres, lang)} ${L.only}</td></tr>`
            : `<tr><td>${L.cod}</td><td class="num">${L.codOnly} — 0.00</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="carrier-bar">
      <div class="barcode">${barcode}</div>
      ${qr ? `<div class="carrier-qr" style="flex-shrink:0;text-align:center;"><img src="data:image/svg+xml;base64,${Buffer.from(qr).toString("base64")}" width="23mm" height="23mm" alt="maps"/><small style="display:block;font-size:8px;color:#525252;">maps</small></div>` : ""}
    </div>
  </div></body></html>`;
}

/* ---------------------------------------------------------------------------
   VENDOR LABEL — A5, one per vendor. Same shipment number as TEXT ONLY (no
   barcode), customer NAME only (no phone/address), own items, shipping "—".
--------------------------------------------------------------------------- */
export function renderVendorLabel(input: DocInput, group: GroupRow): string {
  const { order, lang, docSettings } = input;
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const own = input.items.filter((i) => i.group_id === group.id);
  const pieces = own.reduce((s, i) => s + i.qty, 0);
  const L = {
    vendorLabel: ar ? "بطاقة تعبئة — نسخة البائع" : "Packing label — vendor copy",
    shipment: ar ? "رقم الشحنة" : "Shipment no.",
    date: ar ? "التاريخ" : "Date",
    pieces: ar ? "عدد الشحنات" : "Shipments",
    to: ar ? "العميل" : "Customer",
    item: ar ? "الصنف" : "Item",
    qty: ar ? "الكمية" : "Qty",
    products: ar ? "إجمالي منتجاتك" : "Your products total",
    shipping: ar ? "الشحن" : "Shipping",
    pay: ar ? "حالة الدفع" : "Payment status",
    category: ar ? "الفئة" : "Category",
  };
  const categoryNames = input.categoryNames ?? [];

  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${L.shipment} ${esc(order.number)}</title>${FONT_LINK}<style>${BASE_CSS}${PAGE_CSS.a5}</style></head><body>
  ${PRINT_BAR(lang)}
  <div class="sheet sheet-a5">${watermarkIf(order, lang, docSettings)}
    <div class="doc-head">
      ${head(lang, docSettings)}
      <div style="text-align:${ar ? "left" : "right"};font-size:12px;">
        <p><strong>${L.shipment}:</strong> <span class="num" style="font-weight:900;font-size:15px;">${esc(order.number)}</span></p>
        <p><strong>${L.date}:</strong> <span class="num" dir="ltr">${docDate(order.created_at)}</span></p>
        <p><strong>${L.pieces}:</strong> <span class="num">${pieces}</span></p>
        <p><strong>${L.pay}:</strong> ${paymentStatus(order, lang)}</p>
      </div>
    </div>
    <p style="margin:10px 0 3px;font-size:16px;font-weight:900;">${L.vendorLabel} — ${esc(ar ? group.vendor.store_name_ar : group.vendor.store_name_en)}</p>
    <p style="font-size:13px;"><strong>${L.to}:</strong> ${esc(order.ship_name)}</p>
    ${categoryNames.length > 0 ? `<p style="font-size:12px;">${L.category}: ${esc(categoryNames.join(ar ? "، " : ", "))}</p>` : ""}
    <div style="display:flex;gap:10mm;align-items:flex-start;flex:1;min-height:0;padding-top:4mm;">
      <table style="flex:1;min-width:0;">
        <thead><tr><th>${L.item}</th><th style="width:22mm;">${L.qty}</th></tr></thead>
        <tbody>
          ${own.map((i) => `<tr><td>${esc(ar ? i.product_name_ar : i.product_name_en)}${i.option_key ? ` <span class="muted">(${esc(i.option_key)})</span>` : ""}</td><td class="num">${i.qty}</td></tr>`).join("")}
        </tbody>
      </table>
      <table class="totals" style="width:56mm;flex-shrink:0;margin-top:0;">
        <tbody>
          <tr><td>${L.products}</td><td class="num">${money(group.items_subtotal_piastres - group.discount_piastres, lang)}</td></tr>
          <tr><td>${L.shipping}</td><td class="num" style="font-weight:900;">—</td></tr>
        </tbody>
      </table>
    </div>
    <p class="copy-note">${ar ? "نسخة البائع — لا تتضمن بيانات التواصل أو العنوان" : "Vendor copy — no contact data or address"}</p>${footer(lang, docSettings)}
  </div></body></html>`;
}

/* ---------------------------------------------------------------------------
   VENDOR INVOICE — A4, only that vendor's items; shipping "—"; no customer
   contact data; no other vendors' amounts; no commission unless enabled.
--------------------------------------------------------------------------- */
export function renderVendorInvoice(input: DocInput, group: GroupRow): string {
  const { order, lang, docSettings } = input;
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const own = input.items.filter((i) => i.group_id === group.id);
  const L = {
    invoice: ar ? "فاتورة البائع" : "Vendor invoice",
    shipment: ar ? "رقم الطلب / الشحنة" : "Order / shipment no.",
    date: ar ? "التاريخ" : "Date",
    customer: ar ? "العميل" : "Customer",
    item: ar ? "الصنف" : "Item",
    qty: ar ? "الكمية" : "Qty",
    unit: ar ? "سعر الوحدة" : "Unit price",
    total: ar ? "الإجمالي" : "Total",
    discount: ar ? "الخصم" : "Discount",
    products: ar ? "إجمالي منتجاتك" : "Your products total",
    shipping: ar ? "الشحن" : "Shipping",
    pay: ar ? "حالة الدفع" : "Payment status",
  };

  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${L.shipment} ${esc(order.number)}</title>${FONT_LINK}<style>${BASE_CSS}${PAGE_CSS.a4}</style></head><body>
  ${PRINT_BAR(lang)}
  <div class="sheet sheet-a4">${watermarkIf(order, lang, docSettings)}
    <div class="doc-head">
      ${head(lang, docSettings)}
      <div style="text-align:${ar ? "left" : "right"};font-size:12px;">
        <p><strong>${L.shipment}:</strong> <span class="num">${esc(order.number)}</span></p>
        <p><strong>${L.date}:</strong> <span class="num" dir="ltr">${docDate(order.created_at)}</span></p>
        <p><strong>${L.pay}:</strong> ${paymentStatus(order, lang)}</p>
      </div>
    </div>
    <p style="margin:12px 0 2px;font-size:18px;font-weight:900;">${L.invoice} — ${esc(ar ? group.vendor.store_name_ar : group.vendor.store_name_en)}</p>
    <p style="font-size:12px;"><strong>${L.customer}:</strong> ${esc(order.ship_name)}</p>
    <table style="margin-top:10px;">
      <thead><tr><th>${L.item}</th><th>${L.qty}</th><th>${L.unit}</th><th>${L.total}</th><th>${L.discount}</th></tr></thead>
      <tbody>
        ${own.map((i) => `<tr>
          <td>${esc(ar ? i.product_name_ar : i.product_name_en)}${i.option_key ? ` <span class="muted">(${esc(i.option_key)})</span>` : ""}</td>
          <td class="num">${i.qty}</td>
          <td class="num">${money(i.unit_price_piastres, lang)}</td>
          <td class="num">${money(i.line_total_piastres, lang)}</td>
          <td class="num">${money(i.coupon_discount_piastres, lang)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <table class="totals" style="margin-top:14px;width:55%;margin-inline-start:auto;">
      <tbody>
        <tr><td>${L.products}</td><td class="num grand">${money(group.items_subtotal_piastres, lang)}</td></tr>
        ${group.discount_piastres > 0 ? `<tr><td>${L.discount}</td><td class="num">−${money(group.discount_piastres, lang)}</td></tr>` : ""}
        <tr><td>${L.shipping}</td><td class="num" style="font-weight:900;">—</td></tr>
      </tbody>
    </table>
    <p class="copy-note">${ar ? "نسخة البائع — مبالغ هذا البائع فقط، بدون عمولة المنصة أو بيانات التواصل" : "Vendor copy — this vendor's amounts only, no platform commission or contact data"}</p>${footer(lang, docSettings)}
  </div></body></html>`;
}

/** Repeat the body for N copies — each copy is its own printed page. */
export function withCopies(html: string, copies: number): string {
  const n = Math.max(1, Math.min(50, Math.round(copies) || 1));
  if (n === 1) return html;
  const bodyMatch = /(<body[^>]*>)([\s\S]*)(<\/body>)/.exec(html);
  const headMatch = /^([\s\S]*?<body[^>]*>)/.exec(html);
  if (!bodyMatch || !headMatch) return html;
  const inner = bodyMatch[2] ?? "";
  const close = bodyMatch[3] ?? "</body>";
  const pages = Array.from({ length: n }, () => inner).join("");
  return `${headMatch[1]}${pages}${close}`;
}
