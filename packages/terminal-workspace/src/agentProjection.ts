/**
 * The agent-state projection — the ONE schema-fenced home for "how an
 * `AwarenessValue`/`AgentInfo['state']` folds to a coarse class". Pure functions
 * over the schema types, no colours, no labels, no DOM, no OpenTUI, so a new
 * agent state can't drift across the consumers that fold it. Each fold is a
 * switch over the closed state set ({thinking, tool_use, running_background,
 * awaiting_user, waiting}) with a `state satisfies never` fence, so a literal
 * added to `AgentInfoSchema` compile-fails HERE — beside the schema — rather
 * than in a hand-copied switch downstream. It depends on nothing but the
 * `AgentInfo['state']` type: no transport, no renderer, no `@kolu/pulam-tui`.
 *
 * This is the shared agent-state VOCABULARY that kolu's on-canvas **Dock** and
 * its two fleet MIRRORS — `pulam-web` (browser) and `pulam-tui` (terminal) — all
 * draw from: the mirrors render the same agent-state UX the Dock does, so each
 * fold lives here once and the three stay in lockstep. A mirror that hasn't
 * adopted a fold yet is a GAP to fill, not a sign the fold is kolu-only. The
 * three folds:
 *  - `agentUrgency` (→ {need, work, idle}) + `URGENCY_RANK` — the needs-you
 *    ordering. Read by all three (Dock rows, pulam-web, pulam-tui).
 *  - `agentPaintClass` (→ {awaiting, working, none}) — the pip/glyph paint
 *    class. Read by the Dock pip AND both fleet mirrors' agent glyph. It
 *    deliberately differs from urgency on `waiting`: a just-finished agent
 *    paints `awaiting` (the lingering dot) but RANKS idle — order≠colour.
 *  - `alertClass` (→ {notify, quiet}) — the fire-a-notification membership.
 *    Read by kolu's `useTerminalAlerts` today; pulam-web fleet notifications are
 *    the next mirror to fill in (see `pulam-web.mdx`). It notifies on a finished
 *    agent (`waiting`) too — "notify me something happened" ≠ "rank by what
 *    needs my action".
 *
 * Each consumer keeps only its PRESENTATION over this core: the TUI maps
 * urgency/paint→tone (`agentTone`/`URGENCY`) and labels "awaiting you"; the web
 * folds paint → the shared `StatePip` for each ROW pip (`pipVariantFor`) and
 * keeps `URGENCY` only for the needs-you strip + footer aggregate colours and
 * the "needs you" labels.
 */

import type { AgentInfo, Observation } from "./schema.ts";

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

/** The coarse PAINT class an agent's state glows as — the canvas tile aura, the
 *  minimap badge, the expanded-switcher columns, and the title pip all read it.
 *  A *different* partition from urgency: the paint vocabulary has no quiet-agent
 *  slot, so the post-turn lull (`waiting`) folds to `awaiting` — a just-finished
 *  agent keeps its glow until it parks — whereas `agentUrgency` ranks `waiting`
 *  as idle. The two legitimately disagree on `waiting`; they are co-located here
 *  (one schema-fenced file) but stay separate functions. `none` is the absent /
 *  unknown class (no glow). */
export type AgentPaintClass = "awaiting" | "working" | "none";

/** Map an agent's state to its PAINT class. Switches exhaustively over the
 *  closed `AgentInfo['state']` set with a `state satisfies never` fence on the
 *  default arm, so a new state literal added to `AgentInfoSchema` compile-fails
 *  HERE — forcing a paint decision in the single shared definition — rather than
 *  silently routing to `none` (a plain shell) in a hand-copied dock-local
 *  switch. */
export function agentPaintClass(state: AgentInfo["state"]): AgentPaintClass {
  switch (state) {
    case "thinking":
    case "tool_use":
    case "running_background":
      return "working";
    // The post-turn lull keeps its glow: a just-finished agent paints
    // `awaiting` until it parks (contrast `agentUrgency`, where `waiting` is
    // idle — paint and rank deliberately disagree here).
    case "awaiting_user":
    case "waiting":
      return "awaiting";
    default:
      // Exhaustiveness fence: a new `AgentInfo["state"]` literal stops this
      // compiling, forcing a paint decision here rather than falling to `none`.
      state satisfies never;
      return "none";
  }
}

/** The agent-state ALERT class — the partition the terminal alert layer
 *  (`useTerminalAlerts`) fires on. `notify` = the agent just finished its turn
 *  and yielded (`waiting`) or actively blocks on the user (`awaiting_user`);
 *  `quiet` = everything else. Folding the two notify states into ONE class means
 *  flipping between them within a session doesn't double-alert.
 *
 *  Deliberately a DIFFERENT partition from `agentUrgency` (where `waiting` is
 *  idle — a finished agent isn't asking you to *act*) and from `agentPaintClass`:
 *  "notify me something happened" and "rank by what needs my action" are
 *  different questions, so they classify `waiting` differently, on purpose. The
 *  three folds disagree on `waiting` by design; they live here together only so
 *  the closed state set is folded in ONE schema-fenced file. */
export type AlertClass = "notify" | "quiet";

/** Map an agent's state to its ALERT class. Switches exhaustively over the
 *  closed `AgentInfo['state']` set with a `state satisfies never` fence on the
 *  default arm, so a new state literal added to `AgentInfoSchema` compile-fails
 *  HERE — forcing an alert decision in the single shared definition — rather
 *  than silently staying `quiet` and dropping the notification. */
export function alertClass(state: AgentInfo["state"]): AlertClass {
  switch (state) {
    case "awaiting_user":
    case "waiting":
      return "notify";
    case "thinking":
    case "tool_use":
    case "running_background":
      return "quiet";
    default:
      // Exhaustiveness fence: a new `AgentInfo["state"]` literal stops this
      // compiling, forcing an alert decision here rather than falling to `quiet`.
      state satisfies never;
      return "quiet";
  }
}

/** The coarse urgency of a terminal — drives the glyph, the colour/tone, and the
 *  needs-you-first sort. `need` = an agent awaiting you; `work` = an agent
 *  working; `idle` = everything else (waiting / unknown / no agent). */
export type Urgency = "need" | "work" | "idle";

/** Map an agent to its urgency. The exhaustive switch over the closed
 *  `agentBucket` union means a new bucket forces a decision here rather than
 *  silently falling to idle. Accepts `undefined` as well as the schema's
 *  `AgentInfo | null` so a caller threading an optional-chained active arm
 *  (`activeArm(meta)?.agent`) needn't normalize `undefined`→`null` first — the
 *  truthiness check below treats both as "no agent". */
export function agentUrgency(agent: Observation["agent"] | undefined): Urgency {
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
  agent: Observation["agent"],
  labels: Record<Urgency, string>,
): string {
  const urgency = agentUrgency(agent);
  if (urgency !== "idle") return labels[urgency];
  if (!agent) return labels.idle;
  return agentStatusLabel(agent.state);
}

/** The needs-you urgency-rank delta — the host-safe axis every ordering shares.
 *  Reads only `Observation["agent"]` (the live state), never recency, so it
 *  composes on both a memoryless host's `Observation` and kolu's remembered
 *  value. */
function urgencyRankDelta(
  a: Observation["agent"],
  b: Observation["agent"],
): number {
  return URGENCY_RANK[agentUrgency(a)] - URGENCY_RANK[agentUrgency(b)];
}

/** Order two agents by urgency alone, then a stable id tiebreak — the HOST-SAFE
 *  ordering a dashboard (pulam-web / pulam-tui) uses. It reads only the
 *  `Observation` (no recency), so a memoryless host that serves `Observation` —
 *  which has no `lastActivityAt` — can sort its fleet without a fold. The recency
 *  tiebreak is kolu's alone ({@link compareAgents}); a dashboard that reached for
 *  it would fail to compile (no `lastActivityAt` to supply). */
export function compareAgentUrgency(
  a: { agent: Observation["agent"]; id: string },
  b: { agent: Observation["agent"]; id: string },
): number {
  return urgencyRankDelta(a.agent, b.agent) || a.id.localeCompare(b.id);
}

/** Order two agents within a scope: needs-you first, then most-recently-active,
 *  then a stable id tiebreak. The kolu-only ordering — it adds the RECENCY
 *  tiebreak ({@link compareAgentUrgency} is the host-safe urgency-only sibling),
 *  which only kolu can supply because `lastActivityAt` is a remembered fact, not
 *  an observed one. The rank, recency, and tiebreak braided once so two scopes
 *  can't fall back to iteration order. */
export function compareAgents(
  a: { agent: Observation["agent"]; lastActivityAt: number; id: string },
  b: { agent: Observation["agent"]; lastActivityAt: number; id: string },
): number {
  return (
    urgencyRankDelta(a.agent, b.agent) ||
    b.lastActivityAt - a.lastActivityAt ||
    a.id.localeCompare(b.id)
  );
}
