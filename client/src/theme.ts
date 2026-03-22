/** Terminal theme management.
 *
 * Themes are loaded from a Nix-generated JSON file (ghostty-themes virtual module).
 * The hardcoded DEFAULT_THEME is always available as a fallback.
 */

import type { ITheme } from "ghostty-web";
import availableThemesJson from "ghostty-themes";

export interface NamedTheme {
  name: string;
  theme: ITheme;
}

export const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

export const DEFAULT_THEME_NAME = "Tomorrow Night";

/** Hardcoded default theme (Tomorrow Night variant). */
export const DEFAULT_THEME: ITheme = {
  foreground: "#ffffff",
  background: "#292c33",
  cursor: "#ffffff",
  cursorAccent: "#363a43",
  selectionBackground: "#44475a",
  selectionForeground: "#c5c8c6",
  black: "#1d1f21",
  red: "#bf6b69",
  green: "#b7bd73",
  yellow: "#e9c880",
  blue: "#88a1bb",
  magenta: "#ad95b8",
  cyan: "#95bdb7",
  white: "#c5c8c6",
  brightBlack: "#666666",
  brightRed: "#c55757",
  brightGreen: "#bcc95f",
  brightYellow: "#e1c65e",
  brightBlue: "#83a5d6",
  brightMagenta: "#bc99d4",
  brightCyan: "#83beb1",
  brightWhite: "#eaeaea",
};

/** All available themes: Nix-generated themes + hardcoded default. */
export const availableThemes: NamedTheme[] = [
  { name: DEFAULT_THEME_NAME, theme: DEFAULT_THEME },
  ...availableThemesJson.filter((t) => t.name !== DEFAULT_THEME_NAME),
];

// O(1) lookup by name, built once at module load
const themesByName = new Map(availableThemes.map((t) => [t.name, t.theme]));

/** Look up a theme by name, falling back to DEFAULT_THEME. */
export function getThemeByName(name: string | undefined): ITheme {
  return (name && themesByName.get(name)) ?? DEFAULT_THEME;
}
