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

/** The font size a kolu terminal is constructed at when no preference says
 *  otherwise, in px.
 *
 *  Beside {@link FONT_FAMILY} because the two are ONE fact — what a kolu
 *  terminal is DRAWN in — and they travel together for that reason:
 *  `screenshotTerminal.ts` reads both to repaint a buffer, and a consumer
 *  painting a padi's terminal with this catalog reads both to construct it.
 *  Not because nobody needs one alone — `client/src/input/zoom.ts` reads the
 *  SIZE alone, as the base and reset value of a user zoom preference, and
 *  touches no theme at all. It lived in `kolu-common/config` beside the server port, which
 *  is a manifest naming eighteen workspace packages — so the first consumer to
 *  want the integer re-typed it as a bare `14` rather than pay that, on the
 *  line below the `FONT_FAMILY` it was already importing from here. A catalog
 *  that says which COLOURS a terminal has and not what size it is drawn at was
 *  half an answer. */
export const DEFAULT_FONT_SIZE = 14;

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
