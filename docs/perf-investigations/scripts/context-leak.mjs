// Enumerate all closures in a Terminal's Context and find which is retained externally.
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

// Incoming map
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

// Step 1: Pick a debouncedFit closure; find its Context; enumerate ALL closures living in that Context
const debouncedFits = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "closure" &&
    STR[NODES[i * NF + nameI]] === "debouncedFit"
  ) {
    debouncedFits.push(i);
  }
}
console.log(`debouncedFit count: ${debouncedFits.length}`);

// For first debouncedFit, find Context
const dfFirst = debouncedFits[0];
const dfCtx = outgoing(dfFirst).find(
  (e) => e.et === "internal" && STR[e.en] === "context",
)?.to;
if (!dfCtx) {
  console.log("no context found");
  process.exit(1);
}
const ctxDesc = desc(dfCtx);
console.log(
  `Context for first debouncedFit: ${ctxDesc.type}:${ctxDesc.name} id=${ctxDesc.id}`,
);

// Find all closures whose "context" points to this Context
const closuresInCtx = [];
for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] !== "closure") continue;
  const eds = outgoing(i);
  for (const ed of eds) {
    if (ed.et === "internal" && STR[ed.en] === "context" && ed.to === dfCtx) {
      closuresInCtx.push(i);
      break;
    }
  }
}
console.log(
  `\nClosures living in this Terminal's Context: ${closuresInCtx.length}`,
);
for (const cl of closuresInCtx) {
  const d = desc(cl);
  console.log(`  closure:${d.name || "<anon>"} id=${d.id} size=${d.size}`);
}

// For each closure, find retainers OTHER than the Context itself
console.log(
  `\n=== Retainer-chains for each closure (excluding the shared Context) ===`,
);
for (const cl of closuresInCtx) {
  const d = desc(cl);
  const rets = retainersOf(cl).filter((r) => r.from !== dfCtx);
  console.log(`\ncloure:${d.name || "<anon>"} id=${d.id}`);
  console.log(`  External retainers: ${rets.length}`);
  for (const r of rets.slice(0, 5)) {
    const fd = desc(r.from);
    console.log(
      `    ${fd.type}:${fd.name} id=${fd.id} via ${edgeLabel(r.et, r.en)}`,
    );
  }
}

// Also: the Context itself — what retains it (other than its own closures)?
console.log(
  `\n=== What retains Context id=${ctxDesc.id} (other than its closures)? ===`,
);
const ctxRets = retainersOf(dfCtx).filter(
  (r) => !closuresInCtx.includes(r.from),
);
// But closures that ARE in the context will retain it via their internal:context edge, which is what we want to exclude.
// Count unique retainer types
const ctxHist = new Map();
for (const r of ctxRets) {
  const fd = desc(r.from);
  const key = `${fd.type}:${fd.name} via ${edgeLabel(r.et, r.en)}`;
  ctxHist.set(key, (ctxHist.get(key) || 0) + 1);
}
console.log(`Total non-local-closure retainers: ${ctxRets.length}`);
for (const [k, c] of [...ctxHist.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)) {
  console.log(`  ${k.padEnd(80)} × ${c}`);
}
