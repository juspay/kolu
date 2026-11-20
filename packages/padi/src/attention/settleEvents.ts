import type {
  PadiSettleEvent,
  PadiTerminal,
  PadiUrgency,
} from "@kolu/padi-client/surface";
import {
  type AttentionTransitions,
  createAttentionTransitions,
} from "@kolu/terminal-vocab/attentionTransitions";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { attentionFrameOf } from "../activity/urgency.ts";
import type { EdgeMemory } from "./edgeMemory.ts";
import type { EventSeq } from "./eventSeq.ts";
import type { SupervisionEdge } from "./supervisionEdge.ts";

export type SettleEvent = PadiSettleEvent;

/** Which kind of attention a terminal just entered — or its departure. Derived
 *  from the wire literal union for the same reason as {@link SettleEvent}. */
export type SettleKind = PadiSettleEvent["kind"];

export type SettleFrameListener = (
  events: readonly SettleEvent[],
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
) => void;

/** What a SINK plugs into — stable under any change to HOW a settle is detected.
 *  A sink learns nothing about the detector: not `PadiUrgency`, not the fold. */
export interface SettleEventSource {
  onFrame(listener: SettleFrameListener): () => void;
  dispose(): void;
}

export interface SettleEventFeed extends SettleEventSource {
  observe(
    urgency: PadiUrgency,
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void;
}

export function createSettleEvents(opts: {
  log: Logger;
  now?: () => number;
  seq: EventSeq;
  edges: EdgeMemory;
}): SettleEventFeed {
  const { log, seq, edges } = opts;
  const now = opts.now ?? Date.now;
  const listeners = new Set<SettleFrameListener>();
  const transitions: AttentionTransitions = createAttentionTransitions();

  /** Hand a batch to the sinks AFTER the derivation that produced it has left
   *  the stack, so a sink never runs inside the fold. */
  const flushOffStack = (
    batch: readonly SettleEvent[],
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void => {
    queueMicrotask(() => {
      for (const listener of listeners) {
        try {
          listener(batch, terminals);
        } catch (err) {
          log.error({ err }, "padi: settle-frame listener threw");
        }
      }
    });
  };

  return {
    observe(urgency, terminals) {
      const at = now();
      const batch: SettleEvent[] = [];
      const emit = (
        id: TerminalId,
        kind: SettleKind,
        edge: SupervisionEdge,
      ) => {
        batch.push({ seq: seq.next(), id, kind, at, ...edge });
      };

      const { candidates } = transitions.observe(attentionFrameOf(urgency));
      for (const { id, asking } of candidates) {
        emit(id, asking ? "asking" : "finished", edges.edgeOf(id));
      }

      for (const [id, edge] of edges.departed()) emit(id, "gone", edge);

      if (batch.length === 0) return;
      flushOffStack(batch, terminals);
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
    },
  };
}
