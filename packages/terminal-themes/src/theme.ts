/** Terminal theme management.
 *
 * All themes come from the checked-in themes.json (parsed from
 * iTerm2-Color-Schemes Ghostty format).
 */

import type { ITheme } from "@xterm/xterm";
import availableThemesJson from "../themes.json" with { type: "json" };

export interface NamedTheme {
  name: string;
  theme: ITheme;
}

export const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

/** All available themes from the checked-in JSON. The cast asserts
 *  non-empty at the import boundary — the JSON is regenerated from
 *  iTerm2-Color-Schemes by a build script, so empty is a build-time
 *  failure, not a runtime one. */
export const availableThemes = availableThemesJson as [
  NamedTheme,
  ...NamedTheme[],
];

export const DEFAULT_THEME_NAME = "Tomorrow Night";
export const DEFAULT_THEME: ITheme =
  availableThemes.find((t) => t.name === DEFAULT_THEME_NAME)?.theme ??
  availableThemes[0].theme;

// O(1) lookup by name, built once at module load
const themesByName = new Map(availableThemes.map((t) => [t.name, t.theme]));

/** Look up a theme by name, falling back to DEFAULT_THEME. */
export function getThemeByName(name: string | undefined): ITheme {
  return (name ? themesByName.get(name) : undefined) ?? DEFAULT_THEME;
}

/** Theme NAMES → the backgrounds they render as — the peer-set input for the
 *  variegated picker, at new-terminal creation and at user-triggered shuffle
 *  alike. `undefined` is a name too: an unthemed terminal renders in
 *  `DEFAULT_THEME`, so it resolves to that background rather than being dropped.
 *  Only a resolved theme with no parseable background drops out. */
export function resolveThemeBgs(
  themeNames: Iterable<string | undefined>,
): string[] {
  const bgs: string[] = [];
  for (const name of themeNames) {
    const bg = getThemeByName(name).background;
    if (bg) bgs.push(bg);
  }
  return bgs;
}
