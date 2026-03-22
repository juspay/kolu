/** Terminal appearance config. Shared between terminal and app chrome. */

import { currentTheme } from "./themes";

export const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

/** Default options applied to every terminal instance. */
export const TERMINAL_DEFAULTS = {
  fontFamily: FONT_FAMILY,
  get theme() {
    return currentTheme().theme;
  },
};
