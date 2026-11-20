import { agentVocab, isAgentKind } from "kolu-agents/vocab";
import { DASH } from "./dash.ts";
import { compactPhrase } from "./duration.ts";
import type { AgentInfo, TerminalSnapshot } from "./schema.ts";

/** The em-dash sentinel for "no value / never observed" — the recency cell's
 *  empty state, and the answer this file gives for a terminal in no git repo,
 *  with no agent, or with no PR check. */
export { DASH } from "./dash.ts";

/** Compact relative age (`3s`/`5m`/`2h`/`4d`) of an epoch-millis against `now`;
 *  `0` (no agent activity ever observed) renders as a dash. */
export function relativeTime(ms: number, now: number): string {
  return ms <= 0 ? DASH : compactPhrase(now - ms);
}

/** The agent vendor's short label — `claude-code` reads as `claude`. An unknown
 *  kind reads verbatim. */
export function agentShortName(kind: string): string {
  return isAgentKind(kind) ? agentVocab(kind).cli.basename : kind;
}

/** The coarse bucket an agent's fine-grained state falls in. A `default` is
 *  kept so an unrecognized state surfaces as `other` (shown verbatim) at
 *  runtime rather than throwing. */
export function agentBucket(
  state: AgentInfo["state"],
): "working" | "awaiting" | "waiting" | "starting" | "fresh" | "other" {
  switch (state) {
    case "prompted":
    case "thinking":
    case "tool_use":
    case "running_background":
      return "working";
    case "awaiting_user":
      return "awaiting";
    case "waiting":
      return "waiting";
    case "starting":
      return "starting";
    case "fresh":
      return "fresh";
    default:
      state satisfies never;
      return "other";
  }
}

/** Is the agent LIVE — working, or blocked on you — so that ending its process
 *  would cost something? */
export function agentLive(state: AgentInfo["state"]): boolean {
  const bucket = agentBucket(state);
  return bucket === "working" || bucket === "awaiting";
}

/** Is padi waiting on this agent's SCREEN to settle — the presence states a
 *  quiet screen moves to `fresh`? */
export function awaitsScreenSettle(state: AgentInfo["state"]): boolean {
  switch (state) {
    case "starting":
    case "prompted":
      return true;
    case "fresh":
    case "thinking":
    case "tool_use":
    case "running_background":
    case "awaiting_user":
    case "waiting":
      return false;
    default:
      state satisfies never;
      return false;
  }
}

/** The coarse agent buckets a wait or a watch accepts as TARGETS — the
 *  {@link agentBucket} fold's vocabulary minus `other` (an `other` bucket never
 *  matches a real agent, so accepting it would only ever time out). */
export const WAIT_STATES = [
  "working",
  "awaiting",
  "waiting",
  "starting",
  "fresh",
] as const satisfies readonly Exclude<
  ReturnType<typeof agentBucket>,
  "other"
>[];

export type WaitState = (typeof WAIT_STATES)[number];

/** Is `token` one of the wait buckets? */
export function isWaitState(token: string): token is WaitState {
  return (WAIT_STATES as readonly string[]).includes(token);
}

/** What a supervision watch that names NO states means: the two buckets that
 *  need a person. */
export const WATCH_DEFAULT_STATES = [
  "awaiting",
  "waiting",
] as const satisfies readonly WaitState[];

/** The dashboard label for an agent's state, derived from its bucket. An
 *  unrecognized (`other`) state falls through verbatim so a new agent state is
 *  visible rather than silently collapsed. */
export function agentStatusLabel(state: AgentInfo["state"]): string {
  const bucket = agentBucket(state);
  return bucket === "other" ? state : bucket;
}

/** The coarse PAINT class an agent's state glows as. `awaiting` is the agent
 *  BLOCKED on you (`awaiting_user`), `linger` is the post-turn lull
 *  (`waiting`), `none` is the absent / unknown class (no glow). */
export type AgentPaintClass = "awaiting" | "linger" | "working" | "none";

/** Rename an ATTENTION class into the PAINT vocabulary — the ONE table that
 *  translates between the two. */
export function paintClassOf(klass: AttentionClass): AgentPaintClass {
  return PAINT_CLASS_OF[klass];
}

/** Map an agent's state to its PAINT class — a state-only fold, which does not
 *  consult the caller's EF2 `finished` verdict. */
export function agentPaintClass(state: AgentInfo["state"]): AgentPaintClass {
  return paintClassOf(attentionClassOfState(state, false));
}

/** The agent-state ALERT class — `notify` = the agent just finished its turn
 *  and yielded (`waiting`) or actively blocks on the user (`awaiting_user`);
 *  `quiet` = everything else. */
export type AlertClass = "notify" | "quiet";

/** Map an agent's state to its ALERT class. */
export function alertClass(state: AgentInfo["state"]): AlertClass {
  switch (state) {
    case "awaiting_user":
    case "waiting":
      return "notify";
    case "thinking":
    case "tool_use":
    case "running_background":
    case "prompted":
      return "quiet";
    case "starting":
    case "fresh":
      return "quiet";
    default:
      state satisfies never;
      return "quiet";
  }
}

/** Which attention list a terminal belongs to, given its agent AND whether its
 *  post-turn quiet window has closed (padi's EF2 "effective finish"). A closed
 *  five-way partition — every terminal is in exactly ONE class — so a count over
 *  the classes needs no de-duplication and a surface can't put the same terminal
 *  in two places.
 */
export type AttentionClass =
  | "asking"
  | "working"
  | "linger"
  | "finished"
  | "idle";

const PAINT_CLASS_OF: Record<AttentionClass, AgentPaintClass> = {
  asking: "awaiting",
  working: "working",
  linger: "linger",
  finished: "linger",
  idle: "none",
};
export const ATTENTION_CLASSES = Object.keys(
  PAINT_CLASS_OF,
) as readonly AttentionClass[];

/** Partition a terminal into its attention class. `finished` is the caller's
 *  EF2 verdict for this terminal (padi's finish-quiet tracker); it is consulted
 *  only for a `waiting` agent, where it decides linger-vs-finished. */
export function attentionClass(
  agent: TerminalSnapshot["agent"] | undefined,
  finished: boolean,
): AttentionClass {
  if (!agent) return "idle";
  return attentionClassOfState(agent.state, finished);
}

function attentionClassOfState(
  state: AgentInfo["state"],
  finished: boolean,
): AttentionClass {
  switch (agentBucket(state)) {
    case "awaiting":
      return "asking";
    case "working":
      return "working";
    case "waiting":
      return finished ? "finished" : "linger";
    case "starting":
    case "fresh":
      return "idle";
    case "other":
      return "idle";
  }
}

/** Is this terminal ACTIVE — is something happening in it right now?
 *
 *  `live` is raw byte motion (kaval's meaningful-output edge). It is what makes
 *  a plain shell running a build count as active — it has no agent to ask — and
 *  what keeps a terminal that has gone `finished` counted while its last output
 *  is still printing. */
export function attentionActive(klass: AttentionClass, live: boolean): boolean {
  switch (klass) {
    case "asking":
    case "working":
    case "linger":
      return true;
    case "finished":
    case "idle":
      return live;
  }
}

/** Does this terminal belong in a scope's ACTIVITY count? The same membership
 *  as `attentionActive` minus `asking`, which every surface counts in its own
 *  violet leg and must never also swell the rust one. */
export function attentionCounted(
  klass: AttentionClass,
  live: boolean,
): boolean {
  return klass !== "asking" && attentionActive(klass, live);
}

/** The coarse urgency of a terminal — drives the glyph, the colour/tone, and the
 *  needs-you-first sort. `need` = an agent awaiting you; `work` = an agent
 *  working; `idle` = everything else (waiting / unknown / no agent). */
export type Urgency = "need" | "work" | "idle";

/** Map an agent to its urgency. Accepts `undefined` as well as the schema's
 *  `AgentInfo | null`; both read as "no agent". */
export function agentUrgency(
  agent: TerminalSnapshot["agent"] | undefined,
): Urgency {
  if (!agent) return "idle";
  switch (agentBucket(agent.state)) {
    case "awaiting":
      return "need";
    case "working":
      return "work";
    case "starting":
    case "fresh":
    case "waiting":
    case "other":
      return "idle";
  }
}

/** The needs-you-first sort rank per urgency (lower floats up). */
export const URGENCY_RANK: Record<Urgency, number> = {
  need: 0,
  work: 1,
  idle: 2,
};

/** The pointed state label, given a renderer's label words per urgency: a
 *  `need`/`work` agent reads the renderer's label; an idle agent shows its own
 *  state (e.g. "waiting", or a verbatim unknown state); a terminal with no agent
 *  reads the idle label. The ONLY thing a renderer customizes is the label
 *  words — the three-way idle fork lives once, here. */
export function fleetStateLabel(
  agent: TerminalSnapshot["agent"],
  labels: Record<Urgency, string>,
): string {
  const urgency = agentUrgency(agent);
  if (urgency !== "idle") return labels[urgency];
  if (!agent) return labels.idle;
  return agentStatusLabel(agent.state);
}

function urgencyRankDelta(
  a: TerminalSnapshot["agent"],
  b: TerminalSnapshot["agent"],
): number {
  return URGENCY_RANK[agentUrgency(a)] - URGENCY_RANK[agentUrgency(b)];
}

/** Order two agents by urgency alone, then a stable id tiebreak — the HOST-SAFE
 *  ordering a memoryless dashboard uses; it reads no recency. */
export function compareAgentUrgency(
  a: { agent: TerminalSnapshot["agent"]; id: string },
  b: { agent: TerminalSnapshot["agent"]; id: string },
): number {
  return urgencyRankDelta(a.agent, b.agent) || a.id.localeCompare(b.id);
}

function compareRecency(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Order two agents within a scope: needs-you first, then most-recently-active,
 *  then a stable id tiebreak. */
export function compareAgents(
  a: {
    agent: TerminalSnapshot["agent"];
    lastActivityAt: number | null;
    id: string;
  },
  b: {
    agent: TerminalSnapshot["agent"];
    lastActivityAt: number | null;
    id: string;
  },
): number {
  const recencyDelta = compareRecency(a.lastActivityAt, b.lastActivityAt);
  return (
    urgencyRankDelta(a.agent, b.agent) ||
    recencyDelta ||
    a.id.localeCompare(b.id)
  );
}
