/** Line 1 of an intent — what a compact slot shows of a multi-line intent. */
export function firstIntentLine(intent: string): string {
  return intent.split(/\r?\n/, 1)[0] ?? "";
}

export function annotationLine(
  intent: string | undefined,
  fallback: string,
): string {
  if (intent) return firstIntentLine(intent);
  return fallback;
}

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
