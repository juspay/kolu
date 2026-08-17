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
 * **Feed liveness:** quiet promotion is blocked while the standing kaval activity
 * sub is down (recycle / drop). On reconnect, debouncing episodes are restamped
 * before promotion re-enables — a gap cannot age the tracker into sticky finish.
 *
 * Episode phase is one `Map` (`debouncing` | `finished`). Promotion is an event
 * on tracker quiet-exit (only while feed-live); `isEpisodeFinished` is pure.
 *
 * Standing kaval `resubscribeStream` is **daemon-lifetime**.
 */

import { source } from "@kolu/surface/reactor";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { PadiTerminal, PadiUrgency } from "../surface.ts";
import { ptyHostClient } from "../ptyHost/index.ts";
import {
  createActivityTracker,
  type ActivityTracker,
} from "./terminalActivityTracker.ts";
import {
  ACTIVITY_RESUBSCRIBE_DELAY_MS,
  resubscribeStream,
} from "../terminalEndpoint/local.ts";
import { recomputeUrgency } from "./urgency.ts";

/** Quiet window for the effective-finish fold — Padi attention policy, not shared
 *  wire vocabulary. Long enough to ride gaps between background sub-agent bursts;
 *  short enough the finished nudge is not noticeably late. */
export const EFFECTIVE_FINISH_QUIET_MS = 5_000;

/** Waiting-episode phase for one terminal — one ADT, not waiting∪sticky∪isLive. */
export type FinishEpisodePhase = "debouncing" | "finished";

export type FinishQuiet = {
  isEpisodeFinished(id: TerminalId): boolean;
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

// The feed-liveness latch this fold needs — "is the activity subscription
// actually running?" — is `resubscribeStream`'s `onFeedLive`, not a wrapper here:
// the laziness it works around is the SUBSCRIBE loop's, and a second consumer
// (the submit gate) needs the identical fact for the identical reason. See that
// option's doc.

/**
 * Build the finish-quiet fact. When `standingSub` is true (production default),
 * opens a daemon-lifetime kaval activity subscription. Tests pass `standingSub:
 * false` and drive feed hooks / edges themselves.
 */
export function createFinishQuiet(opts: {
  log: Logger;
  idleAfterMs?: number;
  standingSub?: boolean;
}): FinishQuiet & {
  noteEdge(id: TerminalId): void;
  restampWaiting(): void;
  /** Test hook — activity feed live (promotion allowed). */
  setFeedLive(live: boolean): void;
  waitingSnapshot(): TerminalId[];
  stickySnapshot(): TerminalId[];
  episodeSnapshot(): Array<[TerminalId, FinishEpisodePhase]>;
} {
  const idleAfterMs = opts.idleAfterMs ?? EFFECTIVE_FINISH_QUIET_MS;
  const tracker: ActivityTracker = createActivityTracker(idleAfterMs);
  const episode = new Map<TerminalId, FinishEpisodePhase>();
  let bootstrapped = false;
  /**
   * When false, quiet-exit must not promote debouncing → finished (kaval activity
   * sub is down — lost edges, not real quiet).
   */
  let feedLive = opts.standingSub === false;

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

  const promoteQuietExits = (): void => {
    if (!feedLive) return;
    let changed = false;
    for (const [id, phase] of episode) {
      if (phase !== "debouncing") continue;
      if (tracker.isLive(id)) continue;
      episode.set(id, "finished");
      changed = true;
    }
    if (changed) bump();
  };

  tracker.onChange(() => {
    promoteQuietExits();
  });

  const noteEdge = (id: TerminalId): void => {
    if (episode.get(id) !== "debouncing") return;
    tracker.noteOutput(id);
  };

  const restampWaiting = (): void => {
    for (const [id, phase] of episode) {
      if (phase === "debouncing") tracker.noteOutput(id);
    }
  };

  const markFeedDown = (): void => {
    feedLive = false;
  };

  const markFeedUp = (): void => {
    // Full quiet window after reconnect before any promote can fire.
    restampWaiting();
    feedLive = true;
  };

  const isEpisodeFinished = (id: TerminalId): boolean =>
    episode.get(id) === "finished";

  const syncWaiting = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    const next = new Set(waitingIdsOf(terminals));

    if (!bootstrapped) {
      // Serve-time eager seed runs with an empty registry (surfaces before kaval
      // adopt). Do not arm bootstrap on that empty map — wait until a real
      // inventory observation so already-waiting agents still get sticky
      // discovery, not a 5s debounce after the empty seed.
      if (terminals.size === 0) return;
      bootstrapped = true;
      for (const id of next) episode.set(id, "finished");
      if (next.size > 0) bump();
      return;
    }

    let changed = false;
    for (const id of next) {
      if (!episode.has(id)) {
        episode.set(id, "debouncing");
        tracker.noteOutput(id);
        changed = true;
      }
    }
    for (const id of [...episode.keys()]) {
      if (!next.has(id)) {
        // Delete episode BEFORE forget so promoteQuietExits cannot fabricate a
        // debouncing→finished transition on the leave path.
        episode.delete(id);
        tracker.forget(id);
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
      getStream: () => ptyHostClient.surface.activity.get({}),
      onFeedLive: (live) => (live ? markFeedUp() : markFeedDown()),
      onEvent: (edge) => noteEdge(edge.id as TerminalId),
      onDrop: (err) => {
        markFeedDown();
        opts.log.debug(
          { err },
          "kaval activity subscribe failed (finish quiet); will re-subscribe",
        );
      },
    });
  }

  return {
    isEpisodeFinished,
    project,
    noteEdge,
    restampWaiting,
    setFeedLive(live: boolean) {
      if (live) markFeedUp();
      else markFeedDown();
    },
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
