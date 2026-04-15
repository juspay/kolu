/** Terminal theme catalog + perceptual-distance picker.
 *
 *  Themes are parsed from iTerm2-Color-Schemes (Ghostty format) and ship
 *  checked-in as themes.json — no env var, no Vite virtual module.
 *
 *  To regenerate from iTerm2-Color-Schemes:
 *    just regenerate  (from this package directory)
 */

export type { ITheme } from "@xterm/xterm";

// Theme catalog
export {
  type NamedTheme,
  FONT_FAMILY,
  availableThemes,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME,
  getThemeByName,
  resolveThemeBgs,
} from "./theme.ts";

// Theme picker
export { hexToOkLab, okLabDistance, pickTheme } from "./picker.ts";
