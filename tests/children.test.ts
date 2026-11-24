import { test } from "node:test";
import assert from "node:assert/strict";
import { addVariant, childProblems, childrenFromLoader, childrenPayload, emptyChild, isBaseOffer, isPlainChild, nextConfigRow, nextVariant, packSizesForForm, type SizeOption } from "../app/features/products/components/wizard/children.ts";

test("a new product has no variant and counts as the base offer (price + stock only)", () => {
  assert.equal(isBaseOffer([]), true);
  const base = { ...emptyChild(false), price: "100" };
  assert.equal(isPlainChild(base), true);
  assert.equal(isBaseOffer([base]), true);
});

test("a single child keeps its colour / sizes inside the base offer", () => {
  const coloured = { ...emptyChild(false, "c1"), price: "100" };
  assert.equal(isBaseOffer([coloured]), true);
  const sized = { ...emptyChild(true), sizes: [{ size_option_id: "s1", stock: "3", sku: null }] };
  assert.equal(isBaseOffer([sized]), true);
  // one colour in several sizes is still the base offer
  const three = ["s1", "s2", "s3"].map((size_option_id) => ({ size_option_id, stock: "1", sku: null }));
  assert.equal(isBaseOffer([{ ...sized, sizes: three }]), true);
  // two children mean real variants
  assert.equal(isBaseOffer([emptyChild(false), emptyChild(false)]), false);
});

test("Add variant keeps a filled base offer (colour, sizes, price, stock) as variant 1", () => {
  const sizes = [{ size_option_id: "s1", stock: "5", sku: null }, { size_option_id: "s2", stock: "2", sku: null }];
  const base = { ...emptyChild(true, "c1"), price: "100", sizes };
  const next = addVariant([base], true);
  assert.equal(next.length, 2);
  assert.equal(next[0], base);
  assert.equal(next[0]!.color_option_id, "c1");
  assert.deepEqual(next[0]!.sizes, sizes);
  // an empty / missing base just becomes the first variant
  assert.equal(addVariant([], false).length, 1);
  assert.equal(addVariant([emptyChild(false)], false).length, 1);
});

test("base offer: several rows must all name their size; a lone blank row stays optional", () => {
  const base = { ...emptyChild(true, "black"), price: "100" };
  const oneBlank = { ...base, sizes: [{ size_option_id: "37", stock: "1", sku: null }, { size_option_id: "", stock: "2", sku: null }] };
  assert.ok(childProblems(oneBlank, [oneBlank], true, true).includes("children.err.sizes"));
  const allSized = { ...base, sizes: [{ size_option_id: "37", stock: "1", sku: null }, { size_option_id: "38", stock: "2", sku: null }] };
  assert.equal(childProblems(allSized, [allSized], true, true).includes("children.err.sizes"), false);
  const singleBlank = { ...base, sizes: [{ size_option_id: "", stock: "2", sku: null }] };
  assert.equal(childProblems(singleBlank, [singleBlank], true, true).includes("children.err.sizes"), false);
});

test("no variants: colour + size are optional, only price + stock are required", () => {
  const plain = { ...emptyChild(true), price: "50" };
  assert.deepEqual(childProblems(plain, [plain], true, true), []);
  const coloured = { ...emptyChild(true, "red"), price: "50", sizes: [{ size_option_id: "m", stock: "2", sku: null }] };
  assert.deepEqual(childProblems(coloured, [coloured], true, true), []);
  const noPrice = emptyChild(true);
  assert.ok(childProblems(noPrice, [noPrice], true, true).includes("children.err.price"));
});

test("pack sizes follow the product form: powder → g/kg, liquid → mL/L, none → all", () => {
  const size = (code: string): SizeOption => ({ option_id: code, code, label_ar: code, label_en: code, size_type_id: "t", type_name_ar: "", type_name_en: "" });
  const sizes = [size("wt_1000g"), size("wt_9000g"), size("vol_1000ml"), size("size_m")];
  const template = [{ id: "f", code: "detergent_form", options: [{ id: "p", code: "powder" }, { id: "l", code: "liquid" }, { id: "o", code: "other" }] }];
  const codes = (list: SizeOption[]) => list.map((s) => s.code);
  assert.deepEqual(codes(packSizesForForm(sizes, template, { f: { option_id: "p" } })), ["wt_1000g", "wt_9000g", "size_m"]);
  assert.deepEqual(codes(packSizesForForm(sizes, template, { f: { option_id: "l" } })), ["vol_1000ml", "size_m"]);
  assert.equal(packSizesForForm(sizes, template, {}).length, 4);
  assert.equal(packSizesForForm(sizes, template, { f: { option_id: "o" } }).length, 4);
  // cookware diameter / capacity sizes are never filtered by the powder/liquid form
  const cookware = [size("dia_28cm"), size("cap_5l")];
  assert.deepEqual(codes(packSizesForForm(cookware, template, { f: { option_id: "p" } })), ["dia_28cm", "cap_5l"]);
});

test("childProblems: a plain variant next to coloured / sized ones is flagged", () => {
  const plain = { ...emptyChild(true), price: "399", sizes: [{ size_option_id: "", stock: "50", sku: null }] };
  const black = { ...emptyChild(true, "black"), price: "399", sizes: [{ size_option_id: "m", stock: "1", sku: null }] };
  const probs = childProblems(plain, [plain, black], true, true);
  assert.ok(probs.includes("children.err.color"));
  assert.ok(probs.includes("children.err.sizes"));
  assert.deepEqual(childProblems(black, [plain, black], true, true), []);
  // a single plain variant (no variants at all) stays fine
  assert.deepEqual(childProblems(plain, [plain], true, true), []);
});

test("variants must carry the category's options and never repeat a colour", () => {
  const v = (color: string, size: string) => ({ ...emptyChild(true, color), price: "100", sizes: [{ size_option_id: size, stock: "2", sku: null }] });
  const a = v("red", "m"), b = v("", "l"), c = v("red", "s");
  assert.ok(childProblems(b, [a, b], true, true).includes("children.err.color"));
  assert.ok(childProblems(c, [a, c], true, true).includes("children.err.colorTaken"));
  // size-only category: no colour asked for
  const s1 = v("", "m"), s2 = v("", "l");
  assert.deepEqual(childProblems(s2, [s1, s2], false, true), []);
  const noSize = v("blue", "");
  assert.ok(childProblems(noSize, [a, noSize], true, true).includes("children.err.sizes"));
});

test("a new variant inherits the previous price, sale price and window", () => {
  const prev = { ...emptyChild(true, "red"), price: "350", sale_price: "300", sale_starts_at: "2026-11-10T10:00", sale_ends_at: "2026-11-20T10:00" };
  const next = nextVariant([prev], true);
  assert.equal(next.price, "350");
  assert.equal(next.sale_price, "300");
  assert.equal(next.sale_ends_at, "2026-11-20T10:00");
  assert.equal(next.color_option_id, "");
  assert.equal(addVariant([prev], true)[1]!.price, "350");
});

test("phones: each storage + RAM row has its own price; RAM required; no repeated row", () => {
  const mode = { config: true, hasRam: true };
  const row = (size: string, ram: string, price: string) => ({ size_option_id: size, ram_option_id: ram, stock: "3", sku: null, price, sale_price: "" });
  const black = { ...emptyChild(true, "black"), sizes: [row("s128", "r8", "15000"), row("s256", "r8", "18000")] };
  const blue = { ...emptyChild(true, "blue"), sizes: [row("s128", "", "15000")] };
  assert.deepEqual(childProblems(black, [black, blue], true, true, mode), []);
  assert.ok(childProblems(blue, [black, blue], true, true, mode).includes("children.err.ram"));
  const dup = { ...black, sizes: [row("s128", "r8", "1"), row("s128", "r8", "2")] };
  assert.ok(childProblems(dup, [dup, blue], true, true, mode).includes("children.err.rowDuplicate"));
  const noPrice = { ...black, sizes: [row("s128", "r8", "")] };
  assert.ok(childProblems(noPrice, [noPrice, blue], true, true, mode).includes("children.err.rowPrice"));
  // the payload sends each row's price and RAM
  const sent = childrenPayload([black])[0]!.sizes;
  assert.equal(sent[1]!.price_piastres, 1800000);
  assert.equal(sent[0]!.ram_option_id, "r8");
  // a new row starts at the previous row's price
  assert.equal(nextConfigRow(black.sizes).price, "18000");
});

test("phones: a lone base-offer configuration row still needs storage, RAM, price and stock", () => {
  const mode = { config: true, hasRam: true };
  const row = { size_option_id: "s128", ram_option_id: "r8", stock: "3", sku: null, price: "15000", sale_price: "" };
  const base = { ...emptyChild(true), sizes: [row] };
  assert.deepEqual(childProblems(base, [base], true, true, mode), []);
  const noRam = { ...base, sizes: [{ ...row, ram_option_id: "" }] };
  assert.ok(childProblems(noRam, [noRam], true, true, mode).includes("children.err.ram"));
  const noStorage = { ...base, sizes: [{ ...row, size_option_id: "" }] };
  assert.ok(childProblems(noStorage, [noStorage], true, true, mode).includes("children.err.sizes"));
  const noPrice = { ...base, sizes: [{ ...row, price: "" }] };
  assert.ok(childProblems(noPrice, [noPrice], true, true, mode).includes("children.err.rowPrice"));
});

test("pack sizes: each size may have its own price and discount; empty = the variant's", () => {
  const row = (size: string, price = "", sale = "") => ({ size_option_id: size, stock: "5", sku: null, price, sale_price: sale });
  // 150 mL at the regular price, 250 mL priced apart with its own discount
  const perfume = { ...emptyChild(true), price: "200", sale_price: "180", sizes: [row("v150"), row("v250", "300", "270")] };
  assert.deepEqual(childProblems(perfume, [perfume], false, true), []);
  const sent = childrenPayload([perfume])[0]!;
  assert.equal(sent.price_piastres, 20000);
  assert.equal(sent.sale_price_piastres, 18000);
  assert.equal("price_piastres" in sent.sizes[0]!, false); // takes the variant's price and discount
  assert.equal(sent.sizes[1]!.price_piastres, 30000);
  assert.equal(sent.sizes[1]!.sale_price_piastres, 27000);
  // a size with its own price and no discount of its own sells at its price
  const noSale = { ...perfume, sizes: [row("v150"), row("v250", "300")] };
  assert.equal(childrenPayload([noSale])[0]!.sizes[1]!.sale_price_piastres, null);
});

test("pack sizes: the regular price may stay empty once every size has its own", () => {
  const row = (size: string, price = "", sale = "") => ({ size_option_id: size, stock: "5", sku: null, price, sale_price: sale });
  const all = { ...emptyChild(true), sizes: [row("v150", "200"), row("v250", "300")] };
  assert.deepEqual(childProblems(all, [all], false, true), []);
  assert.equal(childrenPayload([all])[0]!.price_piastres, 20000); // the variant stands at its lowest price
  const some = { ...all, sizes: [row("v150", "200"), row("v250")] };
  assert.ok(childProblems(some, [some], false, true).includes("children.err.price"));
});

test("pack sizes: a wrong size price or a discount above it is flagged", () => {
  const row = (size: string, price = "", sale = "") => ({ size_option_id: size, stock: "5", sku: null, price, sale_price: sale });
  const zero = { ...emptyChild(true), price: "200", sizes: [row("v150", "0"), row("v250")] };
  assert.ok(childProblems(zero, [zero], false, true).includes("children.err.sizePrice"));
  const high = { ...emptyChild(true), price: "200", sizes: [row("v150"), row("v250", "300", "320")] };
  assert.ok(childProblems(high, [high], false, true).includes("children.err.sale"));
  // a discount on a size without its own price must stay below the regular price
  const onBase = { ...emptyChild(true), price: "200", sizes: [row("v150", "", "250"), row("v250")] };
  assert.ok(childProblems(onBase, [onBase], false, true).includes("children.err.sale"));
});

test("pack sizes: a saved size keeps its own price and discount when the form opens again", () => {
  const loaded = childrenFromLoader([{
    id: "g1", color_option_id: null, price_piastres: 20000, sale_price_piastres: 18000, sale_starts_at: null, sale_ends_at: null, images: [],
    sizes: [
      { size_option_id: "v150", stock: 5, sku: "A", price_piastres: 20000, sale_price_piastres: 18000 },
      { size_option_id: "v250", stock: 5, sku: "B", price_piastres: 30000, sale_price_piastres: null },
      { size_option_id: "v500", stock: 5, sku: "C", price_piastres: 20000, sale_price_piastres: 15000 },
    ],
  } as never], true)[0]!;
  assert.deepEqual(loaded.sizes.map((s) => [s.price, s.sale_price]), [["", ""], ["300", ""], ["", "150"]]);
});
