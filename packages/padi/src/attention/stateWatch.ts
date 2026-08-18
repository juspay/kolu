/**
 * The AGENT-STATE WATCH — "this terminal has held `waiting` for a minute, and
 * still is", as a level with a memory.
 *
 * The one implementation of the four things a supervision face needs, served to
 * both faces (`kolu watch --states/--held-for/--nag` subscribes the
 * `watchStates` stream; an MCP orchestrator passes the same three as
 * `watch.open` params). Neither face filters anything of its own — a knob spelled
 * twice is a knob that will mean two things.
 *
 * ## Ask the adapter, never the bytes
 *
 * The level is `agentBucket(agent.state)` — the state the agent's OWN adapter
 * published, folded through the one shared vocabulary. Nothing here reads output.
 * That is the #2177 lesson made structural: a quiet screen is not an idle agent
 * (a grok sitting at an empty prompt repaints about once a second, which starved
 * a 1.5 s byte-quiet gate forever), and a busy screen is not a busy agent (a
 * subagent's churn under a finished main loop). `heldFor` debounces the STATE, so
 * a repaint can neither start nor stop a hold.
 *
 * ## Four capabilities, one engine
 *
 *   - **states** — which buckets a subscriber cares about. A filter at the
 *     source: an unmatched terminal costs a set lookup and never reaches a wire.
 *   - **heldFor** — report only once the state has held that long. Debounced
 *     where the clock lives, so no consumer hand-rolls a timer over a feed.
 *   - **nag** — RE-report while it keeps holding. This is the level trigger, and
 *     the whole difference between a doorbell you can miss and one that keeps
 *     ringing: an ignored terminal reappears instead of vanishing after one line.
 *   - **snapshot** — {@link StateWatchHub.subscribe} emits the currently-matching
 *     set as its first batch, before any stream of changes. A late joiner sees
 *     standing neglect, not just the future.
 *
 * ## What holds the clock
 *
 * A hold and a nag both come due while NOTHING is happening — that is the point
 * of them — so the hub owns a timer as well as the observation. One timer, armed
 * at the earliest deadline across every subscription, rather than an interval per
 * subscription: a daemon with no subscriber arms nothing, and a daemon with five
 * wakes once.
 *
 * ## Emissions leave the derivation
 *
 * `observe` is called from padi's `urgency` derived cell, on the ~150 ms terminals
 * cadence. It updates the level map and schedules a flush on a microtask; no
 * subscriber body — a wire write, a queue push — ever runs on the reactor's
 * recompute stack. Same rule, same reason as `settleEvents.ts`.
 */

import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { PadiStateEvent, PadiTerminal } from "../surface.ts";
import { activeAgent, type WaitState } from "../terminalVocab.ts";
import type { EdgeMemory } from "./edgeMemory.ts";
import type { EventSeq } from "./eventSeq.ts";

/** The bucket a terminal is holding — the shared `agentBucket` fold's own
 *  answer, including the `other` arm no subscription can target (so an
 *  unrecognized agent state is REMEMBERED as a level and simply never matches,
 *  rather than being silently read as "no agent"). */
type Bucket = ReturnType<typeof agentBucket>;

/** What a subscriber asked for. The wire's three knobs, decoded once into the
 *  shapes the engine actually compares against — a set for membership, a number
 *  for a deadline — so no per-frame work re-parses an array. */
export interface StateWatchSpec {
  /** Buckets to report. Never empty: both faces fill the default before they get
   *  here, because an empty set is a subscription that can never match and would
   *  read to its owner exactly like a quiet workspace. */
  readonly states: ReadonlySet<WaitState>;
  /** Terminals to report, or `undefined` for the whole fleet. */
  readonly ids?: ReadonlySet<TerminalId>;
  /** How long a state must hold before it is reported. 0 reports on entry. */
  readonly heldForMs: number;
  /** How often to RE-report while it keeps holding, or `undefined` to report
   *  once. */
  readonly nagMs?: number;
}

/** The three knobs alone — a spec minus the scope, which a standing
 *  subscription states once as its own `ids` and must not restate here. */
export type StateWatchFilter = Omit<StateWatchSpec, "ids">;

/** Do two filters ask the SAME question? Lives beside the filter it compares —
 *  "same question" is spec knowledge, not queue knowledge — and is load-bearing
 *  for the one consumer that asks: a retained buffer holds ANSWERS, and an
 *  answer to a question nobody is asking any more is not something to preserve.
 *  Absent-vs-absent is the same question; both mean the settle detector.
 *
 *  The witness below is the point of the placement: a knob added to
 *  {@link StateWatchFilter} without a comparison here stops this compiling,
 *  instead of silently letting a re-opened subscription keep the answers to a
 *  question it just stopped asking. */
export function sameStateWatchFilter(
  a: StateWatchFilter | undefined,
  b: StateWatchFilter | undefined,
): boolean {
  const _compared = {
    states: true,
    heldForMs: true,
    nagMs: true,
  } satisfies Record<keyof StateWatchFilter, true>;
  if (a === undefined || b === undefined) return a === b;
  if (a.heldForMs !== b.heldForMs || a.nagMs !== b.nagMs) return false;
  if (a.states.size !== b.states.size) return false;
  for (const s of a.states) if (!b.states.has(s)) return false;
  return true;
}

/** One event batch — a fold's own unit, so every event in it shares an `at`. */
export type StateWatchBatch = readonly PadiStateEvent[];

export interface StateWatchHub {
  /** Feed the current terminals collection. Updates the level map; any events it
   *  makes due are emitted off this stack. Idempotent on an unchanged frame. */
  observe(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  /** Start a subscription. The currently-matching set is emitted SYNCHRONOUSLY,
   *  as this call's first batch — possibly empty, which is itself the answer
   *  "nothing is neglected right now" and the snapshot frame a stream consumer
   *  needs. Returns an unsubscribe. */
  subscribe(
    spec: StateWatchSpec,
    emit: (batch: StateWatchBatch) => void,
  ): () => void;
  dispose(): void;
}

/** A terminal's level, as of the last observation. A VALUE, never a live
 *  handle: a level is REPLACED when it changes and nothing mutates one in
 *  place, so a reader holding one holds a frame's answer. The lane attribution
 *  is not here at all — it is the producer's one `edgeMemory`, read at the emit,
 *  so this source and the settle detector cannot disagree about a parent. */
interface Level {
  readonly state: Bucket;
  /** ms epoch of the observation that first saw this state. */
  readonly since: number;
}

/** What a subscription has already told its owner about one terminal. */
interface Announced {
  /** The episode it was told about — a re-entry into the same state mints a new
   *  `since`, which is what makes it a fresh transition rather than a nag. */
  since: number;
  /** WHEN it was last told. The terminal owns when it was reported; whether (and
   *  how often) this subscription nags is the spec's `nagMs`, asked of the spec
   *  at both readers — rather than a per-terminal optional that has to stay in
   *  step with it. */
  toldAt: number;
}

interface Sub {
  readonly spec: StateWatchSpec;
  readonly emit: (batch: StateWatchBatch) => void;
  readonly announced: Map<TerminalId, Announced>;
  /** Has this subscription had its FIRST batch — the snapshot — yet? Read and
   *  set by {@link due} itself, so "is this the arriving frame" is one fact in
   *  one place rather than a field on one path and an argument on the other. */
  snapshotDelivered: boolean;
}

/** A scheduled one-shot, injectable so tests drive the clock instead of waiting
 *  on one. Returns a cancel. */
export type ScheduleTimer = (delayMs: number, fire: () => void) => () => void;

const defaultSchedule: ScheduleTimer = (delayMs, fire) => {
  const t = setTimeout(fire, delayMs);
  // A supervision clock never holds the daemon open on its own.
  t.unref?.();
  return () => clearTimeout(t);
};

export function createStateWatchHub(opts: {
  log: Logger;
  seq: EventSeq;
  /** The daemon's ONE lane-attribution memory, observed by the PRODUCER before
   *  this hub is fed the same frame. Read at the emit, never maintained here. */
  edges: EdgeMemory;
  now?: () => number;
  schedule?: ScheduleTimer;
}): StateWatchHub {
  const { log, seq, edges } = opts;
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? defaultSchedule;

  const levels = new Map<TerminalId, Level>();
  const subs = new Set<Sub>();
  let cancelTimer: (() => void) | undefined;
  let flushQueued = false;
  // Has the hub LOOKED yet? One job only: a subscription that opens before the
  // first observation is owed a deferred snapshot rather than an immediate
  // "nothing is neglected" from a hub that has seen no fleet. The serve-time
  // empty seed — padi's `urgency` derivation running once before the endpoint
  // adopted kaval's terminals — is gated ONCE at its producer (`servePadi`'s
  // urgency cell), so a frame that reaches here is a frame worth taking.
  let hasObserved = false;

  /** The state this subscription would report this terminal under, or
   *  `undefined` when it does not care. Returns the STATE rather than a boolean
   *  so the `other` bucket — the arm no subscription can target — is narrowed
   *  away here, once, instead of being cast back in at the emit. */
  const matched = (
    sub: Sub,
    id: TerminalId,
    level: Level,
  ): WaitState | undefined => {
    const state = level.state;
    if (state === "other") return undefined;
    if (!sub.spec.states.has(state)) return undefined;
    if (sub.spec.ids !== undefined && !sub.spec.ids.has(id)) return undefined;
    return state;
  };

  /** Everything due for one subscription at `at`, and the announcement
   *  bookkeeping that goes with it. The ONE decision procedure: the snapshot at
   *  subscribe time is this function on a subscription that has had no batch
   *  yet, and every later frame is this function on one that has — so a snapshot
   *  and a transition can never disagree about what "matching" means. */
  const due = (sub: Sub, at: number): PadiStateEvent[] => {
    const batch: PadiStateEvent[] = [];
    const { heldForMs, nagMs } = sub.spec;
    const arriving = !sub.snapshotDelivered;
    sub.snapshotDelivered = true;
    for (const [id, level] of levels) {
      const state = matched(sub, id, level);
      if (state === undefined) {
        // It left the class (or the scope). Forget it, so a later re-entry is a
        // fresh TRANSITION rather than a nag against a stale episode.
        sub.announced.delete(id);
        continue;
      }
      if (at - level.since < heldForMs) continue;
      const known = sub.announced.get(id);
      const fresh = known === undefined || known.since !== level.since;
      if (!fresh && (nagMs === undefined || at < known.toldAt + nagMs)) {
        continue;
      }
      batch.push({
        seq: seq.next(),
        id,
        // A subscription's FIRST report of a terminal it found already matching
        // is a snapshot; every later first-report is a transition it watched
        // happen. The two are the same membership, told apart by whether the
        // subscriber was there for the edge.
        kind: fresh ? (arriving ? "snapshot" : "transition") : "nag",
        state,
        since: level.since,
        at,
        ...edges.edgeOf(id),
      });
      sub.announced.set(id, { since: level.since, toldAt: at });
    }
    // Announcements for terminals that no longer exist at all.
    for (const id of sub.announced.keys()) {
      if (!levels.has(id)) sub.announced.delete(id);
    }
    return batch;
  };

  /** When this subscription next needs waking, or `undefined` if never. */
  const nextDeadline = (sub: Sub): number | undefined => {
    let earliest: number | undefined;
    const consider = (at: number): void => {
      if (earliest === undefined || at < earliest) earliest = at;
    };
    for (const [id, level] of levels) {
      if (matched(sub, id, level) === undefined) continue;
      const known = sub.announced.get(id);
      if (known === undefined || known.since !== level.since) {
        consider(level.since + sub.spec.heldForMs);
      } else if (sub.spec.nagMs !== undefined) {
        consider(known.toldAt + sub.spec.nagMs);
      }
    }
    return earliest;
  };

  /** Re-arm the ONE timer at the earliest deadline across every subscription. */
  const armTimer = (): void => {
    cancelTimer?.();
    cancelTimer = undefined;
    let earliest: number | undefined;
    for (const sub of subs) {
      const at = nextDeadline(sub);
      if (at !== undefined && (earliest === undefined || at < earliest)) {
        earliest = at;
      }
    }
    if (earliest === undefined) return;
    cancelTimer = schedule(Math.max(0, earliest - now()), () => {
      cancelTimer = undefined;
      flush();
    });
  };

  /** Hand ONE batch over. Contain a throwing subscriber to its own batch: one
   *  dead consumer must not starve the others, must not escape into the timer
   *  that woke us, and must not leave itself half-registered by throwing out of
   *  `subscribe` — which is why every delivery, snapshot included, goes through
   *  here. */
  const deliver = (sub: Sub, batch: StateWatchBatch): void => {
    try {
      sub.emit(batch);
    } catch (err) {
      log.error({ err }, "padi: state-watch subscriber threw");
    }
  };

  /** Hand every subscription what it is owed, then re-arm. */
  const flush = (): void => {
    // ONE stamp for the whole flush, so events that came due together describe
    // the same instant — the same rule `settleEvents` applies per fold.
    const at = now();
    for (const sub of subs) {
      // A subscription that opened before the hub had looked has had no batch
      // yet, so this one is its SNAPSHOT, not a transition — it was never there
      // for an edge, and the batch is delivered even when empty because it is
      // that subscription's first frame.
      const wasFirst = !sub.snapshotDelivered;
      const batch = due(sub, at);
      if (batch.length === 0 && !wasFirst) continue;
      deliver(sub, batch);
    }
    armTimer();
  };

  return {
    observe(terminals) {
      hasObserved = true;
      const at = now();
      for (const [id, record] of terminals) {
        const agent = activeAgent(record);
        if (agent === null) {
          // No live agent — a bare shell, or a sleeping/parked record whose PTY
          // is released. It holds no bucket, so it leaves the level map entirely
          // rather than lingering as a stale state nothing can clear.
          levels.delete(id);
          continue;
        }
        const state = agentBucket(agent.state);
        const known = levels.get(id);
        if (known === undefined || known.state !== state) {
          levels.set(id, { state, since: at });
        }
      }
      for (const id of levels.keys()) {
        if (!terminals.has(id)) levels.delete(id);
      }
      // LEAVE THE DERIVATION before any subscriber runs. Coalesced, so two folds
      // in one tick cost one flush.
      if (flushQueued) return;
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        flush();
      });
    },

    subscribe(spec, emit) {
      const sub: Sub = {
        spec,
        emit,
        announced: new Map(),
        snapshotDelivered: false,
      };
      subs.add(sub);
      // The SNAPSHOT — emitted synchronously so it is the caller's first frame,
      // and emitted even when EMPTY: "nothing is neglected right now" is an
      // answer, and a stream whose first frame were a later transition would
      // have no snapshot boundary at all.
      //
      // Unless the hub has never LOOKED. A subscription opened in padi's boot
      // window — after `servePadi` builds the graph, before the endpoint has
      // adopted kaval's terminals — would otherwise be told the fleet is calm by
      // a hub that has seen no fleet, which is the one answer this whole feature
      // exists to stop giving. It waits for the first real observation instead,
      // and gets a snapshot of what is actually there.
      if (hasObserved) deliver(sub, due(sub, now()));
      armTimer();
      return () => {
        if (!subs.delete(sub)) return;
        armTimer();
      };
    },

    dispose() {
      cancelTimer?.();
      cancelTimer = undefined;
      subs.clear();
      levels.clear();
      hasObserved = false;
    },
  };
}
