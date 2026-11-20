import {
  type AgentCliGrammar,
  type AgentCliRegistry,
  type AgentSayRecipe,
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

export const AGENT_VOCABS = {
  "claude-code": claudeCodeVocab,
  codex: codexVocab,
  opencode: opencodeVocab,
  grok: grokVocab,
  pi: piVocab,
  omp: ompVocab,
  xyne: xyneVocab,
} as const satisfies Record<string, AnyAgentVocab>;

export type AgentKind = keyof typeof AGENT_VOCABS;

/** The keys that SUBMIT a prompt to some registered agent — the last key of
 *  each agent's own idle say recipe (`AgentSayRecipe.idle`), de-duplicated. */
export const AGENT_SUBMIT_KEYS: readonly string[] = [
  ...new Set(
    Object.values(AGENT_VOCABS as Record<string, AnyAgentVocab>).flatMap(
      (vocab) => vocab.say?.idle.slice(-1) ?? [],
    ),
  ),
];

export type AgentInfoOf<K extends AgentKind> =
  (typeof AGENT_VOCABS)[K]["infoSchema"]["Type"];

export const AgentKindSchema = Schema.Literals(
  Object.keys(AGENT_VOCABS) as [AgentKind, ...AgentKind[]],
);

type AgentInfoSchemaMember = (typeof AGENT_VOCABS)[AgentKind]["infoSchema"];

const SessionAgentInfoSchema = Schema.Union(
  Object.values(AGENT_VOCABS).map((v) => v.infoSchema) as [
    AgentInfoSchemaMember,
    ...AgentInfoSchemaMember[],
  ],
);

type TranscriptPresenceCollision = Extract<
  typeof SessionAgentInfoSchema.Type.state,
  AgentPresenceState
>;
true satisfies [TranscriptPresenceCollision] extends [never]
  ? true
  : [
      "a transcript state collides with a presence state",
      TranscriptPresenceCollision,
    ];

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

export const AgentInfoSchema = Schema.Union([
  SessionAgentInfoSchema,
  AgentPresenceSchema,
]);

export type AgentInfo = typeof AgentInfoSchema.Type;

export type SessionAgentInfo = Exclude<AgentInfo, AgentPresence>;

export function isAgentPresence(info: AgentInfo): info is AgentPresence {
  return (AGENT_PRESENCE_STATES as readonly string[]).includes(info.state);
}

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

export function agentVocab<K extends AgentKind>(
  kind: K,
): (typeof AGENT_VOCABS)[K] {
  return AGENT_VOCABS[kind];
}

export function agentSayRecipe(
  kind: AgentKind,
): AgentSayRecipe<AgentInfo> | null {
  const say: AgentSayRecipe<AgentInfo> | null = (
    AGENT_VOCABS[kind] as AnyAgentVocab
  ).say;
  const working = say?.working ?? null;
  if (
    say === null ||
    working === null ||
    working.delivery === "queue" ||
    working.sight === "unmeasured"
  ) {
    return say;
  }
  const sight = working.sight;
  return {
    ...say,
    working: {
      ...working,
      sight: {
        pane: sight.pane,
        lastPrompt: (info) =>
          info.kind !== kind || isAgentPresence(info)
            ? null
            : sight.lastPrompt(info),
      },
    },
  };
}

export function isAgentKind(raw: string): raw is AgentKind {
  return Object.hasOwn(AGENT_VOCABS, raw);
}

/** The CLI grammar (binary name + stable-flag allowlist) for one kind. THROWS
 *  when this build does not know the kind. */
export function agentCliGrammar(kind: string): AgentCliGrammar {
  if (!isAgentKind(kind)) throw new Error(`unknown agent kind: ${kind}`);
  return AGENT_VOCABS[kind].cli;
}

export function isAgentBinaryName(name: string): boolean {
  return Object.values(AGENT_VOCABS).some(
    (vocab) => vocab.cli.basename === name,
  );
}

export function mapAgentVocabs<R>(
  f: (vocab: AnyAgentVocab, kind: AgentKind) => R,
): Record<AgentKind, R> {
  const out = {} as Record<AgentKind, R>;
  for (const kind of Object.keys(AGENT_VOCABS) as AgentKind[]) {
    out[kind] = f(AGENT_VOCABS[kind], kind);
  }
  return out;
}

export function resumeRefFor(agent: SessionAgentInfo): string {
  const vocab: AnyAgentVocab = AGENT_VOCABS[agent.kind];
  return vocab.resume.ref(agent);
}

export const AGENT_CLI: AgentCliRegistry = buildCliRegistry(
  Object.values(AGENT_VOCABS),
);

export const resumeFormFor = (
  target: RestoreTarget | undefined,
): string | null => cliResumeFormFor(AGENT_CLI, target);

export const willResume = (
  target: RestoreTarget | undefined,
): target is Extract<RestoreTarget, { kind: "exact" }> =>
  cliWillResume(AGENT_CLI, target);

/** The launch line a display site shows; `null` unless a wake would resume. */
export const resumableCommand = (
  target: RestoreTarget | undefined,
): string | null => cliResumableCommand(AGENT_CLI, target);

/** Render `kind argv…` for a stored `{ kind, argv }` fact; `null` for a kind
 *  this build no longer knows. */
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
  PaneReading,
  SteerPrompt,
  SteerSight,
  AgentVocab,
} from "anyagent";
export {
  agentNameHint,
  normalisePromptText,
  paneHolds,
  promptTextIs,
  stableFlagTokens,
} from "anyagent";

export type { ClaudeCodeInfo } from "kolu-claude-code/schemas";
export type { CodexInfo } from "kolu-codex/schemas";
export type { GrokInfo } from "kolu-grok/schemas";
export type { OpenCodeInfo } from "kolu-opencode/schemas";
export type { OmpInfo } from "kolu-omp/schemas";
export type { PiInfo } from "kolu-pi/schemas";
export type { XyneInfo } from "kolu-xyne/schemas";
export type { TaskProgress } from "anyagent/schemas";
