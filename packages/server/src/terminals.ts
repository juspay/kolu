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
} from "kolu-common";
import { cleanupClipboardDir } from "./clipboard.ts";
import { log } from "./log.ts";
import {
  createMetadata,
  startProviders,
  updateClientMetadata,
  updateServerMetadata,
} from "./meta/index.ts";
import { spawnPty } from "./pty.ts";
import { publishForTerminal, publishSystem } from "./publisher.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  terminalEntries,
  type TerminalProcess,
  unregisterTerminal,
} from "./terminal-registry.ts";

// Re-export registry accessors + type so external callers (router.ts,
// diagnostics.ts, index.ts) keep a single import path.
export {
  countActiveClaudeSessions,
  getTerminal,
  listTerminals,
  terminalCount,
  type TerminalProcess,
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
      } = entry.info.meta;
      return { id, ...persisted };
    },
  );
  return { terminals: snappedTerminals, activeTerminalId };
}

/** Notify that terminal state changed (triggers debounced session auto-save). */
function emitChanged(): void {
  publishSystem("terminals:dirty", {});
}

/** Notify that terminal membership changed (create/kill).
 *  Drives the live terminal.list stream to clients. */
function emitListChanged(): void {
  publishSystem("terminal-list", listTerminals());
}

/** Create a new terminal, spawn a PTY process. `initial` seeds
 *  client-owned metadata onto `meta` before the first `emitListChanged()`,
 *  so the list snapshot already carries it — used by session restore
 *  to avoid racing post-hoc `setCanvasLayout` / `setTheme` / `setSubPanel`
 *  RPCs against the client's canvas-cascade effect (#642). */
export function createTerminal(
  cwd?: string,
  parentId?: string,
  initial?: InitialTerminalMetadata,
): TerminalInfo {
  const id = crypto.randomUUID();
  const tlog = log.child({ terminal: id });

  const handle = spawnPty(
    tlog,
    id,
    {
      onData: (data) => {
        publishForTerminal("data", id, data);
      },
      // On natural exit: notify clients, then remove from server state
      onExit: (exitCode) => {
        tlog.info({ exitCode }, "exited");
        const entry = getTerminal(id);
        if (entry) {
          entry.stopProviders();
          cleanupClipboardDir(id);
        }
        publishForTerminal("exit", id, exitCode);
        // Only save session on natural exit (entry still in map).
        // killAllTerminals clears the map first, so entry is gone — skip.
        const wasNaturalExit = unregisterTerminal(id);
        if (wasNaturalExit) {
          emitChanged();
          emitListChanged();
        }
      },
      // PTY callback (OSC 0/2): notify process provider that title changed
      onTitleChange: (title) => {
        publishForTerminal("title", id, title);
      },
      // PTY callback (OSC 633;E): raw preexec command line. Agent parsing,
      // the per-terminal stash, and the recent-agents MRU all live in
      // `meta/agent-command.ts`, fed via this channel.
      onCommandRun: (raw) => {
        publishForTerminal("commandRun", id, raw);
      },
      // PTY callback (OSC 7): update metadata CWD, notify providers via cwd channel
      onCwd: (newCwd) => {
        const entry = getTerminal(id);
        if (entry) {
          updateServerMetadata(entry, id, (m) => {
            m.cwd = newCwd;
          });
          publishForTerminal("cwd", id, newCwd);
        }
      },
    },
    cwd,
  );

  const meta = createMetadata(handle.cwd);
  if (parentId) meta.parentId = parentId;
  // Seed client-owned initial metadata BEFORE emitListChanged so the
  // first list snapshot carries these fields (see #642).
  if (initial?.themeName) meta.themeName = initial.themeName;
  if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
  if (initial?.subPanel) meta.subPanel = initial.subPanel;
  const entry: TerminalProcess = {
    info: {
      id,
      pid: handle.pid,
      meta,
    },
    handle,
    stopProviders: () => {},
  };
  // Start providers after entry is in the map (providers may emit immediately)
  registerTerminal(id, entry);
  entry.stopProviders = startProviders(entry, id);

  tlog.info({ pid: handle.pid, total: listTerminals().length }, "created");
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
 *  Same approach: mutate metadata directly, session auto-save only. */
export function setSubPanelState(
  id: TerminalId,
  state: { collapsed: boolean; panelSize: number },
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  entry.info.meta.subPanel = state;
  emitChanged();
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
