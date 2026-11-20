/** The id after `current` in a list, wrapping. `current` absent (or not in the
 *  list) starts at the beginning. */
export function nextAfter<T>(
  ids: readonly T[],
  current: T | null,
): T | undefined {
  if (ids.length === 0) return undefined;
  const at = current === null ? -1 : ids.indexOf(current);
  return ids[(at + 1) % ids.length];
}
