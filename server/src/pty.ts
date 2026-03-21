/**
 * Pure PTY lifecycle wrapper around node-pty.
 *
 * Transport-agnostic: communicates via onData/onExit callbacks.
 * Maintains a scrollback buffer for late-joining clients.
 */
import * as pty from "node-pty";
import { userInfo } from "node:os";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// Cap scrollback to prevent unbounded memory growth from long-running shells
const SCROLLBACK_LIMIT = 100 * 1024; // 100KB

export interface PtyHandle {
  /** OS process ID of the spawned shell. */
  readonly pid: number;
  /** Send input to the PTY (keystrokes, pasted text). */
  write(data: string): void;
  /** Resize the PTY grid. */
  resize(cols: number, rows: number): void;
  /** Concatenated scrollback buffer for replay on late-joining clients. */
  getScrollback(): Buffer;
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
    env.SHELL = userInfo().shell;
  }
  env.PATH = process.env.PATH ?? "/usr/bin:/bin";
  return env;
}

/** Spawn a shell in a PTY, calling back on data and exit. */
export function spawnPty(opts: {
  onData: (data: Buffer) => void;
  onExit: (exitCode: number) => void;
}): PtyHandle {
  const env = cleanEnv();
  const proc = pty.spawn(env.SHELL, [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: env.HOME || "/",
    env,
  });

  // Ring buffer: drops oldest chunks when over SCROLLBACK_LIMIT
  let scrollback: Buffer[] = [];
  let scrollbackSize = 0;

  const dataDisposable = proc.onData((data: string) => {
    const buf = Buffer.from(data, "utf-8");
    scrollback.push(buf);
    scrollbackSize += buf.length;
    while (scrollbackSize > SCROLLBACK_LIMIT && scrollback.length > 0) {
      scrollbackSize -= scrollback.shift()!.length;
    }
    opts.onData(buf);
  });

  const exitDisposable = proc.onExit(({ exitCode }) => {
    opts.onExit(exitCode);
  });

  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    getScrollback: () => Buffer.concat(scrollback),
    dispose() {
      dataDisposable.dispose();
      exitDisposable.dispose();
      proc.kill();
      scrollback = [];
      scrollbackSize = 0;
    },
  };
}
