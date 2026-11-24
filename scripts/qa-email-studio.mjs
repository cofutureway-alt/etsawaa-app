import { createServer } from "vite";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";

// The harness mounts the real editor. Its actions are isolated in memory;
// database semantics are verified separately in a rolled-back SQL transaction.
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwind()], resolve: { alias: { "~": resolve("app") } }, server: { port: 5179, host: "127.0.0.1", strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://etsawaa.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/logo-transparent.png" || path.startsWith("/fonts/")) await route.fulfill({ path: resolve(`public${path}`) });
    else await route.abort();
  });
  await page.goto("http://127.0.0.1:5179/evidence/email-studio/studio-harness.html");
  await page.getByRole("heading", { name: "استوديو الإيميلات", exact: true }).waitFor();
  await page.locator("iframe").waitFor();
  await page.frameLocator("iframe").locator("h1").waitFor();
  await page.screenshot({ path: "evidence/email-studio/studio-ar-1600.png", fullPage: true });
  const subject = page.locator('input[name="subject"]');
  await subject.fill("تجربة "); await subject.focus();
  await page.getByTitle("{{name}}", { exact: true }).click();
  assert.equal(await subject.inputValue(), "تجربة {{name}}");
  await page.getByRole("button", { name: "حفظ مسودة", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "تم حفظ المسودة" }).waitFor();
  assert.ok(await page.getByText("كل تعديلاتك محفوظة", { exact: false }).count());
  await page.getByRole("button", { name: "نشر التعديلات", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "تم النشر" }).waitFor();
  // Toggle, then save: the editor must carry the updated optimistic-lock revision.
  await page.getByRole("button", { name: "إيقاف الإرسال", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "تم تحديث حالة الإرسال" }).waitFor();
  await subject.fill("مسودة غير منشورة");
  await page.getByRole("button", { name: "إرسال تجربة", exact: true }).click();
  await page.locator('input[type="email"]').fill("qa@example.com");
  await page.getByRole("button", { name: "إرسال المسودة الحالية", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "تم تسليم التجربة" }).waitFor();
  assert.equal(await page.evaluate(() => window.__emailTests.lastTest.ar.subject), "مسودة غير منشورة");
  await page.getByRole("button", { name: "حفظ مسودة", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "تم حفظ المسودة" }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  page.on("dialog", (d) => d.accept());
  const history = page.getByText("الإصدارات المنشورة", { exact: true }).locator("..").locator("select");
  await history.selectOption("2");
  await page.getByRole("button", { name: "استرجاع هذا الإصدار", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "تم استرجاع الإصدار" }).waitFor();
  assert.ok((await subject.inputValue()).includes("أهلًا"));
  await page.getByRole("tab", { name: "English", exact: true }).click();
  assert.ok((await subject.inputValue()).includes("Welcome"));
  results.push("Arabic editor, cursor insertion, draft/publish isolation, toggle revision, unsaved test and restore: PASS");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "evidence/email-studio/studio-ar-390.png", fullPage: true });
  await page.goto("http://127.0.0.1:5179/evidence/email-studio/studio-harness.html?lang=en");
  await page.getByRole("heading", { name: "Email studio", exact: true }).waitFor();
  await page.frameLocator("iframe").locator("h1").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "evidence/email-studio/studio-en-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "evidence/email-studio/studio-en-1440.png", fullPage: true });
  results.push("Both UI languages, desktop/mobile, no horizontal overflow: PASS");
  for (const locale of ["ar", "en"]) for (const width of [360, 600]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`http://127.0.0.1:5179/evidence/email-studio/order_confirmation-${locale}.html`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `evidence/email-studio/order-${locale}-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  results.push("Bilingual email frame at 360/600 px, no browser errors: PASS");
  console.log(results.join("\n"));
  writeFileSync("evidence/email-studio/browser-checks.json", JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); await server.close(); }
