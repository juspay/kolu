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
