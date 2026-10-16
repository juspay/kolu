/**
 * What a host keeps of its agent deliveries, read back: upstream's history log
 * (read with its own parser, `@juspay/agent-distro/update/history`) and the
 * `last-success` stamp, folded into the events and the last run a host's
 * receipt carries. Pure: padi reads the files and hands their text in.
 *
 * The log is shared: agent-distro's own updater (its Home Manager module)
 * appends every kind, padi appends `updated:` when a delivery lands. So a
 * `skipped:` or `failed:` line is agent-distro's; an `updated:` line, like
 * the stamp, may be either, and is attributed to the log itself.
 */

import {
  type HistoryEvent,
  parseHistory,
} from "@juspay/agent-distro/update/history";
import { Schema } from "effect";

/** One event from the history log. */
export const AgentUpdateEventSchema = Schema.Struct({
  /** When, as the updater wrote it (local ISO time with its offset). */
  at: Schema.String,
  kind: Schema.Literals(["updated", "skipped", "failed"]),
  /** The updater's own words after the colon: what changed, or why not. */
  words: Schema.String,
  /** The profile a line written before agent-distro's one-package release was
   *  about (it kept a log per profile in one file); absent on every line since. */
  profile: Schema.optionalKey(Schema.String),
});

export type AgentUpdateEvent = typeof AgentUpdateEventSchema.Type;

/** How many events a host's receipt carries, newest first. */
export const RECEIPT_EVENTS = 5;

/** The last {@link RECEIPT_EVENTS} events of a history log's text, newest
 *  first — an older line's profile kept, so a host upgraded from per-profile
 *  bundles still says which profile each was about. Throws on a line upstream's reader refuses — a format change must
 *  be loud, never a silently shorter history. */
export function recentEvents(text: string): readonly AgentUpdateEvent[] {
  return parseHistory(text)
    .slice(-RECEIPT_EVENTS)
    .reverse()
    .map(
      ({ at, kind, words, profile }: HistoryEvent): AgentUpdateEvent => ({
        at,
        kind,
        words,
        ...(profile === undefined ? {} : { profile }),
      }),
    );
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
 *  deliver, from its reports), padi (a delivery its host could not take), or
 *  the host's shared history log ({@link historyAuthor}). */
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
  /** The profile a history line from before agent-distro's one-package
   *  release was about — {@link AgentUpdateEventSchema}'s, carried through. */
  profile: Schema.optionalKey(Schema.String),
});

export type AgentUpdateRun = typeof AgentUpdateRunSchema.Type;

/** How far apart two records of one run may be and still be the same run —
 *  its stamp and its history line (padi writes both within the same moment),
 *  or padi's own record of it and the files'. */
export const SAME_RUN_MS = 5_000;

/** Who wrote a history-log line, by what the line says (see the header). */
export function historyAuthor(
  kind: AgentUpdateOutcome,
): "agent-distro" | "log" {
  return kind === "skipped" || kind === "failed" ? "agent-distro" : "log";
}

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
    ...(newest.profile === undefined ? {} : { profile: newest.profile }),
  };
}
