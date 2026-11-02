/**
 * R3-2 — email-change OTP screen at 390 (plus a re-capture at 1280).
 * Standalone: creates one throwaway user, drives the REAL flow (profile →
 * email intent → updateUser → redirect to /auth/verify?type=email_change)
 * in Chrome, screenshots the 6-digit code-entry screen, then removes the
 * user. DB pristine at the end (no orders/products touched).
 * Reproduce: node --env-file=.env scripts/otp-screen-390.mjs (server :3000)
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import fs from "node:fs";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const STAMP = Date.now();
const PWD = "Vendor#12345";
const BASE = "http://localhost:3000";
const OUT = "evidence/phase-05/screens";

let failed = false;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}`);
  if (!cond) failed = true;
};

const emailOld = `p5s-otp-${STAMP}@etsawaa-e2e.com`;
const emailNew = `p5s-otp-new-${STAMP}@gmail.com`; // free-tier default mailer rejects .example.com as invalid
let createdId = null;
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const { data: u, error } = await svc.auth.admin.createUser({ email: emailOld, password: PWD, email_confirm: true });
  if (error) throw new Error(error.message);
  createdId = u.user.id;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  // log in through the real UI (same protocol as phase5-screens login)
  const login = async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/ar/auth/login`, { waitUntil: "networkidle" });
    await page.fill("input[name=identifier]", emailOld);
    await page.fill("input[name=password]", PWD);
    await page.click("button[type=submit]");
    await page.waitForTimeout(1800);
    await page.goto(`${BASE}/ar/account/profile`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/auth/login")) throw new Error("login failed");
  };
  await login();

  const requestChange = async () => {
    await page.fill("#pf-email", emailNew);
    await page.click("section:has(#pf-email) button[type=submit]");
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/ar/auth/verify?type=email_change&email=${encodeURIComponent(emailNew)}`, { waitUntil: "networkidle" });
  };

  await requestChange();
  await page.evaluate(() => document.fonts.ready);
  const cells = await page.locator("input[autocomplete=one-time-code]").count();
  check("OTP screen has 6 one-time-code cells", cells === 6, `${cells} cells`);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/ar/auth/verify?type=email_change&email=${encodeURIComponent(emailNew)}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const a1 = await page.evaluate(() => document.documentElement.clientWidth);
    const a2 = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`assert otp-screen@${width}`, a1 === width && a2 === a1, `${a1}/${a2}`);
    const file = `${OUT}/email-change-otp-screen-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    check(`captured email-change-otp-screen-${width}`, fs.existsSync(file), `${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
  }
} catch (error) {
  failed = true;
  console.log("FATAL:", error.message);
} finally {
  await browser.close().catch(() => undefined);
  if (createdId) {
    for (let round = 0; round < 3; round += 1) {
      const del = await svc.auth.admin.deleteUser(createdId);
      if (!del.error) break;
      console.log(`cleanup user ERR (round ${round + 1}):`, del.error.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.log(`done — failed=${failed}`);
  process.exit(failed ? 1 : 0);
}
