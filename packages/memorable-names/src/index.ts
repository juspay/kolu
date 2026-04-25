/**
 * Memorable random name generator — picks ADJ-NOUN from WordNet-derived word lists.
 * Word lists ship checked-in as words.json (no env var, no runtime file I/O).
 *
 * To regenerate from WordNet:
 *   just regenerate  (from packages/memorable-names/)
 */

import { type NonEmpty, nonEmptyOrThrow } from "anyagent/nonempty";
import wordsJson from "../words.json" with { type: "json" };

const adjectives = nonEmptyOrThrow(
  wordsJson.adjectives,
  "words.json: adjectives is empty",
);
const nouns = nonEmptyOrThrow(wordsJson.nouns, "words.json: nouns is empty");

function pick(list: NonEmpty<string>): string {
  // Math.floor(rand * length) ∈ [0, length); positional `list[0]` is
  // statically `string`, so `?? list[0]` is a typed fallback the math
  // never actually triggers.
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] ?? list[0];
}

/** Generate a random ADJ-NOUN name (e.g. "bright-falcon"). */
export function randomName(): string {
  return `${pick(adjectives)}-${pick(nouns)}`;
}
