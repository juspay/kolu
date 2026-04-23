/**
 * Terminal state management: PTY lifecycle and per-terminal metadata.
 * Plain Map + exported functions. Each entry owns its PtyHandle.
 */
import { spawnPty, type PtyHandle } from "./pty.ts";
import type {
  InitialTerminalMetadata,
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common";
import { log } from "./log.ts";
import { createClipboardDir, cleanupClipboardDir } from "./clipboard.ts";
import {
  createMetadata,
  updateServerMetadata,
  updateClientMetadata,
  startProviders,
} from "./meta/index.ts";
import { publishForTerminal, publishSystem } from "./publisher.ts";
import type { SavedTerminal } from "kolu-common";

/** Server-side terminal state. Owns a PtyHandle and embeds the wire-type TerminalInfo. */
export interface TerminalProcess {
  /** The wire-type snapshot — single source of truth for id, pid, meta. */
  info: TerminalInfo;
  handle: PtyHandle;
  /** Per-terminal directory where pasted clipboard images land on disk. */
  clipboardDir: string;
  /** Cleanup function for all metadata providers. */
  stopProviders: () => void;
}

const terminals = new Map<TerminalId, TerminalProcess>();

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

/** Build a session snapshot from current terminal + client-reported state. */
export function snapshotSession(): {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
} {
  const snappedTerminals = [...terminals.entries()].map(([id, entry]) => {
    const m = entry.info.meta;
    return {
      id,
      cwd: m.cwd,
      ...(m.parentId && { parentId: m.parentId }),
      ...(m.git && { repoName: m.git.repoName, branch: m.git.branch }),
      sortOrder: m.sortOrder,
      ...(m.themeName && { themeName: m.themeName }),
      ...(m.canvasLayout && { canvasLayout: m.canvasLayout }),
      ...(m.subPanel && { subPanel: m.subPanel }),
    };
  });
  return { terminals: snappedTerminals, activeTerminalId };
}

/** Notify that terminal state changed (triggers debounced session auto-save). */
function emitChanged(): void {
  publishSystem("terminals:dirty", {});
}

/** Notify that terminal membership changed (create/kill/reorder).
 *  Drives the live terminal.list stream to clients. */
function emitListChanged(): void {
  publishSystem("terminal-list", listTerminals());
}

/** Identity tuple — two terminals "collide" iff this matches. Git-aware
 *  terminals key on (repo, branch); the rest fall back to cwd. Mirrors the
 *  user-facing notion of "same place" — opening the same branch twice
 *  should look distinguishable, but two unrelated cwds never need a suffix. */
function identityKey(m: TerminalMetadata): string {
  return m.git ? `git|${m.git.repoName}|${m.git.branch}` : `cwd|${m.cwd}`;
}

/** Recompute `displaySuffix` for every terminal. Mutates each entry's
 *  metadata in place; returns the ids whose suffix flipped so callers
 *  can fan out per-terminal `metadata` republishes. Cheap O(N) — runs
 *  on every metadata mutation (collisions can change with any cwd/git
 *  update) and the delta gate keeps the network quiet. */
export function recomputeDisplaySuffixes(): TerminalId[] {
  const counts = new Map<string, number>();
  for (const entry of terminals.values()) {
    const k = identityKey(entry.info.meta);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const changed: TerminalId[] = [];
  for (const [id, entry] of terminals.entries()) {
    const m = entry.info.meta;
    const next =
      (counts.get(identityKey(m)) ?? 0) > 1 ? `#${id.slice(0, 4)}` : undefined;
    if (m.displaySuffix !== next) {
      m.displaySuffix = next;
      changed.push(id);
    }
  }
  return changed;
}

/** Lifecycle-side companion to `recomputeDisplaySuffixes`: recompute and
 *  publish per-terminal metadata for every terminal whose suffix flipped.
 *  Used on create/kill, where no metadata publish would otherwise fire
 *  for the OTHER terminals whose collision status just changed. */
function publishSuffixChanges(): void {
  const changed = recomputeDisplaySuffixes();
  for (const id of changed) {
    const entry = terminals.get(id);
    if (entry) publishForTerminal("metadata", id, { ...entry.info.meta });
  }
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
  const clipboardDir = createClipboardDir(id);

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
        const entry = terminals.get(id);
        if (entry) {
          entry.stopProviders();
          cleanupClipboardDir(entry.clipboardDir);
        }
        publishForTerminal("exit", id, exitCode);
        // Only save session on natural exit (entry still in map).
        // killAllTerminals clears the map first, so entry is gone — skip.
        const wasNaturalExit = terminals.delete(id);
        if (wasNaturalExit) {
          publishSuffixChanges();
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
        const entry = terminals.get(id);
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

  const meta = createMetadata(handle.cwd, nextSortOrder(parentId));
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
    clipboardDir,
    stopProviders: () => {},
  };
  // Start providers after entry is in the map (providers may emit immediately)
  terminals.set(id, entry);
  entry.stopProviders = startProviders(entry, id);

  tlog.info({ pid: handle.pid, total: terminals.size }, "created");
  // New terminal can collide with an existing one — fan out metadata
  // republishes for any terminal whose suffix just flipped on or off.
  publishSuffixChanges();
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
 *  from `entry.info.meta.agent` — the generic agent orchestrator
 *  (`meta/agent.ts`, driven by `claudeCodeProvider` from `kolu-claude-code`)
 *  sets it on session match and clears it on teardown. Exported for diagnostics. */
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
  entry.stopProviders();
  entry.handle.dispose();
  cleanupClipboardDir(entry.clipboardDir);
  terminals.delete(id);
  // Removing a terminal can resolve a collision — fan out metadata
  // republishes so the survivor's suffix clears.
  publishSuffixChanges();
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
    updateClientMetadata(entry, id, (m) => {
      m.parentId = newParent;
      m.sortOrder = nextSortOrder(newParent);
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
  const entry = terminals.get(id);
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
  const entry = terminals.get(id);
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
  const entry = terminals.get(id);
  if (entry) {
    updateClientMetadata(entry, id, (m) => {
      m.themeName = themeName;
    });
  }
}

/** Reorder terminals by assigning sequential sortOrder values. */
export function reorderTerminals(ids: TerminalId[]): void {
  for (let i = 0; i < ids.length; i++) {
    const entry = terminals.get(ids[i]!);
    if (entry) {
      updateClientMetadata(entry, ids[i]!, (m) => {
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
    entry.stopProviders();
    entry.handle.dispose();
    cleanupClipboardDir(entry.clipboardDir);
  }
  emitListChanged();
}
