/**
 * EF2 — the daemon-lifetime effective-finish quiet fact.
 *
 * A **second** {@link createActivityTracker} at {@link EFFECTIVE_FINISH_QUIET_MS}
 * (~5s), fed by:
 *   1. enter-waiting (awaiting→waiting and re-entry after leave-work) — starts
 *      the first-finish quiet window
 *   2. every kaval meaningful-output edge (re-arms the window *before* the first
 *      quiet-crossing; ignored for membership once sticky)
 *   3. restamp of currently-waiting, not-yet-sticky ids on every successful
 *      (re)subscribe (recycle gap during the debounce → delay, not early finish)
 * and evicted by `forget` / sticky-clear on leave-waiting / leave-pool.
 *
 * **Product: sticky-per-episode.** Once a waiting id crosses quiet and enters
 * `finishedIds`, it STAYS finished until it leaves the waiting bucket (agent
 * runs again / asks / leaves pool). Mid-waiting TUI noise (statusline clocks,
 * context meters — bytes that pass kaval's resize-only mute) must not un-finish
 * and re-chime forever. Field falsified the earlier re-chime-per-quiet-crossing
 * assumption that idle terminals are byte-quiet.
 *
 * **Boot seed:** already-waiting ids on the first `syncWaiting` go straight to
 * sticky-finished (discovery is not a transition — matches client baseline and
 * pre-EF2 master; avoids a mass chime on padi restart under a connected client).
 *
 * Publishes a reactor **push source** whose level bumps on tracker `onChange`, so
 * urgency's dual-edge derived cell re-folds when the quiet timer expires without
 * an agent-state change. The fold stays pure over `(terminals, isEpisodeFinished)`.
 *
 * Standing kaval `resubscribeStream` is **daemon-lifetime** — not nested inside
 * `liveActivity`'s per-subscriber source — so urgency is honest with zero
 * activity-stream watchers.
 */

import { source } from "@kolu/surface/reactor";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import {
  EFFECTIVE_FINISH_QUIET_MS,
  type TerminalId,
} from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { PadiTerminal } from "./surface.ts";
import { ptyHostClient } from "./ptyHost/index.ts";
import {
  createActivityTracker,
  type ActivityTracker,
} from "./terminalActivityTracker.ts";
import { resubscribeStream } from "./terminalEndpoint/local.ts";

/** Delay before re-subscribing to kaval's `activity` stream after it ends — same
 *  cadence as liveActivity so recycle recovery feels consistent. */
const ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000;

export type FinishQuiet = {
  /**
   * Read inside a reactor `engineComputed` (e.g. urgency's dual-edge
   * `derived.cell`) so a tracker onChange re-folds without a terminals write.
   * Side-effect free; the value itself is only a generation counter.
   */
  track(): void;
  /**
   * Sticky-aware finished predicate for a waiting id: true once the quiet window
   * has closed for this waiting episode (or boot-seeded sticky). Memoizes into
   * the sticky set so later edges while still waiting cannot un-finish.
   */
  isEpisodeFinished(id: TerminalId): boolean;
  /**
   * Enter/leave-waiting feed from the current terminals map. Call once per
   * urgency recompute **before** the pure fold — only *transitions* note/forget
   * (steady-state is a no-op, so the ~150 ms firehose does not re-arm windows).
   */
  syncWaiting(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  /** Test / dispose: stop the standing sub and drop tracker state. */
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
 * false` and drive `noteEdge` / `restampWaiting` (via the returned test hooks)
 * themselves — or only exercise `syncWaiting` + timer expiry.
 */
export function createFinishQuiet(opts: {
  log: Logger;
  idleAfterMs?: number;
  /** Open the standing kaval activity sub (default true). */
  standingSub?: boolean;
}): FinishQuiet & {
  /** Test hook — feed a kaval activity edge. */
  noteEdge(id: TerminalId): void;
  /** Test hook — restamp not-yet-sticky waiting ids (resubscribe). */
  restampWaiting(): void;
  /** Test hook — current waiting set the feed tracks. */
  waitingSnapshot(): TerminalId[];
  /** Test hook — sticky-finished set. */
  stickySnapshot(): TerminalId[];
} {
  const idleAfterMs = opts.idleAfterMs ?? EFFECTIVE_FINISH_QUIET_MS;
  const tracker: ActivityTracker = createActivityTracker(idleAfterMs);
  /** Ids currently in the waiting bucket — enter/leave detection. */
  const waiting = new Set<TerminalId>();
  /**
   * Ids that have crossed quiet (or boot-seeded) in the current waiting episode.
   * Cleared only on leave-waiting / leave-pool — never by mid-waiting edges.
   */
  const sticky = new Set<TerminalId>();
  /** First `syncWaiting` is discovery (boot seed), not a transition. */
  let bootstrapped = false;

  // Generation counter — bump on every tracker live-set change so a dual-edge
  // computed that reads `gen.value` re-runs when the quiet timer expires.
  let gen = 0;
  const genSrc = source<number>((emit) => {
    return tracker.onChange(() => {
      gen += 1;
      emit(gen);
    });
  }, 0);
  // Keep the source installed for daemon life (level updates only while
  // subscribed; urgency's track() reads the level but does not subscribe).
  const keepAlive = genSrc.subscribe(() => {});

  const noteEdge = (id: TerminalId): void => {
    // Sticky ids ignore edges for membership; re-arming the tracker is harmless
    // (isEpisodeFinished short-circuits on sticky) and keeps pre-finish debounce
    // correct for non-sticky waiting ids.
    tracker.noteOutput(id);
  };

  const restampWaiting = (): void => {
    // Only restamp ids still in the first-finish debounce — sticky-finished ids
    // must not be reopened (and the fold ignores their live flag anyway).
    for (const id of waiting) {
      if (!sticky.has(id)) tracker.noteOutput(id);
    }
  };

  const isEpisodeFinished = (id: TerminalId): boolean => {
    if (sticky.has(id)) return true;
    // Not waiting → not finished (caller also gates on waiting; belt-and-braces).
    if (!waiting.has(id)) return false;
    if (!tracker.isLive(id)) {
      // First quiet-crossing this episode → stick.
      sticky.add(id);
      return true;
    }
    return false;
  };

  const syncWaiting = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    const next = new Set(waitingIdsOf(terminals));

    if (!bootstrapped) {
      // Boot seed: already-waiting is a discovery, not a transition — go straight
      // to sticky-finished (matches client baseline + pre-EF2 raw-waiting on
      // master; avoids mass chime on padi restart under a connected client).
      bootstrapped = true;
      for (const id of next) sticky.add(id);
      waiting.clear();
      for (const id of next) waiting.add(id);
      return;
    }

    for (const id of next) {
      if (!waiting.has(id)) {
        // Enter-waiting (awaiting→waiting, or re-entry after leave-work): start
        // the first-finish quiet window. Without noteOutput, never-noted would
        // read !isLive and immediate-finish (default-excluded inverted).
        sticky.delete(id);
        tracker.noteOutput(id);
      }
    }
    for (const id of waiting) {
      if (!next.has(id)) {
        tracker.forget(id);
        sticky.delete(id);
      }
    }
    waiting.clear();
    for (const id of next) waiting.add(id);
  };

  const localAbort = new AbortController();
  if (opts.standingSub !== false) {
    const sig = localAbort.signal;
    void resubscribeStream({
      signal: sig,
      delayMs: ACTIVITY_RESUBSCRIBE_DELAY_MS,
      getStream: () => {
        // Establishment of a successful (re)subscribe: restamp waiting ids that
        // have not yet sticky-finished so a recycle gap during the debounce
        // cannot early-finish. Sticky ids stay finished through the restamp.
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
      // Engine-tracked read of the generation signal (dual-edge).
      genSrc.value.value;
    },
    isEpisodeFinished,
    syncWaiting,
    noteEdge,
    restampWaiting,
    waitingSnapshot() {
      return [...waiting].sort();
    },
    stickySnapshot() {
      return [...sticky].sort();
    },
    dispose() {
      localAbort.abort();
      keepAlive();
      genSrc.dispose();
      tracker.dispose();
      waiting.clear();
      sticky.clear();
    },
  };
}
