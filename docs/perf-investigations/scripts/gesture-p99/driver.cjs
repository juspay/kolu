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
  var t1 = performance.now();
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  return JSON.stringify({ burstMs: +(t1-t0).toFixed(2), writes: window.__m.tileTx });
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
