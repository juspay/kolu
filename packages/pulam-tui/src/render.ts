/**
 * Pure rendering helpers for the pulam-tui dashboard — no I/O, no transport, no
 * OpenTUI. The PROJECTION (which columns, their formatted values, and the
 * *semantic* tone each takes) lives here as plain data so it is unit-tested
 * under Node/vitest and never depends on the Bun renderer; `tui.tsx` only maps a
 * tone to a colour and paints. `bin.ts` reads the `awareness` collection and
 * feeds these.
 *
 * pulam-tui shows what each terminal *is in* — repo·branch · PR + checks · agent
 * state · foreground · recency — where kaval-tui shows what's *running*. The
 * compact one-row-per-terminal table is the human view; `--json` dumps the full
 * raw `AwarenessValue` (every deep field) for scripts.
 */

import {
  agentBucket,
  agentShortName,
  agentStatusLabel,
  agentUrgency,
  compareAgents,
  DASH,
  fleetStateLabel,
  relativeTime,
  type Urgency,
  URGENCY_RANK,
} from "@kolu/terminal-workspace/agentProjection";
import type {
  AwarenessValue,
  GitChangeStatus,
  LocalGitStatus,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import type {
  FleetHostState,
  FleetHostStatus,
  FleetSnapshot,
} from "./fleetTypes.ts";

// The renderer-agnostic agent-state projection is owned by
// `@kolu/terminal-workspace/agentProjection` and shared with pulam-web — one
// copy, fenced by the schema's `AgentInfo["state"]` union. Re-exported here so
// the views (`tui.tsx`, `fleet.tsx`) and the render tests keep their single
// `./render.ts` import surface; this module layers only the TUI's presentation
// (the tone palette + the "awaiting you" labels) on top.
export { agentShortName, agentStatusLabel, agentUrgency, relativeTime };

/** The coarse urgency of a terminal — the shared `Urgency`, re-aliased under the
 *  name this renderer (and its tests) have always used. */
export type FleetUrgency = Urgency;

/** How many leading chars of a terminal id the dashboard shows. v4 UUIDs
 *  collide with vanishing probability across the handful one runs; `--json`
 *  keeps the full id. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** Pad a string to width `w`, or truncate with an ellipsis when too long. The
 *  fixed-column layout primitive both OpenTUI views (`tui.tsx`, `fleet.tsx`)
 *  paint cells with — spelled once here so the truncation rule can't drift. */
export function cell(s: string, w: number): string {
  return s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w);
}

/** Strip terminal-hostile bytes from a value. A shell can set its title /
 *  process name to anything (newlines, raw ESC), so painting them verbatim
 *  could inject control effects. JSON output stays raw; this is human-only.
 *  Exported so every TUI-bound string the fleet paints — host labels (CLI/ssh
 *  config), unreachable reasons (ssh/nix/remote stderr) — funnels through the
 *  same control-byte strip the per-terminal cells already do, never just a
 *  subset. */
export function sanitize(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
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

/** `repo·branch` from the raw repo/branch source — each half sanitized (repo
 *  names come from fs paths, branches from git, so both can carry control bytes
 *  that would corrupt the table), or a dash when the terminal isn't in a git repo
 *  (both `null`). The ONE place this heading is formatted: the compact `where`
 *  cell, the single-host table, and the drill-in pane's title all call it over
 *  the same source, so the compact-cell and detail-heading formatting are two
 *  reads of one rule rather than one reading the other's output. */
function repoBranchText(
  repoName: string | null,
  branch: string | null,
): string {
  return repoName === null && branch === null
    ? DASH
    : `${orDash(repoName)}·${orDash(branch)}`;
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
      text: repoBranchText(v.git?.repoName ?? null, v.git?.branch ?? null),
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

/** The TUI's presentation descriptor per urgency — its colour tone and the
 *  section/state label — so the colouring, the row-state cell, and the
 *  agent-mode section headers all read a single definition. The sort RANK lives
 *  in the shared `URGENCY_RANK` (the volatile ordering axis, shared with
 *  pulam-web); only the tone + the TUI's "awaiting you" wording are this
 *  renderer's own. */
const URGENCY: Record<FleetUrgency, { tone: FieldTone; label: string }> = {
  need: { tone: "awaiting", label: "awaiting you" },
  work: { tone: "working", label: "working" },
  idle: { tone: "idle", label: "idle" },
};

/** The TUI's per-urgency label words the shared `fleetStateLabel` idle-fork
 *  reads — the only thing this renderer customizes over the shared projection. */
const URGENCY_LABELS: Record<FleetUrgency, string> = {
  need: URGENCY.need.label,
  work: URGENCY.work.label,
  idle: URGENCY.idle.label,
};

/** One terminal as a fleet row. The agent name stays calm; the urgency carries
 *  the colour (the leading glyph + the state cell), so the eye lands on a `need`
 *  row's amber, not on every agent name. Reuses the single-host projection
 *  helpers verbatim — the PR/where/recency decisions are defined once. */
export interface FleetRow {
  host: string;
  /** A stable identity for this row across re-projections — the selection cursor
   *  tracks this, not a bare list index (rows reorder as agents change urgency).
   *  Computed once here, next to the (host, terminalId) keying the projection
   *  already owns, so "how a fleet row is uniquely named" lives in ONE place
   *  rather than being re-derived by a separate ` `-join in the view. The full
   *  terminal id is unique within a host; the host disambiguates the rare
   *  cross-host id collision; a NUL separator can't appear in either part. */
  key: string;
  id: string;
  /** Output moving on this terminal right now — the `activity` stream's live
   *  membership. Drives the green dot. Pure projection input: the host carries a
   *  live set, this row reflects whether THIS terminal is in it. */
  live: boolean;
  urgency: FleetUrgency;
  /** The raw `lastActivityAt` epoch-millis. NOT pre-formatted: recency is the
   *  one cell that ticks with the wall clock rather than a store delta, so the
   *  row carries the raw value and the view formats it with `relativeTime(…,
   *  now())` — keeping the 1s clock off the structural projection. It also
   *  doubles as the fleet-wide comparator's recency tiebreak. */
  activeAt: number;
  /** The raw terminal id (full, not the shortened display form), the final
   *  stable tiebreak so a flat/grouped fleet list orders identically every
   *  paint regardless of host-iteration order. */
  sortId: string;
  /** The raw repo name / branch (each `null` when the terminal isn't in a git
   *  repo), straight off the awareness `git` fields. The compact `where` cell and
   *  the drill-in pane's title are two INDEPENDENT formattings of these one
   *  source (both via `repoBranchText`) — the detail heading does not read the
   *  compact cell's already-truncated/joined output, so a change to one cell's
   *  width or separator can't silently move the other. */
  repoName: string | null;
  branch: string | null;
  agent: DashCell;
  where: DashCell;
  pr: DashCell;
  state: DashCell;
  /** The repo's full live status, or undefined until the first
   *  `subscribeRepoChange` pulse resolves (or for a terminal not in a repo). The
   *  ONE git value on the row: both the compact working-tree cell (`gitCell`) and
   *  the drill-in pane (`gitDetail`) are projections of it, derived at their read
   *  sites — the row no longer also stores the pre-projected cell, so the two
   *  can't desync. The fleet requests `mode: "local"` only, so this is the
   *  `local` arm of the status union (branch + working-tree always set). */
  gitStatus?: LocalGitStatus;
}

export function fleetRow(
  // The host the row is PAINTED under (sanitized for the alt-screen) and the host
  // the row's stable selection key is built from (the RAW label, the partition
  // identity) are two distinct strings: two raw labels that sanitize to the same
  // display text (e.g. `a\nb` and `a b`) must keep DISTINCT selection keys, or
  // ↑/↓/Enter could highlight or drill into the wrong host's row. `displayHost`
  // is paint-only; `identityHost` is who the row belongs to (the same raw label
  // `projectFleet` partitions the host-mode buckets on).
  displayHost: string,
  identityHost: string,
  id: TerminalId,
  v: AwarenessValue,
  live: boolean,
  gitStatus?: LocalGitStatus,
): FleetRow {
  const urgency = agentUrgency(v.agent);
  const repoName = v.git?.repoName ?? null;
  const branch = v.git?.branch ?? null;
  return {
    host: displayHost,
    key: `${identityHost}\u0000${id}`,
    id: shortId(id),
    live,
    urgency,
    activeAt: v.lastActivityAt,
    sortId: id,
    repoName,
    branch,
    agent: {
      text: v.agent ? agentShortName(v.agent.kind) : DASH,
      tone: "plain",
    },
    where: { text: repoBranchText(repoName, branch), tone: "plain" },
    pr: { text: prValueText(v.pr), tone: prTone(v.pr) },
    state: {
      // needs read "awaiting you", work "working" (the TUI's URGENCY_LABELS); an
      // idle terminal overrides with its agent's own state label via the shared
      // idle-fork, or "idle" when no agent runs.
      text: fleetStateLabel(v.agent, URGENCY_LABELS),
      tone: URGENCY[urgency].tone,
    },
    gitStatus,
    // Recency is NOT pre-formatted here: it's the one cell that changes with the
    // wall clock, not with a store delta. Carrying the raw `activeAt` (above) and
    // formatting it in the row keeps the 1s clock tick from re-running this whole
    // projection — the row reads `relativeTime(activeAt, now())` itself.
  };
}

/** Order terminals within a scope: needs-you first, then most-recently-active,
 *  then id (a stable tiebreak) — the shared `compareAgents` ordering. The one
 *  ordering every fleet view shares. */
function sortedEntries(
  terminals: Record<string, AwarenessValue>,
): Array<[TerminalId, AwarenessValue]> {
  return (
    Object.entries(terminals) as Array<[TerminalId, AwarenessValue]>
  ).sort(([ia, a], [ib, b]) =>
    compareAgents(
      { agent: a.agent, lastActivityAt: a.lastActivityAt, id: ia },
      { agent: b.agent, lastActivityAt: b.lastActivityAt, id: ib },
    ),
  );
}

/** The SAME ordering as `sortedEntries`, but over already-projected `FleetRow`s
 *  so a fleet-WIDE list (the flat `needs` view, an agent-mode section) keeps the
 *  full tiebreak — urgency rank (the shared `URGENCY_RANK`), then most-recent
 *  activity, then stable id — once the scope is the whole fleet rather than one
 *  host. Sorting only by urgency rank (the old flat path) collapsed the
 *  recency/id tiebreak the per-host sort defines, so two hosts' rows fell back to
 *  host-iteration order; this carries the keys (`activeAt`, `sortId`) through and
 *  applies them once. The row already carries its computed `urgency`, so this
 *  reads `URGENCY_RANK` directly rather than re-deriving it from the agent. */
function fleetRowOrder(a: FleetRow, b: FleetRow): number {
  const ra = URGENCY_RANK[a.urgency];
  const rb = URGENCY_RANK[b.urgency];
  if (ra !== rb) return ra - rb;
  if (a.activeAt !== b.activeAt) return b.activeAt - a.activeAt;
  return a.sortId.localeCompare(b.sortId);
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

/** Sanitize a host status for the TUI: an `unreachable` reason is ssh/nix/remote
 *  stderr, which can carry newlines/control bytes, so strip them before the
 *  badge paints it. The other arms carry only versions/no free text. JSON keeps
 *  the raw reason (it's built off the snapshot, not this view). */
function sanitizeStatus(status: FleetHostStatus): FleetHostStatus {
  return status.kind === "unreachable"
    ? { kind: "unreachable", reason: sanitize(status.reason) }
    : status;
}

/** Project the live aggregate to the board. Pure: same input, same output, no
 *  clock of its own (`now` is passed so recency is testable).
 *
 *  Every host-derived string the board PAINTS — the group label, the row's host
 *  cell, the alert-strip names, the unreachable reason — is control-byte
 *  sanitized here, the projection boundary, so `fleet.tsx` stays a uniform
 *  tone→colour paint and no CLI/ssh-config label or remote stderr can corrupt
 *  the alt-screen. (`fleet --json` is built separately off the raw snapshot.) */
export function projectFleet(
  states: FleetHostState[],
  mode: FleetMode,
): FleetView {
  // Every terminal across the fleet, each tagged with its (sanitized) host
  // DISPLAY cell plus the RAW label as its partition key — the basis for the
  // flat (needs/agent) views and the summary counts. Identity (the key) is the
  // raw label; sanitization is display-only, so two distinct hosts that sanitize
  // to the same string (e.g. `a\nb` and `a b`) stay separate buckets and never
  // merge — sanitizing must change what is PAINTED, never who a row belongs to.
  const allRows: Array<{ key: string; row: FleetRow }> = states.flatMap((s) => {
    const host = sanitize(s.label);
    const liveSet = new Set(s.live);
    // Join each terminal to its repo's live git status (keyed by repo root, not
    // terminal — the working-tree answer is shared by every terminal in a repo).
    return sortedEntries(s.terminals).map(([id, v]) => ({
      key: s.label,
      row: fleetRow(
        host,
        s.label,
        id,
        v,
        liveSet.has(id),
        v.git ? s.gitStatuses[v.git.repoRoot] : undefined,
      ),
    }));
  });

  const rows = allRows.map((r) => r.row);
  const summary: FleetSummary = {
    needYou: rows.filter((r) => r.urgency === "need").length,
    working: rows.filter((r) => r.urgency === "work").length,
    idle: rows.filter((r) => r.urgency === "idle").length,
    hostsDown: states.filter((s) => s.status.kind === "unreachable").length,
    hostsTotal: states.length,
  };
  const alertHosts = states
    .filter((s) =>
      Object.values(s.terminals).some((v) => agentUrgency(v.agent) === "need"),
    )
    .map((s) => sanitize(s.label));

  if (mode === "needs") {
    // One fleet-wide list with the FULL tiebreak (urgency, recency, id), not
    // just urgency rank — see `fleetRowOrder`.
    const flat = [...rows].sort(fleetRowOrder);
    return { mode, flat, summary, alertHosts };
  }
  if (mode === "agent") {
    const groups = AGENT_SECTIONS.map(({ urgency, label }) => ({
      label,
      // Re-sort each section by the shared comparator so rows from different
      // hosts within one urgency band order by recency/id, not host order.
      rows: rows.filter((r) => r.urgency === urgency).sort(fleetRowOrder),
    })).filter((g) => g.rows.length > 0);
    return { mode, groups, summary, alertHosts };
  }
  // host mode (default): one group per host, in dial order, even when empty or
  // down — an unreachable host renders as a distinct header, never vanishes.
  // Partition the already-projected rows by the RAW label (identity), not the
  // sanitized display string — two hosts that sanitize to the same text must NOT
  // merge into one bucket.
  const rowsByHost = new Map<string, FleetRow[]>();
  for (const { key, row } of allRows) {
    let bucket = rowsByHost.get(key);
    if (!bucket) {
      bucket = [];
      rowsByHost.set(key, bucket);
    }
    bucket.push(row);
  }
  const groups = states.map((s) => ({
    label: sanitize(s.label),
    status: sanitizeStatus(s.status),
    rows: rowsByHost.get(s.label) ?? [],
  }));
  return { mode, groups, summary, alertHosts };
}

/** `fleet --json` — a flat `[{ host, terminalId, ...AwarenessValue }]` for
 *  scripting (e.g. a notifier that pings when any box has an awaiting agent).
 *  An unreachable host emits one `{ host, terminalId: null, unreachable }` row
 *  so a down box is visible in the output, not silently absent. A contract-
 *  skewed host keeps its rows but tags each with `skew:{localVersion,hostVersion}`
 *  so a scripter sees the same skew signal the live board does, never a silently
 *  compatible-looking dump. A skewed host with NO terminals still emits one
 *  `{ host, terminalId: null, skew }` sentinel — otherwise the skew signal would
 *  vanish from JSON for an empty box even though the live board shows its skew
 *  header (the symmetry the no-fallback rule demands). */
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
      if (s.entries.length === 0) {
        // No terminals, but the skew must still surface — a row-less skewed
        // host would otherwise be indistinguishable from an absent one in JSON.
        rows.push({ host: s.label, terminalId: null, skew });
      } else {
        for (const [id, value] of s.entries) {
          rows.push({ host: s.label, terminalId: id, skew, ...value });
        }
      }
    } else {
      rows.push({ host: s.label, terminalId: null, unreachable: s.reason });
    }
  }
  return JSON.stringify(rows, null, 2);
}

// ─── Git status (R4.7) ───────────────────────────────────────────────────────
//
// The fleet board's live working-tree view: each row carries a compact cell
// (changed count + ahead/behind), and a selected row drills into a detail pane
// (the branch tracking header, the staged·modified·untracked summary, and the
// changed-file list). All pure projection over `GitStatusOutput` — `fleet.ts`
// runs the subscribeRepoChange→getStatus loop that fills it, `fleet.tsx` paints
// what these return.

/** Ahead/behind as a compact `↑a↓b` (omitting a zero side), or "" when level or
 *  untracked. `sep` spaces the two arrows apart in the roomier detail pane. */
function aheadBehindText(ahead: number, behind: number, sep = ""): string {
  const up = ahead > 0 ? `↑${ahead}` : "";
  const down = behind > 0 ? `↓${behind}` : "";
  return up && down ? `${up}${sep}${down}` : up || down;
}

/** The compact per-row working-tree cell. Undefined status (first pulse still in
 *  flight, or a terminal not in a repo) paints blank; a clean tree a calm check;
 *  a dirty tree the changed-file count — each suffixed with the branch's
 *  ahead/behind. Calm tones throughout: the fleet's colour budget is the agent
 *  urgency and the green live dot, not git churn. */
export function gitCell(status: LocalGitStatus | undefined): DashCell {
  if (!status) return { text: "", tone: "muted" };
  // The `local` arm always carries the branch header, so read it directly — no
  // null guard for a state this consumer structurally can't receive.
  const ab = aheadBehindText(status.branch.ahead, status.branch.behind);
  const changed = status.files.length;
  if (changed === 0) {
    return { text: ab ? `✓ ${ab}` : "✓", tone: "muted" };
  }
  const dirty = `✎${changed}`;
  return { text: ab ? `${dirty} ${ab}` : dirty, tone: "plain" };
}

/** Tone for one changed file's status code: added green, deleted/conflict red,
 *  modified/type-changed amber, untracked dim, rename/copy calm. Exhaustive over
 *  the closed `GitChangeStatus` enum so a new code forces a decision here. */
function gitStatusTone(code: GitChangeStatus): FieldTone {
  switch (code) {
    case "A":
      return "pass";
    case "D":
    case "U":
      return "fail";
    case "M":
    case "T":
      return "pending";
    case "?":
      return "muted";
    case "R":
    case "C":
      return "plain";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/** One changed file in the drill-in list. */
export interface GitDetailFile {
  code: string;
  path: string;
  tone: FieldTone;
}

/** The drill-in detail pane as plain data: the repo·branch title, the ahead/
 *  behind tracking, a one-line working-tree summary, and the changed-file list
 *  (capped, with a count of any overflow). `fleet.tsx` paints it; vitest tests
 *  it. */
export interface GitDetailView {
  title: string;
  tracking: string;
  summary: string;
  files: GitDetailFile[];
  more: number;
}

/** How many changed files the detail pane lists before collapsing the rest into
 *  a "+N more" line — a pane, not a full `git status`, so it stays bounded. */
export const GIT_DETAIL_FILE_CAP = 20;

/** Project a selected row to its detail pane. An unresolved status (no pulse yet)
 *  reads as "loading…", never a clean/empty tree — the no-fallback distinction
 *  between "not known yet" and "known to be clean". */
export function gitDetail(row: FleetRow): GitDetailView {
  // Derive the heading from the raw repo/branch source via the shared
  // `repoBranchText`, NOT from the compact row's already-truncated `where.text`:
  // the roomy pane and the compact cell are two independent formattings of one
  // source, so neither's width budget drives the other's heading.
  const title = repoBranchText(row.repoName, row.branch);
  const status = row.gitStatus;
  if (!status) {
    return { title, tracking: "", summary: "loading…", files: [], more: 0 };
  }
  // The `local` arm always carries the branch header and the working-tree
  // counts, so read both directly — no null arm for a state this consumer
  // structurally can't receive.
  const tracking = aheadBehindText(
    status.branch.ahead,
    status.branch.behind,
    " ",
  );
  const wt = status.workingTree;
  const summary =
    wt.staged + wt.modified + wt.untracked === 0
      ? "clean working tree"
      : `staged ${wt.staged} · modified ${wt.modified} · untracked ${wt.untracked}`;
  const shown = status.files.slice(0, GIT_DETAIL_FILE_CAP);
  const files: GitDetailFile[] = shown.map((f) => ({
    code: f.status,
    // Git file paths are arbitrary bytes — a working-tree or committed name can
    // carry a newline / ESC / BEL — so they funnel through the same control-byte
    // strip the row's repo·branch heading and every other TUI-bound cell use,
    // never painting verbatim into the alt-screen. Each half is sanitized before
    // the rename arrow is joined so the arrow itself stays intact.
    path: f.oldPath
      ? `${sanitize(f.oldPath)} → ${sanitize(f.path)}`
      : sanitize(f.path),
    tone: gitStatusTone(f.status),
  }));
  return {
    title,
    tracking,
    summary,
    files,
    more: status.files.length - shown.length,
  };
}

/** The rows in visual top-to-bottom order — the order the board paints and the
 *  selection cursor steps through: groups concatenated in their painted order,
 *  or the flat `needs` list as-is. The one flattening both the keyboard handler
 *  (for the row count) and the board (for the cursor identity) share, so a ↑/↓
 *  step always lands on the row that visually follows. */
export function flattenRows(view: FleetView): FleetRow[] {
  return view.mode === "needs" ? view.flat : view.groups.flatMap((g) => g.rows);
}

/** Step the selection from `currentKey` by `delta` over `rows` (in visual order),
 *  returning the neighbour's stable key with wrap — ↓ past the last row lands on
 *  the first, ↑ before the first on the last. Tracking identity rather than an
 *  index means the cursor survives both a shrink AND a reorder of the live row
 *  set. With NO live selection — a missing key (nothing selected yet) or a stale
 *  one (the selected terminal left) — there is no neighbour to step from, so the
 *  first keypress ENTERS the list at the natural end: ↓ selects the first row, ↑
 *  the last. (Resolving the absent key to index 0 and then adding the delta would
 *  skip the first row on the very first ↓ — a real cursor lands on what you
 *  pressed toward.) An empty list has no row to name → `null`. */
export function step(
  currentKey: string | null,
  delta: number,
  rows: FleetRow[],
): string | null {
  if (rows.length === 0) return null;
  const current = rows.findIndex((r) => r.key === currentKey);
  // No row currently holds the key (absent or stale): enter at the end the
  // keypress points toward — ↓ at the first row, ↑ at the last — rather than
  // stepping off a phantom index-0 selection.
  if (current === -1) {
    const entry = delta < 0 ? rows.length - 1 : 0;
    return rows[entry]?.key ?? null;
  }
  const next = (((current + delta) % rows.length) + rows.length) % rows.length;
  return rows[next]?.key ?? null;
}
