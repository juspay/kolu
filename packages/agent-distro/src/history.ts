/**
 * What agent-distro's updater has done on a host — upstream's history log, as
 * kolu reads it. The updater appends one line per event (`src/update/update.ts`
 * `record`): `<local ISO time> <profile> <event>`, where the event is
 * `updated: <changes>`, `skipped: <reason>` or `failed: <reason>`, in the
 * updater's own words. A run that changes nothing (`unchanged`) writes no line;
 * it only refreshes the `last-success` stamp (`./schedule.ts`). Kolu quotes these
 * words; it never re-describes a change.
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

/** Who wrote a run's words: agent-distro's updater (its result line or its
 *  history log), or padi (a run it could not start, an updater that died
 *  without a result, a landing this host does not resolve). */
export const AgentUpdateAuthorSchema = Schema.Literals(["updater", "padi"]);

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

/** How far apart a run's stamp and its history line may be written and still
 *  be the same run (the updater writes both within the same moment). */
const SAME_RUN_MS = 5_000;

/** The last run, read off the updater's files alone: the newest history event,
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
    return { at: stampAt, outcome: "unchanged", words: "", by: "updater" };
  if (newest === undefined || eventAt === undefined) return undefined;
  return {
    at: eventAt,
    outcome: newest.kind,
    words: newest.words,
    by: "updater",
  };
}
