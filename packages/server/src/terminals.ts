/**
 * Terminal lifecycle façade — `createTerminal` / `killTerminal` /
 * `killAllTerminals` delegate to the local `TerminalEndpoint`. The
 * endpoint owns PTY spawn, per-terminal provider startup, registry
 * insert/remove, autosave-trigger signalling.
 *
 * Client-facing per-terminal metadata setters (`setTerminalParent`,
 * `setCanvasLayout`, `setSubPanelState`, `setRightPanelState`,
 * `setTerminalTheme`, `setTerminalIntent`) live here because they're
 * endpoint-agnostic — they mutate the in-registry entry through the
 * narrowed `updateClientMetadata` helper, which publishes through the
 * same metadata channel regardless of which endpoint owns the terminal.
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
// Load-order is cycle-sensitive: importing `terminalEndpoint/metadata.ts`
// before `terminalEndpoint/local.ts` is what makes the surface cycle
// converge with `localTerminalEndpoint` already initialized by the time
// the top-level `localEndpoint` reference below reads it. Reversing these
// two (biome's alphabetical preference) puts the cycle entry-point at the
// deeper `activity.ts → surface.ts` branch and trips a TDZ on
// `localTerminalEndpoint`.
// biome-ignore-start assist/source/organizeImports: cycle-sensitive load order
import { updateClientMetadata } from "./terminalEndpoint/metadata.ts";
import { localTerminalEndpoint } from "./terminalEndpoint/local.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";
import type { SessionSnapshot } from "./session.ts";
// biome-ignore-end assist/source/organizeImports: cycle-sensitive load order

// A single local endpoint today. P3 will select the endpoint per call
// site (e.g. a sub-terminal inheriting its parent's endpoint).
const localEndpoint = localTerminalEndpoint;

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
export function snapshotSession(): SessionSnapshot {
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

/** Snapshot ONE terminal and its split sub-terminals as `SavedTerminal[]`,
 *  reusing the exact strip-live-fields-add-id projection of `snapshotSession`.
 *  Parent first, then its `parentId`-children — so a wake replays
 *  parent-before-child. Empty when `id` isn't a live terminal. This is the
 *  single capture op behind `terminal.sleep`. */
export function snapshotTerminal(id: TerminalId): SavedTerminal[] {
  const entries = [...terminalEntries()];
  const parent = entries.find(([tid]) => tid === id);
  if (!parent) return [];
  // Parent first, then its splits (parentId === id; a parent never has
  // parentId === its own id, so no duplication).
  const tree = [parent, ...entries.filter(([, e]) => e.meta.parentId === id)];
  return tree.map(([tid, entry]): SavedTerminal => {
    const {
      pr: _pr,
      agent: _agent,
      foreground: _foreground,
      ...persisted
    } = entry.meta;
    return { id: tid, ...persisted };
  });
}

/** Create a new terminal. The endpoint owns PTY spawn, provider
 *  startup, and registry insert; this wrapper just mints an id and
 *  forwards. `initial` seeds client-owned
 *  metadata before providers run — see #642 (avoids racing post-hoc
 *  `setCanvasLayout` / `setTheme` / `setSubPanel` RPCs against the
 *  client's canvas-cascade effect). */
export function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: InitialTerminalMetadata,
): TerminalInfo {
  const id = crypto.randomUUID();
  // P3 will select the endpoint per create — e.g. a sub-terminal
  // inheriting its parent's endpoint; today every terminal is local.
  return localEndpoint.spawnPty(id, {
    cwd,
    parentId,
    initialMetadata: initial,
  });
}

/** Kill a terminal. Returns final info, or undefined if not found. Async
 *  since #951 R4c: the local endpoint awaits the daemon's kill confirmation
 *  over the socket before unregistering (so a failed kill can't orphan the
 *  PTY). */
export async function killTerminal(
  id: TerminalId,
): Promise<TerminalInfo | undefined> {
  return localEndpoint.killTerminal(id);
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
 *  as the `lastAgentCommand` gate inside `LocalTerminalEndpoint`'s
 *  agent-command tracker. */
export function setSubPanelState(
  id: TerminalId,
  state: {
    collapsed: boolean;
    panelSize: number;
    activeSubTab?: TerminalId | null;
    focusTarget?: "main" | "sub";
  },
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  const cur = entry.meta.subPanel;
  if (
    cur &&
    cur.collapsed === state.collapsed &&
    cur.panelSize === state.panelSize &&
    cur.activeSubTab === state.activeSubTab &&
    cur.focusTarget === state.focusTarget
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

/** The sole writer of `activeTerminalId`. Records the marker and nothing else —
 *  the dirty-fire is a separate concern the client setter composes on top. */
function assignActiveTerminalId(id: TerminalId | null): void {
  activeTerminalId = id;
}

/** Store which terminal is active (reported by the client).
 *  Only emits session:changed when a terminal is actually selected —
 *  null (no selection, e.g. client reconnect) must not trigger
 *  auto-save because snapshotSession() may return an empty terminal
 *  list at that point, which would clear the saved session. */
export function setActiveTerminalId(id: TerminalId | null): void {
  assignActiveTerminalId(id);
  if (id !== null) terminalsDirtyChannel.publish({});
}

/** Restore the active-terminal marker from a session being adopted at boot
 *  (B3.3), WITHOUT firing `terminals:dirty` — unlike `setActiveTerminalId`, the
 *  client-reported setter. The boot converges the saved session explicitly right
 *  after, so this must not arm a competing autosave; it only seeds the value
 *  `snapshotSession()` will read so the adopted session keeps its active tile. */
export function restoreActiveTerminalId(id: TerminalId | null): void {
  assignActiveTerminalId(id);
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

/** Kill and remove all terminals. Used by tests to reset server state between
 *  scenarios. Async since #951 R4c (awaits the daemon's killAll over the
 *  socket before draining the registry). */
export async function killAllTerminals(): Promise<void> {
  await localEndpoint.killAllTerminals();
}
