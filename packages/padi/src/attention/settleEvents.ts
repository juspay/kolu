/**
 * The SETTLE EVENT source — "terminal X just started needing someone", as an
 * edge, emitted once per attention episode.
 *
 * padi already computes the FACT: the `urgency` cell's `awaitingIds` (an agent
 * blocked on a human — `awaiting_user`) and `finishedIds` (an agent whose turn
 * ended AND whose PTY output then went quiet for EF2's window). That second list
 * IS the agent-idle ∧ output-settled conjunction a supervisor wants; nothing here
 * recomputes it. What this module adds is the DERIVATIVE: the urgency cell is a
 * level (who is currently in each class), and a notification needs an edge (who
 * just entered one).
 *
 * The edge itself is `@kolu/terminal-vocab`'s attention transition — the SAME
 * decision kolu's browser fires its sound + OS popup on, including its MEMORY of
 * the previous frame (`createAttentionTransitions`, which owns the
 * copy-the-arrays rule this module used to restate). Sharing it is the point: a
 * human at the canvas and a supervising agent in a PTY are told about the same
 * events, by one definition, rather than by two diffs that agree only by luck.
 *
 * **Idempotent on repeated frames.** `observe` is driven from the `urgency`
 * derivation, which the reactor may re-run without a real change; a frame equal to
 * the last one yields no candidates, so a redundant call emits nothing. That is
 * what makes it safe to call from a derivation at all (the same latitude
 * `finish.project` already takes there — see the reactor's DUAL EDGE note).
 *
 * **Sinks run OFF the derivation's stack.** `observe` computes the frame's edges
 * and hands them to a `queueMicrotask` flush; no listener body executes inside
 * `urgency: derived.cell(...)`. The DUAL EDGE latitude covers a cell WRITING a
 * level it read — it does not extend to performing I/O (a sink here writes into
 * another process's PTY) or running third-party listeners on the engine's
 * recompute stack, and `reactor.ts` keeps events off the graph deliberately.
 *
 * **A FRAME is the unit, not an event.** One fold produces N candidates plus M
 * departures, and that grouping is a fact ("your five lanes are gone"), so a sink
 * receives the whole batch. A sink that must group — one nudge per supervisor,
 * however many of its lanes moved — then does not have to reconstitute a grouping
 * the fan-out threw away.
 *
 * It emits; it does not deliver. The standing subscription buffers
 * (`watchRegistry.ts`) register here, so "a worker settled" is computed once at
 * the fold rather than re-derived by each consumer.
 */

import {
  type AttentionTransitions,
  createAttentionTransitions,
} from "@kolu/terminal-vocab/attentionTransitions";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { attentionFrameOf } from "../activity/urgency.ts";
import type { PadiSettleEvent, PadiTerminal, PadiUrgency } from "../surface.ts";
import type { EventSeq } from "./eventSeq.ts";
import {
  edgeMatches,
  edgeOf,
  type SupervisionEdge,
} from "./supervisionEdge.ts";

/** One settle edge — the WIRE shape, aliased for reading rather than declared a
 *  second time. `PadiSettleEventSchema` (`surface.ts`) is the one place the shape
 *  and its prose live, so the server-internal half and the client-facing half
 *  cannot drift in a direction that still type-checks. */
export type SettleEvent = PadiSettleEvent;

/** Which kind of attention a terminal just entered — or its departure. Derived
 *  from the wire literal union for the same reason as {@link SettleEvent}. */
export type SettleKind = PadiSettleEvent["kind"];

/** One observed frame's worth of edges, plus the terminals map they were computed
 *  from. The frame rides along so an IN-PROCESS sink never has to re-read a fact
 *  this fold already held (the supervisor's own record, for the agent guard) —
 *  the wire descriptor is thin on purpose, and a second read path for one fact
 *  inside one frame is exactly what that thinness would otherwise buy. */
export type SettleFrameListener = (
  events: readonly SettleEvent[],
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
) => void;

/** What a SINK plugs into — stable under any change to HOW a settle is detected.
 *  A sink learns nothing about the detector: not `PadiUrgency`, not the fold. */
export interface SettleEventSource {
  /** Register a sink. It receives one NON-EMPTY batch per observed frame — the
   *  fold's own unit — never a per-event drip, and never on the reactor's
   *  recompute stack. Returns an unsubscribe. */
  onFrame(listener: SettleFrameListener): () => void;
  dispose(): void;
}

/** What the DETECTOR feeds. Only the `urgency` derivation holds this: `observe`
 *  is typed in the detector's CURRENT currency (padi's wire urgency cell plus the
 *  composed collection), so moving detection — a kaval-side hook, an agent-CLI
 *  notification, a per-vendor idle probe — changes this half and leaves every
 *  sink's contract untouched. */
export interface SettleEventFeed extends SettleEventSource {
  /** Feed the current urgency level (and the terminals it was folded from).
   *  Emits one event per terminal that just ENTERED an attention class, plus one
   *  per terminal that LEFT the collection. */
  observe(
    urgency: PadiUrgency,
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void;
}

/** Build the settle-event source. `now` is injectable so tests stamp
 *  deterministically; production passes `Date.now`.
 *
 *  `seq` is the DAEMON's counter, not this source's, and it is REQUIRED for the
 *  reason `eventSeq.ts` exists: the agent-state watch mints events into the same
 *  standing-subscription queues, and a subscription's acknowledgement watermark
 *  has to mean one thing whichever source filled it. A private-counter default
 *  would put the hazard back one `??` at a time — silently, and permanently, on
 *  the one caller that forgot. */
export function createSettleEvents(opts: {
  log: Logger;
  now?: () => number;
  seq: EventSeq;
}): SettleEventFeed {
  const { log, seq } = opts;
  const now = opts.now ?? Date.now;
  const listeners = new Set<SettleFrameListener>();
  // The attention TRANSITION plus the previous frame it diffs against — the
  // shared vocabulary's stateful form, so the "copy the arrays or nothing ever
  // fires" rule lives at the diff rather than as a comment here and a second
  // copy in the client's attention core.
  const transitions: AttentionTransitions = createAttentionTransitions();
  // The lane attribution of every terminal as of the last observation — how a
  // DEPARTURE is both seen and ATTRIBUTED. It has to be the edge, not just the
  // key set: by the time a terminal is gone its record is gone with it, so the
  // parent is unknowable at emit time. Remembering it here is what lets a
  // `gone` event still say which lane it was.
  //
  // MAINTAINED IN PLACE, never rebuilt: this is the ~150 ms terminals cadence,
  // and rebuilding a Map of N freshly-spread objects each tick would allocate
  // for every terminal that merely still exists. Arrivals insert, departures
  // delete, and a survivor whose edge is unchanged costs two string compares.
  //
  // `empty` until the first real observation, so a fresh daemon's initial
  // inventory is a discovery rather than a storm of arrivals and departures.
  const lastEdges = new Map<TerminalId, SupervisionEdge>();
  let observed = false;

  return {
    observe(urgency, terminals) {
      // THE SERVE-TIME EMPTY SEED. The `urgency` derivation runs once at serve
      // time, BEFORE the endpoint has booted and adopted kaval's terminals — so
      // its first frame is an empty registry. Letting that information-free
      // frame consume the baseline would make the FIRST REAL inventory look like
      // every terminal had just arrived, and every already-settled worker would
      // be re-announced to its supervisor on every padi restart. Wait for a real
      // observation instead. This is exactly the guard `finishQuiet.syncWaiting`
      // already applies to its own bootstrap, for the same reason.
      if (!observed && terminals.size === 0) return;

      // ONE stamp for the whole fold. `servePadi` observes where the LEVEL is
      // computed so a supervisor's nudge and the Dock's paint describe the same
      // world; events from one fold stamping different `at` values would undo
      // exactly that at the last inch.
      const at = now();
      const batch: SettleEvent[] = [];
      const emit = (
        id: TerminalId,
        kind: SettleKind,
        edge: SupervisionEdge,
      ) => {
        // Spread-or-omit, never an explicit `undefined`: these ride optionalKey
        // fields on the wire schema, which accept an ABSENT key and REJECT a
        // present-but-undefined one (#17).
        batch.push({
          seq: seq.next(),
          id,
          kind,
          at,
          ...(edge.parentId === undefined ? {} : { parentId: edge.parentId }),
          ...(edge.intent === undefined ? {} : { intent: edge.intent }),
        });
      };

      // The frame the transition diffs — read straight off the wire value
      // through the ONE named adapter between padi's `*Ids` dialect and
      // `attentionClass`'s own names, so this can't drift from what every other
      // consumer sees.
      const { candidates } = transitions.observe(attentionFrameOf(urgency));
      for (const { id, asking } of candidates) {
        emit(id, asking ? "asking" : "finished", edgeOf(terminals.get(id)));
      }

      // DEPARTURES. A supervisor blocked on a worker that no longer exists is
      // the same failure as one blocked on a worker nobody reported — so a
      // terminal leaving the collection is an event, not silence.
      for (const [id, edge] of lastEdges) {
        if (terminals.has(id)) continue;
        // The record is gone, so the edge comes from the LAST frame that still
        // had it. That remembered parent is the whole point: it is what lets the
        // departure be delivered to the supervisor rather than only buffered for
        // whoever happens to be subscribed. Emitting BEFORE the delete keeps the
        // read and the eviction on one pass.
        if (observed) emit(id, "gone", edge);
        lastEdges.delete(id);
      }
      // ARRIVALS and edge CHANGES — the only two things that need an allocation.
      for (const [id, record] of terminals) {
        const known = lastEdges.get(id);
        if (known === undefined || !edgeMatches(known, record)) {
          lastEdges.set(id, edgeOf(record));
        }
      }
      observed = true;

      if (batch.length === 0) return;
      // LEAVE THE DERIVATION before any sink runs. The fold stays a level
      // computation, and no listener's I/O — nor a listener that throws — can
      // reach the reactor's stop-hold law. One flush per observed frame, each
      // carrying the frame it was computed from, so two folds in one tick stay
      // two batches rather than one batch describing two worlds.
      queueMicrotask(() => {
        for (const listener of listeners) {
          // Contain a throwing sink to its own frame: one sink's failure must
          // not starve the other of the same batch.
          try {
            listener(batch, terminals);
          } catch (err) {
            log.error({ err }, "padi: settle-frame listener threw");
          }
        }
      });
    },
    onFrame(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      transitions.reset();
      lastEdges.clear();
      observed = false;
    },
  };
}
