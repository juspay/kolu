/** A SCREEN OF THIS TERMINAL IS SHOWING IN THE CONDUCTOR — the one fact the
 *  attention engine reads to know a terminal is in front of the person while
 *  the Conductor is on screen, as it reads which pane has focus on the canvas.
 *
 *  It is said in one place: the screen part Look and a picked work's live pane
 *  both draw (`conductor/peek/PeekTerminal.tsx`) holds its terminal here for as
 *  long as it is mounted in a view that is shown. That part is mounted only
 *  while the screen is on screen — Look closes when the Conductor is hidden,
 *  and a live pane holds a screen only while `livePanes.ts`'s rule connects it
 *  (the Conductor shown, the work picked, Terminals in front, the front tab) —
 *  so "held here" and "showing" are one fact, not two that must agree.
 *
 *  Counted, not flagged: Look over a live pane of the same terminal is two
 *  screens, and closing one leaves the other showing. */

import { createStore } from "solid-js";

/** Screens held, by fleet ref (`<encodedHost>/<id>`). */
const [held, setHeld] = createStore<Record<string, number>>({});

/** Hold a screen of the terminal at `ref` as showing; the returned function
 *  lets it go. */
export function holdConductorScreen(ref: string): () => void {
  setHeld((all) => {
    all[ref] = (all[ref] ?? 0) + 1;
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setHeld((all) => {
      const left = (all[ref] ?? 1) - 1;
      if (left > 0) all[ref] = left;
      else delete all[ref];
    });
  };
}

/** Is a screen of this terminal showing in the Conductor? Reactive, per
 *  terminal. */
export function conductorScreenShowing(ref: string): boolean {
  return (held[ref] ?? 0) > 0;
}

/** Every terminal a screen of which is showing, by fleet ref — reactive over
 *  the set. Strings, so a list over it keeps each terminal's entry while
 *  others come and go. */
export const conductorScreensShowing = (): string[] => Object.keys(held);
