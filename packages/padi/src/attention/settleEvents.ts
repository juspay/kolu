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

/** Which kind of attention a terminal just entered.
 *
 *  `asking` is an agent BLOCKED on a person (`awaiting_user`) — ungated by the
 *  quiet window, because an agent that says it is blocked is definitionally not
 *  mid-output. `finished` is a turn that ENDED and then went quiet (EF2). The
 *  split is padi's shipped `attentionClass` partition, not a new vocabulary. */
export type SettleKind = "asking" | "finished";

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
  let seq = 0;

  return {
    observe(urgency, terminals) {
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

      for (const { id, asking } of candidates) {
        const record = terminals.get(id);
        seq += 1;
        // Spread-or-omit, never an explicit `undefined`: these ride optionalKey
        // fields on the wire schema, which accept an ABSENT key and REJECT a
        // present-but-undefined one (#17).
        const event: SettleEvent = {
          seq,
          id,
          kind: asking ? "asking" : "finished",
          at: now(),
          ...(record?.parentId === undefined
            ? {}
            : { parentId: record.parentId as TerminalId }),
          ...(record?.intent === undefined ? {} : { intent: record.intent }),
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
      }
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
    },
  };
}
