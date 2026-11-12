/** THE SHELL the chrome bar's two right-hand controls share — the posture
 *  control (`▦ canvas · ▢ maximized`) and the conductor's own entry.
 *
 *  They are different things and read differently, which is the whole point of
 *  the conductor being a destination rather than a third segment. But they
 *  sit side by side in one row, so the box they sit in — height, radius, edge,
 *  vertical centring — has to be ONE fact, not two that happen to agree today.
 *  It did not: the entry was `h-7` beside a control sized only by its padding,
 *  so it stood a couple of pixels taller than its neighbour and read as a
 *  debug button somebody left in rather than part of the chrome.
 *
 *  Height is explicit on both rather than derived from each one's own text,
 *  because the two deliberately carry different type (the entry is the
 *  chrome's own sans, the posture segments are the glyph-and-word monospace
 *  pair) and type is exactly the thing that would make them drift. */
export const CHROME_CONTROL_SHELL =
  "h-7 shrink-0 rounded-lg border border-edge";
