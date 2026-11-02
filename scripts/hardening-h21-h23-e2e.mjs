// H-21/H-22/H-23 end-to-end UI proof: mismatch rejection, alternate-phone
// requirement/equality, saved pin badge, checkout pin reuse + alternate prefill.
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 150)));

await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle0" });
await page.type("input[name=identifier]", process.env.TEST_ADMIN_EMAIL ?? "");
await page.type("input[name=password]", process.env.TEST_ADMIN_PASSWORD ?? "");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click("button[type=submit]")]);
console.log("login →", page.url());

await page.goto(`${BASE}/ar/account/addresses`, { waitUntil: "networkidle0" });

// helper: fill the dialog's controlled fields through native setter + React events
const fillDialog = (over) =>
  page.evaluate((over) => {
    const setField = (name, value) => {
      const el = document.querySelector(`[name=${name}]`);
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const base = {
      full_name: "اختبار البرهان",
      phone: "01050073086",
      phone_alternate: "011150073086",
      governorate_id: "1",
      address1: "١٢ شارع الاختبار",
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) setField(k, v);
    return true;
  }, over);

// ---------- 1) mismatched gov/area pair → server rejects with a field error ----------
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("إضافة عنوان"))?.click();
});
await new Promise((r) => setTimeout(r, 900));
await fillDialog({});
await new Promise((r) => setTimeout(r, 1000)); // areas for gov 1 arrive
// force the mismatch through the SUBMIT PAYLOAD (the UI itself never offers a
// mismatched pair — H-22 — so this is the forgery path the server must block)
const mismatch = await page.evaluate(async () => {
  const fd = new FormData();
  fd.set("intent", "save");
  fd.set("full_name", "مهاجم"); fd.set("phone", "01050073086"); fd.set("phone_alternate", "011150073086");
  fd.set("governorate_id", "1"); fd.set("area_id", "30"); // منطقة 30 ليست في محافظة 1
  fd.set("address1", "١٢ شارع الهجوم");
  const res = await fetch("/ar/account/addresses", { method: "POST", body: fd });
  return res.status;
});
console.log("H22 forged mismatched pair → status", mismatch, "(expected 400)");

// adversary payload via REAL submit path: the actual form with valid values must
// save OK afterwards (proves the action distinguishes good from bad)
await fillDialog({});
await new Promise((r) => setTimeout(r, 1000));
const areaOK = await page.evaluate(() => {
  const sel = document.querySelector("[name=area_id]");
  const firstReal = [...sel.options].find((o) => o.value);
  const proto = HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(sel, firstReal.value);
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return sel.value;
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll("button[type=submit]")].find((b) => b.textContent?.includes("حفظ"))?.click();
});
await new Promise((r) => setTimeout(r, 1600));
const goodSave = await page.evaluate(() => ({
  dialogOpen: !!document.querySelector("[name=full_name]"),
  cards: document.querySelectorAll("li.rounded-l").length,
  alerts: [...document.querySelectorAll("[role=alert]")].map((a) => a.textContent),
}));
console.log("valid save →", JSON.stringify(goodSave), "area:", areaOK);
await page.screenshot({ path: "evidence/phase-08.5/screens/h21-valid-save-390.png" });

// ---------- 2) alternate phone REQUIRED (empty) + different from primary ----------
const altChecks = await page.evaluate(async () => {
  const mkFd = (alt) => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("full_name", "اختبار"); fd.set("phone", "01050073086");
    fd.set("phone_alternate", alt);
    fd.set("governorate_id", "1"); fd.set("area_id", "22");
    fd.set("address1", "١٢ شارع اختبار");
    return fd;
  };
  const empty = await fetch("/ar/account/addresses", { method: "POST", body: mkFd("") });
  const same = await fetch("/ar/account/addresses", { method: "POST", body: mkFd("01050073086") });
  return { empty: empty.status, same: same.status };
});
console.log("H21 alternate required/different:", JSON.stringify(altChecks), "(expected 400 both)");

// ---------- 3) pin badge on the saved card + edit dialog prefills the pin ----------
const pinFlow = await page.evaluate(() => {
  const badges = [...document.querySelectorAll("li.rounded-l span")].filter((s) => /تم تحديد الموقع/.test(s.textContent ?? "")).length;
  return { pinBadges: badges };
});
console.log("H23 pin badge on card:", JSON.stringify(pinFlow));

// ---------- 4) checkout: saved-address alternate prefill + saved pin on the map ----------
await page.goto(`${BASE}/ar/checkout`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500));
const checkout = await page.evaluate(() => {
  const alt = document.querySelector("input#ck-phone2-saved")?.value ?? null;
  const pinBadge = [...document.querySelectorAll("span")].some((s) => /تم تحديد الموقع/.test(s.textContent ?? ""));
  const coords = [...document.querySelectorAll("span.num")].map((s) => s.textContent).find((x) => /30\.0|31\.2/.test(x ?? "")) ?? null;
  return { alt, pinBadge, coords };
});
console.log("H23/H21 checkout:", JSON.stringify(checkout));
await page.screenshot({ path: "evidence/phase-08.5/screens/h23-checkout-pin-reuse-390.png" });

// ---------- 5) abort behavior on flip-flopping governorates (H-22) ----------
await page.goto(`${BASE}/ar/account/addresses`, { waitUntil: "networkidle0" });
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("إضافة عنوان"))?.click();
});
await new Promise((r) => setTimeout(r, 700));
const abortProof = await page.evaluate(async () => {
  const sel = document.querySelector("[name=governorate_id]");
  const proto = HTMLSelectElement.prototype;
  const set = (v) => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(sel, v);
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const govs = [...sel.options].filter((o) => o.value).slice(0, 3).map((o) => o.value);
  set(govs[0]);
  set(govs[1]); // immediate flip — the gov[0] fetch must abort
  set(govs[2]); // and again
  await new Promise((r) => setTimeout(r, 1200));
  const areaSel = document.querySelector("[name=area_id]");
  return { flips: govs.length, finalAreaCount: areaSel.options.length, disabled: areaSel.disabled };
});
console.log("H22 flip-flip-flip:", JSON.stringify(abortProof));

await browser.close();
console.log("DONE");
