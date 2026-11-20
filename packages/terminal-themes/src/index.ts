export type { ITheme } from "@xterm/xterm";
export {
  hexToOkLab,
  okLabDistance,
  pickTheme,
  themeColourful,
  themeMode,
  type ThemePickMode,
} from "./picker.ts";
export {
  availableThemes,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  DEFAULT_THEME_NAME,
  FONT_FAMILY,
  getThemeByName,
  type NamedTheme,
  resolveThemeBgs,
} from "./theme.ts";
