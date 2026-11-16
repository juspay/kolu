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
 *    - The status line names what is running and for how long; the work
 *      column is the side track on a wide window and behind the status
 *      line's count otherwise; a member's name goes to it and `Look` peeks
 *      (`ConductorStatus.tsx`, `WorkColumn.tsx`, `ConductorLook.tsx`).
 *    - Enter queues at the agent, the steer chord goes into the running turn
 *      while the status line offers it, and `■ Stop` is beside Send.
 *    - A wake is kolu ringing the conversation when a watched agent is ready
 *      — its screen has settled, before it has said a word — stops, asks, or
 *      leaves (`wake.ts`'s own levels), drawn as the transcript line that
 *      opens with `kolu`.
 *    - A question arrives as a form, and the tab's badge turns the needs-you
 *      violet while it stands (`ConductorTab.tsx`).
 *
 *  SKIMMED, NOT READ. Each section is two or three bullets, a phrase each, and
 *  a bullet is a row of TYPED parts so the panel can draw each kind the way
 *  the screen does: a key as a keycap, a thing to type as code a person could
 *  copy, a word the screen shows set off as that word. Prose that names a key
 *  in letters is prose nobody scans.
 *
 *  STATIC. No counts, no live data, nothing that has to be re-read while a
 *  turn runs: this is the manual, and the conversation beside it is the state.
 *  The one thing computed is a key's label, printed in the reader's own idiom
 *  (`formatKeybind`) rather than spelled `⌥⏎` at a Linux reader. */

import { formatKeybind, type Keybind } from "../input/keyboard";
import { isMac as detectedIsMac } from "../input/platform";
import { boolPref } from "../persistedPref";
import { createDisclosure } from "../ui/createDisclosure";
import { STEER_KEYBIND } from "./steer";

/** The sections, in the order they are read. The id is what a test and a
 *  stylesheet address a section BY, so a reworded heading is not a broken
 *  selector. */
export type HelpSectionId =
  | "ask"
  | "waterfall"
  | "while-it-works"
  | "the-card"
  | "terminals"
  | "the-lock"
  | "files"
  | "mid-work"
  | "wakes"
  | "asks";

/** One piece of a bullet, by what it IS rather than how it looks:
 *
 *  - `text` — the help's own words;
 *  - `key` — a key to press, already labelled for this platform;
 *  - `code` — something to type, verbatim;
 *  - `screen` — a word the screen itself shows (a button, a line's opener),
 *    so the help points at what is actually there. */
export interface HelpPart {
  readonly kind: "text" | "key" | "code" | "screen";
  readonly text: string;
}

/** One bullet: a phrase, as a row of parts. */
export type HelpItem = readonly HelpPart[];

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly heading: string;
  readonly items: readonly HelpItem[];
}

const text = (words: string): HelpPart => ({ kind: "text", text: words });
const code = (typed: string): HelpPart => ({ kind: "code", text: typed });
const screen = (word: string): HelpPart => ({ kind: "screen", text: word });

/** The help, with every key labelled for one platform — the reader's own by
 *  default. */
export function helpSections(
  isMac: boolean = detectedIsMac,
): readonly HelpSection[] {
  const key = (keybind: Keybind): HelpPart => ({
    kind: "key",
    text: formatKeybind(keybind, isMac),
  });
  return [
    {
      id: "ask",
      heading: "Ask",
      items: [
        [text("Type what you want done")],
        [key({ key: "@" }), text(" a terminal, on any host")],
        [key({ key: "/" }), text(" an agent command")],
      ],
    },
    {
      id: "waterfall",
      heading: "Build it end to end",
      items: [
        [code("waterfall fix the login error in ~/code/app")],
        [text("Answer its setup questions; it runs the rest")],
        [text("Your answers are kept, as the work’s decisions")],
      ],
    },
    {
      id: "while-it-works",
      heading: "While it works",
      items: [
        [text("The status line: what it is doing, for how long")],
        [text("The work: beside the chat, or behind the status line’s count")],
        [text("Waiting on you first, then the rest in progress")],
        [text("A chip on a reply names its work; click it to go there")],
      ],
    },
    {
      id: "the-card",
      heading: "A piece of work",
      items: [
        [text("One card per branch: opening it again is the same work")],
        [text("Its stages: plan, approve, build, review, checks, merge")],
        [text("Each coloured by whose time: agents, you, CI")],
        [text("Click a stage to see its part of the timeline")],
        [text("Open it for the PR, the setup and the latest decisions")],
        [
          screen("Stop"),
          text(" ends it, "),
          screen("Reopen"),
          text(" brings it back with what it decided"),
        ],
      ],
    },
    {
      id: "terminals",
      heading: "Its terminals",
      items: [
        [text("Each one by the part it plays: planner, implementor")],
        [text("A name takes you to that terminal")],
        [screen("Look"), text(" peeks at its screen")],
        [text("Losing them says “no terminals”; the work is still there")],
      ],
    },
    {
      id: "the-lock",
      heading: "Who is typing",
      items: [
        [text("A terminal it drives is bordered; reading it is not gated")],
        [text("Type in it and a card offers "), screen("Take over")],
        [
          screen("Hand back"),
          text(" is the pill in its corner; it is told either way"),
        ],
      ],
    },
    {
      id: "files",
      heading: "What it wrote",
      items: [
        [text("A file opens in the reader, beside the chat")],
        [text("A file named in a reply opens that reply’s work’s copy")],
        [screen("Pop out"), text(" gives it a window of its own")],
        [text("Select text to comment, as on the Code tab")],
        [text("Kept when the work ends, after the worktree is gone")],
      ],
    },
    {
      id: "mid-work",
      heading: "Talk to it mid-turn",
      items: [
        [key({ key: "Enter" }), text(" queues after the turn")],
        [key(STEER_KEYBIND), text(" steers the turn, when offered")],
        [screen("■ Stop"), text(" ends the turn")],
      ],
    },
    {
      id: "wakes",
      heading: "It wakes itself",
      items: [
        [text("When a member’s agent is ready, stops, asks or leaves")],
        [text("Ready: its screen has settled, before it says a word")],
        [text("A "), screen("kolu"), text(" line in the chat is a wake")],
      ],
    },
    {
      id: "asks",
      heading: "When it asks you",
      items: [
        [text("Answer on the work’s card, or in the chat")],
        [text("Either one settles it; the card records which")],
        [
          text("Until then, the "),
          screen("Conductor"),
          text(" tab’s badge is violet"),
        ],
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
