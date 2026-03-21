/**
 * Pure PTY lifecycle wrapper around node-pty.
 *
 * Transport-agnostic: communicates via onData/onExit callbacks.
 * Maintains a headless xterm instance for screen state serialization
 * on late-joining clients (~4KB vs raw scrollback replay).
 */
import * as pty from "node-pty";
import { userInfo } from "node:os";
import { createRequire } from "node:module";

// @xterm packages ship CJS only — use createRequire for clean ESM interop
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

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

/** Env vars safe to forward to the PTY shell. */
const KEEP_ENV = [
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "DISPLAY",
  "COLORTERM",
  "TERM_PROGRAM",
] as const;

/**
 * Build a minimal env for the PTY shell.
 *
 * The server may run inside nix/direnv which pollutes the env with
 * NIX_*, DIRENV_*, BASH_ENV, etc. — these break the user's shell
 * (wrong PS1, shopt errors, direnv unloading). We only forward the
 * essentials so the spawned shell starts clean.
 */
function cleanEnv(): Record<string, string> {
  const env = Object.fromEntries(
    KEEP_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])),
  );
  // nix devshells (via direnv/nix-direnv or nix develop) set SHELL to
  // /nix/store/.../bash-5.3 which removed the `progcomp` shopt option —
  // the user's .bashrc errors on `shopt -s progcomp`.
  // userInfo().shell reads from getpwuid(3) — the OS login shell, not $SHELL.
  if (env.SHELL?.startsWith("/nix/store")) {
    env.SHELL = userInfo().shell ?? "/bin/sh";
  }
  env.PATH = process.env.PATH ?? "/usr/bin:/bin";
  return env;
}

/** Spawn a shell in a PTY, calling back on data and exit. */
export function spawnPty(opts: {
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}): PtyHandle {
  const env = cleanEnv();
  const shell = env.SHELL ?? "/bin/sh";
  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: env.HOME || "/",
    env,
  });

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
    if (data) proc.write(data);
  });

  const dataDisposable = proc.onData((data: string) => {
    headless.write(data);
    opts.onData(data);
  });

  const exitDisposable = proc.onExit(({ exitCode }) => {
    opts.onExit(exitCode);
  });

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
