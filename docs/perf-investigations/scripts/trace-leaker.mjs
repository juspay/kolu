// Trace the two closures with external (non-Context-chain) retainers all the way up.
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

// Start from the two interesting closures: id=201867 (Array-retained) and id=663821 (Ge-retained)
// We need to find them by id
function findById(id) {
  for (let i = 0; i < N; i++) if (NODES[i * NF + idI] === id) return i;
  return -1;
}

function traceUp(startId, label, maxDepth = 15) {
  console.log(`\n=== Tracing up from id=${startId} (${label}) ===`);
  let cur = findById(startId);
  if (cur < 0) {
    console.log("not found");
    return;
  }
  const visited = new Set([cur]);
  for (let d = 1; d <= maxDepth; d++) {
    const rets = retainersOf(cur);
    if (rets.length === 0) {
      console.log(`  Depth ${d}: <GC root>`);
      break;
    }
    // Show all retainers first (so we see branches)
    console.log(`  Depth ${d}:`);
    for (const r of rets.slice(0, 6)) {
      const fd = desc(r.from);
      const marker = visited.has(r.from) ? " [visited]" : "";
      console.log(
        `    ${fd.type}:${fd.name} id=${fd.id} size=${fd.size}  via ${edgeLabel(r.et, r.en)}${marker}`,
      );
    }
    // Pick the first unvisited non-hidden non-code retainer
    const picked =
      rets.find(
        (r) =>
          !visited.has(r.from) &&
          nTypes[NODES[r.from * NF + typeI]] !== "hidden" &&
          nTypes[NODES[r.from * NF + typeI]] !== "code" &&
          nTypes[NODES[r.from * NF + typeI]] !== "synthetic",
      ) || rets.find((r) => !visited.has(r.from));
    if (!picked) {
      console.log(`  [no more unvisited retainers]`);
      break;
    }
    visited.add(picked.from);
    cur = picked.from;
    const fd = desc(cur);
    console.log(`  → following to ${fd.type}:${fd.name} id=${fd.id}`);
    if (
      fd.type === "synthetic" &&
      (fd.name === "(GC roots)" || fd.name.startsWith("(Global"))
    )
      break;
  }
}

traceUp(201867, "anon closure retained by Array");
traceUp(663821, "anon closure retained by Ge.value");

// Also: look at outgoing edges of a "Ge" class to understand what it is
console.log(`\n=== What is class Ge? (sampling first instance) ===`);
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "Ge"
  ) {
    console.log(
      `First Ge: id=${NODES[i * NF + idI]} size=${NODES[i * NF + sizeI]}`,
    );
    for (const e of outgoing(i)) {
      const td = desc(e.to);
      console.log(`  -> ${td.type}:${td.name} via ${edgeLabel(e.et, e.en)}`);
    }
    break;
  }
}
