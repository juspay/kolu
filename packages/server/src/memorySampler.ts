/**
 * The server's process-memory sampler — the sole writer of the `processMemory`
 * surface cell that feeds the chrome bar's rail.
 *
 * Every tick it reads its OWN resident-set size (`process.memoryUsage().rss`,
 * always available — it's measuring itself) and FOLDS IN padi's `{ padi, kaval }`
 * reading, read off the re-served padi surface. The client adds its own JS-heap
 * figure locally (off `performance.memory`), so it never rides this cell.
 *
 * W2.2 shape: kaval runs inside the padi PROCESS now, so kolu-server no longer
 * polls kaval directly. padi owns the per-host readout — it samples its own RSS
 * and its kaval's, publishing the honest three-way pair on
 * `padiSurface.processMemory`. This sampler reads that pair each tick (`padiMemory`)
 * and publishes all three processes on ONE cell so the rail reads a single source.
 * When padi is down the reading is `null`, and both `padi`/`kaval` publish as
 * `absent` — the honest "no process to measure", never a fake zero.
 *
 * Memory churns byte-by-byte, but the rail renders whole megabytes. The cell's
 * backing store and its whole-MB `equals` (the dedup that drops every set which
 * doesn't move a displayed MB) live beside the cell definition in `surface.ts`,
 * not here.
 */

import type { PadiProcessMemory } from "@kolu/padi/surface";
import type { ProcessMemory } from "kolu-common/surface";

/** The seams the sampler reads/writes through — injected so a unit test can drive
 *  the padi-down / padi-up branches without a real bound padi. */
export interface MemorySamplerDeps {
  /** This process's RSS in bytes — `process.memoryUsage().rss`. */
  serverRss: () => number;
  /** padi's `{ padi, kaval }` reading off the re-served padi surface, or `null`
   *  when padi is down / unreadable (both then fold as `absent`). */
  padiMemory: () => Promise<PadiProcessMemory | null>;
  /** Publish a fresh readout — `surfaceCtx.cells.processMemory.set`. */
  publish: (m: ProcessMemory) => void;
}

/** Take one reading and publish it — kolu-server's own RSS (always present, it
 *  measures itself) plus padi's folded-in `{ padi, kaval }` pair. A `null` padi
 *  reading (padi down / unreadable) publishes both as the honest `absent`, never a
 *  fake zero. padi's honest three-way is passed through verbatim, so an `error`
 *  kaval poll stays distinct from `absent`. */
export async function sampleMemoryOnce(deps: MemorySamplerDeps): Promise<void> {
  const padiMem = await deps.padiMemory();
  deps.publish({
    serverRssBytes: deps.serverRss(),
    padi: padiMem?.padi ?? { status: "absent" },
    kaval: padiMem?.kaval ?? { status: "absent" },
  });
}

/** Cadence of the rail's readout. Coarser than the client's 1s heap tick — memory
 *  is slow-moving and the MB-dedup keeps stable spans off the wire, so a 5s poll is
 *  plenty live without chattering at every connected client. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

/** Start the periodic sampler. Fires once immediately (a T+0 anchor so the cell
 *  has a value before the first paint), then every {@link
 *  MEMORY_SAMPLE_INTERVAL_MS}. Non-overlapping (a slow padi read never doubles up
 *  ticks) and `unref`'d so the interval never holds the process open on its own (it
 *  serves forever under systemd; unref is the right hygiene, matching
 *  `@kolu/heap-diag`). */
export function startMemorySampler(
  deps: MemorySamplerDeps,
  /** An optional liveness signal — the bound padi's connection-state changes.
   *  Each transition force-samples IMMEDIATELY (through the same non-overlap
   *  guard), so when padi drops the rail flips to `absent` at once instead of
   *  showing a frozen MB figure for up to a full {@link MEMORY_SAMPLE_INTERVAL_MS}
   *  until the next tick notices `padiMemory()` now reads `null`. */
  subscribeResample?: (resample: () => void) => void,
): void {
  let inFlight = false;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    void sampleMemoryOnce(deps).finally(() => {
      inFlight = false;
    });
  };
  tick();
  setInterval(tick, MEMORY_SAMPLE_INTERVAL_MS).unref();
  subscribeResample?.(tick);
}

/** Build the production deps from `process.memoryUsage` + a reader of padi's
 *  memory cell. Kept here (beside the sampler) so `index.ts`'s wiring is one call.
 *  `readPadiMemory` reads padi's `processMemory` cell off the bound session (a
 *  one-shot read per tick); it resolves `null` when padi is down. */
export function liveSamplerDeps(opts: {
  publish: (m: ProcessMemory) => void;
  readPadiMemory: () => Promise<PadiProcessMemory | null>;
}): MemorySamplerDeps {
  return {
    serverRss: () => process.memoryUsage().rss,
    padiMemory: opts.readPadiMemory,
    publish: opts.publish,
  };
}
