/** Pi session-store resolution — the per-terminal answer to "where does
 *  THIS pi keep its sessions".
 *
 *  Pi's own precedence (pi 0.84.2's CLI entry point, verified in its bundle
 *  against a live redirected session):
 *
 *    1. `--session-dir <dir>`          (argv)
 *    2. `PI_CODING_AGENT_SESSION_DIR`  (env, `~` expanded)
 *    3. `sessionDir` in `<agentDir>/settings.json`
 *    4. `<agentDir>/sessions` where `agentDir = PI_CODING_AGENT_DIR ?? ~/.pi/agent`
 *
 *  Step 4 is the one integrations get wrong: `PI_CODING_AGENT_DIR` moves
 *  pi's WHOLE agent directory, sessions included — it is not config-only.
 *  Agent harnesses set it per run, so assuming `~/.pi/agent/sessions` misses
 *  every harness-launched pi on the machine.
 *
 *  These overrides live in the pi process's own argv/environment, not in
 *  padi's, so resolution reads the foreground process (`readProcessSnapshot`)
 *  and folds it through the chain. A snapshot that can't be read (the pi
 *  exited mid-read — routine; a host mounted `hidepid` — deliberate op
 *  policy) resolves to kolu's DEFAULT root: never an error, never a wrong
 *  `[]` answer from the arbiter — only the per-invocation overrides are
 *  forfeited, which is the honest information available.
 *
 *  `--no-session` produces no store at all; anyagent's command grammar
 *  already refuses it, so no case for it exists here. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";

/** Expand a leading `~` (pi expands the env var; normalize its flag the
 *  same way so both spellings of a redirected store agree). */
function expandHome(input: string, home: string): string {
  return input === "~"
    ? home
    : input.startsWith("~/")
      ? path.join(home, input.slice(2))
      : input;
}

/** Absolutize a redirect value the way pi does — relative paths resolve
 *  against pi's launch cwd, for which the terminal's current cwd is the
 *  best available witness (pi rarely moves the store mid-tty). */
function absolutize(input: string, home: string, cwd: string): string {
  const expanded = expandHome(input, home);
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

/** The `--session-dir` value from an argv, or null. Handles both spellings
 *  (`--session-dir <dir>` and `--session-dir=<dir>`); the first occurrence
 *  wins (pi's arg parser keeps the last, but a doubled override flag is a
 *  user pathology — deterministic beats clever). */
export function parseSessionDirFlag(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--session-dir") {
      const value = argv[i + 1];
      return value && value.length > 0 ? value : null;
    }
    if (token?.startsWith("--session-dir=")) {
      const value = token.slice("--session-dir=".length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** `sessionDir` from `<agentDir>/settings.json` — pi reads the same key
 *  (`startupSettingsManager.getSessionDir()`), so a settings-redirected pi
 *  is findable without any env at all. Absent file / absent key: undefined.
 *  A CORRUPT settings file or unreadable dir is logged and skipped — pi's
 *  own startup would fail on it, and kolu must not inherit that failure
 *  into a detection crash; detection simply falls through the chain. */
function readSettingsSessionDir(
  agentDir: string,
  log?: Logger,
): string | undefined {
  const file = path.join(agentDir, "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined; // no settings file — the common case
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "sessionDir" in parsed &&
      typeof (parsed as { sessionDir: unknown }).sessionDir === "string"
    ) {
      const value = (parsed as { sessionDir: string }).sessionDir;
      return value.length > 0 ? value : undefined;
    }
    return undefined;
  } catch (err) {
    log?.error({ err, file }, "pi: settings.json unreadable as JSON");
    return undefined;
  }
}

export interface SessionDirResolution {
  /** The session-store root pi writes into for this invocation. */
  dir: string;
  /** Which link of pi's chain produced it (logging/diagnostics). */
  source: "flag" | "env" | "settings" | "default";
  /** How pi lays the files out in `dir` — the default store keeps per-cwd
   *  KEYED subdirectories (`<dir>/--<cwd-key>--/<file>`); an overridden
   *  store holds all session files DIRECTLY in `dir`, attributed by the
   *  header cwd (verified against a live pi 0.84.2 — both `--session-dir`
   *  and `PI_CODING_AGENT_SESSION_DIR` produce flat files). */
  layout: "tree" | "flat";
}

/** Fold an invocation's argv + env through pi's session-store precedence.
 *  Pure given its inputs — all effectful reading (argv/env capture,
 *  settings.json) happens in the callers. */
export function resolveSessionDir(opts: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  home: string;
  /** kolu's default agent dir (config `AGENT_DIR`) — the root used when the
   *  invocation's env names none. */
  defaultAgentDir: string;
  /** The terminal's cwd — the base for relative redirect values. */
  cwd: string;
  log?: Logger;
}): SessionDirResolution {
  const { argv, env, home, defaultAgentDir, cwd, log } = opts;
  const flag = argv ? parseSessionDirFlag(argv) : null;
  if (flag)
    return { dir: absolutize(flag, home, cwd), source: "flag", layout: "flat" };
  const envDir = env?.PI_CODING_AGENT_SESSION_DIR;
  if (envDir && envDir.length > 0)
    return {
      dir: absolutize(envDir, home, cwd),
      source: "env",
      layout: "flat",
    };
  const agentDir =
    env?.PI_CODING_AGENT_DIR && env.PI_CODING_AGENT_DIR.length > 0
      ? absolutize(env.PI_CODING_AGENT_DIR, home, cwd)
      : defaultAgentDir;
  const settings = readSettingsSessionDir(agentDir, log);
  if (settings)
    return {
      dir: absolutize(settings, home, cwd),
      source: "settings",
      layout: "flat",
    };
  return {
    dir: path.join(agentDir, "sessions"),
    source: "default",
    layout: "tree",
  };
}

export interface ProcessSnapshot {
  argv: string[];
  env: Record<string, string>;
}

/** The foreground process's argv + environment — the one place a pi
 *  invocation's `--session-dir` / `PI_CODING_AGENT_SESSION_DIR` /
 *  `PI_CODING_AGENT_DIR` genuinely live. Linux reads `/proc/<pid>` (argv
 *  AND env); Darwin reads the argv from `ps` but the env map comes back
 *  EMPTY — modern macOS redacts even same-user envs (see the Darwin branch
 *  below), so a config-env redirect is unrecoverable there. Any failure —
 *  exited process (routine), hidden proc (a `hidepid` host), an
 *  unsupported platform — yields null and the caller resolves the default
 *  root; those are genuinely unknowable overrides, not errors to surface. */
export function readProcessSnapshot(
  pid: number,
  log?: Logger,
): ProcessSnapshot | null {
  try {
    if (process.platform === "linux") {
      const argv = fs
        .readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .split("\0")
        .filter((s) => s.length > 0);
      const env: Record<string, string> = {};
      for (const pair of fs
        .readFileSync(`/proc/${pid}/environ`, "utf8")
        .split("\0")) {
        const eq = pair.indexOf("=");
        if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      return { argv, env };
    }
    if (process.platform === "darwin") {
      // Modern macOS (>=10.13) redacts even a SAME-USER process's
      // environment from ps: `-E` is accepted but prints the command line
      // only (verified live on a macOS 15 host — the env row simply does
      // not appear), so the env map is {} here by OS policy. A
      // PI_CODING_AGENT_* store redirect is a permanent Darwin blind spot —
      // flags (`--session-dir`) and the default-root settings.json still
      // resolve. argv stays the full command line.
      const out = execFileSync(
        "ps",
        ["-ww", "-p", String(pid), "-o", "command="],
        { encoding: "utf8" },
      ).trim();
      const argv = out.split(/\s+/).filter((s) => s.length > 0);
      if (argv.length === 0) return null;
      return { argv, env: {} };
    }
    return null;
  } catch (err) {
    log?.debug({ err, pid }, "pi: process snapshot unavailable");
    return null;
  }
}
