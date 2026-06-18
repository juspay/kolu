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

import { shellJoin, shellSplit } from "@kolu/shell-quote";
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
 * Resume markers spliced in right after the agent binary for agents that
 * support conversation continuity. The `Record` key union is the exact set of
 * resume-capable agents, so adding an agent forces adding a marker (type error
 * if omitted). Narrower than `STABLE_FLAGS`: detection-only agents (`aider`,
 * `goose`, `gemini`, `cursor-agent`) are absent and `resumeAgentCommand`
 * returns `null` for them.
 *
 * Each value is the literal token sequence inserted after the head:
 *   claude `-c`              → continue most-recent conversation in cwd
 *   codex `resume --last`    → subcommand form; last session in cwd
 *                              (`--last` skips the interactive picker)
 *   opencode `--continue`    → continue most-recent session in cwd
 *
 * Each marker is spliced into the command as a RAW string (not re-quoted argv),
 * so a multi-word marker like `resume --last` works as written; the tokens are
 * plain flags/identifiers with no shell-significant characters. `parseAgentCommand`
 * strips `-c`/`--continue`/`--resume`/`-r` during normalization (per
 * juspay/kolu#467), so the input is always resume-free — no idempotency case.
 */
type ResumableAgent = "claude" | "codex" | "opencode";

const AGENT_RESUME: Record<ResumableAgent, string> = {
  claude: "-c",
  codex: "resume --last",
  opencode: "--continue",
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
 * Extract the agent binary basename (the head token) from a command line —
 * typically the normalized output of `parseAgentCommand`. Tokenizes with
 * `shellSplit` (the exact inverse of the `shellJoin` that produced the
 * normalized form, see `@kolu/shell-quote`) so the joined wire format stays
 * fully encapsulated: consumers ask anyagent "what's the agent here?" instead
 * of re-splitting the joined string and depending on the head token never
 * being quoted. Returns `null` for an empty command.
 */
export function agentNameFromCommand(command: string): string | null {
  const head = shellSplit(command.trim())[0];
  return head === undefined ? null : basename(head);
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

  // Keep only allowlisted flags + their values. Anything else (unknown flags,
  // positional args) is dropped.
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

  // Re-quote each kept token so the joined command survives shell re-execution:
  // `string-argv` strips the source quoting, so a value carrying spaces, JSON,
  // or other shell-significant characters would word-split on rerun without it
  // (`--settings '{"ultracode": true}'` → `Error: Settings file not found:
  // {ultracode:`). A safe bare word — including a leading `~`, kept bare so the
  // shell re-expands it to the same home path the source used — is left as-is.
  // `shellJoin`'s exact inverse is `shellSplit` (see `@kolu/shell-quote`), which
  // the resume/head-extraction paths use to reparse this wire format.
  return shellJoin(kept);
}

/**
 * Given a normalized agent invocation (the output of `parseAgentCommand`),
 * return the resume-mode invocation for agents that support it, or `null`
 * if the agent is in the allowlist but not the resume table. Input is
 * assumed already normalized — callers should not pass raw user input.
 */
export function resumeAgentCommand(normalized: string): string | null {
  const trimmed = normalized.trim();
  // The agent basename is always a safe bare word, so `shellSplit` reads the
  // head reliably. We only need it to look up the agent — we do NOT re-render
  // the tail. Splicing the resume marker as a STRING between head and tail
  // keeps the already-correct quoting of the tail VERBATIM: a re-tokenize +
  // re-join round-trip would (a) lose the literal-`~` quoting `parseAgentCommand`
  // recovered (F2) and (b) risk re-mangling the canonical `'\''` idiom (F3).
  const head = shellSplit(trimmed)[0];
  if (head === undefined || !(head in AGENT_RESUME)) return null;
  const marker = AGENT_RESUME[head as ResumableAgent];
  const tail = trimmed.slice(head.length).trimStart(); // everything after the head token
  return tail === "" ? `${head} ${marker}` : `${head} ${marker} ${tail}`;
}
