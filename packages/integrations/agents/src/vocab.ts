/** The agent REGISTRY — the ONE place that lists kolu's agents.
 *
 *  Each `kolu-<agent>` package declares its own `AgentVocab` (the browser-safe
 *  facts) and `AgentPlugin` (adapter + fetcher + env keys). This module folds
 *  the vocabs into the closed `AgentKind`/`AgentInfo` wire vocabulary and the
 *  basename-keyed CLI registry, and re-binds every CLI function to that
 *  registry so call sites keep their names.
 *
 *  Browser-safe: imports only `kolu-<agent>/schemas` (vocab) and `anyagent`. The node
 *  half — `AGENT_PLUGINS`, `AGENT_DIR_ENV_KEYS` — lives in `./index.ts`.
 *
 *  WHY A SEPARATE PACKAGE (and not `anyagent`): `anyagent` is the receptacle and
 *  must name no agent (the anyforge note). This package names kolu's agents by
 *  design — it fails the electricity test ① (domain-agnostic), so it is
 *  `kolu-agents` under `packages/integrations/`, not `@kolu/*`. */

import {
  type AgentCliRegistry,
  type AnyAgentVocab,
  type AgentCliGrammar,
  agentKindFromCommand as cliAgentKindFromCommand,
  buildCliRegistry,
  exactRestoreTarget as cliExactRestoreTarget,
  parseAgentCommand as cliParseAgentCommand,
  resumableCommand as cliResumableCommand,
  resumeAgentCommand as cliResumeAgentCommand,
  resumeFormFor as cliResumeFormFor,
} from "anyagent";
import type { AgentIdentity, RestoreTarget } from "anyagent/schemas";
import { Schema } from "effect";
import { claudeCodeVocab } from "kolu-claude-code/schemas";
import { codexVocab } from "kolu-codex/schemas";
import { grokVocab } from "kolu-grok/schemas";
import { ompVocab } from "kolu-omp/schemas";
import { opencodeVocab } from "kolu-opencode/schemas";
import { piVocab } from "kolu-pi/schemas";
import { xyneVocab } from "kolu-xyne/schemas";

/** The detect-only agents — binaries kolu recognizes for the recent-agents MRU
 *  but has no session/agent discriminator for. They carry CLI grammar ONLY (no
 *  `kind`, no info schema, no resume), so `agentKindFromCommand` and the resume
 *  path return null for them while `parseAgentCommand` still normalizes their
 *  invocation. This was the non-vocab half of the old `STABLE_FLAGS` map. */
export const DETECT_ONLY_AGENTS: readonly AgentCliGrammar[] = [
  {
    basename: "aider",
    stableFlags: new Map([["--model", "value"]]),
    extraExitFlags: new Set(),
    nonSessionFlags: new Set(),
    nonSessionSubcommands: new Set(),
  },
  {
    basename: "goose",
    stableFlags: new Map(),
    extraExitFlags: new Set(),
    nonSessionFlags: new Set(),
    nonSessionSubcommands: new Set(),
  },
  {
    basename: "gemini",
    stableFlags: new Map(),
    extraExitFlags: new Set(),
    nonSessionFlags: new Set(),
    nonSessionSubcommands: new Set(),
  },
  {
    basename: "cursor-agent",
    stableFlags: new Map(),
    extraExitFlags: new Set(),
    nonSessionFlags: new Set(),
    nonSessionSubcommands: new Set(),
  },
];

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

/** The discriminated `AgentInfo` union, composed from every vocab's schema.
 *  Stays a CLOSED union so consumers can `match(...).exhaustive()` on kind. */
export const AgentInfoSchema = Schema.Union(
  Object.values(AGENT_VOCABS).map(
    (v) => v.infoSchema,
  ) as unknown as AgentInfoSchemaTuple,
);

export type AgentInfo = typeof AgentInfoSchema.Type;

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
 *  registry). */
export function resumeRefFor(agent: AgentInfo): string {
  const vocab: AnyAgentVocab = AGENT_VOCABS[agent.kind];
  return vocab.resume.ref(agent);
}

/** The basename-keyed CLI registry. Built once at module init; a duplicate
 *  kind or basename throws there (crash loudly, conventions.md) — the compile
 *  fence the old `BASENAME_TO_KIND` record had becomes a load-time fence. */
export const AGENT_CLI: AgentCliRegistry = buildCliRegistry(
  Object.values(AGENT_VOCABS),
  DETECT_ONLY_AGENTS,
);

// ── The CLI functions, pre-bound to `AGENT_CLI` and re-exported under the same
//    names anyagent uses, so a call site changes only its import path. ──

export const parseAgentCommand = (
  raw: string,
  shellJoinFormat?: boolean,
): string | null => cliParseAgentCommand(AGENT_CLI, raw, shellJoinFormat);

export const resumeAgentCommand = (
  normalized: string,
  session?: AgentIdentity,
): string | null => cliResumeAgentCommand(AGENT_CLI, normalized, session);

export const resumeFormFor = (
  target: RestoreTarget | undefined,
): string | null => cliResumeFormFor(AGENT_CLI, target);

export const resumableCommand = (
  target: RestoreTarget | undefined,
): string | null => cliResumableCommand(AGENT_CLI, target);

/** Resolve an agent command string to its kind, narrowed to `AgentKind | null`
 *  at the registry boundary — callers never re-narrow. */
export const agentKindFromCommand = (command: string): AgentKind | null => {
  const kind = cliAgentKindFromCommand(AGENT_CLI, command);
  return kind !== null && isAgentKind(kind) ? kind : null;
};

export const exactRestoreTarget = (
  command: string,
  agent: AgentIdentity,
): RestoreTarget | null => cliExactRestoreTarget(AGENT_CLI, command, agent);

export type {
  AgentCliRegistry,
  AgentCliGrammar,
  AgentMark,
  AgentResumePolicy,
  AgentVocab,
} from "anyagent";
export { agentNameFromCommand } from "anyagent";

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
