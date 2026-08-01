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

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import { notifyDirty } from "./publisher.ts";
import { type SessionSnapshot, saveSession } from "./session/session.ts";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";
import {
  beginSleepLocal,
  releaseSleptLocalPty,
} from "./terminalEndpoint/local.ts";
// Load-order is cycle-sensitive: importing `terminalEndpoint/metadata.ts`
// before `terminalEndpoint/local.ts` is what makes the surface cycle
// converge with `localTerminalEndpoint` already initialized by the time
// the top-level `localEndpoint` reference below reads it. Reversing these
// two (biome's alphabetical preference) puts the cycle entry-point at the
// deeper `activity.ts → surface.ts` branch and trips a TDZ on
// `localTerminalEndpoint`.
// biome-ignore-start assist/source/organizeImports: cycle-sensitive load order
import { updateClientMetadata } from "./terminalEndpoint/metadata.ts";
// `resolve.ts` re-imports the already-evaluated `local.ts`, so it stays AFTER it
// to preserve the metadata→local order the TDZ note above depends on.
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import type { RightPanelPerTerminalState } from "./chromeVocab.ts";
import {
  composeTerminalMetadata,
  type CreateTerminalInput,
  LOCAL_LOCATION,
  type RestoreOnlyMetadata,
  type SavedTerminal,
  SavedTerminalSchema,
  type TerminalInfo,
} from "./vocab.ts";

// biome-ignore-end assist/source/organizeImports: cycle-sensitive load order

// A single local endpoint today, resolved through the one `HostLocation` seam.
// R9.2 selects the endpoint per call site (a remote-dialed kaval, or a
// sub-terminal inheriting its parent's endpoint).
const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);

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
  const snappedTerminals = [...terminalEntries()]
    // PARKED records are boot-produced and NEVER persisted — they exist only so
    // the restore card can re-spawn a reboot-killed active terminal, and their
    // authored arm (`state: "parked"`) is not a `SavedTerminal` state. Skip them
    // here so a `terminals:dirty` autosave that fires while parked records linger
    // (before restore) can't try to persist one (a `SavedTerminalSchema.parse`
    // throw) or clobber the saved session with a parked-shaped record. The saved
    // session on disk already holds the pre-reboot ACTIVE record each parked entry
    // stands in for; restore re-spawns from that.
    .filter(([, entry]) => entry.meta.state !== "parked")
    .map(
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
          ...composeTerminalMetadata(
            // The filter above leaves only active | sleeping arms, which
            // `composeTerminalMetadata` accepts; narrow away the parked arm the
            // union carries.
            entry.meta as Exclude<typeof entry.meta, { state: "parked" }>,
            entry.snapshot,
          ),
          id,
        }),
    );
  return { terminals: snappedTerminals, activeTerminalId };
}

/** Create a new terminal — the ORDINARY constructor (the wire `lifecycle.create`
 *  and every in-process caller). The endpoint owns PTY spawn, provider startup, and
 *  registry insert; this wrapper just mints an id and forwards. `initial` seeds
 *  client-owned chrome before providers run — see #642 (avoids racing post-hoc
 *  `setCanvasLayout` / `setTheme` / `setSubPanel` RPCs against the client's
 *  canvas-cascade effect). Its `CreateTerminalInput` type carries NO server-derived
 *  authored facts — a fresh terminal earns `lastActivityAt` / `lastAgentCommand` /
 *  `restoreTarget` from padi's own observation, and the type makes them unspellable
 *  here. The one path with prior truth about them, session restore, uses
 *  {@link restoreSpawn} instead. */
export function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: CreateTerminalInput,
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

/** Re-spawn a terminal DURING SESSION RESTORE — the one constructor that may seed the
 *  three server-derived authored facts (`restoreOnly`), read from the saved blob. It
 *  is a distinct constructor rather than a mode flag on {@link createTerminal} so the
 *  restore-only shape is structurally unspellable by an ordinary create: the fence is
 *  the type, not a convention. Called ONLY by `sessionRestore.ts`'s `respawnActive`;
 *  `restoreOnly` rides its own named parameter, never merged into `initial`. */
export function restoreSpawn(
  cwd: string | undefined,
  parentId: string | undefined,
  initial: CreateTerminalInput,
  restoreOnly: RestoreOnlyMetadata,
): TerminalInfo {
  const id = crypto.randomUUID();
  return localEndpoint.spawnPty(id, {
    cwd,
    parentId,
    initialMetadata: { ...initial, ...restoreOnly },
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
 *  is not an active terminal. */
export async function sleepTerminal(id: TerminalId): Promise<void> {
  if (!beginSleepLocal(id)) return;
  saveSession(snapshotSession());
  await releaseSleptLocalPty(id);
}

/** Refuse a parent edge that is nonsense in any tree model: self-parent, or an
 *  edge that would close a cycle. Depth is not limited — nested splits are
 *  allowed; the canvas flattens them for paint (#2059). These two guards alone
 *  keep the root-ancestor walk from spinning. */
export function requireAcyclicParent(
  childId: TerminalId,
  parentId: TerminalId,
): void {
  if (childId === parentId) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Terminal ${childId} cannot be its own parent`,
    });
  }
  // Walk from the proposed parent toward roots; hitting the child would close
  // a cycle. An existing cycle already on the parent side is also refused —
  // attaching anything under it would leave the graph unwalkable.
  let cur: string | undefined = parentId;
  const seen = new Set<string>();
  while (cur !== undefined) {
    if (cur === childId) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Parent ${parentId} would cycle through ${childId}`,
      });
    }
    if (seen.has(cur)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Parent ${parentId} sits in a cycle`,
      });
    }
    seen.add(cur);
    cur = getTerminal(cur as TerminalId)?.meta.parentId;
  }
}

/** Set or clear a terminal's parent relationship. */
export function setTerminalParent(
  id: TerminalId,
  parentId: string | null,
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  if (parentId !== null) requireAcyclicParent(id, parentId as TerminalId);
  const newParent = parentId ?? undefined;
  updateClientMetadata(entry, id, (m) => {
    m.parentId = newParent;
  });
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
  if (a.collapsed !== b.collapsed) return false;
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
  if (id !== null) notifyDirty();
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
