/** HOW TO USE THE CONDUCTOR — the words, written once.
 *
 *  A person arriving at this conversation for the first time is looking at a
 *  box and a blinking cursor, and nothing on screen says that `@` reaches
 *  every host, that a turn can be steered while it runs, or that they never
 *  have to ask "are you done". So the pane teaches, in the margin: a column in
 *  the reading column's own gutter on a wide window (`ConductorHelp.tsx`), the
 *  same words as a sheet from the `⋯` menu everywhere else.
 *
 *  ONE COPY. The column and the sheet render THIS list — a second copy is how
 *  a help text comes to describe a chord that was renamed a release ago. Every
 *  statement here is read off the build it describes, not off a wish:
 *
 *    - `@` and `/` are the composer's own two completions, and `@` spans every
 *      host (`ConductorComposer.tsx`).
 *    - A waterfall ASKS ITS OWN setup questions first. Which ones, and how a
 *      mode changes what follows, is the script's (`packages/conductor/src/
 *      teaching.md`) and revs with the procedure — so the help says THAT it
 *      asks and not WHICH, because a list here is a copy of a document this
 *      module cannot see, and the copy is the half that goes stale.
 *    - Enter queues at the agent, the steer chord goes into the running turn
 *      while the status line offers it, and `■ Stop` is beside Send.
 *    - A wake is kolu ringing the conversation when a watched agent comes up,
 *      stops, asks, or is gone / asleep / ended without an agent
 *      (`wake.ts`'s own levels) — drawn as the `kolu ·` line in the
 *      transcript.
 *    - A question arrives as a form, and the tab's badge turns the needs-you
 *      violet while it stands (`ConductorTab.tsx`).
 *
 *  STATIC. No counts, no live data, nothing that has to be re-read while a
 *  turn runs: this is the manual, and the conversation beside it is the state.
 *  The one thing computed is the steer chord, which is printed in the reader's
 *  own idiom rather than spelled `⌥⏎` at a Linux reader.
 *
 *  SHORT. Each line is one sentence that fits the help column in at most two
 *  lines at its own measure — `conductorHelp.test.ts` does that arithmetic
 *  from the tokens, so widening the column relaxes the rule and narrowing it
 *  tightens it, and neither can be forgotten. */

import { createDisclosure } from "../ui/createDisclosure";
import { formatKeybind } from "../input/keyboard";
import { boolPref } from "../persistedPref";
import { STEER_KEYBIND } from "./steer";

/** The sections, in the order they are read. The id is what a test and a
 *  stylesheet address a section BY, so a reworded heading is not a broken
 *  selector. */
export type HelpSectionId =
  | "ask"
  | "waterfall"
  | "while-it-works"
  | "mid-work"
  | "wakes"
  | "asks";

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly heading: string;
  /** One sentence a line. Not a paragraph — a paragraph in a 16rem column is
   *  a wall, and the whole point of this panel is that it is skimmed. */
  readonly lines: readonly string[];
}

/** The help, built fresh on each read so the steer chord is printed for the
 *  platform the reader is actually on. */
export function helpSections(): readonly HelpSection[] {
  const steer = formatKeybind(STEER_KEYBIND);
  return [
    {
      id: "ask",
      heading: "Ask",
      lines: [
        "Type what you want it to do.",
        "@ names a terminal on any host, / runs an agent command.",
      ],
    },
    {
      id: "waterfall",
      heading: "Waterfall",
      lines: [
        "Say “waterfall <what> in <repo>” to have it built end to end.",
        "It asks a few setup questions first, then runs on its own.",
      ],
    },
    {
      id: "while-it-works",
      heading: "While it works",
      lines: [
        "The status line says what it is doing, and for how long.",
        "Work in progress is listed beside the conversation.",
        "On a narrower window it is behind the status line's count.",
        "Press a terminal's name to go to it; Look peeks at its screen.",
      ],
    },
    {
      id: "mid-work",
      heading: "Talk to it mid-work",
      lines: [
        "Enter queues your message behind the running turn.",
        `${steer} steers the turn that is running, when it is offered.`,
        "Stop, beside Send, ends it.",
      ],
    },
    {
      id: "wakes",
      heading: "It wakes itself",
      lines: [
        "You never have to ask whether it is done.",
        "kolu wakes it when a watched agent comes up, stops, asks or dies.",
        "A “kolu ·” line in the conversation is that wake.",
      ],
    },
    {
      id: "asks",
      heading: "When it asks you",
      lines: [
        "It asks through a form in the conversation; answer it there.",
        "Until you do, the Conductor tab's badge is violet.",
      ],
    },
  ];
}

/** IS THE HELP COLUMN OPEN — a device preference, through the one persisted
 *  preference seam every other remembered panel in this app rides
 *  (`persistedPref.ts`'s `boolPref`, as the Code tab's ignored-files toggle
 *  does). Open on a first visit, and whatever you left it as on every visit
 *  after that, reloads included.
 *
 *  Module level, like the other panel prefs: the pane is retained for the
 *  page's life, but the fact outlives the PAGE, and a signal inside a
 *  component would only have said the first half. */
export const [helpOpen, setHelpOpen] = boolPref({
  name: "kolu-conductor-help-open",
  fallback: true,
});

/** The sheet the `⋯` menu's `How to use` opens, below the help column's width
 *  and on a phone — the repo's one disclosure shape, co-located with the words
 *  it shows (`ShortcutsHelp`'s precedent). */
export const helpSheet = createDisclosure();
