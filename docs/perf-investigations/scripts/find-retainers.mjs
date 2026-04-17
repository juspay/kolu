// Walk GC-root-to-target retainer paths for a heap-snapshot target class
// or node-name. Groups results by tail-of-path signature and prints one
// sample chain per signature, sorted by count — so the dominant retention
// shape is the first output.
//
// Usage:
//   node --max-old-space-size=8192 find-retainers.mjs snap.heapsnapshot <type> <name>
//
// Common invocations:
//   find-retainers.mjs snap.heapsnapshot native SVGRectElement
//   find-retainers.mjs snap.heapsnapshot closure debouncedFit
//   find-retainers.mjs snap.heapsnapshot object 'system / Context'
//
// Pair with `diff-heap.mjs` — that script points at the growing class,
// this one tells you what's holding onto it.
//
// Chapter 3 (#614) pattern to recognize in output:
//
//   ... → Object.getMetadata → native_bind → Object { observers: Array }
//   → Array[N] → Object { fn } → closure → Context chain
//   → <div data-tile-id=...> → ... → SVG etc
//
// That "native_bind → observers Array" signature means a SolidJS
// signal's subscriber list has accumulated unremoved observers — a
// Computation that should have disposed didn't. Walk up from `<div
// data-tile-id>` to find the inline handler (`$$click`, `$$pointerdown`,
// etc.) whose closure Context is the actual pin.

import fs from "node:fs";

if (process.argv.length < 5) {
  console.error("Usage: find-retainers.mjs <snap> <targetType> <targetName>");
  process.exit(1);
}
const [, , SNAP_PATH, TARGET_TYPE, TARGET_NAME] = process.argv;

const snap = JSON.parse(fs.readFileSync(SNAP_PATH, "utf8"));
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
  return et === "property" ||
    et === "internal" ||
    et === "shortcut" ||
    et === "weak"
    ? `${et}:${STR[en]}`
    : `${et}:[${en}]`;
}

// BFS from root (node 0), non-weak edges only.
const dist = new Int32Array(N).fill(-1);
const predNode = new Int32Array(N).fill(-1);
const predEdge = new Int32Array(N).fill(-1);
dist[0] = 0;
let queue = [0];
while (queue.length) {
  const nxt = [];
  for (const from of queue) {
    const start = off[from],
      cnt = NODES[from * NF + ecI];
    for (let k = 0; k < cnt; k++) {
      const eIdx = start + k;
      const et = eTypes[EDGES[eIdx * EF + etI]];
      if (et === "weak") continue;
      const to = EDGES[eIdx * EF + toI] / NF;
      if (to < 0 || to >= N || dist[to] >= 0) continue;
      dist[to] = dist[from] + 1;
      predNode[to] = from;
      predEdge[to] = eIdx;
      nxt.push(to);
    }
  }
  queue = nxt;
}

// Find target instances.
const targets = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === TARGET_TYPE &&
    STR[NODES[i * NF + nameI]] === TARGET_NAME
  ) {
    targets.push(i);
  }
}
console.log(`${TARGET_TYPE}:${TARGET_NAME} count: ${targets.length}`);

function pathOf(i) {
  const steps = [];
  let cur = i;
  while (predNode[cur] >= 0) {
    const eIdx = predEdge[cur],
      from = predNode[cur];
    const et = eTypes[EDGES[eIdx * EF + etI]],
      en = EDGES[eIdx * EF + enI];
    steps.unshift({
      from,
      to: cur,
      label: edgeLabel(et, en),
      fromDesc: desc(from),
    });
    cur = from;
  }
  return steps;
}

function isInteresting(d) {
  if (d.type === "synthetic" && !d.name) return false;
  if (d.type === "hidden") return false;
  if (d.type === "code") return false;
  if (d.name === "system / Context") return false;
  if (d.name === "system / Map") return false;
  if (d.name === "system / PropertyArray") return false;
  return true;
}

// Group by tail-of-path signature (last 8 interesting hops).
const byPath = new Map();
for (const t of targets) {
  const steps = pathOf(t);
  const sig = steps
    .filter((s) => isInteresting(s.fromDesc))
    .slice(-8)
    .map((s) => `${s.fromDesc.type}:${s.fromDesc.name}|${s.label}`)
    .join(" → ");
  if (!byPath.has(sig)) byPath.set(sig, []);
  byPath.get(sig).push(t);
}

console.log(`Distinct path signatures: ${byPath.size}\n`);
const sorted = [...byPath.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [_sig, members] of sorted.slice(0, 5)) {
  console.log(`\n=== ${members.length}× ${TARGET_NAME} ===`);
  const steps = pathOf(members[0]);
  console.log(`Sample (id=${desc(members[0]).id}):`);
  for (let j = 0; j < Math.min(steps.length, 30); j++) {
    const s = steps[j];
    const toDesc = desc(s.to);
    console.log(
      `  [${j}] ${s.fromDesc.type}:${s.fromDesc.name}  --${s.label}-->  ${toDesc.type}:${toDesc.name}`,
    );
  }
}
