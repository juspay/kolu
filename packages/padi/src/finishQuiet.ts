/**
 * EF2 — the daemon-lifetime effective-finish quiet fact.
 *
 * A **second** {@link createActivityTracker} at {@link EFFECTIVE_FINISH_QUIET_MS}
 * (~5s), fed by:
 *   1. enter-waiting (awaiting→waiting and re-entry after leave-work) — starts
 *      the first-finish quiet window (`debouncing`)
 *   2. every kaval meaningful-output edge while still debouncing (re-arms the
 *      window; **ignored once finished**)
 *   3. restamp of currently-debouncing ids on every successful (re)subscribe
 *      (recycle gap during the debounce → delay, not early finish)
 * and evicted on leave-waiting / leave-pool.
 *
 * **Product: sticky-per-episode.** Once a waiting id crosses quiet (`finished`
 * phase), it STAYS finished until it leaves the waiting bucket. Mid-waiting TUI
 * noise must not un-finish. Field falsified re-chime-per-quiet-crossing.
 *
 * **Boot seed:** already-waiting ids on the first `syncWaiting` go straight to
 * `finished` (discovery is not a transition).
 *
 * Episode phase is one `Map` (`debouncing` | `finished`) — not parallel
 * waiting/sticky sets with sticky-on-read. Promotion to finished is an event on
 * tracker quiet-exit; `isEpisodeFinished` is a pure read. Dual-edge generation
 * bumps only when a phase changes (enter / leave / promote), not on every
 * mid-waiting re-arm of an already-finished id.
 *
 * Standing kaval `resubscribeStream` is **daemon-lifetime**.
 */

import { source } from "@kolu/surface/reactor";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import {
  EFFECTIVE_FINISH_QUIET_MS,
  type TerminalId,
} from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { PadiTerminal, PadiUrgency } from "./surface.ts";
import { ptyHostClient } from "./ptyHost/index.ts";
import {
  createActivityTracker,
  type ActivityTracker,
} from "./terminalActivityTracker.ts";
import { resubscribeStream } from "./terminalEndpoint/local.ts";
import { recomputeUrgency } from "./urgency.ts";

/** Delay before re-subscribing to kaval's `activity` stream after it ends — same
 *  cadence as liveActivity so recycle recovery feels consistent. */
const ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000;

/** Waiting-episode phase for one terminal — one ADT, not waiting∪sticky∪isLive. */
export type FinishEpisodePhase = "debouncing" | "finished";

export type FinishQuiet = {
  /**
   * Read inside a reactor `engineComputed` so a phase change re-folds without a
   * terminals write. Side-effect free; value is a generation counter.
   */
  track(): void;
  /** Pure: true iff this waiting episode is in the `finished` phase. */
  isEpisodeFinished(id: TerminalId): boolean;
  /**
   * Enter/leave-waiting feed from the current terminals map. Prefer
   * {@link project} at call sites so track/sync/fold cannot drift.
   */
  syncWaiting(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  /**
   * Dual-edge entry: track generation, sync waiting membership, pure fold.
   * The only recompute shape production and dual-edge tests should use.
   */
  project(terminals: ReadonlyMap<TerminalId, PadiTerminal>): PadiUrgency;
  dispose(): void;
};

/** Collect active terminals whose agent bucket is `waiting`. */
export function waitingIdsOf(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
): TerminalId[] {
  const ids: TerminalId[] = [];
  for (const [id, terminal] of terminals) {
    if (terminal.state !== "active") continue;
    const agent = terminal.agent;
    if (!agent) continue;
    if (agentBucket(agent.state) === "waiting") ids.push(id);
  }
  return ids;
}

/**
 * Build the finish-quiet fact. When `standingSub` is true (production default),
 * opens a daemon-lifetime kaval activity subscription. Tests pass `standingSub:
 * false` and drive `noteEdge` / `restampWaiting` themselves.
 */
export function createFinishQuiet(opts: {
  log: Logger;
  idleAfterMs?: number;
  standingSub?: boolean;
}): FinishQuiet & {
  noteEdge(id: TerminalId): void;
  restampWaiting(): void;
  /** Test hook — ids currently in any waiting-episode phase. */
  waitingSnapshot(): TerminalId[];
  /** Test hook — ids in `finished` phase. */
  stickySnapshot(): TerminalId[];
  /** Test hook — phase map snapshot. */
  episodeSnapshot(): Array<[TerminalId, FinishEpisodePhase]>;
} {
  const idleAfterMs = opts.idleAfterMs ?? EFFECTIVE_FINISH_QUIET_MS;
  const tracker: ActivityTracker = createActivityTracker(idleAfterMs);
  /**
   * One map for the waiting-episode phase. Absent ⇒ not in a waiting episode.
   * Debounce timers live only on the tracker for `debouncing` ids.
   */
  const episode = new Map<TerminalId, FinishEpisodePhase>();
  /** First `syncWaiting` is discovery (boot seed), not a transition. */
  let bootstrapped = false;

  let gen = 0;
  let emitGen: ((n: number) => void) | undefined;
  const bump = (): void => {
    gen += 1;
    emitGen?.(gen);
  };

  const genSrc = source<number>((emit) => {
    emitGen = emit;
    return () => {
      emitGen = undefined;
    };
  }, 0);
  const keepAlive = genSrc.subscribe(() => {});

  /** Promote debouncing ids whose quiet window closed — event, not a read. */
  const promoteQuietExits = (): void => {
    let changed = false;
    for (const [id, phase] of episode) {
      if (phase !== "debouncing") continue;
      if (tracker.isLive(id)) continue;
      episode.set(id, "finished");
      changed = true;
    }
    if (changed) bump();
  };

  // Tracker live-set changes: re-arm (no phase change) or quiet exit (promote).
  tracker.onChange(() => {
    promoteQuietExits();
  });

  const noteEdge = (id: TerminalId): void => {
    // Only re-arm the first-finish window. Finished episodes ignore edges for
    // membership AND must not re-arm timers (would dual-edge-recompute forever
    // under idle TUI noise).
    if (episode.get(id) !== "debouncing") return;
    tracker.noteOutput(id);
  };

  const restampWaiting = (): void => {
    for (const [id, phase] of episode) {
      if (phase === "debouncing") tracker.noteOutput(id);
    }
  };

  const isEpisodeFinished = (id: TerminalId): boolean =>
    episode.get(id) === "finished";

  const syncWaiting = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    const next = new Set(waitingIdsOf(terminals));

    if (!bootstrapped) {
      bootstrapped = true;
      for (const id of next) episode.set(id, "finished");
      if (next.size > 0) bump();
      return;
    }

    let changed = false;
    for (const id of next) {
      if (!episode.has(id)) {
        // Enter-waiting: start first-finish quiet window.
        episode.set(id, "debouncing");
        tracker.noteOutput(id);
        changed = true;
      }
    }
    for (const id of [...episode.keys()]) {
      if (!next.has(id)) {
        tracker.forget(id);
        episode.delete(id);
        changed = true;
      }
    }
    if (changed) bump();
  };

  const project = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): PadiUrgency => {
    // Dual-edge: depend on generation, then sync membership, then pure fold.
    genSrc.value.value;
    syncWaiting(terminals);
    return recomputeUrgency(terminals, isEpisodeFinished);
  };

  const localAbort = new AbortController();
  if (opts.standingSub !== false) {
    const sig = localAbort.signal;
    void resubscribeStream({
      signal: sig,
      delayMs: ACTIVITY_RESUBSCRIBE_DELAY_MS,
      getStream: () => {
        const stream = ptyHostClient.surface.activity.get({}, { signal: sig });
        return Promise.resolve(stream).then((s) => {
          restampWaiting();
          return s;
        });
      },
      onEvent: (edge) => noteEdge(edge.id as TerminalId),
      onDrop: (err) =>
        opts.log.debug(
          { err },
          "kaval activity subscribe failed (finish quiet); will re-subscribe",
        ),
    });
  }

  return {
    track() {
      genSrc.value.value;
    },
    isEpisodeFinished,
    syncWaiting,
    project,
    noteEdge,
    restampWaiting,
    waitingSnapshot() {
      return [...episode.keys()].sort();
    },
    stickySnapshot() {
      return [...episode]
        .filter(([, p]) => p === "finished")
        .map(([id]) => id)
        .sort();
    },
    episodeSnapshot() {
      return [...episode.entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
    },
    dispose() {
      localAbort.abort();
      keepAlive();
      genSrc.dispose();
      tracker.dispose();
      episode.clear();
    },
  };
}
