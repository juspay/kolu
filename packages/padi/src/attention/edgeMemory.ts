import type { PadiTerminal } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import {
  edgeMatches,
  edgeOf,
  type SupervisionEdge,
} from "./supervisionEdge.ts";

export interface EdgeMemory {
  /** Take one frame: refresh the live edges, and remember the ids that just
   *  left with the edge they were last seen carrying. */
  observe(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  departed(): ReadonlyMap<TerminalId, SupervisionEdge>;
  edgeOf(id: TerminalId): SupervisionEdge;
  dispose(): void;
}

export function createEdgeMemory(): EdgeMemory {
  const live = new Map<TerminalId, SupervisionEdge>();
  const gone = new Map<TerminalId, SupervisionEdge>();
  return {
    observe(terminals) {
      gone.clear();
      for (const [id, edge] of live) {
        if (!terminals.has(id)) gone.set(id, edge);
      }
      for (const id of gone.keys()) live.delete(id);
      for (const [id, record] of terminals) {
        const known = live.get(id);
        if (known === undefined || !edgeMatches(known, record)) {
          live.set(id, edgeOf(record));
        }
      }
    },
    departed: () => gone,
    edgeOf(id) {
      const edge = live.get(id) ?? gone.get(id);
      if (edge === undefined) {
        throw new Error(
          `padi: no remembered supervision edge for terminal ${id} — the edge memory and the frame it was observed from have come apart.`,
        );
      }
      return edge;
    },
    dispose() {
      live.clear();
      gone.clear();
    },
  };
}
