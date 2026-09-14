/** The agent VOCABULARY contracts — what every agent package must declare
 *  about itself, and what the registry (`kolu-agents`) folds.
 *
 *  This leaf names no agent (the anyforge note: the kernel is the receptacle,
 *  not a registry of plugs). It owns only the SHAPE of the facts an agent
 *  brings — its brand mark, its CLI grammar, its resume policy, its info
 *  schema — and the CLI algorithms that consume them. The DATA lives in each
 *  `kolu-<agent>` package; the LISTING lives in `kolu-agents`.
 *
 *  Browser-safe: types + `effect`'s Schema only. An agent's `infoSchema` is an
 *  Effect schema so the registry can compose the wire union without any agent
 *  package importing another. */

import type { Schema } from "effect";
import type { AgentInfoShape } from "./agent-adapter.ts";

/** Whether a stable flag consumes the token that follows it as its value
 *  (`--model sonnet` → `"value"`) or is a standalone boolean switch
 *  (`--dangerously-skip-permissions` → `"boolean"`). Co-located with each
 *  flag's membership in `AgentCliGrammar.stableFlags`, so arity and membership
 *  — two facets of the same flag, introduced by the same event — cannot drift
 *  apart. Stating the arity is mandatory, which is what keeps a trailing prompt
 *  positional out of the MRU (the living-clue / kolu#1895 leak fix). */
export type FlagArity = "boolean" | "value";

/** THE brand mark for an agent, as data — ONE mark, rendered by both the
 *  tile-chrome icon and the dock pip. Structurally identical to
 *  `@kolu/solid-statepip`'s `PipGlyphDef` — no import in either direction; TS
 *  structural typing is the seam. The value each agent declares is the 24×24
 *  normalized mark that paints identically in both contexts. */
export interface AgentMark {
  viewBox: string;
  paint: "fill" | "stroke";
  paths: readonly string[];
  strokeWidth?: number;
}

/** An agent's CLI grammar — everything `parseAgentCommand` needs to recognize
 *  and normalize an invocation of this binary. `basename` is the binary name
 *  (`"claude"`, `"xyne"`); `stableFlags` is the allowlist of flags that define
 *  a meaningfully different invocation; the three sets carve out invocations
 *  that are NOT sessions (exit-immediately flags, session-redirecting flags,
 *  and first-argument subcommands that take a non-interactive path). */
export interface AgentCliGrammar {
  /** The binary name, e.g. `"claude"`, `"xyne"`. */
  readonly basename: string;
  /** Allowlist of flags that define a meaningfully different invocation, each
   *  mapped to its arity. Only these are preserved in the MRU form; a flag not
   *  listed is dropped silently — the safe default. */
  readonly stableFlags: ReadonlyMap<string, FlagArity>;
  /** Exit-immediately flags this agent spells DIFFERENTLY from the shared set
   *  (`--version`/`-V`/`--help`/`-h`). Empty for most. */
  readonly extraExitFlags: ReadonlySet<string>;
  /** Flags that make an invocation produce NO session kolu can bind to
   *  (`--session-dir <dir>`, `--no-session`). Checked position-independent. */
  readonly nonSessionFlags: ReadonlySet<string>;
  /** BARE positional subcommand words — but only in argv position 0 — that
   *  take a non-interactive path (pi's `list`/`config`/…). */
  readonly nonSessionSubcommands: ReadonlySet<string>;
}

/** How an agent resumes a prior conversation. The `Record` key union is the
 *  exact set of resume-capable agents, so adding one forces all facets.
 *
 *  Three facets:
 *   - `last`  — continue the MOST-RECENT conversation in the cwd, no id needed
 *       (claude `-c`, codex `resume --last`, opencode `--continue`).
 *   - `byId`  — resume the EXACT conversation by its native ref (juspay/kolu#1495).
 *   - `idPattern` — the shell-inert shape gate a ref must pass before it is
 *       spliced via `byId`. Fail-closed: a same-agent ref whose ref fails this
 *       pattern yields NO resume (a bare shell), never a downgrade to `last`.
 *   - `ref`   — the persisted resume ref for a live session's info. Five agents
 *       write `(i) => i.sessionId`; pi writes `(i) => i.sessionPath`. REQUIRED,
 *       not optional: no default, no `??` collapse (conventions: no override
 *       knobs). */
export interface AgentResumePolicy<Info> {
  readonly last: string;
  readonly byId: (ref: string) => string;
  readonly idPattern: RegExp;
  readonly ref: (info: Info) => string;
}

/** Everything kolu must know about one agent, declared in its own package.
 *  An agent that forgets a facet fails to compile in its own package — the
 *  `satisfies never` fence relocated to the right home. */
export interface AgentVocab<Info extends AgentInfoShape> {
  /** Discriminator matching `Info["kind"]` (e.g. "claude-code", "opencode"). */
  readonly kind: Info["kind"];
  /** Human display name (`"Claude Code"`, `"OpenCode"`). */
  readonly displayName: string;
  /** The brand mark, rendered by both the tile chrome and the dock pip. */
  readonly mark: AgentMark;
  /** CLI recognition + normalization grammar. */
  readonly cli: AgentCliGrammar;
  /** How this agent resumes a prior conversation. */
  readonly resume: AgentResumePolicy<Info>;
  /** The wire schema for this agent's info — composed into the registry's
   *  closed `AgentInfoSchema` union. Typed `Codec` (not the wider `Schema`) so
   *  each member keeps `DecodingServices = never`; widening to `Schema<Info>`
   *  erases it to `unknown`, which then poisons every schema composed with the
   *  union (the `TerminalSnapshotSchema` decoders). */
  readonly infoSchema: Schema.Codec<Info>;
}

// biome-ignore lint/suspicious/noExplicitAny: `Info` is the existential here — the registry stores vocabs of different `Info` and looks them up by kind, and `AgentVocab<AgentInfoShape>` is NOT a supertype (the resume `ref` is contravariant in `Info`), so the erasure must be `any`.
export type AnyAgentVocab = AgentVocab<any>;
