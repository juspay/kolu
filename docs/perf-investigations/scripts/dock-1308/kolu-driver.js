// Reproduce #1308's JS event-loop stress against a REAL kolu (dev server).
// Instruments (pre-navigation): ResizeObserver fire count, --app-h setProperty
// count, a rAF frame-duration recorder, and (post-restore) a MutationObserver
// on tile `transform` writes. Then:
//   IDLE   — 8s, no action: does ResizeObserver keep firing? (resize→fit loop)
//   RESIZE — one viewport resize: does RO settle or sustain?
//   WHEEL  — a shift+wheel pan burst: frame jank + tile-transform writes + RO
//            fires per raw event (the per-wheel signal storm).
const CDP = require("chrome-remote-interface");
const URL = process.argv[2];
const PORT = parseInt(process.argv[3] || "9500", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INSTRUMENT = `
window.__m = { roFires: 0, appH: 0, frames: [], rec: false, _last: null, tileTx: 0 };
(function(){
  var NativeRO = window.ResizeObserver;
  window.ResizeObserver = function(cb){
    return new NativeRO(function(entries, obs){
      window.__m.roFires += entries.length;
      return cb(entries, obs);
    });
  };
  var sp = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(name){
    if (name === '--app-h') window.__m.appH++;
    return sp.apply(this, arguments);
  };
  function frame(t){
    if (window.__m.rec && window.__m._last != null) window.__m.frames.push(t - window.__m._last);
    window.__m._last = t;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
window.__startTileObs = function(){
  window.__m.tileTx = 0;
  var obs = new MutationObserver(function(muts){
    for (var i=0;i<muts.length;i++){ if (muts[i].attributeName === 'style') window.__m.tileTx++; }
  });
  document.querySelectorAll('[data-canvas-tile]').forEach(function(t){
    obs.observe(t, { attributes: true, attributeFilter: ['style'] });
  });
  return document.querySelectorAll('[data-canvas-tile]').length;
};
`;

async function evalJson(Runtime, expr) {
  const { result } = await Runtime.evaluate({ expression: expr, returnByValue: true });
  return result.value;
}

(async () => {
  const client = await CDP({ port: PORT });
  const { Page, Runtime, Input, Emulation } = client;
  await Page.enable();
  await Runtime.enable();
  await Page.addScriptToEvaluateOnNewDocument({ source: INSTRUMENT });
  await Page.navigate({ url: URL });
  await Page.loadEventFired();
  await sleep(4000);

  // Restore the saved session → real multi-terminal canvas.
  await evalJson(Runtime, `(function(){
    var b = document.querySelector('[data-testid="restore-session"]') || document.querySelector('[data-testid="session-restore"] button');
    if (b) b.click();
    return !!b;
  })()`);
  // Wait for tiles to mount.
  let tiles = 0;
  for (let i = 0; i < 40; i++) {
    tiles = await evalJson(Runtime, `document.querySelectorAll('[data-canvas-tile]').length`);
    if (tiles > 0) break;
    await sleep(500);
  }
  await sleep(3000); // let xterm + fit settle after restore

  // ── IDLE: does the resize→fit loop sustain with zero user action? ──
  await evalJson(Runtime, `(window.__m.roFires_idle0 = window.__m.roFires, window.__m.appH_idle0 = window.__m.appH, window.__m.rec=true, window.__m.frames=[], true)`);
  await sleep(8000);
  const idle = await evalJson(Runtime, `(function(){
    var f = window.__m.frames.slice();
    var long = f.filter(function(d){return d>20;}).length;
    return JSON.stringify({
      tiles: document.querySelectorAll('[data-canvas-tile]').length,
      xterm: document.querySelectorAll('.xterm').length,
      roFires_idle: window.__m.roFires - window.__m.roFires_idle0,
      appH_idle: window.__m.appH - window.__m.appH_idle0,
      frames: f.length, longFrames_gt20ms: long,
      avgFrameMs: f.length ? +(f.reduce(function(a,b){return a+b;},0)/f.length).toFixed(2) : null
    });
  })()`);

  // ── RESIZE: one viewport change; does RO settle or keep firing after? ──
  const roBeforeResize = await evalJson(Runtime, `window.__m.roFires`);
  await Emulation.setDeviceMetricsOverride({ width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const roRightAfter = await evalJson(Runtime, `window.__m.roFires`);
  await sleep(6000); // settle window — count fires AFTER the resize event
  const roSettle = await evalJson(Runtime, `window.__m.roFires`);
  const resize = { firesOnResize: roRightAfter - roBeforeResize, firesInSettleWindow: roSettle - roRightAfter };

  // ── WHEEL: shift+wheel pan burst (shift forces canvas-pan ownership). ──
  const nTiles = await evalJson(Runtime, `window.__startTileObs()`);
  // center of canvas-container
  const ctr = await evalJson(Runtime, `(function(){var c=document.querySelector('[data-testid="canvas-container"]');var r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  const { x, y } = JSON.parse(ctr);
  await evalJson(Runtime, `(window.__m.rec=true, window.__m.frames=[], window.__m.tileTx=0, window.__m.roFires_w0=window.__m.roFires, true)`);
  const N_WHEEL = 120;
  const t0 = await evalJson(Runtime, `performance.now()`);
  for (let i = 0; i < N_WHEEL; i++) {
    await Input.dispatchMouseEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: 18, modifiers: 8 /* shift */ });
    await sleep(6); // ~166 events/s, trackpad-fling cadence
  }
  await sleep(400);
  const wheel = await evalJson(Runtime, `(function(){
    var f = window.__m.frames.slice();
    var long = f.filter(function(d){return d>20;}).length;
    return JSON.stringify({
      wheelEvents: ${N_WHEEL},
      tileTransformWrites: window.__m.tileTx,
      roFiresDuring: window.__m.roFires - window.__m.roFires_w0,
      frames: f.length, longFrames_gt20ms: long,
      maxFrameMs: f.length ? +Math.max.apply(null,f).toFixed(1) : null,
      avgFrameMs: f.length ? +(f.reduce(function(a,b){return a+b;},0)/f.length).toFixed(2) : null
    });
  })()`);

  console.log(JSON.stringify({ idle: JSON.parse(idle), resize, wheel: JSON.parse(wheel), nTiles }, null, 2));
  await client.close();
})().catch((e) => { console.error(String(e)); process.exit(1); });
