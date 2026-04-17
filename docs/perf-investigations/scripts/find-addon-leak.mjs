// Find all addon wrappers (Object with {instance, dispose, isDisposed}) and trace upward.
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

// xterm's loadAddon wraps an addon into `{ instance, dispose, isDisposed }`.
// Find objects with all three of those properties.
const wrappers = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] !== "object" ||
    STR[NODES[i * NF + nameI]] !== "Object"
  )
    continue;
  const es = outgoing(i);
  let has_instance = false,
    has_dispose = false,
    has_isDisposed = false;
  let isDisposedVal = null;
  let instanceName = null;
  for (const e of es) {
    if (e.et === "property") {
      const pn = STR[e.en];
      if (pn === "instance") {
        has_instance = true;
        instanceName = STR[NODES[e.to * NF + nameI]];
      }
      if (pn === "dispose") has_dispose = true;
      if (pn === "isDisposed") {
        has_isDisposed = true;
        // Read the value directly
        const td = desc(e.to);
        isDisposedVal =
          td.type === "hidden" && td.name === "true"
            ? true
            : td.type === "hidden" && td.name === "false"
              ? false
              : null;
      }
    }
  }
  if (has_instance && has_dispose && has_isDisposed) {
    wrappers.push({ i, instanceName, isDisposed: isDisposedVal });
  }
}
console.log(`Addon wrappers found: ${wrappers.length}`);

// Count by instance class + isDisposed
const hist = new Map();
for (const w of wrappers) {
  const k = `${w.instanceName}|isDisposed=${w.isDisposed}`;
  hist.set(k, (hist.get(k) || 0) + 1);
}
console.log("\n=== Breakdown: {instanceClass|isDisposed} ===");
for (const [k, c] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(60)} × ${c}`);
}
