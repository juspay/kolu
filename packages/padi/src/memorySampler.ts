/**
 * padi's process-memory sampler — the sole writer of padi's `processMemory`
 * surface cell (padi's OWN RSS + its kaval daemon's).
 *
 * padi owns kaval now (it supervises the kaval PROCESS), so padi is the source of
 * the rail's per-host memory readout — the axis kolu-server's in-process sampler
 * served before the W2.2 cutover. Every tick it reads its OWN resident-set size
 * (`process.memoryUsage().rss`, always available — it is measuring itself) and
 * polls kaval's RSS over `system.processMemory` EXACTLY as kolu-server's old
 * sampler did: only when the daemon is connected (else the honest `absent`), and a
 * poll that throws on a BELIEVED-connected daemon is surfaced as the distinct
 * `error` state, never collapsed into the same `absent` shape as "no daemon".
 * kolu-server folds this reading into the rail's cell; the client never subscribes
 * to it directly.
 *
 * The cadence matches the retired kolu-server sampler (5s) — memory is slow-moving,
 * so a coarser tick than the client's 1s heap read is plenty live.
 */

import { log } from "./log.ts";
import { padiSurfaceCtx } from "./padiSurfaceCtx.ts";
import { readDaemonStatus } from "./ptyHost/daemonStatus.ts";
import { ptyHostClient } from "./ptyHost/index.ts";
import type { ProcessRss } from "./vocab.ts";
import { encodeHostLocation, LOCAL_LOCATION } from "./vocab.ts";

/** Cadence of padi's process-memory readout — the SAME 5s the retired kolu-server
 *  sampler used. Coarser than the client's 1s heap tick: memory is slow-moving, so
 *  a 5s poll is plenty live without chattering at the daemon. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

/** Poll kaval's RSS as the honest three-way. `absent` when there is no connected
 *  daemon to measure (the expected "no value", read off the daemon-status store —
 *  never a thrown poll against a down daemon); `ok` when a connected daemon
 *  answered `system.processMemory`; `error` when a BELIEVED-connected daemon's poll
 *  threw (surfaced — logged ERROR — and reported distinctly, so a failed RPC never
 *  renders identically to "no daemon"). */
async function pollKavalRss(): Promise<ProcessRss> {
  if (
    readDaemonStatus(encodeHostLocation(LOCAL_LOCATION))?.state !== "connected"
  ) {
    return { status: "absent" };
  }
  try {
    const { rss } = await ptyHostClient.surface.system.processMemory({});
    return { status: "ok", rssBytes: rss };
  } catch (err) {
    log.error({ err }, "kaval processMemory poll failed");
    return { status: "error" };
  }
}

/** Take one reading and publish it — padi's own RSS (always `ok`, it measures
 *  itself) plus kaval's honest three-way. */
export async function samplePadiMemoryOnce(): Promise<void> {
  const padi: ProcessRss = {
    status: "ok",
    rssBytes: process.memoryUsage().rss,
  };
  const kaval = await pollKavalRss();
  padiSurfaceCtx.cells.processMemory.set({ padi, kaval });
}

/** Start the periodic sampler. Fires once immediately (a T+0 anchor so the cell
 *  has a value before the first fold), then every {@link
 *  MEMORY_SAMPLE_INTERVAL_MS}. Non-overlapping (a wedged kaval poll never doubles
 *  up ticks) and `unref`'d so the interval never holds padi's process open on its
 *  own (it serves forever; unref is the right hygiene). */
export function startPadiMemorySampler(): void {
  let inFlight = false;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    void samplePadiMemoryOnce().finally(() => {
      inFlight = false;
    });
  };
  tick();
  setInterval(tick, MEMORY_SAMPLE_INTERVAL_MS).unref();
}
