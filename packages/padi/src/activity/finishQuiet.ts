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
 * **The same window settles an agent coming up.** An agent padi has seen in the
 * foreground but whose screen is still being drawn is `starting`; it is `fresh`
 * once that screen goes quiet. "Has this terminal's output gone quiet for the
 * window?" is the question this module already answers for a finished turn, so
 * a `starting` agent is a second KIND of episode on the same tracker and the
 * same kaval edges — not a timer of its own. Its quiet-crossing is reported
 * through `onSettled`, which padi routes back into that terminal's agent
 * detector (`TerminalEndpoint.noteScreenSettled`): the detector owns the agent
 * value, and it is the one that publishes `fresh`. The episode then ends by
 * itself, because the record no longer says `starting`.
 *
 * **Boot seed:** already-waiting ids on the first `syncWaiting` go straight to
 * `finished` (discovery is not a transition) — and already-starting ids are
 * reported settled at once, for the same reason.
 *
 * **Feed liveness:** quiet promotion is blocked while the standing kaval activity
 * sub is down (recycle / drop). On reconnect, debouncing episodes are restamped
 * before promotion re-enables — a gap cannot age the tracker into sticky finish.
 *
 * Episode phase is one `Map` (`debouncing` | `finished`, per kind). Promotion is
 * an event on tracker quiet-exit (only while feed-live); `isEpisodeFinished` is
 * pure.
 *
 * Standing kaval `resubscribeStream` is **daemon-lifetime**.
 */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { source } from "@kolu/surface/reactor";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import type { Logger } from "pino";
import { ptyHostClient } from "../ptyHost/index.ts";
import {
  ACTIVITY_RESUBSCRIBE_DELAY_MS,
  resubscribeStream,
} from "../terminalEndpoint/local.ts";
import {
  type ActivityTracker,
  createActivityTracker,
} from "./terminalActivityTracker.ts";
import { recomputeUrgency } from "./urgency.ts";

/** Quiet window for the effective-finish fold — Padi attention policy, not shared
 *  wire vocabulary. Long enough to ride gaps between background sub-agent bursts;
 *  short enough the finished nudge is not noticeably late. */
export const EFFECTIVE_FINISH_QUIET_MS = 5_000;

/** Waiting-episode phase for one terminal — one ADT, not waiting∪sticky∪isLive. */
export type FinishEpisodePhase = "debouncing" | "finished";

/** What a quiet episode is ABOUT: a turn that ended (`finish` — the agent is
 *  `waiting`) or an agent coming up (`settle` — it is `starting`). One terminal
 *  is in at most one, because its agent has one state. */
export type QuietEpisodeKind = "finish" | "settle";

type QuietEpisode = { kind: QuietEpisodeKind; phase: FinishEpisodePhase };

export type FinishQuiet = {
  isEpisodeFinished(id: TerminalId): boolean;
  project(terminals: ReadonlyMap<TerminalId, PadiTerminal>): PadiUrgency;
  dispose(): void;
};

/** Collect active terminals whose agent bucket is `waiting`. */
export function waitingIdsOf(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
): TerminalId[] {
  return [...quietEpisodesOf(terminals)]
    .filter(([, kind]) => kind === "finish")
    .map(([id]) => id);
}

/** Every active terminal this module keeps a quiet episode for, and which kind:
 *  a `waiting` agent's turn is a `finish` episode, a `starting` agent a `settle`
 *  one. Read through the shared `agentBucket` fold, so the membership is the
 *  vocabulary's answer rather than a second list of literals. */
function quietEpisodesOf(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
): Map<TerminalId, QuietEpisodeKind> {
  const out = new Map<TerminalId, QuietEpisodeKind>();
  for (const [id, terminal] of terminals) {
    if (terminal.state !== "active") continue;
    const agent = terminal.agent;
    if (!agent) continue;
    switch (agentBucket(agent.state)) {
      case "waiting":
        out.set(id, "finish");
        break;
      case "starting":
        out.set(id, "settle");
        break;
      case "working":
      case "awaiting":
      case "fresh":
      case "other":
        break;
    }
  }
  return out;
}

/** Latch `onStart` when the stream actually begins running and `onEnd` when it
 *  drains, fails, or is interrupted. A kaval stream member is LAZY, so "the feed
 *  is up" is the moment the stream STARTS — not the moment the value was built
 *  (which registers nothing). `ensuring` runs after the stream's own finalizers,
 *  which is what latches feed-down before the resubscribe delay. */
function withFeedHooks<T>(
  source: Stream.Stream<T, unknown>,
  onStart: () => void,
  onEnd: () => void,
): Stream.Stream<T, unknown> {
  return Stream.ensuring(
    Stream.onStart(source, Effect.sync(onStart)),
    Effect.sync(onEnd),
  );
}

/**
 * Build the finish-quiet fact. When `standingSub` is true (production default),
 * opens a daemon-lifetime kaval activity subscription. Tests pass `standingSub:
 * false` and drive feed hooks / edges themselves.
 *
 * `onSettled` hears each `starting` agent whose screen went quiet — once per
 * episode, from the tracker's own quiet-exit (or at once for an agent already
 * starting when the first real fleet arrives).
 */
export function createFinishQuiet(opts: {
  log: Logger;
  idleAfterMs?: number;
  standingSub?: boolean;
  onSettled?: (id: TerminalId) => void;
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
  const episode = new Map<TerminalId, QuietEpisode>();
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

  /** Tell padi a `starting` agent's screen has settled. The listener routes into
   *  the terminal's own detector; a throw there must not stop the promotion loop
   *  for every other terminal, so it is caught and said here. */
  const reportSettled = (id: TerminalId): void => {
    try {
      opts.onSettled?.(id);
    } catch (err) {
      opts.log.error({ err, terminal: id }, "screen-settled report failed");
    }
  };

  const promoteQuietExits = (): void => {
    if (!feedLive) return;
    const settled: TerminalId[] = [];
    let changed = false;
    for (const [id, ep] of episode) {
      if (ep.phase !== "debouncing") continue;
      if (tracker.isLive(id)) continue;
      episode.set(id, { kind: ep.kind, phase: "finished" });
      if (ep.kind === "settle") settled.push(id);
      changed = true;
    }
    if (changed) bump();
    for (const id of settled) reportSettled(id);
  };

  tracker.onChange(() => {
    promoteQuietExits();
  });

  const noteEdge = (id: TerminalId): void => {
    if (episode.get(id)?.phase !== "debouncing") return;
    tracker.noteOutput(id);
  };

  const restampWaiting = (): void => {
    for (const [id, ep] of episode) {
      if (ep.phase === "debouncing") tracker.noteOutput(id);
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

  const isEpisodeFinished = (id: TerminalId): boolean => {
    const ep = episode.get(id);
    return ep?.kind === "finish" && ep.phase === "finished";
  };

  const syncWaiting = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    const next = quietEpisodesOf(terminals);

    if (!bootstrapped) {
      // The FIRST REAL inventory arms bootstrap, so already-waiting agents get
      // sticky discovery rather than a 5s debounce — and an agent already
      // coming up is reported settled rather than debounced, the same rule. It
      // is a real one because the producer says so: the serve-time empty seed
      // (surfaces before kaval adopt) never reaches `project` at all —
      // `servePadi`'s urgency cell gates that frame ONCE, for this fold and both
      // watch sources.
      bootstrapped = true;
      for (const [id, kind] of next) {
        episode.set(id, { kind, phase: "finished" });
      }
      if (next.size > 0) bump();
      for (const [id, kind] of next) if (kind === "settle") reportSettled(id);
      return;
    }

    let changed = false;
    // LEAVES FIRST. A terminal whose agent moved from one kind of episode to the
    // other (a `starting` agent whose transcript landed straight at `waiting`)
    // ends the old episode and begins the new one, and the tracker is keyed by
    // terminal: forgetting after the new episode stamped it would erase the
    // stamp the new episode just took.
    for (const [id, ep] of [...episode]) {
      if (next.get(id) !== ep.kind) {
        // Delete episode BEFORE forget so promoteQuietExits cannot fabricate a
        // debouncing→finished transition on the leave path.
        episode.delete(id);
        tracker.forget(id);
        changed = true;
      }
    }
    for (const [id, kind] of next) {
      if (!episode.has(id)) {
        episode.set(id, { kind, phase: "debouncing" });
        tracker.noteOutput(id);
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
      getStream: () =>
        withFeedHooks(
          ptyHostClient.surface.activity.get({}),
          markFeedUp,
          markFeedDown,
        ),
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
        .filter(([, ep]) => ep.phase === "finished")
        .map(([id]) => id)
        .sort();
    },
    episodeSnapshot() {
      return [...episode.entries()]
        .map(([id, ep]): [TerminalId, FinishEpisodePhase] => [id, ep.phase])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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
