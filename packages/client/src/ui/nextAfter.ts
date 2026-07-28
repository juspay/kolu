/** The id after `current` in a list, wrapping — the "cycle past the one you are
 *  already on" rule every attention jump follows, so repeated clicks walk the
 *  whole set instead of bouncing on the first. `current` absent (or not in the
 *  list) starts at the beginning.
 *
 *  A pure list utility with no domain: it lived in `attentionNav.ts` beside the
 *  app-global jump registry, so a consumer that wanted the cycling arithmetic
 *  had to import from the attention *navigation registry* to get it. The
 *  registry encapsulates a real volatility (how you reach a terminal on another
 *  host); this is two lines of modular arithmetic over an array. */
export function nextAfter<T>(
  ids: readonly T[],
  current: T | null,
): T | undefined {
  if (ids.length === 0) return undefined;
  const at = current === null ? -1 : ids.indexOf(current);
  return ids[(at + 1) % ids.length];
}
