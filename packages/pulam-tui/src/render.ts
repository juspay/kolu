/**
 * Pure rendering helpers for the pulam-tui CLI — no I/O, no transport, no
 * tty — so the formatting is unit-tested without a socket or a terminal.
 * `main.ts` is the thin glue that reads the surface and prints these.
 *
 * pulam-tui shows what each terminal *is in* — repo·branch · PR + checks · agent
 * state · foreground · recency — where kaval-tui shows what's *running*. The
 * compact one-row-per-terminal `status` table is the human view; `--json` dumps
 * the full raw `AwarenessValue` (every deep field) for scripts. `watch` prints
 * one line per awareness change as it streams.
 */

import {
  agentBucket,
  agentShortName,
  agentStatusLabel,
  DASH,
  relativeTime,
} from "@kolu/terminal-workspace/agentProjection";
import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import columnify from "columnify";

/** How many leading chars of a terminal id the human views show. v4 UUIDs
 *  collide with vanishing probability across the handful one runs; `--json`
 *  keeps the full id. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** The outcome of resolving a user-typed id-or-prefix against the live ids —
 *  pure, so the decision is unit-tested apart from the `fail()`/exit the CLI
 *  glue maps it to. Mirrors kaval-tui's `resolveTerminalId`. */
export type ResolveResult =
  | { kind: "found"; id: TerminalId }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: TerminalId[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against
 *  the live awareness snapshot. A full id is a prefix of itself, so a pasted
 *  full id keeps resolving to itself unchanged. Matching is case-insensitive —
 *  UUIDs are lowercase hex, but a hand-typed or pasted upper-case prefix should
 *  still land. Zero matches → `none`; more than one → `ambiguous` with the full
 *  ids so the caller can ask for more chars. */
export function resolveTerminalId(
  query: string,
  ids: TerminalId[],
): ResolveResult {
  // An empty query is a prefix of EVERY id (`"".startsWith("")` is true for all
  // strings), so with one live terminal it would silently resolve to it — a
  // wrong-terminal footgun when `$id` is accidentally empty. Reject it as a
  // no-match so the caller fails loud instead.
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
  // An exact id wins outright, so a full id never reads as ambiguous against a
  // longer id that happens to share its prefix.
  const exact = ids.find((id) => id.toLowerCase() === q);
  if (exact !== undefined) return { kind: "found", id: exact };
  const matches = ids.filter((id) => id.toLowerCase().startsWith(q));
  // Destructure so the single-match case yields a non-optional `first`
  // (indexing would be `TerminalId | undefined` under noUncheckedIndexedAccess).
  const [first, ...rest] = matches;
  if (first === undefined) return { kind: "none" };
  if (rest.length > 0) return { kind: "ambiguous", matches };
  return { kind: "found", id: first };
}

/** The coarse agent buckets `wait --until` accepts as targets — the
 *  `agentBucket` fold's vocabulary minus `other` (an `other` bucket never
 *  matches a real agent, so accepting it would only ever time out). `wait`
 *  compares against the *bucket*, never the raw `AgentInfo['state']` literals,
 *  so the one fold in `@kolu/terminal-workspace/agentProjection` stays the
 *  single source of truth (see `.claude/rules/dock-fleet-mirror.md`). */
export const WAIT_STATES = ["working", "awaiting", "waiting"] as const;

export type WaitState = (typeof WAIT_STATES)[number];

/** Parse a `--until` value — a comma list of bucket names — into the set of
 *  target buckets, or a loud error. Whitespace is trimmed, case folded, and
 *  duplicates collapse; an empty list or any token outside `WAIT_STATES` is
 *  rejected (fail-fast — no silent drop of an unrecognized state). The caller
 *  maps the error to `fail()`/exit. */
export function parseUntilStates(
  raw: string,
):
  | { kind: "ok"; targets: Set<WaitState> }
  | { kind: "error"; message: string } {
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const valid = new Set<string>(WAIT_STATES);
  const unknown = tokens.filter((t) => !valid.has(t));
  if (tokens.length === 0 || unknown.length > 0) {
    const offending = unknown.length > 0 ? unknown.join(", ") : "(none given)";
    return {
      kind: "error",
      message: `--until: unknown state(s) ${offending} — use a comma list of: ${WAIT_STATES.join(", ")} (e.g. --until awaiting,waiting).`,
    };
  }
  return { kind: "ok", targets: new Set(tokens as WaitState[]) };
}

/** Whether a terminal's agent is in one of the target buckets — the `wait`
 *  predicate. A terminal with no agent (a bare shell, or an agent that exited)
 *  is never a match; otherwise its `state` folds through the shared `agentBucket`
 *  and is tested for membership. */
export function agentMatchesUntil(
  agent: AwarenessValue["agent"],
  targets: ReadonlySet<string>,
): boolean {
  return agent !== null && targets.has(agentBucket(agent.state));
}

/** Strip terminal-hostile bytes from a human-rendered value. A shell can set its
 *  title / process name / branch to anything (newlines, raw ESC), so painting
 *  them verbatim could break the column layout or inject control effects. JSON
 *  output stays raw (`JSON.stringify` escapes controls); this is human-only. */
export function sanitize(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

function orDash(value: string | null | undefined): string {
  return value ? sanitize(value) || DASH : DASH;
}

/** `repo·branch` from the raw repo/branch source — each half sanitized (repo
 *  names come from fs paths, branches from git, so both can carry control
 *  bytes), or a dash when the terminal isn't in a git repo (both `null`). */
function repoBranchText(
  repoName: string | null,
  branch: string | null,
): string {
  return repoName === null && branch === null
    ? DASH
    : `${orDash(repoName)}·${orDash(branch)}`;
}

/** The agent · state cell — `claude · working`, or a dash when no agent runs. */
function agentValue(agent: AwarenessValue["agent"]): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

/** The check status of an already-resolved PR — the resolved checks with `null`
 *  (no checks configured) folded to `pending`. The caller has already narrowed
 *  to the `ok` arm; the exhaustive switch forces a decision on a new checks
 *  state. */
function prChecks(
  checks: Extract<AwarenessValue["pr"], { kind: "ok" }>["value"]["checks"],
): "pass" | "fail" | "pending" {
  switch (checks) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "pending":
    case null: // null = no checks configured; reads the same as pending here
      return "pending";
    default: {
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
      const checks = prChecks(pr.value.checks);
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
      const _exhaustive: never = pr;
      return _exhaustive;
    }
  }
}

/** Render the `status` table — one row per terminal, columns auto-sized by
 *  `columnify` (the borderless, space-aligned `docker ps` style kaval-tui's
 *  `list` uses). Sorted by id for a stable display. Empty inventory gets an
 *  honest one-liner, not a bare header. */
export function formatStatus(
  entries: Array<[TerminalId, AwarenessValue]>,
  opts: { now: number },
): string {
  if (entries.length === 0) return "no terminals.";
  const rows = [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => ({
      ID: shortId(id),
      REPO·BRANCH: repoBranchText(
        v.git?.repoName ?? null,
        v.git?.branch ?? null,
      ),
      PR: prValueText(v.pr),
      AGENT: agentValue(v.agent),
      FOREGROUND: orDash(v.foreground?.name),
      IDLE: relativeTime(v.lastActivityAt, opts.now),
    }));
  return (
    columnify(rows, {
      columns: ["ID", "REPO·BRANCH", "PR", "AGENT", "FOREGROUND", "IDLE"],
      columnSplitter: "  ",
      config: { IDLE: { align: "right" } },
    })
      // columnify right-pads every column including the last; drop the trailing
      // run so piped/asserted output has no dangling whitespace.
      .split("\n")
      .map((row) => row.trimEnd())
      .join("\n")
  );
}

/** `status --json` — a top-level array of `{ id, ...value }`, 2-space indented,
 *  full ids, controls JSON-escaped (so `jq '.[]'` works). The complete raw
 *  awareness value, including the deep fields the table doesn't break out. */
export function formatAwarenessJson(
  entries: Array<[TerminalId, AwarenessValue]>,
): string {
  return JSON.stringify(
    entries.map(([id, value]) => ({ id, ...value })),
    null,
    2,
  );
}

/** The `wait` success trailer (stderr) — `a1b2c3d4 reached awaiting · claude
 *  awaiting_user`: the short id, the bucket it landed in (the shared `agentBucket`
 *  fold), and the agent's short name + raw state for the detail. `--json` emits
 *  the full `{ id, agent }` instead. */
export function formatWaitMet(
  id: TerminalId,
  agent: NonNullable<AwarenessValue["agent"]>,
): string {
  return `${shortId(id)} reached ${agentBucket(agent.state)} · ${agentShortName(agent.kind)} ${agentStatusLabel(agent.state)}`;
}

/** A wall-clock `HH:MM:SS` stamp for a `watch` line, in local time — the live
 *  feed wants "when did this happen", not a relative age. */
function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

/** One `watch` event as a human line: `HH:MM:SS  <id>  <repo·branch>  <agent ·
 *  state>  [●]`, the trailing `●` present only when the terminal is moving bytes
 *  right now (the `activity` live dot). `now` is the wall clock at emit; `live`
 *  is annotation, not its own event (see `watchAwareness`). */
export function formatWatchEvent(
  id: TerminalId,
  v: AwarenessValue,
  opts: { now: number; live: boolean },
): string {
  const where = repoBranchText(v.git?.repoName ?? null, v.git?.branch ?? null);
  const cells = [clockTime(opts.now), shortId(id), where, agentValue(v.agent)];
  if (opts.live) cells.push("●");
  return cells.join("  ");
}

/** A terminal leaving the collection (its kaval PTY ended) as a human line. */
export function formatWatchRemoval(
  id: TerminalId,
  opts: { now: number },
): string {
  return `${clockTime(opts.now)}  ${shortId(id)}  (gone)`;
}

/** `watch --json` — one JSON object per line (newline-delimited / NDJSON, so
 *  `jq -c` streams it): the full raw awareness value plus the live flag and the
 *  full terminal id. The `id` key matches `status --json`, so one script reads
 *  both streams. A removal emits `{ id, removed: true }`. */
export function formatWatchJson(
  id: TerminalId,
  v: AwarenessValue,
  opts: { live: boolean },
): string {
  return JSON.stringify({ id, live: opts.live, ...v });
}

export function formatWatchRemovalJson(id: TerminalId): string {
  return JSON.stringify({ id, removed: true });
}
