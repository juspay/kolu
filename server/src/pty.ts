/**
 * Pure PTY lifecycle wrapper around node-pty.
 *
 * Transport-agnostic: communicates via onData/onExit callbacks.
 * Maintains a headless xterm instance for screen state serialization
 * on late-joining clients (~4KB vs raw scrollback replay).
 */
import * as pty from "node-pty";
import { createRequire } from "node:module";
import { DEFAULT_COLS, DEFAULT_ROWS } from "kolu-common/config";
import { cleanEnv } from "./shell.ts";
import type { Logger } from "./log.ts";

// @xterm packages ship CJS only — use createRequire for clean ESM interop
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

export interface PtyHandle {
  /** OS process ID of the spawned shell. */
  readonly pid: number;
  /** Send input to the PTY (keystrokes, pasted text). */
  write(data: string): void;
  /** Resize the PTY grid. */
  resize(cols: number, rows: number): void;
  /** Serialized screen state (VT escape sequences) for late-joining clients. */
  getScreenState(): string;
  /** Kill the PTY process and release resources. */
  dispose(): void;
}

/** Spawn a shell in a PTY, calling back on data and exit. */
export function spawnPty(opts: {
  log: Logger;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}): PtyHandle {
  const env = cleanEnv();
  const shell = env.SHELL ?? "/bin/sh";
  const cwd = env.HOME || "/";
  opts.log.info({ shell, cwd }, "spawning pty");
  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env,
  });
  opts.log.info({ pid: proc.pid }, "pty spawned");

  // Headless terminal parses PTY output into screen state for serialization.
  // allowProposedApi is required for SerializeAddon to access the buffer.
  const headless = new Terminal({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    allowProposedApi: true,
  });
  const serializeAddon = new SerializeAddon();
  headless.loadAddon(serializeAddon);

  // Forward device query responses (DA1/DSR) from headless terminal back to
  // the PTY. TUIs like Yazi probe terminal capabilities at startup — the
  // headless terminal responds immediately, avoiding latency from the client.
  const headlessOnDataDisposable = headless.onData((data: string) => {
    proc.write(data);
  });

  const dataDisposable = proc.onData((data: string) => {
    headless.write(data);
    opts.onData(data);
  });

  const exitDisposable = proc.onExit(({ exitCode }) => opts.onExit(exitCode));

  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (cols, rows) => {
      proc.resize(cols, rows);
      headless.resize(cols, rows);
    },
    getScreenState: () => serializeAddon.serialize(),
    dispose() {
      headlessOnDataDisposable.dispose();
      dataDisposable.dispose();
      exitDisposable.dispose();
      proc.kill();
      headless.dispose();
    },
  };
}
