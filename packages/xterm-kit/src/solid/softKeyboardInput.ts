import type { Terminal as XTerm } from "@xterm/xterm";
import { isCoarsePointer } from "./pointer";

/** Prepare the touch input surface and return the `.xterm-screen` element, or
 *  `null` on desktop (non-coarse pointer) / before xterm's DOM exists.
 *
 *  On iOS the soft keyboard must be summoned through a *contenteditable*
 *  `.xterm-screen`, not xterm's hidden helper textarea. xterm already disables
 *  spellcheck/autocorrect on that textarea (CoreBrowserTerminal.ts), but iOS
 *  Safari still runs spell-check against the accumulated `textarea.value` that
 *  `_syncTextArea()` parks at the cursor cell — hence the phantom underlines.
 *  `caret-color: transparent` keeps the native contenteditable caret from
 *  fighting xterm's rendered cursor. The `isCoarsePointer()` guard lives here,
 *  so callers invoke this unconditionally and never reach into xterm's shadow
 *  DOM themselves. */
export function enableSoftKeyboardInput(term: XTerm): HTMLElement | null {
  if (!isCoarsePointer()) return null;
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
