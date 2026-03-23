/**
 * Terminal state management: PTY lifecycle and per-terminal metadata.
 * Plain Map + exported functions. Each entry owns its PtyHandle.
 */
import { spawnPty, type PtyHandle } from "./pty.ts";
import type {
  TerminalId,
  TerminalInfo,
  TerminalRunning,
  TerminalExited,
} from "kolu-common";
import { EventEmitter } from "node:events";
import { log } from "./log.ts";

/** Typed event map — eliminates stringly-typed emit/on/off calls. */
export interface TerminalEvents {
  data: [data: string];
  exit: [exitCode: number];
  cwd: [cwd: string];
}

interface TerminalBase {
  handle: PtyHandle;
  emitter: EventEmitter<TerminalEvents>;
  themeName?: string;
}

/** Server-side terminal state. Status discriminant derived from common TerminalInfo. */
export type TerminalEntry =
  | (TerminalBase & Pick<TerminalRunning, "status">)
  | (TerminalBase & Pick<TerminalExited, "status" | "exitCode">);

const terminals = new Map<TerminalId, TerminalEntry>();
let nextId = 1;

function toInfo(id: TerminalId, entry: TerminalEntry): TerminalInfo {
  const base = { id, pid: entry.handle.pid, themeName: entry.themeName };
  return entry.status === "exited"
    ? { ...base, status: "exited", exitCode: entry.exitCode }
    : { ...base, status: "running" };
}

/** Create a new terminal, spawn a PTY process. */
export function createTerminal(): TerminalInfo {
  const id = `term-${nextId++}`;
  const tlog = log.child({ terminal: id });
  const emitter = new EventEmitter<TerminalEvents>();

  const handle = spawnPty(tlog, {
    onData: (data) => emitter.emit("data", data),
    // On exit: transition entry to "exited" but keep it in the map (sidebar needs it)
    onExit: (exitCode) => {
      tlog.info({ exitCode }, "exited");
      const entry = terminals.get(id);
      if (entry) terminals.set(id, { ...entry, status: "exited", exitCode });
      emitter.emit("exit", exitCode);
    },
    onCwd: (cwd) => emitter.emit("cwd", cwd),
  });

  const entry: TerminalEntry = { handle, status: "running", emitter };
  terminals.set(id, entry);
  tlog.info({ pid: handle.pid, total: terminals.size }, "created");
  return toInfo(id, entry);
}

export function listTerminals(): TerminalInfo[] {
  const list = [...terminals.entries()].map(([id, entry]) => toInfo(id, entry));
  log.info({ count: list.length }, "terminal list");
  return list;
}

export function getTerminal(id: TerminalId): TerminalEntry | undefined {
  return terminals.get(id);
}

/** Kill a terminal's PTY process. Returns updated info, or undefined if not found. */
export function killTerminal(id: TerminalId): TerminalInfo | undefined {
  const entry = terminals.get(id);
  if (!entry) return undefined;

  log.child({ terminal: id }).info({ pid: entry.handle.pid }, "killing");
  entry.handle.dispose();
  const killed: TerminalEntry = {
    ...entry,
    status: "exited",
    exitCode: entry.status === "exited" ? entry.exitCode : -1,
  };
  terminals.set(id, killed);
  return toInfo(id, killed);
}

/** Set the theme name for a terminal. */
export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = terminals.get(id);
  if (entry) terminals.set(id, { ...entry, themeName });
}

/** Kill and remove all terminals. Used by tests to reset server state between scenarios. */
export function killAllTerminals(): void {
  log.info({ count: terminals.size }, "killing all terminals");
  for (const entry of terminals.values()) {
    if (entry.status === "running") entry.handle.dispose();
  }
  terminals.clear();
  nextId = 1;
}
