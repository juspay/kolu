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

import { forceQuoteArg, shellQuoteArg, shellSplit } from "@kolu/shell-quote";
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

/** Chars that carry no shell meaning — a maximal leading run of these is safe
 *  to leave BARE. Mirrors `@kolu/shell-quote`'s `SAFE_BARE_WORD` charset (kept
 *  local: this is a per-char predicate over a value's prefix, not the leaf's
 *  whole-token test). */
const SAFE_BARE_CHAR = /[A-Za-z0-9@%_+=:,./~-]/;

/**
 * Decode a `string-argv` token (which retains the quote syntax it found) into
 * the shell-true literal value, stripping only syntactic quote DELIMITERS while
 * preserving a literal quote character that is content INSIDE the opposite quote
 * type. A POSIX shell decodes `~/"Bob's Project"` to `~/Bob's Project` (the `'`
 * is literal content of the `"…"` run) and `~/'a"b c'` to `~/a"b c` (the `"` is
 * literal content of the `'…'` run); blanket-stripping every `'`/`"` would lose
 * those literal quotes (codex review F2, round 4).
 *
 * Scope: only `'…'` and `"…"` delimiters are handled. `$`, backtick and
 * backslash escaping are intentionally NOT decoded — `string-argv` already
 * word-splits an unquoted backslash-escaped space upstream (a pre-existing
 * tokenizer divergence, not something this normalizer can repair), and these
 * are agent-CLI path values, not arbitrary shell. */
function decodeShellLiteral(value: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (const c of value) {
    if (quote === null) {
      if (c === "'" || c === '"') {
        quote = c; // open delimiter — dropped
        continue;
      }
      out += c;
    } else if (c === quote) {
      quote = null; // matching close delimiter — dropped
    } else {
      out += c; // literal content (incl. the opposite quote char)
    }
  }
  return out;
}

/**
 * Render a value whose SOURCE began with a BARE leading `~` (so a shell expands
 * the tilde) but which still needs quoting for some later character — the
 * classic case being a space, e.g. `--add-dir ~/'My Projects'`.
 *
 * Why this exists: a flat `forceQuoteArg` would wrap the whole value in single
 * quotes, putting the leading `~` INSIDE the quotes and suppressing expansion —
 * replaying a literal `~/My Projects` instead of `$HOME/My Projects`. The shell
 * only expands a `~` that is followed by an UNQUOTED `/` (or end-of-word), so we
 * keep the maximal leading bare-safe run (`~/My`, `~/.config/x`, …) unquoted and
 * force-quote only the remainder.
 *
 * `decodeShellLiteral` recovers the shell-true value from the quote-retaining
 * `string-argv` token (verified against bash for the single-, double-, and
 * mixed-/nested-quote forms — a literal quote inside the opposite quote type
 * survives, only the delimiters are dropped).
 */
function renderBareTildeValue(value: string): string {
  const literal = decodeShellLiteral(value);
  let end = 0;
  while (end < literal.length && SAFE_BARE_CHAR.test(literal[end] ?? "")) end++;
  const prefix = literal.slice(0, end);
  const rest = literal.slice(end);
  return rest === "" ? prefix : prefix + forceQuoteArg(rest);
}

/**
 * Per-token quoting provenance for a raw command line, recovered by walking the
 * source in lockstep with `parseArgsStringToArgv`'s argv.
 *
 * Why this exists: `string-argv` strips quotes, so `--settings ~/x` and
 * `--settings '~/x'` tokenize to the IDENTICAL token `~/x`. But the two mean
 * different things on re-execution — bare `~` expands to `$HOME`, a quoted `~`
 * is a literal path. Bare-by-default (our `shellQuoteArg`) is right for the
 * unquoted case; for the quoted case we must re-quote to suppress expansion.
 * The token alone cannot tell them apart, so we recover the one bit that
 * matters — "did this token's source begin with a quote?" — straight from the
 * raw line.
 *
 * `quotedStarts(raw)[i]` is `true` iff the i-th argv token's source span began
 * with `'` or `"`. We only walk far enough to answer per kept value; a monotone
 * forward cursor (not substring search) keeps this robust against repeated
 * tokens. We never need to fully re-tokenize — we only inspect the first
 * non-whitespace char of each token's source.
 */
function quotedStarts(raw: string): boolean[] {
  const starts: boolean[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i] ?? "")) i++; // skip inter-token whitespace
    if (i >= raw.length) break;
    const c = raw[i];
    starts.push(c === "'" || c === '"');
    // Advance past this whole token's source: a run of unquoted chars and/or
    // balanced quoted segments, ending at the next unquoted whitespace. This
    // mirrors how a POSIX tokenizer groups e.g. `foo'bar baz'` into one token.
    while (i < raw.length && !/\s/.test(raw[i] ?? "")) {
      const ch = raw[i];
      if (ch === "'" || ch === '"') {
        const close = raw.indexOf(ch, i + 1);
        i = close === -1 ? raw.length : close + 1;
      } else {
        i++;
      }
    }
  }
  return starts;
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
 * All markers are safe bare words, so they need no quoting. `parseAgentCommand`
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
  const trimmed = raw.trim();
  const [head, ...args] = parseArgsStringToArgv(trimmed);
  if (head === undefined) return null;

  const agent = basename(head);
  const allowed = STABLE_FLAGS.get(agent);
  if (allowed === undefined) return null;

  // Exit-immediately flags → not an agent session.
  if (args.some((t) => EXIT_FLAGS.has(t))) return null;

  // Did each source token begin with a quote? `args[i]` is argv index `i + 1`.
  // Used only to keep a quoted literal `~` from re-expanding (see below).
  const quoted = quotedStarts(trimmed);

  // Render a kept value, preserving the quoting bits `string-argv` drops:
  //  - a leading `~` the SOURCE quoted is a literal path → keep it quoted
  //    (suppress expansion) via `forceQuoteArg`;
  //  - a leading `~` the source left BARE must re-expand on rerun → keep the
  //    tilde prefix bare. `shellQuoteArg` already does this for a fully-safe
  //    value (`~/projects/foo`), but a value that needs quoting for a LATER
  //    char (a space, e.g. `~/'My Projects'`) would be fully wrapped — putting
  //    the `~` inside the quotes — so `renderBareTildeValue` keeps the bare
  //    prefix and quotes only the remainder;
  //  - every other token defers to `shellQuoteArg`.
  const renderValue = (value: string, argvIndex: number): string => {
    if (value.startsWith("~")) {
      if (quoted[argvIndex] === true) return forceQuoteArg(value);
      return renderBareTildeValue(value);
    }
    return shellQuoteArg(value);
  };

  // Keep only allowlisted flags + their values, each POSIX-quoted as we go.
  // Joining pre-quoted tokens (rather than calling `shellJoin` on raw tokens)
  // is what lets the tilde-provenance override above sit per-token; the wire
  // format is still "each token quoted, space-joined", so `shellSplit` remains
  // the exact inverse. Anything else (unknown flags, positionals) is dropped.
  const kept: string[] = [shellQuoteArg(agent)];
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
    kept.push(shellQuoteArg(t));
    // If the next token is a non-flag value (e.g. `--model sonnet`),
    // attach it to the flag, preserving leading-`~` quoting provenance.
    if (next !== undefined && !next.startsWith("-")) {
      kept.push(renderValue(next, i + 2));
      i++;
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
