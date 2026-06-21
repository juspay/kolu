/**
 * Pure rendering helpers for the arivu-tui dashboard — no I/O, no transport, no
 * OpenTUI. The PROJECTION (which columns, their formatted values, and the
 * *semantic* tone each takes) lives here as plain data so it is unit-tested
 * under Node/vitest and never depends on the Bun renderer; `tui.tsx` only maps a
 * tone to a colour and paints. `bin.ts` reads the `awareness` collection and
 * feeds these.
 *
 * arivu-tui shows what each terminal *is in* — repo·branch · PR + checks · agent
 * state · foreground · recency — where kaval-tui shows what's *running*. The
 * compact one-row-per-terminal table is the human view; `--json` dumps the full
 * raw `AwarenessValue` (every deep field) for scripts.
 */

import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import type {
  FleetHostState,
  FleetHostStatus,
  FleetSnapshot,
} from "./fleetTypes.ts";

/** How many leading chars of a terminal id the dashboard shows. v4 UUIDs
 *  collide with vanishing probability across the handful one runs; `--json`
 *  keeps the full id. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

const DASH = "—";

/** Strip terminal-hostile bytes from a value. A shell can set its title /
 *  process name to anything (newlines, raw ESC), so painting them verbatim
 *  could inject control effects. JSON output stays raw; this is human-only. */
function sanitize(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

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
 *  means a tone/label decision can switch exhaustively over it, and a brand-new
 *  state surfaces as `other` (shown verbatim) rather than silently miscoloured. */
function agentBucket(
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

/** The dashboard label for an agent's state, derived from its bucket. An
 *  unrecognized (`other`) state falls through verbatim so a new agent state is
 *  visible rather than silently collapsed. */
export function agentStatusLabel(state: string): string {
  const bucket = agentBucket(state);
  return bucket === "other" ? state : bucket;
}

function agentValue(agent: AwarenessValue["agent"]): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

/** The single discriminator for a PR's check status — `none` when the PR isn't
 *  resolved (`kind !== "ok"`), else the resolved checks with `null` (no checks
 *  configured) folded to `pending`. Both the glyph (`prValueText`) and the tone
 *  (`prTone`) switch exhaustively over this one closed union, so a new checks
 *  state forces a decision in both and the glyph and colour can never disagree. */
function prChecks(
  pr: AwarenessValue["pr"],
): "pass" | "fail" | "pending" | "none" {
  if (pr.kind !== "ok") return "none";
  const checks = pr.value.checks;
  switch (checks) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "pending":
    case null: // null = no checks configured; reads the same as pending here
      return "pending";
    default: {
      // Exhaustive over `CheckStatus | null`. If the forge schema grows a new
      // check state, this stops compiling — forcing a glyph/tone decision here
      // rather than silently mislabelling the new state as pending.
      const _exhaustive: never = checks;
      return _exhaustive;
    }
  }
}

/** The PR resolution, every arm: `#<n> <state> <✓/✗/·>` when resolved, the
 *  pending/absent/unavailable kind (with the failure code) otherwise. */
function prValueText(pr: AwarenessValue["pr"]): string {
  switch (pr.kind) {
    case "ok": {
      const { number, state } = pr.value;
      const checks = prChecks(pr);
      const glyph = checks === "pass" ? "✓" : checks === "fail" ? "✗" : "·";
      return `#${number} ${state} ${glyph}`;
    }
    case "pending":
      return "pending";
    case "absent":
      return DASH;
    case "unavailable":
      return `unavailable: ${pr.source.code}`;
    default: {
      // Exhaustive over the `pr` schema's `kind` union. If the awareness schema
      // grows a new PR kind, this stops compiling — forcing a text decision here
      // rather than silently returning `undefined` (rendered as "undefined").
      // Mirrors the `never` guard in `prChecks` above.
      const _exhaustive: never = pr;
      return _exhaustive;
    }
  }
}

function orDash(value: string | null | undefined): string {
  return value ? sanitize(value) || DASH : DASH;
}

/** Semantic colour hint for a cell — the renderer owns the palette, this owns
 *  which bucket a value falls in. */
export type FieldTone =
  | "working"
  | "awaiting"
  | "idle"
  | "pass"
  | "fail"
  | "pending"
  | "muted"
  | "plain";

/** The agent state's tone, keyed on its bucket: working → cyan, awaiting (blocked
 *  on you) → amber, idle → dim, an unrecognized state → plain, no agent → muted.
 *  The exhaustive switch over the closed bucket means a new bucket forces a tone
 *  decision here rather than silently falling to plain. */
export function agentTone(agent: AwarenessValue["agent"]): FieldTone {
  if (!agent) return "muted";
  switch (agentBucket(agent.state)) {
    case "working":
      return "working";
    case "awaiting":
      return "awaiting";
    case "waiting":
      return "idle";
    case "other":
      return "plain";
  }
}

/** The PR's tone, keyed on the same `prChecks` discriminator as the glyph: pass →
 *  green, fail → red, pending → amber; anything unresolved (`none`) → muted. The
 *  shared discriminator means the glyph and the colour can never disagree. */
export function prTone(pr: AwarenessValue["pr"]): FieldTone {
  switch (prChecks(pr)) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "pending":
      return "pending";
    case "none":
      return "muted";
  }
}

/** A dashboard cell that carries a semantic tone for colouring. */
export interface DashCell {
  text: string;
  tone: FieldTone;
}

/** One terminal as a compact dashboard row. Every column is a `DashCell` so
 *  render.ts owns 100% of the which-tone decision and `tui.tsx` is a uniform
 *  tone→colour paint with no per-column colour knowledge. */
export interface DashRow {
  id: DashCell;
  repoBranch: DashCell;
  pr: DashCell;
  agent: DashCell;
  foreground: DashCell;
  active: DashCell;
}

/** Project a terminal to its dashboard columns: short id, repo·branch, PR
 *  (toned by checks), agent · state (toned), foreground, and recency. Pure data
 *  — `tui.tsx` paints it, vitest tests it. */
export function dashRow(
  id: TerminalId,
  v: AwarenessValue,
  now: number,
): DashRow {
  return {
    id: { text: shortId(id), tone: "plain" },
    repoBranch: {
      // Repo names come from filesystem paths and the branch from git, so both
      // can carry newlines/escape bytes — sanitize each before joining (the
      // same defence `orDash` gives the foreground name) so a hostile name can't
      // corrupt the table or inject control effects.
      text: v.git ? `${orDash(v.git.repoName)}·${orDash(v.git.branch)}` : DASH,
      tone: "plain",
    },
    pr: { text: prValueText(v.pr), tone: prTone(v.pr) },
    agent: { text: agentValue(v.agent), tone: agentTone(v.agent) },
    foreground: { text: orDash(v.foreground?.name), tone: "plain" },
    active: { text: relativeTime(v.lastActivityAt, now), tone: "muted" },
  };
}

/** Sort the awareness entries by id (stable display) and project each to a
 *  dashboard row against `now`. The single ordering both the OpenTUI table and
 *  any test share. */
export function dashRows(
  entries: Array<[TerminalId, AwarenessValue]>,
  now: number,
): DashRow[] {
  return [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => dashRow(id, v, now));
}

/** `--json` — a top-level array of `{ id, ...value }`, 2-space indented, full
 *  ids, controls JSON-escaped (so `jq '.[]'` works). The complete raw awareness
 *  value, including the deep fields the table doesn't break out. */
export function formatAwarenessJson(
  entries: Array<[TerminalId, AwarenessValue]>,
): string {
  return JSON.stringify(
    entries.map(([id, value]) => ({ id, ...value })),
    null,
    2,
  );
}

// ─── Fleet (PR2b) ────────────────────────────────────────────────────────────
//
// The multi-host board projects the SAME awareness values, one level up: many
// hosts, each a group of terminals, with every `awaiting_user` agent floated to
// the top across the whole fleet. Everything below is pure data — the live
// aggregate the orchestrator fills (`fleet.ts`) and the view it paints
// (`fleet.tsx`) both go through here, so the grouping/sort/summary stay
// unit-tested and never depend on the Bun renderer.

/** The coarse urgency of a terminal — drives the glyph, the tone, and the
 *  needs-you-first sort. `need` = an agent awaiting you; `work` = an agent
 *  working; `idle` = everything else (waiting / no agent). */
export type FleetUrgency = "need" | "work" | "idle";

/** The one descriptor per urgency — its sort rank (lower floats up), colour
 *  tone, and section/state label — so the cross-fleet "needs-you first"
 *  ordering, the colouring, the row-state cell, and the agent-mode section
 *  headers all read a single definition. A new urgency (or a relabel) is one
 *  edit here, not four sites kept in agreement by hand. */
const URGENCY: Record<
  FleetUrgency,
  { rank: number; tone: FieldTone; label: string }
> = {
  need: { rank: 0, tone: "awaiting", label: "awaiting you" },
  work: { rank: 1, tone: "working", label: "working" },
  idle: { rank: 2, tone: "idle", label: "idle" },
};

/** Map an agent to its fleet urgency: `awaiting_user` → need (blocked on you),
 *  the working states → work, everything else (waiting / no agent) → idle. The
 *  exhaustive switch over the closed `agentBucket` union means a new bucket
 *  forces a decision here rather than silently falling to idle. */
export function agentUrgency(agent: AwarenessValue["agent"]): FleetUrgency {
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

/** The fleet row's pointed state label: needs read as "awaiting you", work as
 *  "working" (both the shared `URGENCY` label); an idle terminal overrides with
 *  its agent's own label (e.g. "waiting") or falls back to the `idle` label when
 *  no agent runs. */
function fleetStateText(
  urgency: FleetUrgency,
  agent: AwarenessValue["agent"],
): string {
  return urgency === "idle"
    ? agent
      ? agentStatusLabel(agent.state)
      : URGENCY.idle.label
    : URGENCY[urgency].label;
}

/** One terminal as a fleet row. The agent name stays calm; the urgency carries
 *  the colour (the leading glyph + the state cell), so the eye lands on a `need`
 *  row's amber, not on every agent name. Reuses the single-host projection
 *  helpers verbatim — the PR/where/recency decisions are defined once. */
export interface FleetRow {
  host: string;
  id: string;
  urgency: FleetUrgency;
  agent: DashCell;
  where: DashCell;
  pr: DashCell;
  state: DashCell;
  active: DashCell;
}

export function fleetRow(
  host: string,
  id: TerminalId,
  v: AwarenessValue,
  now: number,
): FleetRow {
  const urgency = agentUrgency(v.agent);
  return {
    host,
    id: shortId(id),
    urgency,
    agent: {
      text: v.agent ? agentShortName(v.agent.kind) : DASH,
      tone: "plain",
    },
    where: {
      text: v.git ? `${orDash(v.git.repoName)}·${orDash(v.git.branch)}` : DASH,
      tone: "plain",
    },
    pr: { text: prValueText(v.pr), tone: prTone(v.pr) },
    state: {
      text: fleetStateText(urgency, v.agent),
      tone: URGENCY[urgency].tone,
    },
    active: { text: relativeTime(v.lastActivityAt, now), tone: "muted" },
  };
}

/** Order terminals within a scope: needs-you first, then most-recently-active,
 *  then id (a stable tiebreak). The one ordering every fleet view shares. */
function sortedEntries(
  terminals: Record<string, AwarenessValue>,
): Array<[TerminalId, AwarenessValue]> {
  return (
    Object.entries(terminals) as Array<[TerminalId, AwarenessValue]>
  ).sort(([ia, a], [ib, b]) => {
    const ra = URGENCY[agentUrgency(a.agent)].rank;
    const rb = URGENCY[agentUrgency(b.agent)].rank;
    if (ra !== rb) return ra - rb;
    if (a.lastActivityAt !== b.lastActivityAt)
      return b.lastActivityAt - a.lastActivityAt;
    return ia.localeCompare(ib);
  });
}

/** How the board is grouped/sorted. `host` (default) = per-host groups; `needs`
 *  = one flat fleet-wide urgency list; `agent` = grouped into Awaiting / Working
 *  / Idle sections across all hosts. */
export type FleetMode = "host" | "needs" | "agent";

/** A rendered group — a host (host mode, with its `status`) or an urgency
 *  section (agent mode, no `status`). `needs` mode uses `flat` instead. */
export interface FleetGroup {
  label: string;
  status?: FleetHostStatus;
  rows: FleetRow[];
}

export interface FleetSummary {
  needYou: number;
  working: number;
  idle: number;
  hostsDown: number;
  hostsTotal: number;
}

/** The whole board as plain data, discriminated on `mode` so exactly one
 *  projection is present: `needs` carries the flat fleet-wide list, `host`/`agent`
 *  carry the groups. No dead `[]` for the renderer to know-to-ignore — it switches
 *  on `mode` and reads the field that exists. `summary`/`alertHosts` (the footer
 *  tally and the alert-strip hosts) are shared by every mode. */
export type FleetView =
  | {
      mode: "needs";
      flat: FleetRow[];
      summary: FleetSummary;
      alertHosts: string[];
    }
  | {
      mode: "host" | "agent";
      groups: FleetGroup[];
      summary: FleetSummary;
      alertHosts: string[];
    };

/** The agent-mode section order — needs first, then working, then idle — each
 *  labelled from the shared `URGENCY` table so a section header can't drift from
 *  the row-state cell it duplicates. */
const AGENT_SECTION_ORDER: ReadonlyArray<FleetUrgency> = [
  "need",
  "work",
  "idle",
];
const AGENT_SECTIONS: ReadonlyArray<{ urgency: FleetUrgency; label: string }> =
  AGENT_SECTION_ORDER.map((urgency) => ({
    urgency,
    label: URGENCY[urgency].label,
  }));

/** Project the live aggregate to the board. Pure: same input, same output, no
 *  clock of its own (`now` is passed so recency is testable). */
export function projectFleet(
  states: FleetHostState[],
  now: number,
  mode: FleetMode,
): FleetView {
  // Every terminal across the fleet, each tagged with its host — the basis for
  // the flat (needs/agent) views and the summary counts.
  const allRows: FleetRow[] = states.flatMap((s) =>
    sortedEntries(s.terminals).map(([id, v]) => fleetRow(s.label, id, v, now)),
  );

  const summary: FleetSummary = {
    needYou: allRows.filter((r) => r.urgency === "need").length,
    working: allRows.filter((r) => r.urgency === "work").length,
    idle: allRows.filter((r) => r.urgency === "idle").length,
    hostsDown: states.filter((s) => s.status.kind === "unreachable").length,
    hostsTotal: states.length,
  };
  const alertHosts = states
    .filter((s) =>
      Object.values(s.terminals).some((v) => agentUrgency(v.agent) === "need"),
    )
    .map((s) => s.label);

  if (mode === "needs") {
    const flat = [...allRows].sort(
      (a, b) => URGENCY[a.urgency].rank - URGENCY[b.urgency].rank,
    );
    return { mode, flat, summary, alertHosts };
  }
  if (mode === "agent") {
    const groups = AGENT_SECTIONS.map(({ urgency, label }) => ({
      label,
      rows: allRows.filter((r) => r.urgency === urgency),
    })).filter((g) => g.rows.length > 0);
    return { mode, groups, summary, alertHosts };
  }
  // host mode (default): one group per host, in dial order, even when empty or
  // down — an unreachable host renders as a distinct header, never vanishes.
  const groups = states.map((s) => ({
    label: s.label,
    status: s.status,
    rows: sortedEntries(s.terminals).map(([id, v]) =>
      fleetRow(s.label, id, v, now),
    ),
  }));
  return { mode, groups, summary, alertHosts };
}

/** `fleet --json` — a flat `[{ host, terminalId, ...AwarenessValue }]` for
 *  scripting (e.g. a notifier that pings when any box has an awaiting agent).
 *  An unreachable host emits one `{ host, terminalId: null, unreachable }` row
 *  so a down box is visible in the output, not silently absent. A contract-
 *  skewed host keeps its rows but tags each with `skew:{localVersion,hostVersion}`
 *  so a scripter sees the same skew signal the live board does, never a silently
 *  compatible-looking dump. */
export function formatFleetJson(snaps: FleetSnapshot[]): string {
  const rows: Array<Record<string, unknown>> = [];
  for (const s of snaps) {
    if (s.kind === "ok") {
      for (const [id, value] of s.entries) {
        rows.push({ host: s.label, terminalId: id, ...value });
      }
    } else if (s.kind === "skew") {
      const skew = {
        localVersion: s.localVersion,
        hostVersion: s.hostVersion,
      };
      for (const [id, value] of s.entries) {
        rows.push({ host: s.label, terminalId: id, skew, ...value });
      }
    } else {
      rows.push({ host: s.label, terminalId: null, unreachable: s.reason });
    }
  }
  return JSON.stringify(rows, null, 2);
}
