/** WHETHER A PANE FITS ITS TERMINAL TO THE VIEW — one choice for every pane,
 *  live and Look, not each pane's own.
 *
 *  A pane used to hold this in a `createSignal(false)` of its own: the first
 *  sight of a wide terminal was a sideways scroller with a **Fit width**
 *  button, and the moment the pane was drawn again — switching Terminals and
 *  Details, picking another work, changing which terminal is in front — the
 *  choice was gone. So it starts ON, and it is kept in `localStorage`, like
 *  the font size: it is a taste about a screen, not a fact about one browser
 *  tab, so closing the tab or the installed app's window does not forget it.
 *  No server state, no saved-state version. */

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
  onInvalid: defaultInvalidWarning(KEY, true),
});

export { fitWidth, setFitWidth };
