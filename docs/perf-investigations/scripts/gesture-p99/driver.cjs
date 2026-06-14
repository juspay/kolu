// Per-event work microbenchmark for the canvas pan/zoom write-storm (R3 → R4).
//
// #1308 measured the per-wheel transform write-storm at NATIVE speed and found
// it real-but-benign: ~60 fps even at 9,600 tile writes/fling, so it shipped no
// fix (`docs/perf-investigations/dock-and-eventloop-1308.md`, "P3 — real, but
// benign"). The open question it flagged was the *weak client*: "a heavier
// canvas, a 120 Hz panel, or a much weaker client might surface one." R4
// (rAF-coalescing the storm) only helps when several wheel events land in one
// animation frame — so the right thing to measure is the per-event main-thread
// WORK, and whether coalescing collapses it.
//
// Why a burst, not an rAF-paced fling: a headless/CDP Chrome produces ~one
// frame per dispatched input event (its rAF clock isn't vsync-capped without a
// real display, and Chrome 143 dropped HeadlessExperimental.beginFrame), so an
// rAF-paced fling can't show coalescing — every event gets its own frame. This
// harness instead dispatches a BURST of K WheelEvents from page JS in a tight
// loop (no `await`, so no rAF/microtask runs mid-loop). That is exactly the
// regime R4 targets — many events between two paints:
//
//   * Before R4 (per-event): each event writes panX/panY/zoom synchronously, so
//     the burst does K full tile-recomputes. `burstMs` scales with K, and the
//     tile-write storm is K × tiles.
//   * After R4 (coalesced): the K events only accumulate; one rAF flush after
//     the burst applies them once. `burstMs` is ~flat, and writes are 1 × tiles.
//
// Under CPU throttle (the "weak client"), the per-event recompute cost is what
// blows the 16.67 ms frame budget; `perEventUs` × (events/frame) is the
// realistic per-frame gesture cost. We sweep 1× / 4× / 6× throttle and report
// the median of several bursts.
//
// Dependency-free: speaks CDP over Node's built-in `WebSocket` + `fetch`.
//   node driver.cjs <url> [cdpPort=9531] [nTiles=16] [burst=60]

const URL = process.argv[2];
const PORT = parseInt(process.argv[3] || "9531", 10);
const N_TILES = parseInt(process.argv[4] || "16", 10);
const BURST = parseInt(process.argv[5] || "60", 10);

const THROTTLE_RATES = [1, 4, 6];
const REPEATS = 7;
const VSYNC_60_MS = 1000 / 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectCDP(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page") || list[0];
  if (!page) throw new Error("no CDP page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error("ws open failed: " + (e && e.message)));
  });
  let id = 0;
  const pending = new Map();
  const eventHandlers = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.method + ": " + JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method) {
      for (const h of eventHandlers) h(m);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const once = (method) => new Promise((res) => eventHandlers.push((m) => m.method === method && res(m.params)));
  return { send, once, close: () => ws.close() };
}

// Injected before navigation: a MutationObserver that counts `style` writes on
// every mounted tile (the write-storm magnitude), plus the burst runner. The
// burst dispatches K real WheelEvents through the live capture-phase gesture
// listener — same path as a trackpad fling — in a synchronous loop, then awaits
// two frames so any coalesced rAF flush has applied.
const INSTRUMENT = `
window.__m = { tileTx: 0, _obs: null };
window.__obsTiles = function(){
  window.__m.tileTx = 0;
  if (window.__m._obs) window.__m._obs.disconnect();
  window.__m._obs = new MutationObserver(function(ms){
    for (var i=0;i<ms.length;i++) if (ms[i].attributeName === 'style') window.__m.tileTx++;
  });
  document.querySelectorAll('[data-canvas-tile]').forEach(function(t){
    window.__m._obs.observe(t, { attributes: true, attributeFilter: ['style'] });
  });
  return document.querySelectorAll('[data-canvas-tile]').length;
};
// A burst is MONOTONIC (all events drift one way) like a real fling — so the
// coalesced net delta is non-zero and R4 does one real apply, a fair contrast
// to the per-event path's K applies. \`dir\` (±1, alternated across repeats by the
// driver) flips the drift each burst so pan/zoom stay bounded over the run
// instead of flying to the clamp.
window.__burst = async function(gesture, K, cx, cy, mag, dir){
  var el = document.querySelector('[data-testid="canvas-container"]');
  window.__obsTiles();
  var zoom = gesture === 'zoom';
  var t0 = performance.now();
  for (var i=0;i<K;i++){
    el.dispatchEvent(new WheelEvent('wheel', {
      deltaX: 0, deltaY: dir * mag,
      ctrlKey: zoom, shiftKey: !zoom,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true,
    }));
  }
  var t1 = performance.now();                       // synchronous burst cost
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  var t2 = performance.now();
  return JSON.stringify({ burstMs: +(t1-t0).toFixed(2), settleMs: +(t2-t1).toFixed(2), writes: window.__m.tileTx });
};
`;

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

(async () => {
  const cdp = await connectCDP(PORT);
  const ev = async (expression) => {
    const { result } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    return result.value;
  };
  const evAsync = async (expression) => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.value;
  };
  const ctrlT = async () => {
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "t", code: "KeyT", windowsVirtualKeyCode: 84 });
    }
  };

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: URL });
  await loaded;
  await sleep(4000);

  await ev(`(function(){var b=document.querySelector('[data-testid="restore-session"]'); if(b)b.click();})()`);
  await sleep(2500);
  let tiles = await ev(`document.querySelectorAll('[data-canvas-tile]').length`);
  let attempts = 0;
  while (tiles < N_TILES && attempts < N_TILES * 2 + 4) {
    await ctrlT();
    attempts++;
    await sleep(750);
    tiles = await ev(`document.querySelectorAll('[data-canvas-tile]').length`);
  }
  await sleep(2500);
  console.error(`tiles: ${tiles} (after ${attempts} Ctrl+T)`);
  // The published table is a per-tile-count comparison: a quiet under-count
  // understates the write-storm this harness exists to prove, and an over-count
  // inflates it. Fail loud on under-count; warn (don't silently pass) on over.
  if (tiles < N_TILES) {
    throw new Error(
      `only ${tiles}/${N_TILES} tiles after ${attempts} Ctrl+T — scene too small ` +
        `to measure; the comparison would understate the per-tile cost. ` +
        `Restore a denser session or lower nTiles deliberately.`,
    );
  }
  if (tiles > N_TILES) {
    console.error(
      `WARNING: scene has ${tiles} tiles, more than the requested ${N_TILES}; ` +
        `the table is labeled with the actual count (${tiles}).`,
    );
  }

  const ctr = JSON.parse(
    await ev(
      `(function(){var c=document.querySelector('[data-testid="canvas-container"]');var r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`,
    ),
  );

  const scenes = [];
  for (const rate of THROTTLE_RATES) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await sleep(300);
    for (const gesture of ["pan", "zoom"]) {
      const mag = gesture === "zoom" ? 8 : 18;
      const burstMs = [];
      const writes = [];
      // one warmup burst (discarded), then REPEATS measured; alternate drift
      // direction each burst so pan/zoom stay bounded over the run.
      await evAsync(`window.__burst('${gesture}', ${BURST}, ${ctr.x}, ${ctr.y}, ${mag}, 1)`);
      for (let r = 0; r < REPEATS; r++) {
        const dir = r % 2 === 0 ? 1 : -1;
        const res = JSON.parse(await evAsync(`window.__burst('${gesture}', ${BURST}, ${ctr.x}, ${ctr.y}, ${mag}, ${dir})`));
        burstMs.push(res.burstMs);
        writes.push(res.writes);
        await sleep(120);
      }
      const mb = +median(burstMs).toFixed(2);
      const mw = median(writes);
      const scene = {
        throttle: rate,
        gesture,
        burst: BURST,
        medianBurstMs: mb,
        perEventUs: +((mb * 1000) / BURST).toFixed(1),
        writesPerBurst: mw,
        framesBlocked: +(mb / VSYNC_60_MS).toFixed(2),
      };
      scenes.push(scene);
      console.error(
        `  ${rate}x ${gesture.padEnd(4)} burst=${mb}ms perEvent=${scene.perEventUs}µs ` +
          `writes=${mw} framesBlocked=${scene.framesBlocked}`,
      );
      await sleep(400);
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }

  const fmt = (v, w) => String(v).padStart(w);
  console.error(
    `\n  throttle gesture   burstMs  perEventµs   writes  framesBlocked   ` +
      `(${tiles} tiles, K=${BURST} events/burst)`,
  );
  console.error("  " + "-".repeat(74));
  for (const s of scenes) {
    console.error(
      "  " +
        fmt(s.throttle + "x", 6) + "   " + s.gesture.padEnd(6) + " " +
        fmt(s.medianBurstMs, 7) + "  " + fmt(s.perEventUs, 9) + "  " + fmt(s.writesPerBurst, 7) + "  " + fmt(s.framesBlocked, 11),
    );
  }
  console.error("");

  console.log(JSON.stringify({ nTiles: tiles, burst: BURST, repeats: REPEATS, scenes }, null, 2));
  cdp.close();
  process.exit(0);
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
