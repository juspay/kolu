/** THE MACHINE'S LINE, in one line.
 *
 *  A `wake` row carries the whole account kolu handed the agent (`text`) and
 *  the events it was built from. The account is several paragraphs — which
 *  terminal, on which host, how it stands — and the transcript cannot spend
 *  that much of itself on a line nobody asked for, so the row draws a HEADLINE
 *  derived from the events and opens for the rest.
 *
 *  The headline is built from the events rather than cut out of the text
 *  because the text is prose written FOR the agent: cutting its first line
 *  would give a person the opening of a briefing ("You are the Conductor…")
 *  instead of the news. The events are the news. */

import type { ConductorWakeEvent } from "kolu-common/conductor";

/** How many terminals the one line names before it starts counting. Three
 *  fits a 390px phone beside the `kolu ·` prefix and the ▸; past that the
 *  count is the honest summary. */
const NAMED_LIMIT = 3;

/** What each level is CALLED on the line. `gone` is the terminal, not its
 *  agent — the two other levels are the agent's. */
const LEVEL_WORD: Record<ConductorWakeEvent["level"], string> = {
  stopped: "stopped",
  asking: "asking",
  gone: "gone",
};

/** The one-line news: `planner stopped · impl asking`, with `+2 more` when
 *  the turn is about more terminals than a line holds.
 *
 *  A wake with no events is a producer bug rather than a state to draw, but
 *  this is a renderer: it says what it has instead of throwing inside a
 *  transcript that would then draw nothing at all. */
export function wakeHeadline(events: readonly ConductorWakeEvent[]): string {
  if (events.length === 0) return "a watched terminal rang";
  const named = events
    .slice(0, NAMED_LIMIT)
    .map((event) => `${event.name} ${LEVEL_WORD[event.level]}`);
  const rest = events.length - named.length;
  return rest > 0 ? `${named.join(" · ")} · +${rest} more` : named.join(" · ");
}

/** WHEN it rang, as a clock reading (`14:32`) in the reader's own zone.
 *
 *  A clock time and not an elapsed one: this row sits still in the scrollback
 *  while the conversation goes on above it, and "4m ago" on a row you scroll
 *  back to an hour later is a lie that has to be re-rendered forever to stop
 *  being one. An unparseable stamp draws nothing rather than `Invalid Date`. */
export function wakeWhen(since: string): string | null {
  const at = Date.parse(since);
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
