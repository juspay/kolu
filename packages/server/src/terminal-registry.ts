/**
 * Terminal registry — the `Map<TerminalId, TerminalProcess>` and the
 * pure read/write accessors around it.
 *
 * Kept as a leaf module on purpose: metadata providers under `./meta/*`
 * need to read the registry (for `TerminalProcess` shape and for
 * `getTerminal`), and the higher-level lifecycle in `./terminals.ts` needs
 * to write to it. When both lived on `terminals.ts`, the providers' edge
 * back to `terminals.ts` (plus `terminals.ts`'s edge to `./meta/index.ts`
 * for `startProviders`) closed a cycle that Biome's `noImportCycles`
 * correctly flagged (#710). Splitting the map+reads here breaks it.
 *
 * No imports from `./meta/*` or `./terminals.ts` — that invariant is what
 * keeps this file a leaf.
 */

import type { TerminalId, TerminalInfo } from "kolu-common";
import type { PtyHandle } from "./pty.ts";

/** Server-side terminal state. Owns a PtyHandle and embeds the wire-type TerminalInfo. */
export interface TerminalProcess {
  /** The wire-type snapshot — single source of truth for id, pid, meta. */
  info: TerminalInfo;
  handle: PtyHandle;
  /** Cleanup function for all metadata providers. */
  stopProviders: () => void;
}

const terminals = new Map<TerminalId, TerminalProcess>();

/** Insert/replace a terminal entry in the registry. */
export function registerTerminal(id: TerminalId, entry: TerminalProcess): void {
  terminals.set(id, entry);
}

/** Remove a terminal by id. Returns true if the entry was present. */
export function unregisterTerminal(id: TerminalId): boolean {
  return terminals.delete(id);
}

/** Snapshot + clear. Used by `killAllTerminals` where the caller needs to
 *  dispose each handle AFTER the map is empty (so onExit callbacks can't
 *  find the entry and trigger session saves). Returning the entries keeps
 *  the clear-then-dispose ordering in the caller rather than forcing it
 *  into the registry API. */
export function drainTerminals(): TerminalProcess[] {
  const entries = [...terminals.values()];
  terminals.clear();
  return entries;
}

/** Entries in canonical `Map` insertion order — the client's display
 *  ordering for the terminal list. */
export function terminalEntries(): IterableIterator<
  [TerminalId, TerminalProcess]
> {
  return terminals.entries();
}

/** Current terminals in their canonical `Map` insertion order.
 *
 *  Insertion order is the ordering model — new terminals append to the
 *  tail. Clients render this order directly; within-group pill ordering
 *  is a separate spatial sort driven by saved canvas layouts. */
export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((entry) => entry.info);
}

/** Number of live terminal processes. Cheap counter for diagnostics. */
export const terminalCount = (): number => terminals.size;

export function getTerminal(id: TerminalId): TerminalProcess | undefined {
  return terminals.get(id);
}
