/**
 * Terminal registry — the `Map<TerminalId, TerminalProcess>` and the
 * pure read/write accessors around it.
 *
 * Endpoint-agnostic: the `TerminalEndpoint` writes to the same registry
 * so consumers downstream (router, surface) iterate one place regardless
 * of which endpoint owns the terminal. Per-endpoint internal state (PTY
 * handle, provider cleanups for `LocalTerminalEndpoint`) stays inside the
 * endpoint itself, not on `TerminalProcess`.
 */

import { ORPCError } from "@orpc/server";
import type {
  KoluActiveTerminal,
  SleepingTerminal,
  TerminalId,
  TerminalInfo,
} from "kolu-common/surface";
import type { TerminalHandle } from "kolu-common/terminalEndpoint";
import { awarenessFor } from "./terminalEndpoint/workspaceSurface.ts";

/** An ACTIVE terminal process — a running PTY with its live control surface.
 *  `info` is the wire shape sent in the `terminalList` cell snapshot; `meta` is
 *  kolu's AUTHORED active arm (location + chrome + `state` — NO observed fields),
 *  published via the `terminalMetadata` collection. The terminal's OBSERVED state
 *  (cwd/git/pr/agent/foreground) lives in the in-process awareness store
 *  (`workspaceSurface`), read through `awarenessFor(id)`. `handle` is the abstract
 *  control surface (write / resize / screen state — NO `dispose()`, the endpoint's
 *  `killTerminal` is the sole termination path). */
export interface ActiveTerminalProcess {
  info: TerminalInfo;
  meta: KoluActiveTerminal;
  handle: TerminalHandle;
}

/** A SLEEPING terminal process — the SAME registry entry under the SAME stable
 *  id, but with its PTY/handle and live overlay released. Its metadata is the
 *  sleeping arm (persisted base + `sleptAt`), so there is no `handle` — the live
 *  resource is **absent by type**, which is the plan's safety invariant: a
 *  sleeping terminal can sit in the one registry (and thus ride the `terminalList`
 *  cell + the `terminalMetadata` collection with nothing extra), yet the compiler
 *  refuses any code that reaches for its PTY handle without first narrowing.
 *  `handle?: never` keeps the field accessible on the union so `entry.handle`
 *  truthiness narrows a `TerminalProcess` to the active arm in one idiom. */
export interface SleepingTerminalProcess {
  info: TerminalInfo;
  meta: SleepingTerminal;
  handle?: never;
}

/** The one registry's value — `Terminal = active | sleeping` made concrete as a
 *  process. Sleep flips an active entry to a sleeping one IN PLACE (same id,
 *  same map slot, persisted base preserved, live overlay + handle released);
 *  wake flips it back by re-spawning. Presence reads the union off the map;
 *  liveness narrows to `ActiveTerminalProcess` via `entry.handle` (or
 *  `getActiveTerminal`). */
export type TerminalProcess = ActiveTerminalProcess | SleepingTerminalProcess;

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

/** Number of registry RECORDS — active + sleeping. Cheap counter; the registry
 *  size. NOT a live-process count: a sleeping record holds no PTY/sensors/xterm,
 *  so heap diagnostics that correlate a column with live-terminal memory must use
 *  `activeTerminalCount` instead (F9). */
export const terminalCount = (): number => terminals.size;

/** Number of LIVE terminal processes — entries with a PTY handle (the active
 *  arm). This is the count that tracks live-terminal heap (sensors, taps, the
 *  headless mirror); the heap diagnostic reports THIS, not `terminalCount`, so a
 *  pile of dormant records can't read as live processes (F9). */
export const activeTerminalCount = (): number => {
  let n = 0;
  for (const entry of terminals.values()) if (entry.handle) n++;
  return n;
};

/** Number of terminals currently hosting a Claude Code session. Read through the
 *  OBSERVATION seam (`awarenessFor`) — the agent is observed state now, not held
 *  on kolu's record; the agent detectors publish it into the awareness store. A
 *  sleeping terminal has no live observation, so it never counts. Exported for
 *  diagnostics. */
export function countActiveClaudeSessions(): number {
  let n = 0;
  for (const [id, entry] of terminals) {
    if (entry.handle && awarenessFor(id)?.agent?.kind === "claude-code") n++;
  }
  return n;
}

export function getTerminal(id: TerminalId): TerminalProcess | undefined {
  return terminals.get(id);
}

/** Narrow a registry lookup to its ACTIVE arm — the entry only if it is a live
 *  PTY (`handle` present). The single seam every handle-touching path (attach,
 *  resize, sendInput, kill, screen reads) uses so a sleeping terminal can never
 *  be driven as a live one: a sleeping id yields `undefined` here, exactly as an
 *  absent id does. The `entry?.handle` truthiness check narrows the union to
 *  `ActiveTerminalProcess` with no cast. */
export function getActiveTerminal(
  id: TerminalId,
): ActiveTerminalProcess | undefined {
  const entry = terminals.get(id);
  return entry?.handle ? entry : undefined;
}

/** `getActiveTerminal` or throw the typed not-found fault — for handlers whose
 *  whole contract needs a live PTY (resize, input, screen state). A sleeping or
 *  absent id is "not found" to them by the same code, since neither can take the
 *  operation. */
export function requireActiveTerminal(id: TerminalId): ActiveTerminalProcess {
  const entry = getActiveTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry;
}

/** The terminal-not-found fault as a typed oRPC error. One definition of
 *  the code + message shared by every per-terminal handler (router,
 *  surface) so the wire shape can't drift between call sites. Typed
 *  (not a bare Error) because oRPC scrubs bare errors to an opaque
 *  "Internal server error". */
export function terminalNotFound(
  id: string,
): ORPCError<"NOT_FOUND", undefined> {
  return new ORPCError("NOT_FOUND", { message: `Terminal ${id} not found` });
}
