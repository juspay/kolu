/**
 * #1754 — empirical characterization of Node `fs.watch` on THIS host.
 *
 * The deterministic repros model a DROPPED fs.watch edge (what macOS kqueue
 * does to an append landing right after attach). This probe measures how often
 * *real* inotify on this Linux box actually drops the terminal edge under a
 * fast-turn write pattern, driving a faithful mini-watcher: `fs.watch` + the
 * same 150 ms trailing debounce + a last-line read, exactly the shape the grok
 * watcher uses.
 *
 * Each trial is one "fast turn": write the open-turn line (`thinking`), attach,
 * let the attach-time read settle, then append the terminal line (`waiting`)
 * after a short jitter — and NEVER write again (the turn is over, the agent is
 * idle). If inotify drops/coalesces that terminal edge such that the debounced
 * read never re-runs, the observed state strands on `thinking`.
 *
 * Run: node repro-1754/linux-fswatch-probe.mjs [trials] [maxJitterMs]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TRIALS = Number(process.argv[2] ?? 300);
const MAX_JITTER_MS = Number(process.argv[3] ?? 12);
const DEBOUNCE_MS = 150; // matches the real watchers
const SETTLE_MS = 400; // quiet window after the terminal append

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastState(file) {
  // Mimic a tail read: last non-empty JSON line's `state`.
  const txt = fs.readFileSync(file, "utf8");
  const lines = txt.split("\n").filter((l) => l.trim());
  const last = lines.at(-1);
  return last ? JSON.parse(last).state : null;
}

async function trial(dir, i) {
  const file = path.join(dir, `turn-${i}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({ state: "thinking" })}\n`);

  let observed = "thinking"; // attach-time read
  let debounce = null;
  let edges = 0;
  const watcher = fs.watch(file, () => {
    edges++;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      observed = lastState(file);
    }, DEBOUNCE_MS);
  });

  // Attach-time read already happened (observed = thinking). Now the fast
  // turn completes: terminal append after a short jitter, then silence.
  const jitter = i % (MAX_JITTER_MS + 1);
  await sleep(jitter);
  fs.appendFileSync(file, `${JSON.stringify({ state: "waiting" })}\n`);

  await sleep(SETTLE_MS);
  watcher.close();
  if (debounce) clearTimeout(debounce);

  return { observed, edges, stranded: observed !== "waiting" };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-1754-probe-"));
  console.log(
    `host: ${os.platform()} ${os.release()}  node: ${process.version}`,
  );
  console.log(
    `trials: ${TRIALS}  jitter: 0..${MAX_JITTER_MS}ms  debounce: ${DEBOUNCE_MS}ms\n`,
  );

  let stranded = 0;
  let zeroEdge = 0;
  for (let i = 0; i < TRIALS; i++) {
    const r = await trial(dir, i);
    if (r.stranded) stranded++;
    if (r.edges === 0) zeroEdge++;
  }
  fs.rmSync(dir, { recursive: true, force: true });

  const pct = ((stranded / TRIALS) * 100).toFixed(1);
  console.log(
    `stranded 'thinking' (terminal edge missed): ${stranded}/${TRIALS} (${pct}%)`,
  );
  console.log(
    `trials where NO edge ever fired for the append: ${zeroEdge}/${TRIALS}`,
  );
  console.log(
    "\nInterpretation: a non-zero stranded count is a real end-to-end #1754",
  );
  console.log(
    "reproduction on THIS host. Zero means inotify delivered every terminal",
  );
  console.log(
    "edge on this run — the architectural gap still stands (the deterministic",
  );
  console.log(
    "vitest repros model the dropped edge macOS kqueue produces), but it did",
  );
  console.log("not surface statistically here this run.");
}

main();
