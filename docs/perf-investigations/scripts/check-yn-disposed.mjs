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

// For every yn (CoreBrowserTerminal), check _store._isDisposed
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
function getBool(i, prop) {
  const t = getPropTarget(i, prop);
  if (t < 0) return "<missing>";
  return STR[NODES[t * NF + nameI]];
}

const counts = { yn: { true: 0, false: 0, missing: 0 } };
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] !== "object" ||
    STR[NODES[i * NF + nameI]] !== "yn"
  )
    continue;
  const store = getPropTarget(i, "_store");
  if (store < 0) {
    counts.yn.missing++;
    continue;
  }
  const disposedVal = getBool(store, "_isDisposed");
  if (disposedVal === "true") counts.yn.true++;
  else if (disposedVal === "false") counts.yn.false++;
  else counts.yn.missing++;
}
console.log(`yn (CoreBrowserTerminal) _store._isDisposed distribution:`);
console.log(counts);

// Also Dl (InputHandler)
const dlCounts = { true: 0, false: 0, missing: 0 };
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] !== "object" ||
    STR[NODES[i * NF + nameI]] !== "Dl"
  )
    continue;
  // Dl might have _parsingStack or similar — let's find its disposable path
  // In xterm Dl is InputHandler; it extends Disposable and has a _store
  const store = getPropTarget(i, "_store");
  if (store < 0) {
    dlCounts.missing++;
    continue;
  }
  const disposedVal = getBool(store, "_isDisposed");
  if (disposedVal === "true") dlCounts.true++;
  else if (disposedVal === "false") dlCounts.false++;
  else dlCounts.missing++;
}
console.log(`\nDl (InputHandler) _store._isDisposed distribution:`);
console.log(dlCounts);
