import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const ssh = ["-i", join(homedir(), ".ssh", "etsawa_vps"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", "root@80.241.214.57", "docker exec -i etsawaa-app node --input-type=module -"];
// Keys remain inside the VPS container; only a disposable QA login enters memory.
const server = (source) => JSON.parse(execFileSync("ssh.exe", ssh, { input: source, encoding: "utf8", timeout: 30_000 }));
const helper = `const base=(process.env.SUPABASE_INTERNAL_URL||process.env.SUPABASE_URL).replace(/\\/$/,'');
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error('QA request failed: '+r.status);return r.status===204?null:await r.json();}
`;
let account, browser;
const results = [], errors = [];
if (process.argv.includes("--cleanup")) {
  const count = server(helper + `let n=0;for(const u of await call('/rest/v1/profiles?select=id,email,full_name&email=like.'+encodeURIComponent('qa-email-studio-%@example.invalid'))){if(u.full_name==='Email Studio QA'&&u.email.startsWith('qa-email-studio-')&&u.email.endsWith('@example.invalid')){await call('/auth/v1/admin/users/'+u.id,'DELETE');n++;}}console.log(JSON.stringify(n));`);
  console.log(`Removed ${count} disposable QA accounts.`);
  process.exit(0);
}
try {
  account = server(helper + `
const {randomBytes}=await import('node:crypto');
const email='qa-email-studio-'+randomBytes(6).toString('hex')+'@example.invalid',password='EtsQa9!'+randomBytes(20).toString('base64url');
const terms=await call('/rest/v1/legal_documents?select=version&kind=eq.terms&is_current=eq.true');
const user=await call('/auth/v1/admin/users','POST',{email,password,email_confirm:true,user_metadata:{full_name:'Email Studio QA',locale:'ar',terms_accepted_at:new Date().toISOString(),...(terms[0]?{terms_version:terms[0].version}:{})}});
try {await call('/rest/v1/profiles?id=eq.'+user.id,'PATCH',{role:'admin',status:'active'});}catch(e){await call('/auth/v1/admin/users/'+user.id,'DELETE');throw e;}
console.log(JSON.stringify({id:user.id,email,password}));`);
  console.log("Created a disposable QA account; no email sent.");
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://etsawaa.com/ar/auth/login?next=%2Far%2Fadmin%2Femail-templates");
  await page.locator('input[name="identifier"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.waitForURL(/\/(admin\/email-templates|legal\/accept)/, { timeout: 30000 });
  if (page.url().includes("/legal/accept")) {
    await page.locator('input[name="terms_accept"]').check();
    await page.locator('form button[type="submit"]').click();
  }
  await page.getByRole("heading", { name: "استوديو الإيميلات", exact: true }).waitFor({ timeout: 30000 });
  await page.frameLocator("iframe").locator("h1").waitFor();
  await page.screenshot({ path: "evidence/email-studio/production-ar-1600.png", fullPage: true });
  console.log("Arabic studio loaded.");
  results.push("Authenticated Arabic studio and branded preview: PASS");
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/preferences/locale") && r.request().postData()?.includes('"en"')),
    page.goto("https://etsawaa.com/en/admin/email-templates"),
  ]);
  assert.equal(response.status(), 200);
  console.log("English preference saved.");
  assert.equal(server(helper + `console.log(JSON.stringify((await call('/rest/v1/profiles?select=locale&id=eq.${account.id}'))[0].locale));`), "en");
  await page.getByRole("heading", { name: "Email studio", exact: true }).waitFor();
  console.log("English studio loaded.");
  await page.getByPlaceholder("Find an email…").fill("welcome");
  await page.getByRole("button", { name: /Welcome after verification/ }).click();
  await page.frameLocator("iframe").locator("h1").waitFor();
  await page.screenshot({ path: "evidence/email-studio/production-en-1600.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "evidence/email-studio/production-en-390.png", fullPage: true });
  results.push("English studio, persisted account preference and mobile layout: PASS");
  const [arabic] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/preferences/locale") && r.request().postData()?.includes('"ar"')),
    page.goto("https://etsawaa.com/ar/admin/email-templates"),
  ]);
  assert.equal(arabic.status(), 200);
  assert.equal(server(helper + `console.log(JSON.stringify((await call('/rest/v1/profiles?select=locale&id=eq.${account.id}'))[0].locale));`), "ar");
  results.push("Switching back persists Arabic: PASS");
  const visitor = await browser.newContext();
  const denied = await visitor.request.post("https://etsawaa.com/api/preferences/locale", { headers: { Origin: "https://evil.example" }, data: { locale: "en" } });
  assert.equal(denied.status(), 403);
  const locked = await visitor.request.get("https://etsawaa.com/en/admin/email-templates", { maxRedirects: 0 });
  assert.equal(locked.status(), 302);
  const guest = await visitor.newPage();
  const [guestPreference] = await Promise.all([guest.waitForResponse((r) => r.url().endsWith("/api/preferences/locale")), guest.goto("https://etsawaa.com/en")]);
  assert.equal(guestPreference.status(), 200);
  assert.equal((await visitor.cookies()).find((c) => c.name === "etsawaa_locale")?.value, "en");
  await guest.goto("https://etsawaa.com/"); assert.ok(new URL(guest.url()).pathname.startsWith("/en"));
  results.push("Guest language cookie, private editor and CSRF protection: PASS");
  assert.deepEqual(errors, []);
  console.log(results.join("\n"));
  writeFileSync("evidence/email-studio/production-checks.json", JSON.stringify({ results, errors, at: new Date().toISOString() }, null, 2));
} finally {
  if (browser) await browser.close();
  if (account) {
    server(helper + `const u=await call('/auth/v1/admin/users/${account.id}');if(u.email!==${JSON.stringify(account.email)}||!u.email.startsWith('qa-email-studio-'))throw new Error('QA cleanup identity mismatch');await call('/auth/v1/admin/users/${account.id}','DELETE');console.log('true');`);
    console.log("Removed the disposable QA account.");
  }
}
