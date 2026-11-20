import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { source } from "@kolu/surface/reactor";
import {
  agentBucket,
  awaitsScreenSettle,
} from "@kolu/terminal-vocab/agentProjection";
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

export const EFFECTIVE_FINISH_QUIET_MS = 5_000;

/** Waiting-episode phase for one terminal — one ADT, not waiting∪sticky∪isLive. */
export type FinishEpisodePhase = "debouncing" | "finished";

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

function quietEpisodesOf(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
): Map<TerminalId, QuietEpisodeKind> {
  const out = new Map<TerminalId, QuietEpisodeKind>();
  for (const [id, terminal] of terminals) {
    if (terminal.state !== "active") continue;
    const agent = terminal.agent;
    if (!agent) continue;
    if (awaitsScreenSettle(agent.state)) out.set(id, "settle");
    else if (agentBucket(agent.state) === "waiting") out.set(id, "finish");
  }
  return out;
}

type StreamHooks = {
  onStreamStarted: () => void;
  onStreamEnded: () => void;
};

function withStreamHooks<T>(
  stream: Stream.Stream<T, unknown>,
  hooks: StreamHooks,
): Stream.Stream<T, unknown> {
  return Stream.ensuring(
    Stream.onStart(stream, Effect.sync(hooks.onStreamStarted)),
    Effect.sync(hooks.onStreamEnded),
  );
}

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
  let seeded = false;
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
    restampWaiting();
    feedLive = true;
  };

  const isEpisodeFinished = (id: TerminalId): boolean => {
    const ep = episode.get(id);
    return ep?.kind === "finish" && ep.phase === "finished";
  };

  const seedFromFirstFleet = (
    next: ReadonlyMap<TerminalId, QuietEpisodeKind>,
  ): void => {
    for (const [id, kind] of next) episode.set(id, { kind, phase: "finished" });
    if (next.size > 0) bump();
    for (const [id, kind] of next) if (kind === "settle") reportSettled(id);
  };

  const retireEpisodes = (
    next: ReadonlyMap<TerminalId, QuietEpisodeKind>,
  ): boolean => {
    let changed = false;
    for (const [id, ep] of [...episode]) {
      if (next.get(id) !== ep.kind) {
        episode.delete(id);
        tracker.forget(id);
        changed = true;
      }
    }
    return changed;
  };

  const openEpisodes = (
    next: ReadonlyMap<TerminalId, QuietEpisodeKind>,
  ): boolean => {
    let changed = false;
    for (const [id, kind] of next) {
      if (episode.has(id)) continue;
      episode.set(id, { kind, phase: "debouncing" });
      tracker.noteOutput(id);
      changed = true;
    }
    return changed;
  };

  const syncWaiting = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    const next = quietEpisodesOf(terminals);

    if (!seeded) {
      seeded = true;
      seedFromFirstFleet(next);
      return;
    }

    const retired = retireEpisodes(next);
    const opened = openEpisodes(next);
    if (retired || opened) bump();
  };

  const project = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): PadiUrgency => {
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
        withStreamHooks(ptyHostClient.surface.activity.get({}), {
          onStreamStarted: markFeedUp,
          onStreamEnded: markFeedDown,
        }),
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
