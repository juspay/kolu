/**
 * EF2 — the daemon-lifetime effective-finish quiet fact.
 *
 * A **second** {@link createActivityTracker} at {@link EFFECTIVE_FINISH_QUIET_MS}
 * (~5s), fed by:
 *   1. enter-waiting (incl. boot seed of already-waiting, and awaiting→waiting)
 *   2. every kaval meaningful-output edge
 *   3. restamp of all currently-waiting ids on every successful (re)subscribe
 *      (recycle-blindness → delay, not early finish)
 * and evicted by `forget` on leave-waiting / leave-pool.
 *
 * Publishes a reactor **push source** whose level bumps on tracker `onChange`, so
 * urgency's dual-edge derived cell re-folds when the quiet timer expires without
 * an agent-state change. `Date.now()` stays inside the tracker; the fold stays
 * pure over `(terminals, isLive)`.
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
  /** Whether the finish tracker's quiet window is still open for `id`. */
  isLive(id: TerminalId): boolean;
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
  /** Test hook — restamp all currently-waiting ids (resubscribe). */
  restampWaiting(): void;
  /** Test hook — current waiting set the feed tracks. */
  waitingSnapshot(): TerminalId[];
} {
  const idleAfterMs = opts.idleAfterMs ?? EFFECTIVE_FINISH_QUIET_MS;
  const tracker: ActivityTracker = createActivityTracker(idleAfterMs);
  /** Ids currently in the waiting bucket — enter/leave detection. */
  const waiting = new Set<TerminalId>();

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
    tracker.noteOutput(id);
  };

  const restampWaiting = (): void => {
    for (const id of waiting) tracker.noteOutput(id);
  };

  const syncWaiting = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    const next = new Set(waitingIdsOf(terminals));
    for (const id of next) {
      if (!waiting.has(id)) {
        // Enter-waiting (incl. boot seed / awaiting→waiting): start the window.
        // Without this, never-noted ⇒ !isLive ⇒ immediate finish.
        tracker.noteOutput(id);
      }
    }
    for (const id of waiting) {
      if (!next.has(id)) tracker.forget(id);
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
        // Establishment of a successful (re)subscribe: restamp every waiting id
        // so a recycle gap that aged the tracker out cannot early-finish.
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
    isLive(id) {
      return tracker.isLive(id);
    },
    syncWaiting,
    noteEdge,
    restampWaiting,
    waitingSnapshot() {
      return [...waiting].sort();
    },
    dispose() {
      localAbort.abort();
      keepAlive();
      genSrc.dispose();
      tracker.dispose();
      waiting.clear();
    },
  };
}
