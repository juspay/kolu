/** Family-pair index for OS-driven light/dark variant swaps.
 *
 * Hand-curated set of light/dark sibling pairs drawn from
 * {@link availableThemes}. When the user enables "Match OS appearance
 * for terminals", a stored theme that belongs to a pair flips to its
 * sibling on OS scheme change; themes outside the index keep their
 * stored variant unchanged. Coverage is the popular tier — widening
 * this list later is data-only, no schema change.
 *
 * Every name in {@link FAMILY_PAIRS} must exist in `availableThemes`.
 * `families.test.ts` enforces this — a typo or a renamed upstream
 * theme breaks the build, not a runtime user. */

export interface FamilyPair {
  /** Light-variant theme name. Must exist in availableThemes. */
  light: string;
  /** Dark-variant theme name. Must exist in availableThemes. */
  dark: string;
}

export const FAMILY_PAIRS: readonly FamilyPair[] = [
  { light: "Catppuccin Latte", dark: "Catppuccin Mocha" },
  { light: "Gruvbox Light", dark: "Gruvbox Dark" },
  { light: "Gruvbox Material Light", dark: "Gruvbox Material Dark" },
  { light: "TokyoNight Day", dark: "TokyoNight Night" },
  { light: "GitHub Light Default", dark: "GitHub Dark Default" },
  { light: "One Half Light", dark: "One Half Dark" },
  { light: "Atom One Light", dark: "Atom One Dark" },
  { light: "One Double Light", dark: "One Double Dark" },
  { light: "Rose Pine Dawn", dark: "Rose Pine Moon" },
  { light: "Everforest Light Med", dark: "Everforest Dark Hard" },
  { light: "Nord Light", dark: "Nord" },
  { light: "Ayu Light", dark: "Ayu Mirage" },
  { light: "Tomorrow", dark: "Tomorrow Night" },
  { light: "Monokai Pro Light", dark: "Monokai Pro" },
  { light: "Monospace Light", dark: "Monospace Dark" },
];

const themeToPair = new Map<string, FamilyPair>();
for (const p of FAMILY_PAIRS) {
  themeToPair.set(p.light, p);
  themeToPair.set(p.dark, p);
}

/** Resolve a theme name to its family sibling for the wanted variant.
 *  Returns the same name when it's already the right variant, or when
 *  the theme isn't in any family pair (no auto-flip). */
export function resolveThemeForVariant(
  themeName: string,
  wantVariant: "light" | "dark",
): string {
  const pair = themeToPair.get(themeName);
  if (!pair) return themeName;
  return wantVariant === "light" ? pair.light : pair.dark;
}
