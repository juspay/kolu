// For each orphaned Rn, find the shortest retainer chain to an object OUTSIDE xterm's own graph.
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

// Build a set of "xterm internal" class names to exclude
// These are short minified class names that appear in xterm's internal graph
const XTERM_CLASSES = new Set([
  "Rn",
  "Dl",
  "Qt",
  "xr",
  "yn",
  "xt2", // Terminal, InputHandler, WebglAddon, WebglRenderer, CoreBrowserTerminal, DI store
  "D", // generic EventEmitter
  "tE",
  "lU",
  "nE",
  "rE",
  "v3",
  "eE",
  "l4", // services
  "o",
  "ut",
  "j",
  "Ke",
  "it",
  "L", // addons
  "Fr",
  "Wi",
  "Ji",
  "$i",
  "zi", // more services from earlier
  "Ye",
  "pe",
  "he2",
  "ls",
  "Hi",
  "F", // more xterm internals
  "s11",
  "s12",
  "s13",
  "s14",
  "ss",
  "s2",
  "s3",
  "ye",
  "ys",
  "zt",
  "jt",
  "se",
  "ei",
  "hi",
  "ui",
  "be",
  "Xt",
  "Wt",
  // Also hidden/synthetic-style internals
]);

// "interesting" retainer = not xterm-internal, not V8 system, not code
function isInteresting(d) {
  if (d.type === "synthetic") return false;
  if (d.type === "hidden") return false;
  if (d.type === "code") return false;
  if (
    d.type === "string" ||
    d.type === "concatenated string" ||
    d.type === "sliced string"
  )
    return false;
  if (
    d.type === "array" &&
    (d.name === "" ||
      d.name === "(object elements)" ||
      d.name === "(object properties)")
  )
    return false;
  if (d.name === "system / Context") return false;
  if (d.name === "system / Map") return false;
  if (d.name === "system / PropertyArray") return false;
  if (d.name === "system / AccessorPair") return false;
  if (d.name === "(closure)") return false;
  if (XTERM_CLASSES.has(d.name)) return false;
  return true;
}

function shortestInterestingRetainer(startIdx, maxDepth = 15) {
  const q = [[startIdx, 0, []]];
  const visited = new Set([startIdx]);
  while (q.length) {
    const [cur, depth, path] = q.shift();
    if (depth > maxDepth) continue;
    const curDesc = desc(cur);
    if (depth > 0 && isInteresting(curDesc)) {
      return { found: cur, desc: curDesc, path };
    }
    const start = inOff[cur],
      end = inOff[cur + 1];
    for (let k = start; k < end; k++) {
      const from = inFrom[k];
      if (visited.has(from)) continue;
      visited.add(from);
      const eIdx = inEdge[k];
      const et = eTypes[EDGES[eIdx * EF + etI]];
      const en = EDGES[eIdx * EF + enI];
      q.push([
        from,
        depth + 1,
        [...path, { to: cur, label: edgeLabel(et, en) }],
      ]);
    }
  }
  return null;
}

// Find all Rn instances
const rns = [];
for (let i = 0; i < N; i++) {
  if (
    nTypes[NODES[i * NF + typeI]] === "object" &&
    STR[NODES[i * NF + nameI]] === "Rn"
  )
    rns.push(i);
}
console.log(`Rn instances: ${rns.length}`);

// For each, find shortest path to first interesting retainer
const pathHist = new Map();
for (const rn of rns) {
  const r = shortestInterestingRetainer(rn);
  if (!r) {
    pathHist.set(
      "<unreachable external>",
      (pathHist.get("<unreachable external>") || 0) + 1,
    );
    continue;
  }
  const key = `${r.desc.type}:${r.desc.name} at depth ${r.path.length}`;
  pathHist.set(key, (pathHist.get(key) || 0) + 1);
}
console.log("\n=== First non-xterm retainer for each Rn ===");
for (const [k, c] of [...pathHist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(60)} × ${c}`);
}

// Sample: print a full path for a sample Rn
console.log("\n=== Sample full paths for 3 Rn instances ===");
for (const rn of rns.slice(0, 3)) {
  const d = desc(rn);
  const r = shortestInterestingRetainer(rn);
  console.log(
    `\nRn id=${d.id} → first external retainer: ${r?.desc.type}:${r?.desc.name}`,
  );
  if (r) {
    console.log(`  Rn id=${d.id}`);
    for (const step of r.path) {
      const toDesc = desc(step.to);
      console.log(
        `    via ${step.label} (${toDesc.type}:${toDesc.name} id=${toDesc.id})`,
      );
    }
    console.log(
      `  FIRST EXTERNAL: ${r.desc.type}:${r.desc.name} id=${r.desc.id} size=${r.desc.size}`,
    );
  }
}
