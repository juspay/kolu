import { shellJoin } from "@kolu/shell-quote";
import { parseArgsStringToArgv } from "string-argv";
import type { RestoreTarget } from "./schemas.ts";
import type { AnyAgentVocab, AgentCliGrammar, FlagArity } from "./vocab.ts";

/** The CLI registry: every known agent, keyed by `kind`. There is no
 *  basename-keyed PARSER any more — a basename read off PTY text can only be
 *  compared against a known agent name ({@link agentNameHint}), never used to
 *  interpret a command line. */
export interface AgentCliRegistry {
  /** Resolve an agent `kind` to its vocab, or `undefined` when this build no
   *  longer knows it (a persisted target naming a retired agent → no resume,
   *  the documented bare-shell refusal, never a throw). */
  byKind(kind: string): AnyAgentVocab | undefined;
}

export function buildCliRegistry(
  vocabs: readonly AnyAgentVocab[],
): AgentCliRegistry {
  const byKind = new Map<string, AnyAgentVocab>();
  for (const vocab of vocabs) {
    if (byKind.has(vocab.kind))
      throw new Error(`duplicate agent kind: ${vocab.kind}`);
    byKind.set(vocab.kind, vocab);
  }
  return { byKind: (kind) => byKind.get(kind) };
}

function basename(s: string): string {
  const slash = s.lastIndexOf("/");
  return slash === -1 ? s : s.slice(slash + 1);
}

const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The agent binary basename a RAW shell line invokes, or `null` when the line
 * names no command.
 *
 * This is the ONLY reader of a raw 633;E payload left, and it exists for one
 * question: does the foreground process answer to an adapter's name even when
 * the kernel sees a shim (`node`, an `npm` wrapper)? It reads the head token —
 * behind leading `NAME=value` words and at most one `exec` / `env` wrapper —
 * and returns its basename. It interprets NOTHING else: no flags, no values, no
 * tail, so nothing it returns can become a command line.
 *
 * A caller compares the hint against a known agent name (`matchesAgent`); an
 * unrecognized line's hint simply never matches, which is why there is no
 * registry lookup here.
 */
export function agentNameHint(raw: string): string | null {
  const argv = parseArgsStringToArgv(raw.trim());
  let i = 0;
  const skipAssignments = (): void => {
    while (i < argv.length && ASSIGNMENT_WORD.test(argv[i] ?? "")) i++;
  };
  skipAssignments();
  const wrapper = argv[i];
  if (wrapper === "exec" || wrapper === "env") {
    i++;
    skipAssignments();
  }
  const head = argv[i];
  return head === undefined ? null : basename(head);
}

/**
 * Filter a LIVE PROCESS's argv down to the tokens kolu may replay: the flags on
 * the grammar's `stableFlags` allowlist, plus the value token that follows a
 * `value`-arity flag.
 *
 * Fed TOKENS, never a tokenized string: the argv comes from the OS
 * (`readProcessSnapshot`) and its element boundaries are exact, so a value
 * carrying spaces or JSON (`--settings '{"a": 1}'`) stays ONE token instead of
 * being re-split. Everything else — the executable path, a loader, wrapper
 * flags, resume markers, positionals, unknown flags — is dropped. This is an
 * allowlist, so a flag upstream adds cannot silently reach a restored shell.
 *
 * The whole argv is scanned, `argv[0]` included: a non-flag head is just a
 * positional and falls out in the same step that drops prompt text. That is
 * what makes an interpreter shim work (`node …/cli.js --model sonnet` keeps
 * `--model sonnet`) and what ignores a `ld-linux… opencode` loader prefix.
 */
export function stableFlagTokens(
  grammar: AgentCliGrammar,
  argv: readonly string[],
): string[] {
  const allowlistedTokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) break;
    if (token === "--") break;
    const arity = allowlistedFlag(grammar, token);
    if (arity === null) continue;
    allowlistedTokens.push(token);
    const next = argv[i + 1];
    if (arity === "value" && next !== undefined && !next.startsWith("-")) {
      allowlistedTokens.push(next);
      i++;
    }
  }
  return allowlistedTokens;
}

function allowlistedFlag(
  grammar: AgentCliGrammar,
  token: string,
): FlagArity | null {
  if (!token.startsWith("-")) return null;
  return grammar.stableFlags.get(token) ?? null;
}

/**
 * The LAUNCH form of an agent invocation — `basename argv…`, shell-quoted — or
 * `null` when the kind is not one this build knows. The one renderer the
 * recent-agents palette and a restore card share, so a displayed or typed line
 * is always registry data plus allowlisted tokens.
 */
export function agentLaunchLine(
  reg: AgentCliRegistry,
  kind: string,
  argv: readonly string[],
): string | null {
  const vocab = reg.byKind(kind);
  return vocab === undefined ? null : renderLine(vocab, null, argv);
}

function renderLine(
  vocab: AnyAgentVocab,
  marker: string | null,
  argv: readonly string[],
): string {
  const flags = stableFlagTokens(vocab.cli, argv);
  if (marker === null) return shellJoin([vocab.cli.basename, ...flags]);
  const suffix = flags.length === 0 ? "" : ` ${shellJoin(flags)}`;
  return `${shellJoin([vocab.cli.basename])} ${marker}${suffix}`;
}

/** Would a wake resume this target? The ONE gate: the kind is one this build
 *  knows AND its resume ref passes the agent's own shape gate — exactly the two
 *  ways `resumeFormFor` yields `null`. Every display/decision site asks this
 *  instead of rendering a whole command line just to compare it with `null`.
 *
 *  ASYMMETRIC narrowing: `true` means "an `exact` target that renders"; `false`
 *  does NOT mean "not `exact`" (an `exact` with an unknown kind or a bad ref is
 *  also false). Only the POSITIVE branch is load-bearing — an `else` branch must
 *  still handle an `exact` target. */
export function willResume(
  reg: AgentCliRegistry,
  target: RestoreTarget | undefined,
): target is Extract<RestoreTarget, { kind: "exact" }> {
  if (target?.kind !== "exact") return false;
  const vocab = reg.byKind(target.agent.kind);
  return vocab?.resume.idPattern.test(target.agent.resumeRef) ?? false;
}

/**
 * Render a terminal's fold-derived {@link RestoreTarget} into the resume form
 * `wake()` (and the client's restore path) feeds a fresh spawn — the ONE place
 * a restore target becomes a command line, so the wake path and its tests can't
 * drift.
 *
 * `none` (or an absent target) → `null`: wake lands on a BARE SHELL, by
 * construction (juspay/kolu#1492).
 *
 * `exact` → `basename byId(resumeRef) argv…`, each part a fact kolu owns:
 *   - the binary and the resume spelling come from the agent's own registry
 *     vocab (`cli.basename`, `resume.byId`);
 *   - the ref is the OS-derived session identity, quoted through `shellJoin`
 *     and gated by the vocab's `idPattern` — a ref that fails its shape gate is
 *     a broken claim to know the conversation, so we refuse (`null`, a bare
 *     shell) rather than aim an unvalidated token at a CLI;
 *   - the flags are the persisted `exact.argv` (already allowlisted at capture
 *     time by {@link stableFlagTokens}), re-quoted for the shell.
 *
 * A `kind` this build no longer knows yields `null` for the same reason: the
 * target is persisted, so a downgrade must cost one terminal its resume, never
 * the session.
 */
export function resumeFormFor(
  reg: AgentCliRegistry,
  target: RestoreTarget | undefined,
): string | null {
  if (!willResume(reg, target)) return null;
  const vocab = reg.byKind(target.agent.kind);
  if (vocab === undefined) return null;
  const marker = vocab.resume.byId(shellJoin([target.agent.resumeRef]));
  return renderLine(vocab, marker, target.argv);
}

/** The launch line a restore card COUNTS and a tile DISPLAYS, or `null` when
 *  wake lands on a bare shell — the ONE projection the display sites share (the
 *  restore card, `EmptyState`, `DormantTileBody`, the dock's search text), so
 *  the question is spelled once instead of re-hand-rolled per consumer.
 *
 *  Whether there IS a command is the SAME question wake answers: `resumeFormFor`
 *  is the single authority on "would wake render a resume invocation?", so this
 *  GATES on it rather than testing `kind` independently — the card can never
 *  promise a resume wake won't perform (a ref that fails its shape gate yields
 *  nothing here even though its `kind` is `exact`).
 *
 *  The returned string is the LAUNCH form (registry basename + allowlisted
 *  flags), never a captured command line: there is no raw text left to show. */
export function resumableCommand(
  reg: AgentCliRegistry,
  target: RestoreTarget | undefined,
): string | null {
  if (!willResume(reg, target)) return null;
  return agentLaunchLine(reg, target.agent.kind, target.argv);
}
