import fs from "node:fs";

function load(path) {
  const snap = JSON.parse(fs.readFileSync(path, "utf8"));
  const m = snap.snapshot.meta;
  const NF = m.node_fields.length;
  const nTypes = m.node_types[0];
  const NODES = snap.nodes,
    STR = snap.strings;
  const N = NODES.length / NF;
  const typeI = m.node_fields.indexOf("type"),
    nameI = m.node_fields.indexOf("name"),
    sizeI = m.node_fields.indexOf("self_size");
  const byKey = new Map();
  for (let i = 0; i < N; i++) {
    const type = nTypes[NODES[i * NF + typeI]];
    const name = STR[NODES[i * NF + nameI]] || "";
    const size = NODES[i * NF + sizeI];
    const key = `${type}:${name}`;
    const e = byKey.get(key) || { count: 0, bytes: 0 };
    e.count++;
    e.bytes += size;
    byKey.set(key, e);
  }
  return byKey;
}

const A = load(process.argv[2]);
const B = load(process.argv[3]);
const keys = new Set([...A.keys(), ...B.keys()]);
const rows = [];
for (const k of keys) {
  const a = A.get(k) || { count: 0, bytes: 0 };
  const b = B.get(k) || { count: 0, bytes: 0 };
  rows.push({
    key: k,
    aCount: a.count,
    bCount: b.count,
    dCount: b.count - a.count,
    aBytes: a.bytes,
    bBytes: b.bytes,
    dBytes: b.bytes - a.bytes,
  });
}
rows.sort((x, y) => y.dBytes - x.dBytes);
console.log("Top 25 classes by byte growth:");
console.log("  dBytes        dCount   aCount→bCount   key");
for (const r of rows.slice(0, 25)) {
  if (r.dBytes <= 0) break;
  console.log(
    `  ${String(r.dBytes).padStart(10)}  ${String(r.dCount).padStart(7)}   ${String(r.aCount).padStart(6)} → ${String(r.bCount).padStart(6)}   ${r.key}`,
  );
}
console.log("\nTop 10 classes by COUNT growth (>=50 new instances):");
rows.sort((x, y) => y.dCount - x.dCount);
for (const r of rows.slice(0, 20)) {
  if (r.dCount < 50) break;
  console.log(
    `  Δcount=${String(r.dCount).padStart(6)}   Δbytes=${String(r.dBytes).padStart(10)}   ${r.aCount} → ${r.bCount}   ${r.key}`,
  );
}
