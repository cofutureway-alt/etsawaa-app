/**
 * P1 — image optimization pass (reproducible).
 * Re-encodes the shipped artwork with Chrome's canvas encoder:
 *   - favicon set: favicon-32.png (32x32) + apple-touch-icon.png (180x180, white bg)
 *   - logo-mark/transparent/symbol → WebP (same or 2x-display dimensions)
 *   - hero/final banners → downscaled WebP (1280x720 / 1600x686)
 * Sources stay untouched; outputs land in public/. Run from the project root:
 *   node --env-file=.env scripts/optimize-images.mjs   (env not actually required)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage();

const mime = (p) => (p.endsWith('.png') ? 'image/png' : 'image/webp');

async function convert(src, out, w, h, type, quality, bg = null) {
  const dataUrl = `data:${mime(src)};base64,${fs.readFileSync(src).toString('base64')}`;
  const result = await page.evaluate(
    async ({ dataUrl, w, h, type, quality, bg }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return c.toDataURL(type, quality);
    },
    { dataUrl, w, h, type, quality, bg },
  );
  fs.writeFileSync(out, Buffer.from(result.split(',')[1], 'base64'));
  console.log(`${out}  ${Math.round(fs.statSync(out).size / 102.4) / 10}KB  (${w}x${h})`);
}

const before = (p) => `${Math.round(fs.statSync(p).size / 102.4) / 10}KB`;
// public/logo.png (the 1.5 MB favicon source) is deleted after this pass —
// skip the favicon step when its outputs already exist.
if (fs.existsSync('public/logo.png')) {
  console.log(`logo.png ${before('public/logo.png')} → favicon-32 + apple-touch-icon`);
  await convert('public/logo.png', 'public/favicon-32.png', 32, 32, 'image/png', 1);
  // JPEG keeps the apple-touch icon tiny (PNG from canvas is 32-bit and hit 60KB;
  // the set must stay <= 50KB). White bg is applied, which is what iOS composites onto anyway.
  await convert('public/logo.png', 'public/apple-touch-icon.jpg', 180, 180, 'image/jpeg', 0.85, '#ffffff');
} else {
  console.log('logo.png absent (favicon set already generated) — skipping');
}

const logos = [
  ['logo-mark.png', 'logo-mark.webp', 548, 245, 0.8],
  ['logo-transparent.png', 'logo-transparent.webp', 279, 224, 0.8],
  ['logo-symbol.png', 'logo-symbol.webp', 200, 245, 0.8],
];
for (const [src, out, w, h, q] of logos) {
  if (!fs.existsSync(`public/${src}`)) {
    console.log(`${src} absent (${out} already generated) — skipping`);
    continue;
  }
  console.log(`${src} ${before(`public/${src}`)} → ${out}`);
  await convert(`public/${src}`, `public/${out}`, w, h, 'image/webp', q);
}

for (const [file, w, h] of [
  ['promo-wide-1', 1280, 720],
  ['promo-wide-3', 1280, 720],
  ['promo-wide-2', 1600, 686],
]) {
  const src = `public/${file}.webp`;
  console.log(`${src} ${before(src)} → re-encoded ${w}x${h}`);
  await convert(src, src, w, h, 'image/webp', 0.78);
}

// Mobile LCP variants: 800w covers the 412px viewport at 1.75 DPR (721px) with margin.
for (const file of ['promo-wide-1', 'promo-wide-3']) {
  const src = `public/${file}.webp`;
  await convert(src, `public/${file}-sm.webp`, 800, 450, 'image/webp', 0.76);
}

await b.close();
console.log('OPTIMIZE OK');
