/**
 * padi's process-memory read — the poll READ behind padi's DERIVED `processMemory`
 * surface cell (padi's OWN RSS + its kaval daemon's). The cell is
 * `derived.cell(source({ read: samplePadiMemory, install }))` in `servePadi.ts`:
 * the reactor owns the T+0 seed, the non-overlap guard, and later-read
 * log-skip-continue that the hand-rolled sampler used to spell by hand.
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
import { readDaemonStatus } from "./ptyHost/daemonStatus.ts";
import { ptyHostClient } from "./ptyHost/index.ts";
import type { PadiProcessMemory, ProcessRss } from "./vocab.ts";
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

/** Take one reading — padi's own RSS (always `ok`, it measures itself) plus
 *  kaval's honest three-way. The poll READ of padi's derived `processMemory` cell
 *  (`servePadi.ts`: `derived.cell(source({ read: samplePadiMemory, install }))`).
 *  The reactor owns the loop the hand-rolled sampler used to: the T+0 seed read,
 *  the non-overlap guard, and later-read log-skip-continue — so this is just the
 *  pure read, and `MEMORY_SAMPLE_INTERVAL_MS` is the caller-owned cadence. */
export async function samplePadiMemory(): Promise<PadiProcessMemory> {
  const padi: ProcessRss = {
    status: "ok",
    rssBytes: process.memoryUsage().rss,
  };
  const kaval = await pollKavalRss();
  return { padi, kaval };
}
