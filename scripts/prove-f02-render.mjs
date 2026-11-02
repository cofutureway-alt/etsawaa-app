/**
 * C3 — rendered proof that `settings.design` (F-02) drives the UI from the DB
 * with NO code edit: capture a visible bg-action element, flip the `action`
 * token in the DB via the service role, reload (plain SSR), capture again,
 * restore the original value. App-tree sha256 before/after proves no source
 * file changed.
 *
 * Reproduce: node --env-file=.env scripts/prove-f02-render.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PAGE_URL = 'http://localhost:3000/ar';
const SELECTOR = 'aside .bg-action'; // "All Categories" panel header (F-02 token `action`)
const TEST_ACTION = '#0B7A3E';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = 'evidence/phase-01/f02-render';

fs.mkdirSync(OUT_DIR, { recursive: true });

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- app-tree sha256 (app/ + public/ + root config) — before ---------------
const shaFile = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function treeHash() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk('app');
  walk('public');
  for (const f of ['package.json', 'vite.config.ts', 'react-router.config.ts', 'tsconfig.json']) files.push(f);
  files.sort();
  return createHash('sha256').update(files.map((f) => `${f} ${shaFile(f)}`).join('\n')).digest('hex');
}

// #RRGGBB → "rgb(r, g, b)" (what getComputedStyle reports)
const rgbOf = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const out = {
  command: 'node --env-file=.env scripts/prove-f02-render.mjs',
  url: PAGE_URL,
  selector: SELECTOR,
  what: 'settings.design.action token flipped in DB only; page reloaded; element color must follow',
  note: 'reload is a CDP hard reload (ignoreCache) — a plain reload was served from the browser cache',
  startedAt: new Date().toISOString(),
};
out.appTreeSha256Before = treeHash();

// --- DB: read the current design row ---------------------------------------
const { data: beforeRow, error: readErr } = await svc
  .from('settings')
  .select('value')
  .eq('key', 'settings.design')
  .single();
if (readErr) throw new Error(`read settings.design failed: ${readErr.message}`);
out.dbBefore = beforeRow.value;

// --- browser: before --------------------------------------------------------
const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCacheEnabled(false);
const cdp = await page.createCDPSession();
const hardReload = async () => {
  await cdp.send('Page.reload', { ignoreCache: true });
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
};
// wait until the element actually paints `rgb`, 15s cap
const waitForColor = (rgb) =>
  page
    .waitForFunction(
      (sel, want) => {
        const el = document.querySelector(sel);
        return el !== null && getComputedStyle(el).backgroundColor === want;
      },
      { timeout: 15000 },
      SELECTOR,
      rgb,
    )
    .then(
      () => true,
      () => false,
    );
const grab = () =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor };
  }, SELECTOR);

await page.goto(PAGE_URL, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1200));
out.computedBefore = await grab();
if (!out.computedBefore) throw new Error(`selector not found: ${SELECTOR}`);
const el = await page.$(SELECTOR);
await el.screenshot({ path: `${OUT_DIR}/before.png` });
await page.screenshot({ path: `${OUT_DIR}/before-full.png` });

// --- DB: flip action token (the ONLY change; no code file is touched) -------
out.dbModified = { ...beforeRow.value, action: TEST_ACTION };
const { error: upErr } = await svc
  .from('settings')
  .upsert([{ key: 'settings.design', value: out.dbModified }], { onConflict: 'key' });
if (upErr) throw new Error(`upsert settings.design failed: ${upErr.message}`);

// --- browser: after (hard reload — tokens arrive via SSR from the DB) -------
out.expectedAfterRgb = rgbOf(TEST_ACTION);
await hardReload();
out.computedAfter = await grab();
out.colorFollowed = await waitForColor(out.expectedAfterRgb);
const el2 = await page.$(SELECTOR);
await el2.screenshot({ path: `${OUT_DIR}/after.png` });
await page.screenshot({ path: `${OUT_DIR}/after-full.png` });
out.changed = out.computedBefore.backgroundColor !== out.computedAfter.backgroundColor;

// --- DB: restore original value ---------------------------------------------
const { error: resErr } = await svc
  .from('settings')
  .upsert([{ key: 'settings.design', value: beforeRow.value }], { onConflict: 'key' });
if (resErr) throw new Error(`restore settings.design failed: ${resErr.message}`);

await hardReload();
out.computedRestored = await grab();
out.restored = out.computedRestored.backgroundColor === out.computedBefore.backgroundColor;

// --- app-tree sha256 — after (must equal before: no code edit) ---------------
out.appTreeSha256After = treeHash();
out.noCodeEdit = out.appTreeSha256Before === out.appTreeSha256After;

const { data: afterRow } = await svc.from('settings').select('value').eq('key', 'settings.design').single();
out.dbRestored = JSON.stringify(afterRow.value) === JSON.stringify(beforeRow.value);

await b.close();
out.finishedAt = new Date().toISOString();

fs.writeFileSync(`${OUT_DIR}/proof.json`, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out, null, 1));
if (!out.changed) throw new Error('element color did NOT change after DB update');
if (!out.restored || !out.dbRestored || !out.noCodeEdit) throw new Error('restore/no-code-edit check failed');
console.log('C3 PROOF OK');
