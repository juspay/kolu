/**
 * Pure fleet projection for the pulam-web agent dashboard — the bucketing,
 * needs-you-first ordering, recency formatting, urgency→colour map, and terminal
 * categorisation the render components (`HostGroup` / `App`) read. No transport,
 * no DOM, no I/O: plain functions over an `AwarenessValue`, unit-tested under
 * Node.
 *
 * This is a deliberate PORT of pulam-tui's renderer-agnostic core
 * (`packages/pulam-tui/src/render.ts` + `palette.ts`) — the Atlas plan's reuse
 * map marks this logic "renderer-agnostic, ports to web". It is leaf logic, not a
 * hard-volatility capability, so it lives as a pulam-web-local module rather than
 * a shared `@kolu/*` package (it fails the electricity tests). pulam-web does not
 * depend on `@kolu/pulam-tui` — a TUI/OpenTUI package has no place in the Vite
 * browser bundle — so the logic is owned here and pinned to the TUI's behaviour
 * by `fleet.test.ts`, not imported.
 *
 * What this does NOT do: dirty/clean counts. The awareness `git` info carries
 * only `repoName`/`branch`/remote — the file counts come from the `git.getStatus`
 * procedure, consumed (with the rest of git status) in R-pulamweb-4, not here.
 */

import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";

const DASH = "—";

/** The last path segment of `cwd` — the terminal's working dir at a glance. A
 *  trailing slash is trimmed first so `/a/b/` reads as `b`, not empty. */
export function basename(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  const base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  return base.length > 0 ? base : cwd;
}

/** The agent vendor's short label — `claude-code` reads as `claude`. */
export function agentShortName(kind: string): string {
  return kind === "claude-code" ? "claude" : kind;
}

/** The coarse bucket an agent's fine-grained state falls in. The closed union
 *  lets a tone/label decision switch exhaustively; a brand-new state surfaces as
 *  `other` (shown verbatim) rather than silently miscoloured — fail-loud, exactly
 *  as pulam-tui's `agentBucket`. */
export function agentBucket(
  state: string,
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
      return "other";
  }
}

/** The coarse urgency of a terminal — drives the glyph, the colour, and the
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

/** One descriptor per urgency — its sort rank (lower floats up), the web colour,
 *  and the user-facing label — so the needs-you-first sort, the row colour, and
 *  the state cell read a single definition. Labels follow the reviewed mockup
 *  ("needs you"); pulam-tui's terminal label ("awaiting you") is its own
 *  presentation choice, not load-bearing here. */
export const URGENCY: Record<
  Urgency,
  { rank: number; color: string; label: string }
> = {
  need: { rank: 0, color: "#e6a23c", label: "needs you" },
  work: { rank: 1, color: "#56b6c2", label: "working" },
  idle: { rank: 2, color: "#5b6678", label: "idle" },
};

/** The green live-output dot — a terminal moving bytes right now (the fleet echo
 *  of kolu's Dock dot). Rides the `activity` stream, orthogonal to the agent-state
 *  colours. */
export const LIVE_COLOR = "#7ee787";
/** The per-host group accent (violet), echoing the mockup + pulam-tui's HOST. */
export const HOST_COLOR = "#a78bfa";
/** A dormant activity dot — present but not moving bytes. */
export const DOT_OFF_COLOR = "#262b38";

/** The pointed state label: a `need`/`work` terminal reads the urgency label; an
 *  idle agent shows its own state (e.g. "waiting", or a verbatim unknown state);
 *  a terminal with no agent reads "idle". */
export function stateLabel(agent: AwarenessValue["agent"]): string {
  const urgency = agentUrgency(agent);
  if (urgency !== "idle") return URGENCY[urgency].label;
  if (!agent) return URGENCY.idle.label;
  const bucket = agentBucket(agent.state);
  return bucket === "other" ? agent.state : bucket;
}

/** `repo · branch` from the awareness git info, or the cwd basename when not in a
 *  repo. No dirty/clean count — that needs `git.getStatus` (R-pulamweb-4). */
export function locationText(value: AwarenessValue): string {
  if (value.git) return `${value.git.repoName} · ${value.git.branch}`;
  return basename(value.cwd);
}

/** Compact relative age (`3s`/`5m`/`2h`/`4d`) of an epoch-millis against `now`;
 *  `0` (no agent activity ever observed) renders as a dash. Ported verbatim from
 *  pulam-tui's `relativeTime`. */
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

/** One terminal as a fleet entry — its id and current awareness value. */
export interface FleetEntry {
  id: TerminalId;
  value: AwarenessValue;
}

/** Order terminals within a host: needs-you first, then most-recently-active,
 *  then id (a stable tiebreak). The exact ordering pulam-tui's fleet sort uses. */
export function compareFleetEntries(a: FleetEntry, b: FleetEntry): number {
  const ra = URGENCY[agentUrgency(a.value.agent)].rank;
  const rb = URGENCY[agentUrgency(b.value.agent)].rank;
  if (ra !== rb) return ra - rb;
  if (a.value.lastActivityAt !== b.value.lastActivityAt)
    return b.value.lastActivityAt - a.value.lastActivityAt;
  return a.id.localeCompare(b.id);
}

/** A terminal's filter category — disjoint and exhaustive over every terminal:
 *  - `active`   : an agent that needs you or is working (shown by default)
 *  - `idle`     : an agent present but idle/waiting
 *  - `nonagent` : no agent, but a foreground process is running
 *  - `sleeping` : no agent and no foreground process (a dormant shell)
 *
 *  "sleeping" is grounded in the awareness value, not invented — the wire carries
 *  no `sleeping` flag; it is exactly the absence of both an agent and a foreground
 *  process. */
export type TerminalCategory = "active" | "idle" | "nonagent" | "sleeping";

export function terminalCategory(value: AwarenessValue): TerminalCategory {
  if (value.agent) {
    return agentUrgency(value.agent) === "idle" ? "idle" : "active";
  }
  return value.foreground ? "nonagent" : "sleeping";
}

/** The view filters — `active` agents always show; the rest are opt-in toggles
 *  (all default off), matching the mockup's "showing agents + idle + non-agent +
 *  sleeping" footer. */
export interface FleetFilters {
  idle: boolean;
  nonagent: boolean;
  sleeping: boolean;
}

export function isVisible(
  category: TerminalCategory,
  filters: FleetFilters,
): boolean {
  switch (category) {
    case "active":
      return true;
    case "idle":
      return filters.idle;
    case "nonagent":
      return filters.nonagent;
    case "sleeping":
      return filters.sleeping;
  }
}
