/** WHICH FILE IS BEING READ — one module signal, and the route that carries
 *  the same fact into a window of its own.
 *
 *  A plan is the one thing a person must read before they approve it, so
 *  opening a file is not a disclosure inside a card: it takes the large side
 *  of the Conductor's screen (`WorkReader.tsx`, laid out by
 *  `ConductorPane.tsx`). WHAT IS OPEN is therefore a fact about the pane and
 *  not about any card — module state for the same reason the open cards are:
 *  the column that holds the file rows is drawn in two placements and a resize
 *  moves it between them, and a reader that died with the card that opened it
 *  would shut on every resize.
 *
 *  THE POP-OUT IS THE SAME COMPONENT ON A ROUTE. `#/reader/<work>/<path>` is a
 *  WINDOW MODE, not a deep link: `index.tsx` reads it before anything mounts
 *  and renders the reader alone (`ReaderWindow.tsx`), because the second
 *  monitor is meant to hold the plan and not a second copy of the workspace.
 *  That is also why the grammar lives here beside the state rather than in
 *  `deepLink.ts`, whose routes are commands onto the ONE workspace view
 *  (`useDeepLinks`, view-only by law) — a reader window has no workspace to
 *  command. Everything it draws is read from the same live sources the pane's
 *  copy reads (the works collection, the member's worktree, the comments
 *  store), so the two are the same reader in two windows, not a copy. */

import { type Accessor, batch, createSignal } from "solid-js";
import { toast } from "solid-sonner";

/** The file the reader is on: a piece of work, and one worktree-relative path
 *  in it. Both are what the record itself says — the work's id and the path as
 *  `.waterfall/` listed it. */
export interface ReaderTarget {
  readonly work: string;
  readonly path: string;
}

const [target, setTarget] = createSignal<ReaderTarget | null>(null);
const [filled, setFilled] = createSignal(false);

/** THE FILE THE READER IS ON, or `null` when the cards are what the screen is
 *  showing. Read by the pane (which gives the reader its two thirds), by the
 *  work column (which gives way), and by the file rows (which light the open
 *  one). */
export const readerTarget: Accessor<ReaderTarget | null> = target;

/** IS THE READER FILLING THE WHOLE SCREEN — the second of the two ways to give
 *  it more room. The conversation stays mounted behind it at zero width, so
 *  the way back is one press and nothing is rebuilt on the way. */
export const readerFilled: Accessor<boolean> = filled;

/** Open a file in the reader. Opening a second file while one is open simply
 *  moves the reader to it — the header's tabs are that move. */
export function openReader(next: ReaderTarget): void {
  setTarget(next);
}

/** Back to the cards, exactly as they were. The fill goes with it: a reader
 *  that was filling the screen must not leave the conversation at zero width
 *  behind it. */
export function closeReader(): void {
  batch(() => {
    setTarget(null);
    setFilled(false);
  });
}

/** Fill the screen with the reader, or give the conversation its third back. */
export function toggleReaderFill(): void {
  setFilled((was) => !was);
}

/** The route that carries a target into a window of its own. One segment each,
 *  whole-value encoded: a worktree-relative path has slashes in it, and the
 *  grammar has exactly three segments however many the path has. */
export function readerHash(of: ReaderTarget): string {
  return `#/reader/${encodeURIComponent(of.work)}/${encodeURIComponent(of.path)}`;
}

/** Read a window's hash as a reader target, or `null` for every other hash —
 *  which is what tells `index.tsx` that this document is the workspace. Total:
 *  a malformed escape or a missing segment is `null`, never a half-target. */
export function parseReaderHash(hash: string): ReaderTarget | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const query = raw.indexOf("?");
  const path = query === -1 ? raw : raw.slice(0, query);
  const segments = path.split("/");
  if (segments[0] === "") segments.shift();
  const [family, work, file] = segments;
  if (segments.length !== 3 || family !== "reader") return null;
  if (work === undefined || file === undefined) return null;
  try {
    const decoded = {
      work: decodeURIComponent(work),
      path: decodeURIComponent(file),
    };
    return decoded.work === "" || decoded.path === "" ? null : decoded;
  } catch {
    return null;
  }
}

/** The pixels a popped-out reader opens at: the reading column and its gutters
 *  at a comfortable height, which is a window a person can park on a second
 *  monitor and leave there. */
const POP_OUT_FEATURES = "popup=yes,width=900,height=1000";

/** THE SAME READER, IN ITS OWN WINDOW. Named after the target, so pressing
 *  Pop out twice for one file raises the window that is already open rather
 *  than littering the desktop with copies of it.
 *
 *  A browser that refused the window SAYS SO: a silent no would read as a
 *  button that does nothing, and the one thing this button cannot do is
 *  nothing. */
export function popOutReader(of: ReaderTarget): void {
  const url = `${location.pathname}${location.search}${readerHash(of)}`;
  const opened = window.open(
    url,
    `kolu-reader:${of.work}:${of.path}`,
    POP_OUT_FEATURES,
  );
  if (opened === null) {
    toast.error(
      "The browser blocked the reader window — allow pop-ups for kolu",
    );
    return;
  }
  opened.focus();
  // The pane goes back to the cards: the file is now somewhere else on the
  // desk, and leaving a second copy of it over the conversation would be two
  // readers for one plan.
  closeReader();
}
