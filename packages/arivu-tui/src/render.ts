/**
 * Pure rendering helpers for the arivu-tui CLI — no I/O, no transport, so the
 * formatting is unit-testable without a socket. `bin.ts` is the thin glue that
 * reads the `awareness` collection over the contract and prints these.
 *
 * One row per terminal: what it *is in* — repo branch, the open PR and its
 * checks, which agent and whether it's working/awaiting/waiting, the foreground
 * process. (No "dirty" column: the awareness value carries git branch/remote
 * but not a worktree-dirty bit, so we render what the sensors actually produce.)
 */

import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import columnify from "columnify";

/** How many leading chars of a terminal id the human view shows (and accepts as
 *  the hand-typed form). v4 UUIDs collide with vanishing probability across the
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

/** Strip terminal-hostile bytes from a human-table cell. A shell can set its
 *  title / process name to anything (newlines, raw ESC), so painting them
 *  verbatim could break the column layout or inject control effects. JSON
 *  output stays raw (`JSON.stringify` escapes controls); this is human-only. */
function sanitizeCell(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

const DASH = "—";

function branchCell(git: AwarenessValue["git"]): string {
  return git ? sanitizeCell(git.branch) : DASH;
}

/** `#<number> <glyph>` where the glyph is the CI rollup: pass ✓ / fail ✗ /
 *  pending or unconfigured ·. A PR that's pending/absent/unavailable is a dash. */
function prCell(pr: AwarenessValue["pr"]): string {
  if (pr.kind !== "ok") return DASH;
  const { number, checks } = pr.value;
  const glyph = checks === "pass" ? "✓" : checks === "fail" ? "✗" : "·";
  return `#${number} ${glyph}`;
}

/** The agent vendor's short label — `claude-code` reads as `claude`. */
export function agentShortName(kind: string): string {
  return kind === "claude-code" ? "claude" : kind;
}

/** Bucket an agent's fine-grained state into the dashboard label: actively
 *  computing → `working`, blocked on you → `awaiting`, idle → `waiting`. An
 *  unrecognized state falls through verbatim so a new agent state is visible,
 *  not silently hidden. */
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

function agentCell(agent: AwarenessValue["agent"]): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

function foregroundCell(fg: AwarenessValue["foreground"]): string {
  return fg ? sanitizeCell(fg.name) || DASH : DASH;
}

/** One row's columns, shared by the `list` table and a `watch` single-row
 *  render so the two never drift in what they show. */
function awarenessRow(
  id: TerminalId,
  v: AwarenessValue,
): Record<string, string> {
  return {
    ID: shortId(id),
    BRANCH: branchCell(v.git),
    PR: prCell(v.pr),
    AGENT: agentCell(v.agent),
    FOREGROUND: foregroundCell(v.foreground),
  };
}

const COLUMNS = ["ID", "BRANCH", "PR", "AGENT", "FOREGROUND"];

function table(rows: Array<Record<string, string>>): string {
  return columnify(rows, { columns: COLUMNS, columnSplitter: "  " })
    .split("\n")
    .map((row) => row.trimEnd())
    .join("\n");
}

/** Render the dashboard — one row per terminal, sorted by id for stable output.
 *  Empty set gets an honest one-liner, not a bare header. */
export function formatAwarenessList(
  entries: Array<[TerminalId, AwarenessValue]>,
): string {
  if (entries.length === 0) {
    return "no terminals — is kaval running, with arivu watching it?";
  }
  const rows = [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => awarenessRow(id, v));
  return table(rows);
}

/** Render a single terminal's current row — the `watch` repaint. */
export function formatAwarenessRow(id: TerminalId, v: AwarenessValue): string {
  return table([awarenessRow(id, v)]);
}

/** `list --json` — a top-level array of `{ id, ...value }`, 2-space indented,
 *  full ids, controls JSON-escaped (so `jq '.[]'` works). */
export function formatAwarenessJson(
  entries: Array<[TerminalId, AwarenessValue]>,
): string {
  return JSON.stringify(
    entries.map(([id, value]) => ({ id, ...value })),
    null,
    2,
  );
}
