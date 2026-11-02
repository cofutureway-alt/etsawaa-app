/**
 * P1 — real-device-condition LCP measurement (reproducible artifact).
 * Chrome DevTools protocol throttling: 4x CPU + slow-4G (150 ms RTT, 1.6 Mbps
 * down / 750 Kbps up) — the same condition profile Lighthouse simulates.
 * Reproduce: node --env-file=.env scripts/measure-lcp-throttled.mjs  (server on :3000)
 */
import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const p = await b.newPage();
const cdp = await p.createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
});
await p.evaluateOnNewDocument(() => {
  window.__lcp = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      window.__lcp.push({
        startTime: Math.round(e.startTime),
        renderTime: Math.round(e.renderTime),
        loadTime: Math.round(e.loadTime),
        element: e.url ? e.url.split('/').pop() : '(text)',
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
});
await p.goto('http://localhost:3000/ar', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 3000));
const entries = await p.evaluate(() => window.__lcp);
const finalLCP = entries.at(-1);
const result = {
  command: 'node --env-file=.env scripts/measure-lcp-throttled.mjs',
  url: 'http://localhost:3000/ar',
  throttling: { cpu: '4x', network: 'slow 4G (150ms RTT, 1.6Mbps down) — matches Lighthouse mobile profile' },
  entries,
  finalLCPms: finalLCP.startTime,
  element: finalLCP.element,
};
console.log(JSON.stringify(result, null, 1));
await b.close();
