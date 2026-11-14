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

import type {
  ConductorReadingLevel,
  ConductorWakeEvent,
  ConductorWakeLevel,
} from "kolu-common/conductor";

/** How many terminals the one line names before it starts counting. Three
 *  fits a 390px phone beside the `kolu ·` prefix and the ▸; past that the
 *  count is the honest summary. */
const NAMED_LIMIT = 3;

/** WHAT EACH LEVEL IS CALLED ON SCREEN — the app's ONE words table for the
 *  watch's vocabulary, read by this line (`<name> <word>`) and by the watched
 *  panel's row (`<word> <elapsed>`).
 *
 *  One table because the levels are a WIRE enum on the rules' clock and these
 *  are words on a reader's: the panel used to print the token itself, so
 *  `shell 3m` was jargon on screen and no rewording was possible without a
 *  protocol change. Keyed by every level the watch can publish, so a level
 *  added to the schema fails to compile here rather than reaching a person
 *  as its own enum name.
 *
 *  Three are the AGENT'S standing (`is up`, `stopped`, `asking`), one is the
 *  terminal's (`gone`), one is the terminal kolu was told to sleep (`asleep` —
 *  the agent in it is dead, and that is why it rang), `working` is an agent
 *  visibly moving, `shell` is a prompt with nothing in front of it (so the
 *  words say `no agent`, which is the fact a person is after), `ended` is a
 *  terminal the Conductor created with a command that ran and came back to a
 *  prompt with no agent ever appearing: the words say WHAT IS MISSING, because
 *  "ended" alone reads like a success. `exited` is the other ending — an agent
 *  that WAS there and whose program left the foreground, leaving the terminal
 *  at its shell prompt — and the plain word is the honest one: a person
 *  reading `planner exited` knows both that there was a planner and that there
 *  is not one now.
 *
 *  The two PRESENCE readings are the agent's standing before it has written a
 *  line of transcript: `starting` is its screen still being drawn, and `fresh`
 *  is that screen settled with nothing ever said to it — which a person reads
 *  as `ready`, the same plain word the watched panel's rows and the dock use
 *  for it. `ready` the WAKE level keeps `is up`: the wake line is a sentence
 *  about a terminal (`planner is up`) and the panel's row is a standing with a
 *  clock on it (`ready 4s`), so the two stay worded for where they are read. */
export const LEVEL_WORD: Record<
  ConductorReadingLevel | ConductorWakeLevel,
  string
> = {
  working: "working",
  shell: "no agent",
  stopped: "stopped",
  asking: "asking",
  gone: "gone",
  ready: "is up",
  starting: "starting",
  fresh: "ready",
  asleep: "asleep",
  ended: "ended without an agent",
  exited: "exited",
};

/** The one-line news: `planner is up · impl asking`, with `+2 more` when
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
