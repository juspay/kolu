/** What a person typed into the Conductor's custom compaction field, read as
 *  a number of tokens: the field takes THOUSANDS, so `250` is 250,000. A whole
 *  number from 100 to 1000 only; anything else (empty, a fraction, letters, out
 *  of range) is `null` and is not saved. The bounds are `kolu-common`'s, so the
 *  field accepts exactly what the preference does. */

import {
  CONDUCTOR_COMPACTS_AT_MAX,
  CONDUCTOR_COMPACTS_AT_MIN,
} from "kolu-common/conductor";

export function compactsAtEntry(text: string): number | null {
  const typed = text.trim();
  if (!/^\d+$/.test(typed)) return null;
  const count = Number(typed) * 1000;
  return count >= CONDUCTOR_COMPACTS_AT_MIN &&
    count <= CONDUCTOR_COMPACTS_AT_MAX
    ? count
    : null;
}
