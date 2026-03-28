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
import { EventEmitter } from "node:events";
import { log } from "./log.ts";
import {
  CLIPBOARD_SHIM_DIR,
  createClipboardDir,
  cleanupClipboardDir,
} from "./clipboard.ts";
import { createMetadata, emitMetadata, startProviders } from "./meta/index.ts";

/** Typed event map — eliminates stringly-typed emit/on/off calls. */
export interface TerminalEvents {
  data: [data: string];
  exit: [exitCode: number];
  metadata: [meta: TerminalMetadata];
  activity: [isActive: boolean];
}

/** Server-side terminal state. Owns a PtyHandle and event emitter. */
export interface TerminalEntry {
  handle: PtyHandle;
  emitter: EventEmitter<TerminalEvents>;
  themeName?: string;
  /** Current activity state. Transitions emit "activity" event. */
  isActive: boolean;
  /** Timer that flips isActive→false after idle threshold. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Per-terminal clipboard directory for image paste shims. */
  clipboardDir: string;
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId?: string;
  /** Rolling activity history: timestamped transitions for sparkline. */
  activityHistory: ActivitySample[];
  /** Aggregated metadata from all providers. */
  metadata: TerminalMetadata;
  /** Cleanup function for all metadata providers. */
  stopProviders: () => void;
}

const terminals = new Map<TerminalId, TerminalEntry>();

function toInfo(id: TerminalId, entry: TerminalEntry): TerminalInfo {
  return {
    id,
    pid: entry.handle.pid,
    themeName: entry.themeName,
    isActive: entry.isActive,
    parentId: entry.parentId,
    activityHistory:
      entry.activityHistory.length > 0 ? entry.activityHistory : undefined,
  };
}

const IDLE_MS = ACTIVITY_IDLE_THRESHOLD_S * 1000;

/** Append a sample and trim entries older than the rolling window. */
function pushActivitySample(entry: TerminalEntry, active: boolean): void {
  const now = Date.now();
  const cutoff = now - ACTIVITY_WINDOW_MS;
  // Trim old samples (array is chronological, so find first valid index)
  const first = entry.activityHistory.findIndex(([t]) => t >= cutoff);
  if (first > 0) entry.activityHistory.splice(0, first);
  else if (first === -1) entry.activityHistory.length = 0;
  entry.activityHistory.push([now, active]);
}

/** Mark terminal active and reset the idle timer. */
function touchActivity(entry: TerminalEntry): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (!entry.isActive) {
    entry.isActive = true;
    pushActivitySample(entry, true);
    entry.emitter.emit("activity", true);
  }
  entry.idleTimer = setTimeout(() => {
    entry.isActive = false;
    pushActivitySample(entry, false);
    entry.emitter.emit("activity", false);
  }, IDLE_MS);
}

/** Create a new terminal, spawn a PTY process. Optionally set initial CWD and parent. */
export function createTerminal(cwd?: string, parentId?: string): TerminalInfo {
  const id = crypto.randomUUID();
  const tlog = log.child({ terminal: id });
  const emitter = new EventEmitter<TerminalEvents>();
  const clipboardDir = createClipboardDir(id);

  const handle = spawnPty(
    tlog,
    {
      onData: (data) => {
        const entry = terminals.get(id);
        if (entry) touchActivity(entry);
        emitter.emit("data", data);
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
        emitter.emit("exit", exitCode);
        terminals.delete(id);
      },
      // PTY callback (OSC 7): update metadata CWD, providers react to the event
      onCwd: (newCwd) => {
        const entry = terminals.get(id);
        if (entry) {
          entry.metadata.cwd = newCwd;
          emitMetadata(entry, id);
        }
      },
    },
    { shimBinDir: CLIPBOARD_SHIM_DIR, clipboardDir },
    cwd,
  );

  const metadata = createMetadata(handle.cwd);
  const entry: TerminalEntry = {
    handle,
    emitter,
    isActive: true,
    clipboardDir,
    parentId,
    activityHistory: [[Date.now(), true] as ActivitySample],
    metadata,
    stopProviders: () => {},
  };
  // Start providers after entry is in the map (providers may emit immediately)
  terminals.set(id, entry);
  entry.stopProviders = startProviders(entry, id);

  tlog.info({ pid: handle.pid, total: terminals.size }, "created");
  return toInfo(id, entry);
}

export function listTerminals(): TerminalInfo[] {
  const list = [...terminals.entries()].map(([id, entry]) => toInfo(id, entry));
  log.debug({ count: list.length }, "terminal list");
  return list;
}

export function getTerminal(id: TerminalId): TerminalEntry | undefined {
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
  const info = toInfo(id, entry);
  terminals.delete(id);
  return info;
}

/** Set or clear a terminal's parent relationship. */
export function setTerminalParent(
  id: TerminalId,
  parentId: string | null,
): void {
  const entry = terminals.get(id);
  if (entry) entry.parentId = parentId ?? undefined;
}

/** Set the theme name for a terminal. */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = terminals.get(id);
  if (entry) entry.themeName = themeName;
}

/** Reorder terminals to match the given ID array. IDs not in the list are appended at the end. */
export function reorderTerminals(ids: TerminalId[]): void {
  const reordered = new Map<TerminalId, TerminalEntry>();
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
  for (const entry of terminals.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.stopProviders();
    entry.handle.dispose();
    cleanupClipboardDir(entry.clipboardDir);
  }
  terminals.clear();
}
