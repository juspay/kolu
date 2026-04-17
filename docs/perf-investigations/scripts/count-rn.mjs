import fs from "node:fs";
const snap = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const m = snap.snapshot.meta;
const NF = m.node_fields.length;
const nTypes = m.node_types[0];
const STR = snap.strings;
const NODES = snap.nodes;
const N = NODES.length / NF;
const typeI = m.node_fields.indexOf("type"),
  nameI = m.node_fields.indexOf("name");
const targets = ["Rn", "Dl", "Qt", "xr", "yn", "debouncedFit"];
const counts = Object.fromEntries(targets.map((t) => [t, 0]));
for (let i = 0; i < N; i++) {
  const type = nTypes[NODES[i * NF + typeI]];
  const name = STR[NODES[i * NF + nameI]];
  if (counts.hasOwnProperty(name) && (type === "object" || type === "closure"))
    counts[name]++;
}
console.log(`snapshot: ${process.argv[2]}`);
console.log(counts);
