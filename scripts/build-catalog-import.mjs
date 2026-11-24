// ============================================================================
// Etsawaa — Phase 09 catalog + geography import (direct to production tables)
//
// Reads data/normalized/*.json (the owner's master sheets, normalized) and
// writes ONE transactional SQL file: supabase/seed/catalog-import.sql.
// Apply it with psql as `postgres` (SQL-level work is not audited):
//   node scripts/build-catalog-import.mjs
//   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < catalog-import.sql
//
// Model (migration 20261103000015_catalog_types_dictionary.sql):
//   L1 → L2 → L3 browse categories → L4 product type (one node per source
//   placement; a type listed under two L3s gets a node under each)
//   specs → global attribute_defs (category_id NULL), Brand excluded
//   template of a type → category_attributes rows (type node → spec, ordered)
//   Color / Size → filterable variant-axis attributes with option dictionaries
//   governorates (shipping 100 EGP) + areas (pickup 20 EGP)
//
// Idempotent and non-destructive: every insert is ON CONFLICT DO NOTHING on a
// natural key (categories.source_key, global attribute code, option code,
// link pair, area name per governorate). Re-running inserts 0 rows and never
// overwrites edits made later in the admin. Fees are only filled where still
// 0 (the placeholder seed). A final check raises — rolling the whole
// transaction back — if any count differs from the source.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data", "normalized");
const OUT = path.join(ROOT, "supabase", "seed", "catalog-import.sql");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const cats = read("categories.json");
const specs = read("specs.json");
const groups = read("groups.json");
const templates = read("product_templates.json");
const shared = read("shared_products.json");
const govs = read("areas.json");

// ------------------------------------------------------------------ helpers
const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[ً-ْـ،؛؟]/g, "")
    .replace(/[^a-z0-9ء-ي٠-٩]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";

/** attribute/option code: ^[a-z0-9_]{2,40}$ */
const codeOf = (s) => {
  let c = String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (c.length < 2) c = `a_${c}`;
  if (c.length > 40) c = `${c.slice(0, 33)}_${crypto.createHash("sha1").update(c).digest("hex").slice(0, 6)}`;
  return c;
};

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const normAr = (s) =>
  String(s).replace(/[ً-ْـ\s]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

const rejects = [];

// --------------------------------------------------------------- dictionary
// Specs missing from specs.json but used by the 399 family templates. EN is
// the template's own field name; AR translated for this import (flagged in
// the report for owner review). Types: number only where the value is a count.
const NEW_SPECS = {
  "Occasion": ["المناسبة"], "Care Instructions": ["تعليمات العناية"], "Heat Source": ["مصدر الحرارة"],
  "Non-stick": ["غير لاصق"], "Pieces Count": ["عدد القطع", "number"], "Safety Certification": ["شهادة الأمان"],
  "Weight Capacity": ["الحمولة القصوى"], "Chuck Size": ["مقاس رأس المثقاب"], "Speed": ["السرعة"],
  "Included Bits": ["اللقم المرفقة"], "Sport": ["الرياضة"], "Level": ["المستوى"], "Language": ["اللغة"],
  "Format": ["الصيغة"], "Pages": ["عدد الصفحات", "number"], "Publisher": ["الناشر"], "Binding": ["نوع التجليد"],
  "ISBN": ["الرقم الدولي المعياري (ISBN)"], "Compatibility": ["التوافق"], "Power Output": ["القدرة الخارجة"],
  "Metal Purity": ["عيار المعدن"], "Print Color": ["لون الطباعة"], "Max Paper Size": ["أقصى مقاس للورق"],
  "Print Speed": ["سرعة الطباعة"], "Scanner Type": ["نوع الماسح الضوئي"], "Duplex": ["الطباعة على الوجهين"],
  "Ink or Toner Type": ["نوع الحبر أو التونر"], "Type": ["النوع"], "Skin Type": ["نوع البشرة"], "Volume": ["الحجم"],
  "Ingredients": ["المكونات"], "Shade": ["الدرجة اللونية"], "Formulation": ["التركيبة"],
  "SPF": ["عامل الحماية من الشمس (SPF)", "number"], "Made In": ["بلد الصنع"], "Storage": ["سعة التخزين"],
  "Graphics": ["معالج الرسومات"], "Ports": ["المنافذ"], "Platform": ["المنصة"], "Controller Included": ["يد التحكم مرفقة"],
  "Assembly Required": ["يتطلب التركيب"], "Driver Size": ["قطر مكبر الصوت"], "Frequency Response": ["الاستجابة الترددية"],
  "Display Size": ["حجم الشاشة"], "HDR": ["دعم HDR"], "String Count": ["عدد الأوتار", "number"],
  "Fretboard Material": ["خامة لوحة الأصابع"], "Pickup Type": ["نوع اللاقط"], "Accessories Included": ["الملحقات المرفقة"],
  "Frequency Band": ["نطاق التردد"], "Max Speed": ["السرعة القصوى"], "Antenna Count": ["عدد الهوائيات", "number"],
  "Security": ["الأمان"], "Pet Type": ["نوع الحيوان الأليف"], "Features": ["المميزات"], "Surface": ["نوع السطح"],
  "Scent": ["الرائحة"], "Max Load": ["الحمل الأقصى"], "Outlets": ["عدد المخارج", "number"], "Protocol": ["البروتوكول"],
  "Energy Rating": ["تصنيف كفاءة الطاقة"], "Programs": ["البرامج"], "Weight or Volume": ["الوزن أو الحجم"],
  "Packaging": ["التغليف"], "Origin": ["المنشأ"], "Position": ["الموضع"], "Lumen": ["شدة الإضاءة (لومن)"],
  "Base Type": ["نوع القاعدة"], "Personalization": ["التخصيص"], "Recyclable": ["قابل لإعادة التدوير"],
};

// Variant axes. Values are dictionaries the admin edits; vendors only pick.
const COLORS = [
  ["black", "Black", "أسود", "#000000"], ["white", "White", "أبيض", "#FFFFFF"], ["gray", "Gray", "رمادي", "#808080"],
  ["silver", "Silver", "فضي", "#C0C0C0"], ["red", "Red", "أحمر", "#D32F2F"], ["burgundy", "Burgundy", "نبيتي", "#800020"],
  ["pink", "Pink", "وردي", "#F48FB1"], ["purple", "Purple", "بنفسجي", "#7B1FA2"], ["blue", "Blue", "أزرق", "#1976D2"],
  ["navy", "Navy", "كحلي", "#1A237E"], ["light_blue", "Light Blue", "لبني", "#81D4FA"], ["turquoise", "Turquoise", "تركواز", "#40E0D0"],
  ["green", "Green", "أخضر", "#388E3C"], ["olive", "Olive", "زيتي", "#808000"], ["yellow", "Yellow", "أصفر", "#FBC02D"],
  ["orange", "Orange", "برتقالي", "#F57C00"], ["brown", "Brown", "بني", "#6D4C41"], ["beige", "Beige", "بيج", "#D7CCC8"],
  ["khaki", "Khaki", "كاكي", "#C3B091"], ["gold", "Gold", "ذهبي", "#D4AF37"], ["rose_gold", "Rose Gold", "روز جولد", "#B76E79"],
  ["multicolor", "Multicolor", "متعدد الألوان", null], ["transparent", "Transparent", "شفاف", null],
];
const SIZES = [
  ...["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"].map((s) => [`size_${s.toLowerCase()}`, s, s]),
  ["free_size", "Free Size", "مقاس واحد"],
  ...Array.from({ length: 13 }, (_, i) => [`eu_${35 + i}`, `EU ${35 + i}`, `${35 + i}`]),
  ["bed_single", "Single", "مفرد"], ["bed_double", "Double", "مزدوج"], ["bed_queen", "Queen", "كوين"], ["bed_king", "King", "كينج"],
];

const dict = new Map(); // lower EN name -> {code,...}
const usedCodes = new Set();
const addSpec = (en, ar, type, unit, extra = {}) => {
  let code = codeOf(en);
  for (let i = 2; usedCodes.has(code); i++) code = `${codeOf(en).slice(0, 36)}_${i}`;
  usedCodes.add(code);
  const row = { code, en, ar, type, unit, is_variant_axis: false, is_filterable: false, sort: dict.size + 1, ...extra };
  dict.set(en.trim().toLowerCase(), row);
  return row;
};
for (const s of specs) {
  if (/^brand$/i.test(s.en.trim())) { rejects.push({ dataset: "specs", reason: "brand_is_not_a_spec", row: s.en }); continue; }
  const lower = s.en.trim().toLowerCase();
  const unit = s.unit_en && s.unit_en !== "—" ? s.unit_en : "";
  if (lower === "color") addSpec("Color", s.ar || "اللون", "color", "", { is_variant_axis: true, is_filterable: true });
  else if (lower === "size") addSpec("Size", s.ar || "المقاس", "enum", "", { is_variant_axis: true, is_filterable: true });
  else addSpec(s.en.trim(), s.ar ?? "", s.type === "number" ? "number" : "text", unit);
}
const dictFromSource = dict.size;
for (const [en, [ar, type]] of Object.entries(NEW_SPECS)) {
  if (dict.has(en.toLowerCase())) throw new Error(`NEW_SPECS entry already in dictionary: ${en}`);
  addSpec(en, ar, type ?? "text", "");
}

// ------------------------------------------------------------ category tree
const usedSlugEn = new Set();
const usedSlugAr = new Set();
const uniqueSlug = (used, base, prefix) => {
  let s = base;
  if (used.has(s) && prefix) s = `${prefix}-${base}`;
  for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
  used.add(s);
  return s;
};
const nodes = new Map(); // source_key -> node
const addNode = (key, parentKey, depth, en, ar) => {
  if (nodes.has(key)) return nodes.get(key);
  const parent = parentKey ? nodes.get(parentKey) : null;
  const node = {
    key, parentKey, depth, en, ar: ar || en,
    slug_en: uniqueSlug(usedSlugEn, slugify(en), parent?.slug_en),
    slug_ar: uniqueSlug(usedSlugAr, slugify(ar || en), parent?.slug_ar),
    sort: nodes.size + 1,
  };
  nodes.set(key, node);
  return node;
};
for (const r of cats) {
  const k1 = slugify(r.l1), k2 = `${k1}/${slugify(r.l2)}`, k3 = `${k2}/${slugify(r.l3)}`, k4 = `${k3}/${slugify(r.type)}`;
  addNode(k1, null, 1, r.l1, r.l1_ar);
  addNode(k2, k1, 2, r.l2, r.l2_ar);
  addNode(k3, k2, 3, r.l3, r.l3_ar);
  if (nodes.has(k4)) { rejects.push({ dataset: "categories", reason: "duplicate_type_placement", row: k4 }); continue; }
  addNode(k4, k3, 4, r.type, r.type_ar);
}
const byDepth = (d) => [...nodes.values()].filter((n) => n.depth === d);

// ---------------------------------------------------------------- templates
const groupFields = new Map(groups.map((g) => [g.name, g.specs]));
const tplByType = new Map(templates.map((t) => [t.type, t]));
const links = [];
const unresolved = new Map();
for (const n of byDepth(4)) {
  const t = tplByType.get(n.en);
  if (!t) throw new Error(`no template for type ${n.en}`);
  const fields = t.source === "exact" ? groupFields.get(t.group) ?? [] : t.fields ?? [];
  const seen = new Set();
  let sort = 0;
  for (const f of fields) {
    if (/^brand$/i.test(f.trim())) continue;
    const spec = dict.get(f.trim().toLowerCase());
    if (!spec) { unresolved.set(f, (unresolved.get(f) ?? 0) + 1); continue; }
    if (seen.has(spec.code)) continue;
    seen.add(spec.code);
    links.push({ cat: n.key, code: spec.code, sort: sort++ });
  }
  if (seen.size === 0) throw new Error(`zero-field template for ${n.en}`);
}
if (unresolved.size) throw new Error(`unresolved template fields: ${[...unresolved.keys()].join(", ")}`);

// shared products: every listed L3 placement must exist as a type node
const sharedCheck = { types: shared.length, missingPlacements: [] };
for (const s of shared) {
  const placements = [...nodes.values()].filter((n) => n.depth === 4 && n.en === s.type_en);
  if (placements.length === 0) sharedCheck.missingPlacements.push(s.type_en);
}

// ---------------------------------------------------------------- geography
const areas = [];
for (const [gi, g] of govs.entries()) {
  const seen = new Set();
  for (const [ai, a] of g.areas.entries()) {
    const k = normAr(a.ar);
    if (seen.has(k)) { rejects.push({ dataset: "areas", reason: "duplicate_area_name_in_governorate", row: `${g.en}/${a.ar}` }); continue; }
    seen.add(k);
    areas.push({ gov_ar: g.ar, gov_en: g.en, ship: Math.round(g.shipping_fee_egp * 100), name_ar: a.ar, name_en: a.en ?? "", fee: Math.round(a.pickup_fee_egp * 100), sort: gi * 1000 + ai });
  }
}

// ---------------------------------------------------------------- SQL emit
const values = (rows, cols) => rows.map((r) => `(${cols.map((c) => (typeof r[c] === "number" || typeof r[c] === "boolean" ? String(r[c]) : q(r[c]))).join(", ")})`).join(",\n");
const nodeRows = [...nodes.values()];
const dictRows = [...dict.values()];
const optRows = [
  ...COLORS.map(([code, en, ar, hex], i) => ({ attr: dict.get("color").code, code, en, ar, hex, sort: i })),
  ...SIZES.map(([code, en, ar], i) => ({ attr: dict.get("size").code, code, en, ar, hex: null, sort: i })),
];
const expected = {
  l1: byDepth(1).length, l2: byDepth(2).length, l3: byDepth(3).length, l4: byDepth(4).length,
  specs: dictRows.length, options: optRows.length, links: links.length, areas: areas.length, govs: govs.length,
};

const sql = `-- GENERATED by scripts/build-catalog-import.mjs — do not edit by hand.
-- Source: data/normalized/*.json · expected: ${JSON.stringify(expected)}
begin;
set local statement_timeout = 0;

create function pg_temp.norm_ar(t text) returns text language sql immutable as $f$
  select translate(regexp_replace(coalesce(t, ''), '[\\u064B-\\u0652\\u0640[:space:]]', '', 'g'), 'أإآةى', 'اااهي')
$f$;

-- ---------------------------------------------------------------- geography
create temp table _src_areas (gov_ar text, gov_en text, ship int, name_ar text, name_en text, fee int, sort int, gov_id smallint) on commit drop;
insert into _src_areas (gov_ar, gov_en, ship, name_ar, name_en, fee, sort) values
${values(areas, ["gov_ar", "gov_en", "ship", "name_ar", "name_en", "fee", "sort"])};
update _src_areas s set gov_id = g.id from public.governorates g
 where g.name_ar = s.gov_ar or g.name_en = s.gov_en or pg_temp.norm_ar(g.name_ar) = pg_temp.norm_ar(s.gov_ar);
do $$ begin
  if exists (select 1 from _src_areas where gov_id is null) then
    raise exception 'unmapped governorate(s): %', (select string_agg(distinct gov_en, ', ') from _src_areas where gov_id is null);
  end if;
end $$;
-- shipping fee only where still the 0 placeholder
update public.governorates g set shipping_fee_piastres = s.ship
  from (select distinct gov_id, ship from _src_areas) s
 where g.id = s.gov_id and g.shipping_fee_piastres = 0;
-- adopt existing rows spelled differently (hamza / taa marbuta / EN name)
update public.areas a set name_ar = s.name_ar
  from _src_areas s
 where a.governorate_id = s.gov_id and a.name_ar <> s.name_ar
   and (pg_temp.norm_ar(a.name_ar) = pg_temp.norm_ar(s.name_ar) or (a.name_en <> '' and lower(a.name_en) = lower(s.name_en)))
   and not exists (select 1 from public.areas x where x.governorate_id = s.gov_id and x.name_ar = s.name_ar);
insert into public.areas (governorate_id, name_ar, name_en, pickup_fee_piastres, is_active, sort)
select gov_id, name_ar, name_en, fee, true, sort from _src_areas
on conflict (governorate_id, name_ar) do update
  set pickup_fee_piastres = excluded.pickup_fee_piastres,
      name_en = case when areas.name_en = '' then excluded.name_en else areas.name_en end
  where areas.pickup_fee_piastres = 0;

-- ---------------------------------------------------------------- categories
create temp table _src_cats (source_key text primary key, parent_key text, depth int, name_ar text, name_en text, slug_ar text, slug_en text, sort int) on commit drop;
insert into _src_cats values
${values(nodeRows.map((n) => ({ ...n, name_ar: n.ar, name_en: n.en })), ["key", "parentKey", "depth", "name_ar", "name_en", "slug_ar", "slug_en", "sort"])};
${[1, 2, 3, 4].map((d) => `insert into public.categories (parent_id, source_key, name_ar, name_en, slug_ar, slug_en, sort)
select p.id, s.source_key, s.name_ar, s.name_en, s.slug_ar, s.slug_en, s.sort
  from _src_cats s left join public.categories p on p.source_key = s.parent_key
 where s.depth = ${d}
on conflict (source_key) where source_key is not null do nothing;`).join("\n")}

-- ---------------------------------------------------------------- dictionary
create temp table _src_specs (code text primary key, label_en text, label_ar text, type text, unit text, is_variant_axis boolean, is_filterable boolean, sort int) on commit drop;
insert into _src_specs values
${values(dictRows.map((r) => ({ ...r, label_en: r.en, label_ar: r.ar })), ["code", "label_en", "label_ar", "type", "unit", "is_variant_axis", "is_filterable", "sort"])};
insert into public.attribute_defs (category_id, code, label_en, label_ar, type, unit, is_variant_axis, is_filterable, is_required, sort)
select null, code, label_en, label_ar, type, unit, is_variant_axis, is_filterable, false, sort from _src_specs
on conflict (code) where category_id is null and deleted_at is null do nothing;

create temp table _src_opts (attr_code text, code text, label_en text, label_ar text, color_hex text, sort int) on commit drop;
insert into _src_opts values
${values(optRows.map((r) => ({ ...r, attr_code: r.attr, label_en: r.en, label_ar: r.ar, color_hex: r.hex })), ["attr_code", "code", "label_en", "label_ar", "color_hex", "sort"])};
insert into public.attribute_options (attribute_id, code, label_en, label_ar, color_hex, sort)
select d.id, o.code, o.label_en, o.label_ar, o.color_hex, o.sort
  from _src_opts o join public.attribute_defs d on d.code = o.attr_code and d.category_id is null and d.deleted_at is null
on conflict (attribute_id, code) do nothing;

-- ---------------------------------------------------------------- templates
create temp table _src_links (cat_key text, attr_code text, sort int) on commit drop;
insert into _src_links values
${values(links.map((l) => ({ cat_key: l.cat, attr_code: l.code, sort: l.sort })), ["cat_key", "attr_code", "sort"])};
insert into public.category_attributes (category_id, attribute_id, sort)
select c.id, d.id, l.sort
  from _src_links l
  join public.categories c on c.source_key = l.cat_key
  join public.attribute_defs d on d.code = l.attr_code and d.category_id is null and d.deleted_at is null
on conflict (category_id, attribute_id) do nothing;

-- ---------------------------------------------------------------- reconcile
do $$
declare v jsonb;
begin
  select jsonb_build_object(
    'l1', (select count(*) from public.categories c join _src_cats s using (source_key) where c.depth = 1),
    'l2', (select count(*) from public.categories c join _src_cats s using (source_key) where c.depth = 2),
    'l3', (select count(*) from public.categories c join _src_cats s using (source_key) where c.depth = 3),
    'l4', (select count(*) from public.categories c join _src_cats s using (source_key) where c.depth = 4),
    'specs', (select count(*) from public.attribute_defs d join _src_specs s using (code) where d.category_id is null and d.deleted_at is null),
    'options', (select count(*) from public.attribute_options o join public.attribute_defs d on d.id = o.attribute_id join _src_opts s on s.attr_code = d.code and s.code = o.code where d.category_id is null),
    'links', (select count(*) from _src_links l join public.categories c on c.source_key = l.cat_key join public.attribute_defs d on d.code = l.attr_code and d.category_id is null and d.deleted_at is null join public.category_attributes ca on ca.category_id = c.id and ca.attribute_id = d.id),
    'areas', (select count(*) from _src_areas s join public.areas a on a.governorate_id = s.gov_id and a.name_ar = s.name_ar),
    'govs', (select count(distinct gov_id) from _src_areas)
  ) into v;
  if v <> ${q(JSON.stringify(expected))}::jsonb then
    raise exception 'catalog import reconcile FAILED: got % expected %', v, ${q(JSON.stringify(expected))};
  end if;
  raise notice 'catalog import reconciled: %', v;
end $$;

commit;
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sql);
const report = {
  expected,
  dictionary: { from_specs_json: dictFromSource, added_for_family_templates: Object.keys(NEW_SPECS).length, variant_axes: ["color", "size"] },
  templates: { exact: templates.filter((t) => t.source === "exact").length, new_family: templates.filter((t) => t.source === "new_family").length },
  shared: sharedCheck,
  rejects,
};
fs.writeFileSync(path.join(ROOT, "data", "catalog-import-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${path.relative(ROOT, OUT)} (${(sql.length / 1024).toFixed(0)} KB)`);
