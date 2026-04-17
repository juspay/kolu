// Only look at orphaned Rn (whose yn._store._isDisposed=true). Print the
// full root-to-node path for each via BFS.
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
function getPropTarget(i, prop) {
  const start = off[i],
    cnt = NODES[i * NF + ecI];
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    if (eTypes[EDGES[eIdx * EF + etI]] !== "property") continue;
    if (STR[EDGES[eIdx * EF + enI]] !== prop) continue;
    return EDGES[eIdx * EF + toI] / NF;
  }
  return -1;
}

// BFS from root, non-weak edges
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

// Find ORPHANED Rn: Rn whose _core (yn) has _store._isDisposed=true
const orphanedRns = [];
const liveRns = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] !== "object" ||
    STR[NODES[i * NF + nameI]] !== "Rn"
  )
    continue;
  const yn = getPropTarget(i, "_core");
  if (yn < 0) continue;
  const store = getPropTarget(yn, "_store");
  if (store < 0) continue;
  const isDisposedTarget = getPropTarget(store, "_isDisposed");
  if (isDisposedTarget < 0) continue;
  const name = STR[NODES[isDisposedTarget * NF + nameI]];
  if (name === "true") orphanedRns.push(i);
  else if (name === "false") liveRns.push(i);
}
console.log(`Orphaned Rn: ${orphanedRns.length}; Live Rn: ${liveRns.length}`);

function pathOf(i) {
  const steps = [];
  let cur = i;
  while (predNode[cur] >= 0) {
    const eIdx = predEdge[cur],
      from = predNode[cur];
    const et = eTypes[EDGES[eIdx * EF + etI]],
      en = EDGES[eIdx * EF + enI];
    const fromDesc = desc(from);
    steps.unshift({ from, to: cur, label: edgeLabel(et, en), fromDesc });
    cur = from;
  }
  return steps;
}

// For each orphan Rn, condense the path to interesting hops (skip synthetic/hidden/code)
function isInteresting(d) {
  if (d.type === "synthetic" && !d.name) return false;
  if (d.type === "hidden") return false;
  if (d.type === "code") return false;
  if (d.name === "system / Context") return false;
  if (d.name === "system / Map") return false;
  if (d.name === "system / PropertyArray") return false;
  return true;
}

// Group orphan Rn by path signature and print one full path for each signature
const byPath = new Map();
for (const rn of orphanedRns) {
  const steps = pathOf(rn);
  const sig = steps
    .filter((s) => isInteresting(s.fromDesc))
    .map((s) => `${s.fromDesc.type}:${s.fromDesc.name}`)
    .join(" → ");
  if (!byPath.has(sig)) byPath.set(sig, []);
  byPath.get(sig).push(rn);
}

console.log(`\nDistinct path signatures: ${byPath.size}`);
for (const [sig, members] of [...byPath.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  console.log(`\n===  ${members.length}× orphan Rn ===\n${sig}`);

  // Print the full path for the first
  const steps = pathOf(members[0]);
  console.log(`\n Sample path (id=${desc(members[0]).id}):`);
  for (let j = 0; j < Math.min(steps.length, 30); j++) {
    const s = steps[j];
    const toDesc = desc(s.to);
    console.log(
      `  [${j}] ${s.fromDesc.type}:${s.fromDesc.name}  --${s.label}-->  ${toDesc.type}:${toDesc.name}`,
    );
  }
}
