/**
 * Agent CLI command detection and normalization.
 *
 * When the user runs a known agent binary in any kolu terminal
 * (`claude`, `aider`, `opencode`, etc.), kolu's preexec hook emits
 * the raw command line as an `OSC 633 ; E ; <cmd>` mark on the PTY
 * output stream. `parseAgentCommand` takes that raw string and
 * returns a normalized canonical form, or `null` if the command
 * is not a known agent invocation.
 *
 * Normalization rules:
 * - First token (basename-stripped) must be in `STABLE_FLAGS`.
 * - Commands containing exit-immediately flags (`--version`, `--help`,
 *   `-V`, `-h`) return `null` — they are not agent sessions.
 * - Only flags listed in `STABLE_FLAGS` (per agent) are preserved.
 *   Unknown flags are dropped by default — safe by construction.
 *   This is an allowlist, not a denylist: adding a new agent CLI flag
 *   upstream cannot silently pollute the MRU; it is dropped until
 *   someone adds it to the allowlist.
 * - Trailing positional arguments (after the last flag) are stripped
 *   so `aider src/foo.ts` collapses to `aider`.
 *
 * Tokenization delegates to `string-argv`, a small focused library
 * for splitting shell-like strings into argv. We don't try to evaluate
 * the command — we only need to decide which tokens to strip — so the
 * tokenizer's exact handling of edge cases (command substitution,
 * process substitution, glob) doesn't matter: unknown constructs fall
 * through as opaque positionals and get dropped in the same step that
 * drops real positionals.
 */

import { parseArgsStringToArgv } from "string-argv";

/** Flags that cause the CLI to print info and exit immediately.
 *  Commands containing any of these are not agent sessions. */
const EXIT_FLAGS: ReadonlySet<string> = new Set([
  "--version",
  "-V",
  "--help",
  "-h",
]);

/** Per-agent allowlist of flags that define a meaningfully different
 *  invocation. Only these are preserved in the MRU form. The map's
 *  keys double as the set of known agent basenames — no separate
 *  KNOWN_AGENTS set to keep in sync.
 *
 *  A flag not listed here is dropped silently — that is the safe
 *  default. To add support for a new stable flag, add it here. */
const STABLE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "claude",
    new Set([
      "--model",
      "--dangerously-skip-permissions",
      "--allowedTools",
      "--disallowedTools",
      "--permission-mode",
      "--add-dir",
      "--agent",
      "--mcp-config",
      "--strict-mcp-config",
      "--append-system-prompt",
      "--settings",
      "--bare",
    ]),
  ],
  [
    "opencode",
    new Set([
      "--model",
      "--dangerously-skip-permissions",
      "--yolo",
      "--agent",
      "--pure",
    ]),
  ],
  ["aider", new Set(["--model"])],
  [
    "codex",
    new Set([
      "--model",
      "--yolo",
      "--config",
      "-c",
      "--profile",
      "-p",
      "--sandbox",
      "-s",
      "--ask-for-approval",
      "-a",
      "--full-auto",
      "--oss",
    ]),
  ],
  ["goose", new Set([])],
  ["gemini", new Set([])],
  ["cursor-agent", new Set([])],
]);

/** Basename of a path-like token (strips directory prefix). */
function basename(s: string): string {
  const slash = s.lastIndexOf("/");
  return slash === -1 ? s : s.slice(slash + 1);
}

/**
 * Resume-form transforms for agents that support conversation continuity.
 * Shape: `Record<AgentName, (argv) => argv>` — the Record key union is the
 * exact set of resume-capable agents, so adding an agent forces adding a
 * transform (type error if omitted). This is a narrower table than
 * `STABLE_FLAGS`: detection-only agents (`aider`, `goose`, `gemini`,
 * `cursor-agent`) are absent here and `resumeAgentCommand` returns `null`
 * for them.
 *
 * The transforms splice a resume marker into the normalized argv:
 *   claude `-c`       → continue most-recent conversation in cwd
 *   codex `resume`    → subcommand form; last session in cwd
 *   opencode `--continue` → continue most-recent session in cwd
 *
 * `parseAgentCommand` strips `-c`/`--continue`/`--resume`/`-r` during
 * normalization (per juspay/kolu#467), so the input to these transforms is
 * always resume-free — no idempotency special-case needed.
 */
type ResumableAgent = "claude" | "codex" | "opencode";

const AGENT_RESUME: Record<
  ResumableAgent,
  (argv: readonly string[]) => string[]
> = {
  claude: (argv) => [argv[0]!, "-c", ...argv.slice(1)],
  codex: (argv) => [argv[0]!, "resume", ...argv.slice(1)],
  opencode: (argv) => [argv[0]!, "--continue", ...argv.slice(1)],
};

/**
 * Parse a raw command line. Returns the normalized agent invocation
 * string (e.g. `"claude --model sonnet"`) if the first token resolves
 * to a known agent binary, or `null` otherwise.
 */
export function parseAgentCommand(raw: string): string | null {
  const tokens = parseArgsStringToArgv(raw.trim());
  if (tokens.length === 0) return null;

  const agent = basename(tokens[0]!);
  if (!STABLE_FLAGS.has(agent)) return null;

  const args = tokens.slice(1);

  // Exit-immediately flags → not an agent session.
  if (args.some((t) => EXIT_FLAGS.has(t))) return null;

  const allowed = STABLE_FLAGS.get(agent)!;

  // Keep only allowlisted flags + their values.
  // Anything else (unknown flags, positional args) is dropped.
  const kept: string[] = [agent];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t === "--") break; // stop at explicit end-of-flags
    if (!t.startsWith("-")) continue; // drop positional
    if (!allowed.has(t)) {
      // Unknown flag — skip it and its value (if present)
      if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) i++;
      continue;
    }
    // Stable flag — keep verbatim
    kept.push(t);
    // If the next token is a non-flag value (e.g. `--model sonnet`),
    // attach it to the flag as-is.
    if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
      kept.push(args[++i]!);
    }
  }
  return kept.join(" ");
}

/**
 * Given a normalized agent invocation (the output of `parseAgentCommand`),
 * return the resume-mode invocation for agents that support it, or `null`
 * if the agent is in the allowlist but not the resume table. Input is
 * assumed already normalized — callers should not pass raw user input.
 */
export function resumeAgentCommand(normalized: string): string | null {
  const argv = parseArgsStringToArgv(normalized.trim());
  if (argv.length === 0) return null;
  const agent = argv[0]!;
  if (!(agent in AGENT_RESUME)) return null;
  return AGENT_RESUME[agent as ResumableAgent](argv).join(" ");
}
