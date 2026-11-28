/** ONE KEY LIT AT A TIME, told to that key's readers only — the selector shape
 *  (`isSelected(key)`), spelled with Solid 2's mechanism for it, a projection.
 *
 *  A plain memo over "is MY key the chosen one?" would wake every row on every
 *  move of the selection: each row reads the same source. A PROJECTION is a
 *  derived store, so its readers subscribe per KEY — the derive lights the
 *  chosen key and clears the one it lit last, which notifies exactly the two
 *  rows whose answer changed and nobody else.
 *
 *  The key the last run lit is remembered in a closure variable rather than
 *  re-derived from the draft: the draft is this projection's own state, and
 *  scanning it per run would be the O(rows) work the projection exists to
 *  avoid. `null`/`undefined` from the source means nothing is chosen.
 *
 *  Returns the same `isSelected(key)` shape the call sites already pass around,
 *  so a consumer cannot tell a selector from a projection. */

import { type Accessor, createProjection } from "solid-js";

export function createKeySelector<K extends string | number>(
  source: Accessor<K | null | undefined>,
): (key: K) => boolean {
  let lit: K | undefined;
  const chosen = createProjection<Record<string | number, boolean>>((draft) => {
    const key = source() ?? undefined;
    if (lit !== undefined && lit !== key) delete draft[lit];
    if (key !== undefined) draft[key] = true;
    lit = key;
  }, {});
  return (key: K): boolean => chosen[key] === true;
}
