/**
 * The pulam-web fleet view's PRESENTATION layer over the shared agent-state
 * projection. The renderer-agnostic core — bucketing, the needs-you-first
 * ordering, recency formatting, the short agent name, the idle-label fork — lives
 * in `@kolu/terminal-workspace/agentProjection`, shared byte-for-byte across the
 * surfaces that render it (pulam-tui, pulam-web, AND kolu's Dock — the two fleet
 * views MIRROR the Dock UX), fenced by the schema's `AgentInfo['state']` union so
 * a new agent state can't drift between them. This module keeps ONLY what is
 * genuinely web-specific: the per-agent ROW pip — `pipVariantFor`, which folds an
 * awareness value to a `PipVariant` the shared `StatePip` (`@kolu/solid-statepip`)
 * renders, the SAME component + theme palette kolu's Dock paints; the urgency→
 * {colour, label, glyph} descriptor the fleet-wide needs-you strip + footer
 * counters still read (its glyph serves only those aggregates now — the row's own
 * glyph moved into `StatePip`); the web chrome colours; the cwd/location helpers;
 * and the terminal-category filter the toggles read.
 *
 * What this does NOT do: dirty/clean counts. The awareness `git` info carries
 * only `repoName`/`branch`/remote — the file counts come from the `git.getStatus`
 * procedure, consumed (with the rest of git status) in R-pulamweb-4, not here.
 */

import {
  pipForPaintClass,
  type PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import {
  agentPaintClass,
  agentUrgency,
  alertClass,
  compareAgentUrgency,
  type Urgency,
} from "@kolu/terminal-workspace/agentProjection";
import type { Observation, TerminalId } from "@kolu/terminal-workspace/surface";

/** The last path segment of `cwd` — the terminal's working dir at a glance. A
 *  trailing slash is trimmed first so `/a/b/` reads as `b`, not empty. */
export function basename(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  const base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  return base.length > 0 ? base : cwd;
}

/** One descriptor per urgency — its colour (a shared `@kolu/theme` token, so the
 *  fleet reads the SAME palette as kolu's Dock — "your turn" violet, working
 *  teal, idle grey — rather than a render-local hex that drifts), the user-facing
 *  label, and the leading glyph the fleet-wide needs-you strip + footer counters
 *  paint. The per-agent ROW renders the shared `StatePip` now (see
 *  `pipVariantFor`), so the glyph here serves only those aggregate counters. The
 *  sort rank lives in the shared projection (`URGENCY_RANK`); only the label
 *  words stay this renderer's own ("needs you"; the TUI spells "awaiting you").
 *  (The pulse/spin ANIMATION lives in `StatePip` / the strip class, not a field
 *  here — it's a behaviour, not a static descriptor.) */
export const URGENCY: Record<
  Urgency,
  { color: string; label: string; glyph: string }
> = {
  need: { color: "var(--color-alert)", label: "needs you", glyph: "●" },
  work: { color: "var(--color-accent)", label: "working", glyph: "◜" },
  idle: { color: "var(--color-fg-3)", label: "idle", glyph: "○" },
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

/** The shared status pip a terminal renders — the fleet's half of R-pip-unify.
 *  An agent folds through the SAME `pipForPaintClass` kolu's Dock uses, so a
 *  given agent state shows the IDENTICAL pip (glyph · colour · animation) on both
 *  surfaces — and a just-finished `waiting` agent keeps the lingering `awaiting`
 *  dot rather than dropping to idle (order≠colour, the dock-fleet-mirror
 *  contract). A terminal with NO agent is the fleet's own overlay: a dormant ☾
 *  when nothing's running, a quiet idle dot when a foreground process is. There
 *  is no `attention` here — that loud unread variant is the Dock's alone (the
 *  fleet has no unread obligation to surface). */
export function pipVariantFor(value: Observation): PipVariant {
  if (value.agent) return pipForPaintClass(agentPaintClass(value.agent.state));
  return value.foreground ? "idle" : "sleeping";
}

/** Whether a terminal carries an unopened-notification ALERT — the amber corner
 *  badge the merged `StatePip` draws on its core (R-activity-merge). Driven by the
 *  shared `alertClass` fold — the SAME notify membership kolu's `useTerminalAlerts`
 *  fires on (an agent that blocks on you, `awaiting_user`, or just finished its
 *  turn, `waiting`) — so the per-row alert pulam-web gains here can't drift from
 *  the Dock's. A terminal with no agent has nothing to notify about. Unlike the
 *  Dock's `unread` (which outlives the state until you open the row), the fleet
 *  keeps no per-terminal read state, so the badge tracks the live notify-class
 *  membership directly. */
export function fleetAlert(value: Observation): boolean {
  return value.agent ? alertClass(value.agent.state) === "notify" : false;
}

/** CSS `background` value for the needs-you (alert/violet) wash. */
export const ALERT_WASH =
  "color-mix(in oklch, var(--color-alert) 10%, transparent)";
/** CSS `background` value for the working/live (accent/teal) wash. */
export const ACCENT_WASH =
  "color-mix(in oklch, var(--color-accent) 10%, transparent)";

/** The per-row background WASH — the fleet's at-a-glance "is this row hot?" fold,
 *  layered behind the pip. A row that NEEDS you keeps the alert (violet) wash; a
 *  row that is WORKING or has live terminal output (the green-ring `live` axis,
 *  off the `activity` stream) gets the working (teal) wash; an idle/quiet row
 *  stays bare. Both tints reuse the SAME agent-state tokens the pip + urgency
 *  colours do (`--color-alert`, `--color-accent`), so the wash can't drift from
 *  them. `need` wins over `work`/`live`: a blocked agent is the louder signal.
 *  Returns the bare `background` value (or `undefined` for no wash). */
export function rowBackground(
  value: Observation,
  live: boolean,
): string | undefined {
  const urgency = agentUrgency(value.agent);
  if (urgency === "need") return ALERT_WASH;
  if (urgency === "work" || live) return ACCENT_WASH;
  return undefined;
}

/** Fleet *chrome* colours — the per-host accent. Deliberately NOT a `@kolu/theme`
 *  token: R-pip-unify moved the **agent-state** palette (pip + urgency colour/
 *  label) onto the shared tokens so the pip matches kolu's Dock, and
 *  R-activity-merge moved the live-output dot onto the shared `StatePip` ring
 *  (`--color-ok`) — but pulam-web's surrounding chrome stays its own (dark-only)
 *  literals, not part of the cross-surface pip contract. `HOST_COLOR` re-spelling
 *  `--color-alert`'s dark value is a coincidence of palette, not a shared token. */
export const HOST_COLOR = "#a78bfa";

/** `repo · branch` from the awareness git info, or the cwd basename when not in a
 *  repo. No dirty/clean count — that needs `git.getStatus` (R-pulamweb-4). */
export function locationText(value: Observation): string {
  if (value.git) return `${value.git.repoName} · ${value.git.branch}`;
  return basename(value.cwd);
}

/** One terminal as a fleet entry — its id and current awareness value. */
export interface FleetEntry {
  id: TerminalId;
  value: Observation;
}

/** Order terminals within a host: needs-you first, then id (a stable tiebreak) —
 *  the shared HOST-SAFE `compareAgentUrgency` ordering over a fleet entry. pulam
 *  serves the memoryless `Observation`, which has no `lastActivityAt`, so the
 *  fleet sorts by urgency alone — the recency tiebreak is kolu's, where recency is
 *  remembered. */
export function compareFleetEntries(a: FleetEntry, b: FleetEntry): number {
  return compareAgentUrgency(
    { agent: a.value.agent, id: a.id },
    { agent: b.value.agent, id: b.id },
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

export function terminalCategory(value: Observation): TerminalCategory {
  if (value.agent) {
    return agentUrgency(value.agent) === "idle" ? "idle" : "active";
  }
  return value.foreground ? "nonagent" : "sleeping";
}

/** The view filters. `active` agents always show, and `idle` defaults ON (the
 *  full agent board — see DEFAULT_FLEET_FILTERS); `nonagent` and `sleeping`
 *  (agentless terminals) are opt-in toggles, matching the footer. */
export interface FleetFilters {
  idle: boolean;
  nonagent: boolean;
  sleeping: boolean;
}

/** The default view — **every agent shows** (active *and* idle), while the
 *  non-agent and sleeping shells stay opt-in. `idle` defaults ON so the board
 *  answers "what's every agent doing?" out of the box, not just "who needs me?";
 *  a fleet whose agents have all gone quiet should still read as a full board,
 *  not an empty one. The two agentless categories stay off — they're terminals,
 *  not agents, and this is an agent dashboard. Single-sourced here (not inlined
 *  in `App.tsx`) so the default is pinned by `fleet.test.ts`. */
export const DEFAULT_FLEET_FILTERS: FleetFilters = {
  idle: true,
  nonagent: false,
  sleeping: false,
};

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
