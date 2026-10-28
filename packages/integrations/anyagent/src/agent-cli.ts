/**
 * Agent CLI facts — the stable-flag allowlist, the sensor's name hint, and the
 * ONE renderer from a restore target to a shell line.
 *
 * ## The invariant
 *
 * **PTY output is a sensor. Nothing that executes may read a value whose
 * provenance is PTY bytes.** A shell's `OSC 633 ; E ; <text>` mark is
 * attacker-controlled — anyone whose text the user displays (`cat`, curl, an
 * ssh banner) can emit one — so it may never become a command kolu types.
 *
 * Everything that EXECUTES is rendered here from structured facts kolu owns:
 * the agent's registry vocab (which binary, how to spell "resume"), the
 * OS-derived `AgentIdentity` (which conversation), and the LIVE PROCESS's
 * argv filtered through {@link stableFlagTokens} (which flags). The raw mark
 * survives only as {@link agentNameHint} — a basename compared against
 * adapter names to name a foreground process that is otherwise a shim.
 *
 * The registry is passed EXPLICITLY as the first argument: no closure, no
 * module init order, no cycle (a registry-bound factory inside anyagent would
 * need the registry, which needs anyagent). `kolu-agents` binds it.
 */

import { shellJoin } from "@kolu/shell-quote";
import { parseArgsStringToArgv } from "string-argv";
import type { RestoreTarget } from "./schemas.ts";
import type { AnyAgentVocab, AgentCliGrammar } from "./vocab.ts";

/** The CLI registry: every known agent, keyed by `kind`. `vocabs` are the full
 *  agents (kind · resume · schema). There is no basename index any more — a
 *  basename read off PTY text no longer decides anything; {@link agentNameHint}
 *  only names a foreground process for the adapters' shim gate. */
export interface AgentCliRegistry {
  readonly vocabs: readonly AnyAgentVocab[];
  /** Resolve an agent `kind` to its vocab, or `undefined` when this build no
   *  longer knows it (a persisted target naming a retired agent → no resume,
   *  the documented bare-shell refusal, never a throw). */
  byKind(kind: string): AnyAgentVocab | undefined;
}

/** Build the kind index. Throws on a duplicate kind — the compile fence the
 *  old `BASENAME_TO_KIND` record had becomes a LOAD-TIME fence (crash loudly,
 *  AGENTS.md). */
export function buildCliRegistry(
  vocabs: readonly AnyAgentVocab[],
): AgentCliRegistry {
  const byKind = new Map<string, AnyAgentVocab>();
  for (const vocab of vocabs) {
    if (byKind.has(vocab.kind))
      throw new Error(`duplicate agent kind: ${vocab.kind}`);
    byKind.set(vocab.kind, vocab);
  }
  return {
    vocabs,
    byKind: (kind) => byKind.get(kind),
  };
}

/** Basename of a path-like token (strips directory prefix). */
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
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === undefined) break;
    if (t === "--") break; // explicit end of flags
    if (!t.startsWith("-")) continue; // executable path, loader, positional
    const next = argv[i + 1];
    const arity = grammar.stableFlags.get(t);
    if (arity === undefined) {
      // Unknown flag — skip it and its value (if present). A resume marker
      // (`--resume <id>`) dies here: the conversation is named by the
      // OS-derived identity, never by a captured token.
      if (next !== undefined && !next.startsWith("-")) i++;
      continue;
    }
    kept.push(t);
    // Attach the following token as this flag's value ONLY when the flag takes
    // one — a boolean switch must not swallow a trailing positional.
    if (arity === "value" && next !== undefined && !next.startsWith("-")) {
      kept.push(next);
      i++;
    }
  }
  return kept;
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
  if (vocab === undefined) return null;
  return shellJoin([vocab.cli.basename, ...argv]);
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
  if (!target || target.kind === "none") return null;
  const vocab = reg.byKind(target.agent.kind);
  if (vocab === undefined) return null;
  const policy = vocab.resume;
  const ref = target.agent.resumeRef;
  if (!policy.idPattern.test(ref)) return null;
  // The ref is data, not shell text: `shellJoin([ref])` quotes it as ONE token
  // (a no-op for a gate-passing ref) before the policy splices it.
  const marker = policy.byId(shellJoin([ref]));
  const flags = target.argv.length === 0 ? "" : ` ${shellJoin(target.argv)}`;
  // The marker sits DIRECTLY after the binary and the flags follow: codex spells
  // resume as a `resume` SUBCOMMAND, so `codex resume <id> --model x` is the one
  // order every agent accepts.
  return `${shellJoin([vocab.cli.basename])} ${marker}${flags}`;
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
  if (target === undefined || resumeFormFor(reg, target) === null) return null;
  switch (target.kind) {
    case "none":
      return null;
    case "exact":
      return agentLaunchLine(reg, target.agent.kind, target.argv);
  }
}
