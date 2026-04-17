// Look at the signal with 364 observers. Is it value=Object or terminalId string?
// Figure out what kind of signal this is by inspecting its value.
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
function findById(id) {
  for (let i = 0; i < N; i++) if (NODES[i * NF + idI] === id) return i;
  return -1;
}

// Signal id=170435 has 364 observers, value=Object
const sig = findById(170435);
console.log(`=== Signal id=170435 ===`);
console.log(`Outgoing:`);
for (const e of outgoing(sig).slice(0, 8)) {
  const td = desc(e.to);
  console.log(
    `  -> ${td.type}:${td.name}  via ${e.et}:${STR[e.en] || "[" + e.en + "]"}`,
  );
}
// Get value
const valEdge = outgoing(sig).find(
  (e) => e.et === "property" && STR[e.en] === "value",
);
if (valEdge) {
  const vd = desc(valEdge.to);
  console.log(`\nValue: ${vd.type}:${vd.name}`);
  console.log(`Value outgoing:`);
  for (const e of outgoing(valEdge.to).slice(0, 12)) {
    const td = desc(e.to);
    const en = STR[e.en] || `[${e.en}]`;
    console.log(`  -> ${td.type}:${td.name}  via ${e.et}:${en}`);
  }
}

// Sample observers
console.log(`\nObservers (sampled):`);
const obsEdge = outgoing(sig).find(
  (e) => e.et === "property" && STR[e.en] === "observers",
);
if (obsEdge) {
  const obsArr = obsEdge.to;
  const elEdges = outgoing(obsArr)
    .filter((e) => e.et === "element")
    .slice(0, 5);
  for (const e of elEdges) {
    const ed = desc(e.to);
    console.log(
      `  obs element[${e.en}] -> ${ed.type}:${ed.name} size=${ed.size}`,
    );
    // What's the observer's name property?
    const nameEdge = outgoing(e.to).find(
      (o) => o.et === "property" && STR[o.en] === "name",
    );
    if (nameEdge) {
      const nd = desc(nameEdge.to);
      console.log(`    (observer.name = "${nd.name}")`);
    }
    // Or look at its .fn property to see the function name
    const fnEdge = outgoing(e.to).find(
      (o) => o.et === "property" && STR[o.en] === "fn",
    );
    if (fnEdge) {
      const fd = desc(fnEdge.to);
      console.log(`    (observer.fn = ${fd.type}:${fd.name})`);
    }
  }
}
