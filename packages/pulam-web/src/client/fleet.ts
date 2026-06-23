/**
 * The pulam-web fleet view's PRESENTATION layer over the shared agent-state
 * projection. The renderer-agnostic core — bucketing, the needs-you-first
 * ordering, recency formatting, the short agent name, the idle-label fork — lives
 * in `@kolu/terminal-workspace/agentProjection`, shared byte-for-byte across the
 * surfaces that render it (pulam-tui, pulam-web, AND kolu's Dock — the two fleet
 * views MIRROR the Dock UX), fenced by the schema's `AgentInfo['state']` union so
 * a new agent state can't drift between them. This module keeps ONLY what is
 * genuinely web-specific: the urgency→{colour, label, glyph} and PAINT→{colour,
 * glyph} descriptors the rows paint (the glyph follows PAINT — mirroring the Dock
 * pip — while the row tint + state label follow urgency), the web chrome colours,
 * the cwd/location helpers, and the terminal-category filter the toggles read.
 *
 * What this does NOT do: dirty/clean counts. The awareness `git` info carries
 * only `repoName`/`branch`/remote — the file counts come from the `git.getStatus`
 * procedure, consumed (with the rest of git status) in R-pulamweb-4, not here.
 */

import {
  type AgentPaintClass,
  agentPaintClass,
  agentUrgency,
  compareAgents,
  type Urgency,
} from "@kolu/terminal-workspace/agentProjection";
import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";

/** The last path segment of `cwd` — the terminal's working dir at a glance. A
 *  trailing slash is trimmed first so `/a/b/` reads as `b`, not empty. */
export function basename(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  const base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  return base.length > 0 ? base : cwd;
}

/** One descriptor per urgency — its web colour, the user-facing label, and the
 *  leading glyph — so urgency fully describes its own presentation and the row
 *  colour, the state cell, the footer counters, and the needs-you strip all read
 *  a SINGLE definition rather than re-spelling the hex/label/glyph at each render
 *  site. The sort rank lives in the shared projection (`URGENCY_RANK`); the
 *  colour/label/glyph are this renderer's own presentation choice. Labels follow
 *  the reviewed mockup ("needs you"); the TUI spells "awaiting you" in its own
 *  table. (The pulse/spin ANIMATION stays a render-local class keyed off
 *  urgency, not a field here — it's a behaviour, not a static descriptor.) */
export const URGENCY: Record<
  Urgency,
  { color: string; label: string; glyph: string }
> = {
  need: { color: "#e6a23c", label: "needs you", glyph: "●" },
  work: { color: "#56b6c2", label: "working", glyph: "◜" },
  idle: { color: "#5b6678", label: "idle", glyph: "○" },
};

/** The web label set, keyed off `URGENCY`, that the shared `fleetStateLabel`
 *  three-way idle fork reads — the only thing this renderer customizes. Read by
 *  the row directly (`fleetStateLabel(agent, URGENCY_LABELS)`), so there's no
 *  one-line wrapper in between. */
export const URGENCY_LABELS: Record<Urgency, string> = {
  need: URGENCY.need.label,
  work: URGENCY.work.label,
  idle: URGENCY.idle.label,
};

/** The paint class an awareness value renders its glyph from — the agent's
 *  `agentPaintClass`, or `none` for a terminal with no agent (the fleet echo of
 *  kolu's Dock paint fold, `dockModel.paintBucket`'s null-arm). */
export function paintClassFor(value: AwarenessValue): AgentPaintClass {
  return value.agent ? agentPaintClass(value.agent.state) : "none";
}

/** One descriptor per PAINT class — the colour + glyph the agent cue paints —
 *  so the fleet MIRRORS kolu's Dock pip: the cue follows `agentPaintClass`, NOT
 *  urgency, so a just-finished `waiting` agent keeps the lingering "awaiting"
 *  amber dot rather than dropping to the idle grey its sort would imply. This is
 *  the Dock's order≠colour split: COLOUR is paint (here), while the sort, the
 *  needs-you row tint, and the pulse/spin ANIMATION stay keyed off urgency. The
 *  three paint classes index the SAME three visual tiers `URGENCY` defines
 *  (attention amber · working cyan · quiet grey) — one palette, two folds onto
 *  it — so the hex/glyph live once, in `URGENCY`. */
export const PAINT: Record<AgentPaintClass, { color: string; glyph: string }> =
  {
    awaiting: { color: URGENCY.need.color, glyph: URGENCY.need.glyph },
    working: { color: URGENCY.work.color, glyph: URGENCY.work.glyph },
    none: { color: URGENCY.idle.color, glyph: URGENCY.idle.glyph },
  };

/** The green live-output dot — a terminal moving bytes right now (the fleet echo
 *  of kolu's Dock dot). Rides the `activity` stream, orthogonal to the agent-state
 *  colours. */
export const LIVE_COLOR = "#7ee787";
/** The per-host group accent (violet), echoing the mockup + pulam-tui's HOST. */
export const HOST_COLOR = "#a78bfa";
/** A dormant activity dot — present but not moving bytes. */
export const DOT_OFF_COLOR = "#262b38";

/** `repo · branch` from the awareness git info, or the cwd basename when not in a
 *  repo. No dirty/clean count — that needs `git.getStatus` (R-pulamweb-4). */
export function locationText(value: AwarenessValue): string {
  if (value.git) return `${value.git.repoName} · ${value.git.branch}`;
  return basename(value.cwd);
}

/** One terminal as a fleet entry — its id and current awareness value. */
export interface FleetEntry {
  id: TerminalId;
  value: AwarenessValue;
}

/** Order terminals within a host: needs-you first, then most-recently-active,
 *  then id (a stable tiebreak) — the shared `compareAgents` ordering over a fleet
 *  entry. */
export function compareFleetEntries(a: FleetEntry, b: FleetEntry): number {
  return compareAgents(
    { agent: a.value.agent, lastActivityAt: a.value.lastActivityAt, id: a.id },
    { agent: b.value.agent, lastActivityAt: b.value.lastActivityAt, id: b.id },
  );
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
