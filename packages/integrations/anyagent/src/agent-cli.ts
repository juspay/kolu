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

import { type NonEmpty, nonEmpty } from "nonempty";
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
 * POSIX-quote one argv token for safe re-execution by a shell.
 *
 * The normalize/resume helpers tokenize a raw command line via `string-argv`
 * (which strips the shell quoting) and then re-emit the kept tokens as a
 * single command-line string. That string is later run by a shell — written
 * into a PTY by the worktree-create, recent-agents, and session-restore
 * paths — so any token the shell would otherwise re-split or re-interpret
 * must be re-quoted: a `--settings '{"k": v}'` JSON value, an
 * `--append-system-prompt "two words"` value, anything carrying whitespace,
 * quotes, braces, `$`, … Without this the round-trip is lossy — a captured
 * `--settings '{"ultracode": true}'` was stored unquoted and word-split on
 * re-run (`Error: Settings file not found: {ultracode:`).
 *
 * A token that is already a safe bare word is returned unquoted so the common
 * case (`claude --model sonnet`) stays clean; everything else is wrapped in
 * single quotes with embedded single quotes escaped the canonical `'\''` way.
 * (A structurally identical quoter for copy-pasteable CLI attach hints lives
 * at `kaval-tui/src/render.ts`; kept separate because `anyagent` is a lower-
 * level package and must not depend on `kaval-tui`.)
 */
function shellQuoteArg(token: string): string {
  if (token !== "" && /^[A-Za-z0-9@%_+=:,./-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** Join normalized argv tokens into a single shell-parseable command line,
 *  re-quoting each token so a shell re-parsing the result reproduces exactly
 *  the tokens it was built from (no value silently splits into two args). */
function shellJoin(argv: readonly string[]): string {
  return argv.map(shellQuoteArg).join(" ");
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
 *   claude `-c`              → continue most-recent conversation in cwd
 *   codex `resume --last`    → subcommand form; last session in cwd
 *                              (`--last` skips the interactive picker)
 *   opencode `--continue`    → continue most-recent session in cwd
 *
 * `parseAgentCommand` strips `-c`/`--continue`/`--resume`/`-r` during
 * normalization (per juspay/kolu#467), so the input to these transforms is
 * always resume-free — no idempotency special-case needed.
 */
type ResumableAgent = "claude" | "codex" | "opencode";

/** Insert one or more "resume" tokens after the agent binary in a
 *  normalized argv. Non-emptiness is in the parameter type — the
 *  positional read `argv[0]` is total. */
function withResumeFlags(argv: NonEmpty<string>, ...flags: string[]): string[] {
  const [head, ...rest] = argv;
  return [head, ...flags, ...rest];
}

const AGENT_RESUME: Record<
  ResumableAgent,
  (argv: NonEmpty<string>) => string[]
> = {
  claude: (argv) => withResumeFlags(argv, "-c"),
  codex: (argv) => withResumeFlags(argv, "resume", "--last"),
  opencode: (argv) => withResumeFlags(argv, "--continue"),
};

/**
 * Discriminator literals used by `AgentInfoSchema` in kolu-common. Lives
 * here (not in kolu-common) because the basename→kind bridge below also
 * lives here — kolu-common depends on anyagent, so anyagent has to own
 * the kind vocabulary that its own helpers return. Structurally identical
 * to `AgentInfo["kind"]`; TypeScript treats them as the same union.
 */
export type AgentKind = "claude-code" | "codex" | "opencode";

/** Maps the agent binary basename to the discriminator used by
 *  `AgentInfoSchema` in kolu-common. Only the icon-capable agents have
 *  entries — detection-only agents in `STABLE_FLAGS` (aider/goose/gemini/
 *  cursor-agent) intentionally return `null` because they have no
 *  AgentInfo discriminator. The basename axis (`claude`/`codex`/`opencode`)
 *  and the kind axis (`claude-code`/`codex`/`opencode`) differ only for
 *  Claude; this is the single bridge between them. */
const BASENAME_TO_KIND: Record<string, AgentKind> = {
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode",
};

/**
 * Resolve the `AgentKind` discriminator for a command string (typically
 * the normalized output of `parseAgentCommand`, but raw command strings
 * with a path prefix are handled too via `basename`). Returns `null` for
 * unrecognized commands and for detection-only agents.
 */
export function agentKindFromCommand(command: string): AgentKind | null {
  const head = command.trim().split(/\s+/, 1)[0] ?? "";
  return BASENAME_TO_KIND[basename(head)] ?? null;
}

/**
 * Parse a raw command line. Returns the normalized agent invocation
 * string (e.g. `"claude --model sonnet"`) if the first token resolves
 * to a known agent binary, or `null` otherwise.
 */
export function parseAgentCommand(raw: string): string | null {
  const [head, ...args] = parseArgsStringToArgv(raw.trim());
  if (head === undefined) return null;

  const agent = basename(head);
  const allowed = STABLE_FLAGS.get(agent);
  if (allowed === undefined) return null;

  // Exit-immediately flags → not an agent session.
  if (args.some((t) => EXIT_FLAGS.has(t))) return null;

  // Keep only allowlisted flags + their values.
  // Anything else (unknown flags, positional args) is dropped.
  const kept: string[] = [agent];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === undefined) break;
    if (t === "--") break; // stop at explicit end-of-flags
    if (!t.startsWith("-")) continue; // drop positional
    const next = args[i + 1];
    if (!allowed.has(t)) {
      // Unknown flag — skip it and its value (if present)
      if (next !== undefined && !next.startsWith("-")) i++;
      continue;
    }
    // Stable flag — keep verbatim
    kept.push(t);
    // If the next token is a non-flag value (e.g. `--model sonnet`),
    // attach it to the flag as-is.
    if (next !== undefined && !next.startsWith("-")) {
      kept.push(next);
      i++;
    }
  }
  return shellJoin(kept);
}

/**
 * Given a normalized agent invocation (the output of `parseAgentCommand`),
 * return the resume-mode invocation for agents that support it, or `null`
 * if the agent is in the allowlist but not the resume table. Input is
 * assumed already normalized — callers should not pass raw user input.
 */
export function resumeAgentCommand(normalized: string): string | null {
  const argv = nonEmpty(parseArgsStringToArgv(normalized.trim()));
  if (!argv) return null;
  const agent = argv[0];
  if (!(agent in AGENT_RESUME)) return null;
  return shellJoin(AGENT_RESUME[agent as ResumableAgent](argv));
}
