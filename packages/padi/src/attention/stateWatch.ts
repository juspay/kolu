/**
 * The AGENT-STATE WATCH — "this terminal has held `waiting` for a minute, and
 * still is", as a level with a memory.
 *
 * The one implementation of the capabilities a supervision face needs, served
 * to both faces (`kolu watch --states/--held-for/--nag/--nag-count` subscribes
 * the `watchStates` stream; an MCP orchestrator passes the same knobs as
 * `watch.open` params). Neither face filters anything of its own — a knob
 * spelled twice is a knob that will mean two things.
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
 *     The nagging is FINITE when the subscriber gives it a count (`nagCount`):
 *     after the first report, at most that many reminders, then quiet about
 *     that terminal — with the accounting stamped on every nag so a consumer
 *     can tell the last one from the others. Only a state CHANGE re-arms the
 *     count: a re-attached subscription inherits the episode's budget through
 *     its seed ({@link StateWatchAnnounced}), never a fresh one.
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

import type { PadiStateEvent, PadiTerminal } from "@kolu/padi-client/surface";
import { activeAgent, type WaitState } from "@kolu/padi-client/terminalVocab";
import { scopeAdmits, type WatchScope } from "@kolu/padi-client/watchScope";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { EdgeMemory } from "./edgeMemory.ts";
import type { EventSeq } from "./eventSeq.ts";

/** The bucket a terminal is holding — the shared `agentBucket` fold's own
 *  answer, including the `other` arm no subscription can target (so an
 *  unrecognized agent state is REMEMBERED as a level and simply never matches,
 *  rather than being silently read as "no agent"). */
type Bucket = ReturnType<typeof agentBucket>;

/** What a subscriber asked for. The wire's knobs, decoded once into the shapes
 *  the engine actually compares against — a set for membership, a number for a
 *  deadline — so no per-frame work re-parses an array. */
export interface StateWatchSpec {
  /** Buckets to report. Never empty: both faces fill the default before they get
   *  here, because an empty set is a subscription that can never match and would
   *  read to its owner exactly like a quiet workspace. */
  readonly states: ReadonlySet<WaitState>;
  /** WHICH terminals this subscription reports — the include list and the mute
   *  as ONE value, so "does it report this terminal" has one answer and one
   *  reader ({@link scopeAdmits}) rather than a two-clause conjunction copied
   *  into every event source. */
  readonly scope: WatchScope;
  /** How long a state must hold before it is reported. 0 reports on entry. */
  readonly heldForMs: number;
  /** How often to RE-report while it keeps holding, or `undefined` to report
   *  once. */
  readonly nagMs?: number;
  /** CAP the nagging: after the first report of an episode, at most this many
   *  reminders, then quiet about that terminal. A state CHANGE re-arms it — a
   *  re-entry mints a fresh episode with its own first report and its own
   *  count — and nothing else re-arms it: a re-attach with the same question
   *  INHERITS the budget through {@link subscribe}'s seed. `undefined` nags
   *  forever. Meaningful only with `nagMs`; the faces spell the count inside
   *  the interval (`--nag 30m/3`), and the wire's decode refuses the orphan. */
  readonly nagCount?: number;
}

/** The knob set alone — a spec minus the scope, which a standing
 *  subscription states once as its own {@link WatchScope} and must not restate
 *  here. */
export type StateWatchFilter = Omit<StateWatchSpec, "scope">;

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

/** One event batch — a fold's own unit, so every event in it shares an `at`. */
export type StateWatchBatch = readonly PadiStateEvent[];

export interface StateWatchHub {
  /** Feed the current terminals collection. Updates the level map; any events it
   *  makes due are emitted off this stack. Idempotent on an unchanged frame. */
  observe(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  /** Start a subscription. The currently-matching set is emitted SYNCHRONOUSLY,
   *  as this call's first batch — possibly empty, which is itself the answer
   *  "nothing is neglected right now" and the snapshot frame a stream consumer
   *  needs. A `seed` — the budget the subscription's PREDECESSOR left — keeps a
   *  re-attach from re-arming a spent cap: the cap is per EPISODE, so the
   *  counts are the per-episode state, and the attachment that carries them is
   *  just its holder. The returned attachment's `counts` is the seed its own
   *  successor reads back. */
  subscribe(
    spec: StateWatchSpec,
    emit: (batch: StateWatchBatch) => void,
    seed?: ReadonlyMap<TerminalId, StateWatchAnnounced>,
  ): StateWatchAttachment;
  dispose(): void;
}

/** One live subscription, as the caller holds it: how to stop it, and the
 *  episode budget it has built up. */
export interface StateWatchAttachment {
  /** Detach — fed nothing more, and the clock debt it armed is released. */
  readonly stop: () => void;
  /** The per-episode counts, LIVE: the seed its successor is opened with. Read
   *  it at the hand-off — the map belongs to the attachment, and what it says
   *  after `stop` is the budget as it stood when the watch ended. */
  readonly counts: ReadonlyMap<TerminalId, StateWatchAnnounced>;
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

/** What a subscription has already told its owner about one terminal — and,
 *  exported, the budget a RE-ATTACHED subscription is seeded with: the cap is
 *  per EPISODE, so the record, not the attachment that holds it, is the thing
 *  that survives an ordinary restart. */
export interface StateWatchAnnounced {
  /** The episode it was told about — a re-entry into the same state mints a new
   *  `since`, which is what makes it a fresh transition rather than a nag. */
  since: number;
  /** WHEN it was last told. The terminal owns when it was reported; whether (and
   *  how often) this subscription nags is the spec's `nagMs`, asked of the spec
   *  at both readers — rather than a per-terminal optional that has to stay in
   *  step with it. */
  toldAt: number;
  /** How many NAGS this episode has been sent — the count the spec's `nagCount`
   *  caps. The first report (snapshot/transition) is not a nag and is not
   *  counted. A fresh episode starts at 0, which is what a state change re-arms
   *  the cap THROUGH. */
  nags: number;
  /** Set while THIS subscription has not yet made its own FIRST report of the
   *  episode — which is every entry an attachment is seeded with: a re-open is
   *  owed the standing set as a snapshot even when the inherited budget is
   *  SPENT, or the re-attach's promise ("answers with the currently-matching
   *  set") would be false exactly when the cap ran out. Cleared by the emit. */
  unreported?: true;
}

interface Sub {
  readonly spec: StateWatchSpec;
  readonly emit: (batch: StateWatchBatch) => void;
  readonly announced: Map<TerminalId, StateWatchAnnounced>;
  /** Has this subscription had its FIRST batch — the snapshot — yet? Consumed
   *  and set by {@link sweep}, which HANDS BACK what it consumed, so no caller
   *  reads this field to decide the same thing one line before calling. */
  snapshotDelivered: boolean;
  /** When this subscription next needs waking, as of its last sweep — the only
   *  thing {@link armTimer} reads. A sweep is what makes a deadline move, so
   *  recording it there is what keeps the timer from re-deriving the schedule. */
  nextAt?: number;
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
  /** The absolute instant {@link cancelTimer} is armed for, so an unchanged
   *  deadline can be left alone rather than re-scheduled to the same moment. */
  let armedAt: number | undefined;
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
    if (!scopeAdmits(sub.spec.scope, id)) return undefined;
    return state;
  };

  /** WHEN this terminal is next reportable to this subscription, or `undefined`
   *  when there is nothing more to say about it.
   *
   *  THE schedule, as one expression. Everything the hub does with time is this
   *  one instant compared against the clock: `sweep` fires the terminals whose
   *  moment has arrived and takes the earliest of the rest as its wake-up, so
   *  "is it due now" and "when is it next due" cannot answer differently. They
   *  used to be two walks over the same map restating the same rule in two
   *  shapes — and a disagreement between them is not a type error, it is a hub
   *  that spins or sleeps through a nag. */
  const reportableAt = (
    sub: Sub,
    level: Level,
    known: StateWatchAnnounced | undefined,
  ): number | undefined => {
    // A fresh episode is reportable once it has HELD. `known.since` identifies
    // the episode, so a re-entry into the same state is fresh again. A SEEDED
    // entry this subscription never reported asks the same thing: its first
    // report is owed regardless of the inherited budget's cadence or cap.
    if (known === undefined || known.since !== level.since) {
      return level.since + sub.spec.heldForMs;
    }
    if (known.unreported === true) return level.since + sub.spec.heldForMs;
    // Already reported, and still holding: the nag, or silence — forever when
    // no `nagMs` was named, and from the moment a `nagCount` cap is SPENT. A
    // spent cap is not a deadline: it arms nothing, which is what "goes quiet
    // about that terminal" means to the timer.
    if (sub.spec.nagMs === undefined) return undefined;
    if (sub.spec.nagCount !== undefined && known.nags >= sub.spec.nagCount) {
      return undefined;
    }
    return known.toldAt + sub.spec.nagMs;
  };

  /** One pass over the levels for one subscription: what is due at `at`, and
   *  when to come back. The ONE decision procedure — the snapshot at subscribe
   *  time is this function on a subscription that has had no batch yet, and
   *  every later frame is this function on one that has, so a snapshot and a
   *  transition can never disagree about what "matching" means. */
  const sweep = (
    sub: Sub,
    at: number,
  ): { batch: PadiStateEvent[]; arriving: boolean } => {
    const batch: PadiStateEvent[] = [];
    const arriving = !sub.snapshotDelivered;
    sub.snapshotDelivered = true;
    let nextAt: number | undefined;
    for (const [id, level] of levels) {
      const state = matched(sub, id, level);
      if (state === undefined) {
        // It left the class (or the scope). Forget it, so a later re-entry is a
        // fresh TRANSITION rather than a nag against a stale episode.
        sub.announced.delete(id);
        continue;
      }
      const known = sub.announced.get(id);
      const at_ = reportableAt(sub, level, known);
      if (at_ === undefined) continue;
      if (at < at_) {
        if (nextAt === undefined || at_ < nextAt) nextAt = at_;
        continue;
      }
      // Is the episode the subscription last TOLD the one still standing?
      const continuing = known !== undefined && known.since === level.since;
      // This subscription's own FIRST report of the episode — asked of the
      // RECORD, not the batch: a re-attach with a LARGER hold defers a seeded
      // episode's first report past the arriving sweep (its deadline is the
      // schedule above's), and the batch's `arriving` alone would misstamp
      // that deferred first report as a nag — one a spent budget would number
      // past the cap, with a negative `left`.
      const first = !continuing || known.unreported === true;
      // Which reminder this emit is: 0 is the first report; k is the k-th nag.
      // The cap counts these, and the wire stamps them, from this one number.
      // A SEEDED re-attach keeps the episode's budget: its arriving first
      // report is a snapshot (reminder 0), its later nags continue the count
      // it inherited — an ordinary restart never re-arms the cap.
      const reminder = first ? 0 : known.nags + 1;
      // How many reminders follow — the cap minus this one — asked of the spec
      // so the stamp and the schedule can never disagree about it. Absent when
      // nothing caps the nagging (there is no last one to name).
      const left =
        sub.spec.nagCount === undefined
          ? undefined
          : sub.spec.nagCount - reminder;
      batch.push({
        seq: seq.next(),
        id,
        // A subscription's FIRST report of a terminal it found already matching
        // is a snapshot; every later first-report is a transition it watched
        // happen. The two are the same membership, told apart by whether the
        // subscriber was there for the edge.
        // A (re)open's first batch is ALWAYS snapshots of the standing set —
        // even of an inherited, still-standing episode — and never a nag a
        // caller watching this attachment's feed would read as its own.
        kind: arriving ? "snapshot" : first ? "transition" : "nag",
        state,
        since: level.since,
        at,
        ...edges.edgeOf(id),
        // The reminder accounting rides NAGS ONLY — a first report is not a
        // reminder and carries none of it. `left` omitted rather than a lie
        // about an end an uncapped subscription does not have.
        ...(reminder === 0
          ? {}
          : {
              nag: { index: reminder, ...(left === undefined ? {} : { left }) },
            }),
      });
      const told: StateWatchAnnounced = {
        since: level.since,
        toldAt: at,
        // A first report counts nothing; a CONTINUING first report after a
        // re-attach keeps the budget it inherited rather than zeroing it.
        nags: continuing ? Math.max(known.nags, reminder) : reminder,
      };
      sub.announced.set(id, told);
      // Just told: the next thing owed about it — a nag while the count
      // remains, silence once it is spent — asked of THE schedule rather than
      // re-derived here, so the emit and the arm read the same expression.
      const again = reportableAt(sub, level, told);
      if (again !== undefined && (nextAt === undefined || again < nextAt)) {
        nextAt = again;
      }
    }
    // Announcements for terminals that no longer exist at all.
    for (const id of sub.announced.keys()) {
      if (!levels.has(id)) sub.announced.delete(id);
    }
    sub.nextAt = nextAt;
    return { batch, arriving };
  };

  /** Is any subscription still waiting for its first batch? Cheap — there are a
   *  handful of subscriptions at most — and asked only on a frame that moved
   *  nothing. */
  const owesSnapshot = (): boolean => {
    for (const sub of subs) if (!sub.snapshotDelivered) return true;
    return false;
  };

  /** Re-arm the ONE timer at the earliest deadline across every subscription.
   *  Reads each subscription's LAST sweep answer rather than re-deriving it: a
   *  sweep is what makes a deadline move, and every sweep records its own. */
  const armTimer = (): void => {
    let earliest: number | undefined;
    for (const sub of subs) {
      const at = sub.nextAt;
      if (at !== undefined && (earliest === undefined || at < earliest)) {
        earliest = at;
      }
    }
    // The armed wake is an ABSOLUTE instant, so an unchanged earliest needs no
    // work at all — cancelling and re-scheduling would buy the identical moment
    // for a `clearTimeout`, a `setTimeout` and a fresh `Timeout` in the heap.
    //
    // What this does NOT do is spare the byte cadence: `armTimer` is reached
    // only from `flush` (which `observe` gates on a moved level), from
    // `subscribe`, and from an unsubscribe — a repaint frame never reaches it at
    // all. What it spares is the REAL flush: a terminal arriving, leaving or
    // changing bucket while some other subscription's deadline stands unchanged.
    // The walk above is O(subscriptions) and stays so; this skips the
    // SCHEDULING, not the derivation.
    if (earliest === armedAt) return;
    cancelTimer?.();
    cancelTimer = undefined;
    armedAt = earliest;
    if (earliest === undefined) return;
    cancelTimer = schedule(Math.max(0, earliest - now()), () => {
      cancelTimer = undefined;
      armedAt = undefined;
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
      // `arriving` comes back FROM the sweep that consumed it — a subscription
      // that opened before the hub had looked has had no batch yet, so this one
      // is its SNAPSHOT, delivered even when empty because it is that
      // subscription's first frame and therefore its snapshot boundary.
      const { batch, arriving } = sweep(sub, at);
      if (batch.length === 0 && !arriving) continue;
      deliver(sub, batch);
    }
    armTimer();
  };

  return {
    observe(terminals) {
      hasObserved = true;
      const at = now();
      // Did this frame MOVE anything? The producer is the ~150 ms terminals
      // cadence — byte activity, recency, snapshot churn — while a bucket
      // changes perhaps once a minute per terminal, so the overwhelming
      // majority of frames leave this map byte-identical. Only a frame that
      // moved it can make an event due; a hold or a nag arriving through time
      // alone is the timer's job, and it is already armed for it.
      let moved = false;
      for (const [id, record] of terminals) {
        const agent = activeAgent(record);
        if (agent === null) {
          // No live agent — a bare shell, or a sleeping/parked record whose PTY
          // is released. It holds no bucket, so it leaves the level map entirely
          // rather than lingering as a stale state nothing can clear.
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
      // A subscription opened before the first observation is owed its snapshot
      // even by a frame that moved nothing — including a first frame with no
      // agent in it at all, which is a real answer ("nothing is neglected") and
      // moves no level.
      if (!moved && !owesSnapshot()) return;
      // LEAVE THE DERIVATION before any subscriber runs. Coalesced, so two folds
      // in one tick cost one flush.
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
        // A seed is COPIED, never shared: the counts are the episode's, but the
        // map itself is one attachment's, mutated nowhere else. Every inherited
        // entry is marked UNREPORTED, so this subscription owes its own first
        // report of each standing episode — a spent inherited cap buys silence,
        // not invisibility.
        announced: new Map(
          [...(seed ?? [])].map(([id, known]) => [
            id,
            { ...known, unreported: true } satisfies StateWatchAnnounced,
          ]),
        ),
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
      if (hasObserved) deliver(sub, sweep(sub, now()).batch);
      armTimer();
      return {
        counts: sub.announced,
        stop: () => {
          if (!subs.delete(sub)) return;
          armTimer();
        },
      };
    },

    dispose() {
      cancelTimer?.();
      cancelTimer = undefined;
      armedAt = undefined;
      subs.clear();
      levels.clear();
      hasObserved = false;
    },
  };
}
