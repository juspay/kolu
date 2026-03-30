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
import { createMetadata, publishMetadata, startProviders } from "./meta/index.ts";
import { publishForTerminal, publishSystem } from "./publisher.ts";
import type { SavedTerminal } from "kolu-common";

/** Server-side terminal state. Owns a PtyHandle and embeds the wire-type TerminalInfo. */
export interface TerminalProcess {
  /** The wire-type snapshot — single source of truth for id, pid, isActive, meta, parentId, activityHistory. */
  info: TerminalInfo;
  handle: PtyHandle;
  /** Timer that flips isActive→false after idle threshold. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Per-terminal clipboard directory for image paste shims. */
  clipboardDir: string;
  /** Cleanup function for all metadata providers. */
  stopProviders: () => void;
}

const terminals = new Map<TerminalId, TerminalProcess>();

const IDLE_MS = ACTIVITY_IDLE_THRESHOLD_S * 1000;

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

/** Mark terminal active and reset the idle timer. */
function touchActivity(entry: TerminalProcess, terminalId: string): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (!entry.info.isActive) {
    entry.info.isActive = true;
    pushActivitySample(entry, true);
    publishForTerminal("activity", terminalId, true);
  }
  entry.idleTimer = setTimeout(() => {
    entry.info.isActive = false;
    pushActivitySample(entry, false);
    publishForTerminal("activity", terminalId, false);
  }, IDLE_MS);
}

/** Build a session snapshot from current terminal state. */
export function snapshotSession(): SavedTerminal[] {
  return [...terminals.entries()].map(([id, entry]) => ({
    id,
    cwd: entry.info.meta!.cwd,
    ...(entry.info.parentId && { parentId: entry.info.parentId }),
    ...(entry.info.meta!.git && {
      repoName: entry.info.meta!.git.repoName,
      branch: entry.info.meta!.git.branch,
    }),
  }));
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
      // PTY callback (OSC 7): update metadata CWD, providers react to the event
      onCwd: (newCwd) => {
        const entry = terminals.get(id);
        if (entry) {
          entry.info.meta!.cwd = newCwd;
          publishMetadata(entry, id);
          emitChanged();
        }
      },
    },
    { shimBinDir: CLIPBOARD_SHIM_DIR, clipboardDir },
    cwd,
  );

  const meta = createMetadata(handle.cwd);
  const entry: TerminalProcess = {
    info: {
      id,
      pid: handle.pid,
      isActive: true,
      meta,
      parentId,
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
  const list = [...terminals.values()].map((entry) => entry.info);
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

/** Set or clear a terminal's parent relationship. */
export function setTerminalParent(
  id: TerminalId,
  parentId: string | null,
): void {
  const entry = terminals.get(id);
  if (entry) entry.info.parentId = parentId ?? undefined;
}

/** Set the theme name for a terminal (stored in metadata, published to clients). */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = terminals.get(id);
  if (entry) {
    entry.info.meta!.themeName = themeName;
    publishMetadata(entry, id);
  }
}

/** Reorder terminals to match the given ID array. IDs not in the list are appended at the end. */
export function reorderTerminals(ids: TerminalId[]): void {
  const reordered = new Map<TerminalId, TerminalProcess>();
  for (const id of ids) {
    const entry = terminals.get(id);
    if (entry) reordered.set(id, entry);
  }
  // Append any IDs not in the provided list (shouldn't happen, but be safe)
  for (const [id, entry] of terminals) {
    if (!reordered.has(id)) reordered.set(id, entry);
  }
  terminals.clear();
  for (const [id, entry] of reordered) terminals.set(id, entry);
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
