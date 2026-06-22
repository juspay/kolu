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
 *   - **The kaval poll is bounded AND non-overlapping.** It races a timeout (a
 *     wedged-but-open stdio RPC has no deadline of its own), so a hung poll
 *     surfaces as `error` within {@link KAVAL_POLL_TIMEOUT_MS} instead of
 *     hanging the tick. The timeout bounds the *wrapper*, not the underlying
 *     RPC — a plain stdio call has no abort path, so a timed-out poll stays
 *     pending in the client until the daemon answers or the connection drops.
 *     To keep those leaked polls from accumulating, the launcher tracks the
 *     REAL poll promise: while one is still in flight (timed out at the wrapper
 *     but unsettled at the wire), the next tick reports `error` and launches no
 *     second poll, so at most one kaval RPC is ever outstanding.
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
   *  when {@link daemonConnected} is true; the caller bounds it with a timeout.
   *  May reject with {@link KAVAL_POLL_BUSY} when a prior poll timed out at the
   *  wrapper but is still pending at the wire — the guard refusing to launch a
   *  second overlapping RPC (see {@link guardOverlap}). */
  pollKavalRss: () => Promise<number>;
  /** Publish a fresh readout — `surfaceCtx.cells.processMemory.set`. */
  publish: (m: ProcessMemory) => void;
  /** Surface (never swallow) a poll failure on a daemon we believed up. Logged at
   *  ERROR level by the production wiring — it's a real failed RPC, not a benign
   *  degradation. */
  reportPollError: (err: unknown) => void;
}

/** The error a guarded poll rejects with when a prior poll is still pending at
 *  the wire (timed out at the wrapper but unsettled). It folds into the same
 *  `error` readout as any other failed poll, but is its own value so the log
 *  line — and a test — can tell "the daemon is wedged, we're not piling on" apart
 *  from a fresh RPC failure. */
export const KAVAL_POLL_BUSY = new Error(
  "kaval processMemory poll skipped — a prior poll is still in flight",
);

/** Wrap a poll fn so at most ONE underlying RPC is ever outstanding. The plain
 *  stdio `processMemory` call has no abort path, so a wrapper timeout can't
 *  cancel it — it stays pending in the client until the daemon answers or the
 *  connection drops. This guard tracks that REAL promise (not the timeout-bounded
 *  wrapper): while it's unsettled, every further call rejects with {@link
 *  KAVAL_POLL_BUSY} immediately rather than launching a second RPC, so wedged
 *  polls can't accumulate. The guard clears the instant the underlying poll
 *  settles (success OR failure), so the next tick resumes polling. */
export function guardOverlap(
  poll: () => Promise<number>,
): () => Promise<number> {
  let inFlight: Promise<number> | undefined;
  return () => {
    if (inFlight) return Promise.reject(KAVAL_POLL_BUSY);
    const p = poll();
    inFlight = p.finally(() => {
      inFlight = undefined;
    });
    return p;
  };
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
    // A BUSY skip (a prior wedged poll still pending) renders as `error` like any
    // failed poll, but isn't logged again every tick — the wedge was already
    // reported when the first poll timed out. Only fresh failures hit the log.
    if (err !== KAVAL_POLL_BUSY) deps.reportPollError(err);
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
 *  MEMORY_SAMPLE_INTERVAL_MS}. Overlapping kaval RPCs are prevented at the poll
 *  itself — `liveSamplerDeps` wraps the poll in {@link guardOverlap}, so a wedged
 *  RPC (timed out at the wrapper but still pending at the wire) is never doubled
 *  up. The `inFlight` flag here is the cheaper, outer serialization of the whole
 *  tick: with the 2s poll timeout comfortably under the 5s interval a tick
 *  normally settles before the next, but the flag guarantees it even if a tick's
 *  bookkeeping ran long. `unref` so the interval never holds the process open on
 *  its own (it serves forever under systemd; unref is the right hygiene, matching
 *  `@kolu/heap-diag`). */
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
    // Guarded so a wedged-but-open stdio poll (which the wrapper timeout bounds
    // but can't cancel) never overlaps with a fresh one — at most one kaval RPC
    // is ever outstanding.
    pollKavalRss: guardOverlap(async () => {
      const { rss } = await opts.client.surface.system.processMemory({});
      return rss;
    }),
    publish: opts.publish,
    reportPollError: opts.reportPollError,
  };
}
