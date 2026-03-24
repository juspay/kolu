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
import { cleanEnv, osc7Init } from "./shell.ts";
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
  /** Current working directory (from OSC 7), initially $HOME. */
  readonly cwd: string;
  /** Send input to the PTY (keystrokes, pasted text). */
  write(data: string): void;
  /** Resize the PTY grid. */
  resize(cols: number, rows: number): void;
  /** Serialized screen state (VT escape sequences) for late-joining clients. */
  getScreenState(): string;
  /** Kill the PTY process and release resources. */
  dispose(): void;
}

/** Spawn a shell in a PTY, calling back on data, exit, and CWD changes. */
export function spawnPty(
  tlog: Logger,
  opts: {
    onData: (data: string) => void;
    onExit: (exitCode: number) => void;
    onCwd?: (cwd: string) => void;
  },
  clipboard: { shimBinDir: string; clipboardDir: string },
  spawnCwd?: string,
): PtyHandle {
  const env = cleanEnv();
  const shell = env.SHELL ?? "/bin/sh";
  const cwd = spawnCwd || env.HOME || "/";

  // Inject clipboard shim dir into shell rc AFTER the user's rc —
  // NixOS rebuilds PATH during shell init, so env-level PATH gets lost.
  const osc7 = osc7Init(shell, env.HOME, clipboard.shimBinDir);
  Object.assign(env, osc7.env);
  env.KOLU_CLIPBOARD_DIR = clipboard.clipboardDir;

  tlog.info({ shell, cwd }, "spawning pty");
  const proc = pty.spawn(shell, osc7.args, {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env,
  });
  tlog.info({ pid: proc.pid }, "pty spawned");

  // Headless terminal parses PTY output into screen state for serialization.
  // allowProposedApi is required for SerializeAddon to access the buffer.
  const headless = new Terminal({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    allowProposedApi: true,
  });
  const serializeAddon = new SerializeAddon();
  headless.loadAddon(serializeAddon);

  // Parse OSC 7 (CWD reporting) from headless terminal output.
  // The rc wrapper injected above ensures the shell emits these sequences.
  let currentCwd = cwd;
  const oscDisposable = headless.parser.registerOscHandler(
    7,
    (data: string) => {
      try {
        const url = new URL(data);
        if (url.protocol === "file:") {
          currentCwd = decodeURIComponent(url.pathname);
          tlog.debug({ cwd: currentCwd }, "cwd changed (OSC 7)");
          opts.onCwd?.(currentCwd);
        }
      } catch {
        // Ignore malformed OSC 7 data
      }
      return true;
    },
  );

  // Forward device query responses (DA1/DSR) from headless terminal back to
  // the PTY. TUIs like Yazi probe terminal capabilities at startup — the
  // headless terminal responds immediately, avoiding latency from the client.
  // Filter out OSC responses (e.g. OSC 10/11/12 color queries) — programs
  // don't consume these, so the shell echoes them as visible garbage.
  const headlessOnDataDisposable = headless.onData((data: string) => {
    if (data.startsWith("\x1b]")) return;
    proc.write(data);
  });

  const dataDisposable = proc.onData((data: string) => {
    headless.write(data);
    opts.onData(data);
  });

  const exitDisposable = proc.onExit(({ exitCode }) => opts.onExit(exitCode));

  return {
    pid: proc.pid,
    get cwd() {
      return currentCwd;
    },
    write: (data) => proc.write(data),
    resize: (cols, rows) => {
      proc.resize(cols, rows);
      headless.resize(cols, rows);
    },
    getScreenState: () => serializeAddon.serialize(),
    dispose() {
      oscDisposable.dispose();
      headlessOnDataDisposable.dispose();
      dataDisposable.dispose();
      exitDisposable.dispose();
      proc.kill();
      headless.dispose();
      osc7.cleanup();
    },
  };
}
