/** HOW TO USE THE CONDUCTOR — the words, written once.
 *
 *  A person arriving at this conversation for the first time is looking at a
 *  box and a blinking cursor, and nothing on screen says that `@` reaches
 *  every host or that the work beside the chat can be answered where it
 *  stands. So the pane teaches, one press away: a sheet behind the **?** in
 *  the Conductor's header, and behind **How to use** in the `⋯` menu at every
 *  width (`ConductorHelp.tsx`).
 *
 *  ONE COPY, SHORT. Six sections, two or three bullets each — what a person
 *  needs to start, not everything the Conductor can do; the Conductor's docs
 *  page is the link at the foot (`DocLink`). Every statement here is read
 *  off the build it describes, not off a wish:
 *
 *    - `@` and `/` are the composer's own two completions, and `@` spans every
 *      host (`ConductorComposer.tsx`).
 *    - A waterfall ASKS ITS OWN setup questions first. Which ones is the
 *      script's (`packages/conductor/src/teaching.md`), so the help says THAT
 *      it asks and not WHICH.
 *    - Each work is a card beside the chat on a wide window and behind the
 *      status line's count otherwise; the works that need you are the first
 *      group; an open card holds the PR, the timeline and the terminals
 *      (`WorkColumn.tsx`, `WorkCard.tsx`).
 *    - `Look` opens the peek, and a member's name goes to its tile
 *      (`ConductorLook.tsx`, `peek/TerminalPeek.tsx`).
 *    - A terminal the Conductor drives takes no typing until `Take over`, and
 *      `Hand back` returns it (`WorkLock.tsx`).
 *    - A question is answered on its work or in the chat, and the tab's badge
 *      is violet while it stands (`ConductorTab.tsx`).
 *
 *  SKIMMED, NOT READ. A bullet is a row of TYPED parts so the sheet can draw
 *  each kind the way the screen does: a key as a keycap, a thing to type as
 *  code a person could copy, a word the screen shows set off as that word.
 *  Prose that names a key in letters is prose nobody scans.
 *
 *  STATIC. No counts, no live data, nothing that has to be re-read while a
 *  turn runs: this is the manual, and the conversation beside it is the state.
 *  The one thing computed is a key's label, printed in the reader's own idiom
 *  (`formatKeybind`). */

import { formatKeybind, type Keybind } from "../input/keyboard";
import { isMac as detectedIsMac } from "../input/platform";
import { createDisclosure } from "../ui/createDisclosure";

/** The sections, in the order they are read. The id is what a test and a
 *  stylesheet address a section BY, so a reworded heading is not a broken
 *  selector. */
export type HelpSectionId =
  | "ask"
  | "waterfall"
  | "the-card"
  | "terminals"
  | "the-lock"
  | "asks";

/** One piece of a bullet, by what it IS rather than how it looks:
 *
 *  - `text` — the help's own words;
 *  - `key` — a key to press, already labelled for this platform;
 *  - `code` — something to type, verbatim;
 *  - `screen` — a word the screen itself shows (a button, a tab), so the
 *    help points at what is actually there. */
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
        [key({ key: "@" }), text(" names a work, or a terminal on any host")],
        [key({ key: "/" }), text(" runs an agent command")],
      ],
    },
    {
      id: "waterfall",
      heading: "Build it end to end",
      items: [
        [code("waterfall fix the login error in ~/code/app")],
        [text("Answer its questions. It runs the rest.")],
      ],
    },
    {
      id: "the-card",
      heading: "Follow the work",
      items: [
        [
          text(
            "Each work is a card, beside the chat or behind the status line’s count",
          ),
        ],
        [text("Works that need you come first")],
        [text("Open a card for its PR and timeline")],
      ],
    },
    {
      id: "terminals",
      heading: "See a terminal",
      items: [
        [text("Open a card for its terminals")],
        [screen("Look"), text(" opens a peek: that terminal, live")],
        [text("A name goes to the terminal’s tile")],
      ],
    },
    {
      id: "the-lock",
      heading: "Type in a terminal",
      items: [
        [text("The Conductor’s terminals are read-only")],
        [screen("Take over"), text(" lets you type")],
        [screen("Hand back"), text(" returns it to the Conductor")],
      ],
    },
    {
      id: "asks",
      heading: "When it asks you",
      items: [
        [text("Answer on the work or in the chat")],
        [
          text("The "),
          screen("Conductor"),
          text(" tab’s badge is violet until you do"),
        ],
      ],
    },
  ];
}

/** The sheet behind the header's **?** and the `⋯` menu's **How to use** —
 *  the repo's one disclosure shape, co-located with the words it shows
 *  (`ShortcutsHelp`'s precedent). */
export const helpSheet = createDisclosure();
