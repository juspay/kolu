/** Soft-keyboard input surface for touch terminals.
 *
 *  The one piece of xterm-internal knowledge the touch path needs, kept in one
 *  testable place: on iOS the soft keyboard must be summoned through a
 *  *contenteditable* `.xterm-screen`, not xterm's hidden helper textarea. xterm
 *  already disables spellcheck/autocorrect on that textarea
 *  (CoreBrowserTerminal.ts), but iOS Safari still runs spell-check against the
 *  accumulated `textarea.value` that `_syncTextArea()` parks at the cursor cell —
 *  hence the phantom underlines. Making the screen element contenteditable gives
 *  mobile a real focus target and lets us opt the whole input surface out of
 *  correction features. `caret-color: transparent` keeps the native
 *  contenteditable caret from fighting xterm's rendered cursor.
 *
 *  Desktop is left untouched — xterm's mousedown → textarea.focus path works fine
 *  with a hardware keyboard, and we don't want to risk fighting its selection
 *  handling. The `isTouch()` guard lives here, so callers invoke this
 *  unconditionally and never reach into xterm's shadow DOM themselves.
 *
 *  Returns the prepared `.xterm-screen` element (the input surface) so the caller
 *  can wire tap-routing gestures onto it, or `null` on desktop / before xterm's
 *  DOM exists. */

import type { Terminal as XTerm } from "@xterm/xterm";
import { isTouch } from "../useMobile";

export function enableSoftKeyboardInput(term: XTerm): HTMLElement | null {
  if (!isTouch()) return null;
  const screen = term.element?.querySelector(
    ".xterm-screen",
  ) as HTMLElement | null;
  if (!screen) return null;
  screen.setAttribute("contenteditable", "true");
  screen.setAttribute("spellcheck", "false");
  screen.setAttribute("autocorrect", "off");
  screen.setAttribute("autocapitalize", "none");
  screen.setAttribute("autocomplete", "off");
  screen.setAttribute("aria-readonly", "true");
  screen.style.caretColor = "transparent";
  screen.style.outline = "none";
  return screen;
}
