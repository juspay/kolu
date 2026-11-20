import {
  type PadiStateEvent,
  type PadiTerminal,
  WATCH_STATE_EVENT_KINDS,
} from "@kolu/padi-client/surface";
import { activeAgent } from "@kolu/padi-client/terminalVocab";
import {
  agentBucket,
  agentShortName,
  agentStatusLabel,
  DASH,
  relativeTime,
  WAIT_STATES,
} from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  GitFact,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import columnify from "columnify";

/** How many leading chars of a terminal id the human views show. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

export {
  isBlank,
  parsePlacementFlags,
  type PlacementFlagsRead,
  type StatedPlacementFlags,
} from "./placementFlags.ts";

function activeForeground(v: PadiTerminal): { name: string } | null {
  return v.state === "active" ? v.foreground : null;
}

/** Strip terminal-hostile bytes from a human-rendered value: a shell can set
 *  its own title, and a rendered row must not be able to drive the reader's
 *  terminal. */
export function sanitize(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

function orDash(value: string | null | undefined): string {
  return value ? sanitize(value) || DASH : DASH;
}

function gitText(git: GitFact): string {
  switch (git.kind) {
    case "repo":
      return `${orDash(git.info.repoName)}·${orDash(git.info.branch)}`;
    case "none":
      return DASH;
    case "unresolved":
      return "?";
    default:
      return git satisfies never;
  }
}

function agentValue(agent: AgentInfo | null): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

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

/** Render the `status` table — one row per terminal, sorted by id, columns
 *  auto-sized. `no terminals.` when the roster is empty. */
export function formatStatus(
  entries: Array<[TerminalId, PadiTerminal]>,
): string {
  if (entries.length === 0) return "no terminals.";
  const rows = [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => ({
      ID: shortId(id),
      STATE: v.state,
      REPO·BRANCH: gitText(v.git),
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

/** `status --json` — a top-level array of `{ id, ...record }`, 2-space
 *  indented. */
export function formatStatusJson(
  entries: Array<[TerminalId, PadiTerminal]>,
): string {
  return JSON.stringify(
    entries.map(([id, value]) => ({ id, ...value })),
    null,
    2,
  );
}

/** The `wait` success trailer (stderr): `<short id> reached <bucket> · <agent>
 *  <status>`. */
export function formatWaitMet(id: TerminalId, agent: AgentInfo): string {
  return `${shortId(id)} reached ${agentBucket(agent.state)} · ${agentShortName(agent.kind)} ${agentStatusLabel(agent.state)}`;
}

function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

export function formatWatchEvent(
  id: TerminalId,
  v: PadiTerminal,
  opts: { now: number; live: boolean },
): string {
  const where = gitText(v.git);
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

export function formatWatchRemoval(
  id: TerminalId,
  opts: { now: number },
): string {
  return `${clockTime(opts.now)}  ${shortId(id)}  (gone)`;
}

export function formatWatchActivity(
  id: TerminalId,
  live: boolean,
  opts: { now: number },
): string {
  return `${clockTime(opts.now)}  ${shortId(id)}  ${live ? "● busy" : "○ idle"}`;
}

/** Every `kind` the CHANGE tail can print — the vocabulary this module
 *  INVENTS, as opposed to the state kinds the wire declares. */
export const WATCH_CHANGE_EVENT_KINDS = [
  "terminal",
  "removed",
  "activity",
] as const;

export function formatWatchActivityJson(id: TerminalId, live: boolean): string {
  return watchJsonLine({ kind: "activity", id, activity: live });
}

/** `watch --json` — one JSON object per line (NDJSON, so `jq -c` streams it):
 *  the record, with `kind`, `id` and `live` in front. */
export function formatWatchJson(
  id: TerminalId,
  v: PadiTerminal,
  opts: { live: boolean },
): string {
  return watchJsonLine({ kind: "terminal", id, live: opts.live, ...v });
}

export function formatWatchRemovalJson(id: TerminalId): string {
  return watchJsonLine({ kind: "removed", id });
}

/** One agent-STATE event as an NDJSON line — the wire event, verbatim. */
export function formatStateEventJson(event: PadiStateEvent): string {
  return watchJsonLine(event);
}

const widestOf = (words: readonly string[]): number =>
  words.reduce((w, s) => Math.max(w, s.length), 0);
/** Every `kind` a `kolu watch --json` line can carry, both feeds and the
 *  pulse — what a consumer may switch on. */
export const WATCH_FEED_KINDS = [
  ...WATCH_STATE_EVENT_KINDS,
  ...WATCH_CHANGE_EVENT_KINDS,
  "heartbeat",
] as const;

export type WatchFeedKind = (typeof WATCH_FEED_KINDS)[number];

/** One NDJSON line of the watch feed: its `kind` is REQUIRED, and every writer
 *  in this module serializes through {@link watchJsonLine}. */
export type WatchJsonLine = { readonly kind: WatchFeedKind };

const watchJsonLine = <L extends WatchJsonLine>(line: L): string =>
  JSON.stringify(line);

const KIND_WIDTH = widestOf(WATCH_FEED_KINDS);
const STATE_WIDTH = widestOf(WAIT_STATES);

export function formatStateEvent(event: PadiStateEvent): string {
  const cells = [
    clockTime(event.at),
    shortId(event.id),
    event.kind.padEnd(KIND_WIDTH),
    event.state.padEnd(STATE_WIDTH),
    relativeTime(event.since, event.at),
  ];
  if (event.intent !== undefined) cells.push(event.intent);
  return cells.join("  ");
}

export function formatHeartbeat(at: number): string {
  return [clockTime(at), " ".repeat(SHORT_ID_LEN), "heartbeat"].join("  ");
}

export function formatHeartbeatJson(at: number): string {
  return watchJsonLine({ kind: "heartbeat", at });
}
