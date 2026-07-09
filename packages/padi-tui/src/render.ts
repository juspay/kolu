/**
 * Pure rendering helpers for the padi-tui CLI — no I/O, no transport, no tty — so
 * the formatting is unit-tested without a socket or a terminal. `main.ts` is the
 * thin glue that reads padi's `terminals` collection and prints these.
 *
 * padi-tui shows what each terminal *is in* — its record state (active · sleeping
 * · parked) · repo·branch · PR + checks · agent state · foreground — read off
 * padi's composed `terminals` collection (the same record the canvas Dock reads).
 * The `wait` verb compares the agent's coarse BUCKET (`agentBucket`), never the
 * raw `AgentInfo['state']`, so the one fold in
 * `@kolu/terminal-vocab/agentProjection` stays the single source of truth.
 */

import type { PadiTerminal } from "@kolu/padi/surface";
import {
  agentBucket,
  agentShortName,
  agentStatusLabel,
  DASH,
} from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import columnify from "columnify";

/** How many leading chars of a terminal id the human views show. v4 UUIDs
 *  collide with vanishing probability across the handful one runs; `--json`
 *  keeps the full id. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** The LIVE agent of a composed record, or `null` — only the `active` arm carries
 *  a running agent (`sleeping`/`parked` are dormant, their PTY released), so the
 *  union is narrowed here rather than at every read site. */
export function activeAgent(v: PadiTerminal): AgentInfo | null {
  return v.state === "active" ? v.agent : null;
}

/** The live foreground process of a composed record, or `null` — active-only,
 *  same as {@link activeAgent}. */
function activeForeground(v: PadiTerminal): { name: string } | null {
  return v.state === "active" ? v.foreground : null;
}

/** The outcome of resolving a user-typed id-or-prefix against the live ids —
 *  pure, so the decision is unit-tested apart from the `fail()`/exit the CLI glue
 *  maps it to. Mirrors kaval-tui's `resolveTerminalId`. */
export type ResolveResult =
  | { kind: "found"; id: TerminalId }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: TerminalId[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against the
 *  live `terminals` keys. A full id is a prefix of itself, so a pasted full id
 *  keeps resolving to itself. Matching is case-insensitive — UUIDs are lowercase
 *  hex, but a hand-typed/pasted upper-case prefix should still land. Zero matches
 *  → `none`; more than one → `ambiguous` with the full ids so the caller can ask
 *  for more chars. */
export function resolveTerminalId(
  query: string,
  ids: TerminalId[],
): ResolveResult {
  // An empty query is a prefix of EVERY id, so with one live terminal it would
  // silently resolve to it — a wrong-terminal footgun when `$id` is accidentally
  // empty. Reject it as a no-match so the caller fails loud instead.
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === q);
  if (exact !== undefined) return { kind: "found", id: exact };
  const matches = ids.filter((id) => id.toLowerCase().startsWith(q));
  const [first, ...rest] = matches;
  if (first === undefined) return { kind: "none" };
  if (rest.length > 0) return { kind: "ambiguous", matches };
  return { kind: "found", id: first };
}

/** The coarse agent buckets `wait --until` accepts as targets — the `agentBucket`
 *  fold's vocabulary minus `other` (an `other` bucket never matches a real agent,
 *  so accepting it would only ever time out). `wait` compares against the
 *  *bucket*, never the raw `AgentInfo['state']` literals, so the one fold in
 *  `@kolu/terminal-vocab/agentProjection` stays the single source of truth
 *  (see `.claude/rules/dock-fleet-mirror.md`). */
export const WAIT_STATES = [
  "working",
  "awaiting",
  "waiting",
] as const satisfies readonly Exclude<
  ReturnType<typeof agentBucket>,
  "other"
>[];

export type WaitState = (typeof WAIT_STATES)[number];

/** Parse a `--until` value — a comma list of bucket names — into the set of
 *  target buckets, or a loud error. Whitespace is trimmed, case folded, and
 *  duplicates collapse; an empty list or any token outside `WAIT_STATES` is
 *  rejected (fail-fast — no silent drop of an unrecognized state). The caller maps
 *  the error to `fail()`/exit. */
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
 *  predicate. A record with no live agent (a bare shell, a sleeping/parked
 *  terminal, or an agent that exited) is never a match; otherwise its `state`
 *  folds through the shared `agentBucket` and is tested for membership. */
export function agentMatchesUntil(
  v: PadiTerminal,
  targets: ReadonlySet<string>,
): boolean {
  const agent = activeAgent(v);
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
 *  names come from fs paths, branches from git, so both can carry control bytes),
 *  or a dash when the terminal isn't in a git repo (both `null`). */
function repoBranchText(
  repoName: string | null,
  branch: string | null,
): string {
  return repoName === null && branch === null
    ? DASH
    : `${orDash(repoName)}·${orDash(branch)}`;
}

/** The agent · state cell — `claude · working`, or a dash when no agent runs. */
function agentValue(agent: AgentInfo | null): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

/** The check status of an already-resolved PR — the resolved checks with `null`
 *  (no checks configured) folded to `pending`. */
function prChecks(
  checks: Extract<PadiTerminal["pr"], { kind: "ok" }>["value"]["checks"],
): "pass" | "fail" | "pending" {
  switch (checks) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "pending":
    case null:
      return "pending";
    default: {
      const _exhaustive: never = checks;
      return _exhaustive;
    }
  }
}

/** The PR resolution, every arm: `#<n> <state> <✓/✗/·>` when resolved, the
 *  pending/absent/unsupported/unavailable kind (with the failure code) otherwise. */
function prValueText(pr: PadiTerminal["pr"]): string {
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
    case "unsupported":
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
 *  honest one-liner, not a bare header. The STATE column names the record arm
 *  (active · sleeping · parked) — padi serves dormant records too, unlike the
 *  old pulam awareness snapshot. */
export function formatStatus(
  entries: Array<[TerminalId, PadiTerminal]>,
): string {
  if (entries.length === 0) return "no terminals.";
  const rows = [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => ({
      ID: shortId(id),
      STATE: v.state,
      REPO·BRANCH: repoBranchText(
        v.git?.repoName ?? null,
        v.git?.branch ?? null,
      ),
      PR: prValueText(v.pr),
      AGENT: agentValue(activeAgent(v)),
      FOREGROUND: orDash(activeForeground(v)?.name),
    }));
  return columnify(rows, {
    columns: ["ID", "STATE", "REPO·BRANCH", "PR", "AGENT", "FOREGROUND"],
    columnSplitter: "  ",
  })
    .split("\n")
    .map((row) => row.trimEnd())
    .join("\n");
}

/** `status --json` — a top-level array of `{ id, ...record }`, 2-space indented,
 *  full ids, controls JSON-escaped (so `jq '.[]'` works). The complete raw
 *  composed record, including the deep fields the table doesn't break out. */
export function formatStatusJson(
  entries: Array<[TerminalId, PadiTerminal]>,
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
export function formatWaitMet(id: TerminalId, agent: AgentInfo): string {
  return `${shortId(id)} reached ${agentBucket(agent.state)} · ${agentShortName(agent.kind)} ${agentStatusLabel(agent.state)}`;
}

/** A wall-clock `HH:MM:SS` stamp for a `watch` line, in local time — the live
 *  feed wants "when did this happen", not a relative age. */
function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

/** One `watch` event as a human line: `HH:MM:SS  <id>  <state>  <repo·branch>
 *  <agent · state>  [●]`, the trailing `●` present only when the terminal is
 *  moving bytes right now (the `activity` live dot). `now` is the wall clock at
 *  emit; `live` is annotation, not its own event (see `watchTerminals`). */
export function formatWatchEvent(
  id: TerminalId,
  v: PadiTerminal,
  opts: { now: number; live: boolean },
): string {
  const where = repoBranchText(v.git?.repoName ?? null, v.git?.branch ?? null);
  const cells = [
    clockTime(opts.now),
    shortId(id),
    v.state,
    where,
    agentValue(activeAgent(v)),
  ];
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

/** A live-byte-activity transition as a human line: `HH:MM:SS  <id>  ● busy` when
 *  a terminal starts moving bytes, `○ idle` when it goes quiet — the `activity`
 *  stream surfaced on its own line (the daemon-side twin of the browser green
 *  dot's on/off). */
export function formatWatchActivity(
  id: TerminalId,
  live: boolean,
  opts: { now: number },
): string {
  return `${clockTime(opts.now)}  ${shortId(id)}  ${live ? "● busy" : "○ idle"}`;
}

export function formatWatchActivityJson(id: TerminalId, live: boolean): string {
  return JSON.stringify({ id, activity: live });
}

/** `watch --json` — one JSON object per line (NDJSON, so `jq -c` streams it): the
 *  full raw record plus the live flag and the full terminal id. The `id` key
 *  matches `status --json`. A removal emits `{ id, removed: true }`. */
export function formatWatchJson(
  id: TerminalId,
  v: PadiTerminal,
  opts: { live: boolean },
): string {
  return JSON.stringify({ id, live: opts.live, ...v });
}

export function formatWatchRemovalJson(id: TerminalId): string {
  return JSON.stringify({ id, removed: true });
}
