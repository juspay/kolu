/**
 * Pure rendering helpers for padi's CLI faces — no I/O, no transport, no tty — so
 * the formatting is unit-tested without a socket or a terminal. Each CLI's `main`
 * is the thin glue that reads padi's `terminals` collection and prints these.
 * Shared here (beside the dial kit) because padi-tui and kolu's CLI render the
 * SAME table from the same records; a second copy would be a second truth.
 *
 * These views show what each terminal *is in* — its record state (active ·
 * sleeping · parked) · repo·branch · PR + checks · agent state · foreground —
 * read off padi's composed `terminals` collection (the same record the canvas
 * Dock reads). The `wait` verb compares the agent's coarse BUCKET
 * (`agentBucket`), never the raw `AgentInfo['state']`, so the one fold in
 * `@kolu/terminal-vocab/agentProjection` stays the single source of truth.
 */

// `../terminalVocab.ts`, NOT `./dial.ts`. The three symbols are the same ones —
// `dial.ts` merely re-exports them — but reaching them through the dial kit put
// `socketDuplexLink`, `@kolu/surface-daemon-supervisor`, `@kolu/surface-remote`
// and `kolu-pty` in this formatter's module graph, refuting the "no I/O, no
// transport, no tty" promise on line 1. A stated invariant the import graph
// contradicts will be relied on and will break.
import type { PadiTerminal } from "../surface.ts";
import { activeAgent } from "../terminalVocab.ts";
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

/** The live foreground process of a composed record, or `null` — active-only,
 *  same as `activeAgent` (which now lives in the dial kit's watch module,
 *  beside the wait predicate it feeds). */
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
  ids: readonly TerminalId[],
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

// `parseUntilStates` used to live here: the comma split, plus a `--until:`-
// prefixed error string, inside a module that renders. `watch.ts`'s header states
// the rule it broke — "the CLI-flag grammar (`--until`'s comma parse and its
// error strings) stays in the face; only the surface-shaped vocabulary and the
// watch/wait machinery live here" — and the tell was that its one caller THREW
// the returned message away and re-spelled it, because a padi-side error cannot
// name the three `--until` FORMS a CLI user needs. What padi owns is
// `isWaitState` (`terminalVocab.ts`): whether a token is a bucket, and nothing
// about commas.

/** The last `tail` lines of a rendered screen, with the trailing run of
 *  whitespace-only rows dropped first.
 *
 *  A pure fold over `screen.text`'s output, and it lives beside padi's other
 *  formatters because the rule it encodes is about padi's REPLY: the rendered
 *  buffer ends in the empty viewport below the cursor, which carries zero
 *  information and would otherwise BE the tail (`tail: 6` on a fresh shell
 *  returned six blank lines — a real bug, caught on the MCP face). Blank lines
 *  BETWEEN content are kept verbatim.
 *
 *  It was `kolu-mcp/screenText`'s until `kolu snapshot --tail` became its second
 *  consumer and imported it from there — a CLI verb reaching sideways into a
 *  sibling FACE's adapter for domain knowledge, which also made `cli.ts`'s
 *  per-face fence claim false (a terminal verb was building an MCP argument
 *  schema at module load). Both faces now import it from the package that owns
 *  the reply it folds. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - tail), end).join("\n");
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
 *  retired pulam daemon's awareness snapshot. */
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
