/** The moonlit palette of a sleeping tile — one home for the dormant aesthetic
 *  shared by the canvas tile shell, its body, and the dock row, so a tweak flows
 *  to all three and they can't drift. Mirrors the note's mockup
 *  (docs/atlas/src/content/atlas/sleeping-terminals.mdx). */

/** The moon accent — sleeping tile border, active outline, Wake button, ☾ pip. */
export const MOON = "#8895ad";
/** The dormant tile background (a muted, cool dark). */
export const MOON_BG = "#1d2230";
/** The body's primary text (intent / cwd basename heading). */
export const MOON_TEXT = "#c7ccd6";
/** The body's secondary text (the cwd path line). */
export const MOON_SUBTLE = "#8b929d";
/** The body's faintest text (the "asleep · PTY released" status line). */
export const MOON_FAINT = "#5b626d";
/** Foreground ON the moon accent (the Wake button's label over `MOON`). */
export const MOON_ON = "#0e1014";
