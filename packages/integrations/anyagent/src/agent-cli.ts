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
import type { AgentKind, AgentSessionRef } from "./schemas.ts";

export type { AgentKind, AgentSessionRef };

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

type ResumableAgent = "claude" | "codex" | "opencode";

/** Canonical UUID shape (claude + codex session ids). */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * The whole per-agent resume policy — one entry per resume-capable agent, so
 * "how does agent X resume (and is its id safe to splice)?" is one thing in one
 * place. The `Record` key union is the exact set of resume-capable agents, so
 * adding an agent forces adding ALL three facets (type error if omitted).
 * Narrower than `STABLE_FLAGS`: detection-only agents (`aider`, `goose`,
 * `gemini`, `cursor-agent`) are absent and `resumeAgentCommand` returns `null`
 * for them.
 *
 * Three facets per agent:
 *   - `last`     — continue the MOST-RECENT conversation in the cwd, no id
 *       needed: claude `-c` · codex `resume --last` (`--last` skips the picker)
 *       · opencode `--continue`.
 *   - `byId`     — resume the EXACT conversation by its native id
 *       (juspay/kolu#1495): claude `--resume <id>` · codex `resume <id>` ·
 *       opencode `--session <id>`. The argument is the already-validated,
 *       shell-safe session id.
 *   - `idPattern` — the shape gate a native session id must pass before it is
 *       spliced via `byId`. The id is OBSERVED data (read from the agent's own
 *       session file / DB), so it crosses into a shell line as UNTRUSTED input:
 *       each pattern is anchored and admits only shell-inert characters — hex +
 *       hyphen for the claude/codex UUIDs, `ses_` + alnum for opencode — with a
 *       length cap baked into the pattern, so a matching id cannot carry a
 *       metacharacter, newline, or word-splitting space. The gate is fail-closed:
 *       a same-agent ref whose id fails this pattern is a broken claim and yields
 *       NO resume (a bare shell), never a downgrade to `last` — see
 *       `resumeAgentCommand`. `last` is reached only when there is no ref or the
 *       ref names a different agent (no id to aim at the wrong CLI).
 *
 * Each marker is spliced into the command as a RAW string (not re-quoted argv),
 * so a multi-word marker like `resume --last` works as written; the flag tokens
 * are plain identifiers with no shell-significant characters, and the spliced id
 * is `shellJoin`-quoted as one token at the splice site. `parseAgentCommand`
 * strips `-c`/`--continue`/`--resume`/`-r` during normalization (per
 * juspay/kolu#467), so the input is always resume-free — no idempotency case.
 */
const AGENT_RESUME: Record<
  ResumableAgent,
  { last: string; byId: (id: string) => string; idPattern: RegExp }
> = {
  claude: { last: "-c", byId: (id) => `--resume ${id}`, idPattern: UUID_RE },
  codex: {
    last: "resume --last",
    byId: (id) => `resume ${id}`,
    idPattern: UUID_RE,
  },
  opencode: {
    last: "--continue",
    byId: (id) => `--session ${id}`,
    idPattern: /^ses_[0-9a-zA-Z]{1,64}$/,
  },
};

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
  // Not a known agent invocation — the head basename isn't in the allowlist.
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
 *
 * Marker selection (three disjoint cases, never silently the wrong one):
 *   - SAME-agent ref + shell-safe id → resume the EXACT conversation
 *     (`claude --resume <id>`, etc., juspay/kolu#1495).
 *   - SAME-agent ref but the id FAILS its shape gate → return `null`. A captured
 *     id for THIS agent that no longer matches its pattern means our claim to know
 *     the conversation is broken (corrupt persisted state, parser drift, an
 *     upstream CLI changing its id format). Quietly resuming the most-recent
 *     conversation in the cwd would reintroduce the exact bug #1495 fixes — land
 *     in a *stranger's* conversation. So we refuse to resume at all: the terminal
 *     wakes to a bare shell (loud by absence), same as a never-observed agent,
 *     rather than the wrong conversation.
 *   - no ref, or a ref for a DIFFERENT agent → fall back to the most-recent
 *     marker (`claude -c`, etc.). This is the compatibility path for terminals
 *     that captured no id; it never aims an id at the wrong CLI.
 */
export function resumeAgentCommand(
  normalized: string,
  session?: AgentSessionRef,
): string | null {
  const trimmed = normalized.trim();
  // The agent basename is always a safe bare word, so `shellSplit` reads the
  // head reliably. We only need it to look up the agent — we do NOT re-render
  // the tail. Splicing the resume marker as a STRING between head and tail
  // keeps the already-correct quoting of the tail VERBATIM: a re-tokenize +
  // re-join round-trip would (a) lose the literal-`~` quoting `parseAgentCommand`
  // recovered (F2) and (b) risk re-mangling the canonical `'\''` idiom (F3).
  const head = shellSplit(trimmed)[0];
  if (head === undefined || !(head in AGENT_RESUME)) return null;
  const agent = head as ResumableAgent;
  const tail = trimmed.slice(head.length).trimStart(); // everything after the head token
  const policy = AGENT_RESUME[agent];

  // Does the ref name THIS agent? If so, its id is a claim to know the exact
  // conversation that must be honored or refused — never silently downgraded.
  const isSameAgentRef =
    session !== undefined && session.kind === BASENAME_TO_KIND[agent];

  let marker: string;
  if (isSameAgentRef) {
    // Same-agent ref: resume the EXACT conversation iff the id passes its
    // shell-inert shape gate. `shellJoin([id])` quotes the id as a single token —
    // a no-op for a gate-passing id, but it keeps the "data, not shell text"
    // intent explicit. A malformed id is a broken claim → refuse to resume
    // (return null) rather than fall back to the most-recent (wrong) conversation.
    if (!policy.idPattern.test(session.id)) return null;
    marker = policy.byId(shellJoin([session.id]));
  } else {
    // No ref, or a ref for a different agent: most-recent fallback (no id to aim).
    marker = policy.last;
  }

  return tail === "" ? `${head} ${marker}` : `${head} ${marker} ${tail}`;
}

/**
 * Derive the resume FORM for a terminal's persisted base — the one composition
 * `wake()` (and the client's session-restore path) feeds into a fresh spawn:
 * render the persisted `lastAgentCommand` via `resumeAgentCommand`, passing the
 * persisted `agentSession` ref so it targets the EXACT conversation that ran on
 * this terminal (juspay/kolu#1495); `null` when no agent command was ever
 * observed, or when the observed command is not resumable.
 *
 * One home for the `lastAgentCommand` + `agentSession` → resume-form mapping, so
 * the wake path and its tests can't drift from each other.
 */
export function resumeFormFor(meta: {
  lastAgentCommand?: string;
  agentSession?: AgentSessionRef;
}): string | null {
  return meta.lastAgentCommand
    ? resumeAgentCommand(meta.lastAgentCommand, meta.agentSession)
    : null;
}
