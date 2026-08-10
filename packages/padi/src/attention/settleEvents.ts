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
 * The edge itself is `@kolu/terminal-vocab`'s `attentionTransitions` — the SAME
 * decision kolu's browser fires its sound + OS popup on. Sharing it is the point:
 * a human at the canvas and a supervising agent in a PTY are told about the same
 * events, by one definition, rather than by two diffs that agree only by luck.
 *
 * **Idempotent on repeated frames.** `observe` is driven from the `urgency`
 * derivation, which the reactor may re-run without a real change; a frame equal to
 * the last one yields no candidates, so a redundant call emits nothing. That is
 * what makes it safe to call from a derivation at all (the same latitude
 * `finish.project` already takes there — see the reactor's DUAL EDGE note).
 *
 * It emits; it does not deliver. The two sinks — the supervision-edge mailbox
 * write (`supervisionDelivery.ts`) and the standing subscription buffers
 * (`watchRegistry.ts`) — both register here, so "a worker settled" is computed
 * once and fans out, rather than each sink growing its own detector.
 */

import {
  type AttentionFrame,
  attentionTransitions,
} from "@kolu/terminal-vocab/attentionTransitions";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal, PadiUrgency } from "../surface.ts";

/** Which kind of attention a terminal just entered — or its departure.
 *
 *  `asking` is an agent BLOCKED on a person (`awaiting_user`) — ungated by the
 *  quiet window, because an agent that says it is blocked is definitionally not
 *  mid-output. `finished` is a turn that ENDED and then went quiet (EF2). The
 *  split is padi's shipped `attentionClass` partition, not a new vocabulary.
 *
 *  `gone` is the terminal LEAVING the collection — it exited, was killed, or its
 *  id was retired by a kaval recycle (which parks the session and respawns each
 *  active terminal under a FRESH id). It rides the same channel deliberately: a
 *  supervisor waiting on a worker that no longer exists must be TOLD, not left
 *  waiting for a settle that can never come. Without it, a subscription scoped
 *  to specific ids would simply go quiet after a recycle — silence that reads
 *  exactly like a calm workspace, which is the failure this whole feature is
 *  about. */
export type SettleKind = "asking" | "finished" | "gone";

/** One settle edge. Deliberately a THIN descriptor: the id, why, and the
 *  supervision edge to deliver along — never a copy of the terminal's screen.
 *  A recipient reads the screen through `screen_text`, so what it acts on is the
 *  CURRENT output rather than a snapshot that aged in a queue. */
export interface SettleEvent {
  /** Monotonic per-daemon sequence — the cursor a standing subscription drains
   *  against, so "what have I not seen" is a number comparison and never a
   *  guess. */
  readonly seq: number;
  readonly id: TerminalId;
  readonly kind: SettleKind;
  /** ms epoch, stamped once at emit. */
  readonly at: number;
  /** The supervision edge, when this terminal has one — who should hear about
   *  it. Absent for a root terminal (nobody spawned it). */
  readonly parentId?: TerminalId;
  /** The terminal's freeform intent annotation, when set — the one piece of
   *  "what was this lane doing" a recipient can't cheaply re-derive. */
  readonly intent?: string;
}

export interface SettleEventSource {
  /** Feed the current urgency level (and the terminals it was folded from).
   *  Emits one event per terminal that just ENTERED an attention class. */
  observe(
    urgency: PadiUrgency,
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void;
  /** Register a sink. Returns an unsubscribe. */
  onEvent(listener: (event: SettleEvent) => void): () => void;
  /** The last sequence number emitted — a fresh subscription starts here, so it
   *  receives what happens NEXT rather than replaying the daemon's history. */
  lastSeq(): number;
  dispose(): void;
}

/** Build the settle-event source. `now` is injectable so tests stamp
 *  deterministically; production passes `Date.now`. */
export function createSettleEvents(
  now: () => number = Date.now,
): SettleEventSource {
  const listeners = new Set<(event: SettleEvent) => void>();
  let prev: AttentionFrame | null = null;
  // The supervision edge of every terminal as of the last observation — how a
  // DEPARTURE is both seen and ATTRIBUTED. It has to be the edge, not just the
  // key set: by the time a terminal is gone its record is gone with it, so the
  // parent is unknowable at emit time. Remembering it here is what lets a
  // departure reach the supervisor at all — a `gone` event with no `parentId`
  // is one the supervision edge can never deliver.
  // `null` until the first frame, so a fresh daemon's initial inventory is a
  // discovery rather than a storm of arrivals/departures.
  let prevEdges: Map<
    TerminalId,
    { parentId?: TerminalId; intent?: string }
  > | null = null;
  let seq = 0;

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
      if (prev === null && terminals.size === 0) return;

      // The frame the transition diffs — the two attention classes a supervisor
      // cares about, read straight off the wire value so this can't drift from
      // what every other consumer sees.
      const cur: AttentionFrame = {
        asking: urgency.awaitingIds,
        finished: urgency.finishedIds,
      };
      const { candidates } = attentionTransitions(prev, cur);
      // SNAPSHOT the lists — the urgency value is rebuilt per fold, but a future
      // caller could hand back the same arrays; holding the reference would risk
      // `prev` and `cur` being the same object, so no transition is ever seen.
      prev = { asking: [...cur.asking], finished: [...cur.finished] };

      const emit = (
        id: TerminalId,
        kind: SettleKind,
        edge: { parentId?: TerminalId; intent?: string },
      ): void => {
        seq += 1;
        // Spread-or-omit, never an explicit `undefined`: these ride optionalKey
        // fields on the wire schema, which accept an ABSENT key and REJECT a
        // present-but-undefined one (#17).
        const event: SettleEvent = {
          seq,
          id,
          kind,
          at: now(),
          ...(edge.parentId === undefined ? {} : { parentId: edge.parentId }),
          ...(edge.intent === undefined ? {} : { intent: edge.intent }),
        };
        for (const listener of listeners) {
          // Contain a throwing sink to its own frame: one sink's failure must not
          // starve the other of the same event, nor escape into the `urgency`
          // derivation (where the reactor's stop-hold law would freeze the cell).
          try {
            listener(event);
          } catch (err) {
            console.error("padi: settle-event listener threw", err);
          }
        }
      };

      /** The supervision edge of a live record, spread-safe. */
      const edgeOf = (
        record: PadiTerminal | undefined,
      ): { parentId?: TerminalId; intent?: string } => ({
        ...(record?.parentId === undefined
          ? {}
          : { parentId: record.parentId as TerminalId }),
        ...(record?.intent === undefined ? {} : { intent: record.intent }),
      });

      for (const { id, asking } of candidates) {
        emit(id, asking ? "asking" : "finished", edgeOf(terminals.get(id)));
      }

      // DEPARTURES. A supervisor blocked on a worker that no longer exists is
      // the same failure as one blocked on a worker nobody reported — so a
      // terminal leaving the collection is an event, not silence.
      const curEdges = new Map<
        TerminalId,
        { parentId?: TerminalId; intent?: string }
      >();
      for (const [id, record] of terminals) curEdges.set(id, edgeOf(record));
      if (prevEdges !== null) {
        for (const [id, edge] of prevEdges) {
          // The record is gone, so the edge comes from the LAST frame that still
          // had it. That remembered parent is the whole point: it is what lets
          // the departure be delivered to the supervisor rather than only
          // buffered for whoever happens to be subscribed.
          if (!curEdges.has(id)) emit(id, "gone", edge);
        }
      }
      prevEdges = curEdges;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastSeq() {
      return seq;
    },
    dispose() {
      listeners.clear();
      prev = null;
      prevEdges = null;
    },
  };
}
