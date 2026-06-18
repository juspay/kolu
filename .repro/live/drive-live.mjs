/**
 * #1399 live precursor probe (run on the real W6800 box).
 *
 * Connects over CDP to a Chromium already showing kolu, injects the P2/P4
 * telemetry, builds load (6 busy terminals), establishes an idle baseline, then
 * applies the two well-defined EXTERNAL drivers the prior measurements lacked:
 *   A) browser-zoom cycling  -> fractional visualViewport.height -> sub-pixel
 *      `--app-h` writes  (P4's exact hypothesized driver)
 *   B) real window-resize storm via Browser.setWindowBounds
 * then sits idle again to see if anything KEEPS climbing with no input.
 *
 * It samples discrete-GPU VRAM/busy each snapshot and ABORTS on any of:
 *   - /tmp/k1399.stop  (kernel fault, set by safety-monitor.sh)
 *   - "ProduceSkia" in the Chromium log  (GPU-compositor precursor)
 *   - discrete VRAM > 92%  (secondary stop, before faults)
 * The goal is to characterize precursors SAFELY, never to trigger the reset.
 *
 * Run under the kolu repo's e2e devshell:
 *   nix develop .#e2e -c node drive-live.mjs http://127.0.0.1:9222 /tmp/k1399.chrome.log
 */
import { chromium } from "playwright";
import fs from "node:fs";

const CDP = process.argv[2] || "http://127.0.0.1:9222";
const CHROME_LOG = process.argv[3] || "/tmp/k1399.chrome.log";
const STOP = "/tmp/k1399.stop";
const OUT = "/tmp/k1399-live.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

let aborted = null;
function checkAbort() {
  if (!aborted && fs.existsSync(STOP)) aborted = "kernel-fault (safety monitor)";
  if (!aborted) { try { if (/ProduceSkia/i.test(fs.readFileSync(CHROME_LOG, "utf8"))) aborted = "ProduceSkia mailbox error"; } catch {} }
}

// Locate the discrete W6800 by its crash bus (0000:3d:00.0); fall back to any amdgpu card.
function findCard() {
  const base = "/sys/class/drm";
  let fallback = null;
  for (const c of fs.readdirSync(base)) {
    if (!/^card\d+$/.test(c)) continue;
    const d = `${base}/${c}/device`;
    try {
      const ue = fs.readFileSync(`${d}/uevent`, "utf8");
      if (ue.includes("0000:3d:00.0") || ue.includes("73a3")) return d;
      if (fs.existsSync(`${d}/mem_info_vram_total`)) fallback ??= d;
    } catch {}
  }
  return fallback;
}
const CARD = findCard();
function gpu() {
  if (!CARD) return null;
  const rd = (f) => { try { return Number(fs.readFileSync(`${CARD}/${f}`, "utf8").trim()); } catch { return null; } };
  const used = rd("mem_info_vram_used"), total = rd("mem_info_vram_total"), busy = rd("gpu_busy_percent");
  return { usedMB: used != null ? Math.round(used / 1048576) : null, totalMB: total != null ? Math.round(total / 1048576) : null,
           vramPct: used && total ? +(100 * used / total).toFixed(1) : null, busy };
}

const TELEMETRY = `(() => { const R=(window.__k1399={appH:[],vv:[],ro:0,start:performance.now()});
  const sp=CSSStyleDeclaration.prototype.setProperty; if(!sp.__k1399){CSSStyleDeclaration.prototype.setProperty=function(n,v,p){ if(n==='--app-h')R.appH.push({t:Math.round(performance.now()),v:String(v)}); return sp.call(this,n,v,p)}; CSSStyleDeclaration.prototype.setProperty.__k1399=true;}
  window.visualViewport&&window.visualViewport.addEventListener('resize',()=>R.vv.push({h:visualViewport.height,dpr:devicePixelRatio}));
  const RO=window.ResizeObserver; window.ResizeObserver=class extends RO{constructor(cb){super((e,o)=>{R.ro+=e.length;return cb(e,o)})}};
})();`;

const report = (page) => page.evaluate(() => {
  const R = window.__k1399 || { appH: [], vv: [], ro: 0 };
  const distinct = [...new Set(R.appH.map((x) => x.v))];
  return { appH_writes: R.appH.length, appH_distinct: distinct.length, appH_sample: distinct.slice(0, 12), vv: R.vv.length, ro: R.ro };
});

const snaps = [], samples = [];
async function snap(page, label) {
  checkAbort();
  const r = await report(page), g = gpu();
  const s = { label, t: Date.now(), ...r, gpu: g };
  snaps.push(s); samples.push({ t: Date.now(), gpu: g });
  log(label, JSON.stringify({ appH: r.appH_writes, distinct: r.appH_distinct, vv: r.vv, ro: r.ro, gpu: g }));
  return s;
}
function ok() {
  checkAbort();
  const g = gpu();
  if (!aborted && g?.vramPct != null && g.vramPct > 92) aborted = `VRAM ${g.vramPct}% (secondary stop)`;
  if (aborted) log("ABORTING:", aborted);
  return !aborted;
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /^https?:/.test(p.url())) || ctx.pages()[0];
  await page.bringToFront();
  log("connected:", page.url(), "| discrete card:", CARD || "NOT FOUND");
  await page.waitForSelector('[data-visible] .xterm-screen, [data-testid="empty-state"]', { timeout: 60000 }).catch(() => {});
  await page.evaluate(TELEMETRY);

  for (let i = 0; i < 6 && ok(); i++) {
    await page.keyboard.press("Control+Enter"); await sleep(500);
    await page.locator('[data-focused] .xterm-screen').first().click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.type("while true; do echo $RANDOM busy; sleep 0.05; done");
    await page.keyboard.press("Enter"); await sleep(300);
  }
  await snap(page, "baseline_0s");
  for (let s = 0; s < 60 && ok(); s += 10) { await sleep(10000); await snap(page, `baseline_+${s + 10}s`); }

  // Driver A: browser-zoom cycling -> fractional visualViewport -> sub-pixel --app-h.
  log("driver A: browser-zoom cycling (P4 sub-pixel premise)");
  for (let i = 0; i < 24 && ok(); i++) { await page.keyboard.press(i % 2 ? "Control+Minus" : "Control+Equal"); await sleep(250); }
  await page.keyboard.press("Control+0");
  await snap(page, "after_zoom_cycle");

  // Driver B: real window-resize storm.
  log("driver B: real window-resize storm");
  try {
    const cdp = await ctx.newCDPSession(page);
    const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }).catch(() => {});
    const L = bounds.left ?? 60, T = bounds.top ?? 60;
    for (let i = 0; i < 40 && ok(); i++) {
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: L, top: T, width: 1400 + (i % 2), height: 900 + (i % 2) } });
      await sleep(80);
    }
  } catch (e) { log("setWindowBounds unavailable (compositor may block):", e.message); }
  await snap(page, "after_resize_storm");

  // Post-driver idle: does anything KEEP climbing with no input? (the decisive falsification check)
  log("post-driver idle recheck 30s (no input)");
  for (let s = 0; s < 30 && ok(); s += 10) { await sleep(10000); await snap(page, `idle_recheck_+${s + 10}s`); }

  const chromeLogTail = (() => { try { return fs.readFileSync(CHROME_LOG, "utf8").split("\n").filter((l) => /ProduceSkia|gpu|error/i.test(l)).slice(-30); } catch { return []; } })();
  fs.writeFileSync(OUT, JSON.stringify({ card: CARD, aborted, snaps, samples, chromeLogTail }, null, 2));
  log("WROTE", OUT, "| aborted:", aborted || "no");
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error("drive-live failed:", e);
  try { fs.writeFileSync(OUT, JSON.stringify({ error: String(e?.stack || e), aborted, snaps, samples }, null, 2)); } catch {}
  process.exit(1);
});
