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
 * - First token (basename-stripped) must name an agent in the registry.
 * - Commands containing exit-immediately flags (`--version`, `--help`,
 *   `-V`, `-h`, plus any per-agent spellings) return `null`.
 * - Only flags listed in the agent's `stableFlags` are preserved.
 *   Unknown flags are dropped by default — safe by construction.
 *   This is an allowlist, not a denylist: adding a new agent CLI flag
 *   upstream cannot silently pollute the MRU; it is dropped until
 *   someone adds it to the allowlist.
 * - Trailing positional arguments (after the last flag) are stripped
 *   so `aider src/foo.ts` collapses to `aider`.
 *
 * The per-agent GRAMMAR and RESUME policy no longer live here — they are
 * declared in each `kolu-<agent>` package and folded by `kolu-agents` into an
 * {@link AgentCliRegistry}. Every function below takes that registry as its
 * EXPLICIT first argument: no closure, no module init order, no cycle (a
 * registry-bound factory inside anyagent would need the registry, which needs
 * anyagent).
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
import type { AgentIdentity, RestoreTarget } from "./schemas.ts";
import type { AnyAgentVocab, AgentCliGrammar } from "./vocab.ts";

/** Flags that cause the CLI to print info and exit immediately.
 *  Commands containing any of these are not agent sessions. */
const EXIT_FLAGS: ReadonlySet<string> = new Set([
  "--version",
  "-V",
  "--help",
  "-h",
]);

/** The CLI registry: every known agent, keyed by binary basename. `vocabs` are
 *  the full agents (kind · resume · schema); `detectOnly` are binaries kolu
 *  recognizes for the MRU but has no session/agent discriminator for
 *  (`aider`, `goose`, `gemini`, `cursor-agent`) — grammar only, no kind. */
export interface AgentCliRegistry {
  readonly vocabs: readonly AnyAgentVocab[];
  readonly detectOnly: readonly AgentCliGrammar[];
  /** Resolve a binary basename (path-stripped) to its vocab or grammar. */
  byBasename(basename: string): AnyAgentVocab | AgentCliGrammar | undefined;
}

/** Narrow a registry entry to a full agent vocab (its info schema is the
 *  tell — detect-only grammars carry no schema). */
function isVocab(
  entry: AnyAgentVocab | AgentCliGrammar,
): entry is AnyAgentVocab {
  return "infoSchema" in entry;
}

/** Build the basename index. Throws on a duplicate kind or basename — the
 *  compile fence the old `BASENAME_TO_KIND` record had becomes a LOAD-TIME
 *  fence (crash loudly, conventions.md). */
export function buildCliRegistry(
  vocabs: readonly AnyAgentVocab[],
  detectOnly: readonly AgentCliGrammar[],
): AgentCliRegistry {
  const byName = new Map<string, AnyAgentVocab | AgentCliGrammar>();
  const kinds = new Set<string>();
  for (const vocab of vocabs) {
    if (kinds.has(vocab.kind))
      throw new Error(`duplicate agent kind: ${vocab.kind}`);
    kinds.add(vocab.kind);
    if (byName.has(vocab.cli.basename))
      throw new Error(`duplicate agent basename: ${vocab.cli.basename}`);
    byName.set(vocab.cli.basename, vocab);
  }
  for (const grammar of detectOnly) {
    if (byName.has(grammar.basename))
      throw new Error(`duplicate agent basename: ${grammar.basename}`);
    byName.set(grammar.basename, grammar);
  }
  return {
    vocabs,
    detectOnly,
    byBasename: (name) => byName.get(name),
  };
}

/** Basename of a path-like token (strips directory prefix). */
function basename(s: string): string {
  const slash = s.lastIndexOf("/");
  return slash === -1 ? s : s.slice(slash + 1);
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
  reg: AgentCliRegistry,
  raw: string,
  shellJoinFormat = false,
): string | null {
  const trimmed = raw.trim();
  const argv = shellJoinFormat
    ? shellSplit(trimmed)
    : parseArgsStringToArgv(trimmed);
  const head = argv[0];
  if (head === undefined) return null;
  const entry = reg.byBasename(basename(head));
  if (entry === undefined) return null;
  return normalizeAgentInvocation(isVocab(entry) ? entry.cli : entry, argv);
}

/** Normalize an already-tokenized argv to its agent invocation string, or `null`
 *  if `argv[0]` isn't the grammar's binary. Shared by both tokenizer attempts
 *  above. */
function normalizeAgentInvocation(
  grammar: AgentCliGrammar,
  argv: string[],
): string | null {
  const [head, ...args] = argv;
  if (head === undefined) return null;

  const agent = basename(head);
  // Caller already resolved the grammar by basename; a direct re-check keeps
  // this function total on its own (no caller contract to remember).
  if (agent !== grammar.basename) return null;

  // Exit-immediately flags → not an agent session (shared set plus any
  // agent-specific spellings, e.g. pi's lowercase `-v`).
  if (args.some((t) => EXIT_FLAGS.has(t) || grammar.extraExitFlags.has(t)))
    return null;

  // Keep only allowlisted flags + their values. Anything else (unknown flags,
  // positional args) is dropped.
  const kept: string[] = [agent];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === undefined) break;
    if (t === "--") break; // stop at explicit end-of-flags
    if (grammar.nonSessionFlags.has(t)) return null; // session-redirecting flag
    // A subcommand word kills the invocation ONLY as the first argument —
    // later occurrences are prompt text (pi's own grammar).
    if (i === 0 && !t.startsWith("-") && grammar.nonSessionSubcommands.has(t))
      return null;
    if (!t.startsWith("-")) continue; // drop positional
    const next = args[i + 1];
    const arity = grammar.stableFlags.get(t);
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
    // MRU. See the per-flag arity in `stableFlags`.
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
 * Resolve the agent `kind` discriminator for a command string (typically
 * the normalized output of `parseAgentCommand`, but raw command strings
 * with a path prefix are handled too via `basename`). Returns `null` for
 * unrecognized commands and for detection-only agents.
 */
export function agentKindFromCommand(
  reg: AgentCliRegistry,
  command: string,
): string | null {
  const head = command.trim().split(/\s+/, 1)[0] ?? "";
  const entry = reg.byBasename(basename(head));
  return entry !== undefined && isVocab(entry) ? entry.kind : null;
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
  reg: AgentCliRegistry,
  command: string,
  agent: AgentIdentity,
): RestoreTarget | null {
  return agentKindFromCommand(reg, command) === agent.kind
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
 * being quoted. Returns `null` for an empty command. No registry needed — this
 * is pure string anatomy.
 */
export function agentNameFromCommand(command: string): string | null {
  const head = shellSplit(command.trim())[0];
  return head === undefined ? null : basename(head);
}

/**
 * Given a normalized agent invocation (the output of `parseAgentCommand`),
 * return the resume-mode invocation for agents that support it, or `null`
 * if the agent is in the allowlist but not the resume table. Input is
 * assumed already normalized — callers should not pass raw user input.
 *
 * Marker selection (three disjoint cases, never silently the wrong one):
 *   - SAME-agent ref + shell-safe ref → resume the EXACT conversation
 *     (`claude --resume <id>`, etc., juspay/kolu#1495).
 *   - SAME-agent ref but the ref FAILS its shape gate → return `null`. A captured
 *     ref for THIS agent that no longer matches its pattern means our claim to know
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
  reg: AgentCliRegistry,
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
  if (head === undefined) return null;
  const entry = reg.byBasename(basename(head));
  if (entry === undefined || !isVocab(entry)) return null;
  const vocab = entry;
  const tail = trimmed.slice(head.length).trimStart(); // everything after the head token
  const policy = vocab.resume;

  // Does the ref name THIS agent? If so, its ref is a claim to know the exact
  // conversation that must be honored or refused — never silently downgraded.
  const isSameAgentRef = session !== undefined && session.kind === vocab.kind;

  let marker: string;
  if (isSameAgentRef) {
    // Same-agent ref: resume the EXACT conversation iff the ref passes its
    // shell-inert shape gate. `shellJoin([ref])` quotes the ref as a single token —
    // a no-op for a gate-passing ref, but it keeps the "data, not shell text"
    // intent explicit. A malformed ref is a broken claim → refuse to resume
    // (return null) rather than fall back to the most-recent (wrong) conversation.
    const ref = session.resumeRef;
    if (!policy.idPattern.test(ref)) return null;
    marker = policy.byId(shellJoin([ref]));
  } else {
    // No ref, or a ref for a different agent: most-recent fallback (no ref to aim).
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
 *   - `exact` → resume THAT conversation by ref (juspay/kolu#1495): the captured
 *     `agent` identity is passed STRAIGHT to `resumeAgentCommand`, which splices it
 *     (or refuses with `null` if the ref fails its shape gate — a bare shell, never
 *     the wrong conversation).
 *   - `legacyMostRecent` → the most-recent-marker resume (`claude -c`, …): the
 *     compatibility path for migrated pre-1.29 records that remembered a launch
 *     `command` but no session id. Reaches `resumeAgentCommand` with no ref, so it
 *     never aims a ref at the wrong CLI.
 */
export function resumeFormFor(
  reg: AgentCliRegistry,
  target: RestoreTarget | undefined,
): string | null {
  if (!target || target.kind === "none") return null;
  if (target.kind === "legacyMostRecent")
    return resumeAgentCommand(reg, target.command, undefined);
  // `exact`: the agent that was LIVE at sleep — re-target its native session ref.
  return resumeAgentCommand(reg, target.command, target.agent);
}

/** The raw launch command a restore card COUNTS and a tile DISPLAYS, or `null`
 *  when wake lands on a bare shell — the ONE projection the display sites share
 *  (the restore card, `EmptyState`, `DormantTileBody`), so the question is spelled
 *  once instead of re-hand-rolled per consumer.
 *
 *  Whether there IS a command is the SAME question wake answers: `resumeFormFor`
 *  is the single authority on "would wake render a resume invocation?", so this
 *  GATES on it rather than testing `kind` independently — the two can no longer
 *  drift into the card promising a resume wake won't perform. A target whose
 *  command isn't actually resumable — a detection-only agent (`aider`/`goose`/…)
 *  in a migrated `legacyMostRecent` record, or an `exact` ref that fails its
 *  shell-safe shape gate — yields no invocation, hence `null` here even though its
 *  `kind` is `exact`/`legacyMostRecent`. The switch stays EXHAUSTIVE so a future
 *  non-resuming arm is a COMPILE ERROR (never a silent `!== "none"`).
 *
 *  Distinct from `resumeFormFor`'s RETURN, which is the actual resume INVOCATION
 *  (`claude -c`, `--resume <id>`); this is the raw command line for DISPLAY. */
export function resumableCommand(
  reg: AgentCliRegistry,
  target: RestoreTarget | undefined,
): string | null {
  if (target === undefined || resumeFormFor(reg, target) === null) return null;
  switch (target.kind) {
    case "none":
      return null;
    case "exact":
    case "legacyMostRecent":
      return target.command;
  }
}
