/** **What a row is CALLED and what colour it is** — the two folds that decide
 *  the annotation slot's text and its ink.
 *
 *  They ride with the row because a consumer that re-implements them gets a row
 *  whose words and hues differ from the Dock's, in the package built precisely
 *  so they cannot. That is not a hypothetical: both are small enough to look
 *  like something you would just write, and both have a rule inside them that
 *  is invisible from the outside — the annotation slot takes intent line 1 and
 *  NOT the branch when an intent exists (never both stacked), and the hue is a
 *  function of the key ALONE and not of which keys happen to be on screen.
 *
 *  kolu reads them back from here at its other altitudes (the title bar, the
 *  command palette, the switcher cards, the sub-panel tabs, the restore card),
 *  which is the same shape as the Dock reading `StatePip` out of
 *  `@kolu/solid-statepip`: the row owns what the row renders, and the surfaces
 *  that echo a row's identity read the row's own answer rather than a parallel
 *  one. */

/** Line 1 of an intent — what a compact slot shows of a multi-line intent. */
export function firstIntentLine(intent: string): string {
  return intent.split(/\r?\n/, 1)[0] ?? "";
}

/** The annotation line for a render site: intent line-1 when the user set one,
 *  otherwise the supplied fallback (typically the branch name or sub-tab
 *  label).
 *
 *  ONE slot per render site — never both stacked. That is the rule worth not
 *  re-deriving: it is why the intent's first-grapheme glyph appears here and
 *  not as a separate chip elsewhere on the same card. */
export function annotationLine(
  intent: string | undefined,
  fallback: string,
): string {
  if (intent) return firstIntentLine(intent);
  return fallback;
}

/** Stable 32-bit FNV-1a → hue in [0, 360) with full-hash precision.
 *  Using the full 32-bit range (not `% 360`) keeps ordinary names from
 *  colliding on exact hues. */
function stableHue(key: string): number {
  // NFC so the hue matches a monogram built from an NFD/NFC-equivalent name
  // (macOS paths). Empty / unexpected keys still get a deterministic hue.
  const s = key.normalize("NFC");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0x1_0000_0000) * 360;
}

/** The OKLCH identity colour for a key — a repo group, or a branch label.
 *
 *  A pure function of the key STRING, not of the co-set it appears in: that is
 *  the load-bearing property, and it is why the dock, the palette and the
 *  restore card paint the same repo the same hue even though their key sets
 *  differ. A consumer feeding `labelColor` calls this with the branch label and
 *  `--repo-color` with the repo group. */
export function identityColor(key: string): string {
  return `oklch(0.75 0.14 ${stableHue(key)})`;
}
