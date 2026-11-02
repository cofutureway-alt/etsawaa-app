// H-01 evidence — account redesign screenshots at 4 widths
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3000";
const OUT = "evidence/phase-08.5/screens";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle2" });
await page.type('input[name="identifier"]', process.env.TEST_ADMIN_EMAIL ?? "");
await page.type('input[name="password"]', process.env.TEST_ADMIN_PASSWORD ?? "");
await Promise.all([
  page.click('button[type="submit"]'),
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
]);
console.log("after login:", page.url());

for (const w of [390, 768, 1280, 1440]) {
  await page.setViewport({ width: w, height: Math.round(w * 1.8) });
  await page.goto(`${BASE}/ar/account`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/account-overview-${w}.png` });
  console.log("shot", w);
}
await page.setViewport({ width: 1280, height: 1200 });
await page.goto(`${BASE}/ar/account/orders`, { waitUntil: "networkidle2" });
await page.screenshot({ path: `${OUT}/account-orders-1280.png` });
await browser.close();
console.log("done");
