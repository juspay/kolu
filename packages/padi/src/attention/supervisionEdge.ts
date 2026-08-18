/**
 * WHO SHOULD HEAR about a terminal — the lane attribution every watch event
 * carries, read off the composed record once.
 *
 * Shared by both event sources (`settleEvents.ts`, `stateWatch.ts`) because it
 * is the same question with the same answer: a subscriber wants to know WHICH
 * worker moved without a second read, and `parentId`/`intent` are the only two
 * scraps of that it cannot cheaply re-derive. A copy per source would be two
 * spellings of one projection — and the omit-vs-undefined rule below is exactly
 * the kind of detail that drifts between copies.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal, PadiWatchEvent } from "../surface.ts";

/** The two attribution fields, as they ride the wire.
 *
 *  Both are optional and both are OMITTED rather than set to `undefined` — they
 *  ride `optionalKey` wire fields, which reject a present-but-undefined key
 *  (#17). Its PROVENANCE differs by event kind and that is the fact worth
 *  attaching to a name: for a live terminal it is read off the record; for a
 *  DEPARTURE it is the edge REMEMBERED from the last frame that still had one,
 *  because by then there is no record to read. */
export type SupervisionEdge = Pick<PadiWatchEvent, "parentId" | "intent">;

/** Project a record's attribution. Spread-safe. Module scope: it closes over
 *  nothing, so it is minted once rather than per fold on the ~150 ms terminals
 *  cadence. */
export function edgeOf(record: PadiTerminal | undefined): SupervisionEdge {
  return {
    ...(record?.parentId === undefined
      ? {}
      : { parentId: record.parentId as TerminalId }),
    ...(record?.intent === undefined ? {} : { intent: record.intent }),
  };
}

/** Does a remembered edge still describe this record? Two string compares,
 *  which is what lets an edge memory be MAINTAINED rather than rebuilt: this
 *  runs per terminal per ~150 ms tick, and `parentId`/`intent` almost never move
 *  after a terminal is born, so the steady state should allocate nothing. */
export function edgeMatches(
  edge: SupervisionEdge,
  record: PadiTerminal | undefined,
): boolean {
  return edge.parentId === record?.parentId && edge.intent === record?.intent;
}
