/**
 * Terminal state management: PTY lifecycle and per-terminal metadata.
 * Plain Map + exported functions. Each entry owns its PtyHandle.
 */
import { spawnPty, type PtyHandle } from "./pty.ts";
import type { TerminalId, TerminalInfo } from "kolu-common";
import { ACTIVITY_IDLE_THRESHOLD_S } from "kolu-common/config";
import { EventEmitter } from "node:events";
import { log } from "./log.ts";
import {
  CLIPBOARD_SHIM_DIR,
  createClipboardDir,
  cleanupClipboardDir,
} from "./clipboard.ts";

/** Typed event map — eliminates stringly-typed emit/on/off calls. */
export interface TerminalEvents {
  data: [data: string];
  exit: [exitCode: number];
  cwd: [cwd: string];
  activity: [isActive: boolean];
}

/** Server-side terminal state. Owns a PtyHandle and event emitter. */
export interface TerminalEntry {
  handle: PtyHandle;
  emitter: EventEmitter<TerminalEvents>;
  name: string;
  themeName?: string;
  /** Current activity state. Transitions emit "activity" event. */
  isActive: boolean;
  /** Timer that flips isActive→false after idle threshold. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Per-terminal clipboard directory for image paste shims. */
  clipboardDir: string;
}

const terminals = new Map<TerminalId, TerminalEntry>();
let nextId = 1;

function toInfo(id: TerminalId, entry: TerminalEntry): TerminalInfo {
  return {
    id,
    name: entry.name,
    pid: entry.handle.pid,
    themeName: entry.themeName,
    isActive: entry.isActive,
  };
}

const IDLE_MS = ACTIVITY_IDLE_THRESHOLD_S * 1000;

/** Mark terminal active and reset the idle timer. */
function touchActivity(entry: TerminalEntry): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (!entry.isActive) {
    entry.isActive = true;
    entry.emitter.emit("activity", true);
  }
  entry.idleTimer = setTimeout(() => {
    entry.isActive = false;
    entry.emitter.emit("activity", false);
  }, IDLE_MS);
}

/** Create a new terminal, spawn a PTY process. Optionally set initial CWD. */
export function createTerminal(cwd?: string): TerminalInfo {
  const id = nextId++;
  const name = `${id}`;
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
      // On natural exit: emit event so onExit stream can yield the exit code
      onExit: (exitCode) => {
        tlog.info({ exitCode }, "exited");
        const entry = terminals.get(id);
        if (entry && entry.idleTimer) clearTimeout(entry.idleTimer);
        emitter.emit("exit", exitCode);
      },
      onCwd: (cwd) => emitter.emit("cwd", cwd),
    },
    { shimBinDir: CLIPBOARD_SHIM_DIR, clipboardDir },
    cwd,
  );

  const entry: TerminalEntry = {
    handle,
    name,
    emitter,
    isActive: true,
    clipboardDir,
  };
  terminals.set(id, entry);
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
  entry.handle.dispose();
  cleanupClipboardDir(entry.clipboardDir);
  const info = toInfo(id, entry);
  terminals.delete(id);
  return info;
}

/** Set the theme name for a terminal. */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = terminals.get(id);
  if (entry) entry.themeName = themeName;
}

/** Kill and remove all terminals. Used by tests to reset server state between scenarios. */
export function killAllTerminals(): void {
  log.info({ count: terminals.size }, "killing all terminals");
  for (const entry of terminals.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.handle.dispose();
    cleanupClipboardDir(entry.clipboardDir);
  }
  terminals.clear();
  nextId = 1;
}
