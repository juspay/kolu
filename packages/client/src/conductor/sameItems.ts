/** THE EQUALITY GATES A FOLD'S MEMO CLOSES ITSELF WITH.
 *
 *  A memo that rebuilds a list or a small record out of a record that moves
 *  often publishes a NEW value for an unchanged one under reference equality,
 *  and every subscriber wakes for nothing. These are the three comparisons
 *  those folds need, written once so a reader meets the same three names
 *  everywhere rather than a hand-rolled closure per site:
 *
 *   - {@link sameItems} for a list of things that have their own identity
 *     (rows, events, strings, numbers) rebuilt around the same members;
 *   - {@link sameFields} for a flat record of leaves (`{ wait, text }`,
 *     `{ kind, times }`) built fresh from unchanged leaves;
 *   - {@link sameEach} for a list whose ROWS are themselves rebuilt, which
 *     needs a reading of a row rather than its reference.
 *
 *  Each takes `undefined` on either side, because the value a `<Show>` or a
 *  `<Match>` is gated on is a narrowing that may be absent. */

/** Two lists holding the SAME members in the same order. */
export const sameItems = <T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((one, index) => one === b[index]));

/** Two records with the same keys carrying the same leaves. One level: a
 *  field holding a rebuilt list or record is compared by reference, so a
 *  record with one of those takes {@link sameItems} on that field in a
 *  comparison of its own. */
export const sameFields = (
  a: object | undefined,
  b: object | undefined,
): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  return keys.every((key) => left[key] === right[key]);
};

/** Two lists whose rows are compared by `same` rather than by reference —
 *  for a fold that mints a row object per member on every run. */
export const sameEach =
  <T>(same: (a: T, b: T) => boolean) =>
  (a: readonly T[] | undefined, b: readonly T[] | undefined): boolean =>
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.length === b.length &&
      a.every((one, index) => {
        const other = b[index];
        return other !== undefined && same(one, other);
      }));
