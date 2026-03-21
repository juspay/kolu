/**
 * Terminal registry: manages PTY lifecycle and tracks terminal state.
 *
 * Plain Map + exported functions (no class). Each entry owns its PtyHandle.
 * On PTY exit: entry stays with "exited" status (sidebar needs it).
 */
import { spawnPty, type PtyHandle } from "./pty.ts";
import type { TerminalId, TerminalInfo } from "kolu-common";
import { EventEmitter } from "node:events";

/** Discriminated union: exitCode only exists when exited. */
export type TerminalEntry =
  | { status: "running"; handle: PtyHandle; emitter: EventEmitter }
  | {
      status: "exited";
      handle: PtyHandle;
      emitter: EventEmitter;
      exitCode: number;
    };

const terminals = new Map<TerminalId, TerminalEntry>();
let nextId = 1;

/** Build a TerminalInfo from an entry. */
function toInfo(id: TerminalId, entry: TerminalEntry): TerminalInfo {
  return {
    id,
    pid: entry.handle.pid,
    status: entry.status,
    exitCode: entry.status === "exited" ? entry.exitCode : undefined,
  };
}

/** Create a new terminal, spawn a PTY process. */
export function createTerminal(): TerminalInfo {
  const id = `term-${nextId++}`;
  const emitter = new EventEmitter();

  const handle = spawnPty({
    onData: (data) => emitter.emit("data", data.toString("utf-8")),
    onExit: (exitCode) => {
      const entry = terminals.get(id);
      if (entry) {
        terminals.set(id, {
          ...entry,
          status: "exited",
          exitCode,
        });
      }
      emitter.emit("exit", exitCode);
    },
  });

  const entry: TerminalEntry = { handle, status: "running", emitter };
  terminals.set(id, entry);

  return toInfo(id, entry);
}

/** List all terminals. */
export function listTerminals(): TerminalInfo[] {
  return Array.from(terminals.entries()).map(([id, entry]) =>
    toInfo(id, entry),
  );
}

/** Get a terminal entry by ID, or undefined if not found. */
export function getTerminal(id: TerminalId): TerminalEntry | undefined {
  return terminals.get(id);
}

/** Kill a terminal's PTY process. Returns updated info, or undefined if not found. */
export function killTerminal(id: TerminalId): TerminalInfo | undefined {
  const entry = terminals.get(id);
  if (!entry) return undefined;

  entry.handle.dispose();
  const killed: TerminalEntry = {
    ...entry,
    status: "exited",
    exitCode: entry.status === "exited" ? entry.exitCode : -1,
  };
  terminals.set(id, killed);

  return toInfo(id, killed);
}
