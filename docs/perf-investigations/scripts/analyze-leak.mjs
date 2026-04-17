// Thorough retainer walk: find what pins xterm Terminal graphs after dispose.
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
const ecI = m.node_fields.indexOf("edge_count"),
  detI = m.node_fields.indexOf("detachedness");
const etI = m.edge_fields.indexOf("type"),
  enI = m.edge_fields.indexOf("name_or_index"),
  toI = m.edge_fields.indexOf("to_node");

const off = new Uint32Array(N + 1);
let o = 0;
for (let i = 0; i < N; i++) {
  off[i] = o;
  o += NODES[i * NF + ecI];
}
off[N] = o;

function desc(i) {
  return {
    i,
    id: NODES[i * NF + idI],
    size: NODES[i * NF + sizeI],
    type: nTypes[NODES[i * NF + typeI]],
    name: STR[NODES[i * NF + nameI]],
    ec: NODES[i * NF + ecI],
    det: NODES[i * NF + detI],
  };
}

function edgeLabel(et, en) {
  const name =
    et === "property" || et === "internal" || et === "shortcut" || et === "weak"
      ? STR[en]
      : `[${en}]`;
  return `${et}:${name}`;
}

// Step 1: Find xterm service instances by name+type.
// We previously identified: tE=CharSizeService, lU=AtlasPage, v3/rE/nE=other services.
// Let's enumerate all "object:XX" nodes where XX is short (minified) and look at counts.
const classCount = new Map();
for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] === "object") {
    const name = STR[NODES[i * NF + nameI]];
    if (/^[a-zA-Z_$][a-zA-Z_$0-9]{0,4}$/.test(name) && name.length <= 4) {
      classCount.set(name, (classCount.get(name) || 0) + 1);
    }
  }
}
// Show top 30 classes with 20+ instances (candidates for xterm internal classes)
console.log("=== Minified object classes with 15+ instances ===");
const topClasses = [...classCount.entries()]
  .filter(([_, c]) => c >= 15)
  .sort((a, b) => b[1] - a[1]);
for (const [name, c] of topClasses.slice(0, 40)) {
  console.log(`  ${name.padEnd(6)} × ${c}`);
}

// Step 2: Pick "tE" as anchor (known CharSizeService). Walk retainers upward.
const anchorName = "Rn";
const anchors = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === anchorName
  ) {
    anchors.push(i);
  }
}
console.log(`\n=== Anchor: object:${anchorName} × ${anchors.length} ===`);

// Build global reverse map, just once (streaming not needed — we have memory for 37M).
// Map structured as Uint32Array flat, but easier as Map per target.
// For our size (~700k nodes, 2.5M edges), a flat approach is fine.
// Build incoming edge count per node first, then populate.
console.error("Building incoming-edge index...");
const incomingCount = new Uint32Array(N);
const EDGES_LEN = EDGES.length / EF;
for (let e = 0; e < EDGES_LEN; e++) {
  const to = EDGES[e * EF + toI] / NF;
  if (to >= 0 && to < N) incomingCount[to]++;
}
const incomingOff = new Uint32Array(N + 1);
let io = 0;
for (let i = 0; i < N; i++) {
  incomingOff[i] = io;
  io += incomingCount[i];
}
incomingOff[N] = io;
const incomingFrom = new Uint32Array(io); // source node
const incomingEdge = new Uint32Array(io); // edge index
const incomingFill = new Uint32Array(N);
for (let from = 0; from < N; from++) {
  const start = off[from],
    cnt = NODES[from * NF + ecI];
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    const to = EDGES[eIdx * EF + toI] / NF;
    if (to >= 0 && to < N) {
      const pos = incomingOff[to] + incomingFill[to]++;
      incomingFrom[pos] = from;
      incomingEdge[pos] = eIdx;
    }
  }
}
console.error(`Incoming index: ${io} reverse edges.`);

function retainersOf(nodeIdx) {
  const start = incomingOff[nodeIdx],
    end = incomingOff[nodeIdx + 1];
  const out = [];
  for (let k = start; k < end; k++) {
    const from = incomingFrom[k],
      eIdx = incomingEdge[k];
    const et = eTypes[EDGES[eIdx * EF + etI]],
      en = EDGES[eIdx * EF + enI];
    out.push({ from, et, en });
  }
  return out;
}

// Step 3: Walk upward from tE anchors, classifying each retainer level.
// At each level, histogram retainer (type:name) and show dominant chains.
// Stop at GC roots OR when we find a non-minified, non-system Kolu-owned name.

function isInteresting(d) {
  // Filter out system/synthetic nodes from "who really retains this"
  if (d.type === "synthetic") return false;
  if (d.type === "hidden") return false;
  if (d.type === "code") return false;
  if (
    d.type === "concatenated string" ||
    d.type === "string" ||
    d.type === "sliced string"
  )
    return false;
  if (d.name === "(GC roots)" || d.name === "(Traced handles)") return false;
  return true;
}

function isKoluSignal(d) {
  // Solid signals create objects with specific internal shape; in minified build they're often named
  // `Ot`, `Ct`, etc. Hard to distinguish. But "object:Object" with property "value" + "observers"
  // is a SolidJS SignalState.
  // For now: flag names that look like JS-standard (Object, Array, Map, Set, WeakMap, WeakSet, Promise)
  return [
    "Object",
    "Array",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Promise",
    "Function",
  ].includes(d.name);
}

// BFS upward, tracking dominant retainer classes at each depth
console.log(
  `\n=== Upward retainer walk from ${anchors.length}× object:${anchorName} ===\n`,
);
let frontier = new Set(anchors);
const visited = new Set(anchors);
const MAX_DEPTH = 12;
for (let depth = 1; depth <= MAX_DEPTH; depth++) {
  const nextFrontier = new Set();
  const histogram = new Map(); // "type:name" -> { count, edges, samples: [nodeIdx, ...] }
  for (const node of frontier) {
    for (const r of retainersOf(node)) {
      const fd = desc(r.from);
      const key = `${fd.type}:${fd.name}`;
      if (!histogram.has(key))
        histogram.set(key, { count: 0, edges: new Set(), samples: [] });
      const h = histogram.get(key);
      h.count++;
      h.edges.add(edgeLabel(r.et, r.en));
      if (h.samples.length < 3 && !h.samples.includes(r.from))
        h.samples.push(r.from);
      if (!visited.has(r.from)) {
        visited.add(r.from);
        nextFrontier.add(r.from);
      }
    }
  }
  // Print top entries at this depth
  const sorted = [...histogram.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  console.log(
    `Depth ${depth}: ${nextFrontier.size} new retainers; top retainer classes:`,
  );
  for (const [key, info] of sorted) {
    const edges = [...info.edges].slice(0, 3).join(", ");
    console.log(
      `  ${key.padEnd(45)} × ${String(info.count).padStart(4)}  via ${edges}`,
    );
  }
  if (nextFrontier.size === 0) {
    console.log("  (reached GC roots)");
    break;
  }
  frontier = nextFrontier;
}
