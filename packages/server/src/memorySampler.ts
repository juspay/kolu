/**
 * The server's process-memory sampler — the sole writer of the `processMemory`
 * surface cell that feeds the chrome bar's rail.
 *
 * Every tick it reads its OWN resident-set size (`process.memoryUsage().rss`,
 * always available — it's measuring itself) and the kaval daemon's RSS (a
 * SEPARATE process, polled over `system.processMemory`, its own atomic verb as
 * of pty-host contract 3.2). The kaval figure is the honest three-way
 * `KavalMemory`: `absent` when there's no live daemon to measure, `error` when a
 * BELIEVED-connected daemon's poll throws (surfaced, never collapsed to the same
 * shape as "no daemon"), `ok` otherwise. The client adds its own JS-heap figure
 * locally (off `performance.memory`), so it never rides this cell.
 *
 * Two robustness invariants live HERE (the read+publish cadence is this module's
 * job):
 *   - **Server RSS is published every tick, independent of the kaval poll.** The
 *     server's own figure is always available, so a wedged daemon poll can never
 *     stall it: the tick publishes `serverRssBytes` with `kavalMemory: absent`
 *     FIRST, then publishes again with the kaval reading once the poll settles.
 *   - **The kaval poll is bounded AND serialized.** It races a timeout (a wedged-
 *     but-open stdio RPC has no deadline of its own), and the periodic sampler
 *     skips a tick while a poll is still in flight, so hung polls can't pile up.
 *
 * Memory churns byte-by-byte, but the rail renders whole megabytes. The cell's
 * backing store and its whole-MB `equals` (the dedup that drops every set which
 * doesn't move a displayed MB) live beside the cell definition in `surface.ts`,
 * not here. The framework's content-dedup path keeps the wire quiet — the two
 * sets per tick coalesce to one when the displayed MB hasn't moved.
 */

import type { PtyHostClient } from "kaval";
import type {
  DaemonState,
  KavalMemory,
  ProcessMemory,
} from "kolu-common/surface";

/** How long the kaval poll may run before the tick gives up and reports `error`.
 *  A plain stdio RPC has no deadline of its own, so a wedged-but-open daemon
 *  connection would otherwise leave the request pending forever. Comfortably
 *  under {@link MEMORY_SAMPLE_INTERVAL_MS} so a timed-out poll resolves before the
 *  next tick is due. */
export const KAVAL_POLL_TIMEOUT_MS = 2_000;

/** The seams the sampler reads/writes through — injected so a unit test can
 *  drive the kaval-down / poll-failure / poll-timeout branches without a real
 *  daemon. */
export interface MemorySamplerDeps {
  /** This process's RSS in bytes — `process.memoryUsage().rss`. */
  serverRss: () => number;
  /** Is the kaval daemon connected right now? Read off the daemon-status store
   *  so a down/degraded daemon yields an `absent` reading rather than a thrown
   *  poll. */
  daemonConnected: () => boolean;
  /** Poll the connected daemon's RSS (its `system.processMemory`). Only called
   *  when {@link daemonConnected} is true; the caller bounds it with a timeout. */
  pollKavalRss: () => Promise<number>;
  /** Publish a fresh readout — `surfaceCtx.cells.processMemory.set`. */
  publish: (m: ProcessMemory) => void;
  /** Surface (never swallow) a poll failure on a daemon we believed up. Logged at
   *  ERROR level by the production wiring — it's a real failed RPC, not a benign
   *  degradation. */
  reportPollError: (err: unknown) => void;
}

/** Bound a promise with a timeout. Rejects with the original error on failure,
 *  or a timeout error once {@link KAVAL_POLL_TIMEOUT_MS} elapses — either way the
 *  tick falls into the `error` branch rather than hanging. The timer is cleared
 *  on settle so a fast poll leaves no dangling handle. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`kaval processMemory poll timed out (${ms}ms)`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Take one reading and publish it. Server RSS is read+published every tick,
 *  INDEPENDENT of the kaval poll: the tick publishes the server figure first
 *  (kaval `absent`), so a wedged daemon poll can never stall the always-available
 *  server reading. The kaval poll then runs only when the daemon is connected,
 *  bounded by {@link KAVAL_POLL_TIMEOUT_MS}; a poll that throws or times out on a
 *  daemon we BELIEVED connected is a real anomaly — surfaced via
 *  `reportPollError` and reported as `error` (distinct from `absent`, so a failed
 *  RPC never renders as "no daemon"), never swallowed or carried stale. */
export async function sampleMemoryOnce(deps: MemorySamplerDeps): Promise<void> {
  const serverRssBytes = deps.serverRss();
  if (!deps.daemonConnected()) {
    deps.publish({ serverRssBytes, kavalMemory: { status: "absent" } });
    return;
  }
  // Publish the server figure immediately so it never waits on the kaval poll.
  deps.publish({ serverRssBytes, kavalMemory: { status: "absent" } });
  let kavalMemory: KavalMemory;
  try {
    const rssBytes = await withTimeout(
      deps.pollKavalRss(),
      KAVAL_POLL_TIMEOUT_MS,
    );
    kavalMemory = { status: "ok", rssBytes };
  } catch (err) {
    deps.reportPollError(err);
    kavalMemory = { status: "error" };
  }
  // Re-read server RSS so the second set reflects the moment the poll settled.
  deps.publish({ serverRssBytes: deps.serverRss(), kavalMemory });
}

/** Cadence of the rail's server/kaval readout. Coarser than the client's 1s
 *  heap tick — memory is slow-moving and the MB-dedup keeps stable spans off the
 *  wire, so a 5s server-side poll is plenty live without chattering at the
 *  daemon or every connected client. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

/** Start the periodic sampler. Fires once immediately (a T+0 anchor so the cell
 *  has a value before the first paint), then every {@link
 *  MEMORY_SAMPLE_INTERVAL_MS}. Ticks are SERIALIZED — a tick that fires while the
 *  previous poll is still in flight is skipped, so a slow/wedged poll can never
 *  accumulate overlapping requests at the daemon. (`sampleMemoryOnce` itself
 *  bounds the poll with a timeout, so an in-flight poll always settles well
 *  before the skip could starve the readout.) `unref` so the interval never holds
 *  the process open on its own (it serves forever under systemd; unref is the
 *  right hygiene, matching `@kolu/heap-diag`). */
export function startMemorySampler(deps: MemorySamplerDeps): void {
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
}

/** Build the production deps from the live kaval client + a daemon-state reader.
 *  Kept here (beside the sampler) so `index.ts`'s wiring is one call. A
 *  connected, contract-3.2 daemon always answers `system.processMemory`; a
 *  failed poll is an anomaly worth surfacing (the version gate recycles any
 *  pre-3.2 survivor, so it can't be a benign old daemon). */
export function liveSamplerDeps(opts: {
  client: PtyHostClient;
  daemonState: () => DaemonState | undefined;
  publish: (m: ProcessMemory) => void;
  reportPollError: (err: unknown) => void;
}): MemorySamplerDeps {
  return {
    serverRss: () => process.memoryUsage().rss,
    daemonConnected: () => opts.daemonState() === "connected",
    pollKavalRss: async () => {
      const { rss } = await opts.client.surface.system.processMemory({});
      return rss;
    },
    publish: opts.publish,
    reportPollError: opts.reportPollError,
  };
}
