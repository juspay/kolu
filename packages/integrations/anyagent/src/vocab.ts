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

/** The interpreter/package-manager foregrounds a Node-distributed agent hides
 *  behind: npm/pnpm/yarn/bun installs all run as their runtime, so the kernel
 *  basename is the interpreter, not the agent. A shared VALUE — the packaging
 *  fact is the same for every Node-distributed CLI — while each vocab still
 *  declares the field (the boundary that revs with its own packaging). An agent
 *  on another runtime declares its own set (Xyne: `python`/`uv`). */
export const NODE_CLI_SHIMS: ReadonlySet<string> = new Set([
  "node",
  "nodejs",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
]);

/** A canonical UUID (session ids for most agents, and Xyne's resume ref). */
export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** An agent whose resume ref may be EITHER a native id or a transcript PATH
 *  (pi, omp): an absolute path ending in `.jsonl`, or a UUID. */
export const SESSION_PATH_OR_UUID_RE =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\/[\w .,@=+(){}#%/~-]*\.jsonl)$/;

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

/** An agent's CLI grammar — the two facts kolu needs to turn the agent's
 *  REGISTRY vocab plus a live process's argv into a launch line. `basename` is
 *  the binary name (`"claude"`, `"xyne"`); `stableFlags` is the allowlist of
 *  flags that define a meaningfully different invocation.
 *
 *  No exit/non-session carve-outs live here any more: those existed to decide
 *  whether a user-TYPED line named an agent session. kolu no longer reads a
 *  captured command line at all — an agent is identified by the foreground
 *  process and its session file, and its flags are read from the LIVE process's
 *  argv, which by definition belongs to a running session. */
export interface AgentCliGrammar {
  /** The binary name, e.g. `"claude"`, `"xyne"`. */
  readonly basename: string;
  /** Foreground process names that HIDE this agent's CLI: an npm/pip-installed
   *  agent runs as its interpreter, so the kernel basename never names it. A
   *  shell's preexec hint may break the tie ONLY against one of these — the exact
   *  case juspay/kolu#673 needed. Declared per agent, beside
   *  `basename`/`stableFlags`, so it revs with the agent's OWN packaging: a
   *  `uv`-installed agent adds `uv` in its own package, and one agent's shims can
   *  never claim another agent.
   *
   *  This does NOT close the residual: a forged mark naming THIS agent while one
   *  of these interpreters runs a non-agent program (`node` running vite) still
   *  matches, and a cwd-keyed resolver (codex / opencode / pi / xyne) can then
   *  claim a session from the directory. The alternative — never trusting a hint
   *  — blinds every npm-installed agent, which is why the window exists. */
  readonly shims: ReadonlySet<string>;
  /** Allowlist of flags that define a meaningfully different invocation, each
   *  mapped to its arity. Only these survive capture from the process argv; a
   *  flag not listed is dropped silently — the safe default. */
  readonly stableFlags: ReadonlyMap<string, FlagArity>;
}

/** How an agent resumes a prior conversation — the whole per-agent resume
 *  policy, declared in the agent's own vocab, so "how does agent X resume?" is
 *  one thing in one place.
 *
 *  Three facets:
 *   - `byId`  — resume the EXACT conversation by its native ref (juspay/kolu#1495).
 *   - `idPattern` — the shell-inert shape gate a ref must pass before it is
 *       spliced via `byId`. Fail-closed: a ref that fails this pattern yields NO
 *       resume (a bare shell) — there is no most-recent fallback to downgrade to.
 *   - `ref`   — the persisted resume ref for a live session's info. Four agents
 *       write `(i) => i.sessionId`; pi (the fifth) writes `(i) => i.sessionPath`.
 *       REQUIRED, not optional: no default, no `??` collapse (conventions: no
 *       override knobs).
 *
 *  There is deliberately no `last` spelling: resume always names the conversation
 *  kolu observed, so the "most recent in this directory" fallback has no reader
 *  and is gone with the captured-launch-line world. */
export interface AgentResumePolicy<Info> {
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
