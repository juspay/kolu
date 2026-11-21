/** THE CONDUCTOR'S FRAME — which tracks its grid declares, for the state the
 *  pane is in.
 *
 *  On a desktop (and a tablet) the WORKS take the wide side and the CHAT is a
 *  panel of fixed measure on the right: 21rem below 1280px, 26rem from 1280px,
 *  32rem from 1800px (`index.css`'s `--container-conductor-chat*` and
 *  `--breakpoint-conductor-md` / `-lg`, the only place the numbers live). A
 *  file open in the reader takes the works' track; the chat stays where it
 *  is, unless the reader is filling the screen, when the chat's track is
 *  zero too. Every track that gives way is ZERO WIDE rather than gone, so
 *  what was in it comes back exactly as it was.
 *
 *  On a phone there is no side to put anything beside, so it shows one thing
 *  at a time: the chat or the works, by its tab bar (`phoneView.ts`), and a
 *  file open in the reader over either.
 *
 *  The answer is a class list, spelled out in full rather than assembled —
 *  Tailwind reads the source for its class names, so a track list built at
 *  run time is a grid with no CSS behind it. ONE SIGNAL, ASKED — never a
 *  measurement: a retained pane that measured its own box to decide its
 *  layout would read zeros every time it was hidden behind a host tab. */

import type { PhoneView } from "./phoneView";

/** What the frame needs to know to choose its tracks. */
export interface FrameState {
  readonly phone: boolean;
  /** Which of the two a phone is showing; a desktop shows both. */
  readonly view: PhoneView;
  /** A file is open in the reader. */
  readonly reading: boolean;
  /** The reader is filling the screen, the chat put aside. */
  readonly filled: boolean;
}

/** Are the works drawn? Always on a desktop (at zero width behind a file);
 *  on a phone only while its Work tab is the view and no file is open. */
export function worksDrawn(state: FrameState): boolean {
  return !state.phone || (state.view === "work" && !state.reading);
}

/** Is the conversation put aside — zero wide, skipped and out of reach? A
 *  reader filling the screen, or on a phone anything that is not the chat. */
export function chatPutAside(state: FrameState): boolean {
  if (state.phone) return state.reading || state.view === "work";
  return state.reading && state.filled;
}

/** THE TRACKS, by state. Children are, in order: the works (while they are
 *  drawn), the reader (only while a file is open), the chat. */
export function frameTracks(state: FrameState): string {
  if (state.phone)
    return chatPutAside(state)
      ? "grid-cols-[minmax(0,1fr)_0px]"
      : "grid-cols-[minmax(0,1fr)]";
  if (!state.reading)
    return "grid-cols-[minmax(0,1fr)_var(--container-conductor-chat)] conductor-md:grid-cols-[minmax(0,1fr)_var(--container-conductor-chat-md)] conductor-lg:grid-cols-[minmax(0,1fr)_var(--container-conductor-chat-lg)]";
  if (state.filled) return "grid-cols-[0px_minmax(0,1fr)_0px]";
  return "grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat)] conductor-md:grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat-md)] conductor-lg:grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat-lg)]";
}
