// Count SolidJS reactive Owners, effects, and signals.
// SolidJS reactive nodes have specific shapes. We can identify by property patterns.
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
function desc(i) {
  return {
    i,
    id: NODES[i * NF + idI],
    size: NODES[i * NF + sizeI],
    type: nTypes[NODES[i * NF + typeI]],
    name: STR[NODES[i * NF + nameI]],
  };
}

// Solid signal shape: { value, observers, observerSlots, comparator?, name? }
// Solid computation (effect/memo): { fn, state, sources, sourceSlots, value, owner, owned, cleanups, ... }

// Helper: check if object has all required properties
function has(i, props) {
  const es = outgoing(i);
  const pset = new Set(
    es.filter((e) => e.et === "property").map((e) => STR[e.en]),
  );
  return props.every((p) => pset.has(p));
}

// Count signals: has "value" + "observers" + not "fn" (distinguishes from computations)
let signals = 0,
  computations = 0,
  owners = 0;
const computationProps = ["fn", "state", "sources"];
const signalProps = ["value", "observers"];
const ownerProps = ["owner", "owned", "cleanups"];

for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] !== "object") continue;
  const name = STR[NODES[i * NF + nameI]];
  if (name !== "Object") continue; // Solid uses plain objects
  const es = outgoing(i);
  const pset = new Set(
    es.filter((e) => e.et === "property").map((e) => STR[e.en]),
  );
  const isComp = computationProps.every((p) => pset.has(p));
  const isSignal = signalProps.every((p) => pset.has(p)) && !isComp;
  const isOwner = ownerProps.every((p) => pset.has(p));
  if (isComp) computations++;
  else if (isSignal) signals++;
  if (isOwner) owners++;
}
console.log(`SolidJS signals: ${signals}`);
console.log(`SolidJS computations (effects/memos): ${computations}`);
console.log(`SolidJS Owner nodes (owner/owned/cleanups shape): ${owners}`);

// For all signals, measure observer list size
const observerCounts = new Map(); // observer count -> how many signals have that
for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] !== "object") continue;
  const name = STR[NODES[i * NF + nameI]];
  if (name !== "Object") continue;
  const es = outgoing(i);
  const pset = new Set(
    es.filter((e) => e.et === "property").map((e) => STR[e.en]),
  );
  if (!(pset.has("value") && pset.has("observers"))) continue;
  if (pset.has("fn")) continue; // skip computations
  const obsEdge = es.find(
    (e) => e.et === "property" && STR[e.en] === "observers",
  );
  if (!obsEdge) continue;
  // The target might be a plain Array or system array
  const targetDesc = desc(obsEdge.to);
  if (targetDesc.name === "Array" || targetDesc.type === "array") {
    // Count its elements
    const elEdges = outgoing(obsEdge.to).filter(
      (e) => e.et === "element" || e.et === "internal",
    );
    // For plain Array, length is typically via element edges + an internal "elements" edge
    // Just count element edges
    const elCount = outgoing(obsEdge.to).filter(
      (e) => e.et === "element",
    ).length;
    observerCounts.set(elCount, (observerCounts.get(elCount) || 0) + 1);
  }
}
console.log("\n=== Observer count distribution (per signal) ===");
for (const [c, n] of [...observerCounts.entries()]
  .sort((a, b) => b[0] - a[0])
  .slice(0, 10)) {
  console.log(`  ${c.toString().padStart(4)} observers × ${n} signals`);
}

// Find signals with the MOST observers — likely candidates for leak target
console.log("\n=== Signals with 20+ observers ===");
const bigSignals = [];
for (let i = 0; i < N; i++) {
  if (nTypes[NODES[i * NF + typeI]] !== "object") continue;
  const name = STR[NODES[i * NF + nameI]];
  if (name !== "Object") continue;
  const es = outgoing(i);
  const pset = new Set(
    es.filter((e) => e.et === "property").map((e) => STR[e.en]),
  );
  if (!(pset.has("value") && pset.has("observers"))) continue;
  if (pset.has("fn")) continue;
  const obsEdge = es.find(
    (e) => e.et === "property" && STR[e.en] === "observers",
  );
  if (!obsEdge) continue;
  const obsTarget = obsEdge.to;
  const elEdges = outgoing(obsTarget).filter((e) => e.et === "element");
  if (elEdges.length >= 20) {
    bigSignals.push({ signal: i, obsCount: elEdges.length });
  }
}
bigSignals.sort((a, b) => b.obsCount - a.obsCount);
for (const b of bigSignals.slice(0, 10)) {
  const d = desc(b.signal);
  // Also look at what this signal's "value" is
  const valEdge = outgoing(b.signal).find(
    (e) => e.et === "property" && STR[e.en] === "value",
  );
  const valDesc = valEdge ? desc(valEdge.to) : null;
  console.log(
    `  Signal id=${d.id} observers=${b.obsCount}  value type=${valDesc?.type || "?"} name=${valDesc?.name || "?"}`,
  );
}
