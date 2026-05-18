/**
 * Terminal lifecycle: spawn PTYs, wire them to metadata providers, and
 * manage create/kill/update operations. The underlying `Map` and its
 * simple accessors (`getTerminal`, `listTerminals`, `terminalCount`,
 * `countActiveClaudeSessions`, the `TerminalProcess` shape) live in
 * `./terminal-registry.ts` so `./meta/*` can depend on the registry
 * without closing a cycle back through this file.
 *
 * External callers that used to import state-reads + lifecycle from
 * `./terminals.ts` as a single module keep their import path — this
 * file re-exports the registry surface they need.
 */

import type {
  InitialTerminalMetadata,
  SavedTerminal,
  TerminalId,
  TerminalInfo,
} from "kolu-common/surface";
import { cleanupClipboardDir } from "./clipboard.ts";
import { getHost } from "./host/registry.ts";
import { LOCAL_HOST_ID } from "./host/local.ts";
import { log } from "./log.ts";
import {
  createMetadata,
  startProviders,
  updateClientMetadata,
  updateServerMetadata,
} from "./meta/index.ts";
import { terminalChannels, terminalsDirtyChannel } from "./publisher.ts";
import { surfaceCtx } from "./surface.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  terminalEntries,
  unregisterTerminal,
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
 *  framework's apply+publish chain (the `terminalList` cell's store is a
 *  no-op since the registry is canonical). */
function emitListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

/** Create a new terminal, spawn a PTY process. `initial` seeds
 *  client-owned metadata before `startProviders` runs, so the first
 *  `terminalMetadata` collection read carries it — used by session
 *  restore to avoid racing post-hoc `setCanvasLayout` / `setTheme` /
 *  `setSubPanel` RPCs against the client's canvas-cascade effect (#642).
 *
 *  `hostId` picks which `Host` runs the PTY. Undefined ⇒ local (the
 *  default). A sub-terminal whose parent runs on a remote host inherits
 *  that hostId automatically — the client doesn't need to thread it
 *  through every "spawn a sibling" code path.
 *
 *  Async because `RemoteHost.spawnPty` round-trips to the SSH helper
 *  (the local host's own spawnPty is synchronous but wrapped in a
 *  Promise for uniformity). */
export async function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: InitialTerminalMetadata,
  hostId?: string,
): Promise<TerminalInfo> {
  const id = crypto.randomUUID();
  const tlog = log.child({ terminal: id });

  // Inherit hostId from the parent terminal if this is a sub-terminal
  // and the client didn't pass one explicitly. The client's "new
  // sub-terminal" shortcut doesn't know which host the parent runs on,
  // so the inheritance has to happen server-side.
  let resolvedHostId = hostId;
  if (resolvedHostId === undefined && parentId) {
    const parent = getTerminal(parentId);
    if (parent) resolvedHostId = parent.meta.hostId;
  }

  const host = getHost(resolvedHostId);
  if (!host) {
    throw new Error(
      `terminal.create: unknown hostId "${resolvedHostId}" (registered hosts: see /host/registry.ts)`,
    );
  }

  const handle = await host.spawnPty(tlog, {
    terminalId: id,
    cwd,
    onData: (data) => {
      terminalChannels.data(id).publish(data);
    },
    // On natural exit: notify clients, then remove from server state
    onExit: (exitCode) => {
      tlog.info({ exitCode }, "exited");
      const entry = getTerminal(id);
      if (entry) {
        entry.stopProviders();
        cleanupClipboardDir(id);
      }
      surfaceCtx.events.terminalExit.publish({ id }, exitCode);
      // Only save session on natural exit (entry still in map).
      // killAllTerminals clears the map first, so entry is gone — skip.
      const wasNaturalExit = unregisterTerminal(id);
      if (wasNaturalExit) {
        emitChanged();
        emitListChanged();
      }
    },
    onTitleChange: (title) => {
      terminalChannels.title(id).publish(title);
    },
    onCommandRun: (raw) => {
      terminalChannels.commandRun(id).publish(raw);
    },
    onCwd: (newCwd) => {
      const entry = getTerminal(id);
      if (entry) {
        updateServerMetadata(entry, id, (m) => {
          m.cwd = newCwd;
        });
        terminalChannels.cwd(id).publish(newCwd);
      }
    },
  });

  const meta = createMetadata(handle.cwd);
  if (parentId) meta.parentId = parentId;
  // Track which host this terminal lives on so session restore (and any
  // future host-aware metadata provider) can route correctly. We
  // intentionally do not store the sentinel "local" — undefined is the
  // canonical local marker so existing persisted records (pre-1.22.0)
  // read back consistently.
  if (host.id !== LOCAL_HOST_ID) meta.hostId = host.id;
  if (initial?.themeName) meta.themeName = initial.themeName;
  if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
  if (initial?.subPanel) meta.subPanel = initial.subPanel;
  if (initial?.lastActivityAt !== undefined)
    meta.lastActivityAt = initial.lastActivityAt;
  const entry: TerminalProcess = {
    info: { id, pid: handle.pid },
    meta,
    handle,
    stopProviders: () => {},
  };
  registerTerminal(id, entry);
  entry.stopProviders = startProviders(entry, id);

  tlog.info(
    { pid: handle.pid, total: listTerminals().length, hostId: host.id },
    "created",
  );
  emitChanged();
  emitListChanged();
  return entry.info;
}

/** Kill a terminal's PTY process and remove it from the map. Returns final info, or undefined if not found. */
export function killTerminal(id: TerminalId): TerminalInfo | undefined {
  const entry = getTerminal(id);
  if (!entry) return undefined;

  log.child({ terminal: id }).info({ pid: entry.handle.pid }, "killing");
  entry.stopProviders();
  entry.handle.dispose();
  cleanupClipboardDir(id);
  unregisterTerminal(id);
  emitChanged();
  emitListChanged();
  return entry.info;
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
 *  as `meta/agent-command.ts`'s `lastAgentCommand` gate. */
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

/** Kill and remove all terminals. Used by tests to reset server state between scenarios. */
export function killAllTerminals(): void {
  // Snapshot entries and clear map BEFORE disposing — prevents onExit
  // callbacks from finding terminals and triggering session saves.
  const entries = drainTerminals();
  log.info({ count: entries.length }, "killing all terminals");
  for (const entry of entries) {
    entry.stopProviders();
    entry.handle.dispose();
    cleanupClipboardDir(entry.info.id);
  }
  emitListChanged();
}
