// H-21…H-23 final UI proof: drive the dialog with native-setter + React change
// events (works with controlled inputs regardless of scroll/overlay).
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 150)));

await page.goto("http://localhost:3000/ar/auth/login", { waitUntil: "networkidle0" });
await page.type("input[name=identifier]", process.env.TEST_ADMIN_EMAIL ?? "");
await page.type("input[name=password]", process.env.TEST_ADMIN_PASSWORD ?? "");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click("button[type=submit]")]);

await page.goto("http://localhost:3000/ar/account/addresses", { waitUntil: "networkidle0" });
const cardsBefore = await page.evaluate(() => document.querySelectorAll("li.rounded-l").length);

await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("إضافة عنوان"))?.click(); });
await new Promise((r) => setTimeout(r, 1100));

// --- H-21 prefill assertion (before touching anything) ---
const prefill = await page.evaluate(() => ({
  name: document.querySelector("[name=full_name]")?.value ?? "",
  phone: document.querySelector("[name=phone]")?.value ?? "",
  alt: document.querySelector("[name=phone_alternate]")?.value ?? "",
}));
console.log("H21 prefill:", JSON.stringify(prefill));

const setField = (name, value) =>
  page.evaluate(({ name, value }) => {
    const el = document.querySelector(`[name=${name}]`);
    if (!el) throw new Error("missing " + name);
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { name, value });

await setField("full_name", "عنوان برهان آخر");
await setField("phone", "01225007308");       // valid Egyptian 11-digit mobile
// alternate stays PREFILLED from the profile (+201115007308) — proves H-21
await setField("governorate_id", "1");
await new Promise((r) => setTimeout(r, 1200));  // H-22 dependent fetch
const areas = await page.evaluate(() => {
  const s = document.querySelector("[name=area_id]");
  return { disabled: s.disabled, count: s.options.length, first: s.options[1]?.textContent };
});
await setField("area_id", "35");
await setField("address1", "٩ شارع ٩، المعادي");

await page.evaluate(() => { [...document.querySelectorAll("button[type=submit]")].find((b) => b.textContent?.includes("حفظ"))?.click(); });
await new Promise((r) => setTimeout(r, 2200));
const saved = await page.evaluate(() => ({
  dialogOpen: !!document.querySelector("[name=full_name]"),
  cards: document.querySelectorAll("li.rounded-l").length,
  alerts: [...document.querySelectorAll("[role=alert]")].map((a) => (a.textContent ?? "").slice(0, 70)).filter(Boolean),
}));
console.log("H22 dependent:", JSON.stringify(areas));
console.log("valid save:", JSON.stringify({ cardsBefore, ...saved }));
await page.screenshot({ path: "evidence/phase-08.5/screens/h21-valid-save-390.png" });

// --- alternate == primary must be rejected inline ---
await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("إضافة عنوان"))?.click(); });
await new Promise((r) => setTimeout(r, 1100));
await setField("full_name", "اختبار التكرار");
await setField("phone", "01115007308");
await setField("phone_alternate", "01115007308"); // يساوي الأساسي
await setField("governorate_id", "1");
await new Promise((r) => setTimeout(r, 900));
await setField("area_id", "22");
await setField("address1", "شارع اختبار التكرار");
await page.evaluate(() => { [...document.querySelectorAll("button[type=submit]")].find((b) => b.textContent?.includes("حفظ"))?.click(); });
await new Promise((r) => setTimeout(r, 2000));
const eq = await page.evaluate(() => ({
  dialogOpen: !!document.querySelector("[name=full_name]"),
  alerts: [...document.querySelectorAll("[role=alert]")].map((a) => (a.textContent ?? "").slice(0, 70)).filter(Boolean),
}));
console.log("alternate == primary:", JSON.stringify(eq));
await page.screenshot({ path: "evidence/phase-08.5/screens/h21-phones-equal-390.png" });

await browser.close();
console.log("DONE");
