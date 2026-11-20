import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";

function expandHome(input: string, home: string): string {
  return input === "~"
    ? home
    : input.startsWith("~/")
      ? path.join(home, input.slice(2))
      : input;
}

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

function readSettingsSessionDir(
  agentDir: string,
  log?: Logger,
): string | undefined {
  const file = path.join(agentDir, "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
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
