import type { PadiStateEvent, PadiTerminal } from "@kolu/padi-client/surface";
import { activeAgent, type WaitState } from "@kolu/padi-client/terminalVocab";
import { scopeAdmits, type WatchScope } from "@kolu/padi-client/watchScope";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { EdgeMemory } from "./edgeMemory.ts";
import type { EventSeq } from "./eventSeq.ts";

type Bucket = ReturnType<typeof agentBucket>;

export interface StateWatchSpec {
  readonly states: ReadonlySet<WaitState>;
  readonly scope: WatchScope;
  readonly heldForMs: number;
  readonly nagMs?: number;
  readonly nagCount?: number;
}

export type StateWatchFilter = Omit<StateWatchSpec, "scope">;

export function sameStateWatchFilter(
  a: StateWatchFilter | undefined,
  b: StateWatchFilter | undefined,
): boolean {
  const _compared = {
    states: true,
    heldForMs: true,
    nagMs: true,
    nagCount: true,
  } satisfies Record<keyof StateWatchFilter, true>;
  if (a === undefined || b === undefined) return a === b;
  if (
    a.heldForMs !== b.heldForMs ||
    a.nagMs !== b.nagMs ||
    a.nagCount !== b.nagCount
  ) {
    return false;
  }
  if (a.states.size !== b.states.size) return false;
  for (const s of a.states) if (!b.states.has(s)) return false;
  return true;
}

export type StateWatchBatch = readonly PadiStateEvent[];

export interface StateWatchHub {
  observe(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  subscribe(
    spec: StateWatchSpec,
    emit: (batch: StateWatchBatch) => void,
    seed?: ReadonlyMap<TerminalId, StateWatchAnnounced>,
  ): StateWatchAttachment;
  dispose(): void;
}

export interface StateWatchAttachment {
  readonly stop: () => void;
  readonly counts: ReadonlyMap<TerminalId, StateWatchAnnounced>;
}

interface Level {
  readonly state: Bucket;
  readonly since: number;
}

export type StateWatchAnnounced =
  | {
      readonly kind: "owed";
      readonly since: number;
      readonly nags: number;
    }
  | {
      readonly kind: "reported";
      readonly since: number;
      readonly toldAt: number;
      readonly nags: number;
    };

interface StateWatchNag {
  readonly index: number;
  readonly left?: number;
}

interface EpisodeBudget {
  readonly entries: ReadonlyMap<TerminalId, StateWatchAnnounced>;
  known(id: TerminalId): StateWatchAnnounced | undefined;
  forget(id: TerminalId): void;
  retainOnly(live: ReadonlyMap<TerminalId, unknown>): void;
  report(id: TerminalId, since: number, at: number): StateWatchNag | undefined;
}

function createEpisodeBudget(
  cap: number | undefined,
  seed: ReadonlyMap<TerminalId, StateWatchAnnounced> | undefined,
): EpisodeBudget {
  const entries = new Map<TerminalId, StateWatchAnnounced>(
    [...(seed ?? [])].map(([id, known]) => [
      id,
      { kind: "owed", since: known.since, nags: known.nags },
    ]),
  );
  return {
    entries,
    known: (id) => entries.get(id),
    forget: (id) => {
      entries.delete(id);
    },
    retainOnly: (live) => {
      for (const id of entries.keys()) if (!live.has(id)) entries.delete(id);
    },
    report: (id, since, at) => {
      const prior = entries.get(id);
      const sameEpisode = prior !== undefined && prior.since === since;
      const first = !sameEpisode || prior.kind === "owed";
      const index = first ? 0 : prior.nags + 1;
      entries.set(id, {
        kind: "reported",
        since,
        toldAt: at,
        nags: sameEpisode ? Math.max(prior.nags, index) : index,
      });
      if (index === 0) return undefined;
      return cap === undefined ? { index } : { index, left: cap - index };
    },
  };
}

interface SweepResult {
  readonly events: PadiStateEvent[];
  readonly firstBatch: boolean;
}

interface Sub {
  readonly spec: StateWatchSpec;
  readonly emit: (batch: StateWatchBatch) => void;
  readonly budget: EpisodeBudget;
  snapshotDelivered: boolean;
  nextAt?: number;
}

export type ScheduleTimer = (delayMs: number, fire: () => void) => () => void;

const defaultSchedule: ScheduleTimer = (delayMs, fire) => {
  const t = setTimeout(fire, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
};

interface WatchClock {
  armFor(deadline: number | undefined, fire: () => void): void;
  release(): void;
}

function createWatchClock(
  now: () => number,
  schedule: ScheduleTimer,
): WatchClock {
  let cancel: (() => void) | undefined;
  let armedAt: number | undefined;
  return {
    armFor: (deadline, fire) => {
      if (deadline === armedAt) return;
      cancel?.();
      cancel = undefined;
      armedAt = deadline;
      if (deadline === undefined) return;
      cancel = schedule(Math.max(0, deadline - now()), () => {
        cancel = undefined;
        armedAt = undefined;
        fire();
      });
    },
    release: () => {
      cancel?.();
      cancel = undefined;
      armedAt = undefined;
    },
  };
}

export function createStateWatchHub(opts: {
  log: Logger;
  seq: EventSeq;
  edges: EdgeMemory;
  now?: () => number;
  schedule?: ScheduleTimer;
}): StateWatchHub {
  const { log, seq, edges } = opts;
  const now = opts.now ?? Date.now;
  const clock = createWatchClock(now, opts.schedule ?? defaultSchedule);

  const levels = new Map<TerminalId, Level>();
  const subs = new Set<Sub>();
  let flushQueued = false;
  let hasObserved = false;

  const matched = (
    sub: Sub,
    id: TerminalId,
    level: Level,
  ): WaitState | undefined => {
    const state = level.state;
    if (state === "other") return undefined;
    if (!sub.spec.states.has(state)) return undefined;
    if (!scopeAdmits(sub.spec.scope, id)) return undefined;
    return state;
  };

  const reportableAt = (
    sub: Sub,
    level: Level,
    known: StateWatchAnnounced | undefined,
  ): number | undefined => {
    if (known === undefined || known.since !== level.since) {
      return level.since + sub.spec.heldForMs;
    }
    if (known.kind === "owed") return level.since + sub.spec.heldForMs;
    if (sub.spec.nagMs === undefined) return undefined;
    if (sub.spec.nagCount !== undefined && known.nags >= sub.spec.nagCount) {
      return undefined;
    }
    return known.toldAt + sub.spec.nagMs;
  };

  const sweep = (sub: Sub, at: number): SweepResult => {
    const events: PadiStateEvent[] = [];
    const firstBatch = !sub.snapshotDelivered;
    sub.snapshotDelivered = true;
    let nextAt: number | undefined;
    const sooner = (candidate: number): void => {
      if (nextAt === undefined || candidate < nextAt) nextAt = candidate;
    };
    for (const [id, level] of levels) {
      const state = matched(sub, id, level);
      if (state === undefined) {
        sub.budget.forget(id);
        continue;
      }
      const due = reportableAt(sub, level, sub.budget.known(id));
      if (due === undefined) continue;
      if (at < due) {
        sooner(due);
        continue;
      }
      const nag = sub.budget.report(id, level.since, at);
      events.push({
        seq: seq.next(),
        id,
        kind: firstBatch
          ? "snapshot"
          : nag === undefined
            ? "transition"
            : "nag",
        state,
        since: level.since,
        at,
        ...edges.edgeOf(id),
        ...(nag === undefined ? {} : { nag }),
      });
      const again = reportableAt(sub, level, sub.budget.known(id));
      if (again !== undefined) sooner(again);
    }
    sub.budget.retainOnly(levels);
    sub.nextAt = nextAt;
    return { events, firstBatch };
  };

  const owesSnapshot = (): boolean => {
    for (const sub of subs) if (!sub.snapshotDelivered) return true;
    return false;
  };

  const armTimer = (): void => {
    let earliest: number | undefined;
    for (const sub of subs) {
      const at = sub.nextAt;
      if (at !== undefined && (earliest === undefined || at < earliest)) {
        earliest = at;
      }
    }
    clock.armFor(earliest, flush);
  };

  const deliver = (sub: Sub, batch: StateWatchBatch): void => {
    try {
      sub.emit(batch);
    } catch (err) {
      log.error({ err }, "padi: state-watch subscriber threw");
    }
  };

  const flush = (): void => {
    const at = now();
    for (const sub of subs) {
      const { events, firstBatch } = sweep(sub, at);
      if (events.length === 0 && !firstBatch) continue;
      deliver(sub, events);
    }
    armTimer();
  };

  return {
    observe(terminals) {
      hasObserved = true;
      const at = now();
      let moved = false;
      for (const [id, record] of terminals) {
        const agent = activeAgent(record);
        if (agent === null) {
          if (levels.delete(id)) moved = true;
          continue;
        }
        const state = agentBucket(agent.state);
        const known = levels.get(id);
        if (known === undefined || known.state !== state) {
          levels.set(id, { state, since: at });
          moved = true;
        }
      }
      for (const id of levels.keys()) {
        if (!terminals.has(id)) {
          levels.delete(id);
          moved = true;
        }
      }
      if (!moved && !owesSnapshot()) return;
      if (flushQueued) return;
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        flush();
      });
    },

    subscribe(spec, emit, seed) {
      const sub: Sub = {
        spec,
        emit,
        budget: createEpisodeBudget(spec.nagCount, seed),
        snapshotDelivered: false,
      };
      subs.add(sub);
      if (hasObserved) deliver(sub, sweep(sub, now()).events);
      armTimer();
      return {
        counts: sub.budget.entries,
        stop: () => {
          if (!subs.delete(sub)) return;
          armTimer();
        },
      };
    },

    dispose() {
      clock.release();
      subs.clear();
      levels.clear();
      hasObserved = false;
    },
  };
}
