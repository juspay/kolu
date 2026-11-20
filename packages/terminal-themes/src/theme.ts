import type { ITheme } from "@xterm/xterm";
import availableThemesJson from "../themes.json" with { type: "json" };

export interface NamedTheme {
  name: string;
  theme: ITheme;
}

export const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

/** The font size a kolu terminal is constructed at when no preference says
 *  otherwise, in px. */
export const DEFAULT_FONT_SIZE = 14;

/** All available themes from the checked-in JSON. The cast asserts
 *  non-empty at the import boundary. */
export const availableThemes = availableThemesJson as [
  NamedTheme,
  ...NamedTheme[],
];

export const DEFAULT_THEME_NAME = "Tomorrow Night";
export const DEFAULT_THEME: ITheme =
  availableThemes.find((t) => t.name === DEFAULT_THEME_NAME)?.theme ??
  availableThemes[0].theme;

const themesByName = new Map(availableThemes.map((t) => [t.name, t.theme]));

/** Look up a theme by name, falling back to DEFAULT_THEME. */
export function getThemeByName(name: string | undefined): ITheme {
  return (name ? themesByName.get(name) : undefined) ?? DEFAULT_THEME;
}

/** Resolve a list of terminal IDs to their background hex strings via
 *  `getThemeName` + the theme map. Drops any IDs whose resolved theme has
 *  no parseable background. Used as the peer-set input for the variegated
 *  picker — both at new-terminal creation and at user-triggered shuffle. */
export function resolveThemeBgs<Id>(
  ids: Iterable<Id>,
  getThemeName: (id: Id) => string | undefined,
): string[] {
  const bgs: string[] = [];
  for (const id of ids) {
    const bg = getThemeByName(getThemeName(id)).background;
    if (bg) bgs.push(bg);
  }
  return bgs;
}
