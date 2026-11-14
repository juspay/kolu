/** The agent REGISTRY — the ONE place that lists kolu's agents.
 *
 *  Each `kolu-<agent>` package declares its own `AgentVocab` (the browser-safe
 *  facts) and `AgentPlugin` (adapter + fetcher + env keys). This module folds
 *  the vocabs into the closed `AgentKind`/`AgentInfo` wire vocabulary and the
 *  kind-keyed CLI registry, and re-binds every CLI function to that registry so
 *  call sites keep their names.
 *
 *  Browser-safe: imports only `kolu-<agent>/schemas` (vocab) and `anyagent`. The node
 *  half — `AGENT_PLUGINS`, `AGENT_DIR_ENV_KEYS` — lives in `./index.ts`.
 *
 *  WHY A SEPARATE PACKAGE (and not `anyagent`): `anyagent` is the receptacle and
 *  must name no agent (the anyforge note). This package names kolu's agents by
 *  design — it fails the electricity test ① (domain-agnostic), so it is
 *  `kolu-agents` under `packages/integrations/`, not `@kolu/*`. */

import {
  type AgentCliGrammar,
  type AgentCliRegistry,
  type AnyAgentVocab,
  agentLaunchLine as cliAgentLaunchLine,
  buildCliRegistry,
  resumableCommand as cliResumableCommand,
  resumeFormFor as cliResumeFormFor,
  willResume as cliWillResume,
} from "anyagent";
import {
  AGENT_PRESENCE_STATES,
  type AgentPresenceState,
  AgentPresenceStateSchema,
  type RestoreTarget,
} from "anyagent/schemas";
import { Schema } from "effect";
import { claudeCodeVocab } from "kolu-claude-code/schemas";
import { codexVocab } from "kolu-codex/schemas";
import { grokVocab } from "kolu-grok/schemas";
import { ompVocab } from "kolu-omp/schemas";
import { opencodeVocab } from "kolu-opencode/schemas";
import { piVocab } from "kolu-pi/schemas";
import { xyneVocab } from "kolu-xyne/schemas";

/** The agent vocabs, keyed by kind — the ONE list. Adding an agent is one import
 *  and one row here, plus the agent's own package. */
export const AGENT_VOCABS = {
  "claude-code": claudeCodeVocab,
  codex: codexVocab,
  opencode: opencodeVocab,
  grok: grokVocab,
  pi: piVocab,
  omp: ompVocab,
  xyne: xyneVocab,
} as const satisfies Record<string, AnyAgentVocab>;

/** The closed agent-kind union, derived from the registry — not a hand-copied
 *  literal list. */
export type AgentKind = keyof typeof AGENT_VOCABS;

/** The `AgentInfo` member for one kind — correlation so `agentVocab(kind)` and
 *  the wire union stay typed per kind. */
export type AgentInfoOf<K extends AgentKind> =
  (typeof AGENT_VOCABS)[K]["infoSchema"]["Type"];

/** The closed kind vocabulary as an Effect schema, derived from the registry. */
export const AgentKindSchema = Schema.Literals(
  Object.keys(AGENT_VOCABS) as [AgentKind, ...AgentKind[]],
);

/** The info-schema tuple type — a tuple (not a bare array) so `Schema.Union`
 *  infers `Members[number]` as the union of the concrete schemas rather than a
 *  widened `Schema.Top`, which would erase each member's `DecodingServices`
 *  (it must stay `never` for the composed snapshot schema to typecheck). */
type AgentInfoSchemaTuple = readonly [
  (typeof AGENT_VOCABS)[AgentKind]["infoSchema"],
  ...(typeof AGENT_VOCABS)[AgentKind]["infoSchema"][],
];

/** The SESSION-BACKED `AgentInfo` union, composed from every vocab's schema —
 *  what an agent's own watcher derives from its transcript. */
const SessionAgentInfoSchema = Schema.Union(
  Object.values(AGENT_VOCABS).map(
    (v) => v.infoSchema,
  ) as unknown as AgentInfoSchemaTuple,
);

/** An agent that is HERE but has no session kolu can read yet — the daemon's
 *  process fact ({@link AGENT_PRESENCE_STATES}: `starting`, then `fresh`, then
 *  `prompted` once something is submitted to it), minted for every kind from
 *  the foreground and the input padi forwards. Every transcript field is
 *  `null` because there is no transcript; `sessionId` is `null` unless the
 *  agent itself names its session before writing it (omp's `fresh`
 *  breadcrumb, Claude's `sessions/<pid>.json` — `AgentAdapter.presenceSessionId`).
 *
 *  ONE member for every kind rather than three literals in every agent's own
 *  `state` set: no agent package can derive any of them from its transcript,
 *  and a presence carries none of an agent's own fields (omp's `sessionPath`,
 *  Claude's `workflow`), so code that narrows to one kind's info must first
 *  rule presence out — which the compiler now asks of it. The state sets are
 *  disjoint, so the wire decode picks this member exactly when the state is a
 *  presence state. */
export const AgentPresenceSchema = Schema.Struct({
  kind: AgentKindSchema,
  state: AgentPresenceStateSchema,
  sessionId: Schema.NullOr(Schema.String),
  model: Schema.Null,
  summary: Schema.Null,
  taskProgress: Schema.Null,
  contextTokens: Schema.Null,
  startedAt: Schema.Null,
});
export type AgentPresence = typeof AgentPresenceSchema.Type;

/** The discriminated `AgentInfo` union: every vocab's session-backed schema,
 *  plus {@link AgentPresenceSchema}. Stays a CLOSED union so consumers can
 *  `match(...).exhaustive()` on kind. */
export const AgentInfoSchema = Schema.Union([
  SessionAgentInfoSchema,
  AgentPresenceSchema,
]);

export type AgentInfo = typeof AgentInfoSchema.Type;

/** An agent value that came from its own transcript — `AgentInfo` minus
 *  presence. */
export type SessionAgentInfo = Exclude<AgentInfo, AgentPresence>;

/** Is this agent value a PRESENCE — an agent with no readable session yet? The
 *  one test, read off the state (the two state sets are disjoint), so the
 *  narrowing and the wire decode cannot disagree. */
export function isAgentPresence(info: AgentInfo): info is AgentPresence {
  return (AGENT_PRESENCE_STATES as readonly string[]).includes(info.state);
}

/** Build the presence value for one agent — the ONE constructor, so a field
 *  added to {@link AgentPresenceSchema} is filled in one place. */
export function agentPresence(
  kind: AgentKind,
  state: AgentPresenceState,
  sessionId: string | null,
): AgentPresence {
  return {
    kind,
    state,
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    contextTokens: null,
    startedAt: null,
  };
}

/** Look up one agent's vocab by kind. */
export function agentVocab<K extends AgentKind>(
  kind: K,
): (typeof AGENT_VOCABS)[K] {
  return AGENT_VOCABS[kind];
}

/** Narrow a raw string to an `AgentKind` — `Object.hasOwn`, never `in`, so a
 *  wire word like `"toString"` cannot narrow as a kind it is not. */
export function isAgentKind(raw: string): raw is AgentKind {
  return Object.hasOwn(AGENT_VOCABS, raw);
}

/** The CLI grammar (binary name + stable-flag allowlist) for an OPEN kind —
 *  the sensor's argv filter reads it. CRASHES when this build does not know the
 *  kind: for a caller holding kolu's own data (our adapters, our registry) that
 *  is a programming error, not a user-facing condition. A PERSISTED record takes
 *  the non-throwing door (`resumeFormFor` → bare shell) instead. */
export function agentCliGrammar(kind: string): AgentCliGrammar {
  if (!isAgentKind(kind)) throw new Error(`unknown agent kind: ${kind}`);
  return AGENT_VOCABS[kind].cli;
}

/** Does this basename name one of kolu's agent binaries? The sensor asks it of a
 *  PTY mark's head token to decide whether an agent may be launching — a
 *  question about our registry, never about the mark's content. */
export function isAgentBinaryName(name: string): boolean {
  return Object.values(AGENT_VOCABS).some(
    (vocab) => vocab.cli.basename === name,
  );
}

/** Map every registered vocab to a uniform value, preserving the kind key — a
 *  typed `Object.fromEntries` whose call sites need no cast. The ONE cast lives
 *  here, where the key set is the registry itself. */
export function mapAgentVocabs<R>(
  f: (vocab: AnyAgentVocab, kind: AgentKind) => R,
): Record<AgentKind, R> {
  const out = {} as Record<AgentKind, R>;
  for (const kind of Object.keys(AGENT_VOCABS) as AgentKind[]) {
    out[kind] = f(AGENT_VOCABS[kind], kind);
  }
  return out;
}

/** The persisted resume ref for a LIVE agent's info — `vocab.resume.ref(info)`.
 *  The single place the kind↔Info correlation lost at a union-typed
 *  `agent.kind` is re-asserted (the one `AnyAgentVocab` widening in the
 *  registry). Takes a SESSION-BACKED info only: a presence has no conversation
 *  to resume, so the caller rules it out first ({@link isAgentPresence}). */
export function resumeRefFor(agent: SessionAgentInfo): string {
  const vocab: AnyAgentVocab = AGENT_VOCABS[agent.kind];
  return vocab.resume.ref(agent);
}

/** The kind-keyed CLI registry. Built once at module init; a duplicate kind
 *  throws there (crash loudly, AGENTS.md) — the compile fence the old
 *  `BASENAME_TO_KIND` record had becomes a load-time fence. */
export const AGENT_CLI: AgentCliRegistry = buildCliRegistry(
  Object.values(AGENT_VOCABS),
);

// ── The CLI functions, pre-bound to `AGENT_CLI` and re-exported under the same
//    names anyagent uses, so a call site changes only its import path. ──

/** Render a restore target into the resume form a fresh shell is typed. */
export const resumeFormFor = (
  target: RestoreTarget | undefined,
): string | null => cliResumeFormFor(AGENT_CLI, target);

/** Would a wake resume this target? The ONE gate the display/decision sites ask
 *  instead of rendering a full command line to compare with `null`. */
export const willResume = (
  target: RestoreTarget | undefined,
): target is Extract<RestoreTarget, { kind: "exact" }> =>
  cliWillResume(AGENT_CLI, target);

/** The launch line a display site shows (gated on wake actually resuming). */
export const resumableCommand = (
  target: RestoreTarget | undefined,
): string | null => cliResumableCommand(AGENT_CLI, target);

/** Render `kind argv…` for the recent-agents palette and the typed launch line
 *  — the ONE renderer of a stored `{ kind, argv }` fact. `null` for a kind this
 *  build no longer knows (a stale MRU row renders nothing, never a guess). */
export const agentLaunchLine = (
  kind: string,
  argv: readonly string[],
): string | null => cliAgentLaunchLine(AGENT_CLI, kind, argv);

export type {
  AgentCliRegistry,
  AgentCliGrammar,
  AgentMark,
  AgentResumePolicy,
  AgentSayDelivery,
  AgentSayRecipe,
  AgentSayWhileWorking,
  AgentVocab,
} from "anyagent";
export { agentNameHint, stableFlagTokens } from "anyagent";

// The per-agent info types, re-exported so consumers that used to import them
// from `@kolu/terminal-vocab/schema` (which no longer depends on the agent
// packages) resolve them through the registry door.
export type { ClaudeCodeInfo } from "kolu-claude-code/schemas";
export type { CodexInfo } from "kolu-codex/schemas";
export type { GrokInfo } from "kolu-grok/schemas";
export type { OpenCodeInfo } from "kolu-opencode/schemas";
export type { OmpInfo } from "kolu-omp/schemas";
export type { PiInfo } from "kolu-pi/schemas";
export type { XyneInfo } from "kolu-xyne/schemas";
export type { TaskProgress } from "anyagent/schemas";
