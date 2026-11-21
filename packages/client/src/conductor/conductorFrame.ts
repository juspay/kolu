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
 *  On a phone there is no side to put anything beside: the chat fills the
 *  frame, and a file open in the reader takes it whole.
 *
 *  The answer is a class list, spelled out in full rather than assembled —
 *  Tailwind reads the source for its class names, so a track list built at
 *  run time is a grid with no CSS behind it. ONE SIGNAL, ASKED — never a
 *  measurement: a retained pane that measured its own box to decide its
 *  layout would read zeros every time it was hidden behind a host tab. */

/** What the frame needs to know to choose its tracks. */
export interface FrameState {
  readonly phone: boolean;
  /** A file is open in the reader. */
  readonly reading: boolean;
  /** The reader is filling the screen, the chat put aside. */
  readonly filled: boolean;
}

/** THE TRACKS, by state. Children are, in order: the works (not on a
 *  phone), the reader (only while a file is open), the chat. */
export function frameTracks(state: FrameState): string {
  if (state.phone)
    return state.reading
      ? "grid-cols-[minmax(0,1fr)_0px]"
      : "grid-cols-[minmax(0,1fr)]";
  if (!state.reading)
    return "grid-cols-[minmax(0,1fr)_var(--container-conductor-chat)] conductor-md:grid-cols-[minmax(0,1fr)_var(--container-conductor-chat-md)] conductor-lg:grid-cols-[minmax(0,1fr)_var(--container-conductor-chat-lg)]";
  if (state.filled) return "grid-cols-[0px_minmax(0,1fr)_0px]";
  return "grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat)] conductor-md:grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat-md)] conductor-lg:grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat-lg)]";
}

/** Is the conversation put aside — zero wide, skipped and out of reach? A
 *  reader filling the screen, or a phone reading a file. */
export function chatPutAside(state: FrameState): boolean {
  return state.reading && (state.filled || state.phone);
}
