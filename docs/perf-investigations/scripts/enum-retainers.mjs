// Enumerate ALL retainers of the debouncedFit closure and follow each branch
// to its first non-system retainer.
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
    ec: NODES[i * NF + ecI],
  };
}
function edgeLabel(et, en) {
  const nm =
    et === "property" || et === "internal" || et === "shortcut" || et === "weak"
      ? STR[en]
      : `[${en}]`;
  return `${et}:${nm}`;
}

const inCount = new Uint32Array(N);
const EDGES_LEN = EDGES.length / EF;
for (let e = 0; e < EDGES_LEN; e++) {
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

// Find all closures named debouncedFit
const debouncedFits = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "closure" &&
    STR[NODES[i * NF + nameI]] === "debouncedFit"
  ) {
    debouncedFits.push(i);
  }
}
console.log(`closure:debouncedFit instances: ${debouncedFits.length}`);

// For each, list all retainers
for (let j = 0; j < Math.min(3, debouncedFits.length); j++) {
  const df = debouncedFits[j];
  const d = desc(df);
  console.log(`\n=== debouncedFit #${j} (id=${d.id}) retainers ===`);
  for (const r of retainersOf(df)) {
    const fd = desc(r.from);
    console.log(
      `  ${fd.type}:${fd.name} id=${fd.id} size=${fd.size}  via ${edgeLabel(r.et, r.en)}`,
    );
  }
}

// Histogram retainers of ALL debouncedFit
console.log(
  `\n=== Retainer-type histogram across all debouncedFit closures ===`,
);
const hist = new Map();
for (const df of debouncedFits) {
  for (const r of retainersOf(df)) {
    const fd = desc(r.from);
    const key = `${fd.type}:${fd.name} via ${edgeLabel(r.et, r.en)}`;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
}
for (const [k, c] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(80)} × ${c}`);
}

// Now also: find all ResizeObserver nodes and check what they retain
console.log(`\n=== ResizeObserver check ===`);
const ros = [];
for (let i = 0; i < N; i++) {
  const n = STR[NODES[i * NF + nameI]];
  if (n === "ResizeObserver") ros.push(i);
}
console.log(`ResizeObserver instances: ${ros.length}`);

// Examine what each ResizeObserver points to via its outgoing edges
for (const ro of ros.slice(0, 3)) {
  console.log(`\n  RO id=${desc(ro).id} outgoing edges:`);
  const start = off[ro],
    cnt = NODES[ro * NF + ecI];
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    const to = EDGES[eIdx * EF + toI] / NF;
    const td = desc(to);
    console.log(
      `    -> ${td.type}:${td.name} via ${edgeLabel(eTypes[EDGES[eIdx * EF + etI]], EDGES[eIdx * EF + enI])}`,
    );
  }
}

// Also: any closure named after `onResize`, `_fireOnCanvasResize`, etc.
console.log(`\n=== Possible ResizeObserver callbacks ===`);
const cbNames = new Set();
for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] === "closure") {
    const n = STR[NODES[i * NF + nameI]];
    if (/resize|Resize|fire/i.test(n)) cbNames.add(n);
  }
}
console.log(
  "Closure names with resize/fire in name:",
  [...cbNames].slice(0, 30),
);
