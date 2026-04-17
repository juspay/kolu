// BFS forward from synthetic GC roots. Record shortest-distance predecessor
// per node. Then for each orphaned Rn, walk back to its GC root path.
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

// Find GC root nodes (index 0 is typically the root; synthetic (GC roots))
// In V8 heap snapshot, node 0 is the root node of type "synthetic" with
// outgoing edges to all root categories.
const rootNode = 0;
console.log(`Root node: ${JSON.stringify(desc(rootNode))}`);

// BFS forward, tracking shortest distance and predecessor + edge
const dist = new Int32Array(N).fill(-1);
const predNode = new Int32Array(N).fill(-1);
const predEdge = new Int32Array(N).fill(-1); // edge index
dist[rootNode] = 0;
let queue = [rootNode];
let nextQueue = [];
while (queue.length) {
  for (const from of queue) {
    const start = off[from],
      cnt = NODES[from * NF + ecI];
    for (let k = 0; k < cnt; k++) {
      const eIdx = start + k;
      const et = eTypes[EDGES[eIdx * EF + etI]];
      // Skip weak edges — they don't retain
      if (et === "weak") continue;
      const to = EDGES[eIdx * EF + toI] / NF;
      if (to < 0 || to >= N) continue;
      if (dist[to] >= 0) continue;
      dist[to] = dist[from] + 1;
      predNode[to] = from;
      predEdge[to] = eIdx;
      nextQueue.push(to);
    }
  }
  queue = nextQueue;
  nextQueue = [];
}
let maxDist = 0;
for (let i = 0; i < N; i++) if (dist[i] > maxDist) maxDist = dist[i];
console.error(`BFS done; farthest distance ${maxDist}`);

// For each Rn, walk back via predNode/predEdge to print the path
const rns = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "Rn"
  )
    rns.push(i);
}
console.log(`\nRn instances: ${rns.length}`);

// Group Rn by path-signature (path of edge labels) to find common retainer patterns
function pathOf(i) {
  const steps = [];
  let cur = i;
  while (predNode[cur] >= 0) {
    const eIdx = predEdge[cur];
    const from = predNode[cur];
    const et = eTypes[EDGES[eIdx * EF + etI]];
    const en = EDGES[eIdx * EF + enI];
    const fromDesc = desc(from);
    steps.unshift({
      from,
      to: cur,
      label: edgeLabel(et, en),
      fromType: fromDesc.type,
      fromName: fromDesc.name,
    });
    cur = from;
  }
  return steps;
}

// Print path signature (class names joined) for each Rn
const sigHist = new Map();
for (const rn of rns) {
  const steps = pathOf(rn);
  // Signature: first few class hops (skip synthetic/hidden/code/string)
  const sigSteps = steps.filter(
    (s) =>
      s.fromType !== "synthetic" &&
      s.fromType !== "hidden" &&
      s.fromType !== "code" &&
      s.fromType !== "string" &&
      s.fromType !== "concatenated string",
  );
  const sig = sigSteps
    .slice(0, 5)
    .map((s) => `${s.fromType}:${s.fromName}`)
    .join(" → ");
  if (!sigHist.has(sig)) sigHist.set(sig, []);
  sigHist.get(sig).push(rn);
}
console.log("\n=== Path signatures (first 5 non-system hops) ===");
for (const [sig, members] of [...sigHist.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  console.log(`\n(${members.length}× Rn):  ${sig}`);
}

// For the most common leak-signature, print one full path
const topSig = [...sigHist.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)[0];
console.log(`\n=== Full path for first Rn in most-common signature ===`);
const sample = topSig[1][0];
const sampleSteps = pathOf(sample);
for (const s of sampleSteps.slice(0, 40)) {
  console.log(
    `  ${s.fromType}:${s.fromName}  --${s.label}-->  (${desc(s.to).type}:${desc(s.to).name})`,
  );
}
