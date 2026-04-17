// Go one more level up: what retains each native_bind closure holding a Dl?
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

// Find all native_bind closures and check: which ones have bound_this -> Dl (InputHandler)?
const bindsHoldingDl = [];
for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] !== "closure") continue;
  if (STR[NODES[i * NF + nameI]] !== "native_bind") continue;
  // Check bound_this points to a Dl
  const es = outgoing(i);
  const bt = es.find((e) => e.et === "internal" && STR[e.en] === "bound_this");
  if (!bt) continue;
  const btDesc = desc(bt.to);
  if (btDesc.type === "object" && btDesc.name === "Dl") {
    bindsHoldingDl.push(i);
  }
}
console.log(
  `native_bind closures with bound_this=Dl: ${bindsHoldingDl.length}`,
);

// For each, histogram level-1 retainers by (type:name via edge)
const hist = new Map();
for (const b of bindsHoldingDl) {
  for (const r of retainersOf(b)) {
    const fd = desc(r.from);
    const key = `${fd.type}:${fd.name} via ${edgeLabel(r.et, r.en)}`;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
}
console.log("\n=== Retainers of native_bind(Dl) closures ===");
for (const [k, c] of [...hist.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)) {
  console.log(`  ${k.padEnd(80)} × ${c}`);
}

// Sample chain: pick first native_bind, show full retainer chain
if (bindsHoldingDl.length > 0) {
  console.log(
    `\n=== Chain from first native_bind(Dl) id=${desc(bindsHoldingDl[0]).id} ===`,
  );
  let cur = bindsHoldingDl[0];
  const seen = new Set([cur]);
  for (let d = 1; d <= 20; d++) {
    const rets = retainersOf(cur);
    if (rets.length === 0) {
      console.log(`Depth ${d}: <GC root>`);
      break;
    }
    console.log(`Depth ${d}:`);
    for (const r of rets.slice(0, 5)) {
      const fd = desc(r.from);
      const mark = seen.has(r.from) ? " [visited]" : "";
      console.log(
        `  ${fd.type}:${fd.name} id=${fd.id} size=${fd.size}  via ${edgeLabel(r.et, r.en)}${mark}`,
      );
    }
    const picked =
      rets.find(
        (r) =>
          !seen.has(r.from) &&
          nTypes[NODES[r.from * NF + typeI]] !== "hidden" &&
          nTypes[NODES[r.from * NF + typeI]] !== "code" &&
          nTypes[NODES[r.from * NF + typeI]] !== "synthetic",
      ) || rets.find((r) => !seen.has(r.from));
    if (!picked) break;
    seen.add(picked.from);
    cur = picked.from;
    if (nTypes[NODES[cur * NF + typeI]] === "synthetic") break;
  }
}

// Also: class Ie, Ee, At — print outgoing edges
console.log(`\n=== Class Ie (sample, first instance) ===`);
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "Ie"
  ) {
    console.log(`Ie id=${NODES[i * NF + idI]}:`);
    for (const e of outgoing(i).slice(0, 12)) {
      const td = desc(e.to);
      console.log(`  -> ${td.type}:${td.name}  via ${edgeLabel(e.et, e.en)}`);
    }
    break;
  }
}
console.log(`\n=== Class Ee (sample, first instance) ===`);
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "Ee"
  ) {
    console.log(`Ee id=${NODES[i * NF + idI]}:`);
    for (const e of outgoing(i).slice(0, 12)) {
      const td = desc(e.to);
      console.log(`  -> ${td.type}:${td.name}  via ${edgeLabel(e.et, e.en)}`);
    }
    break;
  }
}
