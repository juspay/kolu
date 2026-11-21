/** IS A LIVE PANE'S TERMINAL FITTED TO ITS VIEW — one choice for every pane,
 *  not each pane's own.
 *
 *  A pane used to hold this in a `createSignal(false)` of its own: the first
 *  sight of a wide terminal was a sideways scroller with a **Fit width**
 *  button, and the moment the pane was drawn again — switching Terminals and
 *  Details, picking another work, changing which terminal is in front — the
 *  choice was gone. So it starts ON, and it is kept in `sessionStorage` like
 *  the Conductor's other per-tab view choices (`workListing.ts`'s pick,
 *  `phoneView.ts`'s tab): no server state, no saved-state version, and a
 *  reload stays where the person left it. */

import { defaultInvalidWarning, persistedPref } from "../persistedPref";

const KEY = "kolu-conductor-fit-width";

/** The strict boolean the stored value must be — anything else is a
 *  corrupt preference and falls back to the default rather than guessing. */
function parseFitWidth(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`not a fit-width choice: ${raw}`);
}

const [fitWidth, setFitWidth] = persistedPref<boolean>({
  name: KEY,
  fallback: true,
  parse: parseFitWidth,
  storage: sessionStorage,
  onInvalid: defaultInvalidWarning(KEY, true),
});

export { fitWidth, setFitWidth };
