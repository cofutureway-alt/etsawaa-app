/**
 * M3 — /ui screenshots at 390/768/1280/1440 for ar + en (full page).
 * Output: evidence/phase-01/screens/ui-{lang}-{width}.png (+ ui-screens.json)
 * Reproduce: node --env-file=.env scripts/shoot-ui.mjs   (server on :3000)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = [390, 768, 1280, 1440];
const LANGS = ['ar', 'en'];
const OUT = 'evidence/phase-01/screens';
fs.mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
const manifest = { generatedAt: new Date().toISOString(), command: 'node --env-file=.env scripts/shoot-ui.mjs', shots: [] };

for (const lang of LANGS) {
  for (const width of WIDTHS) {
    const p = await b.newPage();
    await p.setViewport({ width, height: 900 });
    await p.goto(`http://localhost:3000/${lang}/ui`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500)); // webfonts + hydration
    const file = `${OUT}/ui-${lang}-${width}.png`;
    await p.screenshot({ path: file, fullPage: true });
    const info = await p.evaluate(() => ({
      title: document.title,
      dir: document.documentElement.getAttribute('dir'),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      pageHeight: document.documentElement.scrollHeight,
    }));
    manifest.shots.push({ lang, width, file, ...info });
    console.log(JSON.stringify({ lang, width, ...info }));
    await p.close();
  }
}
await b.close();
fs.writeFileSync('evidence/phase-01/ui-screens.json', `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`M3 SHOTS OK (${manifest.shots.length})`);
