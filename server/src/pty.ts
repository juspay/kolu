/**
 * Pure PTY lifecycle wrapper around node-pty.
 *
 * Transport-agnostic: communicates via onData/onExit callbacks.
 * Maintains a headless xterm instance for screen state serialization
 * on late-joining clients (~4KB vs raw scrollback replay).
 */
import * as pty from "node-pty";
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

/** Spawn a shell in a PTY, calling back on data, exit, CWD, and title changes. */
export function spawnPty(
  tlog: Logger,
  terminalId: string,
  opts: {
    onData: (data: string) => void;
    onExit: (exitCode: number) => void;
    onCwd?: (cwd: string) => void;
    /** Fired on OSC 0/2 title change — signals foreground process may have changed. */
    onTitleChange?: (title: string) => void;
    /** Fired when the preexec hook emits `OSC 633 ; E ; <cmd>` — the raw
     *  command line the user typed, before execution. Used to build the
     *  global recent-agents MRU. */
    onCommandRun?: (command: string) => void;
  },
  clipboard: { shimBinDir: string; clipboardDir: string },
  spawnCwd?: string,
): PtyHandle {
  const env = cleanEnv();
  const shell = env.SHELL ?? "/bin/sh";
  const cwd = spawnCwd || env.HOME || "/";

  // Inject clipboard shim dir into shell rc AFTER the user's rc —
  // NixOS rebuilds PATH during shell init, so env-level PATH gets lost.
  const osc7 = osc7Init({
    shell,
    home: env.HOME,
    terminalId,
    extraPath: clipboard.shimBinDir,
  });
  Object.assign(env, osc7.env);
  env.KOLU_CLIPBOARD_DIR = clipboard.clipboardDir;

  tlog.debug({ shell, cwd }, "spawning pty");
  const proc = pty.spawn(shell, osc7.args, {
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

  // OSC 0/2 title changes signal that the foreground process may have changed.
  // The shell preexec hook (injected in shell.ts) emits OSC 2 before each command.
  const titleDisposable = headless.onTitleChange((title: string) => {
    tlog.debug({ title }, "title changed (OSC 0/2)");
    opts.onTitleChange?.(title);
  });

  // OSC 633 ; E ; <command>  — VS Code's semantic "exact command line"
  // sequence, emitted by kolu's preexec hook alongside OSC 2. The payload
  // arrives as "E;<command>"; we accept only the E sub-code and ignore
  // any other 633;X payloads so future VS Code sequences (A/B/C/D) pass
  // through untouched.
  const commandMarkDisposable = headless.parser.registerOscHandler(
    633,
    (data: string) => {
      if (!data.startsWith("E;")) return false;
      const command = data.slice(2);
      tlog.info({ command }, "command run (OSC 633;E)");
      opts.onCommandRun?.(command);
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
      dataDisposable.dispose();
      exitDisposable.dispose();
      proc.kill();
      headless.dispose();
      osc7.cleanup();
    },
  };
}
