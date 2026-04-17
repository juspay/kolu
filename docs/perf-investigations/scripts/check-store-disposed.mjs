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
const idI = m.node_fields.indexOf("id");
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

// List all dr2 properties (first instance)
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "dr2"
  ) {
    console.log(`dr2 id=${NODES[i * NF + idI]} all properties:`);
    const start = off[i],
      cnt = NODES[i * NF + ecI];
    for (let k = 0; k < cnt; k++) {
      const eIdx = start + k;
      const to = EDGES[eIdx * EF + toI] / NF;
      const td = {
        type: nTypes[NODES[to * NF + typeI]],
        name: STR[NODES[to * NF + nameI]],
      };
      const et = eTypes[EDGES[eIdx * EF + etI]];
      const en = EDGES[eIdx * EF + enI];
      const label =
        et === "property" || et === "internal" ? STR[en] : `[${en}]`;
      console.log(`  ${et}:${label} -> ${td.type}:${td.name}`);
    }
    break;
  }
}

// Count dr2 by property _isDisposed
let counts = { true: 0, false: 0, missing: 0, totalDr2: 0 };
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] !== "object" ||
    STR[NODES[i * NF + nameI]] !== "dr2"
  )
    continue;
  counts.totalDr2++;
  const start = off[i],
    cnt = NODES[i * NF + ecI];
  let hasProp = false;
  for (let k = 0; k < cnt; k++) {
    const eIdx = start + k;
    const et = eTypes[EDGES[eIdx * EF + etI]];
    if (et !== "property") continue;
    const pname = STR[EDGES[eIdx * EF + enI]];
    if (pname !== "_isDisposed") continue;
    hasProp = true;
    const to = EDGES[eIdx * EF + toI] / NF;
    const tname = STR[NODES[to * NF + nameI]];
    if (tname === "true") counts.true++;
    else if (tname === "false") counts.false++;
    else counts.missing++;
    break;
  }
  if (!hasProp) counts.missing++;
}
console.log(`\n=== dr2 (DisposableStore) _isDisposed ===`);
console.log(counts);
