/**
 * Pure rendering helpers for the arivu-tui CLI — no I/O, no transport, so the
 * formatting is unit-testable without a socket. `bin.ts` is the thin glue that
 * reads the `awareness` collection over the contract and prints these.
 *
 * The whole point of arivu-tui is to surface what `@kolu/terminal-awareness`
 * produces, so the view shows EVERY field the `AwarenessValue` carries. A flat
 * one-row-per-terminal table can't fit that many columns without wrapping into
 * gibberish, so each terminal is rendered as a VERTICAL RECORD — a header line
 * (`<id>  <cwd>`) followed by one aligned `label  value` line per field. The
 * only things not broken out are the deep internals (git's repoRoot/worktree
 * paths, the per-check array, vendor agent ids); those stay in `--json`.
 */

import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";

/** How many leading chars of a terminal id the header shows (and accepts as the
 *  hand-typed form). v4 UUIDs collide with vanishing probability across the
 *  handful one runs; `--json` keeps the full id. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** The outcome of resolving a user-typed id-or-prefix against the live ids. */
export type ResolveResult =
  | { kind: "found"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: string[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against
 *  the live set. A full id is a prefix of itself, so a pasted full id resolves
 *  to itself. Empty query is a no-match (a prefix of every id — a footgun if
 *  `$id` is accidentally empty). Case-insensitive (UUIDs are lowercase hex). */
export function resolveTerminalId(query: string, ids: string[]): ResolveResult {
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

const DASH = "—";

/** Strip terminal-hostile bytes from a value. A shell can set its title /
 *  process name to anything (newlines, raw ESC), so painting them verbatim
 *  could inject control effects. JSON output stays raw; this is human-only. */
function sanitize(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

/** Collapse a leading `$HOME` to `~` for a shorter, familiar path. */
function tildeify(cwd: string, home: string | undefined): string {
  if (home === undefined || home === "") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
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

/** Bucket an agent's fine-grained state into the dashboard label: actively
 *  computing → `working`, blocked on you → `awaiting`, idle → `waiting`. An
 *  unrecognized state falls through verbatim so a new agent state is visible. */
export function agentStatusLabel(state: string): string {
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
      return state;
  }
}

function agentValue(agent: AwarenessValue["agent"]): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

/** The PR resolution, every arm: `#<n> <state> <✓/✗/·>` when resolved, the
 *  pending/absent/unavailable kind (with the failure code) otherwise. */
function prValueText(pr: AwarenessValue["pr"]): string {
  switch (pr.kind) {
    case "ok": {
      const { number, state, checks } = pr.value;
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

/** Every field of the awareness value as `[label, value]` rows, in one place so
 *  `list` and `watch` never drift. The header (id + cwd) is separate. */
function fields(v: AwarenessValue, now: number): Array<[string, string]> {
  return [
    ["agent", agentValue(v.agent)],
    ["pr", prValueText(v.pr)],
    ["branch", orDash(v.git?.branch)],
    ["repo", orDash(v.git?.repoName)],
    ["remote", orDash(v.git?.remoteUrl)],
    ["foreground", orDash(v.foreground?.name)],
    ["title", orDash(v.foreground?.title)],
    ["agent cmd", orDash(v.lastAgentCommand)],
    ["active", relativeTime(v.lastActivityAt, now)],
  ];
}

const LABEL_WIDTH = 11;

/** Per-row render options threaded from the CLI. */
export interface RenderOptions {
  /** The home dir to collapse to `~` in the cwd. */
  home?: string;
  /** "Now" for the relative `active` line (defaults to wall-clock). */
  now?: number;
}

/** One terminal as a vertical record: `<id>  <cwd>` then an aligned
 *  `label  value` line per awareness field. */
function record(
  id: TerminalId,
  v: AwarenessValue,
  opts: RenderOptions,
): string {
  const now = opts.now ?? Date.now();
  const header = `${shortId(id)}  ${sanitize(tildeify(v.cwd, opts.home)) || DASH}`;
  const lines = fields(v, now).map(
    ([label, value]) => `  ${label.padEnd(LABEL_WIDTH)}${value}`,
  );
  return [header, ...lines].join("\n");
}

/** Render the dashboard — one vertical record per terminal, sorted by id for
 *  stable output, blank-line separated. Empty set gets an honest one-liner. */
export function formatAwarenessList(
  entries: Array<[TerminalId, AwarenessValue]>,
  opts: RenderOptions = {},
): string {
  if (entries.length === 0) {
    return "no terminals — is kaval running, with arivu watching it?";
  }
  return [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => record(id, v, opts))
    .join("\n\n");
}

/** Render a single terminal's record — the `watch` repaint. */
export function formatAwarenessRow(
  id: TerminalId,
  v: AwarenessValue,
  opts: RenderOptions = {},
): string {
  return record(id, v, opts);
}

/** `list --json` — a top-level array of `{ id, ...value }`, 2-space indented,
 *  full ids, controls JSON-escaped (so `jq '.[]'` works). The complete raw
 *  awareness value, including the deep fields the record doesn't break out. */
export function formatAwarenessJson(
  entries: Array<[TerminalId, AwarenessValue]>,
): string {
  return JSON.stringify(
    entries.map(([id, value]) => ({ id, ...value })),
    null,
    2,
  );
}
