// Focused trace: show EXACT retainers of each Rn (Terminal) instance, then
// find which scrollLock objects exist and what retains them.
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

// Build incoming-edge index
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
  const start = inOff[i],
    end = inOff[i + 1];
  const out = [];
  for (let k = start; k < end; k++) {
    const from = inFrom[k],
      eIdx = inEdge[k];
    out.push({
      from,
      et: eTypes[EDGES[eIdx * EF + etI]],
      en: EDGES[eIdx * EF + enI],
    });
  }
  return out;
}

// === Find scrollLock objects: plain "Object" with property:attachToTerminal ===
const scrollLocks = [];
for (let i = 0; i < N; i++) {
  const t = nTypes[NODES[i * NF + typeI]];
  const n = STR[NODES[i * NF + nameI]];
  if (t !== "object") continue;
  if (n !== "Object") continue;
  // Check its edges for property:attachToTerminal
  const start = off[i],
    cnt = NODES[i * NF + ecI];
  let hasAttach = false;
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    if (
      eTypes[EDGES[eIdx * EF + etI]] === "property" &&
      STR[EDGES[eIdx * EF + enI]] === "attachToTerminal"
    ) {
      hasAttach = true;
      break;
    }
  }
  if (hasAttach) scrollLocks.push(i);
}
console.log(
  `scrollLock objects (plain Object with property:attachToTerminal): ${scrollLocks.length}`,
);
// Also the unique return-shape from createScrollLock has writeData etc.

// === Find Rn (xterm Terminal) instances ===
const rns = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "Rn"
  )
    rns.push(i);
}
console.log(`Rn (xterm Terminal) instances: ${rns.length}`);

// === For each scrollLock, find retainers (level 1) ===
console.log(
  `\n=== What retains the ${scrollLocks.length} scrollLock objects? ===`,
);
const slLvl1Hist = new Map();
for (const sl of scrollLocks) {
  for (const r of retainersOf(sl)) {
    const fd = desc(r.from);
    const key = `${fd.type}:${fd.name} via ${edgeLabel(r.et, r.en)}`;
    slLvl1Hist.set(key, (slLvl1Hist.get(key) || 0) + 1);
  }
}
for (const [k, c] of [...slLvl1Hist.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)) {
  console.log(`  ${k.padEnd(80)} × ${c}`);
}

// === For ONE scrollLock, trace upward through its retainer chain ===
console.log(
  `\n=== Tracing full retainer chain for FIRST scrollLock (id=${desc(scrollLocks[0]).id}) ===`,
);
let cur = scrollLocks[0];
const seen = new Set([cur]);
const MAX_DEPTH = 20;
for (let d = 1; d <= MAX_DEPTH; d++) {
  const rets = retainersOf(cur);
  if (rets.length === 0) {
    console.log(`Depth ${d}: <no retainers - GC root>`);
    break;
  }
  // Pick first non-visited, prefer non-synthetic
  const picked =
    rets.find(
      (r) =>
        !seen.has(r.from) &&
        nTypes[NODES[r.from * NF + typeI]] !== "hidden" &&
        nTypes[NODES[r.from * NF + typeI]] !== "code",
    ) || rets.find((r) => !seen.has(r.from));
  if (!picked) {
    console.log(`Depth ${d}: all retainers visited, cycle/stop`);
    break;
  }
  const fd = desc(picked.from);
  console.log(
    `Depth ${d}: ${fd.type}:${fd.name} id=${fd.id} size=${fd.size}  via ${edgeLabel(picked.et, picked.en)}`,
  );
  seen.add(picked.from);
  cur = picked.from;
  if (
    fd.type === "synthetic" &&
    (fd.name === "(GC roots)" || fd.name === "(Global handles)")
  )
    break;
}

// === For ONE Rn, trace upward ===
console.log(
  `\n=== Tracing full retainer chain for FIRST Rn (id=${desc(rns[0]).id}) ===`,
);
cur = rns[0];
const seen2 = new Set([cur]);
for (let d = 1; d <= MAX_DEPTH; d++) {
  const rets = retainersOf(cur);
  if (rets.length === 0) {
    console.log(`Depth ${d}: <no retainers - GC root>`);
    break;
  }
  const picked =
    rets.find(
      (r) =>
        !seen2.has(r.from) &&
        nTypes[NODES[r.from * NF + typeI]] !== "hidden" &&
        nTypes[NODES[r.from * NF + typeI]] !== "code",
    ) || rets.find((r) => !seen2.has(r.from));
  if (!picked) break;
  const fd = desc(picked.from);
  console.log(
    `Depth ${d}: ${fd.type}:${fd.name} id=${fd.id} size=${fd.size}  via ${edgeLabel(picked.et, picked.en)}`,
  );
  seen2.add(picked.from);
  cur = picked.from;
  if (fd.type === "synthetic") break;
}
