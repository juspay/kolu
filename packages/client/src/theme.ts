/** Terminal theme management.
 *
 * All themes come from the Nix-generated JSON file (ghostty-themes virtual module).
 * The first theme in the list is used as the default.
 */

import type { ITheme } from "@xterm/xterm";
import availableThemesJson from "ghostty-themes";

export interface NamedTheme {
  name: string;
  theme: ITheme;
}

export const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

/** All available themes from the Nix-generated JSON. */
export const availableThemes: NamedTheme[] = availableThemesJson;

export const DEFAULT_THEME_NAME = "Tomorrow Night";
export const DEFAULT_THEME: ITheme =
  availableThemes.find((t) => t.name === DEFAULT_THEME_NAME)?.theme ??
  availableThemes[0]!.theme;

// O(1) lookup by name, built once at module load
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
