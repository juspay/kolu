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
import {
  createMetadata,
  updateMetadata,
  startProviders,
} from "./meta/index.ts";
import { publishForTerminal, publishSystem } from "./publisher.ts";
import { parseAgentCommand } from "anyagent";
import { trackRecentAgent } from "./state.ts";
import type { SavedTerminal } from "kolu-common";

/** Server-side terminal state. Owns a PtyHandle and embeds the wire-type TerminalInfo. */
export interface TerminalProcess {
  /** The wire-type snapshot — single source of truth for id, pid, meta. */
  info: TerminalInfo;
  handle: PtyHandle;
  /** Whether the terminal is currently producing output. Server-side only —
   *  published to clients via the dedicated "activity" channel, not metadata. */
  busy: boolean;
  /** Rolling window of activity transitions — server-side only.
   *  Sent as snapshot on activity subscription connect (for sparkline seed). */
  activityHistory: ActivitySample[];
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
    if (
      entry.info.meta.parentId === parentId &&
      entry.info.meta.sortOrder > max
    ) {
      max = entry.info.meta.sortOrder;
    }
  }
  return max + SORT_GAP;
}

/** Append a sample and trim entries older than the rolling window. Returns the sample. */
function pushActivitySample(
  entry: TerminalProcess,
  active: boolean,
): ActivitySample {
  const now = Date.now();
  const cutoff = now - ACTIVITY_WINDOW_MS;
  const h = entry.activityHistory;
  // Drop samples outside the window (array is chronological)
  const keep = h.findIndex(([t]) => t >= cutoff);
  if (keep !== 0) h.splice(0, keep === -1 ? h.length : keep);
  const sample: ActivitySample = [now, active];
  h.push(sample);
  return sample;
}

/** Mark terminal busy and reset the idle timer.
 *  Publishes [epochMs, isActive] on the dedicated "activity" channel — avoids
 *  serializing the full metadata object on every keystroke. */
function touchActivity(entry: TerminalProcess, terminalId: string): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (!entry.busy) {
    entry.busy = true;
    const sample = pushActivitySample(entry, true);
    publishForTerminal("activity", terminalId, sample);
  }
  entry.idleTimer = setTimeout(() => {
    entry.busy = false;
    const sample = pushActivitySample(entry, false);
    publishForTerminal("activity", terminalId, sample);
  }, IDLE_MS);
}

/** Build a session snapshot from current terminal state. */
export function snapshotSession(): SavedTerminal[] {
  return [...terminals.entries()].map(([id, entry]) => {
    const m = entry.info.meta;
    const layout = canvasLayouts.get(id);
    return {
      id,
      cwd: m.cwd,
      ...(m.parentId && { parentId: m.parentId }),
      ...(m.git && { repoName: m.git.repoName, branch: m.git.branch }),
      sortOrder: m.sortOrder,
      ...(m.themeName && { themeName: m.themeName }),
      ...(layout && { canvasLayout: layout }),
    };
  });
}

/** Notify that terminal state changed (triggers debounced session auto-save). */
function emitChanged(): void {
  publishSystem("session:changed", {});
}

/** Notify that terminal membership changed (create/kill/reorder).
 *  Drives the live terminal.list stream to clients. */
function emitListChanged(): void {
  publishSystem("terminal-list", listTerminals());
}

/** Create a new terminal, spawn a PTY process. Optionally set initial CWD and parent. */
export function createTerminal(cwd?: string, parentId?: string): TerminalInfo {
  const id = crypto.randomUUID();
  const tlog = log.child({ terminal: id });
  const clipboardDir = createClipboardDir(id);

  const handle = spawnPty(
    tlog,
    id,
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
        if (wasNaturalExit) {
          emitChanged();
          emitListChanged();
        }
      },
      // PTY callback (OSC 0/2): notify process provider that title changed
      onTitleChange: (title) => {
        publishForTerminal("title", id, title);
      },
      // PTY callback (OSC 633;E): raw preexec command line. Normalize and,
      // if the first token matches a known agent binary, push it to the
      // global recent-agents MRU. Commands that aren't agents are discarded.
      onCommandRun: (raw) => {
        const normalized = parseAgentCommand(raw);
        if (normalized) trackRecentAgent(normalized);
      },
      // PTY callback (OSC 7): update metadata CWD, notify providers via cwd channel
      onCwd: (newCwd) => {
        const entry = terminals.get(id);
        if (entry) {
          updateMetadata(entry, id, (m) => {
            m.cwd = newCwd;
          });
          publishForTerminal("cwd", id, newCwd);
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
    },
    handle,
    busy: true,
    activityHistory: [[Date.now(), true] as ActivitySample],
    clipboardDir,
    stopProviders: () => {},
  };
  // Start providers after entry is in the map (providers may emit immediately)
  terminals.set(id, entry);
  entry.stopProviders = startProviders(entry, id);

  tlog.info({ pid: handle.pid, total: terminals.size }, "created");
  emitChanged();
  emitListChanged();
  return entry.info;
}

export function listTerminals(): TerminalInfo[] {
  const list = [...terminals.values()]
    .map((entry) => entry.info)
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  log.debug({ count: list.length }, "terminal list");
  return list;
}

/** Number of live terminal processes. Cheap counter for diagnostics. */
export const terminalCount = (): number => terminals.size;

/** Number of terminals currently hosting a Claude Code session. Derived
 *  from `entry.info.meta.agent` — the claude provider sets it on session
 *  match and clears it on teardown (see `meta/claude.ts`). Exported for diagnostics. */
export function countActiveClaudeSessions(): number {
  let n = 0;
  for (const entry of terminals.values()) {
    if (entry.info.meta.agent?.kind === "claude-code") n++;
  }
  return n;
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
  canvasLayouts.delete(id);
  emitChanged();
  emitListChanged();
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

// Canvas layout positions — client-reported, used only for session snapshots.
// Not part of TerminalMetadata (which is streamed to all clients).
const canvasLayouts = new Map<
  TerminalId,
  { x: number; y: number; w: number; h: number }
>();

/** Store a terminal's canvas layout position (reported by the client). */
export function setCanvasLayout(
  id: TerminalId,
  layout: { x: number; y: number; w: number; h: number },
): void {
  canvasLayouts.set(id, layout);
  emitChanged();
}

/** Get a terminal's canvas layout (for session snapshot). */
export function getCanvasLayout(
  id: TerminalId,
): { x: number; y: number; w: number; h: number } | undefined {
  return canvasLayouts.get(id);
}

/** Set the theme name for a terminal (stored in metadata, published to clients). */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = terminals.get(id);
  if (entry) {
    updateMetadata(entry, id, (m) => {
      m.themeName = themeName;
    });
  }
}

/** Reorder terminals by assigning sequential sortOrder values. */
export function reorderTerminals(ids: TerminalId[]): void {
  for (let i = 0; i < ids.length; i++) {
    const entry = terminals.get(ids[i]!);
    if (entry) {
      updateMetadata(entry, ids[i]!, (m) => {
        m.sortOrder = (i + 1) * SORT_GAP;
      });
    }
  }
  log.debug({ count: ids.length }, "terminals reordered");
  emitListChanged();
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
  emitListChanged();
}
