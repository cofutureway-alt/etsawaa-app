// H-21/H-22/H-23 live evidence: login, addresses page (prefill + dependent areas +
// pin badge + map), checkout (saved-address alternate prefill + saved pin reuse),
// API filter + invalid pair rejection (server-side).
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
const PASS = process.env.TEST_ADMIN_PASSWORD ?? "";
const OUT = "evidence/phase-08.5/screens";
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

// login through the real form
await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
await page.type("input[name=identifier]", EMAIL);
await page.type("input[name=password]", PASS);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => null),
  page.click("button[type=submit]"),
]);
console.log("logged-in url:", page.url());

// ---------- 1) addresses page: cards + pin badge presence ----------
await page.goto(`${BASE}/ar/account/addresses`, { waitUntil: "networkidle0" });
await page.screenshot({ path: `${OUT}/h21-addresses-cards-390.png` });

// open the ADD dialog — fields must be PREFILLED from the profile (H-21)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  btns.find((b) => /إضافة عنوان|إضافة|أضف|add/i.test(b.textContent ?? ""))?.click();
});
await new Promise((r) => setTimeout(r, 900));
const prefilled = await page.evaluate(() => {
  const name = document.querySelector("input[name=full_name]")?.value ?? "";
  const phone = document.querySelector("input[name=phone]")?.value ?? "";
  const alt = document.querySelector("input[name=phone_alternate]")?.value ?? "";
  const emailTxt = document.body.innerText.includes("@gmail.com");
  return { name, phone, alt, emailTxt };
});
console.log("H21 prefill:", JSON.stringify(prefilled));
await page.screenshot({ path: `${OUT}/h21-add-prefilled-390.png` });

// ---------- 2) dependent areas: choose a governorate → area select enables (H-22) ----------
const areaFlow = await page.evaluate(async () => {
  const gov = document.querySelector("select[name=governorate_id]");
  const area = document.querySelector("select[name=area_id]");
  if (!gov || !area) return { found: false };
  const before = { areaDisabled: area.disabled, opts: area.options.length };
  gov.value = gov.options[1].value;
  gov.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  const areaNow = document.querySelector("select[name=area_id]");
  const after = {
    areaDisabled: areaNow.disabled,
    opts: areaNow.options.length,
    placeholder: areaNow.options[0]?.textContent ?? "",
  };
  return { found: true, before, after };
});
console.log("H22 dependent areas:", JSON.stringify(areaFlow));
await page.screenshot({ path: `${OUT}/h22-areas-loaded-390.png` });

// ---------- 3) close dialog, reopen via EDIT on an existing card (if any) ----------
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 400));
const editInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const edit = btns.find((b) => /تعديل|edit/i.test(b.textContent ?? ""));
  if (!edit) return { hasAddress: false };
  edit.click();
  return { hasAddress: true };
});
console.log("edit dialog:", JSON.stringify(editInfo));
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}/h22-edit-dialog-390.png` });

// ---------- 4) checkout: saved-address alternate prefill + pin reuse (H-21/H-23) ----------
await page.goto(`${BASE}/ar/checkout`, { waitUntil: "networkidle0" });
const checkout = await page.evaluate(() => {
  const alt = document.querySelector("input#ck-phone2-saved")?.value ?? document.querySelector("input#ck-phone2")?.value ?? null;
  const pinBadge = [...document.querySelectorAll("span")].some((s) => /تم تحديد الموقع/.test(s.textContent ?? ""));
  return { alt, pinBadge, url: location.pathname };
});
console.log("checkout state:", JSON.stringify(checkout));
await page.screenshot({ path: `${OUT}/h23-checkout-step1-390.png` });

// ---------- 5) widths matrix on the addresses page ----------
for (const w of [768, 1280, 1440]) {
  await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/ar/account/addresses`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: `${OUT}/h21-addresses-${w}.png` });
  const metrics = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(`width ${w}:`, JSON.stringify(metrics));
}

// ---------- 6) server rejects mismatched gov/area pair (H-22 AC) ----------
const cookies = await page.cookies();
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const bad = await fetch(`${BASE}/ar/account/addresses`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
  body: new URLSearchParams({
    intent: "save", full_name: "اختبار", phone: "01050073086", phone_alternate: "011150073086",
    governorate_id: "1", area_id: "30", // area 30 belongs to a different governorate
    address1: "شارع الاختبار 1", lat: "", lng: "", geo_accuracy: "",
  }),
  redirect: "manual",
});
const badBody = await bad.text();
console.log("mismatched pair rejected:", bad.status, /\"area\"/.test(badBody) ? "(reason=area PASS)" : badBody.slice(0, 120));

// ---------- 7) invalid pin bounds rejected (H-23 AC) ----------
const badPin = await fetch(`${BASE}/ar/account/addresses`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
  body: new URLSearchParams({
    intent: "save", full_name: "اختبار", phone: "01050073086", phone_alternate: "011150073086",
    governorate_id: "1", area_id: "22",
    address1: "شارع الاختبار 1", lat: "55.0", lng: "200.0", geo_accuracy: "",
  }),
  redirect: "manual",
});
const badPinBody = await badPin.text();
console.log("out-of-bounds pin rejected:", badPin.status, /\"pin\"/.test(badPinBody) ? "(reason=pin PASS)" : badPinBody.slice(0, 120));

await browser.close();
console.log("DONE");
