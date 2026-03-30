/**
 * Terminal state management: PTY lifecycle and per-terminal metadata.
 * Plain Map + exported functions. Each entry owns its PtyHandle.
 */
import { spawnPty, type PtyHandle } from "./pty.ts";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
} from "kolu-common";
import {
  ACTIVITY_IDLE_THRESHOLD_S,
  ACTIVITY_WINDOW_MS,
} from "kolu-common/config";
import { log } from "./log.ts";
import {
  CLIPBOARD_SHIM_DIR,
  createClipboardDir,
  cleanupClipboardDir,
} from "./clipboard.ts";
import { createMetadata, updateMetadata, startProviders } from "./meta/index.ts";
import { publishForTerminal, publishSystem } from "./publisher.ts";
import type { SavedTerminal } from "kolu-common";

/** Server-side terminal state. Owns a PtyHandle and embeds the wire-type TerminalInfo. */
export interface TerminalProcess {
  /** The wire-type snapshot — single source of truth for id, pid, meta, activityHistory. */
  info: TerminalInfo;
  handle: PtyHandle;
  /** Timer that flips busy→false after idle threshold. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Per-terminal clipboard directory for image paste shims. */
  clipboardDir: string;
  /** Cleanup function for all metadata providers. */
  stopProviders: () => void;
}

const terminals = new Map<TerminalId, TerminalProcess>();

const IDLE_MS = ACTIVITY_IDLE_THRESHOLD_S * 1000;
const SORT_GAP = 1000;

/** Next sortOrder for a group (top-level or siblings of a parent). */
function nextSortOrder(parentId?: string): number {
  let max = 0;
  for (const entry of terminals.values()) {
    if (entry.info.meta.parentId === parentId && entry.info.meta.sortOrder > max) {
      max = entry.info.meta.sortOrder;
    }
  }
  return max + SORT_GAP;
}

/** Append a sample and trim entries older than the rolling window. */
function pushActivitySample(entry: TerminalProcess, active: boolean): void {
  const now = Date.now();
  const cutoff = now - ACTIVITY_WINDOW_MS;
  const h = entry.info.activityHistory!;
  // Drop samples outside the window (array is chronological)
  const keep = h.findIndex(([t]) => t >= cutoff);
  if (keep !== 0) h.splice(0, keep === -1 ? h.length : keep);
  h.push([now, active]);
}

/** Mark terminal busy and reset the idle timer. */
function touchActivity(entry: TerminalProcess, terminalId: string): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (!entry.info.meta.busy) {
    pushActivitySample(entry, true);
    updateMetadata(entry, terminalId, (m) => { m.busy = true; });
  }
  entry.idleTimer = setTimeout(() => {
    pushActivitySample(entry, false);
    updateMetadata(entry, terminalId, (m) => { m.busy = false; });
  }, IDLE_MS);
}

/** Build a session snapshot from current terminal state. */
export function snapshotSession(): SavedTerminal[] {
  return [...terminals.entries()].map(([id, entry]) => {
    const m = entry.info.meta;
    return {
      id,
      cwd: m.cwd,
      ...(m.parentId && { parentId: m.parentId }),
      ...(m.git && { repoName: m.git.repoName, branch: m.git.branch }),
      sortOrder: m.sortOrder,
    };
  });
}

/** Notify that terminal state changed (triggers debounced session auto-save). */
function emitChanged(): void {
  publishSystem("session:changed", {});
}

/** Create a new terminal, spawn a PTY process. Optionally set initial CWD and parent. */
export function createTerminal(cwd?: string, parentId?: string): TerminalInfo {
  const id = crypto.randomUUID();
  const tlog = log.child({ terminal: id });
  const clipboardDir = createClipboardDir(id);

  const handle = spawnPty(
    tlog,
    {
      onData: (data) => {
        const entry = terminals.get(id);
        if (entry) touchActivity(entry, id);
        publishForTerminal("data", id, data);
      },
      // On natural exit: notify clients, then remove from server state
      onExit: (exitCode) => {
        tlog.info({ exitCode }, "exited");
        const entry = terminals.get(id);
        if (entry) {
          if (entry.idleTimer) clearTimeout(entry.idleTimer);
          entry.stopProviders();
          cleanupClipboardDir(entry.clipboardDir);
        }
        publishForTerminal("exit", id, exitCode);
        // Only save session on natural exit (entry still in map).
        // killAllTerminals clears the map first, so entry is gone — skip.
        const wasNaturalExit = terminals.delete(id);
        if (wasNaturalExit) emitChanged();
      },
      // PTY callback (OSC 7): update metadata CWD, notify providers via cwd channel
      onCwd: (newCwd) => {
        const entry = terminals.get(id);
        if (entry) {
          updateMetadata(entry, id, (m) => { m.cwd = newCwd; });
          publishForTerminal("cwd", id, newCwd);
          emitChanged();
        }
      },
    },
    { shimBinDir: CLIPBOARD_SHIM_DIR, clipboardDir },
    cwd,
  );

  const meta = createMetadata(handle.cwd, nextSortOrder(parentId));
  if (parentId) meta.parentId = parentId;
  const entry: TerminalProcess = {
    info: {
      id,
      pid: handle.pid,
      meta,
      activityHistory: [[Date.now(), true] as ActivitySample],
    },
    handle,
    clipboardDir,
    stopProviders: () => {},
  };
  // Start providers after entry is in the map (providers may emit immediately)
  terminals.set(id, entry);
  entry.stopProviders = startProviders(entry, id);

  tlog.info({ pid: handle.pid, total: terminals.size }, "created");
  emitChanged();
  return entry.info;
}

export function listTerminals(): TerminalInfo[] {
  const list = [...terminals.values()]
    .map((entry) => entry.info)
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  log.debug({ count: list.length }, "terminal list");
  return list;
}

export function getTerminal(id: TerminalId): TerminalProcess | undefined {
  return terminals.get(id);
}

/** Kill a terminal's PTY process and remove it from the map. Returns final info, or undefined if not found. */
export function killTerminal(id: TerminalId): TerminalInfo | undefined {
  const entry = terminals.get(id);
  if (!entry) return undefined;

  log.child({ terminal: id }).info({ pid: entry.handle.pid }, "killing");
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.stopProviders();
  entry.handle.dispose();
  cleanupClipboardDir(entry.clipboardDir);
  terminals.delete(id);
  emitChanged();
  return entry.info;
}

/** Set or clear a terminal's parent relationship. Assigns sortOrder for the new group. */
export function setTerminalParent(
  id: TerminalId,
  parentId: string | null,
): void {
  const entry = terminals.get(id);
  if (entry) {
    const newParent = parentId ?? undefined;
    updateMetadata(entry, id, (m) => {
      m.parentId = newParent;
      m.sortOrder = nextSortOrder(newParent);
    });
  }
}

/** Set the theme name for a terminal (stored in metadata, published to clients). */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = terminals.get(id);
  if (entry) {
    updateMetadata(entry, id, (m) => { m.themeName = themeName; });
  }
}

/** Reorder terminals by assigning sequential sortOrder values. */
export function reorderTerminals(ids: TerminalId[]): void {
  for (let i = 0; i < ids.length; i++) {
    const entry = terminals.get(ids[i]!);
    if (entry) {
      updateMetadata(entry, ids[i]!, (m) => { m.sortOrder = (i + 1) * SORT_GAP; });
    }
  }
  log.debug({ count: ids.length }, "terminals reordered");
}

/** Kill and remove all terminals. Used by tests to reset server state between scenarios. */
export function killAllTerminals(): void {
  log.info({ count: terminals.size }, "killing all terminals");
  // Snapshot entries and clear map BEFORE disposing — prevents onExit
  // callbacks from finding terminals and triggering session saves.
  const entries = [...terminals.values()];
  terminals.clear();
  for (const entry of entries) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.stopProviders();
    entry.handle.dispose();
    cleanupClipboardDir(entry.clipboardDir);
  }
}
