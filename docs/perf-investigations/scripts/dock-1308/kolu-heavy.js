// Heavy canvas: create ~N terminals (Ctrl+T), run opencode in most, then measure
// the wheel/zoom storm + idle resize behavior under real TUI load.
//   node kolu-heavy.js <url> <port> <N> <opencodeBin>
const fs = require("fs");
const CDP = require("chrome-remote-interface");
const URL = process.argv[2], PORT = parseInt(process.argv[3] || "9500", 10);
const N = parseInt(process.argv[4] || "20", 10);
const OPENCODE = process.argv[5];
const RUN_OC = parseInt(process.argv[6] || "15", 10); // how many run opencode
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INSTRUMENT = `
window.__m = { roFires:0, appH:0, frames:[], rec:false, _last:null, tileTx:0, _obs:null };
(function(){
  var NRO = window.ResizeObserver;
  window.ResizeObserver = function(cb){ return new NRO(function(e,o){ window.__m.roFires += e.length; return cb(e,o); }); };
  var sp = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(n){ if(n==='--app-h') window.__m.appH++; return sp.apply(this, arguments); };
  function fr(t){ if(window.__m.rec && window.__m._last!=null) window.__m.frames.push(t-window.__m._last); window.__m._last=t; requestAnimationFrame(fr); }
  requestAnimationFrame(fr);
})();
window.__obsTiles = function(){
  window.__m.tileTx=0; if(window.__m._obs) window.__m._obs.disconnect();
  window.__m._obs = new MutationObserver(function(ms){ for(var i=0;i<ms.length;i++) if(ms[i].attributeName==='style') window.__m.tileTx++; });
  document.querySelectorAll('[data-canvas-tile]').forEach(function(t){ window.__m._obs.observe(t,{attributes:true,attributeFilter:['style']}); });
  return document.querySelectorAll('[data-canvas-tile]').length;
};
window.__tileRects = function(){ return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[data-canvas-tile]'), function(t){ var r=t.getBoundingClientRect(); return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)}; })); };
`;
async function ev(R,e){ const {result}=await R.evaluate({expression:e,returnByValue:true}); return result.value; }
async function ctrlT(Input){ for (const type of ["keyDown","keyUp"]) await Input.dispatchKeyEvent({type, modifiers:2, key:"t", code:"KeyT", windowsVirtualKeyCode:84}); }
async function click(Input,x,y){ await Input.dispatchMouseEvent({type:"mousePressed",x,y,button:"left",clickCount:1}); await Input.dispatchMouseEvent({type:"mouseReleased",x,y,button:"left",clickCount:1}); }
async function key(Input,k,code,vk){ for(const type of ["keyDown","keyUp"]) await Input.dispatchKeyEvent({type,key:k,code,windowsVirtualKeyCode:vk}); }

async function storm(Input,R,x,y,modifiers,deltaY,label){
  await ev(R,`(window.__m.rec=true, window.__m.frames=[], window.__obsTiles(), window.__m.roFires_s=window.__m.roFires, true)`);
  const NW=120;
  for(let i=0;i<NW;i++){ await Input.dispatchMouseEvent({type:"mouseWheel",x,y,deltaX:0,deltaY,modifiers}); await sleep(6); }
  await sleep(400);
  return JSON.parse(await ev(R,`(function(){var f=window.__m.frames.slice();var long=f.filter(function(d){return d>20;}).length;
    return JSON.stringify({label:'${label}', tiles:document.querySelectorAll('[data-canvas-tile]').length, wheelEvents:${NW},
      tileTransformWrites:window.__m.tileTx, roFiresDuring:window.__m.roFires-window.__m.roFires_s, frames:f.length,
      longFrames_gt20ms:long, maxFrameMs:f.length?+Math.max.apply(null,f).toFixed(1):null,
      avgFrameMs:f.length?+(f.reduce(function(a,b){return a+b;},0)/f.length).toFixed(2):null});})()`));
}

(async () => {
  const client = await CDP({ port: PORT });
  const { Page, Runtime, Input } = client;
  await Page.enable(); await Runtime.enable();
  await Page.addScriptToEvaluateOnNewDocument({ source: INSTRUMENT });
  await Page.navigate({ url: URL }); await Page.loadEventFired(); await sleep(4000);
  await ev(Runtime, `(function(){var b=document.querySelector('[data-testid="restore-session"]'); if(b)b.click();})()`); await sleep(2500);

  // Create until ~N tiles.
  let tiles = await ev(Runtime, `document.querySelectorAll('[data-canvas-tile]').length`);
  let attempts = 0;
  while (tiles < N && attempts < N * 2) {
    await ctrlT(Input); attempts++;
    await sleep(750);
    tiles = await ev(Runtime, `document.querySelectorAll('[data-canvas-tile]').length`);
  }
  await sleep(2000);
  console.error(`created: ${tiles} tiles in ${attempts} attempts`);

  // Run opencode in the first RUN_OC tiles (type the full path + Enter).
  if (OPENCODE && tiles > 0) {
    const rects = JSON.parse(await ev(Runtime, `window.__tileRects()`));
    const n = Math.min(RUN_OC, rects.length);
    for (let i = 0; i < n; i++) {
      const r = rects[i];
      await click(Input, r.x + Math.round(r.w/2), r.y + 70); // body, below titlebar
      await sleep(120);
      await Input.insertText({ text: OPENCODE });
      await key(Input, "Enter", "Enter", 13);
      await sleep(180);
    }
    console.error(`typed opencode into ${n} tiles; booting...`);
    await sleep(12000); // let opencode TUIs come up + redraw
  }

  // IDLE under load: do RO/fit oscillate now that terminals are busy?
  await ev(Runtime, `(window.__m.roFires_i=window.__m.roFires, window.__m.appH_i=window.__m.appH, window.__m.rec=true, window.__m.frames=[], true)`);
  await sleep(8000);
  const idle = JSON.parse(await ev(Runtime, `(function(){var f=window.__m.frames.slice();return JSON.stringify({
    tiles:document.querySelectorAll('[data-canvas-tile]').length, xterm:document.querySelectorAll('.xterm').length,
    roFires_idle:window.__m.roFires-window.__m.roFires_i, appH_idle:window.__m.appH-window.__m.appH_i,
    longFrames_gt20ms:f.filter(function(d){return d>20;}).length,
    avgFrameMs:f.length?+(f.reduce(function(a,b){return a+b;},0)/f.length).toFixed(2):null });})()`));

  const { data } = await Page.captureScreenshot({ format: "png" });
  fs.writeFileSync("/tmp/kolu-heavy.png", Buffer.from(data, "base64"));

  // Storms at the real tile count.
  const pan = await storm(Input, Runtime, 850, 520, 8, 18, "pan");
  await sleep(800);
  const zoom = await storm(Input, Runtime, 850, 520, 2, 8, "zoom");

  console.log(JSON.stringify({ tiles, idle, pan, zoom }, null, 2));
  await client.close();
})().catch((e) => { console.error(String(e)); process.exit(1); });
