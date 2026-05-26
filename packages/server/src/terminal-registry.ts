/**
 * Terminal registry — the `Map<TerminalId, TerminalProcess>` and the
 * pure read/write accessors around it.
 *
 * Backend-agnostic: every `TerminalBackend` (local in R-1, remote in
 * R-2) writes to the same registry so consumers downstream (router,
 * surface) iterate one place regardless of where the terminal lives.
 * Per-backend internal state (PTY handle, provider cleanups for
 * `LocalTerminalBackend`) stays inside the backend itself, not on
 * `TerminalProcess`.
 */

import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import type { TerminalHandle } from "kolu-common/terminalBackend";

/** Server-side terminal state. `info` is the wire shape sent in the
 *  `terminalList` cell snapshot; `meta` is mutated in place by the
 *  owning backend's providers and published via the
 *  `terminalMetadata` collection from `terminalBackend/metadata.ts`;
 *  `handle` is the abstract control surface (write / resize / screen
 *  state — NO `dispose()`, the backend's `killTerminal` is the sole
 *  termination path). */
export interface TerminalProcess {
  info: TerminalInfo;
  meta: TerminalMetadata;
  handle: TerminalHandle;
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

/** Snapshot + clear. Used by `killAllTerminals` where the caller needs
 *  to dispose each handle AFTER the map is empty (so onExit callbacks
 *  can't find the entry and trigger session saves). Returning the
 *  entries keeps the clear-then-dispose ordering in the caller rather
 *  than forcing it into the registry API. */
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
 *  tail. Clients render this order directly; within-group pill
 *  ordering is a separate spatial sort driven by saved canvas layouts. */
export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((entry) => entry.info);
}

/** Number of live terminal processes. Cheap counter for diagnostics. */
export const terminalCount = (): number => terminals.size;

/** Number of terminals currently hosting a Claude Code session. Derived
 *  from `entry.meta.agent` — the agent detectors inside
 *  `LocalTerminalBackend` (driven by `claudeCodeProvider` from
 *  `kolu-claude-code`) set it on session match and clear it on
 *  teardown. Exported for diagnostics. */
export function countActiveClaudeSessions(): number {
  let n = 0;
  for (const entry of terminals.values()) {
    if (entry.meta.agent?.kind === "claude-code") n++;
  }
  return n;
}

export function getTerminal(id: TerminalId): TerminalProcess | undefined {
  return terminals.get(id);
}
