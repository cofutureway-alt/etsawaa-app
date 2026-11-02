/**
 * Phase 05 — Lighthouse mobile ×3 medians for the checkout entry page
 * (public guest state; order pages are auth-gated noindex).
 * Reproduce: node --env-file=.env scripts/p5-perf.mjs (server :3000)
 */
import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = "http://localhost:3000";

async function lh(url, port) {
  const result = await lighthouse(url, {
    port, onlyCategories: ["performance"], formFactor: "mobile",
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
    maxWaitForLoad: 120000,
  });
  const a = result.lhr.audits;
  return {
    score: Math.round((result.lhr.categories.performance?.score ?? 0) * 100),
    lcpMs: Math.round(a["largest-contentful-paint"]?.numericValue ?? 0),
    tbtMs: Math.round(a["total-blocking-time"]?.numericValue ?? 0),
    cls: a["cumulative-layout-shift"]?.numericValue ?? 0,
    fcpMs: Math.round(a["first-contentful-paint"]?.numericValue ?? 0),
  };
}

const median = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const b = await puppeteer.launch({ headless: "new", protocolTimeout: 600000, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--remote-debugging-port=9334"] });
const report = { at: new Date().toISOString(), runs: [] };
for (const [url, label] of [[`${BASE}/ar/checkout`, "checkout-gate"]]) {
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await lh(url, 9334);
    runs.push(r);
    console.log(`${label} run ${i + 1}:`, JSON.stringify(r));
  }
  const medians = { score: median(runs.map((r) => r.score)), lcpMs: median(runs.map((r) => r.lcpMs)), tbtMs: median(runs.map((r) => r.tbtMs)), cls: median(runs.map((r) => r.cls)), fcpMs: median(runs.map((r) => r.fcpMs)) };
  report.runs.push({ label, url, runs, medians });
  console.log(`${label} MEDIANS:`, JSON.stringify(medians));
}
await b.close();
fs.writeFileSync("evidence/phase-05/perf-checkout.json", JSON.stringify(report, null, 1) + "\n");
