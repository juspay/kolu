/**
 * Pure PTY lifecycle wrapper using Bun.Terminal.
 *
 * Transport-agnostic: communicates via onData/onExit callbacks.
 * Maintains a headless xterm instance for screen state serialization
 * on late-joining clients (~4KB vs raw scrollback replay).
 */
import { createRequire } from "node:module";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_SCROLLBACK,
} from "kolu-common/config";
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
  /** Plain text content of the terminal buffer (scrollback + viewport). */
  getScreenText(startLine?: number, endLine?: number): string;
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

  // Headless terminal parses PTY output into screen state for serialization.
  // allowProposedApi is required for SerializeAddon to access the buffer.
  const headless = new Terminal({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    scrollback: DEFAULT_SCROLLBACK,
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

  // Streaming decoder — handles multi-byte UTF-8 sequences split across chunks
  const decoder = new TextDecoder();

  const proc = Bun.spawn([shell, ...osc7.args], {
    cwd,
    env,
    terminal: {
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      name: "xterm-256color",
      data(_terminal: unknown, chunk: Uint8Array) {
        const str = decoder.decode(chunk, { stream: true });
        headless.write(str);
        opts.onData(str);
      },
      exit(_terminal: unknown, _exitCode: number) {
        // Bun.Terminal exit code is PTY lifecycle (0=EOF, 1=error),
        // not the subprocess exit code. Use proc.exited for that.
      },
    },
  });
  // Always defined when spawned with the terminal option
  const terminal = proc.terminal!;
  tlog.info({ pid: proc.pid }, "pty spawned");

  // Forward device query responses (DA1/DSR) from headless terminal back to
  // the PTY. TUIs like Yazi probe terminal capabilities at startup — the
  // headless terminal responds immediately, avoiding latency from the client.
  // Filter out OSC responses (e.g. OSC 10/11/12 color queries) — programs
  // don't consume these, so the shell echoes them as visible garbage.
  const headlessOnDataDisposable = headless.onData((data: string) => {
    if (data.startsWith("\x1b]")) return;
    terminal.write(data);
  });

  // Watch for subprocess exit to get the real exit code.
  // Catch rejection so abnormal termination doesn't become an unhandled promise.
  proc.exited.then(
    (code) => opts.onExit(code),
    () => opts.onExit(1),
  );

  return {
    pid: proc.pid,
    get cwd() {
      return currentCwd;
    },
    write: (data) => terminal.write(data),
    resize: (cols, rows) => {
      terminal.resize(cols, rows);
      headless.resize(cols, rows);
    },
    getScreenState: () => serializeAddon.serialize(),
    getScreenText: (startLine?: number, endLine?: number) => {
      const buf = headless.buffer.active;
      const start = Math.max(0, startLine ?? 0);
      const end = Math.min(buf.length, endLine ?? buf.length);
      const lines: string[] = [];
      for (let i = start; i < end; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      return lines.join("\n");
    },
    dispose() {
      oscDisposable.dispose();
      headlessOnDataDisposable.dispose();
      terminal.close();
      headless.dispose();
      osc7.cleanup();
    },
  };
}
