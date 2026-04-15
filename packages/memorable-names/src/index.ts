/**
 * Memorable random name generator — picks ADJ-NOUN from WordNet-derived word lists.
 * Word lists ship checked-in as words.json (no env var, no runtime file I/O).
 *
 * To regenerate from WordNet:
 *   just regenerate-words
 */

import words from "../words.json" with { type: "json" };

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** Generate a random ADJ-NOUN name (e.g. "bright-falcon"). */
export function randomName(): string {
  return `${pick(words.adjectives)}-${pick(words.nouns)}`;
}
