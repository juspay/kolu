/**
 * Reproduction harness for kolu issue #1399.
 *
 * Hypothesis under test (from #1308 P2/P4):
 *   P2 — ResizeObserver on the terminal container calls debouncedFit() -> fit()
 *        with no size threshold, allegedly creating a "sustained oscillation loop"
 *        even with sub-pixel size differences.
 *   P4 — useVisualViewportHeight sets `--app-h` on <html> on EVERY
 *        visualViewport.resize with no sub-pixel guard, allegedly producing
 *        sustained geometry churn.
 *
 * The decisive experiment: under heavy load (many terminals + continuous
 * output), with NO user-driven resize, do these counters climb on their own?
 *   - If yes  -> self-sustaining oscillation/churn -> P2/P4 reproduced as the cause.
 *   - If flat -> the writes are unconditional but NOT self-sustaining; the
 *                geometry instability must come from an external driver.
 * Then we characterize amplification: how much does ONE resize (and a
 * drag-resize storm, and font-zoom) cascade into RO fires / fit() calls /
 * --app-h writes.
 *
 * Renderer-independent: measures ResizeObserver, CSS var writes, and
 * visualViewport events, which are identical under WebGL or DOM xterm renderers.
 *
 * Usage: node repro-1399.mjs <clientURL> [terminals=8] [steadySec=30]
 * Requires playwright (run under the project's `#e2e` devshell).
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const CLIENT_URL = process.argv[2];
const N_TERMINALS = Number(process.argv[3] ?? 8);
const STEADY_SEC = Number(process.argv[4] ?? 30);
const OUT = process.argv[5] ?? "/tmp/repro-1399.json";
const DPR = Number(process.argv[6] ?? 1); // fractional dpr mirrors GNOME fractional scaling (P4 sub-pixel premise)
if (!CLIENT_URL) {
  console.error("usage: node repro-1399.mjs <clientURL> [terminals] [steadySec] [out]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// Installed BEFORE any app script runs, so EVERY ResizeObserver the app creates
// is wrapped, EVERY `--app-h` write is recorded, and EVERY visualViewport.resize
// is counted. This is the ground-truth instrumentation for P2/P4.
const INIT = `
(() => {
  const R = { ro: [], appH: [], vv: [], fit: 0, fitLog: [], startedAt: performance.now() };
  window.__repro = R;

  const RO = window.ResizeObserver;
  if (RO) {
    window.ResizeObserver = class extends RO {
      constructor(cb) {
        super((entries, obs) => {
          for (const e of entries) {
            const el = e.target;
            R.ro.push({
              t: performance.now(),
              id: (el && el.getAttribute && (el.getAttribute('data-terminal-id') || el.getAttribute('data-testid'))) || (el && el.tagName) || 'n/a',
              w: e.contentRect ? e.contentRect.width : null,
              h: e.contentRect ? e.contentRect.height : null,
            });
          }
          return cb(entries, obs);
        });
      }
    };
  }

  const sp = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(name, value, prio) {
    if (name === '--app-h') R.appH.push({ t: performance.now(), v: String(value) });
    return sp.call(this, name, value, prio);
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      R.vv.push({ t: performance.now(), h: window.visualViewport.height, w: window.visualViewport.width, dpr: window.devicePixelRatio });
    });
  }
})();
`;

// Patch FitAddon.prototype.fit via a live instance (the prototype is shared, so
// one patch counts every terminal's fit()).
const PATCH_FIT = `
(() => {
  const R = window.__repro; if (!R) return 'no-repro';
  let patched = 0;
  for (const el of document.querySelectorAll('[data-terminal-id]')) {
    const term = el.__xterm;
    const am = term && (term._addonManager || term._core?._addonManager);
    const addons = am && am._addons;
    if (!addons) continue;
    for (const a of addons) {
      const inst = a && a.instance;
      if (inst && typeof inst.fit === 'function') {
        const proto = Object.getPrototypeOf(inst);
        if (!proto.__reproPatched) {
          const orig = proto.fit;
          proto.fit = function() {
            R.fit++;
            try { R.fitLog.push({ t: performance.now(), cols: this._terminal?.cols, rows: this._terminal?.rows }); } catch {}
            return orig.apply(this, arguments);
          };
          proto.__reproPatched = true;
          patched++;
        }
      }
    }
  }
  return 'patched=' + patched;
})();
`;

async function snap(page, label) {
  const s = await page.evaluate(() => {
    const r = window.__repro;
    return { ro: r.ro.length, appH: r.appH.length, vv: r.vv.length, fit: r.fit };
  });
  return { label, t: Date.now(), ...s };
}

async function tileCount(page) {
  return page.locator('[data-testid="canvas-tile"][data-terminal-id]').count();
}

async function createTerminal(page) {
  const before = await tileCount(page);
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="canvas-tile"][data-terminal-id]').length > n,
    before,
    { timeout: 20000 },
  );
}

async function runInFocused(page, cmd) {
  const screen = page.locator("[data-focused] .xterm-screen").first();
  await screen.click({ timeout: 10000 }).catch(() => {});
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
}

const snaps = [];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    // Mirror a real desktop Chromium GPU stack as closely as headless allows.
    args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--use-gl=angle"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: DPR });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  log("navigating", CLIENT_URL);
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for app to settle (a visible terminal screen or the empty-state tip).
  await page
    .locator('[data-visible] .xterm-screen, [data-testid="empty-state"]')
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
  log("app settled");
  snaps.push(await snap(page, "settled"));

  // Ensure at least one terminal exists, then patch fit().
  if ((await tileCount(page)) === 0) {
    log("no terminals — creating first");
    await createTerminal(page);
  }
  await sleep(1500);
  log("patch fit:", await page.evaluate(PATCH_FIT));

  // Phase: idle baseline (1 terminal, no load, no resize) — 10s.
  snaps.push(await snap(page, "idle_baseline_start"));
  await sleep(10000);
  snaps.push(await snap(page, "idle_baseline_end"));

  // Phase: ramp to N terminals, each running continuous output (sustained
  // activity -> "working" dock animation + constant xterm DOM writes).
  const CONT = "while true; do echo \"$(date +%s.%N) $RANDOM line of output to keep the pty busy\"; sleep 0.05; done";
  for (let i = (await tileCount(page)); i < N_TERMINALS; i++) {
    await createTerminal(page);
    await sleep(300);
    await runInFocused(page, CONT);
    await sleep(200);
    log(`terminal ${i + 1}/${N_TERMINALS} running continuous output`);
  }
  // Make sure the very first terminal is also producing output.
  await runInFocused(page, CONT);
  // Re-patch fit in case new addon instances slipped a different prototype.
  await page.evaluate(PATCH_FIT);
  snaps.push(await snap(page, "load_ready"));

  // Phase: STEADY STATE under heavy load, NO resize — the decisive test.
  log(`steady-state under ${N_TERMINALS}-terminal load for ${STEADY_SEC}s (NO resize)`);
  const steadyStart = await snap(page, "steady_start");
  snaps.push(steadyStart);
  for (let s = 0; s < STEADY_SEC; s += 5) {
    await sleep(5000);
    snaps.push(await snap(page, `steady_+${s + 5}s`));
  }
  const steadyEnd = snaps[snaps.length - 1];
  log("steady delta:", {
    ro: steadyEnd.ro - steadyStart.ro,
    fit: steadyEnd.fit - steadyStart.fit,
    appH: steadyEnd.appH - steadyStart.appH,
    vv: steadyEnd.vv - steadyStart.vv,
  });

  // Phase: ONE viewport resize — characterize the cascade from a single resize.
  snaps.push(await snap(page, "before_single_resize"));
  await page.setViewportSize({ width: 1400, height: 900 });
  await sleep(2000);
  snaps.push(await snap(page, "after_single_resize"));

  // Phase: drag-resize STORM — 40 rapid integer resizes (simulates a user
  // dragging the window edge). Measures per-resize amplification into fit()/RO.
  log("drag-resize storm (40 steps)");
  snaps.push(await snap(page, "before_resize_storm"));
  for (let i = 0; i < 40; i++) {
    const w = 1400 + (i % 2 === 0 ? 0 : 1); // 1-px oscillation to probe sub-pixel sensitivity
    const h = 900 + (i % 2 === 0 ? 0 : 1);
    await page.setViewportSize({ width: w, height: h });
    await sleep(50);
  }
  await sleep(2000);
  snaps.push(await snap(page, "after_resize_storm"));

  // Phase: font zoom (calls debouncedFit directly) — 6 steps.
  log("font zoom storm");
  snaps.push(await snap(page, "before_zoom"));
  await page.locator("[data-focused] .xterm-screen").first().click().catch(() => {});
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Control+Equal");
    await sleep(300);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Control+Minus");
    await sleep(300);
  }
  await sleep(1500);
  snaps.push(await snap(page, "after_zoom"));

  // Phase: canvas zoom + pan storm (the P3/transform path). Canvas zoom is a CSS
  // `transform: scale()` on tiles — transforms do NOT change layout box, so this
  // should NOT trip the terminal container's ResizeObserver. Prove it empirically.
  log("canvas zoom+pan storm (ctrl+wheel, then wheel)");
  snaps.push(await snap(page, "before_canvas_zoom"));
  await page.mouse.move(800, 500);
  await page.keyboard.down("Control");
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120); await sleep(40); }
  await page.keyboard.up("Control");
  await sleep(500);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(i % 2 === 0 ? -200 : 200, 0); await sleep(40); } // pan
  await sleep(1500);
  snaps.push(await snap(page, "after_canvas_zoom_pan"));

  // Final full dump for offline analysis.
  const detail = await page.evaluate(() => {
    const r = window.__repro;
    const dpr = window.devicePixelRatio;
    // Distinct --app-h values + sub-pixel churn detection.
    const appHvals = r.appH.map((x) => x.v);
    const distinctAppH = [...new Set(appHvals)];
    // RO contentRect distinct heights per id (to see sub-pixel oscillation).
    const roHeights = [...new Set(r.ro.map((x) => x.h))].slice(0, 50);
    return {
      dpr,
      renderer: document.querySelector("[data-renderer]")?.getAttribute("data-renderer") || null,
      counts: { ro: r.ro.length, appH: r.appH.length, vv: r.vv.length, fit: r.fit },
      appH: { total: r.appH.length, distinct: distinctAppH.length, sampleDistinct: distinctAppH.slice(0, 20), last: r.appH.slice(-5) },
      vv: { total: r.vv.length, last: r.vv.slice(-5) },
      roHeights,
      fitLogTail: r.fitLog.slice(-10),
      durationMs: performance.now() - r.startedAt,
    };
  });

  const tiles = await tileCount(page);
  const result = { url: CLIENT_URL, terminals: tiles, snaps, detail, consoleErrors: consoleErrors.slice(0, 40) };
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  log("WROTE", OUT);
  log("SUMMARY", JSON.stringify(detail.counts), "renderer=" + detail.renderer, "dpr=" + detail.dpr, "tiles=" + tiles);

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("REPRO FAILED:", e);
  try { writeFileSync(OUT, JSON.stringify({ error: String(e && e.stack || e), snaps }, null, 2)); } catch {}
  process.exit(1);
});
