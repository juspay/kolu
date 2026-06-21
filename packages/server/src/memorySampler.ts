/**
 * The server's process-memory sampler — the sole writer of the `processMemory`
 * surface cell that feeds the chrome bar's rail.
 *
 * Every tick it reads its OWN resident-set size (`process.memoryUsage().rss`,
 * always available — it's measuring itself) and the kaval daemon's RSS (a
 * SEPARATE process, polled over `system.heartbeat`, which carries `rss` as of
 * pty-host contract 3.2). The kaval figure is `null` whenever there's no live
 * daemon to measure — the honest "no value", never a misleading `0` or a stale
 * carry-over. The client adds its own JS-heap figure locally (off
 * `performance.memory`), so it never rides this cell.
 *
 * Memory churns byte-by-byte, but the rail renders whole megabytes, so the cell
 * dep uses {@link processMemoryMbEqual} as its `equals` — the framework's own
 * content-dedup path drops every set that doesn't move a displayed MB, keeping
 * the wire quiet while RSS hovers. The sampler itself just sets unconditionally.
 */

import type { PtyHostClient } from "kaval";
import type { DaemonState, ProcessMemory } from "kolu-common/surface";

const BYTES_PER_MB = 1_048_576;

/** Whole displayed megabytes of a byte count (the rail's granularity). `null`
 *  RSS (no daemon) stays `null` so it compares distinctly from any real value. */
function rssMb(bytes: number | null): number | null {
  return bytes === null ? null : Math.round(bytes / BYTES_PER_MB);
}

/** Two readouts are equal when they render the same whole-MB rail figures —
 *  the cell's `equals`, so a sub-MB RSS wobble never re-publishes. */
export function processMemoryMbEqual(
  a: ProcessMemory,
  b: ProcessMemory,
): boolean {
  return (
    rssMb(a.serverRssBytes) === rssMb(b.serverRssBytes) &&
    rssMb(a.kavalRssBytes) === rssMb(b.kavalRssBytes)
  );
}

/** In-memory backing for the `processMemory` cell. The sampler writes through
 *  `surfaceCtx.cells.processMemory.set` (→ `set` here, then publish); a fresh
 *  subscription reads the latest via `get`. No persistence — a live metric has
 *  no on-disk slot, mirroring the `terminalList` cell. */
let current: ProcessMemory = { serverRssBytes: 0, kavalRssBytes: null };
export const memoryCellStore = {
  get: (): ProcessMemory => current,
  set: (value: ProcessMemory): void => {
    current = value;
  },
};

/** The seams the sampler reads/writes through — injected so a unit test can
 *  drive the kaval-down / heartbeat-anomaly branches without a real daemon. */
export interface MemorySamplerDeps {
  /** This process's RSS in bytes — `process.memoryUsage().rss`. */
  serverRss: () => number;
  /** Is the kaval daemon connected right now? Read off the daemon-status store
   *  so a down/degraded daemon yields a `null` reading rather than a thrown poll. */
  daemonConnected: () => boolean;
  /** Poll the connected daemon's RSS (its `system.heartbeat`). Only called when
   *  {@link daemonConnected} is true; rejects if the heartbeat is unreachable. */
  pollKavalRss: () => Promise<number>;
  /** Publish a fresh readout — `surfaceCtx.cells.processMemory.set`. */
  publish: (m: ProcessMemory) => void;
  /** Surface (never swallow) a heartbeat failure on a daemon we believed up. */
  warn: (err: unknown) => void;
}

/** Take one reading and publish it. Server RSS is always read; kaval RSS is read
 *  only when the daemon is connected. A heartbeat that fails THOUGH we believed
 *  the daemon connected is a real anomaly: it's surfaced via `warn` and the tick
 *  reports `null` (the daemon-status collection already carries the lifecycle
 *  truth), rather than silently swallowing the error or carrying a stale value. */
export async function sampleMemoryOnce(deps: MemorySamplerDeps): Promise<void> {
  const serverRssBytes = deps.serverRss();
  let kavalRssBytes: number | null = null;
  if (deps.daemonConnected()) {
    try {
      kavalRssBytes = await deps.pollKavalRss();
    } catch (err) {
      deps.warn(err);
      kavalRssBytes = null;
    }
  }
  deps.publish({ serverRssBytes, kavalRssBytes });
}

/** Cadence of the rail's server/kaval readout. Coarser than the client's 1s
 *  heap tick — memory is slow-moving and the MB-dedup keeps stable spans off the
 *  wire, so a 5s server-side poll is plenty live without chattering at the
 *  daemon or every connected client. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

/** Start the periodic sampler. Fires once immediately (a T+0 anchor so the cell
 *  has a value before the first paint), then every {@link
 *  MEMORY_SAMPLE_INTERVAL_MS}. `unref` so the interval never holds the process
 *  open on its own (it serves forever under systemd; unref is the right hygiene,
 *  matching `@kolu/heap-diag`). */
export function startMemorySampler(deps: MemorySamplerDeps): void {
  const tick = (): void => void sampleMemoryOnce(deps);
  tick();
  setInterval(tick, MEMORY_SAMPLE_INTERVAL_MS).unref();
}

/** Build the production deps from the live kaval client + a daemon-state reader.
 *  Kept here (beside the sampler) so `index.ts`'s wiring is one call. A
 *  connected, contract-3.2 daemon always reports `rss`; a missing one is an
 *  anomaly worth surfacing (the version gate recycles any pre-3.2 survivor, so
 *  it can't be a benign old daemon). */
export function liveSamplerDeps(opts: {
  client: PtyHostClient;
  daemonState: () => DaemonState | undefined;
  publish: (m: ProcessMemory) => void;
  warn: (err: unknown) => void;
}): MemorySamplerDeps {
  return {
    serverRss: () => process.memoryUsage().rss,
    daemonConnected: () => opts.daemonState() === "connected",
    pollKavalRss: async () => {
      const { rss } = await opts.client.surface.system.heartbeat({});
      if (rss === undefined) {
        throw new Error("kaval heartbeat returned no rss (pre-3.2 daemon?)");
      }
      return rss;
    },
    publish: opts.publish,
    warn: opts.warn,
  };
}
