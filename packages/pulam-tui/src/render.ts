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

/** The single discriminator for a PR's check status — `none` when the PR isn't
 *  resolved, else the resolved checks with `null` (no checks configured) folded
 *  to `pending`. The exhaustive switch forces a decision on a new checks state. */
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
 *  full terminal id. A removal emits `{ terminalId, removed: true }`. */
export function formatWatchJson(
  id: TerminalId,
  v: AwarenessValue,
  opts: { live: boolean },
): string {
  return JSON.stringify({ terminalId: id, active: opts.live, ...v });
}

export function formatWatchRemovalJson(id: TerminalId): string {
  return JSON.stringify({ terminalId: id, removed: true });
}
