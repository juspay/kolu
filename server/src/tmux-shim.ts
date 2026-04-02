#!/usr/bin/env node
/**
 * kolu-tmux: tmux compatibility shim for AI tool integration.
 *
 * Translates the subset of tmux commands used by Claude Code's TmuxBackend
 * into Kolu HTTP RPC calls. Enables Claude Code teammate/swarm features
 * inside Kolu terminals with zero configuration.
 *
 * Environment:
 *   KOLU_PORT  — Kolu server port (default: 7681)
 *   TMUX_PANE  — Synthetic pane ID for the calling terminal (e.g. %0)
 */

import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Config ---

const KOLU_PORT = process.env.KOLU_PORT || "7681";
const BASE_URL = `http://127.0.0.1:${KOLU_PORT}`;
const FAKE_VERSION = "kolu-tmux 3.4";
const SESSION_NAME = "kolu";

// --- RPC helpers ---

async function rpc<T>(
  method: string,
  input?: Record<string, unknown>,
): Promise<T> {
  const url = `${BASE_URL}/rpc/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input ?? {} }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.json as T;
}

interface TerminalInfo {
  id: string;
  pid: number;
  /** Synthetic tmux pane index (%N in $TMUX_PANE). Monotonic, never reused. */
  tmuxPaneIndex: number;
  meta: {
    cwd: string;
    parentId?: string;
    sortOrder: number;
    git: { repoName: string; branch: string } | null;
    themeName?: string;
  };
}

/** Fetch all terminals from the server (non-streaming snapshot endpoint). */
async function listAllTerminals(): Promise<TerminalInfo[]> {
  const url = `${BASE_URL}/api/terminals`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return (await res.json()) as TerminalInfo[];
}

// --- Terminal list helpers ---

/** Top-level terminals (no parent) sorted by sortOrder. These map to tmux "windows". */
function topLevel(all: TerminalInfo[]): TerminalInfo[] {
  return all
    .filter((t) => !t.meta.parentId)
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
}

/** Children of a given parent, sorted by sortOrder. These map to tmux "panes". */
function children(all: TerminalInfo[], parentId: string): TerminalInfo[] {
  return all
    .filter((t) => t.meta.parentId === parentId)
    .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
}

/** Build pane index → terminal map using the server-assigned tmuxPaneIndex. */
function buildPaneMap(all: TerminalInfo[]): Map<number, TerminalInfo> {
  const map = new Map<number, TerminalInfo>();
  for (const t of all) {
    map.set(t.tmuxPaneIndex, t);
  }
  return map;
}

/** Resolve %N pane ID to terminal UUID. */
function paneIdToIndex(paneId: string): number {
  if (paneId.startsWith("%")) return parseInt(paneId.slice(1), 10);
  return parseInt(paneId, 10);
}

/** Resolve a tmux target (-t) to a terminal. Supports %N, bare index, session:window.pane. */
function resolveTarget(
  target: string | undefined,
  all: TerminalInfo[],
): TerminalInfo | undefined {
  const paneMap = buildPaneMap(all);

  if (!target) {
    // Use $TMUX_PANE from env — fail if unset (every Kolu PTY has TMUX_PANE)
    const envPane = process.env.TMUX_PANE;
    if (envPane) {
      return paneMap.get(paneIdToIndex(envPane));
    }
    return undefined;
  }

  // %N pane ID
  if (target.startsWith("%")) {
    return paneMap.get(paneIdToIndex(target));
  }

  // session:window.pane format
  const dotIdx = target.lastIndexOf(".");
  if (dotIdx !== -1) {
    const paneStr = target.slice(dotIdx + 1);
    if (paneStr.startsWith("%")) {
      return paneMap.get(paneIdToIndex(paneStr));
    }
    // Numeric pane within a window
    const colonIdx = target.indexOf(":");
    const windowStr =
      colonIdx !== -1
        ? target.slice(colonIdx + 1, dotIdx)
        : target.slice(0, dotIdx);
    const windowIdx = parseInt(windowStr, 10);
    const paneIdx = parseInt(paneStr, 10);
    const tops = topLevel(all);
    const win = tops[windowIdx];
    if (!win) return undefined;
    const panes = [win, ...children(all, win.id)];
    return panes[paneIdx];
  }

  // session:window format (target the window itself = first pane)
  const colonIdx = target.indexOf(":");
  if (colonIdx !== -1) {
    const windowStr = target.slice(colonIdx + 1);
    const windowIdx = parseInt(windowStr, 10);
    const tops = topLevel(all);
    return tops[windowIdx];
  }

  // Bare numeric index — treat as pane index
  const idx = parseInt(target, 10);
  if (!isNaN(idx)) return paneMap.get(idx);

  return undefined;
}

// --- Format string evaluator ---

function evalFormat(
  fmt: string,
  terminal: TerminalInfo,
  all: TerminalInfo[],
): string {
  const paneMap = buildPaneMap(all);
  const tops = topLevel(all);

  const paneIndex = terminal.tmuxPaneIndex;

  // Find window index (parent's position in top-level, or own position if top-level)
  const parentId = terminal.meta.parentId;
  const windowTerminal = parentId
    ? all.find((t) => t.id === parentId)
    : terminal;
  const windowIndex = windowTerminal
    ? tops.findIndex((t) => t.id === windowTerminal.id)
    : 0;

  // Is this the active pane? (first in its window)
  const windowId = parentId || terminal.id;
  const windowPanes = [
    all.find((t) => t.id === windowId),
    ...children(all, windowId),
  ].filter(Boolean) as TerminalInfo[];
  const isActive = windowPanes[0]?.id === terminal.id ? "1" : "0";

  const vars: Record<string, string> = {
    session_name: SESSION_NAME,
    session_id: "$0",
    window_index: String(Math.max(0, windowIndex)),
    window_id: `@${Math.max(0, windowIndex)}`,
    window_name:
      terminal.meta.git?.repoName ||
      terminal.meta.cwd.split("/").pop() ||
      "shell",
    window_active: isActive,
    window_width: "80",
    window_height: "24",
    pane_id: `%${paneIndex}`,
    pane_index: String(paneIndex),
    pane_pid: String(terminal.pid),
    pane_current_path: terminal.meta.cwd,
    pane_active: isActive,
    pane_width: "80",
    pane_height: "24",
    pane_title: terminal.meta.cwd.split("/").pop() || "shell",
    pane_current_command: "bash",
    window_panes: String(windowPanes.length),
  };

  return fmt.replace(/#\{([^}]+)\}/g, (_match, varName: string) => {
    return vars[varName] ?? "";
  });
}

// --- Argument parsing ---

/** Flags that take a subsequent value argument (shared across all tmux subcommands). */
const VALUED_FLAGS = new Set([
  "-t",
  "-F",
  "-c",
  "-s",
  "-n",
  "-x",
  "-y",
  "-S",
  "-E",
  "-L",
]);

function parseArgs(args: string[]): {
  flags: Record<string, string | true>;
  positional: string[];
} {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      // Handle combined short flags like -hp
      if (arg.length > 2 && !arg.startsWith("--") && !VALUED_FLAGS.has(arg)) {
        // Split into individual flags, last one may take a value
        for (let j = 1; j < arg.length; j++) {
          const flag = `-${arg[j]}`;
          if (
            j === arg.length - 1 &&
            VALUED_FLAGS.has(flag) &&
            i + 1 < args.length
          ) {
            flags[flag] = args[++i]!;
          } else {
            flags[flag] = true;
          }
        }
        continue;
      }
      if (VALUED_FLAGS.has(arg) && i + 1 < args.length) {
        flags[arg] = args[++i]!;
      } else {
        flags[arg] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

// --- Command handlers ---

async function cmdVersion(): Promise<void> {
  console.log(FAKE_VERSION);
}

async function cmdHasSession(_args: string[]): Promise<void> {
  // Always succeeds — Kolu is always "in session"
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) process.exit(1);
  } catch {
    process.exit(1);
  }
}

async function cmdListSessions(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const fmt = flags["-F"] as string | undefined;

  if (fmt) {
    const all = await listAllTerminals();
    // Create a dummy terminal for format evaluation at session level
    const first = all[0];
    if (first) {
      console.log(evalFormat(fmt, first, all));
    } else {
      console.log(
        evalFormat(
          fmt,
          { id: "", pid: 0, meta: { cwd: "/", sortOrder: 0, git: null } },
          [],
        ),
      );
    }
  } else {
    console.log(
      `${SESSION_NAME}: 1 windows (created Mon Jan  1 00:00:00 2024)`,
    );
  }
}

async function cmdListWindows(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const fmt = flags["-F"] as string | undefined;
  const all = await listAllTerminals();
  const tops = topLevel(all);

  for (const win of tops) {
    if (fmt) {
      console.log(evalFormat(fmt, win, all));
    } else {
      const idx = tops.indexOf(win);
      const name =
        win.meta.git?.repoName || win.meta.cwd.split("/").pop() || "shell";
      console.log(`${idx}: ${name} (1 panes)`);
    }
  }
}

async function cmdListPanes(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const fmt = flags["-F"] as string | undefined;
  const target = flags["-t"] as string | undefined;
  const allFlag = flags["-a"];
  const all = await listAllTerminals();

  let panes: TerminalInfo[];

  if (allFlag) {
    // List all panes across all windows
    panes = [...all].sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  } else if (target) {
    // List panes in the targeted window
    const win = resolveTarget(target, all);
    if (!win) {
      process.stderr.write(`can't find window: ${target}\n`);
      process.exit(1);
    }
    const winId = win.meta.parentId || win.id;
    panes = [all.find((t) => t.id === winId), ...children(all, winId)].filter(
      (t): t is TerminalInfo => t != null,
    );
  } else {
    // List panes in the current window (from $TMUX_PANE)
    const current = resolveTarget(undefined, all);
    if (current) {
      const winId = current.meta.parentId || current.id;
      panes = [all.find((t) => t.id === winId), ...children(all, winId)].filter(
        (t): t is TerminalInfo => t != null,
      );
    } else {
      panes = all;
    }
  }

  for (const pane of panes) {
    if (fmt) {
      console.log(evalFormat(fmt, pane, all));
    } else {
      console.log(`%${pane.tmuxPaneIndex}: [80x24] ${pane.meta.cwd}`);
    }
  }
}

async function cmdSplitWindow(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const target = flags["-t"] as string | undefined;
  const cwd = flags["-c"] as string | undefined;
  const printFmt = flags["-F"] as string | undefined;
  const printInfo = flags["-P"]; // -P = print new pane info
  // -h, -v, -b, -d are accepted but ignored (Kolu sub-terminals are tabs, not spatial splits)

  const all = await listAllTerminals();

  // Determine parent: explicit target, or $TMUX_PANE
  let parentId: string | undefined;
  if (target) {
    const parent = resolveTarget(target, all);
    if (parent) {
      // If target is a child, use its parent (split within same window)
      parentId = parent.meta.parentId || parent.id;
    }
  } else {
    const current = resolveTarget(undefined, all);
    if (current) {
      parentId = current.meta.parentId || current.id;
    }
  }

  const created = await rpc<TerminalInfo>("terminal/create", {
    cwd: cwd || undefined,
    parentId,
  });

  if (printFmt || printInfo) {
    const updatedAll = await listAllTerminals();
    const fmt = printFmt || "#{session_name}:#{window_index}.#{pane_index}";
    console.log(evalFormat(fmt, created, updatedAll));
  }
}

async function cmdSendKeys(args: string[]): Promise<void> {
  const { flags, positional } = parseArgs(args);
  const target = flags["-t"] as string | undefined;
  const literal = flags["-l"];

  const all = await listAllTerminals();
  const term = resolveTarget(target, all);
  if (!term) {
    process.stderr.write(`can't find pane: ${target || "$TMUX_PANE"}\n`);
    process.exit(1);
  }

  let data: string;
  if (literal) {
    data = positional.join(" ");
  } else {
    // Special key map (case-insensitive matching, per tmux spec)
    const specialKey = (token: string): string | undefined => {
      switch (token.toLowerCase()) {
        case "enter":
        case "c-m":
        case "kpenter":
          return "\r";
        case "tab":
        case "c-i":
          return "\t";
        case "space":
          return " ";
        case "bspace":
        case "backspace":
          return "\x7f";
        case "escape":
        case "esc":
        case "c-[":
          return "\x1b";
        case "c-c":
          return "\x03";
        case "c-d":
          return "\x04";
        case "c-z":
          return "\x1a";
        case "c-l":
          return "\x0c";
        default:
          return undefined;
      }
    };

    // Non-special tokens are joined with spaces; special keys consume surrounding spaces
    let result = "";
    let pendingSpace = false;
    for (const token of positional) {
      const special = specialKey(token);
      if (special !== undefined) {
        result += special;
        pendingSpace = false;
        continue;
      }
      if (pendingSpace) result += " ";
      result += token;
      pendingSpace = true;
    }
    data = result;
  }

  await rpc("terminal/sendInput", { id: term.id, data });
}

async function cmdCapturePane(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const target = flags["-t"] as string | undefined;
  const startLine = flags["-S"] as string | undefined;
  const endLine = flags["-E"] as string | undefined;
  // -p flag means print to stdout (always do this)
  // -J flag means join wrapped lines (we always do this)

  const all = await listAllTerminals();
  const term = resolveTarget(target, all);
  if (!term) {
    process.stderr.write(`can't find pane: ${target || "$TMUX_PANE"}\n`);
    process.exit(1);
  }

  const input: Record<string, unknown> = { id: term.id };
  if (startLine !== undefined) {
    const n = parseInt(startLine, 10);
    if (!isNaN(n)) input.startLine = Math.max(0, n);
  }
  if (endLine !== undefined) {
    const n = parseInt(endLine, 10);
    if (!isNaN(n)) input.endLine = n;
  }

  const text = await rpc<string>("terminal/screenText", input);
  console.log(text);
}

async function cmdKillPane(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const target = flags["-t"] as string | undefined;

  const all = await listAllTerminals();
  const term = resolveTarget(target, all);
  if (!term) {
    process.stderr.write(`can't find pane: ${target || "$TMUX_PANE"}\n`);
    process.exit(1);
  }

  await rpc("terminal/kill", { id: term.id });
}

async function cmdDisplayMessage(args: string[]): Promise<void> {
  const { flags, positional } = parseArgs(args);
  const target = flags["-t"] as string | undefined;
  // -p means print to stdout — we always do, so it's accepted but not checked
  const fmt = positional[0] || (flags["-F"] as string) || "";

  const all = await listAllTerminals();
  const term = resolveTarget(target, all);
  if (!term) {
    // Fallback: use first terminal
    const first = all[0];
    if (first) {
      console.log(evalFormat(fmt, first, all));
    }
    return;
  }

  console.log(evalFormat(fmt, term, all));
}

async function cmdNewSession(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const cwd = flags["-c"] as string | undefined;
  // -s (session name) is ignored — Kolu is always one session

  await rpc<TerminalInfo>("terminal/create", { cwd: cwd || undefined });
  console.log(SESSION_NAME);
}

async function cmdNewWindow(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const cwd = flags["-c"] as string | undefined;
  const printFmt = flags["-F"] as string | undefined;
  // -t (target session) is ignored — single session

  const created = await rpc<TerminalInfo>("terminal/create", {
    cwd: cwd || undefined,
  });

  if (printFmt) {
    const all = await listAllTerminals();
    console.log(evalFormat(printFmt, created, all));
  }
}

async function cmdResizePane(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const target = flags["-t"] as string | undefined;
  const width = flags["-x"] as string | undefined;
  const height = flags["-y"] as string | undefined;

  if (!width && !height) return; // Nothing to resize

  const all = await listAllTerminals();
  const term = resolveTarget(target, all);
  if (!term) return;

  await rpc("terminal/resize", {
    id: term.id,
    cols: width ? parseInt(width, 10) : 80,
    rows: height ? parseInt(height, 10) : 24,
  });
}

async function cmdSelectPane(args: string[]): Promise<void> {
  // Claude Code uses select-pane with -P "bg=..." for styling — no-op in Kolu
}

async function cmdBreakPane(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const target = flags["-t"] as string | undefined;

  const all = await listAllTerminals();
  const term = resolveTarget(target, all);
  if (!term) return;

  // break-pane = promote to top-level (clear parent)
  await rpc("terminal/setParent", { id: term.id, parentId: null });
}

async function cmdJoinPane(args: string[]): Promise<void> {
  const { flags } = parseArgs(args);
  const source = flags["-s"] as string | undefined;
  const target = flags["-t"] as string | undefined;

  const all = await listAllTerminals();
  const srcTerm = resolveTarget(source, all);
  const dstTerm = resolveTarget(target, all);
  if (!srcTerm || !dstTerm) return;

  // join-pane = make source a child of target's window
  const parentId = dstTerm.meta.parentId || dstTerm.id;
  await rpc("terminal/setParent", { id: srcTerm.id, parentId });
}

// --- wait-for (file-based inter-process signaling) ---

function waitForSignalPath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(tmpdir(), `kolu-wait-for-${sanitized}.sig`);
}

async function cmdWaitFor(args: string[]): Promise<void> {
  const { flags, positional } = parseArgs(args);
  const name = positional.find((p) => !p.startsWith("-"));
  if (!name) {
    process.stderr.write("wait-for requires a name\n");
    process.exit(1);
  }

  const signalPath = waitForSignalPath(name);

  if (flags["-S"]) {
    // Signal mode: create the file
    writeFileSync(signalPath, "");
    return;
  }

  // Wait mode: poll for the file (30s timeout)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(signalPath)) {
      try {
        unlinkSync(signalPath);
      } catch {}
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  process.stderr.write(`wait-for timeout: ${name}\n`);
  process.exit(1);
}

// --- No-op commands ---

function noOp(): void {
  // Silently succeed
}

// --- Main dispatch ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle global flags before subcommand
  let i = 0;
  while (i < args.length) {
    if (args[i] === "-L" || args[i] === "-S") {
      // Socket name/path — accept and ignore
      i += 2;
      continue;
    }
    if (args[i] === "-f") {
      // Config file — ignore
      i += 2;
      continue;
    }
    if (args[i] === "-V") {
      await cmdVersion();
      return;
    }
    break;
  }

  const subcommand = args[i];
  const subArgs = args.slice(i + 1);

  switch (subcommand) {
    case "has-session":
      await cmdHasSession(subArgs);
      break;
    case "list-sessions":
    case "ls":
      await cmdListSessions(subArgs);
      break;
    case "list-windows":
    case "lsw":
      await cmdListWindows(subArgs);
      break;
    case "list-panes":
    case "lsp":
      await cmdListPanes(subArgs);
      break;
    case "split-window":
    case "splitw":
      await cmdSplitWindow(subArgs);
      break;
    case "send-keys":
    case "send":
      await cmdSendKeys(subArgs);
      break;
    case "capture-pane":
    case "capturep":
      await cmdCapturePane(subArgs);
      break;
    case "kill-pane":
    case "killp":
      await cmdKillPane(subArgs);
      break;
    case "display-message":
    case "display":
      await cmdDisplayMessage(subArgs);
      break;
    case "new-session":
    case "new":
      await cmdNewSession(subArgs);
      break;
    case "new-window":
    case "neww":
      await cmdNewWindow(subArgs);
      break;
    case "resize-pane":
    case "resizep":
      await cmdResizePane(subArgs);
      break;
    case "select-pane":
    case "selectp":
      await cmdSelectPane(subArgs);
      break;
    case "break-pane":
    case "breakp":
      await cmdBreakPane(subArgs);
      break;
    case "join-pane":
    case "joinp":
      await cmdJoinPane(subArgs);
      break;
    case "select-layout":
    case "selectl":
      noOp();
      break;
    case "set-option":
    case "set":
    case "set-window-option":
    case "setw":
      noOp();
      break;
    case "show-options":
    case "show":
      // Return synthetic prefix if asked
      if (subArgs.includes("prefix")) {
        console.log("C-b");
      }
      break;
    case "wait-for":
      await cmdWaitFor(subArgs);
      break;
    // Additional no-ops (accepted silently per cmux compat)
    case "source-file":
    case "refresh-client":
    case "attach-session":
    case "detach-client":
    case "last-window":
    case "next-window":
    case "previous-window":
    case "set-hook":
    case "set-buffer":
    case "list-buffers":
    case "rename-window":
    case "renamew":
    case "kill-window":
    case "killw":
      noOp();
      break;
    default:
      if (!subcommand) {
        // No subcommand = just `tmux` — print version like real tmux does on error
        process.stderr.write(`${FAKE_VERSION}\n`);
        process.exit(1);
      }
      // Unknown command — no-op with warning
      process.stderr.write(`kolu-tmux: unknown command: ${subcommand}\n`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`kolu-tmux: ${err.message}\n`);
  process.exit(1);
});
