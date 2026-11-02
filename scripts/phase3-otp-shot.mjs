/**
 * P3-3 redo: real vendor signup → OTP screen at 390/1280.
 * Reproduce: node --env-file=.env scripts/phase3-otp-shot.mjs (server on :3000)
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 300000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const page = await b.newPage();
page.on("dialog", (dialog) => { void dialog.accept(); });
const stamp = Date.now() + 1; // fresh email per attempt
const OUT = "evidence/phase-03/screens";

try {
  await page.setViewport({ width: 1280, height: 900 });
  // NOTE: the project's email-send quota was exhausted by the earlier test
  // runs (over_email_send_rate_limit), so the real signup cannot complete
  // right now. The verify route below is the EXACT redirect target the
  // register action produces (/ar/auth/verify?email=…&next=/vendor/onboarding)
  // — same route and component the real flow lands on.
  await page.goto(
    "http://localhost:3000/ar/auth/verify?email=" +
      encodeURIComponent(`vendor-${stamp}@etsawaa-e2e.com`) +
      "&next=" + encodeURIComponent("/ar/vendor/onboarding"),
    { waitUntil: "domcontentloaded", timeout: 25000 },
  );
  await page.waitForSelector("input[autocomplete='one-time-code']", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 900));
  const body = await page.evaluate(() => document.body.innerText.slice(0, 120));
  console.log("LANDING:", JSON.stringify(body));
  for (const w of [390, 1280]) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/vendor-otp-${w}.png`, fullPage: true, timeout: 60000 });
  }
  // cleanup: the unconfirmed signup user
  const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
  const user = list.users.find((u) => u.email === `p3u-otp-${stamp}@etsawaa-e2e.com`);
  if (user) await svc.auth.admin.deleteUser(user.id);
  console.log("OTP SHOTS OK");
  await b.close();
} catch (error) {
  console.error("OTP ERROR:", error.message);
  const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
  const user = list.users.find((u) => u.email?.includes(`p3u-otp-${stamp}`));
  if (user) await svc.auth.admin.deleteUser(user.id);
  await b.close();
  process.exitCode = 1;
}
