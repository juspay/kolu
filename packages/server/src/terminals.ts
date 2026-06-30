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

import { ORPCError } from "@orpc/server";
import {
  composeTerminalMetadata,
  type HostLocation,
  hostLocationsEqual,
  type InitialTerminalMetadata,
  LOCAL_LOCATION,
  type RightPanelPerTerminalState,
  type SavedSleepingTerminal,
  type SavedTerminal,
  SavedTerminalSchema,
  type TerminalId,
  type TerminalInfo,
} from "kolu-common/surface";
import type { TerminalAttachment } from "kolu-common/terminalEndpoint";
import { terminalsDirtyChannel } from "./publisher.ts";
import {
  getTerminal,
  requireActiveTerminal,
  terminalEntries,
} from "./terminal-registry.ts";
import { type SessionSnapshot, saveSession } from "./session.ts";
import { updateClientMetadata } from "./terminalEndpoint/metadata.ts";
// The lifecycle façade is the SOLE importer of the host registry's
// `resolveTerminalEndpoint` (every per-terminal op resolves
// `getTerminal(id).meta.location` internally) and of `forEachHost` (the sole
// killAll entry). No top-level endpoint read here any more — the deleted
// `localEndpoint` alias was the one that needed the cycle-sensitive load order; the
// per-call resolution below runs at call time, after `local.ts` has evaluated.
import {
  forEachHost,
  resolveTerminalEndpoint,
} from "./terminalEndpoint/resolve.ts";

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
 *  Design-S: each saved record is the AUTHORED `entry.meta` joined with the entry's
 *  AWARENESS value through `composeTerminalMetadata` — the SAME join the client
 *  applies at read time — then keyed with `id` and re-validated against
 *  `SavedTerminalSchema`. This is a SAVE-TIME snapshot, not a served record: disk
 *  persist is one of the join's two sites (the ephemeral client read is the
 *  other), so reusing the one join at both means the sleeping arm's restore-
 *  relevant projection — the live-half strip down to `PersistedSnapshot`
 *  (`cwd · git · pr`, `pr` riding the observation now, not a frozen authored
 *  field) — lives in exactly one place, so disk and the client read can never
 *  diverge. A new *persisted* field flows through untouched;
 *  a live field can never ride to disk. Awareness is a required field on the entry,
 *  so its presence is TOTAL by type — a plain `.map`, no per-entry guard. Order is
 *  `Map` insertion order — terminals appear in the sequence they were created. */
export function snapshotSession(): SessionSnapshot {
  const snappedTerminals = [...terminalEntries()].map(
    // The JOIN of the two halves — the AUTHORED `entry.meta` (location + client
    // chrome + discriminant) and the entry's AWARENESS value. Spread order matches
    // `composeTerminalMetadata`: awareness FIRST, authored LAST — the authored record
    // names no snapshot field, so it never clobbers the observation. On the sleeping
    // arm the saved discriminated union keeps only the restore-relevant projection
    // (`pr` rides it now — no frozen-`pr` special case) and strips the live half
    // (agent detail + foreground) structurally, so a future live field can never
    // silently ride to disk.
    ([id, entry]): SavedTerminal =>
      SavedTerminalSchema.parse({
        ...composeTerminalMetadata(entry.meta, entry.snapshot),
        id,
      }),
  );
  return { terminals: snappedTerminals, activeTerminalId };
}

/** Resolve the host a fresh terminal is created on. A top-level terminal uses the
 *  requested `location` (default `LOCAL_LOCATION` — the only host today). A
 *  sub-terminal INHERITS its parent's host (one PTY tree, one kaval): an explicit
 *  child `location` that disagrees is a client bug — reject loudly (`BAD_REQUEST`)
 *  rather than silently spawn the child on the wrong host. Pure (the router resolves
 *  the parent's location and hands it in), so the inherit/reject rule is unit-tested
 *  without the router. */
export function resolveCreateLocation(
  requested: HostLocation | undefined,
  parentLocation: HostLocation | undefined,
): HostLocation {
  if (parentLocation === undefined) return requested ?? LOCAL_LOCATION;
  if (
    requested !== undefined &&
    !hostLocationsEqual(requested, parentLocation)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "a sub-terminal must share its parent's host — drop the explicit location or match the parent's",
    });
  }
  return parentLocation;
}

/** Create a new terminal on `location`'s endpoint (default the local host) — the
 *  SOLE location-supplying lifecycle entry (there is no id yet to resolve a location
 *  from). The endpoint owns PTY spawn, provider startup, and registry insert; this
 *  wrapper mints an id and routes through `resolveTerminalEndpoint(location)` — the
 *  same `HostLocation` seam kill/sleep/wake/attach use — handing the SAME `location`
 *  to `spawnPty` so the endpoint stamps `meta.location` from the façade's decision,
 *  never a host literal of its own. `initial` seeds client-owned metadata before
 *  providers run — see #642 (avoids racing post-hoc `setCanvasLayout` / `setTheme` /
 *  `setSubPanel` RPCs against the client's canvas-cascade effect). */
export function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: InitialTerminalMetadata,
  location: HostLocation = LOCAL_LOCATION,
): TerminalInfo {
  const id = crypto.randomUUID();
  return resolveTerminalEndpoint(location).spawnPty(id, {
    cwd,
    parentId,
    initialMetadata: initial,
    location,
  });
}

/** Kill a terminal. Returns final info, or undefined if not found. Async
 *  since #951 R4c: the local endpoint awaits the daemon's kill confirmation
 *  over the socket before unregistering (so a failed kill can't orphan the
 *  PTY). */
export async function killTerminal(
  id: TerminalId,
): Promise<TerminalInfo | undefined> {
  // Route by the terminal's OWN location so a remote tile's kill reaches its
  // host (R9.2), never the local endpoint by default. Routing needs only a
  // location, present on both arms; the endpoint owns the kill-requires-active
  // gate.
  const entry = getTerminal(id);
  if (!entry) return undefined;
  return resolveTerminalEndpoint(entry.meta.location).killTerminal(id);
}

/** Sleep a terminal — flip it to the sleeping arm IN PLACE, persist the session
 *  DURABLY, then release its PTY (persist-before-kill). A crash in the kill
 *  window leaves a sleeping record on disk, never a zombie active one; boot
 *  reconcile reaps any briefly-surviving PTY (adopt-or-reap). A no-op if `id`
 *  is not an active terminal.
 *
 *  Routes by the terminal's OWN location so a remote tile sleeps on its host —
 *  exactly as `killTerminal` routes. `sleep` flips the dormant arm, the session
 *  persists durably, THEN `releaseSleptPty` kills the PTY on the SAME host. */
export async function sleepTerminal(id: TerminalId): Promise<void> {
  const entry = getTerminal(id);
  if (!entry) return;
  const endpoint = resolveTerminalEndpoint(entry.meta.location);
  if (!endpoint.sleep(id)) return;
  saveSession(snapshotSession());
  await endpoint.releaseSleptPty(id);
}

/** Wake a sleeping terminal — re-spawn its PTY on the SAME id and resume its agent.
 *  Routes by the terminal's OWN location (a remote tile wakes on its host); returns
 *  the woken active info, or undefined when `id` is not a sleeping terminal. */
export function wakeTerminal(id: TerminalId): TerminalInfo | undefined {
  const entry = getTerminal(id);
  if (!entry) return undefined;
  return resolveTerminalEndpoint(entry.meta.location).wake(id);
}

/** Discard a sleeping terminal's record (no PTY to kill — sleep already released
 *  it). Routes by the terminal's OWN location; a no-op (false) when `id` is not a
 *  sleeping terminal. */
export function discardSleepingTerminal(id: TerminalId): boolean {
  const entry = getTerminal(id);
  if (!entry) return false;
  return resolveTerminalEndpoint(entry.meta.location).discardSleeping(id);
}

/** Restore a saved SLEEPING record into the registry as a dormant tile. The record
 *  carries its OWN `location`, so this routes to that host's endpoint — a saved
 *  remote sleeping tile reappears on its host, never silently the local one. Returns
 *  false when the record is malformed (dropped) or already present. */
export function restoreSleepingTerminal(
  record: SavedSleepingTerminal,
): boolean {
  return resolveTerminalEndpoint(record.location).seedSleeping(record);
}

/** Attach to a terminal's output — the screen-state snapshot plus the live delta
 *  stream. Narrows to the active arm (`requireActiveTerminal`) and routes by the
 *  terminal's OWN location, exactly as kill/sleep/wake route. */
export function attachTerminal(
  id: TerminalId,
  signal: AbortSignal | undefined,
): Promise<TerminalAttachment> {
  const entry = requireActiveTerminal(id);
  return resolveTerminalEndpoint(entry.meta.location).attach(id, signal);
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
 *  socket before draining the registry).
 *
 *  Drains EVERY host through `forEachHost` — the only entry the host registry
 *  offers for killAll. There is no per-location accessor a caller can hard-pin, so
 *  "killAll on only the local host" is unspellable (a partial-host kill can't be
 *  written). One host today; F-REMOTE's dialed hosts drain through the same loop. */
export async function killAllTerminals(): Promise<void> {
  await forEachHost((endpoint) => endpoint.killAllTerminals());
}
