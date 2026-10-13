/**
 * What has landed on a host — upstream's history log, in upstream's format.
 * One line per event (agent-distro's `src/update/update.ts` `record`):
 * `<local ISO time> <profile> <event>`, where the event is `updated:
 * <changes>`, `skipped: <reason>` or `failed: <reason>`. A run that changes
 * nothing (`unchanged`) writes no line; it only refreshes the `last-success`
 * stamp (`./schedule.ts`).
 *
 * padi writes it when kolu-server delivers a bundle to its host
 * ({@link historyLine}, with `./versions.ts`' `bundleChanges` for the words) —
 * in upstream's format, so a host that also runs agent-distro's Home Manager
 * module keeps ONE log with both writers in it. Kolu reads it back for the
 * receipt.
 */

import { Schema } from "effect";

/** One event from the history log. */
export const AgentUpdateEventSchema = Schema.Struct({
  /** When, as the updater wrote it (local ISO time with its offset). */
  at: Schema.String,
  profile: Schema.String,
  kind: Schema.Literals(["updated", "skipped", "failed"]),
  /** The updater's own words after the colon: what changed, or why not. */
  words: Schema.String,
});

export type AgentUpdateEvent = typeof AgentUpdateEventSchema.Type;

/** How many events a host's receipt carries, newest first. */
export const RECEIPT_EVENTS = 5;

const EVENT = /^(updated|skipped|failed): (.*)$/;

/** Parse one history line. Throws on a line that is not the documented shape —
 *  a format change upstream must be loud, never a silently shorter history. */
export function parseHistoryLine(line: string): AgentUpdateEvent {
  const first = line.indexOf(" ");
  const second = first < 0 ? -1 : line.indexOf(" ", first + 1);
  const at = line.slice(0, first);
  const event = second < 0 ? undefined : EVENT.exec(line.slice(second + 1));
  if (first <= 0 || second < 0 || event === null || event === undefined)
    throw new Error(
      `agent-distro history line is not '<time> <profile> <event>': ${JSON.stringify(line)}`,
    );
  if (Number.isNaN(Date.parse(at)))
    throw new Error(
      `agent-distro history line has no time: ${JSON.stringify(line)}`,
    );
  return {
    at,
    profile: line.slice(first + 1, second),
    kind: event[1] as AgentUpdateEvent["kind"],
    words: event[2] ?? "",
  };
}

/** `profile`'s last {@link RECEIPT_EVENTS} events in a history log, newest
 *  first. The log is shared by every profile on the host. */
export function recentEvents(
  text: string,
  profile: string,
): readonly AgentUpdateEvent[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseHistoryLine)
    .filter((e) => e.profile === profile)
    .slice(-RECEIPT_EVENTS)
    .reverse();
}

/** How a run ended, as the receipt shows it: `unchanged` is a successful run
 *  that found nothing newer (no history line, only the stamp). */
export const AgentUpdateOutcomeSchema = Schema.Literals([
  "updated",
  "unchanged",
  "skipped",
  "failed",
]);

export type AgentUpdateOutcome = typeof AgentUpdateOutcomeSchema.Type;

/** Who wrote a run's words: kolu's delivery (why kolu-server could not
 *  deliver a bundle, from its reports), padi (a delivery its host could not
 *  take: a bundle that is not there, a `current` that will not move), or the
 *  host's shared history log ({@link historyAuthor}). */
export const AgentUpdateAuthorSchema = Schema.Literals([
  "delivery",
  "padi",
  "agent-distro",
  "log",
]);

export type AgentUpdateAuthor = typeof AgentUpdateAuthorSchema.Type;

/** A host's last update run: when (epoch ms), how it ended, its words (what
 *  changed, or why not; empty for `unchanged`), and who wrote them. */
export const AgentUpdateRunSchema = Schema.Struct({
  at: Schema.Number,
  outcome: AgentUpdateOutcomeSchema,
  words: Schema.String,
  by: AgentUpdateAuthorSchema,
});

export type AgentUpdateRun = typeof AgentUpdateRunSchema.Type;

/** How far apart two records of one run may be and still be the same run —
 *  its stamp and its history line (padi writes both within the same moment),
 *  or padi's own record of it and the files'. */
export const SAME_RUN_MS = 5_000;

/** The last run, read off the host's files alone: the newest history event,
 *  unless the `last-success` stamp (epoch seconds) is later than it — then the
 *  last run was one that found nothing newer. `undefined` before any run. */
export function lastRunOf(
  events: readonly AgentUpdateEvent[],
  stamp: number | null,
): AgentUpdateRun | undefined {
  const newest = events[0];
  const eventAt = newest === undefined ? undefined : Date.parse(newest.at);
  const stampAt = stamp === null ? undefined : stamp * 1000;
  if (
    stampAt !== undefined &&
    (eventAt === undefined || stampAt > eventAt + SAME_RUN_MS)
  )
    return {
      at: stampAt,
      outcome: "unchanged",
      words: "",
      by: historyAuthor("unchanged"),
    };
  if (newest === undefined || eventAt === undefined) return undefined;
  return {
    at: eventAt,
    outcome: newest.kind,
    words: newest.words,
    by: historyAuthor(newest.kind),
  };
}

/** Who wrote a history-log line, by what the line says. The log is shared:
 *  agent-distro's own updater (its Home Manager module) appends every kind,
 *  padi appends only `updated:` when a delivery lands. So a `skipped:` or
 *  `failed:` line is agent-distro's; an `updated:` line, like the
 *  `last-success` stamp, may be either, and is attributed to the log itself. */
export function historyAuthor(
  kind: AgentUpdateOutcome,
): "agent-distro" | "log" {
  return kind === "skipped" || kind === "failed" ? "agent-distro" : "log";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `date` as upstream stamps a history line — local time with its offset, as
 *  `date +%Y-%m-%dT%H:%M:%S%:z` writes it (agent-distro's `timestamp()`). */
export function historyTimestamp(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`;
}

/** One history line, newline-terminated, as upstream appends it — the inverse
 *  of {@link parseHistoryLine}. */
export function historyLine(
  date: Date,
  profile: string,
  kind: AgentUpdateEvent["kind"],
  words: string,
): string {
  return `${historyTimestamp(date)} ${profile} ${kind}: ${words}\n`;
}
