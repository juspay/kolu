/**
 * Terminal lifecycle façade — `createTerminal` / `killTerminal` /
 * `killAllTerminals` resolve to a `TerminalBackend` via
 * `getTerminalBackendFor(location)` and delegate. The backend owns
 * PTY spawn, per-terminal provider startup, registry insert/remove,
 * autosave-trigger signalling.
 *
 * Client-facing per-terminal metadata setters (`setTerminalParent`,
 * `setCanvasLayout`, `setSubPanelState`, `setRightPanelState`,
 * `setTerminalTheme`, `setTerminalIntent`) live here because they're
 * location-agnostic — they mutate the in-registry entry through the
 * narrowed `updateClientMetadata` helper, which publishes through the
 * same metadata channel regardless of which backend owns the terminal.
 *
 * Re-exports the registry surface for callers that used to import
 * state-reads + lifecycle from this file as a single module.
 */

import type {
  InitialTerminalMetadata,
  RightPanelPerTerminalState,
  SavedTerminal,
  TerminalId,
  TerminalInfo,
} from "kolu-common/surface";
// Load-order is cycle-sensitive: importing `terminalBackend/metadata.ts`
// before `terminalBackend/index.ts` is what makes the surface cycle
// converge with `localTerminalBackend` already initialized by the time
// line 33 below calls `getTerminalBackendFor`. Reversing these two
// (biome's alphabetical preference) puts the cycle entry-point at the
// deeper `activity.ts → surface.ts` branch and trips a TDZ on
// `localTerminalBackend`.
// biome-ignore-start assist/source/organizeImports: cycle-sensitive load order
import { updateClientMetadata } from "./terminalBackend/metadata.ts";
import { getTerminalBackendFor } from "./terminalBackend/index.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";
import { getDaemonHandle } from "./daemon/supervisor.ts";
import { getSavedSession } from "./session.ts";
import { log } from "./log.ts";
// biome-ignore-end assist/source/organizeImports: cycle-sensitive load order

// R-1: a single local backend. R-2 will route by `location.kind` per
// call site via `getTerminalBackendForCreate` — this const goes away then.
const localBackend = getTerminalBackendFor({ kind: "local" });

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
        ...persisted
      } = entry.meta;
      return { id, ...persisted };
    },
  );
  return { terminals: snappedTerminals, activeTerminalId };
}

/** Create a new terminal. The backend owns PTY spawn, provider
 *  startup, and registry insert; this wrapper just resolves the
 *  backend, mints an id, and forwards. `initial` seeds client-owned
 *  metadata before providers run — see #642 (avoids racing post-hoc
 *  `setCanvasLayout` / `setTheme` / `setSubPanel` RPCs against the
 *  client's canvas-cascade effect). */
export function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: InitialTerminalMetadata,
): TerminalInfo {
  const id = crypto.randomUUID();
  // R-2's `getTerminalBackendForCreate` will read `parentId` to inherit
  // the parent's location — at that point `localBackend` goes away.
  return localBackend.spawnPty(id, { cwd, parentId, initialMetadata: initial });
}

/** Kill a terminal. Returns final info, or undefined if not found. */
export function killTerminal(id: TerminalId): TerminalInfo | undefined {
  return localBackend.killTerminal(id);
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
 *  full per-key metadata publish to every connected client. Same shape
 *  as the `lastAgentCommand` gate inside `LocalTerminalBackend`'s
 *  agent-command tracker. */
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
 *  Publishes via metadata so other clients (and the same client after a
 *  refresh) pick up the change from the same channel as every other
 *  client-owned metadata field.
 *
 *  Equality-gated like `setSubPanelState` — the client RPCs this on
 *  every file-tree click and tab-toggle, so without a guard each
 *  interaction would fan a full per-key metadata publish. Deep-compares
 *  `selectedFileByMode` since the user clicks files often. */
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
 *  null (no selection, e.g. client reconnect) must not trigger
 *  auto-save because snapshotSession() may return an empty terminal
 *  list at that point, which would clear the saved session. */
export function setActiveTerminalId(id: TerminalId | null): void {
  activeTerminalId = id;
  if (id !== null) terminalsDirtyChannel.publish({});
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

/** Kill and remove all terminals. Used by tests to reset server state between scenarios. */
export function killAllTerminals(): void {
  localBackend.killAllTerminals();
}

/** Reattach to local PTYs that survived a kolu-server restart. Called
 *  at boot (after `ensureDaemon`, before the HTTP listener binds): asks
 *  the daemon which PTYs it still owns, matches them to the saved
 *  session by id, and rebuilds each terminal's registry entry + stream
 *  bridge + provider DAG so they're already present in `terminalList`
 *  when the first client connects. Returns the number reattached.
 *
 *  Surviving-but-unsaved PTYs (e.g. the saved session was cleared)
 *  still reattach with default metadata — the live process is the
 *  source of truth, not the blob. */
export async function reattachLocalTerminals(): Promise<number> {
  const daemon = getDaemonHandle();
  if (!daemon) return 0;
  let entries: { id: TerminalId; pid: number; cwd: string }[];
  try {
    const res = await daemon.client.surface.terminal.list({});
    entries = res.entries;
  } catch (err) {
    log.error(
      { err: (err as Error).message },
      "reattach: daemon terminal.list failed",
    );
    return 0;
  }
  if (entries.length === 0) return 0;
  const saved = getSavedSession();
  const savedById = new Map(
    (saved?.terminals ?? []).map((t): [string, SavedTerminal] => [t.id, t]),
  );
  for (const entry of entries) {
    localBackend.reattachPty(entry, savedById.get(entry.id));
  }
  // Restore the active selection so the client's hydration picks the
  // same terminal it had before the restart.
  if (saved?.activeTerminalId) {
    activeTerminalId = saved.activeTerminalId as TerminalId;
  }
  log.info({ count: entries.length }, "reattached local terminals");
  return entries.length;
}
