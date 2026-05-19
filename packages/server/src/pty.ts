/**
 * Pure PTY lifecycle wrapper around node-pty.
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
import * as pty from "node-pty";
import pkg from "../package.json" with { type: "json" };
import type { Logger } from "./log.ts";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "./shell.ts";

// @xterm packages ship CJS only — use createRequire for clean ESM interop
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

/** Extract plain text from an xterm buffer within a line range. */
export function getScreenText(
  buffer: {
    length: number;
    getLine(
      i: number,
    ): { translateToString(trimRight: boolean): string } | undefined;
  },
  startLine?: number,
  endLine?: number,
): string {
  const start = Math.max(0, startLine ?? 0);
  const end = Math.min(buffer.length, endLine ?? buffer.length);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

export interface PtyHandle {
  /** OS process ID of the spawned shell. */
  readonly pid: number;
  /** Current working directory (from OSC 7), initially $HOME. */
  readonly cwd: string;
  /** Current foreground process name (from node-pty). */
  readonly process: string;
  /**
   * Pid of the pty's current foreground process group leader (from
   * tcgetpgrp(3)), or `undefined` if not yet set. Used by metadata
   * providers to identify which process is running in the terminal.
   */
  readonly foregroundPid: number | undefined;
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

export interface PtyCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
  onCwd?: (cwd: string) => void;
  /** Fired on OSC 0/2 title change — signals foreground process may have changed. */
  onTitleChange?: (title: string) => void;
  /** Fired when the preexec hook emits `OSC 633 ; E ; <cmd>`. */
  onCommandRun?: (command: string) => void;
}

export interface PtyScreen {
  writeOutput(data: string): void;
  resize(cols: number, rows: number): void;
  getScreenState(): string;
  getScreenText(startLine?: number, endLine?: number): string;
  dispose(): void;
}

/** Shared headless-xterm sidecar for local and remote PTY output. */
export function createPtyScreen(
  tlog: Logger,
  opts: Omit<PtyCallbacks, "onExit">,
  writeBack: (data: string) => void,
): PtyScreen {
  const headless = new Terminal({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    scrollback: DEFAULT_SCROLLBACK,
    allowProposedApi: true,
  });
  const serializeAddon = new SerializeAddon();
  headless.loadAddon(serializeAddon);

  const oscDisposable = headless.parser.registerOscHandler(
    7,
    (data: string) => {
      try {
        const url = new URL(data);
        if (url.protocol === "file:") {
          const cwd = decodeURIComponent(url.pathname);
          tlog.debug({ cwd }, "cwd changed (OSC 7)");
          opts.onCwd?.(cwd);
        }
      } catch {
        // Ignore malformed OSC 7 data.
      }
      return true;
    },
  );

  const titleDisposable = headless.onTitleChange((title: string) => {
    tlog.debug({ title }, "title changed (OSC 0/2)");
    opts.onTitleChange?.(title);
  });

  const commandMarkDisposable = headless.parser.registerOscHandler(
    633,
    (data: string) => {
      if (!data.startsWith("E;")) return false;
      const command = data.slice(2);
      tlog.debug({ command }, "command run (OSC 633;E)");
      opts.onCommandRun?.(command);
      return true;
    },
  );

  const headlessOnDataDisposable = headless.onData((data: string) => {
    if (data.startsWith("\x1b]")) return;
    writeBack(data);
  });

  return {
    writeOutput(data: string) {
      headless.write(data);
      opts.onData(data);
    },
    resize(cols: number, rows: number) {
      headless.resize(cols, rows);
    },
    getScreenState: () => serializeAddon.serialize(),
    getScreenText: (startLine?: number, endLine?: number) =>
      getScreenText(headless.buffer.active, startLine, endLine),
    dispose() {
      oscDisposable.dispose();
      titleDisposable.dispose();
      commandMarkDisposable.dispose();
      headlessOnDataDisposable.dispose();
      headless.dispose();
    },
  };
}

/** Spawn a shell in a PTY, calling back on data, exit, CWD, and title changes. */
export function spawnPty(
  tlog: Logger,
  terminalId: string,
  opts: PtyCallbacks,
  spawnCwd?: string,
): PtyHandle {
  // Env layering, ordered from least to most authoritative:
  //   1. cleanEnv()         — parent env passthrough (Nix devshell filtering).
  //   2. koluIdentityEnv()  — Kolu's identity (TERM_PROGRAM, version,
  //                           VTE_VERSION); unconditionally stomps whatever
  //                           the parent had.
  //   3. shellInit.env      — per-PTY overrides (e.g. ZDOTDIR for zsh).
  const env = cleanEnv();
  const shell = env.SHELL ?? "/bin/sh";
  const cwd = spawnCwd || env.HOME || "/";

  Object.assign(env, koluIdentityEnv(pkg.version));

  const shellInit = prepareShellInit({
    shell,
    home: env.HOME,
    terminalId,
  });
  Object.assign(env, shellInit.env);

  tlog.debug({ shell, cwd }, "spawning pty");
  const proc = pty.spawn(shell, shellInit.args, {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env,
  });
  tlog.debug({ pid: proc.pid }, "pty spawned");

  // Sanity-check the node-pty fork's foregroundPid accessor — if upstream
  // changes drop it, fail loud here instead of silently breaking claude
  // detection. The accessor returns 0 momentarily before the child finishes
  // setsid, so any number (including 0) means the property exists.
  if (
    typeof (proc as unknown as { foregroundPid?: unknown }).foregroundPid !==
    "number"
  ) {
    throw new Error(
      "node-pty.foregroundPid accessor missing — fork patch may have regressed",
    );
  }

  let currentCwd = cwd;
  const screen = createPtyScreen(
    tlog,
    {
      ...opts,
      onCwd: (newCwd) => {
        currentCwd = newCwd;
        opts.onCwd?.(newCwd);
      },
    },
    (data) => proc.write(data),
  );

  const dataDisposable = proc.onData((data: string) => {
    screen.writeOutput(data);
  });

  const exitDisposable = proc.onExit(({ exitCode }) => opts.onExit(exitCode));

  return {
    pid: proc.pid,
    get cwd() {
      return currentCwd;
    },
    get process() {
      return proc.process;
    },
    get foregroundPid() {
      // node-pty's IPty type doesn't expose this; the UnixTerminal class does.
      // tcgetpgrp can return 0 momentarily before the child finishes setsid —
      // collapse that to undefined so callers don't have to special-case it.
      const pid = (proc as unknown as { foregroundPid?: number }).foregroundPid;
      return pid && pid > 0 ? pid : undefined;
    },
    write: (data) => proc.write(data),
    resize: (cols, rows) => {
      proc.resize(cols, rows);
      screen.resize(cols, rows);
    },
    getScreenState: () => screen.getScreenState(),
    getScreenText: (startLine?: number, endLine?: number) =>
      screen.getScreenText(startLine, endLine),
    dispose() {
      dataDisposable.dispose();
      exitDisposable.dispose();
      proc.kill();
      screen.dispose();
      shellInit.cleanup();
    },
  };
}
