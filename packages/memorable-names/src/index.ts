/**
 * Memorable random name generator — picks ADJ-NOUN from WordNet-derived word lists.
 * Word lists ship checked-in as words.json (no env var, no runtime file I/O).
 *
 * To regenerate from WordNet:
 *   just regenerate  (from packages/memorable-names/)
 */

import { unwrap } from "anyagent/unwrap";
import words from "../words.json" with { type: "json" };

function pick(list: string[]): string {
  // The math (uniform random × length, floored) is in-range for any
  // non-empty list — `unwrap` documents the precondition at the throw
  // site instead of the bare `!`.
  return unwrap(
    list[Math.floor(Math.random() * list.length)],
    "memorable-names pick: word list is empty",
  );
}

/** Generate a random ADJ-NOUN name (e.g. "bright-falcon"). */
export function randomName(): string {
  return `${pick(words.adjectives)}-${pick(words.nouns)}`;
}
