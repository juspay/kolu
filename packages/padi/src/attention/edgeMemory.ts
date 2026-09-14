/**
 * The lane attribution of every terminal, remembered ONCE per frame and read by
 * both watch sources.
 *
 * `supervisionEdge.ts` deduped the PROJECTION (`parentId`/`intent` off a
 * record); this dedupes the MEMORY. Both sources fold the same terminals map on
 * the same ~150 ms cadence and both need the same two facts — the settle
 * detector to attribute an edge (including a DEPARTURE, whose record is gone by
 * the time it is reported), the state watch to attribute a snapshot, a
 * transition or a nag. Two caches maintained by two copies of one discipline is
 * one derivation computed twice, and the copies had already disagreed about what
 * happens to a departed terminal's edge.
 *
 * **Maintained in place, never rebuilt.** This runs per terminal per tick and
 * `parentId`/`intent` almost never move after a terminal is born, so a survivor
 * whose edge is unchanged costs two string compares and no allocation.
 *
 * **Observed by the PRODUCER, before either source.** `servePadi`'s `urgency`
 * cell calls {@link EdgeMemory.observe} once and then hands the same frame to
 * both sources, so "who was the parent" cannot differ by which source asked.
 */

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
  /** The ids that left in the LAST observed frame, with their remembered edge.
   *  Valid until the next {@link observe} — a departure is a fact about one
   *  frame, and the source that reports it does so on that frame. */
  departed(): ReadonlyMap<TerminalId, SupervisionEdge>;
  /** The remembered attribution of a terminal — live, or departed in the last
   *  observed frame.
   *
   *  RAISES for an id in neither, rather than answering with an empty edge: an
   *  empty edge is a real answer ("a root with no intent"), so collapsing "I
   *  have never seen this terminal" onto it would publish a wrong parent as
   *  quietly as a right one. A source only ever asks about ids from the frame
   *  this memory just observed, so a miss means the fold and the collection have
   *  come apart. */
  edgeOf(id: TerminalId): SupervisionEdge;
  dispose(): void;
}

export function createEdgeMemory(): EdgeMemory {
  const live = new Map<TerminalId, SupervisionEdge>();
  // Reused rather than reallocated per frame — the steady state has no
  // departures at all, and a frame's departures are consumed on that frame.
  const gone = new Map<TerminalId, SupervisionEdge>();
  return {
    observe(terminals) {
      gone.clear();
      for (const [id, edge] of live) {
        if (!terminals.has(id)) gone.set(id, edge);
      }
      for (const id of gone.keys()) live.delete(id);
      // ARRIVALS and edge CHANGES — the only two things that need an allocation.
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
