/**
 * Terminal lifecycle façade — `createTerminal` / `killTerminal` /
 * `killAllTerminals` delegate to the local `TerminalEndpoint`. The
 * endpoint owns PTY spawn, per-terminal provider startup, registry
 * insert/remove, autosave-trigger signalling.
 *
 * Client-facing per-terminal metadata setters (`setTerminalParent`,
 * `setCanvasLayout`, `setSubPanelState`, `setRightPanelState`,
 * `setTerminalTheme`, `setTerminalNotes`) live here because they're
 * endpoint-agnostic — they mutate the in-registry entry through the
 * narrowed `updateClientMetadata` helper, which publishes through the
 * same metadata channel regardless of which endpoint owns the terminal.
 *
 * Re-exports the registry surface for callers that used to import
 * state-reads + lifecycle from this file as a single module.
 */

import {
  type InitialTerminalMetadata,
  type RightPanelPerTerminalState,
  type SavedTerminal,
  SavedTerminalSchema,
  type TerminalId,
  type TerminalInfo,
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
import {
  beginSleepLocal,
  localTerminalEndpoint,
  releaseSleptLocalPty,
} from "./terminalEndpoint/local.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";
import { type SessionSnapshot, saveSession } from "./session.ts";
// biome-ignore-end assist/source/organizeImports: cycle-sensitive load order

// A single local endpoint today. P3 will select the endpoint per call
// site (e.g. a sub-terminal inheriting its parent's endpoint).
const localEndpoint = localTerminalEndpoint;

// Re-export registry accessors + type so external callers (router.ts,
// diagnostics.ts, index.ts) keep a single import path.
export {
  activeTerminalCount,
  countActiveClaudeSessions,
  getTerminal,
  listTerminals,
  type TerminalProcess,
  terminalCount,
} from "./terminal-registry.ts";

/** Build a session snapshot from current terminal state.
 *
 *  Each live registry entry (an `ActiveTerminal`) is projected onto
 *  `SavedActiveTerminalSchema` — the schema IS the single source of truth for
 *  the persisted-vs-live partition, so the live overlay (pr/agent/foreground) is
 *  stripped structurally and a future live field can never silently ride to disk.
 *  A hand-named destructure would have to be kept in sync with the live partition
 *  by convention (TS does not excess-check object spreads, so a drifted strip
 *  would type-clean); deriving the strip from the schema makes
 *  "a persisted record carrying a live field" unrepresentable here. A new
 *  *persisted* field, being part of the schema, flows through untouched.
 *  Order is `Map` insertion order — terminals appear in the sequence they were
 *  created. */
export function snapshotSession(): SessionSnapshot {
  const snappedTerminals = [...terminalEntries()].map(
    ([id, entry]): SavedTerminal =>
      // The registry now holds the `Terminal` union, so project each entry
      // through the SAVED discriminated union: an active entry strips its live
      // overlay onto the active arm, a sleeping entry carries its persisted base
      // + `sleptAt` onto the sleeping arm. One snapshot, both arms, by `state`.
      SavedTerminalSchema.parse({ ...entry.meta, id }),
  );
  return { terminals: snappedTerminals, activeTerminalId };
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

/** Sleep a terminal — flip it to the sleeping arm IN PLACE, persist the session
 *  DURABLY, then release its PTY (persist-before-kill). A crash in the kill
 *  window leaves a sleeping record on disk, never a zombie active one; boot
 *  reconcile reaps any briefly-surviving PTY (adopt-or-reap). A no-op if `id`
 *  is not an active terminal. */
export async function sleepTerminal(id: TerminalId): Promise<void> {
  if (!beginSleepLocal(id)) return;
  saveSession(snapshotSession());
  await releaseSleptLocalPty(id);
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

/** Set or clear a terminal's freeform notes. Empty string clears. */
export function setTerminalNotes(id: TerminalId, notes: string): void {
  const entry = getTerminal(id);
  if (!entry) return;
  const next = notes.length > 0 ? notes : undefined;
  updateClientMetadata(entry, id, (m) => {
    m.notes = next;
  });
}

/** Kill and remove all terminals. Used by tests to reset server state between
 *  scenarios. Async since #951 R4c (awaits the daemon's killAll over the
 *  socket before draining the registry). */
export async function killAllTerminals(): Promise<void> {
  await localEndpoint.killAllTerminals();
}
