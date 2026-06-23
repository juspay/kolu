/**
 * The renderer-agnostic agent-state projection — the ONE copy of "how an
 * `AwarenessValue`/`AgentInfo` folds to a coarse bucket, an urgency, a recency
 * string, a short agent name, and a needs-you-first ordering". Pure functions
 * over the schema types, no colours, no labels, no DOM, no OpenTUI — so both the
 * pulam-tui dashboard and the pulam-web fleet board import the SAME logic and a
 * new agent state can't drift between them.
 *
 * This is the freshness-critical vocabulary `AgentInfoSchema` owns: the closed
 * state set ({thinking, tool_use, running_background, awaiting_user, waiting})
 * and how it folds to {need, work, idle}. It belongs here, beside that schema,
 * because the projection depends on nothing but the `AgentInfo['state']` type —
 * it has no transport, no renderer, no `@kolu/pulam-tui` coupling. Each consumer
 * keeps only its PRESENTATION layer over this core: the TUI maps urgency→tone
 * (`palette.ts`) and labels it "awaiting you"; the web maps urgency→hex
 * (`URGENCY.color`) and labels it "needs you".
 */

import type { AgentInfo, AwarenessValue } from "./schema.ts";

/** The em-dash sentinel for "no value / never observed" — the recency cell's
 *  empty state, spelled once here so every renderer (and any direct read) shares
 *  the one glyph. */
export const DASH = "—";

/** Compact relative age (`3s`/`5m`/`2h`/`4d`) of an epoch-millis against `now`;
 *  `0` (no agent activity ever observed) renders as a dash. */
export function relativeTime(ms: number, now: number): string {
  if (ms <= 0) return DASH;
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The agent vendor's short label — `claude-code` reads as `claude`. */
export function agentShortName(kind: string): string {
  return kind === "claude-code" ? "claude" : kind;
}

/** The coarse bucket an agent's fine-grained state falls in. The closed union
 *  lets a tone/label decision switch exhaustively over it. Keyed on the schema's
 *  own `AgentInfo['state']` (not a bare `string`) with a `satisfies never` fence
 *  on the default arm: a new state literal added to `AgentInfoSchema` then
 *  compile-fails HERE — in the single shared definition — rather than silently
 *  routing to idle in a hand-copied switch. (Mirrors `dockModel.ts`'s fence; the
 *  fleet's `waiting` semantics differ from the dock's, so the two buckets stay
 *  separate.) A `default` is still kept so an unrecognized state surfaces as
 *  `other` (shown verbatim) at runtime rather than throwing. */
export function agentBucket(
  state: AgentInfo["state"],
): "working" | "awaiting" | "waiting" | "other" {
  switch (state) {
    case "thinking":
    case "tool_use":
    case "running_background":
      return "working";
    case "awaiting_user":
      return "awaiting";
    case "waiting":
      return "waiting";
    default:
      // Exhaustiveness fence: a new `AgentInfo["state"]` literal stops this
      // compiling, forcing a bucket decision here instead of falling to `other`.
      state satisfies never;
      return "other";
  }
}

/** The dashboard label for an agent's state, derived from its bucket. An
 *  unrecognized (`other`) state falls through verbatim so a new agent state is
 *  visible rather than silently collapsed. */
export function agentStatusLabel(state: AgentInfo["state"]): string {
  const bucket = agentBucket(state);
  return bucket === "other" ? state : bucket;
}

/** The coarse urgency of a terminal — drives the glyph, the colour/tone, and the
 *  needs-you-first sort. `need` = an agent awaiting you; `work` = an agent
 *  working; `idle` = everything else (waiting / unknown / no agent). */
export type Urgency = "need" | "work" | "idle";

/** Map an agent to its urgency. The exhaustive switch over the closed
 *  `agentBucket` union means a new bucket forces a decision here rather than
 *  silently falling to idle. */
export function agentUrgency(agent: AwarenessValue["agent"]): Urgency {
  if (!agent) return "idle";
  switch (agentBucket(agent.state)) {
    case "awaiting":
      return "need";
    case "working":
      return "work";
    case "waiting":
    case "other":
      return "idle";
  }
}

/** The needs-you-first sort rank per urgency (lower floats up). The renderer's
 *  own urgency descriptor (TUI tone+label, web hex+label) carries the rest of
 *  the presentation; the rank — the volatile sort axis — lives here so both
 *  orderings can't disagree. */
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
  agent: AwarenessValue["agent"],
  labels: Record<Urgency, string>,
): string {
  const urgency = agentUrgency(agent);
  if (urgency !== "idle") return labels[urgency];
  if (!agent) return labels.idle;
  return agentStatusLabel(agent.state);
}

/** Order two agents within a scope: needs-you first, then most-recently-active,
 *  then a caller-supplied stable id tiebreak. The ONE ordering every fleet view
 *  (per-host, flat needs, agent sections) shares — the rank, recency, and
 *  tiebreak braided once so two scopes can't fall back to iteration order. */
export function compareAgents(
  a: { agent: AwarenessValue["agent"]; lastActivityAt: number; id: string },
  b: { agent: AwarenessValue["agent"]; lastActivityAt: number; id: string },
): number {
  const ra = URGENCY_RANK[agentUrgency(a.agent)];
  const rb = URGENCY_RANK[agentUrgency(b.agent)];
  if (ra !== rb) return ra - rb;
  if (a.lastActivityAt !== b.lastActivityAt)
    return b.lastActivityAt - a.lastActivityAt;
  return a.id.localeCompare(b.id);
}
