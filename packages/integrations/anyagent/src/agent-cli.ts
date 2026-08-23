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
import type { AgentIdentity, AgentKind, RestoreTarget } from "./schemas.ts";

/** Flags that cause the CLI to print info and exit immediately.
 *  Commands containing any of these are not agent sessions. */
const EXIT_FLAGS: ReadonlySet<string> = new Set([
  "--version",
  "-V",
  "--help",
  "-h",
]);

/** Exit-immediately flags an agent spells DIFFERENTLY from the shared set
 *  (pi's version flag is lowercase `-v`; the shared `-V` is a different
 *  switch for it). Keyed by the same basename as `STABLE_FLAGS` so an
 *  agent-only spelling never leaks its exit status onto another agent's
 *  legitimately-boolean `-v` (e.g. a future agent whose `-v` is verbose). */
const EXTRA_EXIT_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // Pi's one-shot surface is wider than the other four agents': `-v` is its
  // version spell (capital `-V` is a different, unknown switch), and
  // `--export` / `--list-models` / `-p` (`--print`) are print-and-exit
  // invocations that must never enter the recent-agents MRU.
  ["pi", new Set(["-v", "--export", "--list-models", "-p", "--print"])],
]);

/** Flags that make an invocation produce NO session kolu can bind to:
 *  `--session-dir <dir>` writes outside the scanned tree; `--no-session` is
 *  ephemeral. Attributing either would bind the terminal to a DIFFERENT
 *  session in the cwd (the #1495 wrong-conversation class via the
 *  unmatchable direction). Valid in ANY argv position, hence checked
 *  position-independent. */
const NON_SESSION_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["pi", new Set(["--session-dir", "--no-session"])],
]);

/** BARE positional subcommand words — but only in argv position 0: pi
 *  dispatches a subcommand from its FIRST argument alone, and any later
 *  occurrence is prompt text for an interactive session (verified against
 *  pi 0.84.2: `pi list` lists packages and exits; `pi --provider google
 *  list` takes the interactive path with `list` as the prompt). The
 *  arity-aware scan keeps value-flag values (`pi --name config`) immune. */
const NON_SESSION_SUBCOMMANDS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  [
    "pi",
    new Set([
      "auth",
      "config",
      "install",
      "list",
      "remove",
      "uninstall",
      "update",
    ]),
  ],
]);

/** Whether a stable flag consumes the token that follows it as its value
 *  (`--model sonnet` → `"value"`) or is a standalone boolean switch
 *  (`--dangerously-skip-permissions` → `"boolean"`). Co-located with each
 *  flag's membership below so arity and membership — two facets of the same
 *  flag, introduced by the same event — cannot drift apart. */
type FlagArity = "boolean" | "value";

/** Per-agent allowlist of flags that define a meaningfully different
 *  invocation, each mapped to its arity. Only these are preserved in the MRU
 *  form. The map's keys double as the set of known agent basenames — no
 *  separate KNOWN_AGENTS set to keep in sync.
 *
 *  A flag not listed here is dropped silently — that is the safe default. To
 *  add support for a new stable flag, add it here with its arity: a `"value"`
 *  flag consumes the following token (`--model sonnet`), a `"boolean"` switch
 *  must NOT. Stating the arity is mandatory, which is what keeps a trailing
 *  prompt positional out of the MRU — `claude --dangerously-skip-permissions
 *  'You are BOOT1…'` normalizes to `claude --dangerously-skip-permissions`,
 *  dropping the prompt rather than attaching it as a bogus value (the
 *  living-clue / kolu#1895 leak fix). */
const STABLE_FLAGS: ReadonlyMap<
  string,
  ReadonlyMap<string, FlagArity>
> = new Map([
  [
    "claude",
    new Map<string, FlagArity>([
      ["--model", "value"],
      ["--dangerously-skip-permissions", "boolean"],
      ["--allowedTools", "value"],
      ["--disallowedTools", "value"],
      ["--permission-mode", "value"],
      ["--add-dir", "value"],
      ["--agent", "value"],
      ["--mcp-config", "value"],
      ["--strict-mcp-config", "boolean"],
      ["--append-system-prompt", "value"],
      ["--settings", "value"],
      ["--bare", "boolean"],
    ]),
  ],
  [
    "opencode",
    new Map<string, FlagArity>([
      ["--model", "value"],
      ["--dangerously-skip-permissions", "boolean"],
      ["--yolo", "boolean"],
      ["--agent", "value"],
      ["--pure", "boolean"],
    ]),
  ],
  ["aider", new Map<string, FlagArity>([["--model", "value"]])],
  [
    "codex",
    new Map<string, FlagArity>([
      ["--model", "value"],
      ["--yolo", "boolean"],
      ["--config", "value"],
      ["-c", "value"],
      ["--profile", "value"],
      ["-p", "value"],
      ["--sandbox", "value"],
      ["-s", "value"],
      ["--ask-for-approval", "value"],
      ["-a", "value"],
      ["--full-auto", "boolean"],
      ["--oss", "boolean"],
    ]),
  ],
  ["goose", new Map<string, FlagArity>([])],
  ["gemini", new Map<string, FlagArity>([])],
  ["cursor-agent", new Map<string, FlagArity>([])],
  [
    "pi",
    new Map<string, FlagArity>([
      ["--model", "value"],
      ["--provider", "value"],
      ["--thinking", "value"],
      ["--name", "value"],
      ["-n", "value"],
    ]),
  ],
  [
    "grok",
    new Map<string, FlagArity>([
      ["--model", "value"],
      ["-m", "value"],
      ["--always-approve", "boolean"],
      ["--permission-mode", "value"],
      ["--agent", "value"],
      ["--no-plan", "boolean"],
      ["--no-subagents", "boolean"],
      // Inline (scrollback) TUI instead of the alternate screen — a launch-shape
      // choice users re-pick deliberately; must survive recent-agents / resume.
      ["--no-alt-screen", "boolean"],
      ["--reasoning-effort", "value"],
      ["--effort", "value"],
    ]),
  ],
]);

/** Basename of a path-like token (strips directory prefix). */
function basename(s: string): string {
  const slash = s.lastIndexOf("/");
  return slash === -1 ? s : s.slice(slash + 1);
}

type ResumableAgent = "claude" | "codex" | "opencode" | "grok" | "pi";

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
  // Grok Build: `-c` / `--continue` for most-recent in cwd; `-r` /
  // `--resume <uuid>` for exact (optional id on the flag; we always pass it
  // for byId so the shape gate stays meaningful).
  grok: {
    last: "-c",
    byId: (id) => `--resume ${id}`,
    idPattern: UUID_RE,
  },
  // Pi: `-c` / `--continue` for most-recent in the cwd; `--session` accepts a
  // file path OR a (partial) id — we always splice the full UUID so the shape
  // gate stays meaningful, and pi resolves it to the exact session file.
  pi: {
    last: "-c",
    byId: (id) => `--session ${id}`,
    idPattern: UUID_RE,
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
  grok: "grok",
  pi: "pi",
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
 * Build an `exact` restore target — but ONLY when `command` invokes the SAME agent
 * kind as `agent`. The invariant an `exact` target must carry is that its command's
 * agent kind agrees with its identity's kind, so that `resumeFormFor` →
 * `resumeAgentCommand` always takes the SAME-agent path (resume the exact conversation
 * by id, or refuse on a malformed id) and NEVER the most-recent *downgrade*
 * `resumeAgentCommand` applies to a different-agent ref. Without this gate,
 * `{ command: "opencode …", agent: { kind: "claude-code", … } }` would render as
 * opencode's most-recent resume — the wrong-agent defect #2 exists to make
 * unspellable, relocated inside the `exact` arm.
 *
 * A kind mismatch (a stale-command/new-agent race, or corrupt/edited state) — or a
 * non-resumable `command` whose head names no agent — yields `null`; the caller maps
 * that to `none` (a bare shell) or, in the migration, `legacyMostRecent`, never a
 * silent wrong-agent resume. This is the ONE constructor both production sites (kolu's
 * fold `restoreTargetOf`, the `backfillSnapshotCutover` migration) go through, so the
 * mismatched pair has a single point of refusal.
 */
export function exactRestoreTarget(
  command: string,
  agent: AgentIdentity,
): RestoreTarget | null {
  return agentKindFromCommand(command) === agent.kind
    ? { kind: "exact", command, agent }
    : null;
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
 *
 * TWO input formats reach here, in two different quoting dialects, and the CALLER
 * knows which — so it says so rather than the string being sniffed (a raw line
 * can mix both dialects, so no string-shape heuristic is reliable). An OSC 633;E
 * mark is a user's raw shell command line (standard quoting — double quotes, `$`,
 * backticks — which `string-argv` tokenizes); the #1872 command-rooted SEED is
 * `shellJoin(argv)`, whose exact inverse is `shellSplit`. A command-rooted PTY has
 * no shell, so it emits ONLY the seed (never a 633 line) and a shell terminal
 * emits ONLY 633 marks — so a terminal's `commandRooted` flag perfectly selects
 * the tokenizer. Pass `shellJoinFormat: true` for a command-rooted seed. Reuses
 * `shellSplit`; adds no tokenizer.
 */
export function parseAgentCommand(
  raw: string,
  shellJoinFormat = false,
): string | null {
  const trimmed = raw.trim();
  const argv = shellJoinFormat
    ? shellSplit(trimmed)
    : parseArgsStringToArgv(trimmed);
  return normalizeAgentInvocation(argv);
}

/** Normalize an already-tokenized argv to its agent invocation string, or `null`
 *  if `argv[0]` isn't a known agent. Shared by both tokenizer attempts above. */
function normalizeAgentInvocation(argv: string[]): string | null {
  const [head, ...args] = argv;
  if (head === undefined) return null;

  const agent = basename(head);
  const allowed = STABLE_FLAGS.get(agent);
  // Not a known agent invocation — the head basename isn't in the allowlist.
  if (allowed === undefined) return null;

  // Exit-immediately flags → not an agent session (shared set plus any
  // agent-specific spellings, e.g. pi's lowercase `-v`).
  const extraExit = EXTRA_EXIT_FLAGS.get(agent);
  if (args.some((t) => EXIT_FLAGS.has(t) || extraExit?.has(t))) return null;

  const nonSessionFlags = NON_SESSION_FLAGS.get(agent);
  const nonSessionSubcommands = NON_SESSION_SUBCOMMANDS.get(agent);

  // Keep only allowlisted flags + their values. Anything else (unknown flags,
  // positional args) is dropped.
  const kept: string[] = [agent];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === undefined) break;
    if (t === "--") break; // stop at explicit end-of-flags
    if (nonSessionFlags?.has(t)) return null; // session-redirecting flag
    // A subcommand word kills the invocation ONLY as the first argument —
    // later occurrences are prompt text (pi's own grammar).
    if (i === 0 && !t.startsWith("-") && nonSessionSubcommands?.has(t))
      return null;
    if (!t.startsWith("-")) continue; // drop positional
    const next = args[i + 1];
    const arity = allowed.get(t);
    if (arity === undefined) {
      // Unknown flag — skip it and its value (if present)
      if (next !== undefined && !next.startsWith("-")) i++;
      continue;
    }
    // Stable flag — keep verbatim
    kept.push(t);
    // Attach the following token as this flag's value ONLY when the flag is
    // known to take one (`--model sonnet`). A boolean switch
    // (`--dangerously-skip-permissions`) must not consume it — otherwise a
    // trailing prompt positional gets kept as a bogus value and leaks into the
    // MRU. See the per-flag arity in `STABLE_FLAGS`.
    if (arity === "value" && next !== undefined && !next.startsWith("-")) {
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
  session?: AgentIdentity,
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
    if (!policy.idPattern.test(session.sessionId)) return null;
    marker = policy.byId(shellJoin([session.sessionId]));
  } else {
    // No ref, or a ref for a different agent: most-recent fallback (no id to aim).
    marker = policy.last;
  }

  return tail === "" ? `${head} ${marker}` : `${head} ${marker} ${tail}`;
}

/**
 * Render a terminal's fold-derived {@link RestoreTarget} into the resume FORM
 * `wake()` (and the client's session-restore path) feeds a fresh spawn — the ONE
 * place a restore target becomes a command line, so the wake path and its tests
 * can't drift. It SWITCHES on the discriminated target and can no longer infer
 * "resume most-recent" from a missing field:
 *   - `none` (or an absent target) → `null`: wake lands on a BARE SHELL, by
 *     construction (juspay/kolu#1492). A quit-to-shell produces `none`, so there
 *     is nothing to read wrong.
 *   - `exact` → resume THAT conversation by id (juspay/kolu#1495): the captured
 *     `agent` identity is passed STRAIGHT to `resumeAgentCommand`, which splices it
 *     (or refuses with `null` if the id fails its shape gate — a bare shell, never
 *     the wrong conversation).
 *   - `legacyMostRecent` → the most-recent-marker resume (`claude -c`, …): the
 *     compatibility path for migrated pre-1.29 records that remembered a launch
 *     `command` but no session id. Reaches `resumeAgentCommand` with no ref, so it
 *     never aims an id at the wrong CLI.
 */
export function resumeFormFor(
  target: RestoreTarget | undefined,
): string | null {
  if (!target || target.kind === "none") return null;
  if (target.kind === "legacyMostRecent")
    return resumeAgentCommand(target.command, undefined);
  // `exact`: the agent that was LIVE at sleep — re-target its native session id.
  return resumeAgentCommand(target.command, target.agent);
}
