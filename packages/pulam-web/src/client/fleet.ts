/**
 * The pulam-web fleet view's PRESENTATION layer over the shared agent-state
 * projection. The renderer-agnostic core — bucketing, the needs-you-first
 * ordering, recency formatting, the short agent name, the idle-label fork — lives
 * in `@kolu/terminal-workspace/agentProjection` and is shared byte-for-byte with
 * pulam-tui (one definition, fenced by the schema's `AgentInfo['state']` union),
 * so a new agent state can't drift between the two homes. This module keeps ONLY
 * what is genuinely web-specific: the urgency→{colour, label, glyph} descriptor
 * the rows/footer paint, the web chrome colours, the cwd/location helpers, and the
 * terminal-category filter the dashboard toggles read.
 *
 * What this does NOT do: dirty/clean counts. The awareness `git` info carries
 * only `repoName`/`branch`/remote — the file counts come from the `git.getStatus`
 * procedure, consumed (with the rest of git status) in R-pulamweb-4, not here.
 */

import {
  agentUrgency,
  compareAgents,
  fleetStateLabel,
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

/** One descriptor per urgency — its web colour and the user-facing label — so
 *  the row colour and the state cell read a SINGLE definition rather than
 *  re-spelling the hex/label at each render site. The sort rank lives in the
 *  shared projection (`URGENCY_RANK`); the colour/label are this renderer's own
 *  presentation choice. Labels follow the reviewed mockup ("needs you"); the TUI
 *  spells "awaiting you" in its own table. */
export const URGENCY: Record<Urgency, { color: string; label: string }> = {
  need: { color: "#e6a23c", label: "needs you" },
  work: { color: "#56b6c2", label: "working" },
  idle: { color: "#5b6678", label: "idle" },
};

/** The web label set, keyed off `URGENCY`, that the shared `fleetStateLabel`
 *  three-way idle fork reads — the only thing this renderer customizes. */
const URGENCY_LABELS: Record<Urgency, string> = {
  need: URGENCY.need.label,
  work: URGENCY.work.label,
  idle: URGENCY.idle.label,
};

/** The pointed state label for a row, via the shared idle-fork helper with the
 *  web's labels. */
export function stateLabel(agent: AwarenessValue["agent"]): string {
  return fleetStateLabel(agent, URGENCY_LABELS);
}

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
