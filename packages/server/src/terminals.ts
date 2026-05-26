/**
 * Terminal lifecycle adapter — translates the wire-level
 * (`router.ts`-facing) terminal verbs into `LocalBackend` operations
 * and fans the surface side effects (`terminalList`, `terminals:dirty`,
 * `terminalExit` event) into the framework.
 *
 * After R-1, `LocalBackend` is the canonical owner of PTY lifecycle and
 * the `meta/*` provider DAG. This file is the thin shim where router
 * handlers (`terminal.create`, `terminal.kill`, `terminal.setX`)
 * delegate. The underlying `Map` + the registry accessors
 * (`getTerminal`, `listTerminals`, `terminalCount`, …) still live in
 * `./terminal-registry.ts` — both the backend and this file mutate the
 * same shared store.
 *
 * Client-owned metadata setters (theme/intent/canvas/sub-panel/right-
 * panel/parent/active) live here too — they're surface-level mutations
 * that don't belong to a specific backend (they describe the kolu UI's
 * relationship to a terminal, not the terminal's relationship to its
 * host).
 *
 * R-2 will introduce a `getBackendFor(location)` registry that returns
 * either `localBackend` or a `RemoteBackend(host)`; `createTerminal`
 * will pick the right one. For R-1 every terminal lives on
 * `localBackend`.
 */

import type {
  InitialTerminalMetadata,
  RightPanelPerTerminalState,
  SavedTerminal,
  TerminalId,
  TerminalInfo,
} from "kolu-common/surface";
import { getBackendFor, localBackend } from "./backend/index.ts";
import { log } from "./log.ts";
import { updateClientMetadata } from "./meta/index.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { surfaceCtx } from "./surface.ts";
import {
  drainTerminals,
  listTerminals,
  terminalEntries,
  getTerminal,
} from "./terminal-registry.ts";

// Re-export registry accessors + type so external callers (router.ts,
// diagnostics.ts, index.ts) keep a single import path.
export {
  countActiveClaudeSessions,
  getTerminal,
  listTerminals,
  type TerminalProcess,
  terminalCount,
} from "./terminal-registry.ts";

/** Build a session snapshot from current terminal state.
 *
 *  The persisted fields live on `TerminalMetadata` in the exact shape
 *  `SavedTerminal` needs — so a snapshot is "strip the live fields,
 *  add id". Adding a future persisted field to
 *  `PersistedTerminalFieldsSchema` flows through here with no change.
 *  Order is `Map` insertion order — terminals appear in the sequence
 *  they were created. */
export function snapshotSession(): {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
} {
  const snappedTerminals = [...terminalEntries()].map(
    ([id, entry]): SavedTerminal => {
      const {
        pr: _pr,
        agent: _agent,
        foreground: _foreground,
        connectionState: _connectionState,
        ...persisted
      } = entry.meta;
      return { id, ...persisted };
    },
  );
  return { terminals: snappedTerminals, activeTerminalId };
}

/** Notify that terminal state changed (triggers debounced session auto-save). */
function emitChanged(): void {
  terminalsDirtyChannel.publish({});
}

/** Notify that terminal membership changed (create/kill).
 *  Drives the live `surface.terminalList.get` stream to clients. The
 *  surface owns the publish channel; calling `set` triggers the
 *  framework's apply+publish chain (the `terminalList` cell's store is
 *  a no-op since the registry is canonical). */
function emitListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

/** Create a new terminal on the backend identified by the (resolved)
 *  location. R-1: every terminal lives on `localBackend`; R-2 picks the
 *  backend by `initial.location` (with sub-terminals inheriting their
 *  parent's location regardless of the input).
 *
 *  `initial` seeds the client-owned metadata fields before the
 *  backend's providers emit their first publish, so the first
 *  `terminalMetadata` collection yield carries them — required by the
 *  canvas-cascade race fix in #642. */
export async function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: InitialTerminalMetadata,
): Promise<TerminalInfo> {
  const handle = await localBackend.spawnPty({
    cwd,
    initialMetadata: {
      ...initial,
      ...(parentId !== undefined && { parentId }),
    },
    onExit: (exitCode, wasNatural) => {
      // `handle` is assigned before `onExit` can fire (PTY exits after spawn).
      surfaceCtx.events.terminalExit.publish({ id: handle.id }, exitCode);
      // Only fire dirty/list signals on natural exit. Explicit kills
      // (`killTerminal`, `killAllTerminals`) already handled the fanout
      // at their entry point — see kill-convergence invariant in
      // backend.ts's module doc.
      if (wasNatural) {
        emitChanged();
        emitListChanged();
      }
    },
  });

  emitChanged();
  emitListChanged();
  return { id: handle.id };
}

/** Kill a terminal: backend tears down PTY + providers, then surface
 *  signals fan out. Returns final `TerminalInfo` for the killed
 *  terminal, or undefined if the id was unknown. */
export function killTerminal(id: TerminalId): TerminalInfo | undefined {
  const entry = getTerminal(id);
  if (!entry) return undefined;
  const info = entry.info;
  getBackendFor(entry.meta.location).killTerminal(id);
  emitChanged();
  emitListChanged();
  return info;
}

/** Set or clear a terminal's parent relationship. */
export function setTerminalParent(
  id: TerminalId,
  parentId: string | null,
): void {
  const entry = getTerminal(id);
  if (entry) {
    const newParent = parentId ?? undefined;
    updateClientMetadata(entry, id, (m) => {
      m.parentId = newParent;
    });
  }
}

/** Store a terminal's canvas layout position (client-reported).
 *  Publishes via metadata so canvas tiles read their position from the
 *  same source as other metadata — no client-side dual store required. */
export function setCanvasLayout(
  id: TerminalId,
  layout: { x: number; y: number; w: number; h: number },
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  updateClientMetadata(entry, id, (m) => {
    m.canvasLayout = layout;
  });
}

/** Store a terminal's sub-panel state (client-reported).
 *  Publishes via metadata so other clients (and the same client after a
 *  refresh, via the collection's snapshot read) pick up the change from
 *  the same channel as every other client-owned metadata field.
 *
 *  Equality-gated: the client RPCs this on every drag tick of the
 *  resizable handle, so without a guard each mouse-move would fan a
 *  full per-key metadata publish to every connected client. */
export function setSubPanelState(
  id: TerminalId,
  state: { collapsed: boolean; panelSize: number },
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  const cur = entry.meta.subPanel;
  if (
    cur &&
    cur.collapsed === state.collapsed &&
    cur.panelSize === state.panelSize
  )
    return;
  updateClientMetadata(entry, id, (m) => {
    m.subPanel = state;
  });
}

/** Store a terminal's right-panel per-terminal state (client-reported).
 *  Equality-gated like `setSubPanelState`. */
export function setRightPanelState(
  id: TerminalId,
  state: RightPanelPerTerminalState,
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  const cur = entry.meta.rightPanel;
  if (cur && rightPanelStateEqual(cur, state)) return;
  updateClientMetadata(entry, id, (m) => {
    m.rightPanel = state;
  });
}

function rightPanelStateEqual(
  a: RightPanelPerTerminalState,
  b: RightPanelPerTerminalState,
): boolean {
  if (a.activeTab !== b.activeTab || a.codeMode !== b.codeMode) return false;
  const am = a.selectedFileByMode;
  const bm = b.selectedFileByMode;
  if (am === bm) return true;
  if (!am || !bm) return false;
  if (am.local !== bm.local) return false;
  if (am.branch !== bm.branch) return false;
  if (am.browse !== bm.browse) return false;
  return true;
}

// Active terminal ID — client-reported, used only for session snapshots.
let activeTerminalId: TerminalId | null = null;

/** Store which terminal is active (reported by the client).
 *  Only emits session:changed when a terminal is actually selected —
 *  null (no selection, e.g. client reconnect) must not trigger auto-save
 *  because snapshotSession() may return an empty terminal list at that
 *  point, which would clear the saved session. */
export function setActiveTerminalId(id: TerminalId | null): void {
  activeTerminalId = id;
  if (id !== null) emitChanged();
}

/** Set the theme name for a terminal (stored in metadata, published to clients). */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = getTerminal(id);
  if (entry) {
    updateClientMetadata(entry, id, (m) => {
      m.themeName = themeName;
    });
  }
}

/** Set or clear a terminal's freeform intent annotation. Empty string clears. */
export function setTerminalIntent(id: TerminalId, intent: string): void {
  const entry = getTerminal(id);
  if (!entry) return;
  const next = intent.length > 0 ? intent : undefined;
  updateClientMetadata(entry, id, (m) => {
    m.intent = next;
  });
}

/** Kill and remove all terminals. Used by tests to reset server state
 *  between scenarios.
 *
 *  Drain-before-dispose ordering: the registry is cleared FIRST so each
 *  PTY's `onExit` callback observes `getTerminal(id) === undefined` and
 *  reports `wasNatural=false`. That gate prevents shutdown from writing
 *  phantom empty sessions to disk via the autosave loop. */
export function killAllTerminals(): void {
  const entries = drainTerminals();
  log.info({ count: entries.length }, "killing all terminals");
  // Route per-entry teardown through each terminal's backend so this
  // path stays in lockstep with `killTerminal` and `dispose()` — see
  // the kill-convergence invariant in `backend.ts`. R-2's
  // `RemoteBackend.killTerminalEntry` will issue the RPC kill against
  // the agent without the loop ever knowing the backend kind.
  for (const entry of entries) {
    getBackendFor(entry.meta.location).killTerminalEntry(entry);
  }
  emitListChanged();
}
