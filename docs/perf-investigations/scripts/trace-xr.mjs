// Trace every branch from xr (WebglRenderer) that doesn't cycle back into Terminal's Context.
import fs from "node:fs";
const snap = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const m = snap.snapshot.meta;
const NF = m.node_fields.length,
  EF = m.edge_fields.length;
const nTypes = m.node_types[0],
  eTypes = m.edge_types[0];
const NODES = snap.nodes,
  EDGES = snap.edges,
  STR = snap.strings;
const N = NODES.length / NF;
const typeI = m.node_fields.indexOf("type"),
  nameI = m.node_fields.indexOf("name");
const idI = m.node_fields.indexOf("id"),
  sizeI = m.node_fields.indexOf("self_size");
const ecI = m.node_fields.indexOf("edge_count");
const etI = m.edge_fields.indexOf("type"),
  enI = m.edge_fields.indexOf("name_or_index"),
  toI = m.edge_fields.indexOf("to_node");
const off = new Uint32Array(N + 1);
{
  let o = 0;
  for (let i = 0; i < N; i++) {
    off[i] = o;
    o += NODES[i * NF + ecI];
  }
  off[N] = o;
}
function desc(i) {
  return {
    i,
    id: NODES[i * NF + idI],
    size: NODES[i * NF + sizeI],
    type: nTypes[NODES[i * NF + typeI]],
    name: STR[NODES[i * NF + nameI]],
  };
}
function edgeLabel(et, en) {
  const nm =
    et === "property" || et === "internal" || et === "shortcut" || et === "weak"
      ? STR[en]
      : `[${en}]`;
  return `${et}:${nm}`;
}
function outgoing(i) {
  const start = off[i],
    cnt = NODES[i * NF + ecI],
    out = [];
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    out.push({
      to: EDGES[eIdx * EF + toI] / NF,
      et: eTypes[EDGES[eIdx * EF + etI]],
      en: EDGES[eIdx * EF + enI],
    });
  }
  return out;
}
const inCount = new Uint32Array(N);
for (let e = 0; e < EDGES.length / EF; e++) {
  const to = EDGES[e * EF + toI] / NF;
  if (to >= 0 && to < N) inCount[to]++;
}
const inOff = new Uint32Array(N + 1);
{
  let o = 0;
  for (let i = 0; i < N; i++) {
    inOff[i] = o;
    o += inCount[i];
  }
  inOff[N] = o;
}
const inFrom = new Uint32Array(inOff[N]);
const inEdge = new Uint32Array(inOff[N]);
const inFill = new Uint32Array(N);
for (let from = 0; from < N; from++) {
  const start = off[from],
    cnt = NODES[from * NF + ecI];
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    const to = EDGES[eIdx * EF + toI] / NF;
    if (to >= 0 && to < N) {
      const pos = inOff[to] + inFill[to]++;
      inFrom[pos] = from;
      inEdge[pos] = eIdx;
    }
  }
}
function retainersOf(i) {
  const s = inOff[i],
    e = inOff[i + 1],
    out = [];
  for (let k = s; k < e; k++)
    out.push({
      from: inFrom[k],
      et: eTypes[EDGES[inEdge[k] * EF + etI]],
      en: EDGES[inEdge[k] * EF + enI],
    });
  return out;
}

function findById(id) {
  for (let i = 0; i < N; i++) if (NODES[i * NF + idI] === id) return i;
  return -1;
}

// Check Object id=184887 (which has property:instance pointing to xr)
const obj = findById(184887);
if (obj >= 0) {
  console.log(`=== Object id=184887 (retains xr via property:instance) ===`);
  const d = desc(obj);
  console.log(`  ${d.type}:${d.name} size=${d.size}`);
  console.log(`  Outgoing edges:`);
  for (const e of outgoing(obj)) {
    const td = desc(e.to);
    console.log(
      `    -> ${td.type}:${td.name} id=${td.id}  via ${edgeLabel(e.et, e.en)}`,
    );
  }
  console.log(`  Retainers:`);
  for (const r of retainersOf(obj)) {
    const fd = desc(r.from);
    console.log(
      `    ${fd.type}:${fd.name} id=${fd.id} size=${fd.size}  via ${edgeLabel(r.et, r.en)}`,
    );
  }
}

// Sanity: show what xterm's `xr` class (WebglRenderer) looks like
console.log(`\n=== xr instances (sample first 3, list outgoing) ===`);
let count = 0;
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "xr"
  ) {
    if (count++ >= 3) break;
    const d = desc(i);
    console.log(`\n  xr id=${d.id}:`);
    const edges = outgoing(i);
    for (const e of edges.slice(0, 12)) {
      const td = desc(e.to);
      console.log(`    -> ${td.type}:${td.name}  via ${edgeLabel(e.et, e.en)}`);
    }
  }
}

// Count all xr instances
let xrCount = 0;
for (let i = 0; i < N; i++)
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "xr"
  )
    xrCount++;
console.log(`\nTotal xr instances: ${xrCount}`);

// Now the real test: find all "WebglAddon"-class objects. The addon has a `_renderer` property pointing at xr.
// We need to find the class retaining xr via `_renderer`. Might be named something minified.
// Alternative: find any object with outgoing edge property:_renderer pointing at an xr.
console.log(`\n=== Objects with property:_renderer (likely WebglAddon) ===`);
let addonCount = 0;
const addonClasses = new Map();
for (let i = 0; i < N; i++) {
  const start = off[i],
    cnt = NODES[i * NF + ecI];
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    if (
      eTypes[EDGES[eIdx * EF + etI]] === "property" &&
      STR[EDGES[eIdx * EF + enI]] === "_renderer"
    ) {
      const d = desc(i);
      const name = `${d.type}:${d.name}`;
      addonClasses.set(name, (addonClasses.get(name) || 0) + 1);
      addonCount++;
      break;
    }
  }
}
console.log(`Total objects with ._renderer: ${addonCount}`);
for (const [k, c] of addonClasses.entries()) console.log(`  ${k} × ${c}`);
